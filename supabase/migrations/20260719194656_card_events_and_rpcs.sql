create table card_events (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  ts timestamptz not null default now(),
  type text not null check (type in ('view','save','click','share','reminder_done','exchange')),
  label text not null,
  viewer_city text,
  viewer_region text
);

alter table card_events enable row level security;

create policy "owner can view own card events" on card_events
  for select using (card_id in (select id from cards where owner_id = auth.uid()));

create policy "owner can insert own card events" on card_events
  for insert with check (card_id in (select id from cards where owner_id = auth.uid()));

-- Intentionally no anon policy on the table itself. Viewers can never read
-- or directly write card_events; they can only trigger these two narrow
-- RPCs, which insert exactly one well-formed row each. This is what makes
-- the "city-level only, never precise" privacy promise enforceable server
-- side rather than trusted to client-supplied data.
create index card_events_card_ts_idx on card_events(card_id, ts desc);

create function public.record_card_view(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare v_card_id uuid;
begin
  select id into v_card_id from cards where slug = p_slug;
  if v_card_id is null then return; end if;
  insert into card_events (card_id, type, label) values (v_card_id, 'view', 'Card viewed');
end;
$$;

grant execute on function public.record_card_view(text) to anon, authenticated;

create function public.record_link_click(p_slug text, p_link_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_card_id uuid;
begin
  select id into v_card_id from cards where slug = p_slug;
  if v_card_id is null then return; end if;
  update card_links set clicks = clicks + 1 where id = p_link_id and card_id = v_card_id;
  insert into card_events (card_id, type, label)
  select v_card_id, 'click', 'Clicked "' || label || '"' from card_links where id = p_link_id;
end;
$$;

grant execute on function public.record_link_click(text, uuid) to anon, authenticated;
