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
  },

  /* Magic-link sign-in, for someone who already has a card and is opening
     the app somewhere new: a second device, a different browser, or the same
     browser after clearing data.

     Until this existed the app called signInAnonymously() and nothing else.
     There was no signInWithOtp anywhere in the codebase, so "opening Nexus
     on your new phone" silently minted a fresh empty account and dropped the
     user into onboarding, while their real card -- and every QR code printed
     against its slug -- stayed attached to an identity that existed only in
     the old browser's localStorage. Meanwhile Account.promptSecure has been
     telling users "add an email so you can recover your account on a new
     device", a promise no code in the app could keep.

     shouldCreateUser:false is the load-bearing option. With the default
     (true), typing an address that has no account CREATES one -- which is
     precisely the empty-orphan-account failure this is meant to end, reached
     this time through a button labelled "sign in". Better to say no card was
     found. */
  async signIn(email) {
    // Resolved against the current document rather than the origin root: the
    // app is not guaranteed to be served from /, and a redirect that 404s
    // dead-ends the only account-recovery path there is.
    // Carries a marker, like the existing ?linked=success round trip does.
    // Without one, a successful sign-in is indistinguishable from a cold
    // boot, and — worse — a FAILED one (expired link, or a redirect URL that
    // is not on the Supabase allowlist) drops the user back on onboarding
    // with no explanation, which is precisely the "made a second card by
    // accident" outcome this whole path exists to prevent.
    const redirect = new URL('index.html?signedin=1', location.href).href;
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect, shouldCreateUser: false }
    });
    if (!error) return;
    /* Supabase reports "there is no user with this address" as a
       signups-disabled error. Accurate for the API, useless to a person
       standing at a conference wondering where their card went. */
    if (/signups? not allowed|user not found/i.test(error.message)) {
      throw new Error(
        'No card found for that email. If you never secured your account with an email, ' +
        'the card only exists in the browser you created it in.'
      );
    }
    throw new Error(error.message);
  }
};
