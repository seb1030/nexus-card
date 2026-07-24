-- Real analytics aggregation.
--
-- Insights computed its headline numbers by filtering Store.state.events,
-- which refreshEvents() caps at 50 rows ordered by ts desc. So "Card views"
-- was the count of view rows among the 50 most recent events of any type.
-- Past 50 lifetime events the numbers stop rising and begin *falling* as
-- older views scroll out of the window -- a metric that decreases the more
-- successful the user is.
--
-- This does the counting in Postgres over a real date window. The existing
-- card_events(card_id, ts desc) index serves it; at the volumes a single
-- card produces this stays an index range scan. A daily rollup table is the
-- next step if a card ever gets busy enough to care.

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
    'saves',  (select count(*) from windowed where type = 'save'),
    'shares', (select count(*) from windowed where type = 'share'),
    'clicks', (select count(*) from windowed where type = 'click'),
    -- Lifetime totals, so the UI can show "all time" without a second call.
    'total_events', (select count(*) from public.card_events e join mine m on m.id = e.card_id),
    'first_event_at', (select min(e.ts) from public.card_events e join mine m on m.id = e.card_id)
  );
$$;

revoke execute on function public.card_stats(integer) from public, anon;
grant execute on function public.card_stats(integer) to authenticated;
