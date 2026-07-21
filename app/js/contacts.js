/* Contacts tab — search, smart filters, follow-up sections, contact detail */
const Contacts = {
  query: '', filter: null, sort: 'recent', openId: null,

  render() {
    if (this.openId) return this.detailHtml(this.openId);
    const s = Store.state;
    let list = [...s.contacts];

    if (this.query) {
      const q = this.query.toLowerCase();
      list = list.filter(c => [c.name, c.title, c.company, c.metAt, c.location, ...(c.tags || [])].join(' ').toLowerCase().includes(q));
    }
    if (this.filter) list = this.applySmartFilter(list, this.filter);
    if (this.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (this.sort === 'company') list.sort((a, b) => a.company.localeCompare(b.company));
    else list.sort((a, b) => b.metTs - a.metTs);

    const due = Store.dueReminders();
    const overdue = due.filter(d => d.reminder.due < Date.now());
    const thisWeek = due.filter(d => d.reminder.due >= Date.now() && d.reminder.due < Date.now() + 7 * DAY);

    const smartChips = [
      ['saastr', 'Met at SaaStr'], ['techcrunch', 'Met at TechCrunch'],
      ['stale', 'No follow-up 30d'], ['vp', 'All VPs'], ['sf', 'In San Francisco'],
    ].map(([k, lbl]) => `<span class="pill clickable ${this.filter === k ? 'on' : ''}" onclick="Contacts.toggleFilter('${k}')">${lbl}</span>`).join('');

    return `
      <div class="row">
        <div><h1>Contacts</h1>
        <p class="sub">${s.contacts.length} people · every one has context</p></div>
        <span class="spacer"></span>
        <button class="btn small secondary" onclick="CardScanner.open()">📷 Scan card</button>
      </div>
      <div class="search-wrap" style="margin-top:12px">
        <input type="text" placeholder="Search name, company, event, city…" value="${esc(this.query)}"
          oninput="Contacts.query=this.value;App.renderTab(true)">
      </div>
      <div class="chips">${smartChips}</div>

      ${overdue.length ? `<p class="section-label" style="color:var(--red)">Follow-up due</p>` +
        overdue.map(d => this.dueRow(d, true)).join('') : ''}
      ${thisWeek.length ? `<p class="section-label">This week</p>` + thisWeek.map(d => this.dueRow(d, false)).join('') : ''}

      <div class="row" style="margin-top:18px">
        <p class="section-label" style="margin:0">All contacts</p><span class="spacer"></span>
        <select style="width:auto;padding:6px 10px;font-size:12px" onchange="Contacts.sort=this.value;App.renderTab()">
          <option value="recent" ${this.sort === 'recent' ? 'selected' : ''}>Recent</option>
          <option value="name" ${this.sort === 'name' ? 'selected' : ''}>Name</option>
          <option value="company" ${this.sort === 'company' ? 'selected' : ''}>Company</option>
        </select>
      </div>
      <div style="margin-top:8px">
        ${list.map(c => this.rowHtml(c)).join('') || '<p class="sub">No matches.</p>'}
      </div>`;
  },

  applySmartFilter(list, f) {
    const month = Date.now() - 30 * DAY;
    if (f === 'saastr') return list.filter(c => c.metAt.toLowerCase().includes('saastr'));
    if (f === 'techcrunch') return list.filter(c => c.metAt.toLowerCase().includes('techcrunch'));
    if (f === 'vp') return list.filter(c => /\bvp\b/i.test(c.title));
    if (f === 'sf') return list.filter(c => c.location === 'San Francisco');
    if (f === 'stale') return list.filter(c => c.metTs < month && !c.reminders.some(r => r.done));
    return list;
  },
  toggleFilter(f) { this.filter = this.filter === f ? null : f; App.renderTab(); },

  dueRow(d, overdue) {
    return `<div class="card-box tappable" onclick="Contacts.detail('${d.contact.id}')">
      <div class="row">
        <div class="avatar">${esc(d.contact.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2))}</div>
        <div style="flex:1"><div class="c-name">${esc(d.contact.name)}</div>
          <div class="c-meta">“${esc(d.reminder.text)}”</div></div>
        <span class="pill ${overdue ? 'overdue' : ''}">${fmtDue(d.reminder.due)}</span>
      </div></div>`;
  },

  rowHtml(c) {
    return `<div class="card-box tappable" onclick="Contacts.detail('${c.id}')">
      <div class="row">
        <div class="avatar">${esc(c.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2))}</div>
        <div style="flex:1">
          <div class="c-name">${esc(c.name)}</div>
          <div class="c-meta">${esc(c.title)} @ ${esc(c.company)}</div>
          <div class="c-meta">${c.metAt ? '📍 ' + esc(c.metAt) + ' · ' : ''}${fmtAgo(c.metTs)}</div>
        </div>
        ${c.stage ? `<span class="pill">${Pipeline.stageName(c.stage)}</span>` : ''}
      </div></div>`;
  },

  detail(id) { this.openId = id; App.go('contacts'); },
  back() { this.openId = null; App.renderTab(); },

  detailHtml(id) {
    const c = Store.contact(id);
    if (!c) { this.openId = null; return this.render(); }
    const hist = [...c.history].sort((a, b) => b.ts - a.ts);
    return `
      <button class="back-link" onclick="Contacts.back()">← Contacts</button>
      <div class="card-box">
        <div class="row">
          <div class="avatar" style="width:52px;height:52px;font-size:17px">${esc(c.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2))}</div>
          <div style="flex:1">
            <h2>${esc(c.name)}</h2>
            <div class="c-meta">${esc(c.title)} @ ${esc(c.company)}</div>
            <div class="c-meta">${c.metAt ? '📍 Met at ' + esc(c.metAt) + ' · ' : ''}${c.location ? esc(c.location) + ' · ' : ''}${fmtAgo(c.metTs)}</div>
          </div>
        </div>
        <div class="chips" style="padding-top:10px">${(c.tags || []).map(t => `<span class="pill brand">${esc(t)}</span>`).join('')}</div>
        <div class="row" style="gap:8px;margin-top:6px">
          <button class="btn small secondary" onclick="toast('Opening email (demo)')">✉️ Email</button>
          <button class="btn small secondary" onclick="toast('Calling (demo)')">📞 Call</button>
          <button class="btn small secondary" onclick="toast('Opening WhatsApp (demo)')">💬 WhatsApp</button>
        </div>
      </div>

      <p class="section-label">Private notes</p>
      <textarea id="ct-notes" rows="3" placeholder="What did you talk about? What did you promise?"
        onchange="Contacts.saveNotes('${c.id}', this.value)">${esc(c.notes)}</textarea>

      <p class="section-label">Reminders & tasks</p>
      ${c.reminders.map(r => `
        <div class="card-box row">
          <input type="checkbox" ${r.done ? 'checked' : ''} onchange="Contacts.toggleReminder('${c.id}','${r.id}')" style="width:18px;height:18px">
          <div style="flex:1;${r.done ? 'text-decoration:line-through;color:var(--gray-5)' : ''}">${esc(r.text)}</div>
          <span class="pill ${!r.done && r.due < Date.now() ? 'overdue' : ''}">${r.done ? 'done' : fmtDue(r.due)}</span>
        </div>`).join('') || '<p class="sub">No reminders yet.</p>'}
      <div class="row" style="margin-top:8px">
        <input type="text" id="ct-rem-text" placeholder="Follow up about…">
        <select id="ct-rem-days" style="width:110px">
          <option value="3">3 days</option><option value="7">1 week</option><option value="14">2 weeks</option>
        </select>
        <button class="btn small" onclick="Contacts.addReminder('${c.id}')">Set</button>
      </div>
      <p class="sub" style="margin-top:6px">Reminders are unlimited on every plan.</p>

      <p class="section-label">Pipeline stage</p>
      ${Store.isPro() ? `<div class="chips" style="padding-top:2px">${Pipeline.STAGES.map(s =>
        `<span class="pill clickable ${c.stage === s.id ? 'on' : ''}" onclick="Contacts.setStage('${c.id}','${s.id}')">${s.name}</span>`).join('')}</div>`
      : `<p class="sub">Pipeline stages are a Pro feature. <span class="pill clickable brand" onclick="Paywall.open()">See plans</span></p>`}

      <p class="section-label">Interaction history</p>
      <div class="card-box">
        ${hist.map(h => `<div class="hist-item"><time>${fmtAgo(h.ts)}</time><span>${esc(h.label)}</span></div>`).join('') || '<p class="sub">Nothing yet.</p>'}
      </div>`;
  },

  async saveNotes(id, v) { await Store.setContactNotes(id, v); toast('✓ Note saved'); },
  async toggleReminder(cid, rid) {
    await Store.toggleReminder(cid, rid);
    App.renderTab(); App.refreshBadge();
  },
  async addReminder(id) {
    const text = document.getElementById('ct-rem-text').value.trim() || 'Follow up';
    const days = +document.getElementById('ct-rem-days').value;
    await Store.addReminder(id, text, Date.now() + days * DAY);
    App.renderTab(); App.refreshBadge(); toast('⏰ Reminder set');
  },
  async setStage(cid, stage) {
    await Store.setContactStage(cid, stage);
    App.renderTab();
    toast('Moved to ' + Pipeline.stageName(stage));
  }
};

/* Paper business card OCR — on-device (Apple Vision / Google ML Kit),
   free, nothing leaves the phone. Demo simulates the camera + extraction. */
const CardScanner = {
  POOL: [
    { name: 'Marcus Webb', title: 'Sales Director', company: 'Gong', email: 'marcus.webb@gong.io', phone: '+1 (415) 555-0177' },
    { name: 'Ines Fournier', title: 'Head of Partnerships', company: 'Deel', email: 'ines@deel.com', phone: '+1 (628) 555-0142' },
    { name: 'Tom Nakamura', title: 'Broker', company: 'Keller Williams', email: 'tom.nakamura@kw.com', phone: '+1 (512) 555-0129' },
  ],
  current: null,

  open() {
    this.current = this.POOL[Math.floor(Math.random() * this.POOL.length)];
    const p = this.current;
    openSheet(`
      <h2>Scan a paper card</h2>
      <p class="sub" style="margin:6px 0 12px">Point your camera at the card. OCR runs on-device — free, and nothing leaves your phone.</p>
      <div class="paper-mock">
        <b>${esc(p.name)}</b>
        <div>${esc(p.title)} — ${esc(p.company)}</div>
        <div style="margin-top:8px">${esc(p.email)}<br>${esc(p.phone)}</div>
      </div>
      <button class="btn" style="margin-top:14px" onclick="CardScanner.scan()">📷 Scan (demo)</button>
      <button class="btn ghost" onclick="closeSheet()">Cancel</button>`);
  },

  scan() {
    openSheet(`<h2>Scanning…</h2><p class="sub" style="margin-top:8px">Reading text on-device…</p>`);
    setTimeout(() => this.confirm(), 800);
  },

  confirm() {
    const p = this.current;
    openSheet(`
      <h2>Check what we read</h2>
      <p class="sub" style="margin:6px 0 12px">OCR isn't perfect — fix anything that looks off before saving.</p>
      <label class="field"><span>Name</span><input type="text" id="sc-name" value="${esc(p.name)}"></label>
      <label class="field"><span>Title</span><input type="text" id="sc-title" value="${esc(p.title)}"></label>
      <label class="field"><span>Company</span><input type="text" id="sc-company" value="${esc(p.company)}"></label>
      <label class="field"><span>Email</span><input type="email" id="sc-email" value="${esc(p.email)}"></label>
      <label class="field"><span>Phone</span><input type="tel" id="sc-phone" value="${esc(p.phone)}"></label>
      <button class="btn" onclick="CardScanner.save()">Save contact</button>
      <button class="btn ghost" onclick="closeSheet()">Discard</button>`);
  },

  async save() {
    const v = id => document.getElementById(id).value.trim();
    const name = v('sc-name');
    if (!name) { toast('Name is required'); return; }
    let ct;
    try {
      ct = await Store.addContactFromShareBack(
        { name, title: v('sc-title'), company: v('sc-company'), email: v('sc-email'), phone: v('sc-phone') },
        'Scanned their paper card');
    } catch (err) {
      toast('Could not save: ' + err.message);
      return;
    }
    closeSheet();
    App.go('contacts');
    Contacts.detail(ct.id);
    toast('✓ ' + name + ' saved from paper card');
  }
};
