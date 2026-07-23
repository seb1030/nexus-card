-- Schedules the reminder sweep.
--
-- pg_cron cannot call an Edge Function directly, so it calls a SQL wrapper
-- that fires an async HTTP POST via pg_net. The function URL and the shared
-- secret come from Vault rather than being written into migration history.
--
-- REQUIRED SETUP before this does anything (see supabase/README.md):
--   select vault.create_secret('https://<ref>.functions.supabase.co/send-reminder-digest', 'nexus_sweep_url');
--   select vault.create_secret('<random string>', 'nexus_sweep_secret');
-- and set NEXUS_SWEEP_SECRET to the same random string in Edge Function
-- secrets, along with NEXUS_RESEND_API_KEY / NEXUS_REMINDER_FROM /
-- NEXUS_APP_URL.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_reminder_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'nexus_sweep_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'nexus_sweep_secret';

  -- Absent config is a no-op, not an error: an unconfigured project should
  -- not fill the cron log with failures every quarter hour.
  if v_url is null or v_secret is null then
    raise notice 'reminder sweep not configured (missing vault secrets) — skipping';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'x-sweep-secret', v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

revoke execute on function public.trigger_reminder_sweep() from public, anon, authenticated;

-- Every 15 minutes. The function itself decides whether it is a reasonable
-- local hour to email any given user, so a frequent, cheap tick is better
-- than a single daily batch that would deliver at the wrong time for most
-- of the world.
select cron.unschedule('nexus-reminder-sweep')
 where exists (select 1 from cron.job where jobname = 'nexus-reminder-sweep');

select cron.schedule(
  'nexus-reminder-sweep',
  '*/15 * * * *',
  $$ select public.trigger_reminder_sweep(); $$
);
