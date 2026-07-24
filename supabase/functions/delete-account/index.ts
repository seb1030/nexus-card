// @ts-nocheck
// Permanent account deletion — GDPR Art. 17 (erasure), CCPA/CPRA deletion.
//
// privacy.html tells users they can delete "your entire account at any time
// in the app". Before this, the only thing resembling deletion was
// Store.reset(), which called signOut() on an anonymous session: the rows
// survived in Postgres, permanently orphaned under a user id that no longer
// existed in any browser. That is the opposite of erasure -- the data stayed
// and only the user's access to it was destroyed.
//
// Deleting the auth user cascades to everything else: profiles, cards,
// card_links, contacts, reminders, contact_history, card_events all declare
// ON DELETE CASCADE against auth.users or against a parent that does.
//
// Requires the service-role key, which is why this is an Edge Function and
// not an RPC -- auth.admin is not reachable from SQL.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    // The JWT is the only thing that decides whose account is deleted. There
    // is deliberately no user id parameter -- a caller can only ever delete
    // themselves, no matter what they put in the body.
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !user) throw new Error("Invalid session");

    const body = await req.json().catch(() => ({}));
    // Requiring the literal string means an accidental or forged POST cannot
    // wipe an account; the client asks the user to type it.
    if (body?.confirm !== "DELETE") {
      return new Response(
        JSON.stringify({ error: 'Confirmation required: send {"confirm":"DELETE"}' }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Cancel any live Stripe subscription first. Deleting the account while
    // Stripe keeps billing is the worst possible failure here, and it is not
    // recoverable afterwards because the linkage is gone.
    const { data: subs } = await admin
      .from("subscriptions")
      .select("stripe_subscription_id, status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing", "past_due"]);

    const stripeKey = Deno.env.get("NEXUS_STRIPE_SECRET_KEY");
    const failedCancellations = [];
    if (stripeKey && subs?.length) {
      const Stripe = (await import("npm:stripe@17.0.0")).default;
      const stripe = new Stripe(stripeKey);
      for (const s of subs) {
        if (!s.stripe_subscription_id) continue;
        try {
          await stripe.subscriptions.cancel(s.stripe_subscription_id);
        } catch (err) {
          console.error("stripe cancel failed", { sub: s.stripe_subscription_id, err: String(err) });
          failedCancellations.push(s.stripe_subscription_id);
        }
      }
    }

    // Refuse to proceed if we could not stop the billing. Better a failed
    // deletion the user can retry than a deleted account still being charged.
    if (failedCancellations.length) {
      return new Response(
        JSON.stringify({
          error: "Could not cancel your subscription. Nothing was deleted. Please contact support.",
        }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) throw delErr;

    console.log("account deleted", { userId: user.id, cancelledSubs: subs?.length ?? 0 });
    return new Response(JSON.stringify({ deleted: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("delete-account failed", err);
    return new Response(JSON.stringify({ error: "Could not delete the account. Please try again." }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
