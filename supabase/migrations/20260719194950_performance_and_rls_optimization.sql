-- 1) Missing covering indexes on foreign keys
create index card_events_contact_id_idx on card_events(contact_id);
create index card_links_card_id_idx on card_links(card_id);
create index cards_team_id_idx on cards(team_id);
create index subscriptions_team_id_idx on subscriptions(team_id);
create index subscriptions_user_id_idx on subscriptions(user_id);
create index team_members_user_id_idx on team_members(user_id);
create index teams_owner_id_idx on teams(owner_id);

-- 2) Wrap auth.uid() as (select auth.uid()) everywhere so Postgres evaluates
--    it once per query instead of once per row (auth_rls_initplan).
--    Also splits "owner manage" FOR ALL policies into insert/update/delete
--    where a separate, broader SELECT policy already exists (teams,
--    team_members, card_links) to eliminate duplicate policy evaluation
--    on SELECT (multiple_permissive_policies).

-- teams
drop policy "owner can manage team" on teams;
drop policy "team members can view their team" on teams;
create policy "team members can view their team" on teams
  for select using (id in (select team_id from team_members where user_id = (select auth.uid())));
create policy "owner can insert team" on teams
  for insert with check (owner_id = (select auth.uid()));
create policy "owner can update team" on teams
  for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner can delete team" on teams
  for delete using (owner_id = (select auth.uid()));

-- team_members
drop policy "admins can manage members" on team_members;
drop policy "members can view team roster" on team_members;
create policy "members can view team roster" on team_members
  for select using (team_id in (select team_id from team_members tm where tm.user_id = (select auth.uid())));
create policy "admins can insert members" on team_members
  for insert with check (team_id in (select team_id from team_members tm where tm.user_id = (select auth.uid()) and tm.role = 'admin'));
create policy "admins can update members" on team_members
  for update using (team_id in (select team_id from team_members tm where tm.user_id = (select auth.uid()) and tm.role = 'admin'))
  with check (team_id in (select team_id from team_members tm where tm.user_id = (select auth.uid()) and tm.role = 'admin'));
create policy "admins can delete members" on team_members
  for delete using (team_id in (select team_id from team_members tm where tm.user_id = (select auth.uid()) and tm.role = 'admin'));

-- profiles
drop policy "users can view own profile" on profiles;
create policy "users can view own profile" on profiles
  for select using ((select auth.uid()) = id);

-- cards: split so there's exactly one SELECT policy (owner reads full
-- fields for their own dashboard/edit screen; anon reads via public_cards)
drop policy "owner can manage own card" on cards;
create policy "owner can view own card" on cards
  for select using (owner_id = (select auth.uid()));
create policy "owner can insert own card" on cards
  for insert with check (owner_id = (select auth.uid()));
create policy "owner can update own card" on cards
  for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner can delete own card" on cards
  for delete using (owner_id = (select auth.uid()));

-- card_links: leave "public can view card links" as the sole SELECT
-- policy (it already covers the owner's own reads too); owner only needs
-- write policies now.
drop policy "owner can manage own card links" on card_links;
create policy "owner can insert own card links" on card_links
  for insert with check (card_id in (select id from cards where owner_id = (select auth.uid())));
create policy "owner can update own card links" on card_links
  for update using (card_id in (select id from cards where owner_id = (select auth.uid())))
  with check (card_id in (select id from cards where owner_id = (select auth.uid())));
create policy "owner can delete own card links" on card_links
  for delete using (card_id in (select id from cards where owner_id = (select auth.uid())));

-- contacts / reminders: single policy per table, no overlap -- just fix initplan
drop policy "owner can manage own contacts" on contacts;
create policy "owner can manage own contacts" on contacts
  for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy "owner can manage own reminders" on reminders;
create policy "owner can manage own reminders" on reminders
  for all using (contact_id in (select id from contacts where owner_id = (select auth.uid())))
  with check (contact_id in (select id from contacts where owner_id = (select auth.uid())));

-- contact_history: select + insert are different actions, no overlap -- fix initplan
drop policy "owner can view own contact history" on contact_history;
create policy "owner can view own contact history" on contact_history
  for select using (contact_id in (select id from contacts where owner_id = (select auth.uid())));
drop policy "owner can insert own contact history" on contact_history;
create policy "owner can insert own contact history" on contact_history
  for insert with check (contact_id in (select id from contacts where owner_id = (select auth.uid())));

-- card_events: same pattern
drop policy "owner can view own card events" on card_events;
create policy "owner can view own card events" on card_events
  for select using (card_id in (select id from cards where owner_id = (select auth.uid())));
drop policy "owner can insert own card events" on card_events;
create policy "owner can insert own card events" on card_events
  for insert with check (card_id in (select id from cards where owner_id = (select auth.uid())));

-- subscriptions
drop policy "owner can view own subscription" on subscriptions;
create policy "owner can view own subscription" on subscriptions
  for select using (
    (owner_type = 'user' and user_id = (select auth.uid())) or
    (owner_type = 'team' and team_id in (
      select team_id from team_members where user_id = (select auth.uid()) and role = 'admin'
    ))
  );
