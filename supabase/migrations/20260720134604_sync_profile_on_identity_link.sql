-- Keeps profiles.email / profiles.account_secured in sync whenever the
-- underlying auth identity changes -- specifically when an anonymous user
-- completes email linking (supabase.auth.updateUser({email}) + clicking
-- the confirmation link), at which point Supabase flips is_anonymous to
-- false. This is what account_secured is meant to represent: a real,
-- recoverable identity, not a client-side demo toggle.
create function public.handle_user_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
  set email = new.email,
      account_secured = (new.is_anonymous is false)
  where id = new.id;
  return new;
end;
$$;

revoke execute on function public.handle_user_update() from public, anon, authenticated;

create trigger on_auth_user_updated after update on auth.users
for each row execute function public.handle_user_update();
