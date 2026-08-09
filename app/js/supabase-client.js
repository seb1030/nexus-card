/* Supabase client + anonymous-first session bootstrap.
   Onboarding stays zero-friction (no email/password prompt) because every
   visitor gets a real, silent auth.uid() via signInAnonymously() — that's
   what lets RLS policies like "owner_id = auth.uid()" work from screen 1.
   Requires Authentication > Providers > Enable Anonymous Sign-Ins to be
   turned on in the Supabase dashboard; there is no API for that setting. */
const SUPABASE_URL = 'https://aryfefzkqqaaauyrddwp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_sArDqWhtHCH-KgzlzjVG_g_QNiNAUx8';

/* flowType pinned to the value this SDK version already resolves to, rather
   than left to the default. It is load-bearing for account recovery: under
   `implicit` the session comes back in the URL fragment, so a sign-in link
   works on ANY device -- which is the entire point of the feature, since the
   user reaching for it is typically on a new phone. Under `pkce` the code
   verifier lives in the originating browser's storage, so that same link
   opened anywhere else silently fails to sign them in.

   PKCE is the more secure default in general (an implicit-flow token can
   leak through referrers and browser history) and is worth revisiting, but
   only together with a same-device story for recovery. Pinning it here means
   a future supabase-js upgrade that changes the default cannot quietly break
   cross-device sign-in. */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'implicit' }
});

const SupabaseAuth = {
  async ensureSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (session && await this.sessionUserStillExists()) return session;

    /* Session existed but its user does not. getSession() only reads
       localStorage -- it never asks the server whether that user is still
       there -- so a JWT for a deleted account stays cryptographically valid
       until it expires and sails straight through. Every write then fails
       with `violates foreign key constraint "cards_owner_id_fkey"`, shown to
       the user as raw Postgres, and it never resolves on its own: reloading
       re-reads the same dead session from storage. The only escape is
       manually clearing site data, which nobody will find.

       This is reachable in normal use, not just after an admin cleanup:
       delete-account removes the auth user, and any other tab still open on
       the app keeps its now-orphaned session. Discarding it locally and
       starting fresh is always the right move -- the account is gone either
       way, and an anonymous session is exactly what a new visitor gets. */
    if (session) {
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* already gone */ }
    }

    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
      throw new Error(
        'Could not start a session (' + error.message + '). ' +
        'Enable Anonymous Sign-Ins in the Supabase dashboard: Authentication > Providers.'
      );
    }
    return data.session;
  },

  /* Verifies the cached session against the server. getUser() hits
     /auth/v1/user, so a deleted or otherwise invalid user comes back as an
     error rather than being taken on trust.

     A network failure must NOT be read as "user is gone" -- that would sign
     people out every time their connection blips, and on a conference wifi
     that is the common case. Only an explicit auth error counts; anything
     that looks like a transport problem keeps the existing session, and the
     app fails later in its normal way if the connection really is down. */
  async sessionUserStillExists() {
    try {
      const { error } = await sb.auth.getUser();
      if (!error) return true;
      const status = error.status || 0;
      return !(status === 401 || status === 403 || status === 404);
    } catch (e) {
      return true;
    }
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
