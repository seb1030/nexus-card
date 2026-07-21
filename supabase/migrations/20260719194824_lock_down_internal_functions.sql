-- These three are trigger-only functions (they reference NEW, which only
-- exists inside a trigger context) and were never meant to be callable
-- directly. Postgres grants EXECUTE to PUBLIC by default on new functions,
-- which silently exposed them at /rest/v1/rpc/<name>. Revoking here does
-- not affect the triggers themselves -- trigger firing isn't gated by the
-- caller's EXECUTE privilege.
revoke execute on function public.handle_new_team() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_profile_plan() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Pin search_path so the function can't be tricked by a role-local
-- search_path into resolving an object from an unexpected schema.
alter function public.touch_updated_at() set search_path = public;
