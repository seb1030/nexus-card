/* My Card tab — preview, edit, share (QR/link), recipient simulation */
const CardView = {
  render() {
    const me = Store.state.me;
    document.documentElement.style.setProperty('--brand', me.color);
    return `
      <div class="row" style="margin-bottom:14px">
        <div><h1>My Card</h1><p class="sub">Live at <b>${esc(Store.cardUrl().replace(/^https?:\/\//, ''))}</b></p></div>
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
      <div class="share-opt"><div class="feed-ic">▦</div><div style="flex:1"><b>QR code</b><div class="sub">Works offline — static QR</div></div><button class="btn small secondary" onclick="CardView.shareSheet()">Show</button></div>
      <div class="share-opt"><div class="feed-ic">🔗</div><div style="flex:1"><b>Card link</b><div class="sub">${esc(Store.cardUrl())}</div></div><button class="btn small secondary" onclick="CardView.copyLink()">Copy</button></div>
      <p class="section-label">Your data</p>
      <div class="share-opt"><div class="feed-ic">⬇</div><div style="flex:1"><b>Download your data</b><div class="sub">Everything we hold, as JSON</div></div><button class="btn small secondary" onclick="Account.exportData(this)">Export</button></div>
      <div class="share-opt"><div class="feed-ic">🗑</div><div style="flex:1"><b>Delete your account</b><div class="sub">Permanent — card, contacts and reminders</div></div><button class="btn small secondary" onclick="Account.confirmDelete()">Delete</button></div>`;
  },

  bizCard(me, isRecipient) {
    const links = me.links.map(l =>
      `<button class="biz-link" onclick="CardView.linkClick('${l.id}', ${isRecipient})">${esc(l.label)}</button>`).join('');
    const rows = [];
    if (me.fields.phone && me.phone) rows.push('📞 ' + esc(me.phone));
    if (me.fields.email && me.email) rows.push('✉️ ' + esc(me.email));
    return `
      <div class="biz-card">
        <div class="biz-logo" style="background:${me.color}">${esc(me.initials || 'NC')}</div>
        <div class="biz-name">${esc(me.name)}</div>
        <div class="biz-title">${esc(me.title)}${me.company ? ' @ ' + esc(me.company) : ''}</div>
        <div class="biz-links">${links}</div>
        <div class="biz-contact-rows">${rows.map(r => `<div>${r}</div>`).join('')}</div>
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

  /* ---- share sheet with QR ---- */
  shareSheet() {
    const qr = qrcode(0, 'M');
    qr.addData(Store.cardUrl());
    qr.make();
    openSheet(`
      <h2 style="text-align:center">Scan to get my card</h2>
      <div class="qr-wrap">${qr.createSvgTag({ cellSize: 5, margin: 2 })}</div>
      <p class="sub" style="text-align:center;margin-bottom:14px">${esc(Store.cardUrl())}<br>They scan with their camera — <b>no app download needed</b>.</p>
      <button class="btn" onclick="closeSheet();CardView.copyLink()">Copy link instead</button>
      <button class="btn ghost" onclick="closeSheet();CardView.simulateScan()">Simulate their scan →</button>`);
    Store.logShare('You shared your card (QR)').catch(() => {});
  },

  /* ---- edit sheet ---- */
  editSheet() {
    const me = Store.state.me;
    openSheet(`
      <h2>Edit card</h2>
      <div style="margin-top:12px">
        <label class="field"><span>Name</span><input type="text" id="ed-name" value="${esc(me.name)}"></label>
        <label class="field"><span>Title</span><input type="text" id="ed-title" value="${esc(me.title)}"></label>
        <label class="field"><span>Company</span><input type="text" id="ed-company" value="${esc(me.company)}"></label>
        <div class="row card-box"><span style="flex:1">Show phone</span>
          <label class="switch"><input type="checkbox" id="ed-phone" ${me.fields.phone ? 'checked' : ''}><i></i></label></div>
        <div class="row card-box"><span style="flex:1">Show email</span>
          <label class="switch"><input type="checkbox" id="ed-email" ${me.fields.email ? 'checked' : ''}><i></i></label></div>
        <p class="section-label">Brand color</p>
        <div class="swatches">${['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#111114'].map(c =>
          `<button type="button" class="swatch ${me.color === c ? 'on' : ''}" style="background:${c}" aria-label="Brand colour ${c}" aria-pressed="${me.color === c}" onclick="CardView.saveColor('${c}')"></button>`).join('')}</div>
        <button class="btn" onclick="CardView.saveEdit()">Save</button>
      </div>`);
  },
  async saveColor(c) {
    await Store.updateCardFields({ color: c });
    this.editSheet(); App.renderTab();
  },
  async saveEdit() {
    const me = Store.state.me;
    const name = document.getElementById('ed-name').value.trim() || me.name;
    const title = document.getElementById('ed-title').value.trim();
    const company = document.getElementById('ed-company').value.trim();
    const showPhone = document.getElementById('ed-phone').checked;
    const showEmail = document.getElementById('ed-email').checked;
    try {
      await Store.updateCardFields({ name, title, company, showPhone, showEmail });
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
