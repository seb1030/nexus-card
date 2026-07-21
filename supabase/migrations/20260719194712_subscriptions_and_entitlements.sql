create type billing_owner_type as enum ('user','team');

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_type billing_owner_type not null,
  user_id uuid references auth.users(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  plan plan_tier not null default 'free',
  status text not null default 'active',
  seats integer,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (owner_type = 'user' and user_id is not null and team_id is null) or
    (owner_type = 'team' and team_id is not null and user_id is null)
  )
);

alter table subscriptions enable row level security;

-- Read-only, and only to the owner (or a team admin). There is deliberately
-- NO insert/update/delete policy for anon or authenticated roles below —
-- this table is the entitlement source of truth and must only ever be
-- written by the Stripe webhook handler running with the service role key,
-- which bypasses RLS entirely. A user can look at their own plan but can
-- never grant themselves one.
create policy "owner can view own subscription" on subscriptions
  for select using (
    (owner_type = 'user' and user_id = auth.uid()) or
    (owner_type = 'team' and team_id in (
      select team_id from team_members where user_id = auth.uid() and role = 'admin'
    ))
  );

create trigger touch_subscriptions before update on subscriptions
for each row execute function touch_updated_at();

-- Keep profiles.plan in sync so the app can read entitlement with a cheap
-- single-row lookup instead of joining subscriptions on every request.
create function public.sync_profile_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_type = 'user' then
    update profiles set plan = new.plan where id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger on_subscription_change after insert or update on subscriptions
for each row execute function sync_profile_plan();
