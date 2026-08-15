/* Nexus Card — data layer, backed by Supabase (Postgres + Auth).
   Store.state keeps the exact in-memory shape the UI already renders
   from; every mutator persists to Supabase first, then updates state
   from the canonical row before the caller re-renders. Owner-driven
   edits (forms, checkboxes, drag-drop) are awaited before re-render;
   pure analytics logging (share/view/click) fires in the background so
   the UI never blocks on it. */
const DAY = 86400000;
const now = () => Date.now();
const iso = (msVal) => new Date(msVal).toISOString();
const fromIso = (isoStr) => (isoStr ? new Date(isoStr).getTime() : null);

/* Slug suffix alphabet: a-z minus l and o, digits 2-9. Exactly 32 symbols,
   which matters twice. It is a power of two, so (byte & 31) is uniform --
   the obvious `byte % 36` over base36 would over-select the first four
   symbols by ~14% and quietly hand back some of the entropy this is here to
   buy. And dropping the l/1/o/0 look-alikes keeps a slug readable off a
   printed card or dictatable over a phone. */
const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/* The old suffix was Math.random().toString(36).slice(2, 6): four base36
   characters, ~1.68M possibilities, hanging off a base anyone can guess from
   a name ("sam-smith-"). get_public_card is anon-callable and returns phone
   and email, so that is a walkable keyspace -- a name list plus a few hours
   of requests is bulk PII harvesting, not a lucky guess. Math.random is also
   not a CSPRNG: V8 seeds xorshift128+ per context, and a handful of observed
   outputs is enough to recover the state and predict the rest, so a user who
   made a card in the same session as the attacker leaks their slug outright.

   16 symbols x 5 bits = 80 bits, from crypto.getRandomValues. Available in
   every browser this app supports and in Node 19+ (only crypto.subtle is
   gated behind a secure context, not getRandomValues). */
function randomSlugSuffix(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += SLUG_ALPHABET[bytes[i] & 31];
  return out;
}

function slugify(name) {
  const base = (name || 'me').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'me';
  /* Only NEW cards get the long suffix. Existing slugs are deliberately left
     alone: they are already printed on QR codes, badges and paper cards that
     cannot be recalled, so rotating them would break links that are out in
     the world -- trading a guessing risk for a certainty. See
     fixes/README.md for the back-compat options and what they cost. */
  return base + '-' + randomSlugSuffix(16);
}

/* [...w][0] rather than w[0]: string indexing works on UTF-16 code units,
   so an emoji or any astral-plane character yields a lone surrogate, which
   renders as U+FFFD and cannot be encoded as valid UTF-8 for Postgres. */
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  // Both the per-word pick and the 2-character cap must count graphemes, not
  // UTF-16 code units: [...] for the pick (w[0] on an emoji yields a lone
  // surrogate, invalid UTF-8 for Postgres) and slice(0,2) on the array
  // rather than the string (an emoji is 2 code units, so a string slice
  // would consume both slots).
  const chars = parts.map(w => [...w][0]).filter(Boolean).slice(0, 2);
  return (chars.join('') || 'NC').toUpperCase();
}

const DEFAULT_STATE = () => ({
  onboarded: false,
  plan: 'free',                 // 'free' | 'pro' | 'team'
  accountSecured: false,        // local-only until real magic-link linking + billing exist
  me: {
    id: null, name: '', title: '', company: '', phone: '', email: '',
    phoneAlt: '', phoneLabel: 'Mobile', phoneAltLabel: 'Work',
    color: '#0891b2', initials: '', slug: '', photoUrl: '',
    fields: { phone: true, email: true, phoneAlt: true },
    geotag: false,
    accountEmail: '',
    links: []                   // {id,label,url,type,clicks}
  },
  contacts: [],
  events: [],
  stats: null              // server-side aggregate; see refreshStats()
});

const Store = {
  state: DEFAULT_STATE(),
  userId: null,

  /* ---- session + hydration ---- */
  async load() {
    this.state = DEFAULT_STATE();
    const session = await SupabaseAuth.ensureSession();
    this.userId = session.user.id;

    const { data: profile, error: profileErr } = await sb.from('profiles').select('*').eq('id', this.userId).maybeSingle();
    if (profileErr) throw profileErr;
    if (profile) {
      this.state.plan = profile.plan;
      this.state.accountSecured = profile.account_secured;
      this.state.me.accountEmail = profile.email || '';
    }

    /* A failed read must never look like "no card yet" — that would drop an
       existing user into onboarding, and completing it violates the
       one-card-per-owner unique index and strands them on a raw Postgres
       error. Only a successful query returning no row means first run. */
    const { data: card, error: cardErr } = await sb.from('cards').select('*, card_links(*)').eq('owner_id', this.userId).maybeSingle();
    if (cardErr) throw cardErr;
    if (!card) return this.state;

    this.state.onboarded = true;
    this.hydrateCard(card);
    await this.refreshContactsAndEvents();
    this.syncTimezone();
    return this.state;
  },

  /* The reminder sweep runs server-side and needs to know whether it is a
     reasonable hour to email this user. Fire-and-forget: a failure here
     must never block boot, and the server falls back to UTC. */
  syncTimezone() {
    let tz;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return; }
    if (!tz) return;
    Promise.resolve(sb.rpc('set_my_timezone', { p_tz: tz }))
      .catch(err => console.warn('timezone sync failed', err));
  },

  hydrateCard(card) {
    Object.assign(this.state.me, {
      id: card.id, name: card.name, title: card.title, company: card.company,
      phone: card.phone, email: card.email, color: card.color, initials: card.initials,
      slug: card.slug, photoUrl: card.photo_url || '',
      phoneAlt: card.phone_alt || '',
      phoneLabel: card.phone_label || 'Mobile',
      phoneAltLabel: card.phone_alt_label || 'Work',
      fields: { phone: card.show_phone, email: card.show_email, phoneAlt: card.show_phone_alt },
      geotag: card.geotag_enabled,
      links: (card.card_links || [])
        .slice()
        .sort((a, b) => a.position - b.position)
        // position is carried through (not just used to sort) so addLink can
        // append after the real highest position rather than guessing from
        // the array length, which drifts as soon as anything is removed.
        .map(l => ({ id: l.id, label: l.label, url: l.url, type: l.type, clicks: l.clicks, position: l.position }))
    });
  },

  hydrateContact(c) {
    return {
      id: c.id, name: c.name, title: c.title, company: c.company,
      email: c.email, phone: c.phone, metAt: c.met_at, metTs: fromIso(c.met_ts),
      location: c.location, tags: c.tags || [], notes: c.notes, stage: c.stage,
      reminders: (c.reminders || []).map(r => ({ id: r.id, text: r.text, due: fromIso(r.due_at), done: r.done })),
      history: (c.contact_history || []).map(h => ({ ts: fromIso(h.ts), type: h.type, label: h.label }))
    };
  },

  hydrateEvent(e) {
    return { id: e.id, ts: fromIso(e.ts), type: e.type, label: e.label, contactId: e.contact_id };
  },

  /* Re-reads entitlement after returning from Stripe Checkout — the
     webhook, not this call, is what actually changes the plan. */
  async refreshProfile() {
    const { data: profile, error } = await sb.from('profiles').select('*').eq('id', this.userId).maybeSingle();
    if (error) throw error;
    if (profile) {
      this.state.plan = profile.plan;
      this.state.accountSecured = profile.account_secured;
      this.state.me.accountEmail = profile.email || '';
    }
    return this.state.plan;
  },

  /* Server-side aggregate over a real date window. The old numbers were
     derived from the 50-row event feed, so they plateaued and then declined
     as older events scrolled out. Cached on state so the Insights render
     stays synchronous. */
  async refreshStats(days) {
    const { data, error } = await sb.rpc('card_stats', { p_days: days || 30 });
    if (error) throw error;
    this.state.stats = data;
    return data;
  },

  async refreshEvents() {
    if (!this.state.me.id) return;
    const { data, error } = await sb.from('card_events').select('*')
      .eq('card_id', this.state.me.id).order('ts', { ascending: false }).limit(50);
    if (error) throw error;
    this.state.events = (data || []).map(e => this.hydrateEvent(e));
  },

  async refreshContactsAndEvents() {
    /* Without the error check a failed fetch renders "0 people" — silently
       telling the user their entire contact list is gone. */
    const { data: contacts, error } = await sb
      .from('contacts')
      .select('*, reminders(*), contact_history(*)')
      .eq('owner_id', this.userId);
    if (error) throw error;
    this.state.contacts = (contacts || []).map(c => this.hydrateContact(c));
    await this.refreshEvents();
    // Non-fatal: the feed still renders if the aggregate fails.
    try { await this.refreshStats(30); } catch (err) { console.warn('stats unavailable', err); }
  },

  isPro() { return this.state.plan === 'pro' || this.state.plan === 'team'; },

  /* Compact plan status, shared across My Card / Contacts / Pipeline so a
     paying user can see the payment "took" without hunting for it in
     Insights — the only place it showed before. Deliberately just the
     plan + a link to Paywall, not the fuller box in analytics.js (which
     also carries the account-recovery nudge); repeating that on every tab
     would be nagging, not reassurance. */
  planFooter() {
    const pro = this.isPro();
    const label = this.state.plan === 'team' ? 'Nexus Team' : pro ? 'Nexus Pro' : 'Free plan';
    return `
      <p class="section-label">Your plan</p>
      <div class="card-box row">
        <div style="flex:1"><b>${label}</b>${pro ? '' : '<div class="sub">Unlimited reminders included — always</div>'}</div>
        ${pro ? '<span class="pill brand">Active</span>' : ''}
        <button class="btn small secondary" onclick="Paywall.open()">${pro ? 'Manage' : 'Upgrade'}</button>
      </div>`;
  },
  /* Points at the real public card.html route so the QR/copy-link
     actually work end to end. Swap for a real custom domain (a Pro-tier
     perk already in the pricing copy) once one is set up. */
  cardUrl() { return location.origin + '/card.html?u=' + this.state.me.slug; },
  contact(id) { return this.state.contacts.find(c => c.id === id); },

  /* GDPR Art. 20 / CCPA portability. privacy.html promises this is available
     in-app, and terms.html tells users not to treat Nexus as their only copy
     because "export features exist for a reason" — so one has to exist. */
  async exportMyData() {
    const { data, error } = await sb.rpc('export_my_data');
    if (error) throw error;
    return data;
  },

  /* GDPR Art. 17 erasure. Genuinely deletes: the Edge Function cancels any
     live Stripe subscription, then removes the auth user, which cascades to
     every table. This replaces reset(), which called signOut() on an
     anonymous session — leaving the rows in Postgres, orphaned under an id
     that existed only in that browser. That destroyed access without
     destroying data, which is the opposite of what a delete should do. */
  async deleteAccount() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Not signed in — reload and try again.');
    const res = await fetch(SUPABASE_URL + '/functions/v1/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({ confirm: 'DELETE' })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(body.error || 'Could not delete the account.');
    await sb.auth.signOut();
  },

  /* ---- onboarding ---- */
  async completeOnboarding(draft) {
    const slug = slugify(draft.name);
    const initials = initialsOf(draft.name);

    const { data: card, error } = await sb.from('cards').insert({
      owner_id: this.userId, slug,
      name: draft.name, title: draft.title, company: draft.company,
      phone: draft.phone, email: draft.email, color: draft.color, initials,
      show_phone: draft.fields.phone, show_email: draft.fields.email,
      geotag_enabled: draft.geotag
    }).select().single();
    if (error) throw error;

    let insertedLinks = [];
    if (draft.links.length) {
      const rows = draft.links.map((l, i) => ({
        card_id: card.id, label: l.label, url: l.url, type: l.type, clicks: 0, position: i
      }));
      const { data, error: linkErr } = await sb.from('card_links').insert(rows).select();
      if (linkErr) throw linkErr;
      insertedLinks = data || [];
    }

    this.state.onboarded = true;
    this.hydrateCard({ ...card, card_links: insertedLinks });
    return this.state;
  },

  /* ---- card ---- */
  async updateCardFields(patch) {
    const row = {};
    if ('name' in patch) { row.name = patch.name; row.initials = initialsOf(patch.name); }
    if ('title' in patch) row.title = patch.title;
    if ('company' in patch) row.company = patch.company;
    /* phone and email had no branch at all, so the edit sheet could not have
       saved them even if it had offered the inputs: a mistyped email was
       permanent short of deleting the account, and it is the address printed
       on the public card and written into every downloaded vCard. */
    if ('phone' in patch) row.phone = patch.phone;
    if ('email' in patch) row.email = patch.email;
    if ('phoneAlt' in patch) row.phone_alt = patch.phoneAlt;
    if ('phoneLabel' in patch) row.phone_label = patch.phoneLabel;
    if ('phoneAltLabel' in patch) row.phone_alt_label = patch.phoneAltLabel;
    if ('showPhoneAlt' in patch) row.show_phone_alt = patch.showPhoneAlt;
    if ('color' in patch) row.color = patch.color;
    if ('showPhone' in patch) row.show_phone = patch.showPhone;
    if ('showEmail' in patch) row.show_email = patch.showEmail;
    if ('geotag' in patch) row.geotag_enabled = patch.geotag;

    const { data, error } = await sb.from('cards').update(row)
      .eq('id', this.state.me.id).select('*, card_links(*)').single();
    if (error) throw error;
    this.hydrateCard(data);
    return this.state.me;
  },

  /* ---- card photo ----
     A face is what someone actually remembers after a conference; initials
     are the fallback, not the goal. */

  PHOTO_PX: 400,

  /* Resizes and re-encodes to a square JPEG before anything is uploaded.
     This is not an optimisation, it is a requirement: a current phone
     camera produces 3-5 MB, and the public card is the one page that has
     to appear instantly for a stranger on venue wifi holding someone
     else's QR code. 400px square lands around 40 KB.

     Re-encoding also strips EXIF, which matters more than the bytes: phone
     photos carry GPS coordinates, and this image is published on a page
     anyone with the link can open. Nobody uploading a headshot expects to
     publish where it was taken. Drawing through a canvas discards all of
     it because only pixels survive the round trip. */
  async resizePhoto(file) {
    if (!/^image\//.test(file.type)) throw new Error('That file is not an image.');
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);   // centre square crop
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const px = this.PHOTO_PX;
    const canvas = document.createElement('canvas');
    canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, px, px);
    bitmap.close?.();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Could not process that image.');
    return blob;
  },

  async uploadPhoto(file) {
    if (!this.state.me.id) throw new Error('No card yet — finish setup first.');
    const blob = await this.resizePhoto(file);

    /* Path must start with the owner's uid: the storage policies check
       (storage.foldername(name))[1] against auth.uid(), so any other
       shape is rejected. The random suffix is what makes replacing a
       photo take effect — a fixed filename would be served from the CDN
       cache under the same URL and the user would swear it had not
       changed. */
    const oldUrl = this.state.me.photoUrl;
    const path = `${this.userId}/${Math.random().toString(36).slice(2)}${Date.now().toString(36)}.jpg`;
    const { error: upErr } = await sb.storage.from('card-photos')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (upErr) throw upErr;

    const { data: pub } = sb.storage.from('card-photos').getPublicUrl(path);
    const photoUrl = pub.publicUrl;

    const { data, error } = await sb.from('cards').update({ photo_url: photoUrl })
      .eq('id', this.state.me.id).select('*, card_links(*)').single();
    if (error) {
      // Roll the object back rather than leaving one nothing points at.
      await sb.storage.from('card-photos').remove([path]).catch(() => {});
      throw error;
    }
    this.hydrateCard(data);
    // Best-effort: the new photo is already live, so a failure to clear
    // the previous one must not surface as a failed upload.
    if (oldUrl) this._removePhotoObject(oldUrl);
    return this.state.me;
  },

  async removePhoto() {
    const oldUrl = this.state.me.photoUrl;
    const { data, error } = await sb.from('cards').update({ photo_url: null })
      .eq('id', this.state.me.id).select('*, card_links(*)').single();
    if (error) throw error;
    this.hydrateCard(data);
    if (oldUrl) this._removePhotoObject(oldUrl);
    return this.state.me;
  },

  /* Turns a public URL back into the object path and deletes it. Storage
     is not covered by any CASCADE, so without this every replaced photo
     stays in the bucket permanently, still publicly readable. */
  _removePhotoObject(url) {
    const marker = '/card-photos/';
    const i = url.indexOf(marker);
    if (i === -1) return;
    const path = url.slice(i + marker.length).split('?')[0];
    sb.storage.from('card-photos').remove([path])
      .catch(err => console.warn('old card photo not removed', err));
  },

  /* Links could only ever be created during onboarding — there was no add
     and no remove anywhere in the app. A Calendly that moved, or a URL with
     a typo in it, was a permanently broken button on the user's public card.

     Appended after the current highest position rather than renumbering the
     whole set: the public card orders by position, and rewriting every row
     on each add would churn rows for no visible gain. */
  async addLink(link) {
    if (!this.state.me.id) throw new Error('No card yet — finish setup first.');
    const position = this.state.me.links.reduce((m, l) => Math.max(m, Number(l.position) || 0), -1) + 1;
    const { data, error } = await sb.from('card_links').insert({
      card_id: this.state.me.id, label: link.label, url: link.url, type: link.type, clicks: 0, position
    }).select().single();
    if (error) throw error;
    this.state.me.links.push({
      id: data.id, label: data.label, url: data.url, type: data.type, clicks: data.clicks, position: data.position
    });
    return data;
  },

  /* card_id is in the filter as well as id. RLS already restricts this to
     the owner's own links, but a delete whose only predicate is a client-
     supplied id is one policy regression away from deleting someone else's
     row, and the extra term costs nothing. */
  async removeLink(id) {
    const { error } = await sb.from('card_links').delete().eq('id', id).eq('card_id', this.state.me.id);
    if (error) throw error;
    this.state.me.links = this.state.me.links.filter(l => l.id !== id);
  },

  /* Anonymous-visitor analytics — routed through the two SECURITY DEFINER
     RPCs so a stranger viewing the card never needs table access. */
  async recordCardView() {
    await sb.rpc('record_card_view', { p_slug: this.state.me.slug });
    await this.refreshEvents();
  },
  async recordLinkClick(linkId) {
    /* Only increment locally if the RPC actually landed — otherwise the
       Insights bar chart drifts upward from reality on every failed call. */
    const { error } = await sb.rpc('record_link_click', { p_slug: this.state.me.slug, p_link_id: linkId });
    if (error) throw error;
    const link = this.state.me.links.find(l => l.id === linkId);
    if (link) link.clicks++;
    await this.refreshEvents();
  },
  /* Owner-driven share logging — a normal owner-scoped insert, since this
     is the card owner acting on their own card. */
  async logShare(label) {
    if (!this.state.me.id) return;
    await sb.from('card_events').insert({ card_id: this.state.me.id, type: 'share', label });
    await this.refreshEvents();
  },

  /* ---- contacts ---- */
  /* Create a contact from the recipient's "share your info back" form (or
     a paper-card scan). `info` = {name,title,company,email,phone}; metAt
     comes from geotag auto-detection when opted in, otherwise blank. */
  async addContactFromShareBack(info, source) {
    const src = source || 'Shared their info back';
    const metTs = now();

    /* met_at / location are left blank for the user to fill in. They were
       previously hardcoded to 'SaaStr Annual' / 'San Francisco' whenever
       the geotag toggle was on -- writing invented event and city data into
       real contact records, and backing a "city-level location" claim the
       product made to every card viewer but never actually collected. */
    const { data: contact, error } = await sb.from('contacts').insert({
      owner_id: this.userId, name: info.name, title: info.title || '', company: info.company || '',
      email: info.email || '', phone: info.phone || '',
      met_at: '', met_ts: iso(metTs),
      location: '', tags: [],
      notes: '', stage: 'new'
    }).select().single();
    if (error) throw error;

    const label = src;
    await sb.from('contact_history').insert({ contact_id: contact.id, ts: iso(metTs), type: 'exchange', label });
    /* 'contact_added', not 'save'. This path is the OWNER adding someone —
       "Add a contact" in the Contacts tab, and the in-app "Simulate a scan".
       'save' is reserved for a visitor sharing their info back through
       submit_share_back. They were the same event type, which meant the
       share-back rate limit — which counted 'save' rows on the card — was
       tripped by the owner's own data entry: typing in twenty business
       cards after a conference locked inbound share-backs out of your own
       card for the next ten minutes. See
       supabase/migrations/20260808090000_share_back_rate_limit_fix.sql;
       card_stats counts both values, so Insights does not change. */
    /* Checked, not fire-and-forget. supabase-js RESOLVES with {error} rather
       than rejecting, so an unchecked insert here fails invisibly — and the
       failure this guards against is specific: if this JS ever runs against a
       database that predates the migration above, 'contact_added' violates
       card_events_type_check, the contact still saves, the user sees success,
       and only the activity event silently vanishes. Surfacing it turns a
       deploy-ordering mistake into something you can actually see. */
    const { error: evErr } = await sb.from('card_events').insert({
      card_id: this.state.me.id, contact_id: contact.id, type: 'contact_added', label: info.name + ' — ' + src.toLowerCase()
    });
    if (evErr) throw evErr;

    await this.refreshContactsAndEvents();
    return this.contact(contact.id);
  },

  /* supabase-js resolves with {error} rather than rejecting, so an
     unchecked `await` treats a 403/500/offline write as success and the
     caller fires a "✓ Saved" toast over data that was never persisted. */
  async setContactNotes(id, notes) {
    const { error } = await sb.from('contacts').update({ notes }).eq('id', id);
    if (error) throw error;
    const c = this.contact(id);
    if (c) c.notes = notes;
  },

  async setContactStage(id, stage) {
    const { error } = await sb.from('contacts').update({ stage }).eq('id', id);
    if (error) throw error;
    const c = this.contact(id);
    if (c) c.stage = stage;
  },

  async setContactMetAt(id, metAt) {
    const c = this.contact(id);
    if (!c) throw new Error('Contact not found — try reloading.');
    const tags = [...new Set([...(c.tags || []), metAt.split(' ')[0]])];
    const { error } = await sb.from('contacts').update({ met_at: metAt, tags }).eq('id', id);
    if (error) throw error;
    c.metAt = metAt; c.tags = tags;
  },

  /* Reminders are unlimited on every plan — the follow-up loop is the
     core differentiator, so it is never paywalled. */
  async addReminder(contactId, text, due) {
    const { data, error } = await sb.from('reminders')
      .insert({ contact_id: contactId, text, due_at: iso(due) }).select().single();
    if (error) throw error;
    const c = this.contact(contactId);
    if (c) c.reminders.push({ id: data.id, text: data.text, due: fromIso(data.due_at), done: false });
    return true;
  },

  async toggleReminder(contactId, reminderId) {
    const c = this.contact(contactId);
    if (!c) throw new Error('Contact not found — try reloading.');
    const r = c.reminders.find(x => x.id === reminderId);
    if (!r) throw new Error('Reminder not found — try reloading.');
    const done = !r.done;
    const { error } = await sb.from('reminders').update({ done }).eq('id', reminderId);
    if (error) throw error;
    r.done = done;
    if (done) {
      const label = 'Completed: "' + r.text + '"';
      await sb.from('contact_history').insert({ contact_id: contactId, type: 'reminder_done', label });
      await sb.from('card_events').insert({ card_id: this.state.me.id, contact_id: contactId, type: 'reminder_done', label });
      await this.refreshContactsAndEvents();
    }
  },

  dueReminders() {
    const out = [];
    this.state.contacts.forEach(c => c.reminders.forEach(r => {
      if (!r.done) out.push({ contact: c, reminder: r });
    }));
    return out.sort((a, b) => a.reminder.due - b.reminder.due);
  }
};

/* ---- shared formatting helpers ---- */
function fmtAgo(ts) {
  const d = now() - ts;
  if (d < 3600000) return Math.max(1, Math.round(d / 60000)) + 'm ago';
  if (d < DAY) return Math.round(d / 3600000) + 'h ago';
  if (d < 30 * DAY) return Math.round(d / DAY) + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtDue(ts) {
  /* Buckets on calendar days in the viewer's own timezone, not on elapsed
     milliseconds. Comparing (due - now) against 24h meant a reminder due at
     8am tomorrow read "due today" when checked at 11pm — and anything less
     than a day overdue rendered as "1 days overdue", both wrong and
     ungrammatical. setHours works in local time, which is what the user
     reasons in; due_at itself stays an absolute timestamptz. */
  const startOfDay = (t) => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const days = Math.round((startOfDay(ts) - startOfDay(now())) / DAY);
  if (ts < now()) {
    if (days === 0) return 'overdue';
    const n = Math.abs(days);
    return n + (n === 1 ? ' day overdue' : ' days overdue');
  }
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return 'due ' + new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
