// @ts-nocheck
// Reminder delivery sweep.
//
// Invoked on a schedule by pg_cron (see the reminder_delivery_cron
// migration). Finds reminders that are due and not yet notified, groups
// them per user, emails a digest, and stamps notified_at so nobody is
// mailed twice.
//
// Design notes:
//  * Only users with a CONFIRMED email are mailed. Anonymous accounts have
//    no address, and mailing an unconfirmed one is an open relay for
//    whatever a user typed.
//  * notified_at is stamped ONLY after the send succeeds. A failed send
//    leaves the row pending so the next sweep retries it -- the opposite
//    order would silently drop reminders on any transient Resend error.
//  * Quiet hours: a reminder created "in 3 days" at 11pm is due at 11pm.
//    We hold anything outside 08:00-20:00 in the user's own timezone
//    rather than emailing them in the middle of the night. Reminders due
//    more than QUIET_GRACE_HOURS ago are sent regardless, so a bad
//    timezone can never strand someone's follow-ups forever.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_KEY = Deno.env.get("NEXUS_RESEND_API_KEY");
const FROM = Deno.env.get("NEXUS_REMINDER_FROM") ?? "Nexus Card <reminders@example.com>";
const APP_URL = Deno.env.get("NEXUS_APP_URL") ?? "https://example.com";
const SWEEP_SECRET = Deno.env.get("NEXUS_SWEEP_SECRET");

const QUIET_START = 8;
const QUIET_END = 20;
const QUIET_GRACE_HOURS = 36;
const MAX_USERS_PER_RUN = 200;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function localHour(tz: string): number | null {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "numeric", hour12: false,
      }).format(new Date())
    );
  } catch {
    return null; // unknown zone -> caller falls back to sending
  }
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!
  ));
}

function buildEmail(rows) {
  const items = rows.map((r) => {
    const who = r.contact_name || "a contact";
    const overdue = new Date(r.due_at) < new Date(Date.now() - 24 * 3600 * 1000);
    return `<li class="item" style="margin:0 0 10px">
      <b>${escapeHtml(who)}</b>${r.contact_company ? ` &middot; ${escapeHtml(r.contact_company)}` : ""}<br>
      <span class="muted">${escapeHtml(r.text)}</span>
      ${overdue ? ` <span style="color:#dc2626">(overdue)</span>` : ""}
    </li>`;
  }).join("");

  const n = rows.length;
  const subject = n === 1
    ? `Follow up with ${rows[0].contact_name || "a contact"}`
    : `${n} follow-ups are due`;

  const preheader = n === 1
    ? `${rows[0].contact_name || "A contact"}: ${rows[0].text}`
    : `${n} people are waiting to hear back from you.`;

  /* A full document, not a fragment. Without the color-scheme declarations
     Gmail force-inverts its own palette onto the inline styles -- which
     turned the indigo CTA into washed-out lavender with dark text in dark
     mode. Declaring support tells clients we handle theming ourselves.
     Colours below are chosen to hold up under both schemes. */
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  .wrap { background:#ffffff; color:#14140f; }
  .muted { color:#57564e; }
  .fine  { color:#6e6d64; }
  .cta   { background:#4f46e5 !important; color:#ffffff !important; }
  @media (prefers-color-scheme: dark) {
    .wrap { background:#14140f !important; color:#f4f4f2 !important; }
    .muted { color:#b9b8b2 !important; }
    .fine  { color:#8f8e88 !important; }
    .item  { color:#f4f4f2 !important; }
    .cta   { background:#6366f1 !important; color:#ffffff !important; }
  }
</style>
</head>
<body style="margin:0;padding:0">
<div style="display:none;font-size:1px;color:transparent;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>
<div class="wrap" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;line-height:26px;margin:0 0 4px">${n === 1 ? "One follow-up is due" : `${n} follow-ups are due`}</h1>
  <p class="muted" style="font-size:14px;margin:0 0 18px">You said you'd circle back. Here's who's waiting.</p>
  <ul style="padding-left:18px;font-size:15px;line-height:1.5;margin:0">${items}</ul>
  <p style="margin:24px 0 0">
    <a class="cta" href="${escapeHtml(APP_URL)}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-size:15px;font-weight:600">Open Nexus Card</a>
  </p>
  <p class="fine" style="font-size:12px;margin-top:24px">
    You're getting this because you set a follow-up reminder in Nexus Card.
  </p>
</div>
</body>
</html>`;

  return { subject, html };
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

Deno.serve(async (req) => {
  // Deployed with --no-verify-jwt so pg_cron can reach it; the shared
  // secret is what actually authenticates the caller.
  if (SWEEP_SECRET) {
    const got = req.headers.get("x-sweep-secret");
    if (got !== SWEEP_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  if (!RESEND_KEY) {
    console.error("NEXUS_RESEND_API_KEY is not set — cannot send reminders");
    return new Response(JSON.stringify({ error: "email not configured" }), { status: 503 });
  }

  // last_error is surfaced in the response because Supabase's log API only
  // exposes request-level entries, not console output -- without this, a
  // failing sweep reports "failed: 1" with no way to find out why.
  const summary = { candidates: 0, users: 0, sent: 0, held: 0, failed: 0, skipped_no_email: 0, last_error: null };

  try {
    const { data: due, error } = await supabase
      .from("reminders")
      .select("id, text, due_at, owner_id, contacts(name, company)")
      .eq("done", false)
      .is("notified_at", null)
      .lte("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(1000);
    if (error) throw error;

    summary.candidates = due?.length ?? 0;
    if (!summary.candidates) {
      return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
    }

    const byUser = new Map();
    for (const r of due) {
      const row = {
        id: r.id, text: r.text, due_at: r.due_at, owner_id: r.owner_id,
        contact_name: r.contacts?.name, contact_company: r.contacts?.company,
      };
      if (!byUser.has(r.owner_id)) byUser.set(r.owner_id, []);
      byUser.get(r.owner_id).push(row);
    }
    summary.users = byUser.size;

    const ownerIds = [...byUser.keys()].slice(0, MAX_USERS_PER_RUN);
    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, email, account_secured, timezone")
      .in("id", ownerIds);
    if (pErr) throw pErr;

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    for (const ownerId of ownerIds) {
      const rows = byUser.get(ownerId);
      const profile = profileById.get(ownerId);

      // No confirmed email -> nothing to send to. Leave notified_at null so
      // these deliver later if the user links an address.
      if (!profile?.email || !profile.account_secured) {
        summary.skipped_no_email += rows.length;
        continue;
      }

      const hour = localHour(profile.timezone || "UTC");
      const oldest = Math.min(...rows.map((r) => new Date(r.due_at).getTime()));
      const staleHours = (Date.now() - oldest) / 3600000;
      const outsideWindow = hour !== null && (hour < QUIET_START || hour >= QUIET_END);
      if (outsideWindow && staleHours < QUIET_GRACE_HOURS) {
        summary.held += rows.length;
        continue;
      }

      const { subject, html } = buildEmail(rows);
      try {
        await sendEmail(profile.email, subject, html);
      } catch (err) {
        // Leave notified_at null: the next sweep retries rather than
        // silently dropping the reminder.
        console.error("send failed", { ownerId, err: String(err) });
        summary.failed += rows.length;
        summary.last_error = String(err).slice(0, 400);
        continue;
      }

      const { error: markErr } = await supabase
        .from("reminders")
        .update({ notified_at: new Date().toISOString() })
        .in("id", rows.map((r) => r.id));
      if (markErr) {
        // Sent but not stamped — the user may get one duplicate on the next
        // sweep. Loud, because repeated failure means repeated duplicates.
        console.error("MARK FAILED AFTER SEND — possible duplicate next run", { ownerId, markErr });
      }
      summary.sent += rows.length;
    }

    console.log("reminder sweep", summary);
    return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("reminder sweep failed", err);
    return new Response(JSON.stringify({ error: String(err), summary }), { status: 500 });
  }
});
