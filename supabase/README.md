# Supabase backend — local backup

Backend for Nexus Card. Project ref: `aryfefzkqqaaauyrddwp` · region ca-central-1 · https://aryfefzkqqaaauyrddwp.supabase.co

## What's here

- `migrations/` — all 11 SQL migrations applied to the live project, in order. Together they define: `teams`/`team_members`, `profiles`, `cards`/`card_links` (+ the `public_cards` safe-read view), `contacts`/`reminders`/`contact_history`, `card_events` (+ the `record_card_view`/`record_link_click` anon RPCs), `subscriptions` (billing source of truth, zero client write access), plus lockdown/perf fixes and the identity-linking sync trigger.
- `functions/create-checkout-session/` — creates a Stripe Checkout Session for the caller.
- `functions/stripe-webhook/` — the only writer to `subscriptions`; verifies Stripe's signature and syncs plan/status.

## What's NOT here (cloud-only, no local copy)

- **All real data** — every card, contact, subscription row. Only `supabase db dump` or the dashboard can get this.
- **Edge Function secrets**: `NEXUS_STRIPE_SECRET_KEY`, `NEXUS_STRIPE_WEBHOOK_SECRET`, plus the three price IDs — `NEXUS_PRICE_PRO_MONTHLY`, `NEXUS_PRICE_PRO_YEARLY`, `NEXUS_PRICE_TEAM_MONTHLY`. Set at Project Settings → Edge Functions → Secrets. (Named `NEXUS_*` rather than the plain `STRIPE_*` because this project reserves those names for a platform-managed key — see the comment at the top of `stripe-webhook/index.ts`.)
- **Auth config**: Anonymous Sign-Ins must be enabled (Authentication → Sign In / Providers → Anonymous) — this is what lets onboarding stay zero-friction while every row still gets a real owner.
- **Stripe setup** (account `acct_1Tv0mdChHr9GMVU2`, test mode): Products/Prices for Pro Monthly ($6), Pro Yearly ($49), Team per-seat ($8). Price IDs are **not** in code — they come from the `NEXUS_PRICE_*` Edge Function secrets and are read by `functions/_shared/plans.ts`, which is the single source of truth for both directions (tier→price for Checkout, price→plan for the webhook). The frontend passes tier keys (`pro_monthly`, etc.), never price IDs. A webhook destination pointed at `.../functions/v1/stripe-webhook`, listening for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.

## Restoring / redeploying elsewhere

With the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref <new-project-ref>
supabase db push                                    # applies migrations/ in order
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt
# Use --env-file rather than inline values: anything typed here lands in
# shell history and in the process list.
supabase secrets set --env-file ./supabase/.env.secrets
```

`.env.secrets` (git-ignored) should contain:

```
NEXUS_STRIPE_SECRET_KEY=sk_test_...
NEXUS_STRIPE_WEBHOOK_SECRET=whsec_...
NEXUS_PRICE_PRO_MONTHLY=price_...
NEXUS_PRICE_PRO_YEARLY=price_...
NEXUS_PRICE_TEAM_MONTHLY=price_...
```

Then recreate the Stripe products/prices and webhook destination (see above), set the `NEXUS_PRICE_*` secrets to the new IDs, and enable Anonymous Sign-Ins in the new project's Auth settings.

## Reminder delivery (required for follow-ups to actually fire)

`functions/send-reminder-digest/` is swept every 15 minutes by `pg_cron`, which
calls `public.trigger_reminder_sweep()`, which POSTs to the function via `pg_net`.
The cron job is already scheduled and active. **It is a no-op until the
configuration below exists** — deliberately, so an unconfigured project doesn't
log a failure every quarter hour.

**1. Vault secrets** (tells cron where to POST and how to authenticate):

```sql
select vault.create_secret('https://aryfefzkqqaaauyrddwp.functions.supabase.co/send-reminder-digest', 'nexus_sweep_url');
select vault.create_secret('<generate a long random string>', 'nexus_sweep_secret');
```

**2. Edge Function secrets** — `NEXUS_SWEEP_SECRET` must equal the vault value:

```
NEXUS_RESEND_API_KEY=re_...
NEXUS_SWEEP_SECRET=<same random string as above>
NEXUS_REMINDER_FROM=Nexus Card <reminders@yourdomain.com>
NEXUS_APP_URL=https://yourdomain.com
```

**3. Deploy** (`--no-verify-jwt`: cron authenticates with the shared secret, not a JWT):

```bash
supabase functions deploy send-reminder-digest --no-verify-jwt
```

**4. Verify a real send** — point a reminder at the past and force a sweep:

```sql
update public.reminders set due_at = now() - interval '1 minute', notified_at = null
 where id = '<some reminder id>';
select public.trigger_reminder_sweep();
-- then check notified_at got stamped:
select id, notified_at from public.reminders where id = '<some reminder id>';
```

**Behaviour worth knowing:**
- Only users with a **confirmed** email (`profiles.account_secured`) are mailed. Anonymous accounts have no address; reminders stay pending until one is linked.
- `notified_at` is stamped **only after** a successful send, so a Resend outage retries next sweep rather than silently dropping the reminder.
- Quiet hours: nothing sends outside 08:00–20:00 in `profiles.timezone` (set by the client from the browser), unless the reminder is already >36h overdue — so a bad timezone can't strand someone's follow-ups forever.
- Resend requires a **verified sending domain** before it will deliver to arbitrary addresses.

## Deploying the frontend (there is a manual step, and it bites)

`app/` is static — copy it to any host, publish directory `app/`.

**Three things must be bumped together on every deploy that changes a JS or CSS file:**

1. the `?v=N` query strings in `app/index.html` and `app/card.html`
2. `CACHE_VERSION` in `app/sw.js`
3. the matching `?v=N` inside `sw.js`'s `SHELL` array

Miss any one and returning visitors get a half-updated app: some files fresh,
some served from the previous service-worker cache, producing bugs that do not
reproduce locally and cannot be diagnosed from the outside. This has already
drifted once (`card.html` sat at `v=2` while `index.html` was at `v=3`, so the
shared `supabase-client.js` was cached under two URLs).

This should be a build-time content hash rather than three hand-edited numbers.
Until it is, a `sed` across all three is the safe way:

```bash
cd app && sed -i '' 's/?v=[0-9]*/?v=NEW/g' index.html card.html landing.html sw.js && sed -i '' 's/nexus-shell-v[0-9]*/nexus-shell-vNEW/' sw.js
```

Note `landing.html` is in that list: the CSS files carry `?v=N` too. They did
not until recently, which meant every stylesheet change was served stale to
returning visitors indefinitely — the HTML cache-busted its scripts and left
its stylesheets alone.

Watch the `sed` — it also rewrites `?v=N` inside `sw.js`'s own comments. Check
`git diff` before committing.

The service worker caches **only the app shell** — never Supabase responses.
Contacts, reminders and card data are mutable and shared across devices, so a
stale cached copy would be indistinguishable from real data. Verified in the
browser: 17 shell entries, zero cross-origin, zero API responses.

## Going live (test → live mode)

The failure mode this checklist exists to prevent: live-mode price IDs differ from test-mode ones, and an unmapped price used to fall back to `plan: "free"` — silently downgrading every paying customer. That fallback now throws instead, so a missed step fails loudly rather than quietly.

1. Rotate `NEXUS_STRIPE_SECRET_KEY` to the `sk_live_` key.
2. Create the products/prices in live mode and set all three `NEXUS_PRICE_*` secrets to the live IDs.
3. Create a **new** webhook destination against the live endpoint and set `NEXUS_STRIPE_WEBHOOK_SECRET` to its new `whsec_`.
4. Redeploy both functions so they pick up the new secrets.
5. Run one real test purchase end to end and confirm `subscriptions` and `profiles.plan` both update.
