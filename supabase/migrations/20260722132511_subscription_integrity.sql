-- Fixes entitlement drift in the subscriptions -> profiles.plan pipeline.
--
-- Two independent defects, found by separate reviewers:
--
--   1. Nothing constrained a user to one active subscription row, and
--      sync_profile_plan() blindly copied NEW.plan onto profiles. So a
--      user who upgraded Pro -> Team and then cancelled the redundant Pro
--      subscription had the cancel event write plan='free', wiping the
--      entitlement they were still being billed for.
--
--   2. The trigger only handled owner_type='user'. Team subscriptions
--      updated nobody's profiles.plan, so the per-seat tier granted zero
--      entitlement at the database level regardless of what the UI showed.
--
-- Also separates "what was purchased" (subscriptions.plan) from "is it
-- currently entitled" (derived from status), so a transient past_due no
-- longer instantly revokes access mid-billing-period.

-- 1. Constrain the data ------------------------------------------------

alter table public.subscriptions
  drop constraint if exists subscriptions_status_chk;
alter table public.subscriptions
  add constraint subscriptions_status_chk check (
    status in ('active','trialing','past_due','canceled',
               'incomplete','incomplete_expired','unpaid','paused')
  );

alter table public.subscriptions
  drop constraint if exists subscriptions_seats_chk;
alter table public.subscriptions
  add constraint subscriptions_seats_chk check (seats is null or seats > 0);

-- At most one live subscription per owner. Partial, so historical
-- canceled rows are retained for audit.
drop index if exists public.subscriptions_one_live_per_user;
create unique index subscriptions_one_live_per_user
  on public.subscriptions (user_id)
  where owner_type = 'user' and status in ('active','trialing','past_due');

drop index if exists public.subscriptions_one_live_per_team;
create unique index subscriptions_one_live_per_team
  on public.subscriptions (team_id)
  where owner_type = 'team' and status in ('active','trialing','past_due');

-- 2. Derive the plan instead of copying it -----------------------------

create or replace function public.sync_profile_plan() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- NEW is unassigned in a DELETE trigger, so referencing new.* directly
  -- would raise "record new is not assigned yet". Pick the row explicitly.
  v_row       public.subscriptions%rowtype := case tg_op when 'DELETE' then old else new end;
  v_user_id   uuid := v_row.user_id;
  v_team_id   uuid := v_row.team_id;
  v_owner     text := v_row.owner_type;
begin
  -- Individual subscriptions.
  if v_owner = 'user' and v_user_id is not null then
    update public.profiles p
       set plan = coalesce((
             select s.plan
               from public.subscriptions s
              where s.user_id = v_user_id
                and s.owner_type = 'user'
                -- past_due stays entitled: Stripe's Smart Retries run for
                -- ~3 weeks and usually succeed, so revoking on the first
                -- failed charge churns customers who have already paid for
                -- the current period.
                and s.status in ('active','trialing','past_due')
              order by case s.plan when 'team' then 2 when 'pro' then 1 else 0 end desc
              limit 1
           ), 'free')
     where p.id = v_user_id;
  end if;

  -- Team subscriptions entitle every member.
  if v_owner = 'team' and v_team_id is not null then
    update public.profiles p
       set plan = coalesce((
             select s.plan
               from public.subscriptions s
              where s.team_id = v_team_id
                and s.owner_type = 'team'
                and s.status in ('active','trialing','past_due')
              limit 1
           ), 'free')
     where p.id in (
       select tm.user_id from public.team_members tm where tm.team_id = v_team_id
     );
  end if;

  return v_row;
end;
$$;

revoke execute on function public.sync_profile_plan() from public, anon, authenticated;

-- Fire on delete too, so removing a row re-derives rather than stranding
-- the old entitlement on the profile.
drop trigger if exists on_subscription_change on public.subscriptions;
create trigger on_subscription_change
after insert or update or delete on public.subscriptions
for each row execute function public.sync_profile_plan();
