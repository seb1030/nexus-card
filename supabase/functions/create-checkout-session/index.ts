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

const stripe = new Stripe(Deno.env.get("NEXUS_STRIPE_SECRET_KEY")!);

// tier -> Stripe Price. Team enforces a 3-seat minimum at Checkout since
// Stripe has no native "minimum quantity" on the Price object itself.
const PRICES = {
  pro_monthly: { priceId: "price_1Tv1dTChHr9GMVU26sxSTSt6", minQuantity: null },
  pro_yearly: { priceId: "price_1Tv1deChHr9GMVU2ArpuWqDQ", minQuantity: null },
  team_monthly: { priceId: "price_1Tv1dhChHr9GMVU2WJPpbL27", minQuantity: 3 },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    if (userErr || !user) throw new Error("Invalid session");

    const { tier, seats, origin } = await req.json();
    const plan = PRICES[tier];
    if (!plan) throw new Error("Unknown tier: " + tier);

    const quantity = plan.minQuantity ? Math.max(seats || plan.minQuantity, plan.minQuantity) : 1;

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
      lineItem.adjustable_quantity = { enabled: true, minimum: plan.minQuantity, maximum: 500 };
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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
