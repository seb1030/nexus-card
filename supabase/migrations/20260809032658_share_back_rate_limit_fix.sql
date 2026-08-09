-- Fixes the share-back rate limit added in 20260724102823, which has never
-- worked: it filters card_events on `created_at`, and that column does not
-- exist -- the timestamp column on card_events is `ts` (see
-- 20260719194656_card_events_and_rpcs.sql). Every real call therefore aborts
-- with ERROR 42703 before it writes anything, and supabase-js surfaces the
-- raw Postgres message to the visitor. contacts has zero rows: the
-- reverse-capture funnel, which is the whole reason the public card page
-- exists, has been broken in production since that migration landed.
--
-- The column name is the crash. The design is the deeper bug, and fixing
-- only the name would ship a working feature with two live defects:
--
--   1. The limit was keyed on the VICTIM. Counting 'save' rows on the target
--      card means any stranger who knows a slug can hold that card at its
--      ceiling with ~2 requests a minute and permanently deny the owner
--      every inbound share-back. A rate limit whose cost falls on the person
--      being protected is a denial-of-service primitive, not a control.
--
--   2. It counted the owner's own activity. store.js addContactFromShareBack
--      -- "Add a contact" in the Contacts tab and the in-app "Simulate a
--      scan" flow -- also inserts type='save' on the owner's card. An owner
--      typing in 20 business cards after a conference locks their own card
--      out of inbound share-backs for the next ten minutes, at exactly the
--      moment the feature matters most.
--
-- So this migration re-keys the limit to the CALLER, and gives owner-driven
-- saves their own event type so the two can never be confused again.
--
-- Caller identity: PostgREST exposes the forwarded request headers as the
-- `request.headers` GUC, readable from inside a function, so an anon caller
-- does have an identity we can key on after all -- the claim in
-- 20260724102823 that "IP is not available inside a plpgsql function" was
-- simply wrong. See public.request_client_ip below for what is and is not
-- trustworthy in those headers.

-- ---------------------------------------------------------------------------
-- 1. A distinct event type for owner-initiated contact adds.
-- ---------------------------------------------------------------------------
-- 'save' now means exactly one thing: a visitor on the public card page
-- shared their info back. 'contact_added' is the owner typing someone in
-- themselves. They were the same value, which is why a rate limit meant for
-- strangers could be tripped by the owner.
--
-- Existing rows keep type='save' and are left alone: they are historical
-- analytics, not state, and rewriting a user's activity feed to match a
-- distinction that did not exist when the events happened would be a lie of
-- a different kind. card_stats counts both values so the "Saved to contacts"
-- number in Insights does not visibly drop the day this ships.

alter table public.card_events drop constraint card_events_type_check;

alter table public.card_events add constraint card_events_type_check
  check (type = any (array[
    'view', 'save', 'click', 'share', 'reminder_done', 'exchange', 'contact_added'
  ]));

-- ---------------------------------------------------------------------------
-- 2. A general-purpose fixed-window throttle table.
-- ---------------------------------------------------------------------------
-- One row per bucket, holding the start of the current window and the number
-- of hits inside it. Deliberately generic (`bucket` is an opaque string) --
-- 20260808091500_bound_anon_analytics_writes.sql reuses it for
-- record_card_view / record_link_click, which are unbounded anon writes with
-- the same shape of problem.
--
-- Fixed window rather than sliding: a sliding window needs one row per
-- request, which is the table-bloat problem this is supposed to prevent.

create table if not exists public.rate_limits (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);

alter table public.rate_limits enable row level security;

-- No policies, on purpose: the only access is through rate_limit_hit(), which
-- is SECURITY DEFINER and runs as the table owner. A caller who can read this
-- table can read the rate limit state of every other caller, and one who can
-- write it can zero their own counter.
--
-- The revoke is NOT redundant with RLS, and leaving it out was a real hole.
-- This project has ALTER DEFAULT PRIVILEGES granting anon/authenticated full
-- DML on new tables in `public` (confirmed against pg_default_acl: every
-- existing table carries anon=arwdDxtm). Without this revoke the table is
-- created already granted, PostgREST exposes /rest/v1/rate_limits, and the
-- only thing standing between a stranger and every caller's throttle state
-- is RLS alone -- one mechanism, not the two this comment claimed.
revoke all on table public.rate_limits from anon, authenticated;

create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

create or replace function public.rate_limit_hit(
  p_bucket text, p_limit integer, p_window interval
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  -- Single statement, so the read-modify-write cannot interleave: two
  -- concurrent callers on the same bucket serialise on the row lock rather
  -- than both reading the same count and both being let through.
  insert into public.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
     set hits         = case when r.window_start < now() - p_window then 1 else r.hits + 1 end,
         window_start = case when r.window_start < now() - p_window then now() else r.window_start end
  returning r.hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

-- service_role included: default privileges grant it EXECUTE like every other
-- role, and leaving it able to call this directly would let the service key
-- zero or inflate any caller's bucket. It is already all-powerful, but the
-- stated invariant is "the only access is through rate_limit_hit as called by
-- the throttled RPCs", and this makes that true rather than nearly true.
revoke execute on function public.rate_limit_hit(text, integer, interval)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Caller identity for anon RPCs.
-- ---------------------------------------------------------------------------
-- Returns the calling client's IP as reported by the platform edge, or NULL
-- when we cannot establish one.
--
-- Only edge-written headers are trusted: cf-connecting-ip and x-real-ip are
-- set by the edge itself and overwrite anything the client sent.
--
-- x-forwarded-for is deliberately NOT used, and this is a correction to the
-- reasoning that shipped with the original draft of this migration. That
-- draft took the RIGHTMOST XFF entry, on the general principle that the
-- rightmost is written by the hop closest to us while the leftmost is fully
-- client-controlled. The principle is sound; applying it here is not. This
-- project sits behind Cloudflare -> Envoy -> PostgREST (verified: responses
-- carry cf-ray and x-envoy-attempt-count), so the hop closest to us is a
-- SHARED proxy. The rightmost entry is therefore the Cloudflare edge address,
-- identical for every visitor on the internet -- keying on it would collapse
-- all callers into ONE global bucket, i.e. 20 share-backs per 10 minutes
-- across the entire product. That is strictly worse than the per-card limit
-- this migration exists to replace. Taking the leftmost instead is no better:
-- it is attacker-chosen, so any caller could pick their own bucket and opt
-- out of the limit entirely. Neither end of XFF is usable here, so we use
-- neither, and fall through to the per-card bucket instead.
--
-- The result is validated as an inet before use. It is header text, and it
-- lands in a text PRIMARY KEY -- an oversized value (a multi-kilobyte forged
-- header) would blow past the btree tuple limit and raise 54000 from inside
-- the throttle, which in submit_share_back surfaces to the visitor as a raw
-- Postgres error. The cast rejects junk and bounds the length in one step.
--
-- This is still best-effort. A caller behind a large NAT shares a bucket with
-- everyone else behind it, and a caller on IPv6 or a mobile network can
-- cheaply rotate addresses. It is not a proof of identity -- it is enough to
-- make automated abuse cost something, while making sure the cost of a
-- blocked request falls on the abuser instead of on the card owner.

create or replace function public.request_client_ip()
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_headers   json;
  v_candidate text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    -- Malformed or absent header GUC is not an error worth failing a
    -- share-back over; it just means we have no caller identity.
    return null;
  end;
  if v_headers is null then return null; end if;

  v_candidate := coalesce(
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(v_headers ->> 'x-real-ip'), '')
  );
  if v_candidate is null then return null; end if;

  -- Normalise through inet: rejects anything that is not an address, and
  -- caps the length at what an address can actually be.
  begin
    return host(v_candidate::inet);
  exception when others then
    return null;
  end;
end;
$$;

revoke execute on function public.request_client_ip()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. submit_share_back, with the limit keyed to the caller.
-- ---------------------------------------------------------------------------
-- Everything else is carried over from 20260723132930 unchanged: the same
-- boolean return contract the public card page already branches on
-- (`if (data === false)`), the same slug and empty-name guards, the same
-- silent truncation, the same malformed-email drop, the same three inserts.
-- Only the rate-limit block is different.

create or replace function public.submit_share_back(
  p_slug text, p_name text, p_title text, p_company text, p_email text, p_phone text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card_id    uuid;
  v_owner_id   uuid;
  v_contact_id uuid;
  v_ip         text;
  v_bucket     text;
begin
  select id, owner_id into v_card_id, v_owner_id
    from public.cards where slug = p_slug;
  if v_card_id is null then return false; end if;

  if coalesce(trim(p_name), '') = '' then return false; end if;

  -- Rate limit: 20 share-backs per caller per 10 minutes.
  --
  -- Keyed on the caller's IP, so exhausting the limit affects only the
  -- caller. When we cannot identify the caller at all we fall back to a
  -- per-card bucket -- the old, DoS-able behaviour -- because "unidentified"
  -- must not mean "unlimited". That fallback is reached only when the
  -- platform sends no usable edge header, which for a browser hitting
  -- PostgREST behind Cloudflare does not happen; treat rows with a 'noip:'
  -- bucket appearing in rate_limits as a signal that header forwarding has
  -- changed, and as a live DoS exposure to be fixed rather than tolerated.
  --
  -- Checked after the cheap validation above, so a submission that was never
  -- going to be stored (stale slug, empty name) does not consume quota, and
  -- before any write, so a throttled call costs one upsert rather than three
  -- inserts plus a rollback.
  v_ip := public.request_client_ip();
  v_bucket := case
                when v_ip is null then 'share_back:noip:' || v_card_id::text
                else 'share_back:ip:' || v_ip
              end;
  if not public.rate_limit_hit(v_bucket, 20, interval '10 minutes') then
    return false;
  end if;

  -- Length bounds. Silently truncate rather than reject: the visitor is a
  -- stranger doing the owner a favour, and failing their submission over a
  -- long job title helps nobody.
  p_name    := left(trim(p_name), 100);
  p_title   := left(coalesce(trim(p_title), ''), 120);
  p_company := left(coalesce(trim(p_company), ''), 120);
  p_email   := left(coalesce(trim(p_email), ''), 320);
  p_phone   := left(coalesce(trim(p_phone), ''), 40);

  -- Drop an obviously malformed address instead of storing junk the owner
  -- will later try to mail.
  if p_email <> '' and p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    p_email := '';
  end if;

  insert into public.contacts (owner_id, name, title, company, email, phone, stage)
  values (v_owner_id, p_name, p_title, p_company, p_email, p_phone, 'new')
  returning id into v_contact_id;

  insert into public.contact_history (contact_id, type, label)
  values (v_contact_id, 'exchange', 'Shared their info back');

  insert into public.card_events (card_id, contact_id, type, label)
  values (v_card_id, v_contact_id, 'save', p_name || ' — shared their info back');

  return true;
end;
$$;

revoke execute on function public.submit_share_back(text, text, text, text, text, text) from public;
grant execute on function public.submit_share_back(text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. card_stats counts both save types.
-- ---------------------------------------------------------------------------
-- Otherwise splitting the event type silently halves the "Saved to contacts"
-- figure in Insights for every user who adds contacts manually -- the exact
-- class of quietly-wrong metric that 20260723144408 was written to fix.
-- Body is otherwise byte-identical to that migration.

create or replace function public.card_stats(p_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (
    select id from public.cards where owner_id = (select auth.uid())
  ),
  windowed as (
    select e.type, e.ts
      from public.card_events e
      join mine m on m.id = e.card_id
     where e.ts > now() - make_interval(days => greatest(p_days, 1))
  )
  select jsonb_build_object(
    'days', greatest(p_days, 1),
    'views',  (select count(*) from windowed where type = 'view'),
    'saves',  (select count(*) from windowed where type in ('save', 'contact_added')),
    'shares', (select count(*) from windowed where type = 'share'),
    'clicks', (select count(*) from windowed where type = 'click'),
    -- Lifetime totals, so the UI can show "all time" without a second call.
    'total_events', (select count(*) from public.card_events e join mine m on m.id = e.card_id),
    'first_event_at', (select min(e.ts) from public.card_events e join mine m on m.id = e.card_id)
  );
$$;

revoke execute on function public.card_stats(integer) from public, anon;
grant execute on function public.card_stats(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. TTL sweep for rate_limits.
-- ---------------------------------------------------------------------------
-- Every distinct IP that ever calls a throttled RPC leaves a row here. Left
-- alone that is a slow, unbounded leak -- the same bloat these limits exist
-- to prevent, just on a different table. Nothing older than a day can affect
-- any live window (the longest is 10 minutes), so it is safe to delete.
--
-- pg_cron is already installed and in use by 20260722134834.

create extension if not exists pg_cron;

select cron.unschedule('nexus-rate-limit-prune')
 where exists (select 1 from cron.job where jobname = 'nexus-rate-limit-prune');

select cron.schedule(
  'nexus-rate-limit-prune',
  '17 * * * *',
  $$ delete from public.rate_limits where window_start < now() - interval '1 day' $$
);
