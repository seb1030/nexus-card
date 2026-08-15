-- Photo avatars for cards.
--
-- Until now a card's identity was its initials on a coloured tile. Every
-- competitor is photo-forward, and on a business card a face is the point:
-- the person who scanned your QR at a conference remembers a face, not
-- "SR" in a circle. Initials remain the fallback, so a card without a
-- photo still looks deliberate rather than broken.
--
-- The bucket is created here rather than by hand in the dashboard so it is
-- version-controlled with everything else and a restore into a fresh
-- project reproduces it. Same reasoning as supabase/README.md's restore
-- section: anything that only exists because someone clicked it once is
-- something that will be missing later.

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
-- Public read is required, not a shortcut: card.html is opened by strangers
-- with no session at all, so a signed URL has nobody to sign for. What
-- makes that acceptable is that the object path carries no personal data
-- and is unguessable (owner uuid + random suffix), and the photo is
-- deliberately published by the owner to be shown on a public card.
--
-- 2 MB ceiling and an explicit image allow-list: the client resizes to
-- ~400px before upload, so anything arriving near this limit is either a
-- client bug or someone bypassing the client, and neither should be
-- allowed to fill the bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-photos', 'card-photos', true, 2097152,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Object policies
-- ---------------------------------------------------------------------------
-- Writes are scoped to a folder named for the owner's uuid, so a user can
-- only ever create, replace or delete objects under their own prefix. This
-- is the storage equivalent of the owner_id = auth.uid() rule every table
-- in this schema already uses.
--
-- storage.foldername(name) returns the path segments; [1] is the first
-- folder, which is why uploads must be written as '<uid>/<file>'.

drop policy if exists "card photos are publicly readable" on storage.objects;
create policy "card photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'card-photos');

drop policy if exists "owner can upload own card photo" on storage.objects;
create policy "owner can upload own card photo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'card-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owner can replace own card photo" on storage.objects;
create policy "owner can replace own card photo"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'card-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owner can delete own card photo" on storage.objects;
create policy "owner can delete own card photo"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'card-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 3. The column
-- ---------------------------------------------------------------------------
-- Stores the full public URL rather than the object path. The path would be
-- tidier, but get_public_card is read by an anonymous page that has no
-- Supabase client configured to resolve a path into a URL, and hard-coding
-- the project URL into the frontend to rebuild it is worse.
alter table public.cards add column if not exists photo_url text;

-- ---------------------------------------------------------------------------
-- 4. Expose it to the public card
-- ---------------------------------------------------------------------------
-- Body is otherwise identical to 20260722132540; only 'photo_url' is added.
-- Recreated in full rather than patched because this function is the single
-- read path for every public card, and a half-applied version of it is the
-- worst possible failure in this schema.

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
    'id',        v_card.id,
    'slug',      v_card.slug,
    'name',      v_card.name,
    'title',     v_card.title,
    'company',   v_card.company,
    'color',     v_card.color,
    'initials',  v_card.initials,
    'photo_url', v_card.photo_url,
    -- honour the owner's visibility toggles, exactly as the old view did
    'phone',     case when v_card.show_phone then v_card.phone end,
    'email',     case when v_card.show_email then v_card.email end,
    'links',     coalesce((
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
