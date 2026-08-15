/* Inline stroke icons, replacing the emoji this UI used to render (📞 ✉️
   ▦ 🔗 ⬇ 🗑). Emoji are a different glyph on every platform, sit on their
   own baseline, ignore the surrounding colour, and several rendered as
   tofu on Android and Windows -- the same reason the tab bar dropped its
   glyphs for SVG. Same drawing conventions as those: 24 viewBox, 1.75
   stroke, round caps, currentColor. */
const Icon = {
  _(d) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`; },
  phone() { return this._('<path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5z"/>'); },
  mail() { return this._('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7.5l8.5 6 8.5-6"/>'); },
  qr() { return this._('<rect x="3.5" y="3.5" width="6" height="6" rx="1.2"/><rect x="14.5" y="3.5" width="6" height="6" rx="1.2"/><rect x="3.5" y="14.5" width="6" height="6" rx="1.2"/><path d="M14.5 14.5h3v3M20.5 17.5v3h-3"/>'); },
  link() { return this._('<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.4 1.4"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.4-1.4"/>'); },
  download() { return this._('<path d="M12 3.5v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>'); },
  trash() { return this._('<path d="M4.5 6.5h15"/><path d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="M6.5 6.5l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/>'); },
  home() { return this._('<path d="M4 10.5L12 4l8 6.5"/><path d="M6 9.5V19a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V9.5"/><path d="M10 20.5v-5h4v5"/>'); },
  /* Activity-feed set. Used by analytics.js, which loads after this file,
     so the lookup resolves at render time rather than at parse time. */
  eye() { return this._('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.75"/>'); },
  save() { return this._('<path d="M6 4.5h12a1 1 0 0 1 1 1v14l-7-4-7 4v-14a1 1 0 0 1 1-1z"/>'); },
  share() { return this._('<path d="M12 3.5v12"/><path d="M8 7.5L12 3.5l4 4"/><path d="M5 14v5.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V14"/>'); },
  check() { return this._('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>'); },
};

/* My Card tab — preview, edit, share (QR/link), recipient simulation */
const CardView = {
  render() {
    const me = Store.state.me;
    document.documentElement.style.setProperty('--brand', me.color);
    return `
      <div class="row" style="margin-bottom:14px">
        <div><h1>My Card</h1><p class="sub">Live and ready to share</p></div>
        <span class="spacer"></span>
        <button class="btn small secondary" onclick="CardView.editSheet()">Edit</button>
      </div>

      ${this.bizCard(me, false)}

      <div class="row" style="gap:8px;margin-top:14px">
        <button class="btn" onclick="CardView.shareSheet()">Share</button>
        <button class="btn secondary" onclick="CardView.simulateScan()">Simulate a scan</button>
      </div>
      <p class="sub" style="margin-top:10px;text-align:center">“Simulate a scan” shows what happens when someone scans your QR.</p>

      <p class="section-label">Sharing options</p>
      <div class="share-opt"><div class="feed-ic">${Icon.qr()}</div><div style="flex:1"><b>QR code</b><div class="sub">Works offline — static QR</div></div><button class="btn small secondary" onclick="CardView.shareSheet()">Show</button></div>
      <!-- The full URL was printed here in full. It is a long random slug,
           so it wrapped to three lines, pushed the row out of shape and
           told the user nothing they could act on -- the Copy button is
           the actual affordance. -->
      <div class="share-opt"><div class="feed-ic">${Icon.link()}</div><div style="flex:1"><b>Card link</b><div class="sub">Copy and send it anywhere</div></div><button class="btn small secondary" onclick="CardView.copyLink()">Copy</button></div>
      <p class="section-label">Your data</p>
      <div class="share-opt"><div class="feed-ic">${Icon.download()}</div><div style="flex:1"><b>Download your data</b><div class="sub">Everything we hold, as JSON</div></div><button class="btn small secondary" onclick="Account.exportData(this)">Export</button></div>
      <div class="share-opt"><div class="feed-ic danger">${Icon.trash()}</div><div style="flex:1"><b>Delete your account</b><div class="sub">Permanent — card, contacts and reminders</div></div><button class="btn small secondary" onclick="Account.confirmDelete()">Delete</button></div>
      ${Store.planFooter()}`;
  },

  bizCard(me, isRecipient) {
    const links = me.links.map(l =>
      `<button class="biz-link" onclick="CardView.linkClick('${l.id}', ${isRecipient})">${esc(l.label)}</button>`).join('');
    /* Kept in lockstep with the same block in public-card.js: the owner's
       preview and the card a stranger actually opens must render
       identically, or the preview stops being a preview. */
    const rows = [];
    /* The label only appears when there are actually two numbers to tell
       apart. Someone with a single number does not need it captioned
       "Mobile" — that is the app explaining its own data model. */
    const twoPhones = !!(me.fields.phone && me.phone && me.fields.phoneAlt && me.phoneAlt);
    const phoneRow = (value, label) =>
      `<span class="biz-row-ic">${Icon.phone()}</span><span>${esc(value)}${
        twoPhones ? `<span class="biz-row-tag">${esc(label)}</span>` : ''}</span>`;
    if (me.fields.phone && me.phone) rows.push(phoneRow(me.phone, me.phoneLabel));
    if (me.fields.phoneAlt && me.phoneAlt) rows.push(phoneRow(me.phoneAlt, me.phoneAltLabel));
    if (me.fields.email && me.email) rows.push(`<span class="biz-row-ic">${Icon.mail()}</span><span>${esc(me.email)}</span>`);
    return `
      <div class="biz-card">
        <!-- No inline background: the monogram is a white tile with the
             brand colour as its text, sitting on the gradient cover. The
             colour reaches it through --brand on the root, which
             CardView.render already sets from me.color.
             With a photo the same element becomes the frame for it, so the
             ring, size and position carry over untouched. -->
        <div class="biz-logo${me.photoUrl ? ' has-photo' : ''}">${me.photoUrl
          ? `<img src="${esc(me.photoUrl)}" alt="">`
          : esc(me.initials || 'NC')}</div>
        <div class="biz-name">${esc(me.name)}</div>
        <div class="biz-title">${esc(me.title)}${me.company ? ' @ ' + esc(me.company) : ''}</div>
        <div class="biz-links">${links}</div>
        <div class="biz-contact-rows">${rows.map(r => `<div class="biz-row">${r}</div>`).join('')}</div>
        ${isRecipient ? `
          <div class="biz-actions">
            <button class="btn" onclick="Recipient.saveContact()">Save to Contacts</button>
            <button class="btn secondary" onclick="CardView.copyLink()">Share</button>
          </div>` : ''}
      </div>`;
  },

  linkClick(id, isRecipient) {
    const l = Store.state.me.links.find(x => x.id === id);
    if (!l) return;
    if (isRecipient) {
      if (/^https?:\/\//i.test(l.url || '')) window.open(l.url, '_blank', 'noopener,noreferrer');
      else toast('This link is not a valid web address.');
      Store.recordLinkClick(id).then(() => { if (App.tab === 'analytics') App.renderTab(); }).catch(() => {});
    } else {
      toast(l.url);
    }
  },

  copyLink() {
    navigator.clipboard?.writeText(Store.cardUrl());
    Store.logShare('You shared your card (link)').catch(() => {});
    toast('✓ Link copied');
  },

  /* Native OS share sheet (iMessage, WhatsApp, AirDrop, ...). Only offered
     when the browser actually implements it -- navigator.share is absent on
     most desktop browsers and throws on non-HTTPS origins, so the QR and
     copy-link paths stay the baseline rather than the fallback. */
  canNativeShare() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  },

  async nativeShare() {
    const url = Store.cardUrl();
    try {
      // The text names the no-download promise, because that is the thing
      // recipients trained on Popl/HiHello do not expect.
      await navigator.share({
        title: 'My digital business card',
        text: 'Here’s my card — tap to save my details. No app download needed.',
        url,
      });
    } catch (err) {
      // AbortError just means the user dismissed the OS sheet: not a
      // failure, and toasting it would be noise on an intentional action.
      if (err && err.name === 'AbortError') return;
      toast('Could not open share — link copied instead');
      navigator.clipboard?.writeText(url);
      return;
    }
    closeSheet();
    Store.logShare('You shared your card (link)').catch(() => {});
    toast('✓ Shared');
  },

  /* ---- share sheet with QR ---- */
  shareSheet() {
    const qr = qrcode(0, 'M');
    qr.addData(Store.cardUrl());
    qr.make();
    openSheet(`
      <h2 style="text-align:center">Scan to get my card</h2>
      <div class="qr-wrap">${qr.createSvgTag({ cellSize: 5, margin: 2 })}</div>
      <p class="sub" style="text-align:center;margin-bottom:14px">${esc(Store.cardUrl())}<br>They scan with their camera — <b>no app download needed</b>.</p>
      ${this.canNativeShare()
        ? `<button class="btn" onclick="CardView.nativeShare()">Send it to someone →</button>
           <button class="btn secondary" onclick="closeSheet();CardView.copyLink()">Copy link</button>`
        : `<button class="btn" onclick="closeSheet();CardView.copyLink()">Copy link instead</button>`}
      <button class="btn ghost" onclick="closeSheet();CardView.simulateScan()">Simulate their scan →</button>`);
    Store.logShare('You shared your card (QR)').catch(() => {});
  },

  /* ---- edit sheet ---- */
  /* The sheet used to expose name, title, company and colour only, and
     store.updateCardFields had no phone/email branch to save them with even
     if it had. So the two fields the card exists to hand over — the phone
     number on the public card, the email in every downloaded vCard — were
     write-once at onboarding: a typo'd address was permanent unless the user
     deleted their whole account and started again. Links were the same, with
     no add or remove anywhere in the app at all.

     `draft` carries the values currently typed into the sheet across a
     re-render. Adding or removing a link rebuilds this markup, and without
     it every uncommitted edit above the Links section would silently revert
     to the last saved value. */
  editSheet(draft) {
    const me = Store.state.me;
    const d = Object.assign({
      name: me.name, title: me.title, company: me.company,
      phone: me.phone, email: me.email,
      phoneAlt: me.phoneAlt, phoneLabel: me.phoneLabel, phoneAltLabel: me.phoneAltLabel,
      showPhone: me.fields.phone, showEmail: me.fields.email
    }, draft || {});
    /* Index, not the id string. esc() emits HTML entities, and the HTML
       parser decodes them BEFORE the JS parser sees the attribute — so an id
       containing a quote would break out of an interpolated onclick even
       though it looks escaped. Server-generated UUIDs make that unreachable
       today, but public-card.js was explicitly rewritten to stop doing this
       (data-link-idx), and matching that is cheaper than relying on the id
       format never changing. A number cannot break out. */
    const linkRow = (l, i) => `
      <div class="row" style="margin-bottom:8px">
        <span class="pill brand">${esc(l.label)}</span>
        <span class="sub" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.url)}</span>
        <button class="btn danger small" onclick="CardView.removeLink(${i})">✕</button>
      </div>`;
    openSheet(`
      <h2>Edit card</h2>
      <div style="margin-top:12px">
        <!-- Photo first: it is the thing people look at, and burying it
             under the text fields would imply it is an afterthought.
             The file input is visually hidden but still a real focusable
             input inside its label, so keyboard and screen-reader users
             reach it exactly as they would any other control. -->
        <div class="photo-edit">
          <div class="biz-logo${me.photoUrl ? ' has-photo' : ''}" style="margin:0;box-shadow:0 0 0 3px var(--paper),0 6px 16px -6px rgba(12,18,34,.3)">${me.photoUrl
            ? `<img src="${esc(me.photoUrl)}" alt="">`
            : esc(me.initials || 'NC')}</div>
          <div style="flex:1">
            <b style="font-size:14.5px">${me.photoUrl ? 'Your photo' : 'Add a photo'}</b>
            <div class="sub" style="font-size:12.5px">${me.photoUrl
              ? 'Shown on your card instead of your initials.'
              : 'A face is easier to remember than initials.'}</div>
            <div class="row" style="gap:6px;margin-top:8px">
              <label class="btn small secondary" style="margin:0">
                ${me.photoUrl ? 'Replace' : 'Choose photo'}
                <input type="file" accept="image/*" class="visually-hidden" onchange="CardView.pickPhoto(this)">
              </label>
              ${me.photoUrl ? `<button class="btn small danger" style="width:auto" onclick="CardView.dropPhoto()">Remove</button>` : ''}
            </div>
          </div>
        </div>
        <label class="field"><span>Name</span><input type="text" id="ed-name" value="${esc(d.name)}"></label>
        <label class="field"><span>Title</span><input type="text" id="ed-title" value="${esc(d.title)}"></label>
        <label class="field"><span>Company</span><input type="text" id="ed-company" value="${esc(d.company)}"></label>
        <!-- Two numbers, because one assumed one working life: a company
             handset plus a personal one, or business run entirely from a
             personal mobile. The label is user-chosen rather than fixed to
             Work/Personal precisely because for many people the personal
             number IS the work number, and publishing it as "Personal"
             would be wrong. -->
        <div class="field-pair">
          <label class="field" style="flex:1"><span>Phone</span><input type="tel" id="ed-phone" autocomplete="tel" maxlength="40" value="${esc(d.phone)}" placeholder="+1 (415) 555-0100"></label>
          <label class="field field-tag"><span>Label</span>${this.labelSelect('ed-phone-label', d.phoneLabel)}</label>
        </div>
        <div class="field-pair">
          <!-- "optional" lives in the placeholder, not the label: as label
               text it wrapped to a second line, which pushed this input out
               of alignment with the one above it. -->
          <label class="field" style="flex:1"><span>Second phone</span><input type="tel" id="ed-phone-alt" autocomplete="tel" maxlength="40" value="${esc(d.phoneAlt)}" placeholder="Optional"></label>
          <label class="field field-tag"><span>Label</span>${this.labelSelect('ed-phone-alt-label', d.phoneAltLabel)}</label>
        </div>
        <label class="field"><span>Email</span><input type="email" id="ed-email" autocomplete="email" maxlength="320" value="${esc(d.email)}" placeholder="you@company.com"></label>
        <div class="row card-box"><span style="flex:1">Show phone</span>
          <label class="switch"><input type="checkbox" id="ed-show-phone" ${d.showPhone ? 'checked' : ''}><i></i></label></div>
        <div class="row card-box"><span style="flex:1">Show email</span>
          <label class="switch"><input type="checkbox" id="ed-show-email" ${d.showEmail ? 'checked' : ''}><i></i></label></div>
        <p class="section-label">Links</p>
        ${me.links.map(linkRow).join('') || '<p class="sub" style="margin-bottom:8px">No links yet.</p>'}
        <div class="row" style="margin-bottom:8px">
          <select id="ed-link-type" style="width:130px">
            <option>Calendly</option><option>Portfolio</option><option>LinkedIn</option><option>Custom</option>
          </select>
          <input type="url" id="ed-link-url" placeholder="https://…">
          <button class="btn small" onclick="CardView.addLink()">Add</button>
        </div>
        <p class="sub" style="margin-bottom:8px;font-size:12px">Links save immediately. Everything above saves when you press Save.</p>
        <p class="section-label">Brand color</p>
        <div class="swatches">${['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#111114'].map(c =>
          `<button type="button" class="swatch ${me.color === c ? 'on' : ''}" style="background:${c}" aria-label="Brand colour ${c}" aria-pressed="${me.color === c}" onclick="CardView.saveColor('${c}')"></button>`).join('')}</div>
        <button class="btn" onclick="CardView.saveEdit()">Save</button>
      </div>`);
  },

  /* The three labels map 1:1 onto vCard TEL types (CELL / WORK / HOME), so
     a number saved to someone's phone lands under the right heading. Kept
     deliberately short — a longer list would need a mapping decision for
     each new entry and gives the user more to think about than the choice
     is worth. */
  PHONE_LABELS: ['Mobile', 'Work', 'Home'],
  labelSelect(id, selected) {
    return `<select id="${id}">${this.PHONE_LABELS.map(l =>
      `<option${l === selected ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  },

  /* Whatever is typed in the sheet right now, so a re-render can restore it.
     Each field is read defensively — the sheet may already be closed by the
     time an async handler gets here. */
  readEdit() {
    const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : null; };
    const c = id => { const el = document.getElementById(id); return el ? el.checked : null; };
    const d = {};
    ['name', 'title', 'company', 'phone', 'email'].forEach(k => {
      const val = v('ed-' + k);
      if (val !== null) d[k] = val;
    });
    // Hyphenated ids, so they cannot come from the camelCase loop above.
    const alt = v('ed-phone-alt'); if (alt !== null) d.phoneAlt = alt;
    const pl = v('ed-phone-label'); if (pl !== null) d.phoneLabel = pl;
    const pal = v('ed-phone-alt-label'); if (pal !== null) d.phoneAltLabel = pal;
    const sp = c('ed-show-phone'); if (sp !== null) d.showPhone = sp;
    const se = c('ed-show-email'); if (se !== null) d.showEmail = se;
    return d;
  },

  async addLink() {
    const type = document.getElementById('ed-link-type').value;
    const url = document.getElementById('ed-link-url').value.trim();
    if (!url) { toast('Paste the link’s URL first — it goes on your public card.'); return; }
    /* http(s) only. public-card.js refuses to open anything else, so any
       other scheme ships a button that does nothing on the one page that
       matters — and a stored javascript: URL is only inert for as long as
       that check stays in place. */
    if (!/^https?:\/\//i.test(url)) { toast('Links must start with http:// or https://'); return; }
    const label = { Calendly: 'Book a call', Portfolio: 'View portfolio', LinkedIn: 'LinkedIn', Custom: 'Website' }[type];
    const draft = this.readEdit();
    await guard(async () => {
      await Store.addLink({ label, url, type });
      this.editSheet(draft);
      App.renderTab();
      toast('✓ Link added');
    }, 'Could not add the link');
  },

  /* Photo picking. readEdit() first, for the same reason addLink does it:
     these re-render the sheet, and anything typed above and not yet saved
     would otherwise revert to the last saved value. */
  async pickPhoto(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    // Cleared immediately so choosing the same file twice still fires a
    // change event — otherwise a failed upload cannot be retried with the
    // same photo.
    input.value = '';
    const draft = this.readEdit();
    toast('Adding your photo…');
    await guard(async () => {
      await Store.uploadPhoto(file);
      this.editSheet(draft);
      App.renderTab();
      toast('✓ Photo added');
    }, 'Could not add that photo');
  },

  async dropPhoto() {
    const draft = this.readEdit();
    await guard(async () => {
      await Store.removePhoto();
      this.editSheet(draft);
      App.renderTab();
      toast('Photo removed — your initials are back');
    }, 'Could not remove the photo');
  },

  async removeLink(i) {
    const link = Store.state.me.links[i];
    if (!link) return;
    const draft = this.readEdit();
    await guard(async () => {
      await Store.removeLink(link.id);
      this.editSheet(draft);
      App.renderTab();
      toast('✓ Link removed');
    }, 'Could not remove the link');
  },

  async saveColor(c) {
    const draft = this.readEdit();
    await Store.updateCardFields({ color: c });
    // Same reason as addLink: re-opening the sheet used to discard anything
    // the user had already typed but not yet saved.
    this.editSheet(draft); App.renderTab();
  },

  async saveEdit() {
    const me = Store.state.me;
    const d = this.readEdit();
    const name = d.name || me.name;
    /* An address that cannot receive mail is worse than no address: it is
       shown on the public card and written into the vCard every visitor
       downloads, so the mistake propagates into other people's address books
       where it can never be corrected. Blank stays allowed — that is the
       user choosing not to publish one. */
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) {
      toast('That email address doesn’t look right — check it before saving.');
      return;
    }
    try {
      await Store.updateCardFields({
        name, title: d.title, company: d.company,
        phone: d.phone, email: d.email,
        phoneAlt: d.phoneAlt, phoneLabel: d.phoneLabel, phoneAltLabel: d.phoneAltLabel,
        showPhone: d.showPhone, showEmail: d.showEmail
      });
    } catch (err) {
      toast('Could not save: ' + err.message);
      return;
    }
    closeSheet(); App.renderTab(); toast('✓ Card updated');
  },

  /* ---- simulate someone scanning your QR ---- */
  simulateScan() { Recipient.open(); }
};

/* Recipient web view — what the OTHER person sees. No app download.
   Includes the share-back form (the reverse-capture funnel) and a
   plain-language tracking disclosure. */
const Recipient = {
  open() {
    const el = document.getElementById('recipient');
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="recip-top">🌐 ${esc(Store.cardUrl().replace(/^https?:\/\//, ''))} — opened in their browser</div>
      ${CardView.bizCard(Store.state.me, true)}
      <div id="shareback"></div>
      <p class="sub" style="text-align:center;margin-top:16px">No app download. No account. Just your card.</p>
      <p class="sub" style="text-align:center;margin-top:10px;font-size:12px">🔒 ${esc(Store.state.me.name.split(' ')[0])} is notified when this card is viewed. No location is collected.</p>
      <button class="btn ghost" style="margin-top:10px" onclick="Recipient.close()">← Back to your app</button>`;
    Store.recordCardView()
      .then(() => toast('👀 Your card was just viewed'))
      .catch(err => console.warn('view not recorded', err));
  },

  saveContact() {
    toast('✓ Saved to their contacts');
    this.showShareBack();
  },

  /* Reverse capture — without this, the exchange is one-way and the
     sharer never learns who scanned. This form is the lead-gen loop. */
  showShareBack() {
    const first = esc(Store.state.me.name.split(' ')[0]);
    document.getElementById('shareback').innerHTML = `
      <div class="card-box" style="margin-top:14px;text-align:left">
        <b>Share your info back with ${first}?</b>
        <p class="sub" style="margin:4px 0 10px">Optional — only what you type here is shared.</p>
        <label class="field"><span>Name</span><input type="text" id="sb-name" placeholder="Your name"></label>
        <label class="field"><span>Title & company</span><input type="text" id="sb-titleco" placeholder="VP Product @ Stripe"></label>
        <label class="field"><span>Email</span><input type="email" id="sb-email" placeholder="you@company.com"></label>
        <div class="row" style="gap:8px">
          <button class="btn" onclick="Recipient.submitShareBack()">Share my info</button>
          <button class="btn secondary" onclick="Recipient.close()">No thanks</button>
        </div>
        <button class="btn ghost small" style="margin-top:6px" onclick="Recipient.demoFill()">Demo-fill this form</button>
      </div>`;
    document.getElementById('shareback').scrollIntoView({ behavior: 'smooth' });
  },

  demoFill() {
    const pool = [
      ['Dana Kim', 'Account Exec @ HubSpot', 'dana.kim@hubspot.com'],
      ['Leo Martins', 'CTO @ Vercel', 'leo@vercel.com'],
      ['Ava Torres', 'Realtor @ Redfin', 'ava.torres@redfin.com'],
    ];
    const [n, tc, e] = pool[Math.floor(Math.random() * pool.length)];
    document.getElementById('sb-name').value = n;
    document.getElementById('sb-titleco').value = tc;
    document.getElementById('sb-email').value = e;
  },

  async submitShareBack() {
    const name = document.getElementById('sb-name').value.trim();
    if (!name) { toast('They need at least a name'); return; }
    const tc = document.getElementById('sb-titleco').value.trim();
    const [title, company] = tc.includes('@') ? tc.split('@').map(s => s.trim()) : [tc, ''];
    let ct;
    try {
      ct = await Store.addContactFromShareBack({ name, title, company, email: document.getElementById('sb-email').value.trim() });
    } catch (err) {
      toast('Could not save: ' + err.message);
      return;
    }
    document.getElementById('recipient').classList.add('hidden');
    App.renderTab();
    PostExchange.open(ct);
  },

  close() {
    document.getElementById('recipient').classList.add('hidden');
    toast('They kept your card but didn’t share back — that’s the normal case');
  }
};

/* Post-exchange sheet — the "secret weapon" moment */
const PostExchange = {
  open(ct) {
    openSheet(`
      <h2>New contact saved</h2>
      <div class="card-box" style="margin-top:12px">
        <div class="row">
          <div class="avatar">${esc(ct.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2))}</div>
          <div><div class="c-name">${esc(ct.name)}</div>
          <div class="c-meta">${esc(ct.title)} @ ${esc(ct.company)}</div>
          <div class="c-meta">${ct.metAt ? '📍 Met at: ' + esc(ct.metAt) + ' · ' : ''}just now</div></div>
        </div>
      </div>
      <p class="section-label">Where did you meet?</p>
      <div class="row" style="margin-bottom:10px">
        <input type="text" id="pe-metat" placeholder="e.g. SaaStr Annual">
        <button class="btn small" onclick="PostExchange.setMetAt('${ct.id}')">Tag</button>
      </div>
      <p class="section-label">Follow-up suggestions</p>
      <div class="chips" style="padding-top:2px">
        <button type="button" class="pill clickable" onclick="PostExchange.remind('${ct.id}','Send LinkedIn connection request',3)">Send LinkedIn request</button>
        <button type="button" class="pill clickable" onclick="PostExchange.remind('${ct.id}','Schedule coffee chat',7)">Schedule coffee chat</button>
        <button type="button" class="pill clickable" onclick="PostExchange.remind('${ct.id}','Send portfolio link',3)">Send portfolio link</button>
      </div>
      <div class="row" style="gap:8px;margin-top:14px">
        <button class="btn secondary" onclick="PostExchange.remind('${ct.id}','Follow up',3)">Remind me in 3 days</button>
        <button class="btn secondary" onclick="PostExchange.remind('${ct.id}','Follow up',7)">In 1 week</button>
      </div>
      <button class="btn" style="margin-top:8px" onclick="closeSheet();App.go('contacts');Contacts.detail('${ct.id}')">Open contact</button>`);
  },
  async setMetAt(id) {
    const v = document.getElementById('pe-metat').value.trim();
    if (!v) return;
    await guard(async () => {
      await Store.setContactMetAt(id, v);
      toast('📍 Tagged: met at ' + v);
    }, 'Could not save where you met');
  },
  async remind(id, text, days) {
    await guard(async () => {
      await Store.addReminder(id, text, Date.now() + days * DAY);
      closeSheet();
      toast('⏰ Reminder set: "' + text + '"');
      App.refreshBadge();
    }, 'Could not set reminder');
  }
};

/* Plans sheet — corrected ladder: reminders are never gated; Pro sells
   notifications/pipeline/domain; Team sits ABOVE Pro per-seat. */
const Paywall = {
  open() {
    const tier = (name, price, feats, cta) => `
      <div class="upgrade-box" style="margin-top:10px">
        <div class="row"><b>${name}</b><span class="spacer"></span><span class="pill brand">${price}</span></div>
        <div class="sub" style="margin-top:6px">${feats.map(f => '✓ ' + f).join('<br>')}</div>
        ${cta || ''}
      </div>`;
    openSheet(`
      <h2>Plans</h2>
      <p class="sub" style="margin:6px 0 4px">Follow-up reminders are unlimited on every plan — that's the whole point of Nexus.</p>
      ${tier('Free', '$0', ['Full card design + QR & link sharing', 'Unlimited shares & contact notes', '<b>Unlimited follow-up reminders</b>', 'Basic analytics (views, saves)'])}
      ${tier('Pro', Store.isPro() ? '$6/mo · $49/yr' : '$6/mo', ['Everything in Free', 'Live activity feed — see every card view and tap', 'Pipeline management'],
        Store.isPro() ? '' : `
          <div class="row" style="gap:8px;margin-top:10px">
            <button class="btn small" onclick="Paywall.checkout('pro_monthly')">Monthly — $6</button>
            <button class="btn small secondary" onclick="Paywall.checkout('pro_yearly')">Yearly — $49</button>
          </div>`)}
      ${/* Team is not for sale: there is no team UI, and sync_profile_plan
            grants nothing for owner_type='team'. Selling it would take money
            for a tier that delivers exactly Pro. Restore the checkout button
            when the feature actually exists. */''}
      ${tier('Team', 'Coming soon', ['Everything in Pro', 'Shared team contact pool', 'Admin visibility across the team'], `
          <p class="sub" style="margin-top:10px;font-size:12px">Not available yet — we'll announce it when it ships.</p>`)}
      <p class="sub" style="text-align:center;font-size:12px;margin-top:12px">Checkout is powered by Stripe. Subscriptions are governed by our <a href="terms.html" target="_blank">Terms</a> and <a href="privacy.html" target="_blank">Privacy Policy</a>.</p>
      <button class="btn ghost" onclick="closeSheet()">Close</button>`);
  },

  /* Real Stripe Checkout.
     Stripe collects an email at Checkout, but that is a *billing* email —
     it is never written back to the Supabase account, so the user stays
     anonymous. An anonymous account lives only in this browser's
     localStorage, so a customer who clears data (or hits iOS Safari's
     7-day ITP purge) loses a plan they are still being charged for, and we
     have no email on file to identify or refund them. Identity therefore
     has to exist before money does. create-checkout-session enforces the
     same rule server-side; this gate exists so the user gets a path
     forward instead of a rejection. */
  async checkout(tier, seats) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { toast('Not signed in — reload and try again'); return; }

    if (session.user?.is_anonymous || !Store.state.accountSecured) {
      Paywall.stashPending(tier, seats);
      Account.promptSecure(
        'Add an email before subscribing. Your account currently exists only in this browser — ' +
        'without an email, clearing it would lose the plan you paid for, with no way to recover it.'
      );
      return;
    }

    openSheet(`<h2>Redirecting to checkout…</h2><p class="sub" style="margin-top:8px">Powered by Stripe.</p>`);
    try {
      const res = await fetch(SUPABASE_URL + '/functions/v1/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
        body: JSON.stringify({ tier, seats, origin: location.origin })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Checkout could not start');
      location.href = data.url;
    } catch (err) {
      toast('Checkout failed: ' + err.message);
      closeSheet();
    }
  },

  /* The email-linking detour leaves the app entirely (confirmation link),
     so the upgrade intent has to survive a full page load. sessionStorage
     rather than memory, and it is cleared as soon as it is consumed. */
  PENDING_KEY: 'nexus_pending_upgrade',

  stashPending(tier, seats) {
    try { sessionStorage.setItem(this.PENDING_KEY, JSON.stringify({ tier, seats })); } catch (e) { /* private mode */ }
  },

  takePending() {
    try {
      const raw = sessionStorage.getItem(this.PENDING_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(this.PENDING_KEY);
      return JSON.parse(raw);
    } catch (e) { return null; }
  },

  /* Called after the account-linking email is confirmed. */
  resumePending() {
    const pending = this.takePending();
    if (!pending || !Store.state.accountSecured) return;
    openSheet(`
      <h2>Account secured 🔐</h2>
      <p class="sub" style="margin:8px 0 14px">You can now recover this account on any device. Ready to finish upgrading?</p>
      <button class="btn" onclick="Paywall.checkout('${esc(pending.tier)}', ${Number(pending.seats) || 'undefined'})">Continue to checkout</button>
      <button class="btn ghost" onclick="closeSheet()">Not now</button>`);
  }
};

/* Account linking — turns the silent anonymous session into a real,
   recoverable identity via Supabase's native anonymous-to-permanent
   upgrade (updateUser + email confirmation link, no password). Without
   this, a paying customer who clears browser data or switches devices
   loses access to their subscription with no way back in. */
const Account = {
  promptSecure(reason) {
    const suggested = Store.state.me.accountEmail || Store.state.me.email || '';
    openSheet(`
      <h2>Secure your account</h2>
      <p class="sub" style="margin:8px 0 14px">${reason || 'Add an email so you can recover your account on a new device or browser.'} No password — we email you a link.</p>
      <label class="field"><span>Email</span><input type="email" id="acct-email" value="${esc(suggested)}" placeholder="you@company.com"></label>
      <button class="btn" onclick="Account.sendLink()">Send secure link</button>
      <button class="btn ghost" onclick="Paywall.takePending();closeSheet()">Not now</button>`);
  },

  async sendLink() {
    const email = document.getElementById('acct-email').value.trim();
    if (!email.includes('@')) { toast('Enter a valid email'); return; }
    openSheet(`<h2>Sending…</h2><p class="sub" style="margin-top:8px">One moment.</p>`);
    // Resolve against the current document rather than assuming the app is
    // served from the origin root — if this 404s, account linking silently
    // dead-ends, which now also blocks checkout.
    const redirect = new URL('index.html?linked=success', location.href).href;
    const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: redirect });
    if (error) {
      openSheet(`
        <h2>Couldn't send the link</h2>
        <p class="sub" style="margin:8px 0 14px">${esc(error.message)}</p>
        <button class="btn" onclick="Account.promptSecure()">Try again</button>
        <button class="btn ghost" onclick="closeSheet()">Close</button>`);
      return;
    }
    openSheet(`
      <h2>Check your email</h2>
      <p class="sub" style="margin:8px 0 14px">We sent a confirmation link to <b>${esc(email)}</b>. Click it to finish securing your account.</p>
      <button class="btn ghost" onclick="closeSheet()">Close</button>`);
  },

  /* ---- data rights (GDPR Art. 15/17/20, CCPA/CPRA) ---- */

  async exportData(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    try {
      const data = await Store.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nexus-card-export-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('✓ Your data has been downloaded');
    } catch (err) {
      console.error(err);
      toast('Could not export: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Export'; }
    }
  },

  confirmDelete() {
    const s = Store.state;
    const paid = s.plan !== 'free';
    openSheet(`
      <h2>Delete your account</h2>
      <p class="sub" style="margin:8px 0 12px">
        This permanently deletes your card, every contact, all notes, reminders and history.
        Your card link stops working immediately. <b>It cannot be undone.</b>
      </p>
      ${paid ? `<p class="sub" style="margin-bottom:12px">Your ${s.plan === 'team' ? 'Team' : 'Pro'} subscription will be cancelled as part of this.</p>` : ''}
      ${!s.accountSecured ? `<div class="upgrade-box" style="margin-bottom:12px"><b>No email on file.</b><div class="sub" style="margin-top:4px">There is no way to recover this account afterwards.</div></div>` : ''}
      <p class="sub" style="margin-bottom:8px">Consider <a href="#" onclick="closeSheet();Account.exportData();return false">downloading your data</a> first.</p>
      <label class="field"><span>Type DELETE to confirm</span><input type="text" id="del-confirm" autocomplete="off" placeholder="DELETE"></label>
      <button class="btn" id="del-go" onclick="Account.doDelete(this)">Delete everything</button>
      <button class="btn ghost" onclick="closeSheet()">Cancel</button>`);
  },

  async doDelete(btn) {
    const typed = (document.getElementById('del-confirm').value || '').trim();
    if (typed !== 'DELETE') { toast('Type DELETE to confirm'); return; }
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      await Store.deleteAccount();
      document.getElementById('sheet').innerHTML = '';
      closeSheet();
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100dvh;padding:32px;text-align:center">
          <div>
            <div style="font-size:32px;margin-bottom:12px">✓</div>
            <h1 style="font-size:20px">Your account has been deleted</h1>
            <p style="color:#71717a;font-size:14px;margin-top:8px">Everything has been removed. Thanks for trying Nexus Card.</p>
          </div>
        </div>`;
    } catch (err) {
      console.error(err);
      btn.disabled = false; btn.textContent = 'Delete everything';
      toast(err.message);
    }
  }
};
