create table cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  slug text not null unique,
  name text not null default '',
  title text not null default '',
  company text not null default '',
  phone text not null default '',
  email text not null default '',
  color text not null default '#4f46e5',
  initials text not null default '',
  show_phone boolean not null default true,
  show_email boolean not null default true,
  geotag_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one card per user for v1, matching the prototype's single `me` object
create unique index cards_owner_id_key on cards(owner_id);

create table card_links (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  label text not null,
  url text not null,
  type text not null default 'Custom',
  clicks integer not null default 0,
  position integer not null default 0
);

alter table cards enable row level security;
alter table card_links enable row level security;

create policy "owner can manage own card" on cards
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner can manage own card links" on card_links
  for all using (card_id in (select id from cards where owner_id = auth.uid()))
  with check (card_id in (select id from cards where owner_id = auth.uid()));

create trigger touch_cards before update on cards
for each row execute function touch_updated_at();

-- Public, recipient-facing view: only ever exposes phone/email when the
-- owner has the corresponding toggle on. This is what the public card
-- page (nexus.card/<slug>) reads — anon has no access to the base table.
create view public_cards as
select
  id, slug, name, title, company, color, initials,
  case when show_phone then phone else null end as phone,
  case when show_email then email else null end as email
from cards;

grant select on public_cards to anon, authenticated;
grant select on card_links to anon; -- link buttons must render on the public page
