/* Supabase client + anonymous-first session bootstrap.
   Onboarding stays zero-friction (no email/password prompt) because every
   visitor gets a real, silent auth.uid() via signInAnonymously() — that's
   what lets RLS policies like "owner_id = auth.uid()" work from screen 1.
   Requires Authentication > Providers > Enable Anonymous Sign-Ins to be
   turned on in the Supabase dashboard; there is no API for that setting. */
const SUPABASE_URL = 'https://aryfefzkqqaaauyrddwp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_sArDqWhtHCH-KgzlzjVG_g_QNiNAUx8';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SupabaseAuth = {
  async ensureSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) return session;
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
      throw new Error(
        'Could not start a session (' + error.message + '). ' +
        'Enable Anonymous Sign-Ins in the Supabase dashboard: Authentication > Providers.'
      );
    }
    return data.session;
  }
};
