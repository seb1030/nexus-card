/* Insights tab — engagement analytics + live activity feed */
const Analytics = {
  render() {
    const s = Store.state;
    /* Counts come from the card_stats RPC — a real aggregate over a real
       date window. They were previously derived from Store.state.events,
       which refreshEvents() caps at 50 rows, so past 50 lifetime events the
       numbers stopped rising and then *fell* as older views scrolled out of
       the window. The feed below is still the capped 50; only the headline
       figures are aggregated. */
    const st = s.stats;
    const views = st ? st.views : 0;
    const saves = st ? st.saves : 0;
    const shares = st ? st.shares : 0;
    const windowDays = st ? st.days : 30;
    const maxClicks = Math.max(1, ...s.me.links.map(l => Number(l.clicks) || 0));
    const hasActivity = st ? st.total_events > 0 : s.events.length > 0;
    // Vector icons, matching the rest of the app. These sit in .feed-ic
    // chips, which are now styled for an SVG rather than a glyph.
    const icons = {
      view: Icon.eye(), save: Icon.save(), click: Icon.link(),
      share: Icon.share(), reminder_done: Icon.check()
    };
    const pro = Store.isPro();
    const allRems = s.contacts.flatMap(c => c.reminders);
    const followThrough = allRems.length ? Math.round(allRems.filter(r => r.done).length / allRems.length * 100) : 0;

    if (!hasActivity) {
      return `
        <h1>Insights</h1>
        <p class="sub">Who engaged with your card, with what, and when.</p>
        <div style="text-align:center;padding:48px 20px">
          <div class="feed-ic" style="width:56px;height:56px;margin:0 auto 16px;font-size:26px">📊</div>
          <h2 style="font-size:17px">No activity yet</h2>
          <p class="sub" style="margin:6px auto 20px;max-width:32ch">
            Once someone opens your card you'll see it here — when they viewed, what they tapped, and who saved you.</p>
          <button class="btn" onclick="App.go('card');CardView.shareSheet()">Show my QR code</button>
        </div>
        ${this.planBox(s, pro)}`;
    }

    return `
      <h1>Insights</h1>
      <p class="sub">Not just scan counts — who engaged, with what, and when.</p>

      <div class="stat-grid" style="margin-top:14px">
        <div class="stat"><b>${views}</b><span>Card views (${windowDays}d)</span></div>
        <div class="stat"><b>${saves}</b><span>Saved to contacts</span></div>
        <div class="stat"><b>${shares}</b><span>Times shared</span></div>
        <div class="stat"><b>${views ? Math.round(saves / views * 100) + '%' : '—'}</b><span>View → save rate</span></div>
        <div class="stat"><b>${allRems.length ? followThrough + '%' : '—'}</b><span>Follow-through rate<br>(reminders completed)</span></div>
      </div>
      <p class="sub" style="margin-top:8px;font-size:12px">
        Follow-through — not cards blasted — is the metric that matters.</p>

      ${s.me.links.length ? `
        <p class="section-label">Clicks per link</p>
        <div class="card-box">
          ${s.me.links.map(l => `
            <div class="bar-row">
              <span class="lbl">${esc(l.label)}</span>
              <div class="bar" style="width:${Math.round((Number(l.clicks) || 0) / maxClicks * 120)}px"></div>
              <span class="n">${Number(l.clicks) || 0}</span>
            </div>`).join('')}
        </div>` : ''}

      <p class="section-label">Live activity</p>
      ${pro ? `
        <div class="card-box">
          ${s.events.slice(0, 8).map(e => `
            <div class="feed-item">
              <div class="feed-ic">${icons[e.type] || '•'}</div>
              <div style="flex:1">${esc(e.label)}<div class="feed-time">${fmtAgo(e.ts)}</div></div>
            </div>`).join('')}
        </div>` : `
        <div class="upgrade-box" style="margin-top:0">
          <b>The activity feed is a Pro feature.</b>
          <div class="sub" style="margin-top:4px">See exactly when someone opened your card and what they tapped.</div>
          <button class="btn small" style="margin-top:10px" onclick="Paywall.open()">See plans</button>
        </div>`}

      ${this.planBox(s, pro)}`;
  },

  /* Shared between the empty and populated states. */
  planBox(s, pro) {
    return `
      <p class="section-label">Your plan</p>
      <div class="card-box row">
        <div style="flex:1"><b>${s.plan === 'team' ? 'Nexus Team' : pro ? 'Nexus Pro' : 'Free'}</b>
          <div class="sub">${pro ? 'Activity feed · pipeline' : 'Unlimited reminders included — always'}</div>
          ${s.accountSecured ? `<div class="sub" style="font-size:12px">🔐 Secured (${esc(s.me.accountEmail)})</div>` : ''}</div>
        ${pro ? `<span class="pill brand">${s.plan === 'team' ? '$8/user/mo' : '$6/mo'}</span>` : ''}
        <button class="btn small ${pro ? 'secondary' : ''}" onclick="Paywall.open()">${pro ? 'Plans' : 'See plans'}</button>
      </div>
      ${!s.accountSecured ? `
        <div class="card-box row" style="margin-top:8px">
          <div style="flex:1"><b>Account recovery</b>
            <div class="sub">${pro ? 'No email on file yet — you could lose access if you clear browser data.' : 'Add an email so you never lose your card and contacts.'}</div></div>
          <button class="btn small ${pro ? '' : 'secondary'}" onclick="Account.promptSecure()">Secure</button>
        </div>` : ''}`;
  }
};
