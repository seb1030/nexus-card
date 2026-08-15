/* Public card page — the real thing a stranger sees after scanning a QR
   or opening a shared link. No auth, no app, no session at all: the read
   goes through the get_public_card RPC (slug-scoped, returns the card and
   its links in one call, phone/email only when the owner's toggle allows
   it); writes (view, click, share-back) go through the SECURITY DEFINER
   RPCs, so a visitor never gets table access. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

const slug = new URLSearchParams(location.search).get('u');
const root = document.getElementById('pubcard');
let CARD = null, LINKS = [];

/* Drawn before the first request so the page is never blank. A stranger who
   has just scanned a QR at a conference on venue wifi otherwise stares at a
   white rectangle and assumes the link is dead. */
function renderSkeleton() {
  root.innerHTML = `
    <div class="biz-card" aria-busy="true" aria-label="Loading card">
      <div class="sk sk-logo"></div>
      <div class="sk sk-line" style="width:52%"></div>
      <div class="sk sk-line" style="width:38%;height:11px"></div>
      <div style="margin-top:18px">
        <div class="sk sk-btn"></div>
        <div class="sk sk-btn" style="opacity:.75"></div>
        <div class="sk sk-btn" style="opacity:.5"></div>
      </div>
    </div>`;
}

async function load() {
  if (!slug) return renderNotFound();
  renderSkeleton();
  /* One slug-scoped call returns the card and its links together. A failed
     request must NOT render as "card not found" — a stranger on venue wifi
     being told the card doesn't exist is the worst possible first
     impression, and they will not retry. */
  const { data: card, error } = await sb.rpc('get_public_card', { p_slug: slug });
  if (error) return renderError(error);
  if (!card) return renderNotFound();
  CARD = card;
  LINKS = card.links || [];
  render();
  fireAndForget(sb.rpc('record_card_view', { p_slug: slug }));
}

/* supabase-js query builders are thenable but are NOT Promises — they have
   no .catch(), so calling it throws a TypeError. Wrapping gives a real
   Promise, so analytics failures stay silent instead of taking the page
   down with them. */
function fireAndForget(builder) {
  Promise.resolve(builder).catch((err) => console.warn('background call failed', err));
}

function firstName() { return (CARD?.name || '').split(' ')[0]; }

function render() {
  /* Link data is looked up by index at click time, never interpolated into
     the markup. Passing the URL through the attribute (previously via
     JSON.stringify, whose own quotes terminated the attribute) let a card
     owner inject arbitrary handlers that ran on every visitor's browser. */
  const links = LINKS.map((l, i) =>
    `<button class="biz-link" data-link-idx="${i}">${esc(l.label)}</button>`).join('');
  /* Inline stroke icons rather than emoji, matching Icon in card.js. This
     page cannot import that object (card.html deliberately loads only
     supabase-client.js and this file, so a stranger's page pulls nothing
     it doesn't need), so the two paths are duplicated -- they must be
     changed together. */
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const rows = [];
  const phoneIcon = svg('<path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5z"/>');
  // Label shown only when there are two numbers to distinguish, matching
  // the owner's preview in card.js.
  const twoPhones = !!(CARD.phone && CARD.phone_alt);
  /* Real anchors, so tapping a number dials it and tapping the address
     opens a compose window — on every platform, not just wherever the
     browser happened to guess. tel: takes digits only; the formatting in
     the display value is for reading, not for the dialler. */
  const telHref = (v) => "tel:" + encodeURI(String(v).replace(/[^\d+]/g, ""));
  const phoneRow = (value, label) =>
    `<a class="biz-row" href="${telHref(value)}"><span class="biz-row-ic">${phoneIcon}</span><span>${esc(value)}${
      twoPhones ? `<span class="biz-row-tag">${esc(label || '')}</span>` : ''}</span></a>`;
  if (CARD.phone) rows.push(phoneRow(CARD.phone, CARD.phone_label));
  if (CARD.phone_alt) rows.push(phoneRow(CARD.phone_alt, CARD.phone_alt_label));
  if (CARD.email) rows.push(`<a class="biz-row" href="mailto:${encodeURI(CARD.email)}"><span class="biz-row-ic">${svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7.5l8.5 6 8.5-6"/>')}</span><span>${esc(CARD.email)}</span></a>`);

  /* The card owner's colour drives the cover gradient and every tint on
     this page, exactly as it does in the app. Set on the root rather than
     inline on the logo so one property re-skins the whole card. */
  document.documentElement.style.setProperty('--brand', CARD.color || '#4f46e5');

  root.innerHTML = `
    <div class="biz-card">
      <!-- alt is empty on purpose: the name is the very next element, so
           announcing the photo as well would just repeat it. -->
      <div class="biz-logo${CARD.photo_url ? ' has-photo' : ''}">${CARD.photo_url
        ? `<img src="${esc(CARD.photo_url)}" alt="">`
        : esc(CARD.initials || 'NC')}</div>
      <div class="biz-name">${esc(CARD.name)}</div>
      <div class="biz-title">${esc(CARD.title)}${CARD.company ? ' @ ' + esc(CARD.company) : ''}</div>
      <div class="biz-links">${links}</div>
      <!-- Each row is already a complete .biz-row anchor, so it is joined
           straight in rather than wrapped again. -->
      <div class="biz-contact-rows">${rows.join('')}</div>
      <div class="biz-actions">
        <button class="btn" onclick="saveContact()">Save to Contacts</button>
        <button class="btn secondary" onclick="shareThisCard()">Share</button>
      </div>
    </div>
    <div id="shareback"></div>
    <p class="sub" style="text-align:center;margin-top:16px">No app download. No account. Just this card.</p>
    <p class="sub" style="text-align:center;margin-top:10px;font-size:12px">🔒 ${esc(firstName())} is notified when this card is viewed. No location is collected.</p>

    <!-- The acquisition loop. Without this the public card is a dead end:
         a recipient can view, tap links and share back, and is never once
         offered a card of their own. This is the only surface the product
         puts in front of strangers. -->
    <a class="get-own" href="index.html?ref=card">
      <span class="get-own-mark">▣</span>
      <span>
        <b>Get your own free card</b>
        <span class="sub">60 seconds, no app, no signup</span>
      </span>
      <span class="get-own-arrow">→</span>
    </a>`;

  /* Shown to everyone, not only to people who tapped "Save to Contacts".
     Previously the share-back form was reachable only through that button,
     so anyone who tapped a link or left without saving never saw the
     reverse-capture form at all -- and that form is the entire reason the
     owner learns who scanned their card. */
  showShareBack();
}

function renderNotFound() {
  root.innerHTML = `
    <div style="padding:80px 10px;text-align:center">
      <div style="font-size:34px;margin-bottom:10px">🔍</div>
      <h1 style="font-size:20px">Card not found</h1>
      <p class="sub" style="margin-top:8px">This link may be out of date, or the card was removed.</p>
    </div>`;
}

function renderError(err) {
  console.error('Could not load card', err);
  root.innerHTML = `
    <div style="padding:80px 10px;text-align:center">
      <div style="font-size:34px;margin-bottom:10px">⚠️</div>
      <h1 style="font-size:20px">Couldn't load this card</h1>
      <p class="sub" style="margin-top:8px">Check your connection and try again.</p>
      <button class="btn" style="margin-top:16px" onclick="location.reload()">Retry</button>
    </div>`;
}

/* Delegated so link data never has to survive HTML-attribute escaping. */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-link-idx]');
  if (!btn) return;
  linkClick(Number(btn.dataset.linkIdx));
});

function linkClick(i) {
  const l = LINKS[i];
  if (!l) return;
  fireAndForget(sb.rpc('record_link_click', { p_slug: slug, p_link_id: l.id }));
  /* Only ever follow http(s). A stored `javascript:` URL was previously
     inert only because these buttons never navigated at all. */
  if (/^https?:\/\//i.test(l.url)) {
    window.open(l.url, '_blank', 'noopener,noreferrer');
  } else {
    toast('This link is not a valid web address.');
  }
}

/* Downloads a real vCard. This is the recipient's actual job-to-be-done —
   it previously fired toast('✓ Saved to your contacts (demo)') and saved
   nothing, so the one action the whole page exists for was a lie. */
function vcardEscape(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function buildVCard(card) {
  const parts = String(card.name || '').trim().split(/\s+/);
  const last = parts.length > 1 ? parts.pop() : '';
  const first = parts.join(' ');
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:' + vcardEscape(last) + ';' + vcardEscape(first) + ';;;',
    'FN:' + vcardEscape(card.name),
  ];
  if (card.title)   lines.push('TITLE:' + vcardEscape(card.title));
  if (card.company) lines.push('ORG:' + vcardEscape(card.company));
  if (card.email)   lines.push('EMAIL;type=INTERNET;type=WORK:' + vcardEscape(card.email));
  /* Both numbers, each with the vCard TEL type its label maps to. Without
     the second line the number would show on the card but silently vanish
     the moment anyone saved it to their phone -- and landing in someone's
     contacts is the entire point of the product, so a number that only
     exists on screen is worse than not offering the field. */
  const TEL_TYPE = { Mobile: 'CELL', Work: 'WORK', Home: 'HOME' };
  if (card.phone) {
    lines.push('TEL;type=' + (TEL_TYPE[card.phone_label] || 'CELL') + ':' + vcardEscape(card.phone));
  }
  if (card.phone_alt) {
    lines.push('TEL;type=' + (TEL_TYPE[card.phone_alt_label] || 'WORK') + ':' + vcardEscape(card.phone_alt));
  }
  lines.push('URL:' + vcardEscape(location.href));
  (card.links || []).forEach(l => {
    if (/^https?:\/\//i.test(l.url || '')) lines.push('URL:' + vcardEscape(l.url));
  });
  lines.push('NOTE:' + vcardEscape('Saved from ' + card.name + "'s Nexus Card"));
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

function saveContact() {
  if (!CARD) return;
  try {
    const blob = new Blob([buildVCard(CARD)], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (CARD.slug || 'contact') + '.vcf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('✓ Contact card downloaded');
  } catch (err) {
    console.error(err);
    toast('Could not download the contact card');
  }
  // The form is already on the page; just draw attention to it.
  document.getElementById('shareback')?.scrollIntoView({ behavior: 'smooth' });
}

function shareThisCard() {
  if (navigator.share) {
    navigator.share({ title: CARD.name, url: location.href }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(location.href);
    toast('Link copied');
  }
}

function showShareBack(scroll) {
  const el = document.getElementById('shareback');
  if (!el || el.dataset.done === '1') return;
  el.innerHTML = `
    <div class="card-box" style="margin-top:14px;text-align:left">
      <b>Send ${esc(firstName())} your info back?</b>
      <p class="sub" style="margin:4px 0 10px">Takes 15 seconds. Optional.</p>
      <label class="field"><span>Name</span><input type="text" id="sb-name" maxlength="100" placeholder="Your name"></label>
      <label class="field"><span>Title &amp; company</span><input type="text" id="sb-titleco" maxlength="160" placeholder="VP Product @ Stripe"></label>
      <label class="field"><span>Email</span><input type="email" id="sb-email" maxlength="320" placeholder="you@company.com"></label>
      <div class="row" style="gap:8px">
        <button class="btn" id="sb-submit" onclick="submitShareBack(this)">Share my info</button>
        <button class="btn secondary" onclick="dismissShareBack()">No thanks</button>
      </div>
      <!-- The recipient is a third party whose data is about to land in a
           stranger's CRM. They need to be told that, and where to complain. -->
      <p class="sub" style="margin-top:10px;font-size:11px">
        Your details go to ${esc(CARD?.name || 'the card owner')} and are stored in their Nexus Card contacts.
        See our <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.
      </p>
    </div>`;
  if (scroll) el.scrollIntoView({ behavior: 'smooth' });
}

function dismissShareBack() {
  const el = document.getElementById('shareback');
  el.dataset.done = '1';
  el.innerHTML = '';
}

async function submitShareBack(btn) {
  const name = document.getElementById('sb-name').value.trim();
  if (!name) { toast('Enter at least a name'); return; }
  const tc = document.getElementById('sb-titleco').value.trim();
  const [title, company] = tc.includes('@') ? tc.split('@').map(s => s.trim()) : [tc, ''];
  const email = document.getElementById('sb-email').value.trim();

  // No in-flight guard meant a double-tap on a slow connection inserted the
  // same person into the owner's CRM twice.
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const { data, error } = await sb.rpc('submit_share_back', {
    p_slug: slug, p_name: name, p_title: title || '', p_company: company || '', p_email: email, p_phone: ''
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Share my info'; }

  if (error) { toast('Could not send: ' + error.message); return; }
  // The RPC returns void on the old schema and boolean on the new one. A
  // silent `return` inside it (stale slug, deleted card) previously showed
  // the visitor "Sent!" when nothing had been written.
  if (data === false) { toast('This card is no longer available.'); return; }

  const el = document.getElementById('shareback');
  el.dataset.done = '1';
  el.innerHTML = `
    <div class="card-box" style="margin-top:14px;text-align:center">
      <b>✓ Sent!</b>
      <p class="sub" style="margin-top:6px">${esc(firstName())} will see you as a new contact.</p>
    </div>`;
}

load().catch(renderError);
