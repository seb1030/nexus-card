create type plan_tier as enum ('free','pro','team');

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan plan_tier not null default 'free',
  account_secured boolean not null default false,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- read-only from the client: plan/account_secured/stripe_customer_id are
-- entitlement data and must only ever be written by the billing webhook
-- (service role), never by the account holder themselves.
create policy "users can view own profile" on profiles
  for select using (auth.uid() = id);

create trigger touch_profiles before update on profiles
for each row execute function touch_updated_at();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
