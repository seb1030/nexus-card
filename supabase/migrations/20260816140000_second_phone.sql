-- A second phone number, with labels.
--
-- One number assumed one working life. Real cases, all common:
--   * a company-issued handset and a personal one
--   * business done entirely on a personal mobile
--   * a personal number that IS the work number
--
-- The third case is why the labels are chosen by the user rather than
-- hardcoded to "Work" and "Personal": someone whose personal mobile is
-- also their business line does not want it published as "Personal".
--
-- Deliberately two fixed slots rather than a card_contacts child table.
-- A child table is the more general answer and would be right if this
-- were heading for "add any number of arbitrary contact methods", but it
-- costs a join on the single read path every public card uses, its own
-- RLS, and ordering. Two numbers covers the actual need; revisit only if
-- someone asks for a third.

alter table public.cards
  add column if not exists phone_alt        text,
  add column if not exists show_phone_alt   boolean not null default true,
  -- Constrained rather than free text: these map 1:1 onto vCard TEL types
  -- (CELL / WORK / HOME) when a visitor saves the card to their phone, and
  -- an unrecognised label would have nothing sensible to map to.
  add column if not exists phone_label      text not null default 'Mobile',
  add column if not exists phone_alt_label  text not null default 'Work';

alter table public.cards drop constraint if exists cards_phone_label_chk;
alter table public.cards add constraint cards_phone_label_chk
  check (phone_label in ('Mobile','Work','Home'));

alter table public.cards drop constraint if exists cards_phone_alt_label_chk;
alter table public.cards add constraint cards_phone_alt_label_chk
  check (phone_alt_label in ('Mobile','Work','Home'));

-- ---------------------------------------------------------------------------
-- Expose to the public card
-- ---------------------------------------------------------------------------
-- Recreated in full rather than patched: this is the single read path for
-- every public card, and a half-applied version of it is the worst failure
-- in this schema. Body is otherwise identical to 20260816120000.
--
-- Each number honours its own visibility toggle, exactly as phone/email
-- already did -- a hidden number must not leak through the alt field.

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
    'id',              v_card.id,
    'slug',            v_card.slug,
    'name',            v_card.name,
    'title',           v_card.title,
    'company',         v_card.company,
    'color',           v_card.color,
    'initials',        v_card.initials,
    'photo_url',       v_card.photo_url,
    'phone',           case when v_card.show_phone then v_card.phone end,
    'phone_label',     v_card.phone_label,
    'phone_alt',       case when v_card.show_phone_alt then v_card.phone_alt end,
    'phone_alt_label', v_card.phone_alt_label,
    'email',           case when v_card.show_email then v_card.email end,
    'links',           coalesce((
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
