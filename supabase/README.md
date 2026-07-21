# Supabase backend — local backup

Backend for Nexus Card. Project ref: `aryfefzkqqaaauyrddwp` · region ca-central-1 · https://aryfefzkqqaaauyrddwp.supabase.co

## What's here

- `migrations/` — all 11 SQL migrations applied to the live project, in order. Together they define: `teams`/`team_members`, `profiles`, `cards`/`card_links` (+ the `public_cards` safe-read view), `contacts`/`reminders`/`contact_history`, `card_events` (+ the `record_card_view`/`record_link_click` anon RPCs), `subscriptions` (billing source of truth, zero client write access), plus lockdown/perf fixes and the identity-linking sync trigger.
- `functions/create-checkout-session/` — creates a Stripe Checkout Session for the caller.
- `functions/stripe-webhook/` — the only writer to `subscriptions`; verifies Stripe's signature and syncs plan/status.

## What's NOT here (cloud-only, no local copy)

- **All real data** — every card, contact, subscription row. Only `supabase db dump` or the dashboard can get this.
- **Edge Function secrets**: `NEXUS_STRIPE_SECRET_KEY`, `NEXUS_STRIPE_WEBHOOK_SECRET`. Set at Project Settings → Edge Functions → Secrets. (Named `NEXUS_*` rather than the plain `STRIPE_*` because this project reserves those names for a platform-managed key — see the comment at the top of `stripe-webhook/index.ts`.)
- **Auth config**: Anonymous Sign-Ins must be enabled (Authentication → Sign In / Providers → Anonymous) — this is what lets onboarding stay zero-friction while every row still gets a real owner.
- **Stripe setup** (account `acct_1Tv0mdChHr9GMVU2`, test mode): Products/Prices for Pro Monthly ($6, `price_1Tv1dTChHr9GMVU26sxSTSt6`), Pro Yearly ($49, `price_1Tv1deChHr9GMVU2ArpuWqDQ`), Team per-seat ($8, `price_1Tv1dhChHr9GMVU2WJPpbL27`) — these price IDs are hardcoded in both the frontend (`js/card.js`) and `create-checkout-session`. A webhook destination pointed at `.../functions/v1/stripe-webhook`, listening for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.

## Restoring / redeploying elsewhere

With the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref <new-project-ref>
supabase db push                                    # applies migrations/ in order
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt
supabase secrets set NEXUS_STRIPE_SECRET_KEY=sk_test_... NEXUS_STRIPE_WEBHOOK_SECRET=whsec_...
```

Then recreate the Stripe products/prices and webhook destination (see above), update the price IDs in `js/card.js` and `functions/create-checkout-session/index.ts` if they change, and enable Anonymous Sign-Ins in the new project's Auth settings.
