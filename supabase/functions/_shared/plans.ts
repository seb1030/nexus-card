// @ts-nocheck
// Single source of truth for Stripe Price IDs and the plan they grant.
//
// Previously these were hardcoded in TWO places -- PRICES in
// create-checkout-session and PLAN_BY_PRICE in stripe-webhook -- and the
// README documented neither correctly. Switching to live mode by following
// the README updated one table and left the other on test-mode IDs, so
// PLAN_BY_PRICE[priceId] came back undefined and every paying customer was
// silently written as "free". Prices now come from the environment, so
// test and live differ by configuration rather than by remembering to edit
// two files.
//
// Required Edge Function secrets:
//   NEXUS_PRICE_PRO_MONTHLY, NEXUS_PRICE_PRO_YEARLY, NEXUS_PRICE_TEAM_MONTHLY

function required(name: string): string {
  const v = Deno.env.get(name);
  // Fail at module load with the actual missing name, rather than surfacing
  // an unrelated Stripe error at request time.
  if (!v) throw new Error(`FATAL: missing required secret ${name}`);
  return v;
}

export const MAX_SEATS = 500;

// tier -> price + the plan it grants. Team enforces a 3-seat minimum at
// Checkout since Stripe has no native "minimum quantity" on a Price.
export const PLANS = {
  pro_monthly:  { priceId: required("NEXUS_PRICE_PRO_MONTHLY"),  plan: "pro",  minQuantity: null },
  pro_yearly:   { priceId: required("NEXUS_PRICE_PRO_YEARLY"),   plan: "pro",  minQuantity: null },
  team_monthly: { priceId: required("NEXUS_PRICE_TEAM_MONTHLY"), plan: "team", minQuantity: 3 },
} as const;

// Derived, so the two directions can never disagree.
export const PLAN_BY_PRICE: Record<string, string> = Object.fromEntries(
  Object.values(PLANS).map((p) => [p.priceId, p.plan])
);

// Guards against prototype keys ("constructor", "__proto__") resolving to a
// truthy object whose .priceId is undefined.
export function resolveTier(tier: unknown) {
  if (typeof tier !== "string" || !Object.hasOwn(PLANS, tier)) return null;
  return PLANS[tier as keyof typeof PLANS];
}
