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
      <label class="field"><span>Phone</span><input type="tel" id="ob-phone" autocomplete="tel" value="${esc(d.phone)}" oninput="Onboarding.formatPhone(this, event)" placeholder="+1 (415) 555-0100 or +44 7700 900123"></label>
      <label class="field"><span>Email</span><input type="email" id="ob-email" autocomplete="email" value="${esc(d.email)}" placeholder="alex@acme.com" onblur="Onboarding.inferCompany()"></label>
      <button class="btn" style="margin-top:8px" onclick="Onboarding.next1()">Continue</button>
      <button class="btn ghost" onclick="Onboarding.signInScreen()">Already have a card? Sign in</button>`;
  },

  /* The recovery door. Without it, screen 1 is the only door in the product
     and it always builds a NEW card: a returning user on a new phone gets
     onboarding, makes a second card under a second anonymous account, and
     their original card plus any printed QR keeps pointing at data they can
     no longer reach. Rendered into the onboarding container directly rather
     than as a fourth step, because it is an exit from the flow, not a stage
     of it -- this.step stays 1, so Back re-renders screen 1 unchanged. */
  signInScreen() {
    this.readFields();
    document.getElementById('onboarding').innerHTML = `
      <h1>Sign in to your card</h1>
      <p class="sub">Enter the email you secured your account with. We'll send a sign-in link — no password.</p>
      <label class="field"><span>Email</span><input type="email" id="si-email" autocomplete="email" value="${esc(this.draft.email)}" placeholder="you@company.com"></label>
      <button class="btn" id="si-send" onclick="Onboarding.sendSignIn(this)">Email me a sign-in link</button>
      <p class="sub" style="margin-top:12px;font-size:12px">Never added an email to your card? Then there is nothing to sign in to yet — the card lives only in the browser you made it in.</p>
      <button class="btn ghost" onclick="Onboarding.step=1;Onboarding.render()">← Back to setup</button>`;
  },

  async sendSignIn(btn) {
    const email = (document.getElementById('si-email').value || '').trim();
    if (!email.includes('@')) { toast('Enter a valid email'); return; }
    // Disabled while in flight: a double tap sends two links, and the first
    // one stops working the moment the second is issued.
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await SupabaseAuth.signIn(email);
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Email me a sign-in link';
      toast(err.message);
      return;
    }
    document.getElementById('onboarding').innerHTML = `
      <h1>Check your email</h1>
      <p class="sub">We sent a sign-in link to <b>${esc(email)}</b>. Open it and your card comes back with everything on it.</p>
      <p class="sub" style="margin-top:12px;font-size:12px">Open it on whichever device you want your card on — a new phone, a work laptop, anywhere. The link carries the session with it.</p>
      <button class="btn ghost" style="margin-top:14px" onclick="Onboarding.step=1;Onboarding.render()">← Back to setup</button>`;
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

  /* Phone input. Two defects, both of which reached the public card.

     1. It hard-assumed NANP. Every non-digit was stripped, a "+1 " prefix
        was forced back on, and the remaining digits were regrouped as
        (AAA) BBB-CCCC. Typing a real +44 7700 900123 came out as
        "+1 (447) 700-9001" -- a different, wrong, dialable number, and that
        is what got written to cards.phone, rendered on the public card and
        embedded in the vCard every visitor downloads. A formatter that
        cannot identify the country has no business regrouping the digits,
        so nanpGroup below returns the input untouched whenever it is not
        certain, and the "+1 " prefill on the field is gone.

     2. One backspace after any re-render wiped the whole number. The digit
        state lived in el.dataset.phoneDigits, and render() replaces the
        input element outright -- so after the company-inference toast, or
        adding a link and coming back, dataset was empty, and the first
        delete did ''.slice(0, -1) and cleared the field. State now lives in
        draft.phone (which survives render) and in el.value itself, and
        deletions are left exactly as the browser produced them: the reason
        dataset existed was that reformatting on delete fights the user for
        the caret, so the fix is not to reformat on delete at all. */
  formatPhone(el, ev) {
    const deleting = ev && typeof ev.inputType === 'string' && ev.inputType.startsWith('delete');
    // Reformatting mid-string moves the caret to the end, so only do it when
    // the caret is already there — i.e. the user is typing on the end.
    const atEnd = el.selectionStart === null || el.selectionStart === el.value.length;

    // Strip only what can never appear in a phone number, and allow "+"
    // solely in the leading position.
    let v = el.value.replace(/[^\d+()\-.\s]/g, '').replace(/(?!^)\+/g, '');
    if (!deleting && atEnd) v = this.nanpGroup(v);

    if (v !== el.value) {
      el.value = v;
      if (atEnd) { try { el.setSelectionRange(v.length, v.length); } catch (e) { /* not selectable */ } }
    }
    this.draft.phone = el.value.trim();
  },

  /* Returns value regrouped as a North American number, or value unchanged
     when that is not confidently what it is. The bar for "confidently" is
     deliberately high: guessing wrong publishes a number that reaches
     somebody else.

     Not NANP, left alone: any "+" followed by a country code other than 1;
     anything whose first digit is 0, since 0 is a trunk prefix across most
     of the world and never a NANP area code; anything with more digits than
     NANP has room for. Whatever country-code prefix the user typed is
     preserved rather than invented -- a bare 10-digit US number stays bare. */
  nanpGroup(value) {
    const raw = value.trim();
    const digits = raw.replace(/\D/g, '');
    const plus = raw.startsWith('+');
    if (plus && digits[0] !== '1') return value;
    if (!plus && digits.startsWith('0')) return value;

    const hasCc = digits[0] === '1' && (plus || digits.length === 11);
    const national = hasCc ? digits.slice(1) : digits;
    if (national.length > 10) return value;

    let out = plus ? '+1 ' : (hasCc ? '1 ' : '');
    if (national.length > 0) out += '(' + national.slice(0, 3);
    if (national.length >= 3) out += ')';
    if (national.length > 3) out += ' ' + national.slice(3, 6);
    if (national.length > 6) out += '-' + national.slice(6, 10);
    return out;
  },

  readFields() {
    const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : null; };
    ['name', 'title', 'company', 'phone', 'email'].forEach(k => {
      const val = v('ob-' + k);
      if (val !== null) this.draft[k] = val;
    });
    /* Punctuation with no digits in it ("+", "()") is not a phone number.
       This used to drop anything with one digit or fewer, which was there to
       discard the old forced "+1 " prefill; with the prefill gone, that rule
       would silently delete a number a user had genuinely half-typed. */
    if (!/\d/.test(this.draft.phone || '')) this.draft.phone = '';
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
    const url = document.getElementById('ob-link-url').value.trim();
    if (!url) {
      toast('Paste the link’s URL first — it goes on your public card.');
      return;
    }
    /* Same scheme check the edit sheet and the public card apply. Without it
       onboarding could publish a scheme-less link like "example.com", which
       public-card.js refuses to open — a dead button on the card, created at
       the one moment the user is least likely to go back and check. */
    if (!/^https?:\/\//i.test(url)) {
      toast('Links need to start with https:// so they open properly.');
      return;
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
    // No default links: anything here is published on the user's real,
    // public card, so an empty list must stay empty.
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
