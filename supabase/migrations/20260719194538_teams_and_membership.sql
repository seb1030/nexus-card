create type team_role as enum ('admin','member');

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role team_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

alter table teams enable row level security;
alter table team_members enable row level security;

create policy "team members can view their team" on teams
  for select using (
    id in (select team_id from team_members where user_id = auth.uid())
  );

create policy "owner can manage team" on teams
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "members can view team roster" on team_members
  for select using (
    team_id in (select team_id from team_members tm where tm.user_id = auth.uid())
  );

create policy "admins can manage members" on team_members
  for all using (
    team_id in (select team_id from team_members tm where tm.user_id = auth.uid() and tm.role = 'admin')
  ) with check (
    team_id in (select team_id from team_members tm where tm.user_id = auth.uid() and tm.role = 'admin')
  );

-- auto-add the creator as an admin member; avoids needing a client insert policy
create function public.handle_new_team() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into team_members (team_id, user_id, role) values (new.id, new.owner_id, 'admin');
  return new;
end;
$$;

create trigger on_team_created after insert on teams
for each row execute function handle_new_team();
