/* Onboarding — 3 screens, 60-second setup, no email-verify gate */
const Onboarding = {
  step: 1,
  draft: { name: '', title: '', company: '', phone: '', email: '', color: '#4f46e5', fields: { phone: true, email: true }, geotag: false, links: [] },

  start() {
    this.step = 1;
    document.getElementById('onboarding').classList.remove('hidden');
    this.render();
  },

  progress() {
    return `<div class="ob-progress">${[1, 2, 3].map(i => `<i class="${i <= this.step ? 'on' : ''}"></i>`).join('')}</div>`;
  },

  render() {
    const el = document.getElementById('onboarding');
    if (this.step === 1) el.innerHTML = this.screen1();
    else if (this.step === 2) el.innerHTML = this.screen2();
    else el.innerHTML = this.screen3();
  },

  screen1() {
    const d = this.draft;
    return `${this.progress()}
      <h1>Let's build your card</h1>
      <p class="sub">Takes about 60 seconds. No sign-up wall, no email verification.</p>
      <p class="sub" style="margin:14px 0 2px;font-size:12px">Tip: your phone can autofill these from your own contact card.</p>
      <p class="section-label">Your details</p>
      <label class="field"><span>Full name</span><input type="text" id="ob-name" autocomplete="name" value="${esc(d.name)}" placeholder="Alex Rivera"></label>
      <label class="field"><span>Title</span><input type="text" id="ob-title" autocomplete="organization-title" value="${esc(d.title)}" placeholder="Product Designer"></label>
      <label class="field"><span>Company</span><input type="text" id="ob-company" autocomplete="organization" value="${esc(d.company)}" placeholder="Acme"></label>
      <label class="field"><span>Phone</span><input type="tel" id="ob-phone" autocomplete="tel" value="${esc(d.phone)}" placeholder="+1 (415) 555-0100"></label>
      <label class="field"><span>Email</span><input type="email" id="ob-email" autocomplete="email" value="${esc(d.email)}" placeholder="alex@acme.com" onblur="Onboarding.inferCompany()"></label>
      <button class="btn" style="margin-top:8px" onclick="Onboarding.next1()">Continue</button>`;
  },

  /* "Continue with LinkedIn" removed: it was not an OAuth flow at all — it
     hardcoded Object.assign(draft, {name:'Alex Rivera', email:'alex@acme.com'}),
     so the most prominent button on the first screen filled in a stranger's
     details. Restore it as a real Sign in with LinkedIn (OpenID Connect)
     provider in Supabase Auth when that is wired up. */

  /* Free enrichment: infer company from a work-email domain. */
  inferCompany() {
    this.readFields();
    const d = this.draft;
    const m = d.email.match(/@([a-z0-9-]+)\./i);
    if (!m || d.company) return;
    const generic = ['gmail', 'yahoo', 'outlook', 'hotmail', 'icloud', 'aol', 'proton', 'protonmail', 'me', 'live'];
    if (generic.includes(m[1].toLowerCase())) return;
    d.company = m[1][0].toUpperCase() + m[1].slice(1);
    this.render();
    toast('🏢 Company detected from your email domain: ' + d.company);
  },

  readFields() {
    const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : null; };
    ['name', 'title', 'company', 'phone', 'email'].forEach(k => {
      const val = v('ob-' + k);
      if (val !== null) this.draft[k] = val;
    });
  },

  next1() {
    this.readFields();
    if (!this.draft.name) { toast('Add your name to continue'); return; }
    this.step = 2; this.render();
  },

  screen2() {
    const d = this.draft;
    const linkRow = (l, i) => `
      <div class="row" style="margin-bottom:8px">
        <span class="pill brand">${esc(l.label)}</span>
        <span class="sub" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.url)}</span>
        <button class="btn danger small" onclick="Onboarding.rmLink(${i})">✕</button>
      </div>`;
    return `${this.progress()}
      <h1>What do you want to share?</h1>
      <p class="sub">Toggle each field — it's not all-or-nothing.</p>
      <p class="section-label">Contact fields</p>
      <div class="card-box row"><span style="flex:1">Phone number</span>
        <label class="switch"><input type="checkbox" ${d.fields.phone ? 'checked' : ''} onchange="Onboarding.draft.fields.phone=this.checked"><i></i></label></div>
      <div class="card-box row"><span style="flex:1">Email address</span>
        <label class="switch"><input type="checkbox" ${d.fields.email ? 'checked' : ''} onchange="Onboarding.draft.fields.email=this.checked"><i></i></label></div>
      <p class="section-label">Privacy</p>
      <p class="sub" style="margin-top:6px;font-size:12px">People who view your card see a notice that views are shared with you. No location is collected from them.</p>
      <p class="section-label">Links</p>
      ${d.links.map(linkRow).join('') || '<p class="sub" style="margin-bottom:8px">No links yet.</p>'}
      <div class="row" style="margin-bottom:8px">
        <select id="ob-link-type" style="width:130px">
          <option>Calendly</option><option>Portfolio</option><option>LinkedIn</option><option>Custom</option>
        </select>
        <input type="url" id="ob-link-url" placeholder="https://…">
        <button class="btn small" onclick="Onboarding.addLink()">Add</button>
      </div>
      <p class="section-label">Branding</p>
      <div class="swatches">${['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#111114'].map(c =>
        `<button type="button" class="swatch ${d.color === c ? 'on' : ''}" style="background:${c}" aria-label="Brand colour ${c}" aria-pressed="${d.color === c}" onclick="Onboarding.setColor('${c}')"></button>`).join('')}</div>
      <p class="sub">Logo & photo upload with auto-crop comes later — your initials look great meanwhile.</p>
      <button class="btn" style="margin-top:16px" onclick="Onboarding.step=3;Onboarding.render()">Continue</button>
      <button class="btn ghost" onclick="Onboarding.step=1;Onboarding.render()">Back</button>`;
  },

  addLink() {
    const type = document.getElementById('ob-link-type').value;
    let url = document.getElementById('ob-link-url').value.trim();
    if (!url) {
      url = { Calendly: 'https://calendly.com/you', Portfolio: 'https://you.design', LinkedIn: 'https://linkedin.com/in/you', Custom: 'https://example.com' }[type];
    }
    const label = { Calendly: 'Book a call', Portfolio: 'View portfolio', LinkedIn: 'LinkedIn', Custom: 'Website' }[type];
    this.draft.links.push({ id: Math.random().toString(36).slice(2), label, url, type, clicks: 0 });
    this.render();
  },
  rmLink(i) { this.draft.links.splice(i, 1); this.render(); },
  setColor(c) { this.draft.color = c; this.render(); },

  screen3() {
    return `${this.progress()}
      <h1>How do you want to share?</h1>
      <p class="sub">All of these work the moment you finish — no hardware required.</p>
      <div style="margin-top:16px">
        <div class="share-opt"><div class="feed-ic">▦</div><div><b>QR code</b><div class="sub">Generated instantly — they scan with their camera</div></div></div>
        <div class="share-opt"><div class="feed-ic">🔗</div><div><b>Link</b><div class="sub">Copy to clipboard, send anywhere</div></div></div>
        <div class="share-opt"><div class="feed-ic">◻</div><div><b>Add to home screen</b><div class="sub">Install Nexus like an app — no store needed</div></div></div>
      </div>
      <button class="btn" style="margin-top:16px" onclick="Onboarding.finish()">Make my card live</button>
      <button class="btn ghost" onclick="Onboarding.step=2;Onboarding.render()">Back</button>`;
  },

  async finish() {
    if (!this.draft.links.length) {
      this.draft.links = [
        { id: 'l1', label: 'Book a call', url: 'https://calendly.com/you', type: 'Calendly', clicks: 12 },
        { id: 'l2', label: 'View portfolio', url: 'https://you.design', type: 'Portfolio', clicks: 7 },
        { id: 'l3', label: 'LinkedIn', url: 'https://linkedin.com/in/you', type: 'LinkedIn', clicks: 4 },
      ];
    }
    try {
      await Store.completeOnboarding(this.draft);
    } catch (err) {
      toast('Could not create your card: ' + err.message);
      return;
    }
    document.getElementById('onboarding').classList.add('hidden');
    App.boot();
    toast('🎉 Your card is live — no verify-email gate, no profile nag');
  }
};
