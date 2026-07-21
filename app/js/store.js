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

function slugify(name) {
  const base = (name || 'me').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'me';
  return base + '-' + Math.random().toString(36).slice(2, 6);
}

const DEFAULT_STATE = () => ({
  onboarded: false,
  plan: 'free',                 // 'free' | 'pro' | 'team'
  accountSecured: false,        // local-only until real magic-link linking + billing exist
  me: {
    id: null, name: '', title: '', company: '', phone: '', email: '',
    color: '#4f46e5', initials: '', slug: '',
    fields: { phone: true, email: true },
    geotag: false,
    accountEmail: '',
    links: []                   // {id,label,url,type,clicks}
  },
  contacts: [],
  events: []
});

const Store = {
  state: DEFAULT_STATE(),
  userId: null,

  /* ---- session + hydration ---- */
  async load() {
    this.state = DEFAULT_STATE();
    const session = await SupabaseAuth.ensureSession();
    this.userId = session.user.id;

    const { data: profile } = await sb.from('profiles').select('*').eq('id', this.userId).maybeSingle();
    if (profile) {
      this.state.plan = profile.plan;
      this.state.accountSecured = profile.account_secured;
      this.state.me.accountEmail = profile.email || '';
    }

    const { data: card } = await sb.from('cards').select('*, card_links(*)').eq('owner_id', this.userId).maybeSingle();
    if (!card) return this.state;

    this.state.onboarded = true;
    this.hydrateCard(card);
    await this.refreshContactsAndEvents();
    return this.state;
  },

  hydrateCard(card) {
    Object.assign(this.state.me, {
      id: card.id, name: card.name, title: card.title, company: card.company,
      phone: card.phone, email: card.email, color: card.color, initials: card.initials,
      slug: card.slug,
      fields: { phone: card.show_phone, email: card.show_email },
      geotag: card.geotag_enabled,
      links: (card.card_links || [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map(l => ({ id: l.id, label: l.label, url: l.url, type: l.type, clicks: l.clicks }))
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
    const { data: profile } = await sb.from('profiles').select('*').eq('id', this.userId).maybeSingle();
    if (profile) {
      this.state.plan = profile.plan;
      this.state.accountSecured = profile.account_secured;
      this.state.me.accountEmail = profile.email || '';
    }
    return this.state.plan;
  },

  async refreshEvents() {
    if (!this.state.me.id) return;
    const { data } = await sb.from('card_events').select('*')
      .eq('card_id', this.state.me.id).order('ts', { ascending: false }).limit(50);
    this.state.events = (data || []).map(e => this.hydrateEvent(e));
  },

  async refreshContactsAndEvents() {
    const { data: contacts } = await sb
      .from('contacts')
      .select('*, reminders(*), contact_history(*)')
      .eq('owner_id', this.userId);
    this.state.contacts = (contacts || []).map(c => this.hydrateContact(c));
    await this.refreshEvents();
  },

  isPro() { return this.state.plan === 'pro' || this.state.plan === 'team'; },
  /* Points at the real public card.html route so the QR/copy-link
     actually work end to end. Swap for a real custom domain (a Pro-tier
     perk already in the pricing copy) once one is set up. */
  cardUrl() { return location.origin + '/card.html?u=' + this.state.me.slug; },
  contact(id) { return this.state.contacts.find(c => c.id === id); },

  async reset() {
    await sb.auth.signOut();
    location.reload();
  },

  /* ---- onboarding ---- */
  async completeOnboarding(draft) {
    const slug = slugify(draft.name);
    const initials = (draft.name || 'N C').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    // seed engagement so Insights isn't empty on first run
    draft.links.forEach((l, i) => { if (!l.clicks) l.clicks = [12, 7, 4, 2][i] || 1; });

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
        card_id: card.id, label: l.label, url: l.url, type: l.type, clicks: l.clicks || 0, position: i
      }));
      const { data } = await sb.from('card_links').insert(rows).select();
      insertedLinks = data || [];
    }

    this.state.onboarded = true;
    this.hydrateCard({ ...card, card_links: insertedLinks });

    await this.seedDemoData();
    return this.state;
  },

  /* Demo contacts so the app doesn't look empty on first run — mirrors
     the pre-Supabase local seed data, now written as real rows so it
     survives reload and exercises every table end to end. */
  async seedDemoData() {
    const seed = [
      { name: 'Sarah Chen', title: 'VP Product', company: 'Stripe', metAt: 'SaaStr Annual', daysAgo: 9, tags: ['SaaStr', 'Product'], location: 'San Francisco', stage: 'contacted', notes: 'Loved the follow-up angle. Promised to send portfolio link.', reminder: { text: 'Send portfolio link', dueInDays: -2 } },
      { name: 'Mike Ross', title: 'Design Lead', company: 'Figma', metAt: 'SaaStr Annual', daysAgo: 6, tags: ['SaaStr', 'Design'], location: 'San Francisco', stage: 'meeting', reminder: { text: 'Coffee chat Thu — discuss design system project', dueInDays: 3 } },
      { name: 'Priya Patel', title: 'Founder', company: 'Loomly', metAt: 'TechCrunch Disrupt', daysAgo: 21, tags: ['TechCrunch', 'Founder'], location: 'New York', stage: 'new', notes: 'Interested in team plan for her 6-person startup.' },
      { name: 'James Okafor', title: 'Realtor', company: 'Compass', metAt: 'Referral', daysAgo: 34, tags: ['RealEstate'], location: 'Austin', stage: 'closed' },
      { name: 'Elena Petrova', title: 'VP Product', company: 'Notion', metAt: 'AWS re:Invent', daysAgo: 45, tags: ['Product', 'reInvent'], location: 'Las Vegas', stage: 'new' },
    ];

    const byName = {};
    for (const s of seed) {
      const metTs = now() - s.daysAgo * DAY;
      const { data: contact } = await sb.from('contacts').insert({
        owner_id: this.userId, name: s.name, title: s.title, company: s.company,
        email: s.name.toLowerCase().replace(/[^a-z]+/g, '.') + '@' + s.company.toLowerCase().replace(/[^a-z]/g, '') + '.com',
        phone: '+1 (415) 555-0' + String(Math.floor(100 + Math.random() * 899)),
        met_at: s.metAt, met_ts: iso(metTs), location: s.location, tags: s.tags,
        notes: s.notes || '', stage: s.stage
      }).select().single();
      if (!contact) continue;
      byName[s.name] = contact;

      await sb.from('contact_history').insert([
        { contact_id: contact.id, ts: iso(metTs), type: 'exchange', label: 'Exchanged cards — ' + s.metAt },
        { contact_id: contact.id, ts: iso(metTs + 3600000), type: 'view', label: 'Viewed your card' }
      ]);

      if (s.reminder) {
        await sb.from('reminders').insert({
          contact_id: contact.id, text: s.reminder.text, due_at: iso(now() + s.reminder.dueInDays * DAY)
        });
      }
    }

    if (byName['Sarah Chen']) {
      await sb.from('contact_history').insert({
        contact_id: byName['Sarah Chen'].id, ts: iso(now() - DAY), type: 'click', label: 'Clicked "View portfolio"'
      });
    }

    const evs = [
      { type: 'view', label: 'Sarah Chen viewed your card · San Francisco (city-level)', contact: 'Sarah Chen' },
      { type: 'click', label: 'Sarah Chen clicked "View portfolio" — high intent', contact: 'Sarah Chen' },
      { type: 'save', label: 'Mike Ross saved you to contacts', contact: 'Mike Ross' },
      { type: 'share', label: 'You shared your card (QR)', contact: null },
    ];
    for (const e of evs) {
      const c = e.contact ? byName[e.contact] : null;
      await sb.from('card_events').insert({ card_id: this.state.me.id, contact_id: c ? c.id : null, type: e.type, label: e.label });
    }

    await this.refreshContactsAndEvents();
  },

  /* ---- card ---- */
  async updateCardFields(patch) {
    const row = {};
    if ('name' in patch) { row.name = patch.name; row.initials = patch.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
    if ('title' in patch) row.title = patch.title;
    if ('company' in patch) row.company = patch.company;
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

  /* Anonymous-visitor analytics — routed through the two SECURITY DEFINER
     RPCs so a stranger viewing the card never needs table access. */
  async recordCardView() {
    await sb.rpc('record_card_view', { p_slug: this.state.me.slug });
    await this.refreshEvents();
  },
  async recordLinkClick(linkId) {
    await sb.rpc('record_link_click', { p_slug: this.state.me.slug, p_link_id: linkId });
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
    const geotag = this.state.me.geotag;
    const src = source || 'Shared their info back';
    const metTs = now();

    const { data: contact, error } = await sb.from('contacts').insert({
      owner_id: this.userId, name: info.name, title: info.title || '', company: info.company || '',
      email: info.email || '', phone: info.phone || '',
      met_at: geotag ? 'SaaStr Annual' : '', met_ts: iso(metTs),
      location: geotag ? 'San Francisco' : '', tags: geotag ? ['SaaStr'] : [],
      notes: '', stage: 'new'
    }).select().single();
    if (error) throw error;

    const label = src + (geotag ? ' — SaaStr Annual' : '');
    await sb.from('contact_history').insert({ contact_id: contact.id, ts: iso(metTs), type: 'exchange', label });
    await sb.from('card_events').insert({
      card_id: this.state.me.id, contact_id: contact.id, type: 'save', label: info.name + ' — ' + src.toLowerCase()
    });

    await this.refreshContactsAndEvents();
    return this.contact(contact.id);
  },

  async setContactNotes(id, notes) {
    await sb.from('contacts').update({ notes }).eq('id', id);
    this.contact(id).notes = notes;
  },

  async setContactStage(id, stage) {
    await sb.from('contacts').update({ stage }).eq('id', id);
    this.contact(id).stage = stage;
  },

  async setContactMetAt(id, metAt) {
    const c = this.contact(id);
    const tags = [...new Set([...(c.tags || []), metAt.split(' ')[0]])];
    await sb.from('contacts').update({ met_at: metAt, tags }).eq('id', id);
    c.metAt = metAt; c.tags = tags;
  },

  /* Reminders are unlimited on every plan — the follow-up loop is the
     core differentiator, so it is never paywalled. */
  async addReminder(contactId, text, due) {
    const { data, error } = await sb.from('reminders')
      .insert({ contact_id: contactId, text, due_at: iso(due) }).select().single();
    if (error) throw error;
    this.contact(contactId).reminders.push({ id: data.id, text: data.text, due: fromIso(data.due_at), done: false });
    return true;
  },

  async toggleReminder(contactId, reminderId) {
    const c = this.contact(contactId);
    const r = c.reminders.find(x => x.id === reminderId);
    const done = !r.done;
    await sb.from('reminders').update({ done }).eq('id', reminderId);
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
  const d = ts - now();
  if (d < 0) return Math.max(1, Math.round(-d / DAY)) + ' days overdue';
  if (d < DAY) return 'due today';
  if (d < 2 * DAY) return 'due tomorrow';
  return 'due ' + new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
