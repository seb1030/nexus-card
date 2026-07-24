#!/usr/bin/env node
/* Rewrites every ?v=… in the HTML and the service worker to a content hash.
 *
 * Why this exists: the version marker lives in four places — the <script>
 * and <link> tags in three HTML files, the SHELL array in sw.js, and
 * CACHE_VERSION. Keeping them in sync by hand has failed three times in this
 * project's short history: card.html sat at v=2 while index.html was at v=3
 * (so the shared supabase-client.js was cached under two URLs), the CSS
 * files had no marker at all (every stylesheet change served stale
 * indefinitely), and a sed pass rewrote the placeholders inside sw.js's own
 * comments.
 *
 * Every one of those ships a half-updated app to returning visitors: some
 * files fresh, some from the previous cache, producing bugs that do not
 * reproduce locally and cannot be diagnosed from the outside.
 *
 * Hashing content rather than incrementing a number also means a deploy that
 * changes nothing produces no cache invalidation, so returning users keep
 * their warm cache.
 *
 *   node scripts/version-assets.mjs          # rewrite in place
 *   node scripts/version-assets.mjs --check  # exit 1 if stale (for CI)
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const HTML = ['index.html', 'card.html', 'landing.html'];
const SW = 'sw.js';
const CHECK = process.argv.includes('--check');

const hash = (rel) => {
  const file = join(APP, rel);
  if (!existsSync(file)) throw new Error(`referenced asset does not exist: ${rel}`);
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);
};

/* Matches src="js/x.js?v=abc" and href="css/x.css?v=abc", with or without an
   existing marker, and captures the path so we can hash the real file. */
const ASSET_RE = /(["'])((?:js|css)\/[A-Za-z0-9._-]+\.(?:js|css))(\?v=[A-Za-z0-9]+)?\1/g;

const changed = [];
const rewriteAssets = (text) =>
  text.replace(ASSET_RE, (_m, q, path) => `${q}${path}?v=${hash(path)}${q}`);

// 1. HTML
for (const name of HTML) {
  const file = join(APP, name);
  const before = readFileSync(file, 'utf8');
  const after = rewriteAssets(before);
  if (after !== before) { changed.push(name); if (!CHECK) writeFileSync(file, after); }
}

// 2. Service worker SHELL entries — must request the same URLs the pages do,
//    or the precache stores copies nothing ever asks for. Scoped to the SHELL
//    array so the ?v=N placeholders in the file's own comments are untouched.
const swFile = join(APP, SW);
let sw = readFileSync(swFile, 'utf8');
const swBefore = sw;
const shellMatch = sw.match(/const SHELL = \[[\s\S]*?\];/);
if (!shellMatch) throw new Error('could not find SHELL array in sw.js');
sw = sw.replace(shellMatch[0], rewriteAssets(shellMatch[0]));

// 3. CACHE_VERSION — derived from every shell file, so a change to any of
//    them retires the old cache. Computed after the SHELL rewrite so the
//    hashes themselves are part of the input.
const shellPaths = [...sw.match(/const SHELL = \[[\s\S]*?\];/)[0].matchAll(/'([^']+)'/g)]
  .map((m) => m[1].split('?')[0])
  .filter((p) => existsSync(join(APP, p)));
const cacheVersion =
  'nexus-shell-' +
  createHash('sha256').update(shellPaths.map(hash).join('|')).digest('hex').slice(0, 8);
sw = sw.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = '${cacheVersion}';`);

if (sw !== swBefore) { changed.push(SW); if (!CHECK) writeFileSync(swFile, sw); }

if (CHECK) {
  if (changed.length) {
    console.error('Asset versions are stale in: ' + changed.join(', '));
    console.error('Run: node scripts/version-assets.mjs');
    process.exit(1);
  }
  console.log('Asset versions are current.');
} else {
  console.log(changed.length ? `Updated: ${changed.join(', ')}` : 'Already current.');
  console.log(`CACHE_VERSION = ${cacheVersion}`);
}
