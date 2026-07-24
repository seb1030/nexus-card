-- submit_share_back is the only unauthenticated write path into another
-- user's CRM (granted to anon by slug, no auth required). Field lengths
-- were bounded in share_back_returns_status, but nothing capped the RATE:
-- a script could still insert unlimited contacts into any owner's CRM by
-- slug alone.
--
-- Bounded per card rather than per caller: anon has no stable identity to
-- key on (no session, no auth.uid()), and IP is not available inside a
-- plpgsql function without extra request-header plumbing. Counting recent
-- share-backs on the target card is enough to stop a flood while staying
-- well clear of real usage -- even a busy conference booth scanning the
-- same card dozens of times in a burst comes nowhere near this limit.

create or replace function public.submit_share_back(
  p_slug text, p_name text, p_title text, p_company text, p_email text, p_phone text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card_id     uuid;
  v_owner_id    uuid;
  v_contact_id  uuid;
  v_recent_count int;
begin
  select id, owner_id into v_card_id, v_owner_id
    from public.cards where slug = p_slug;
  if v_card_id is null then return false; end if;

  if coalesce(trim(p_name), '') = '' then return false; end if;

  -- Rate limit: at most 20 share-backs per card per 10-minute window.
  -- Checked before any write, using the card_events rows this function
  -- itself inserts below -- no separate tracking table needed.
  select count(*) into v_recent_count
    from public.card_events
   where card_id = v_card_id
     and type = 'save'
     and created_at > now() - interval '10 minutes';
  if v_recent_count >= 20 then return false; end if;

  -- Length bounds. Silently truncate rather than reject: the visitor is a
  -- stranger doing the owner a favour, and failing their submission over a
  -- long job title helps nobody.
  p_name    := left(trim(p_name), 100);
  p_title   := left(coalesce(trim(p_title), ''), 120);
  p_company := left(coalesce(trim(p_company), ''), 120);
  p_email   := left(coalesce(trim(p_email), ''), 320);
  p_phone   := left(coalesce(trim(p_phone), ''), 40);

  -- Drop an obviously malformed address instead of storing junk the owner
  -- will later try to mail.
  if p_email <> '' and p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    p_email := '';
  end if;

  insert into public.contacts (owner_id, name, title, company, email, phone, stage)
  values (v_owner_id, p_name, p_title, p_company, p_email, p_phone, 'new')
  returning id into v_contact_id;

  insert into public.contact_history (contact_id, type, label)
  values (v_contact_id, 'exchange', 'Shared their info back');

  insert into public.card_events (card_id, contact_id, type, label)
  values (v_card_id, v_contact_id, 'save', p_name || ' — shared their info back');

  return true;
end;
$$;

revoke execute on function public.submit_share_back(text, text, text, text, text, text) from public;
grant execute on function public.submit_share_back(text, text, text, text, text, text) to anon, authenticated;
