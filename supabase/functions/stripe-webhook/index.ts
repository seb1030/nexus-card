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
import { PLAN_BY_PRICE } from "../_shared/plans.ts";

const stripe = new Stripe(Deno.env.get("NEXUS_STRIPE_SECRET_KEY")!);
const webhookSecret = Deno.env.get("NEXUS_STRIPE_WEBHOOK_SECRET")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function upsertSubscriptionById(subscriptionId) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;

  // An unmapped price must be loud. Falling back to "free" here is what
  // silently downgraded every live customer when the price tables drifted.
  const mappedPlan = priceId && PLAN_BY_PRICE[priceId];
  if (!mappedPlan) {
    throw new Error(`Unmapped Stripe price ${priceId} on subscription ${sub.id}`);
  }

  const userId = sub.metadata?.supabase_user_id;
  if (!userId) {
    // Retrying will not help -- the metadata is missing at the source. This
    // is an orphaned paid subscription that needs manual repair, so it must
    // be alerted on rather than swallowed.
    console.error("ORPHANED SUBSCRIPTION: no supabase_user_id in metadata", sub.id);
    return;
  }
  const status = sub.status;
  // Store what was PURCHASED. Whether it is currently entitled is derived
  // from status by sync_profile_plan(), so a transient past_due no longer
  // instantly revokes access and a cancel can't clobber a newer active sub.
  const periodEndSeconds = sub.current_period_end ?? item?.current_period_end;

  const { error } = await supabase.from("subscriptions").upsert({
    owner_type: "user",
    user_id: userId,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    plan: mappedPlan,
    status,
    seats: item?.quantity ?? null,
    current_period_end: periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : null,
  }, { onConflict: "stripe_subscription_id" });

  // MUST throw, not log. Returning normally here sends Stripe a 200, so it
  // marks the event delivered and never retries -- leaving a charged
  // customer with no subscription row and no way to recover it.
  if (error) {
    console.error("subscriptions upsert failed", { subId: sub.id, userId, error });
    throw new Error(`subscriptions upsert failed: ${error.message}`);
  }
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
        // Only the status changes -- plan stays as purchased, so the
        // trigger re-derives entitlement across the user's remaining rows
        // instead of this cancel blanket-downgrading them to free.
        const { error } = await supabase.from("subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", sub.id);
        if (error) throw new Error(`cancel write failed: ${error.message}`);
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
