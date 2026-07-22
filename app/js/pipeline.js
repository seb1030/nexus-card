/* Pipeline Lite — 4 stages, drag & drop */
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
        <p class="sub">Four stages, drag between them. Export to Salesforce/HubSpot when ready.</p>
        <div class="upgrade-box" style="margin-top:16px">
          <b>Pipeline is a Pro feature.</b>
          <div class="sub" style="margin-top:6px">Your reminders and contacts stay free forever — pipeline stages, view notifications, and your custom domain are how Nexus pays for them.</div>
          <button class="btn small" style="margin-top:10px" onclick="Paywall.open()">See plans</button>
        </div>
        <p class="section-label">What it looks like</p>
        <div class="pipe-board">${this.STAGES.map(st => `
          <div class="pipe-col" style="opacity:.55">
            <h3>${st.name}</h3>
            <div class="pipe-card"><div class="c-name" style="font-size:13px">🔒 Upgrade to unlock</div></div>
          </div>`).join('')}</div>`;
    }
    const col = (stage) => {
      const cards = s.contacts.filter(c => c.stage === stage.id);
      return `
        <div class="pipe-col" data-stage="${stage.id}"
             ondragover="event.preventDefault();this.classList.add('drag-over')"
             ondragleave="this.classList.remove('drag-over')"
             ondrop="Pipeline.drop(event,'${stage.id}')">
          <h3>${stage.name}<span>${cards.length}</span></h3>
          ${cards.map(c => `
            <div class="pipe-card" draggable="true"
                 ondragstart="event.dataTransfer.setData('text/plain','${c.id}')"
                 onclick="Contacts.detail('${c.id}')">
              <div class="c-name" style="font-size:13px">${esc(c.name)}</div>
              <div class="c-meta">${esc(c.company)}${c.metAt ? ' · ' + esc(c.metAt) : ''}</div>
              ${c.reminders.some(r => !r.done && r.due < Date.now()) ? '<span class="pill overdue" style="margin-top:6px">follow-up overdue</span>' : ''}
            </div>`).join('') || '<p class="sub" style="font-size:12px;padding:4px">Drop contacts here</p>'}
        </div>`;
    };
    return `
      <h1>Pipeline</h1>
      <p class="sub">Not a full CRM — four stages, drag between them. Export to Salesforce/HubSpot when ready.</p>
      <div class="pipe-board" style="margin-top:14px">${this.STAGES.map(col).join('')}</div>
      <p class="section-label">Stage reminder templates</p>
      <div class="card-box"><b style="font-size:13.5px">New Lead</b><div class="sub">Auto-suggest: "Send intro + LinkedIn request" after 2 days</div></div>
      <div class="card-box"><b style="font-size:13.5px">Contacted</b><div class="sub">Auto-suggest: "Nudge if no reply" after 5 days</div></div>
      <div class="card-box"><b style="font-size:13.5px">Meeting Scheduled</b><div class="sub">Auto-suggest: "Send agenda" 1 day before</div></div>`;
  },

  async drop(ev, stage) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('drag-over');
    const id = ev.dataTransfer.getData('text/plain');
    const c = Store.contact(id);
    if (c && c.stage !== stage) {
      await guard(async () => {
        await Store.setContactStage(id, stage);
        App.renderTab();
        toast(c.name + ' → ' + this.stageName(stage));
      }, 'Could not move ' + c.name);
      App.renderTab();   // snap back to the true stage if the write failed
    }
  }
};
