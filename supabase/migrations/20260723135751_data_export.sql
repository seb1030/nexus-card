-- GDPR Art. 15 (access) and Art. 20 (portability), CCPA/CPRA access.
--
-- privacy.html already tells users that "access, correction, portability,
-- deletion" are "available in-app", and terms.html tells them not to rely on
-- Nexus as their only copy because "export features exist for a reason".
-- Neither existed. Promising a data right and not providing it is worse than
-- staying silent about it, so this closes the gap.
--
-- SECURITY INVOKER, not DEFINER: the function must see exactly what the
-- caller's RLS policies allow and nothing more. A definer function here
-- would be a way to read any row in the database given a crafted argument.

create or replace function public.export_my_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'format_version', 1,
    'account', (
      select to_jsonb(p) - 'stripe_customer_id'   -- billing id is ours, not theirs
        from public.profiles p where p.id = (select auth.uid())
    ),
    'card', (
      select to_jsonb(c) from public.cards c where c.owner_id = (select auth.uid())
    ),
    'card_links', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.position)
        from public.card_links l
        join public.cards c on c.id = l.card_id
       where c.owner_id = (select auth.uid())
    ), '[]'::jsonb),
    'contacts', coalesce((
      select jsonb_agg(
               to_jsonb(ct) || jsonb_build_object(
                 'reminders', coalesce((
                   select jsonb_agg(to_jsonb(r) order by r.due_at)
                     from public.reminders r where r.contact_id = ct.id
                 ), '[]'::jsonb),
                 'history', coalesce((
                   select jsonb_agg(to_jsonb(h) order by h.ts)
                     from public.contact_history h where h.contact_id = ct.id
                 ), '[]'::jsonb)
               ) order by ct.created_at
             )
        from public.contacts ct where ct.owner_id = (select auth.uid())
    ), '[]'::jsonb),
    'card_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.ts)
        from public.card_events e
        join public.cards c on c.id = e.card_id
       where c.owner_id = (select auth.uid())
    ), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'plan', s.plan, 'status', s.status,
               'seats', s.seats, 'current_period_end', s.current_period_end,
               'created_at', s.created_at))
        from public.subscriptions s where s.user_id = (select auth.uid())
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
