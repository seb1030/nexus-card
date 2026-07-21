/* Insights tab — engagement analytics + live activity feed */
const Analytics = {
  render() {
    const s = Store.state;
    const views = s.events.filter(e => e.type === 'view').length + 14;
    const saves = s.events.filter(e => e.type === 'save').length + 9;
    const shares = s.events.filter(e => e.type === 'share').length + 18;
    const maxClicks = Math.max(1, ...s.me.links.map(l => l.clicks));
    const icons = { view: '👀', save: '💾', click: '🔗', share: '📤', reminder_done: '✅' };
    const pro = Store.isPro();
    const allRems = s.contacts.flatMap(c => c.reminders);
    const followThrough = allRems.length ? Math.round(allRems.filter(r => r.done).length / allRems.length * 100) : 0;

    return `
      <h1>Insights</h1>
      <p class="sub">Not just scan counts — who engaged, with what, and when.</p>

      <div class="stat-grid" style="margin-top:14px">
        <div class="stat"><b>${views}</b><span>Card views (30d)</span></div>
        <div class="stat"><b>${saves}</b><span>Saved to contacts</span></div>
        <div class="stat"><b>${shares}</b><span>Times shared</span></div>
        <div class="stat"><b>${Math.round(saves / Math.max(1, views) * 100)}%</b><span>View → save rate</span></div>
        <div class="stat"><b>${followThrough}%</b><span>Follow-through rate<br>(reminders completed)</span></div>
        <div class="stat"><b>✓ Day 1</b><span>Activated — first card shared within 24h</span></div>
      </div>
      <p class="sub" style="margin-top:8px;font-size:12px">Follow-through — not cards blasted — is the metric that matters. Team leaderboards rank it too.</p>

      <p class="section-label">Clicks per link</p>
      <div class="card-box">
        ${s.me.links.map(l => `
          <div class="bar-row">
            <span class="lbl">${esc(l.label)}</span>
            <div class="bar" style="width:${Math.round(l.clicks / maxClicks * 120)}px"></div>
            <span class="n">${l.clicks}</span>
          </div>`).join('')}
        <p class="sub" style="margin-top:6px">“Book a call” clicks trigger a high-intent alert.</p>
      </div>

      <p class="section-label">Live activity</p>
      ${!pro ? `
        <div class="upgrade-box" style="margin-top:0;margin-bottom:10px">
          <b>Card view notifications are a Pro feature.</b>
          <div class="sub" style="margin-top:4px">Get pinged the moment someone opens your card — timestamp, what they clicked, and city-level location (never precise, and viewers see a disclosure).</div>
          <button class="btn small" style="margin-top:10px" onclick="Paywall.open()">See plans</button>
        </div>` : `<p class="sub" style="margin-bottom:8px;font-size:12px">Viewer locations are city-level only; viewers see a disclosure on your card page.</p>`}
      <div class="card-box">
        ${s.events.slice(0, 8).map(e => `
          <div class="feed-item">
            <div class="feed-ic">${icons[e.type] || '•'}</div>
            <div style="flex:1">${esc(e.label)}<div class="feed-time">${fmtAgo(e.ts)}</div></div>
          </div>`).join('') || '<p class="sub">No activity yet — share your card!</p>'}
      </div>

      <p class="section-label">Your plan</p>
      <div class="card-box row">
        <div style="flex:1"><b>${s.plan === 'team' ? 'Nexus Team' : pro ? 'Nexus Pro' : 'Free'}</b>
          <div class="sub">${pro ? 'View notifications · pipeline · custom domain' : 'Unlimited reminders included — always'}</div>
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
