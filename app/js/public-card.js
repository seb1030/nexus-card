/* Public card page — the real thing a stranger sees after scanning a QR
   or opening a shared link. No auth, no app, no session at all: reads go
   through the public_cards view (a safe subset -- phone/email only when
   the owner's toggle allows it) and card_links (public-read policy);
   writes (view, click, share-back) only ever go through the three
   SECURITY DEFINER RPCs, so a visitor never gets table access. */
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
  const { data: card } = await sb.from('public_cards').select('*').eq('slug', slug).maybeSingle();
  if (!card) return renderNotFound();
  CARD = card;
  const { data: links } = await sb.from('card_links').select('*').eq('card_id', card.id).order('position');
  LINKS = links || [];
  render();
  sb.rpc('record_card_view', { p_slug: slug }).catch(() => {});
}

function firstName() { return (CARD?.name || '').split(' ')[0]; }

function render() {
  const links = LINKS.map(l =>
    `<button class="biz-link" onclick="linkClick('${l.id}', ${JSON.stringify(l.url)}, ${JSON.stringify(l.type)})">${esc(l.label)}</button>`).join('');
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
    <p class="sub" style="text-align:center;margin-top:10px;font-size:12px">🔒 ${esc(firstName())} is notified when this card is viewed (city-level location only, never precise).</p>`;
}

function renderNotFound() {
  root.innerHTML = `
    <div style="padding:80px 10px;text-align:center">
      <div style="font-size:34px;margin-bottom:10px">🔍</div>
      <h1 style="font-size:20px">Card not found</h1>
      <p class="sub" style="margin-top:8px">This link may be out of date, or the card was removed.</p>
    </div>`;
}

function linkClick(id, url, type) {
  toast('Opening ' + url + '…');
  if (type === 'Calendly') setTimeout(() => toast('🔥 High intent noted'), 600);
  sb.rpc('record_link_click', { p_slug: slug, p_link_id: id }).catch(() => {});
}

function saveContact() {
  toast('✓ Saved to your contacts (demo)');
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

load();
