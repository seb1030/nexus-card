/* Pipeline Lite — 4 stages.
   Desktop drags; touch and keyboard use the explicit Move control. HTML5
   drag-and-drop does not fire for touch at all, so before this the tab was
   a read-only board on the phone the product targets — and it is a paid
   feature. Reimplementing drag with pointer events was the other option,
   but the board scrolls horizontally, so a drag gesture fights the scroll
   and needs long-press disambiguation. An explicit control is more
   reliable, works with a keyboard for free, and is faster to use one-handed. */
const Pipeline = {
  STAGES: [
    { id: 'new', name: 'New Lead' },
    { id: 'contacted', name: 'Contacted' },
    { id: 'meeting', name: 'Meeting Scheduled' },
    { id: 'closed', name: 'Closed' },
  ],
  stageName(id) { return (this.STAGES.find(s => s.id === id) || {}).name || id; },

  render() {
    const s = Store.state;
    if (!Store.isPro()) {
      return `
        <h1>Pipeline</h1>
        <p class="sub">Four stages. Move contacts through them as the relationship progresses.</p>
        <div class="upgrade-box" style="margin-top:16px">
          <b>Pipeline is a Pro feature.</b>
          <div class="sub" style="margin-top:6px">Your contacts and follow-up reminders stay free forever — the pipeline and the live activity feed are how Nexus pays for them.</div>
          <button class="btn small" style="margin-top:10px" onclick="Paywall.open()">See plans</button>
        </div>
        <p class="section-label">What it looks like</p>
        <div class="pipe-board" aria-hidden="true">${this.STAGES.map(st => `
          <div class="pipe-col" style="opacity:.55">
            <h3>${esc(st.name)}</h3>
            <div class="pipe-card"><div class="c-name" style="font-size:13px">🔒 Upgrade to unlock</div></div>
          </div>`).join('')}</div>`;
    }

    if (!s.contacts.length) {
      return `
        <h1>Pipeline</h1>
        <div style="text-align:center;padding:48px 20px">
          <div class="feed-ic" style="width:56px;height:56px;margin:0 auto 16px;font-size:26px">▤</div>
          <h2 style="font-size:17px">Nothing in the pipeline yet</h2>
          <p class="sub" style="margin:6px auto 20px;max-width:32ch">
            Contacts appear here once you have some. Every new contact starts in New Lead.</p>
          <button class="btn" onclick="App.go('contacts')">Go to contacts</button>
        </div>`;
    }

    const col = (stage) => {
      const cards = s.contacts.filter(c => c.stage === stage.id);
      return `
        <div class="pipe-col" data-stage="${stage.id}"
             ondragover="event.preventDefault();this.classList.add('drag-over')"
             ondragleave="this.classList.remove('drag-over')"
             ondrop="Pipeline.drop(event,'${stage.id}')">
          <h3>${esc(stage.name)}<span>${cards.length}</span></h3>
          ${cards.map(c => `
            <div class="pipe-card" draggable="true"
                 ondragstart="event.dataTransfer.setData('text/plain','${c.id}')">
              <button class="pipe-card-open" onclick="Contacts.detail('${c.id}')">
                <span class="c-name" style="font-size:13px">${esc(c.name)}</span>
                <span class="c-meta">${esc(c.company)}${c.metAt ? ' · ' + esc(c.metAt) : ''}</span>
                ${c.reminders.some(r => !r.done && r.due < Date.now()) ? '<span class="pill overdue" style="margin-top:6px">follow-up overdue</span>' : ''}
              </button>
              <button class="pipe-move" aria-label="Move ${esc(c.name)} to another stage"
                      onclick="Pipeline.moveSheet('${c.id}')">Move ⇄</button>
            </div>`).join('') || '<p class="sub" style="font-size:12px;padding:4px">Nothing here yet</p>'}
        </div>`;
    };

    return `
      <h1>Pipeline</h1>
      <p class="sub">Not a full CRM — four stages, and a nudge to move people forward.</p>
      <div class="pipe-board" style="margin-top:14px">${this.STAGES.map(col).join('')}</div>
      <p class="sub" style="margin-top:12px;font-size:12px">Drag a card between columns, or tap <b>Move</b> on any card.</p>`;
  },

  /* Touch- and keyboard-accessible alternative to dragging. */
  moveSheet(id) {
    const c = Store.contact(id);
    if (!c) { toast('Contact not found — try reloading.'); return; }
    openSheet(`
      <h2>Move ${esc(c.name)}</h2>
      <p class="sub" style="margin:6px 0 12px">Currently in <b>${esc(this.stageName(c.stage))}</b>.</p>
      ${this.STAGES.map(st => `
        <button class="btn ${st.id === c.stage ? 'secondary' : ''}" style="margin-bottom:8px"
                ${st.id === c.stage ? 'disabled' : ''}
                onclick="Pipeline.moveTo('${c.id}','${st.id}')">
          ${esc(st.name)}${st.id === c.stage ? ' (current)' : ''}
        </button>`).join('')}
      <button class="btn ghost" onclick="closeSheet()">Cancel</button>`);
  },

  async moveTo(id, stage) {
    const c = Store.contact(id);
    if (!c) { toast('Contact not found — try reloading.'); return; }
    closeSheet();
    await guard(async () => {
      await Store.setContactStage(id, stage);
      toast(c.name + ' → ' + this.stageName(stage));
    }, 'Could not move ' + c.name);
    App.renderTab();   // re-render either way, so a failed write snaps back
  },

  async drop(ev, stage) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('drag-over');
    const id = ev.dataTransfer.getData('text/plain');
    const c = Store.contact(id);
    if (c && c.stage !== stage) {
      await guard(async () => {
        await Store.setContactStage(id, stage);
        toast(c.name + ' → ' + this.stageName(stage));
      }, 'Could not move ' + c.name);
      App.renderTab();
    }
  }
};
