-- Lets an anonymous visitor on the real public card page share their own
-- info back to the card owner, without ever needing an account or table
-- access. Mirrors record_card_view/record_link_click: looks up the owner
-- from the slug, inserts under THAT owner's id, bypassing the normal
-- owner-only RLS on contacts/contact_history/card_events by design --
-- this function IS the trusted boundary for that specific action.
create function public.submit_share_back(
  p_slug text, p_name text, p_title text, p_company text, p_email text, p_phone text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_card_id uuid;
  v_owner_id uuid;
  v_contact_id uuid;
begin
  select id, owner_id into v_card_id, v_owner_id from cards where slug = p_slug;
  if v_card_id is null then return; end if;
  if coalesce(trim(p_name), '') = '' then return; end if;

  insert into contacts (owner_id, name, title, company, email, phone, stage)
  values (v_owner_id, p_name, coalesce(p_title, ''), coalesce(p_company, ''), coalesce(p_email, ''), coalesce(p_phone, ''), 'new')
  returning id into v_contact_id;

  insert into contact_history (contact_id, type, label)
  values (v_contact_id, 'exchange', 'Shared their info back');

  insert into card_events (card_id, contact_id, type, label)
  values (v_card_id, v_contact_id, 'save', p_name || ' — shared their info back');
end;
$$;

grant execute on function public.submit_share_back(text, text, text, text, text, text) to anon, authenticated;
