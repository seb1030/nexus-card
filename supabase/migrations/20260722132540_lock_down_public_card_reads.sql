-- Closes the public-read hole on cards + card_links.
--
-- Before this migration:
--   * `public_cards` was a view with NO WHERE clause, created without
--     security_invoker (so it ran as the owner and bypassed RLS on cards)
--     and granted to anon. `GET /rest/v1/public_cards?select=*` returned
--     name/title/company/phone/email for EVERY user in the product.
--   * `card_links` had a `using (true)` select policy plus a direct anon
--     grant, so every link URL and click count was world-readable and
--     joinable back to the card dump by card_id.
--
-- A view cannot enforce a mandatory slug filter, so both are replaced by a
-- single slug-scoped RPC. That also collapses the public card page from
-- three round trips (view + links + record_view) to one.
--
-- NOTE: this migration and app/js/public-card.js must deploy together.
-- Applying this alone breaks the public card page; shipping the client
-- alone breaks on the missing function.

-- 1. Remove the two anonymous read paths -------------------------------

revoke select on public.public_cards from anon, authenticated;
drop view if exists public.public_cards;

drop policy if exists "public can view card links" on public.card_links;
revoke select on public.card_links from anon;

-- 2. One slug-scoped read, returning the card and its links together ----

create or replace function public.get_public_card(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_card public.cards%rowtype;
begin
  select * into v_card from public.cards where slug = p_slug;
  if v_card.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id',       v_card.id,
    'slug',     v_card.slug,
    'name',     v_card.name,
    'title',    v_card.title,
    'company',  v_card.company,
    'color',    v_card.color,
    'initials', v_card.initials,
    -- honour the owner's visibility toggles, exactly as the old view did
    'phone',    case when v_card.show_phone then v_card.phone end,
    'email',    case when v_card.show_email then v_card.email end,
    'links',    coalesce((
                  select jsonb_agg(
                           jsonb_build_object(
                             'id',    l.id,
                             'label', l.label,
                             'url',   l.url,
                             'type',  l.type
                           ) order by l.position
                         )
                  from public.card_links l
                  where l.card_id = v_card.id
                ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_public_card(text) from public;
grant execute on function public.get_public_card(text) to anon, authenticated;

-- 3. Owners keep full access to their own links ------------------------
-- (the previous owner policy was replaced by the `using (true)` one; this
--  restores owner-scoped reads now that anon no longer has any)

drop policy if exists "owner can view own card links" on public.card_links;
create policy "owner can view own card links" on public.card_links
  for select using (
    card_id in (select id from public.cards where owner_id = (select auth.uid()))
  );

-- 4. Scope the click-event insert to the card being viewed -------------
-- The UPDATE was already guarded by `card_id = v_card_id`; the INSERT's
-- subquery was not, so record_link_click(my_slug, <someone else's link id>)
-- wrote a stranger's link label into this card's activity feed.

create or replace function public.record_link_click(p_slug text, p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card_id uuid;
begin
  select id into v_card_id from public.cards where slug = p_slug;
  if v_card_id is null then return; end if;

  update public.card_links
     set clicks = clicks + 1
   where id = p_link_id and card_id = v_card_id;

  insert into public.card_events (card_id, type, label)
  select v_card_id, 'click', 'Clicked "' || label || '"'
    from public.card_links
   where id = p_link_id and card_id = v_card_id;   -- scoped
end;
$$;

revoke execute on function public.record_link_click(text, uuid) from public;
grant execute on function public.record_link_click(text, uuid) to anon, authenticated;
