// @ts-nocheck
// Stripe webhook receiver. This is the ONLY writer to public.subscriptions
// -- verify_jwt is off because Stripe authenticates via its own HMAC
// signature (Stripe-Signature header + NEXUS_STRIPE_WEBHOOK_SECRET), not
// a Supabase session. Uses the service-role key (auto-injected by
// Supabase into every Edge Function) to bypass RLS, which is correct
// here: this function IS the trusted entitlement writer the RLS design
// assumes. Reads NEXUS_STRIPE_SECRET_KEY / NEXUS_STRIPE_WEBHOOK_SECRET
// (not the plain STRIPE_ names) because this project reserves the plain
// names for a platform-managed key that overrides custom secrets.
//
// IMPORTANT: Stripe can deliver checkout.session.completed,
// customer.subscription.created, and customer.subscription.updated
// within the same millisecond, in no guaranteed order. Trusting the
// subscription snapshot embedded in each event risked a stale event
// (still status=incomplete) overwriting a later, correct one
// (status=active). Every handler below re-fetches the subscription
// fresh from Stripe by ID before writing, so the write always reflects
// current truth regardless of delivery order.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.0.0";

const stripe = new Stripe(Deno.env.get("NEXUS_STRIPE_SECRET_KEY")!);
const webhookSecret = Deno.env.get("NEXUS_STRIPE_WEBHOOK_SECRET")!;

const PLAN_BY_PRICE = {
  "price_1Tv1dTChHr9GMVU26sxSTSt6": "pro",   // Pro Monthly
  "price_1Tv1deChHr9GMVU2ArpuWqDQ": "pro",   // Pro Yearly
  "price_1Tv1dhChHr9GMVU2WJPpbL27": "team",  // Team per-seat Monthly
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function upsertSubscriptionById(subscriptionId) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;
  const mappedPlan = (priceId && PLAN_BY_PRICE[priceId]) || "free";
  const userId = sub.metadata?.supabase_user_id;
  if (!userId) {
    console.error("No supabase_user_id in subscription metadata", sub.id);
    return;
  }
  const status = sub.status;
  const effectivePlan = (status === "active" || status === "trialing") ? mappedPlan : "free";
  const periodEndSeconds = sub.current_period_end ?? item?.current_period_end;

  const { error } = await supabase.from("subscriptions").upsert({
    owner_type: "user",
    user_id: userId,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    plan: effectivePlan,
    status,
    seats: item?.quantity ?? null,
    current_period_end: periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : null,
  }, { onConflict: "stripe_subscription_id" });

  if (error) console.error("subscriptions upsert failed", error);
}

Deno.serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed", err.message);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          await upsertSubscriptionById(session.subscription);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        await upsertSubscriptionById(event.data.object.id);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await supabase.from("subscriptions")
          .update({ plan: "free", status: "canceled" })
          .eq("stripe_subscription_id", sub.id);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("Webhook handler error", err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
