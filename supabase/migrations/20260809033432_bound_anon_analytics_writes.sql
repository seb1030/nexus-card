-- record_card_view and record_link_click are granted to anon, take only a
-- slug, and insert unconditionally. Anyone who has seen a card link -- which
-- is the entire point of a card link -- can loop either one and write rows
-- into card_events forever. Two things break, in this order:
--
--   1. Insights becomes fiction. "Card views (30d)" and the per-link click
--      bars are whatever a stranger decided to type in, and record_link_click
--      also increments card_links.clicks, so the owner's own analytics can be
--      moved by someone who is not them. A metric an outsider can set is not
--      a metric.
--
--   2. card_events grows without bound, on a table that has no retention
--      policy and that card_stats and the activity feed both scan.
--
-- The bound below is deliberately per-caller-first, for the same reason as
-- 20260808090000: a purely per-card ceiling hands any passer-by the ability
-- to switch off the owner's analytics. A per-card backstop still exists, but
-- only as a second line, and set high enough that reaching it means something
-- is genuinely wrong.
--
-- What gets sacrificed when a limit trips is an analytics row -- never
-- contact data, never anything the owner typed. That asymmetry is why these
-- ceilings can be much tighter than the one on submit_share_back.
--
-- Depends on public.rate_limit_hit and public.request_client_ip from
-- 20260808090000_share_back_rate_limit_fix.sql. Apply that first.

-- ---------------------------------------------------------------------------
-- record_card_view
-- ---------------------------------------------------------------------------
-- 10 views per IP per card per minute. A real visitor loads the page once and
-- may reload a couple of times on bad conference wifi; ten is far past that
-- and far below what a script needs to be useful.
--
-- 300 per card per minute as the backstop, for a caller rotating addresses.
-- Five card views a second, sustained, is not a person -- and a booth queue
-- of 300 distinct scans inside one minute would be the busiest minute this
-- product has ever had.
--
-- Silent return when throttled, matching the existing behaviour for an
-- unknown slug: the public page calls this fire-and-forget through
-- fireAndForget(), so there is no caller to report a limit to and nothing on
-- screen changes either way.

create or replace function public.record_card_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card_id uuid;
  v_ip      text;
begin
  select id into v_card_id from public.cards where slug = p_slug;
  if v_card_id is null then return; end if;

  v_ip := public.request_client_ip();
  if not public.rate_limit_hit(
       'card_view:' || coalesce(v_ip, 'noip') || ':' || v_card_id::text,
       10, interval '1 minute') then
    return;
  end if;

  if not public.rate_limit_hit(
       'card_view:card:' || v_card_id::text,
       300, interval '1 minute') then
    return;
  end if;

  insert into public.card_events (card_id, type, label)
  values (v_card_id, 'view', 'Card viewed');
end;
$$;

revoke execute on function public.record_card_view(text) from public;
grant execute on function public.record_card_view(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_link_click
-- ---------------------------------------------------------------------------
-- Same shape, slightly looser per-caller ceiling because one visitor
-- legitimately taps several links on the same card in quick succession.
--
-- The limit is checked before the card_links.clicks update as well as before
-- the insert. Bounding only the event row would leave the counter that
-- actually drives the "Clicks per link" bars freely inflatable, which is the
-- more visible half of the problem.

create or replace function public.record_link_click(p_slug text, p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card_id uuid;
  v_ip      text;
begin
  select id into v_card_id from public.cards where slug = p_slug;
  if v_card_id is null then return; end if;

  v_ip := public.request_client_ip();
  if not public.rate_limit_hit(
       'link_click:' || coalesce(v_ip, 'noip') || ':' || v_card_id::text,
       20, interval '1 minute') then
    return;
  end if;

  if not public.rate_limit_hit(
       'link_click:card:' || v_card_id::text,
       300, interval '1 minute') then
    return;
  end if;

  update public.card_links
     set clicks = clicks + 1
   where id = p_link_id and card_id = v_card_id;

  insert into public.card_events (card_id, type, label)
  select v_card_id, 'click', 'Clicked "' || label || '"'
    from public.card_links
   where id = p_link_id and card_id = v_card_id;
end;
$$;

revoke execute on function public.record_link_click(text, uuid) from public;
grant execute on function public.record_link_click(text, uuid) to anon, authenticated;
