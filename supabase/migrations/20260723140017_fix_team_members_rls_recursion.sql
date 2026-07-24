-- Fixes "infinite recursion detected in policy for relation team_members" (42P17).
--
-- 20260719194950 rewrote the team policies so that team_members' own SELECT
-- policy queries team_members:
--
--   team_id in (select tm.team_id from team_members tm where tm.user_id = auth.uid())
--
-- Evaluating that policy requires evaluating that policy. Postgres aborts.
-- The same shape was applied to the INSERT/UPDATE/DELETE policies, and
-- subscriptions' SELECT policy references team_members, so it inherits it.
--
-- Latent because no client code reads team_members or subscriptions -- the
-- app reads profiles.plan, which the webhook maintains. It surfaced when
-- export_my_data() read subscriptions. It would otherwise have appeared the
-- day teams shipped, or on any attempt to show a user their billing record.
--
-- Standard fix: hoist the lookup into SECURITY DEFINER helpers, which are
-- not subject to RLS, so the recursion is broken. Both are scoped to the
-- caller's own auth.uid() and expose nothing else.

create or replace function public.my_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.team_id from public.team_members tm
   where tm.user_id = (select auth.uid());
$$;

create or replace function public.my_admin_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.team_id from public.team_members tm
   where tm.user_id = (select auth.uid()) and tm.role = 'admin';
$$;

revoke execute on function public.my_team_ids() from public, anon;
revoke execute on function public.my_admin_team_ids() from public, anon;
grant execute on function public.my_team_ids() to authenticated;
grant execute on function public.my_admin_team_ids() to authenticated;

-- team_members
drop policy if exists "members can view team roster" on public.team_members;
create policy "members can view team roster" on public.team_members
  for select using (team_id in (select public.my_team_ids()));

drop policy if exists "admins can insert members" on public.team_members;
create policy "admins can insert members" on public.team_members
  for insert with check (team_id in (select public.my_admin_team_ids()));

drop policy if exists "admins can update members" on public.team_members;
create policy "admins can update members" on public.team_members
  for update using (team_id in (select public.my_admin_team_ids()))
  with check (team_id in (select public.my_admin_team_ids()));

drop policy if exists "admins can delete members" on public.team_members;
create policy "admins can delete members" on public.team_members
  for delete using (team_id in (select public.my_admin_team_ids()));

-- teams: no recursion of its own, but use the helper so the plan matches.
drop policy if exists "team members can view their team" on public.teams;
create policy "team members can view their team" on public.teams
  for select using (id in (select public.my_team_ids()));

-- subscriptions: inherited the fault through the team_members subquery.
drop policy if exists "owner can view own subscription" on public.subscriptions;
create policy "owner can view own subscription" on public.subscriptions
  for select using (
    (owner_type = 'user' and user_id = (select auth.uid()))
    or (owner_type = 'team' and team_id in (select public.my_admin_team_ids()))
  );
