/* Pure-function tests. No dependencies — `node --test tests/`.
 *
 * These cover the functions where a subtle bug is invisible in the UI:
 * escaping, initials, date formatting, slug generation. Each case here
 * corresponds to a defect that was actually present in this codebase.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'js');

/* store.js declares globals rather than exporting, which is how the browser
   loads it. Evaluate it in a sandbox and lift what we need. */
/* crypto is not on a bare vm context, and slugify now needs
   crypto.getRandomValues. Node's global WebCrypto is the same API the
   browser exposes, so handing it through tests the real code path rather
   than a stub. */
const ctx = vm.createContext({ console, crypto: globalThis.crypto });
vm.runInContext(
  readFileSync(resolve(APP, 'store.js'), 'utf8') +
  '\n;globalThis.__t = { esc, initialsOf, fmtDue, fmtAgo, slugify, DAY };',
  ctx
);
const { esc, initialsOf, fmtDue, fmtAgo, slugify } = ctx.__t;

/* onboarding.js is likewise a bare `const Onboarding = {...}` declaration —
   nothing runs at load, and nanpGroup touches neither the DOM nor the
   network, so it evaluates cleanly in its own sandbox. */
const obCtx = vm.createContext({ console });
vm.runInContext(
  readFileSync(resolve(APP, 'onboarding.js'), 'utf8') + '\n;globalThis.__ob = Onboarding;',
  obCtx
);
const Onboarding = obCtx.__ob;

test('esc neutralises every HTML metacharacter', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc('"><script>'), '&quot;&gt;&lt;script&gt;');
  assert.equal(esc("O'Brien"), 'O&#39;Brien');
  assert.equal(esc('a & b'), 'a &amp; b');
  // Must not throw or stringify as "null"/"undefined"
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

test('esc leaves already-safe text untouched', () => {
  assert.equal(esc('Dana Okafor'), 'Dana Okafor');
  assert.equal(esc('VP Product @ Stripe'), 'VP Product @ Stripe');
});

test('initialsOf is grapheme-safe', () => {
  // The bug: w[0] indexes UTF-16 code units, so an emoji yields a lone
  // surrogate — renders as U+FFFD and is not valid UTF-8 for Postgres.
  assert.equal(initialsOf('🎉 Bob'), '🎉B');
  assert.ok(!/[\uD800-\uDFFF]/.test(initialsOf('🎉 Bob').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')),
    'must not contain an unpaired surrogate');
  assert.equal(initialsOf('Dana Okafor'), 'DO');
  assert.equal(initialsOf('Cher'), 'C');
  assert.equal(initialsOf('  '), 'NC');
  assert.equal(initialsOf(''), 'NC');
  assert.equal(initialsOf(null), 'NC');
  assert.equal(initialsOf('José García'), 'JG');
});

test('fmtDue does not say "1 days overdue" one second past due', () => {
  const now = Date.now();
  assert.equal(fmtDue(now - 1000), 'overdue');
  assert.equal(fmtDue(now - 60_000), 'overdue');
});

test('fmtDue pluralises correctly', () => {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  assert.equal(fmtDue(startOfToday.getTime() - dayMs), '1 day overdue');
  assert.equal(fmtDue(startOfToday.getTime() - 3 * dayMs), '3 days overdue');
});

test('fmtDue buckets on calendar days, not elapsed hours', () => {
  // The bug: comparing (due - now) against 24h means a reminder due at 8am
  // tomorrow reads "due today" when viewed at 11pm.
  const at = (dayOffset, hour) => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + dayOffset); d.setHours(hour);
    return d.getTime();
  };
  assert.equal(fmtDue(at(0, 23)), 'due today');
  assert.equal(fmtDue(at(1, 8)), 'due tomorrow');
  assert.equal(fmtDue(at(1, 23)), 'due tomorrow');
});

test('slugify emits only URL-safe characters', () => {
  for (const name of ['Dana Okafor', 'José García', "O'Brien & Sons", '李伟', '🎉', '', '   ']) {
    const slug = slugify(name);
    assert.match(slug, /^[a-z0-9-]+$/, `"${name}" produced "${slug}"`);
    assert.ok(!slug.startsWith('-') && !slug.endsWith('-'), `"${slug}" has a stray hyphen`);
  }
});

test('slugify is non-deterministic, so two users with one name do not collide', () => {
  const a = slugify('Dana Okafor');
  const b = slugify('Dana Okafor');
  assert.notEqual(a, b);
});

test('slugify suffix carries enough entropy to survive brute force', () => {
  /* The bug: a 4-character base36 suffix on a guessable name base, in front
     of an anon-callable RPC that returns phone and email. 1.68M candidates
     per name is a script, not a secret. */
  const suffix = (s) => s.slice(s.lastIndexOf('-') + 1);
  assert.equal(suffix(slugify('Dana Okafor')).length, 16);
  // Look-alike characters must stay out, so a slug read off paper is
  // unambiguous.
  for (let i = 0; i < 200; i++) {
    assert.match(suffix(slugify('Dana Okafor')), /^[a-z0-9]{16}$/);
    assert.doesNotMatch(suffix(slugify('Dana Okafor')), /[lo01]/);
  }
  // And the suffixes must actually differ from each other.
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(suffix(slugify('Dana Okafor')));
  assert.equal(seen.size, 500);
});

test('nanpGroup never rewrites a number from another country', () => {
  /* The bug: the mask hard-assumed NANP, so "+44 7700 900123" was published
     on the public card and in the vCard as "+1 (447) 700-9001" — a real,
     dialable, wrong number belonging to someone else. */
  for (const intl of ['+44 7700 900123', '+33 6 12 34 56 78', '+61 2 9374 4000', '+81 3-1234-5678', '07700900123']) {
    assert.equal(Onboarding.nanpGroup(intl), intl, `mangled ${intl}`);
  }
});

test('nanpGroup groups numbers that really are North American', () => {
  assert.equal(Onboarding.nanpGroup('4155550100'), '(415) 555-0100');
  assert.equal(Onboarding.nanpGroup('+14155550100'), '+1 (415) 555-0100');
  assert.equal(Onboarding.nanpGroup('14155550100'), '1 (415) 555-0100');
  // Partial input formats as far as it can and no further.
  assert.equal(Onboarding.nanpGroup('415555'), '(415) 555');
  // A lone "+" is the start of some country code we don't know yet.
  assert.equal(Onboarding.nanpGroup('+'), '+');
});

test('fmtAgo renders recent timestamps in minutes', () => {
  assert.match(fmtAgo(Date.now() - 5 * 60_000), /^\d+m ago$/);
  assert.match(fmtAgo(Date.now() - 3 * 3600_000), /^\d+h ago$/);
});
