-- Schema prerequisites for actually delivering follow-up reminders.
--
-- Until now a reminder was a row that rendered a red badge -- and only if
-- the user happened to open the app. There was no push, no email, no
-- scheduled job anywhere in the project. The product's core claim ("the
-- card that makes you follow up") required the user to already have the
-- habit it promised to create.
--
-- Three things were missing before a sweep job could exist:
--   * no owner on reminders  -> every lookup had to join through contacts,
--     and the only index on the table (contact_id, due_at) WHERE NOT done
--     did not match the query the app actually issues
--   * no notified_at         -> a job had no way to avoid re-sending
--   * no timezone on profiles-> a job could not tell whether it was a
--     reasonable hour to email someone

-- 1. Denormalise the owner onto reminders ------------------------------

alter table public.reminders
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

update public.reminders r
   set owner_id = c.owner_id
  from public.contacts c
 where c.id = r.contact_id and r.owner_id is null;

alter table public.reminders alter column owner_id set not null;

-- Keep it correct without requiring the client to send it.
create or replace function public.set_reminder_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is null then
    select c.owner_id into new.owner_id
      from public.contacts c where c.id = new.contact_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.set_reminder_owner() from public, anon, authenticated;

drop trigger if exists reminders_set_owner on public.reminders;
create trigger reminders_set_owner
before insert on public.reminders
for each row execute function public.set_reminder_owner();

-- 2. Delivery bookkeeping ----------------------------------------------

alter table public.reminders
  add column if not exists notified_at timestamptz;

alter table public.profiles
  add column if not exists timezone text not null default 'UTC';

-- Reject junk timezone names up front; the sweep does arithmetic with this
-- and an invalid name would raise inside the job for every user.
alter table public.profiles drop constraint if exists profiles_timezone_chk;
alter table public.profiles add constraint profiles_timezone_chk
  check (now() at time zone timezone is not null) not valid;
alter table public.profiles validate constraint profiles_timezone_chk;

-- 3. Indexes -----------------------------------------------------------

-- The sweep: "which reminders are due and not yet notified?"
create index if not exists reminders_pending_notify_idx
  on public.reminders (due_at)
  where not done and notified_at is null;

-- The app's actual read path. The pre-existing partial index
-- (contact_id, due_at) WHERE NOT done was never usable, because PostgREST
-- embeds reminders with no `done` predicate -- so every dashboard load
-- sequentially scanned the table.
create index if not exists reminders_contact_id_idx
  on public.reminders (contact_id);

create index if not exists reminders_owner_id_idx
  on public.reminders (owner_id);

-- 4. Let the owner keep their own timezone up to date -------------------

create or replace function public.set_my_timezone(p_tz text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Validate before writing: an invalid zone would otherwise trip the
  -- CHECK constraint and surface as a raw Postgres error in the client.
  perform now() at time zone p_tz;
  update public.profiles set timezone = p_tz where id = (select auth.uid());
exception when others then
  return;   -- unknown zone: keep whatever is stored, never break the app
end;
$$;
revoke execute on function public.set_my_timezone(text) from public;
grant execute on function public.set_my_timezone(text) to authenticated;
