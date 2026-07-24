# Supabase backend — local backup

Backend for Nexus Card. Project ref: `aryfefzkqqaaauyrddwp` · region ca-central-1 · https://aryfefzkqqaaauyrddwp.supabase.co

## What's here

- `migrations/` — every SQL migration applied to the live project, in order (19 as of 2026-07-23; trust the directory listing over this sentence). Together they define: `teams`/`team_members`, `profiles`, `cards`/`card_links`, `contacts`/`reminders`/`contact_history`, `card_events`, `subscriptions` (billing source of truth, zero client write access), the anon-callable SECURITY DEFINER RPCs (`get_public_card`, `record_card_view`, `record_link_click`, `submit_share_back` — note the earlier `public_cards` view was **dropped** in `20260722132540` in favour of `get_public_card`), `export_my_data`/`card_stats`, reminder-delivery schema + cron, plus lockdown/perf fixes and the identity-linking sync trigger.
- `functions/create-checkout-session/` — creates a Stripe Checkout Session for the caller.
- `functions/stripe-webhook/` — the only writer to `subscriptions`; verifies Stripe's signature and syncs plan/status.
- `functions/send-reminder-digest/` — cron-driven reminder email sweep (see its own section below).
- `functions/delete-account/` — authenticated self-service account erasure (cancels live Stripe subs, then deletes the auth user; the CASCADE chain removes all owned rows). The privacy policy promises this — a deploy without it ships that promise against a 404.

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
supabase functions deploy delete-account
supabase functions deploy send-reminder-digest --no-verify-jwt   # see reminder section for its secrets
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

Asset versioning is a build-time content hash, handled by
`scripts/version-assets.mjs` — it stamps `?v=<hash>` on every script/stylesheet
reference in `index.html`, `card.html`, `landing.html` and `sw.js`'s `SHELL`
array, and derives `CACHE_VERSION` in `sw.js` from the content of all shell
files. **Do not hand-edit or `sed` the `?v=` values** — they are hex hashes
now, not counters, and a numeric-only `sed` corrupts them.

After changing any JS/CSS/HTML in `app/`:

```bash
npm run version-assets   # rewrites the ?v= hashes + CACHE_VERSION
npm run check            # verifies versions are current, then runs tests
```

`npm run check` fails loudly on drift, and the pre-commit hook in `.githooks/`
re-stamps versions automatically — but hooks are per-clone opt-in:

```bash
git config core.hooksPath .githooks
```

Miss the re-stamp and returning visitors get a half-updated app: some files
fresh, some served from the previous service-worker cache, producing bugs that
do not reproduce locally. This drifted once under the old hand-edited scheme
(`card.html` at `v=2` while `index.html` was at `v=3`, so the shared
`supabase-client.js` was cached under two URLs) — that's why it's a script now.

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
