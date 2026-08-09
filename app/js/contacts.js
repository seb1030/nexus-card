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

    /* First-run state. "No matches." is a search-failure string and reads
       as a bug when it is really the very first screen. */
    if (!s.contacts.length && !this.query && !this.filter) {
      return `
        <h1>Contacts</h1>
        <div style="text-align:center;padding:48px 20px">
          <div class="feed-ic" style="width:56px;height:56px;margin:0 auto 16px;font-size:26px">👋</div>
          <h2 style="font-size:17px">No one here yet</h2>
          <p class="sub" style="margin:6px auto 20px;max-width:32ch">
            People land here when someone shares their info back from your card — or add them yourself.</p>
          <button class="btn" onclick="App.go('card');CardView.shareSheet()">Show my QR code</button>
          <button class="btn secondary" style="margin-top:8px" onclick="CardScanner.open()">+ Add a contact</button>
        </div>
        ${Store.planFooter()}`;
    }

    const due = Store.dueReminders();
    const overdue = due.filter(d => d.reminder.due < Date.now());
    const thisWeek = due.filter(d => d.reminder.due >= Date.now() && d.reminder.due < Date.now() + 7 * DAY);

    /* Chips are derived from the user's actual data. They used to be
       hardcoded to SaaStr / TechCrunch / San Francisco, which only matched
       because seedDemoData wrote those exact values -- for a real user they
       matched nothing. */
    const events = [...new Set(s.contacts.map(c => c.metAt).filter(Boolean))].slice(0, 3);
    const smartChips = [
      ...events.map(ev => ['met:' + ev, 'Met at ' + ev]),
      ['stale', 'No follow-up 30d'],
      ['vp', 'All VPs'],
    ].map(([k, lbl]) => `<button type="button" class="pill clickable ${this.filter === k ? 'on' : ''}" aria-pressed="${this.filter === k}" onclick="Contacts.toggleFilter('${esc(k)}')">${esc(lbl)}</button>`).join('');

    return `
      <div class="row">
        <div><h1>Contacts</h1>
        <p class="sub">${s.contacts.length} people · every one has context</p></div>
        <span class="spacer"></span>
        <button class="btn small secondary" onclick="CardScanner.open()">+ Add</button>
      </div>
      <div class="search-wrap" style="margin-top:12px">
        <input type="text" id="ct-search" placeholder="Search name, company, event, city…" value="${esc(this.query)}"
          oninput="Contacts.onSearch(this, event)">
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
      </div>
      ${Store.planFooter()}`;
  },

  applySmartFilter(list, f) {
    const month = Date.now() - 30 * DAY;
    if (f.startsWith('met:')) return list.filter(c => c.metAt === f.slice(4));
    if (f === 'vp') return list.filter(c => /\bvp\b/i.test(c.title || ''));
    if (f === 'stale') return list.filter(c => c.metTs < month && !c.reminders.some(r => r.done));
    return list;
  },
  toggleFilter(f) { this.filter = this.filter === f ? null : f; App.renderTab(); },

  /* Debounced so typing does not rebuild every row on each keystroke, and
     composition-aware so IME input is never interrupted mid-word. */
  _searchTimer: null,
  onSearch(el, ev) {
    this.query = el.value;
    if (ev && ev.isComposing) return;
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => App.renderTab(true), 150);
  },

  dueRow(d, overdue) {
    return `<button type="button" class="card-box tappable" onclick="Contacts.detail('${d.contact.id}')">
      <div class="row">
        <div class="avatar">${esc(d.contact.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2))}</div>
        <div style="flex:1"><div class="c-name">${esc(d.contact.name)}</div>
          <div class="c-meta">“${esc(d.reminder.text)}”</div></div>
        <span class="pill ${overdue ? 'overdue' : ''}">${fmtDue(d.reminder.due)}</span>
      </div></button>`;
  },

  rowHtml(c) {
    return `<button type="button" class="card-box tappable" onclick="Contacts.detail('${c.id}')">
      <div class="row">
        <div class="avatar">${esc(c.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2))}</div>
        <div style="flex:1">
          <div class="c-name">${esc(c.name)}</div>
          <div class="c-meta">${esc(c.title)} @ ${esc(c.company)}</div>
          <div class="c-meta">${c.metAt ? '📍 ' + esc(c.metAt) + ' · ' : ''}${fmtAgo(c.metTs)}</div>
        </div>
        ${c.stage ? `<span class="pill">${esc(Pipeline.stageName(c.stage))}</span>` : ''}
      </div></button>`;
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
          ${c.email ? `<a class="btn small secondary" href="mailto:${encodeURI(c.email)}">✉️ Email</a>` : ''}
          ${c.phone ? `<a class="btn small secondary" href="tel:${encodeURI(c.phone.replace(/[^\d+]/g, ''))}">📞 Call</a>` : ''}
          ${c.phone ? `<a class="btn small secondary" href="https://wa.me/${encodeURIComponent(c.phone.replace(/[^\d]/g, ''))}" target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>` : ''}
          ${!c.email && !c.phone ? `<span class="sub">No email or phone on file.</span>` : ''}
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
        `<button type="button" class="pill clickable ${c.stage === s.id ? 'on' : ''}" aria-pressed="${c.stage === s.id}" onclick="Contacts.setStage('${c.id}','${s.id}')">${esc(s.name)}</button>`).join('')}</div>`
      : `<p class="sub">Pipeline stages are a Pro feature. <button type="button" class="pill clickable brand" onclick="Paywall.open()">See plans</button></p>`}

      <p class="section-label">Interaction history</p>
      <div class="card-box">
        ${hist.map(h => `<div class="hist-item"><time>${fmtAgo(h.ts)}</time><span>${esc(h.label)}</span></div>`).join('') || '<p class="sub">Nothing yet.</p>'}
      </div>`;
  },

  async saveNotes(id, v) {
    await guard(async () => {
      await Store.setContactNotes(id, v);
      toast('✓ Note saved');
    }, 'Could not save note');
  },
  async toggleReminder(cid, rid) {
    await guard(async () => {
      await Store.toggleReminder(cid, rid);
      App.renderTab(); App.refreshBadge();
    }, 'Could not update reminder');
  },
  async addReminder(id) {
    const text = document.getElementById('ct-rem-text').value.trim() || 'Follow up';
    const days = +document.getElementById('ct-rem-days').value;
    await guard(async () => {
      await Store.addReminder(id, text, Date.now() + days * DAY);
      App.renderTab(); App.refreshBadge(); toast('⏰ Reminder set');
    }, 'Could not set reminder');
  },
  async setStage(cid, stage) {
    await guard(async () => {
      await Store.setContactStage(cid, stage);
      App.renderTab();
      toast('Moved to ' + Pipeline.stageName(stage));
    }, 'Could not move contact');
  }
};

/* Manual contact entry.
   This was previously presented as on-device paper-card OCR: it picked a
   person at random from a hardcoded POOL of three, showed a fake 800ms
   "Scanning…" step, then pre-filled the form with that invented person and
   saved them as a real contact. The save was always real; only the capture
   was fiction. Stripped back to what actually works — the same form, with
   the fake camera removed. Restore a scan step when real OCR exists. */
const CardScanner = {
  open() {
    openSheet(`
      <h2>Add a contact</h2>
      <p class="sub" style="margin:6px 0 12px">Type in what's on their card. You can add notes and a follow-up right after.</p>
      <label class="field"><span>Name</span><input type="text" id="sc-name" maxlength="100" placeholder="Required"></label>
      <label class="field"><span>Title</span><input type="text" id="sc-title" maxlength="120"></label>
      <label class="field"><span>Company</span><input type="text" id="sc-company" maxlength="120"></label>
      <label class="field"><span>Email</span><input type="email" id="sc-email" maxlength="320"></label>
      <label class="field"><span>Phone</span><input type="tel" id="sc-phone" maxlength="40"></label>
      <button class="btn" onclick="CardScanner.save()">Save contact</button>
      <button class="btn ghost" onclick="closeSheet()">Cancel</button>`);
  },

  async save() {
    const v = id => document.getElementById(id).value.trim();
    const name = v('sc-name');
    if (!name) { toast('Name is required'); return; }
    let ct;
    try {
      ct = await Store.addContactFromShareBack(
        { name, title: v('sc-title'), company: v('sc-company'), email: v('sc-email'), phone: v('sc-phone') },
        'Added manually');
    } catch (err) {
      toast('Could not save: ' + err.message);
      return;
    }
    closeSheet();
    App.go('contacts');
    Contacts.detail(ct.id);
    toast('✓ ' + name + ' saved');
  }
};
