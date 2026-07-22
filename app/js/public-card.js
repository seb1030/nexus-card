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

async function load() {
  if (!slug) return renderNotFound();
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
  const rows = [];
  if (CARD.phone) rows.push('📞 ' + esc(CARD.phone));
  if (CARD.email) rows.push('✉️ ' + esc(CARD.email));
  root.innerHTML = `
    <p class="sub" style="text-align:center;margin-bottom:16px">🌐 ${esc(location.host)}/card.html?u=${esc(slug)}</p>
    <div class="biz-card">
      <div class="biz-logo" style="background:${esc(CARD.color || '#4f46e5')}">${esc(CARD.initials || 'NC')}</div>
      <div class="biz-name">${esc(CARD.name)}</div>
      <div class="biz-title">${esc(CARD.title)}${CARD.company ? ' @ ' + esc(CARD.company) : ''}</div>
      <div class="biz-links">${links}</div>
      <div class="biz-contact-rows">${rows.map(r => `<div>${r}</div>`).join('')}</div>
      <div class="biz-actions">
        <button class="btn" onclick="saveContact()">Save to Contacts</button>
        <button class="btn secondary" onclick="shareThisCard()">Share</button>
      </div>
    </div>
    <div id="shareback"></div>
    <p class="sub" style="text-align:center;margin-top:16px">No app download. No account. Just this card.</p>
    <p class="sub" style="text-align:center;margin-top:10px;font-size:12px">🔒 ${esc(firstName())} is notified when this card is viewed. No location is collected.</p>`;
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
  if (card.phone)   lines.push('TEL;type=CELL:' + vcardEscape(card.phone));
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
    fireAndForget(sb.rpc('record_card_view', { p_slug: slug }));
  } catch (err) {
    console.error(err);
    toast('Could not download the contact card');
  }
  showShareBack();
}

function shareThisCard() {
  if (navigator.share) {
    navigator.share({ title: CARD.name, url: location.href }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(location.href);
    toast('Link copied');
  }
}

function showShareBack() {
  document.getElementById('shareback').innerHTML = `
    <div class="card-box" style="margin-top:14px;text-align:left">
      <b>Share your info back with ${esc(firstName())}?</b>
      <p class="sub" style="margin:4px 0 10px">Optional — only what you type here is shared.</p>
      <label class="field"><span>Name</span><input type="text" id="sb-name" placeholder="Your name"></label>
      <label class="field"><span>Title & company</span><input type="text" id="sb-titleco" placeholder="VP Product @ Stripe"></label>
      <label class="field"><span>Email</span><input type="email" id="sb-email" placeholder="you@company.com"></label>
      <div class="row" style="gap:8px">
        <button class="btn" onclick="submitShareBack()">Share my info</button>
        <button class="btn secondary" onclick="dismissShareBack()">No thanks</button>
      </div>
    </div>`;
  document.getElementById('shareback').scrollIntoView({ behavior: 'smooth' });
}

function dismissShareBack() { document.getElementById('shareback').innerHTML = ''; }

async function submitShareBack() {
  const name = document.getElementById('sb-name').value.trim();
  if (!name) { toast('Enter at least a name'); return; }
  const tc = document.getElementById('sb-titleco').value.trim();
  const [title, company] = tc.includes('@') ? tc.split('@').map(s => s.trim()) : [tc, ''];
  const email = document.getElementById('sb-email').value.trim();
  const { error } = await sb.rpc('submit_share_back', {
    p_slug: slug, p_name: name, p_title: title || '', p_company: company || '', p_email: email, p_phone: ''
  });
  if (error) { toast('Could not send: ' + error.message); return; }
  document.getElementById('shareback').innerHTML = `
    <div class="card-box" style="margin-top:14px;text-align:center">
      <b>✓ Sent!</b>
      <p class="sub" style="margin-top:6px">${esc(firstName())} will see you as a new contact.</p>
    </div>`;
}

load().catch(renderError);
