// @ts-nocheck
// Creates a Stripe Checkout Session for the caller's Supabase-authenticated
// user. Never runs client-side -- the Stripe secret key must never reach
// the browser. Called by Paywall.startUpgrade() in the static frontend.
// Uses NEXUS_STRIPE_SECRET_KEY (not STRIPE_SECRET_KEY) because this
// project appears to reserve the plain STRIPE_SECRET_KEY name for a
// platform-managed key that overrides custom secrets of the same name.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.0.0";
import { resolveTier, MAX_SEATS } from "../_shared/plans.ts";

const stripe = new Stripe(Deno.env.get("NEXUS_STRIPE_SECRET_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Raised for input we want to report back verbatim; everything else gets a
// generic message so Stripe/Supabase internals never reach the browser.
class ClientError extends Error {}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !user) throw new ClientError("Invalid session");

    // An anonymous account exists only in one browser's localStorage. If it
    // is lost (cleared data, new device, iOS ITP's 7-day purge) the
    // subscription becomes unreachable: we cannot identify the payer, and
    // profiles.email is empty so we have no address to refund or contact.
    // Identity must exist BEFORE money changes hands. The client gates this
    // too, but this is the authoritative check.
    if (user.is_anonymous) {
      throw new ClientError("Add and confirm an email before subscribing, so you can't lose access to your plan.");
    }

    const { tier, seats, origin } = await req.json();
    const plan = resolveTier(tier);
    if (!plan) throw new ClientError("Unknown tier");

    // seats is client-supplied. The floor was enforced but not the ceiling,
    // so a crafted request could open a Checkout session for an arbitrary
    // amount; non-integers produced opaque Stripe errors.
    let quantity = 1;
    if (plan.minQuantity) {
      const n = Number(seats);
      if (seats !== undefined && seats !== null && (!Number.isInteger(n) || n < 1)) {
        throw new ClientError("Invalid seat count");
      }
      const wanted = Number.isInteger(n) ? n : plan.minQuantity;
      quantity = Math.min(Math.max(wanted, plan.minQuantity), MAX_SEATS);
    }

    // One live subscription per user is enforced by a partial unique index
    // (subscriptions_one_live_per_user). Opening a second Checkout while one
    // is live would double-bill the customer and leave the webhook unable to
    // record the second subscription, so refuse here -- before money moves.
    // This also covers the "still activating" window right after a payment,
    // when profiles.plan (what the UI gates on) hasn't caught up yet.
    const { data: liveSubs, error: liveErr } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("owner_type", "user")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing", "past_due"])
      .limit(1);
    if (liveErr) throw new Error(`live-subscription check failed: ${liveErr.message}`);
    if (liveSubs?.length) {
      throw new ClientError("You already have an active subscription. Manage it from your plan settings instead of buying again.");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, email")
      .eq("id", user.id)
      .single();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile?.email || undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    const base = origin || req.headers.get("origin") || "http://localhost:8742";
    const lineItem = { price: plan.priceId, quantity };
    if (plan.minQuantity) {
      lineItem.adjustable_quantity = { enabled: true, minimum: plan.minQuantity, maximum: MAX_SEATS };
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [lineItem],
      subscription_data: { metadata: { supabase_user_id: user.id, tier } },
      metadata: { supabase_user_id: user.id, tier },
      success_url: `${base}/index.html?checkout=success`,
      cancel_url: `${base}/index.html?checkout=cancel`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    // This function previously had no logging at all and returned raw
    // err.message to the browser -- which leaked Stripe key fragments and
    // account state ("a similar object exists in live mode").
    console.error("create-checkout-session failed", err);
    const isClient = err instanceof ClientError;
    return new Response(
      JSON.stringify({ error: isClient ? err.message : "Could not start checkout. Please try again." }),
      {
        status: isClient ? 400 : 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      }
    );
  }
});
