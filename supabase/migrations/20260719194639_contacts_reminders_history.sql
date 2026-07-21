create type contact_stage as enum ('new','contacted','meeting','closed');

create table contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  title text not null default '',
  company text not null default '',
  email text not null default '',
  phone text not null default '',
  met_at text not null default '',
  met_ts timestamptz not null default now(),
  location text not null default '',
  tags text[] not null default '{}',
  notes text not null default '',
  stage contact_stage,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  text text not null,
  due_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table contact_history (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  ts timestamptz not null default now(),
  type text not null,
  label text not null
);

alter table contacts enable row level security;
alter table reminders enable row level security;
alter table contact_history enable row level security;

create policy "owner can manage own contacts" on contacts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner can manage own reminders" on reminders
  for all using (contact_id in (select id from contacts where owner_id = auth.uid()))
  with check (contact_id in (select id from contacts where owner_id = auth.uid()));

-- history is append-only from the client: select + insert, no update/delete
create policy "owner can view own contact history" on contact_history
  for select using (contact_id in (select id from contacts where owner_id = auth.uid()));

create policy "owner can insert own contact history" on contact_history
  for insert with check (contact_id in (select id from contacts where owner_id = auth.uid()));

create trigger touch_contacts before update on contacts
for each row execute function touch_updated_at();

create index contacts_owner_id_idx on contacts(owner_id);
create index reminders_contact_due_idx on reminders(contact_id, due_at) where not done;
create index contact_history_contact_ts_idx on contact_history(contact_id, ts desc);
