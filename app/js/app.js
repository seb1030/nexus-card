/* Home-screen install prompt. A page you visit through a bookmark is easy
   to forget; an icon on the home screen is not — that's the entire reason
   this exists.

   Android/desktop Chrome and Edge fire `beforeinstallprompt`, which can be
   captured and replayed later from our own button. iOS Safari has no such
   event and never has — Apple has shipped no programmatic install API — so
   the only thing possible there is telling the user the manual Share ->
   Add to Home Screen steps; there is nothing to "trigger".

   The listener is registered at module load, before App.boot() runs and
   before onboarding may still be showing, because `beforeinstallprompt`
   can fire at any point after page load and is only offered once per
   session by the browser — missing it here means losing it entirely for
   that visit. Showing the banner is harmless even while `#app` is still
   `.hidden` behind onboarding: removing the banner's own hidden class does
   nothing visible until the ancestor is shown, so this never jumps ahead
   of onboarding. */
const InstallPrompt = {
  deferred: null,
  DISMISSED_KEY: 'nexus-install-dismissed',

  isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  },
  isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  },
  wasDismissed() {
    try { return localStorage.getItem(this.DISMISSED_KEY) === '1'; } catch (e) { return false; }
  },

  init() {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Stops Chrome's own mini-infobar so our banner is the only prompt —
      // two competing "install this?" UIs is worse than either alone.
      e.preventDefault();
      this.deferred = e;
      this.show('android');
    });
    // iOS never fires an event to wait for, so show its instructions
    // immediately rather than waiting on something that will never come.
    if (this.isIOS()) this.show('ios');
  },

  show(kind) {
    if (this.isStandalone() || this.wasDismissed()) return;
    const banner = document.getElementById('install-banner');
    if (!banner) return;
    const text = document.getElementById('install-banner-text');
    const btn = document.getElementById('install-banner-btn');
    if (kind === 'android') {
      text.textContent = '📲 Add Nexus to your home screen — one tap, no store.';
      btn.textContent = 'Install';
      btn.onclick = () => this.trigger();
    } else {
      text.textContent = '📲 Tap Share, then “Add to Home Screen” — no store needed.';
      btn.textContent = 'Got it';
      btn.onclick = () => this.dismiss();
    }
    banner.classList.remove('hidden');
  },

  async trigger() {
    if (!this.deferred) return;
    this.deferred.prompt();
    const { outcome } = await this.deferred.userChoice;
    this.deferred = null;
    // Accepted: it is genuinely installed now, never ask again. Declined:
    // just hide for this page load — the browser itself throttles how
    // often it re-offers beforeinstallprompt, so this does not nag on
    // every visit, and the explicit ✕ below is the deliberate "stop
    // asking" action, not a single decline.
    if (outcome === 'accepted') this.dismiss();
    else document.getElementById('install-banner').classList.add('hidden');
  },

  dismiss() {
    try { localStorage.setItem(this.DISMISSED_KEY, '1'); } catch (e) { /* private mode */ }
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.add('hidden');
  }
};
InstallPrompt.init();

/* App shell — tabs, sheets, toasts, boot */
const App = {
  tab: 'card',
  views: { card: () => CardView.render(), contacts: () => Contacts.render(), pipeline: () => Pipeline.render(), analytics: () => Analytics.render() },

  boot() {
    document.getElementById('app').classList.remove('hidden');
    this.go('card');
    this.refreshBadge();
  },

  go(tab) {
    this.tab = tab;
    if (tab !== 'contacts') Contacts.openId = null;
    document.querySelectorAll('.tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.renderTab();
  },

  renderTab(keepFocus) {
    // #view is the scroll container and stays put across tab switches;
    // only #view-content is replaced, so the install banner living beside
    // it in #view survives every App.go()/renderTab() instead of being
    // wiped and reconstructed on each one.
    const scrollHost = document.getElementById('view');
    const content = document.getElementById('view-content');
    /* Restore focus to the element that HAD it, at the caret position it
       had. The old version grabbed the first input[type=text] in the view
       and slammed the caret to the end — so typing "stipe", clicking back
       to fix the typo and typing "r" produced "stiper", and on the contact
       detail view it moved focus to a different field entirely. */
    const active = keepFocus ? document.activeElement : null;
    const focusId = active && active.id;
    const selStart = active && active.selectionStart;
    const selEnd = active && active.selectionEnd;
    const pos = scrollHost.scrollTop;
    content.innerHTML = this.views[this.tab]();
    scrollHost.scrollTop = pos;
    if (focusId) {
      const again = content.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId));
      if (again) {
        again.focus();
        try { again.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text input */ }
      }
    }
    this.refreshBadge();
  },

  refreshBadge() {
    const overdue = Store.dueReminders().filter(d => d.reminder.due < Date.now()).length;
    const b = document.getElementById('due-badge');
    b.textContent = overdue;
    // A bare number reads as nothing useful; name what it counts.
    b.setAttribute('aria-label', overdue === 1 ? '1 follow-up overdue' : overdue + ' follow-ups overdue');
    b.classList.toggle('hidden', overdue === 0);
  }
};

/* sheet helpers */
function openSheet(html) {
  document.getElementById('sheet').innerHTML = '<div class="sheet-handle"></div>' + html;
  document.getElementById('sheet').classList.remove('hidden');
  document.getElementById('sheet-backdrop').classList.remove('hidden');
}
function closeSheet() {
  document.getElementById('sheet').classList.add('hidden');
  document.getElementById('sheet-backdrop').classList.add('hidden');
}
document.getElementById('sheet-backdrop').addEventListener('click', closeSheet);

/* toast helper */
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

/* Wraps a mutating handler so a failed write surfaces to the user instead
   of becoming an unhandled rejection. Without this, a rejected store call
   aborts the handler mid-way: the sheet never closes, the pipeline card
   snaps back, and nothing explains why. */
async function guard(fn, msg) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast((msg || 'Something went wrong') + ': ' + (err?.message || err));
  }
}

/* Last-resort net for anything not routed through guard(). */
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection', e.reason);
  toast('Something went wrong — please try again.');
});

/* Service worker — caches the app shell only, never Supabase data.
   Registered after load so it never competes with the first paint or the
   session bootstrap. Requires a secure context: it silently no-ops on
   plain http://, which is correct for local file testing. */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', location.href).href)
      .catch(err => console.warn('service worker registration failed', err));
  });
}

/* tab clicks */
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => App.go(b.dataset.tab)));

/* Boot skeleton. Store.load() is a session bootstrap plus three serialised
   queries; on mobile data that is seconds of blank #fafafa with no spinner,
   which reads as a broken app and prompts a reload — restarting the whole
   chain. Delayed so a warm load never flashes it: under ~180ms the user just
   sees the real UI. */
let bootSkeletonTimer = setTimeout(() => {
  const view = document.getElementById('view');
  if (!view || view.innerHTML) return;
  document.getElementById('app').classList.remove('hidden');
  view.innerHTML = `
    <div aria-busy="true" aria-label="Loading">
      <div class="sk sk-line" style="width:34%;height:22px;margin:4px 0 18px"></div>
      <div class="sk" style="height:190px;border-radius:18px;margin-bottom:16px"></div>
      <div class="sk sk-row"></div><div class="sk sk-row" style="opacity:.7"></div>
      <div class="sk sk-row" style="opacity:.45"></div>
    </div>`;
}, 180);

const clearBootSkeleton = () => {
  clearTimeout(bootSkeletonTimer);
  const view = document.getElementById('view');
  if (view && view.querySelector('[aria-busy]')) view.innerHTML = '';
};

/* boot */
(async () => {
  try {
    await Store.load();
    clearBootSkeleton();
  } catch (err) {
    clearBootSkeleton();
    console.error(err);
    document.getElementById('phone').insertAdjacentHTML('beforeend', `
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:28px;background:#fafafa;z-index:99">
        <div style="text-align:center;max-width:320px">
          <div style="font-size:32px;margin-bottom:10px">⚠️</div>
          <p style="font-weight:600;margin-bottom:8px">Couldn't connect</p>
          <p style="color:#71717a;font-size:14px;line-height:1.5">${esc(err.message || 'Check your connection and reload.')}</p>
          <button class="btn" style="margin-top:16px" onclick="location.reload()">Retry</button>
        </div>
      </div>`);
    return;
  }
  if (Store.state.onboarded) {
    document.documentElement.style.setProperty('--brand', Store.state.me.color);
    App.boot();

    // Returning from Stripe Checkout — the webhook may land a moment
    // after the redirect, so poll briefly rather than assuming it's
    // already processed.
    const params = new URLSearchParams(location.search);

    // Landed here from a sign-in link and we DO have a card — the recovery
    // worked. Confirm it, so the user knows this is their existing card and
    // not a new one.
    if (params.get('signedin') === '1') {
      history.replaceState({}, '', location.pathname);
      toast('✓ Signed in — your card and contacts are back');
    }

    const checkoutResult = params.get('checkout');
    if (checkoutResult) {
      history.replaceState({}, '', location.pathname);
      if (checkoutResult === 'success') {
        toast('✓ Payment received — activating your plan…');
        // Self-scheduling rather than setInterval: the callback awaits, so
        // an interval fires overlapping iterations on a slow connection and
        // several of them each toast and re-render before one clears it.
        let tries = 0;
        const poll = async () => {
          tries++;
          let plan = 'free';
          try { plan = await Store.refreshProfile(); } catch (err) { console.error(err); }
          if (plan === 'free' && tries < 6) { setTimeout(poll, 1200); return; }
          toast(plan !== 'free'
            ? '🎉 Welcome to ' + (plan === 'team' ? 'Team' : 'Pro') + '!'
            : 'Still activating — reload in a moment if it doesn’t update.');
          App.renderTab();
        };
        setTimeout(poll, 1200);
      } else if (checkoutResult === 'cancel') {
        toast('Checkout canceled — no charge made.');
      }
    }

    // PWA shortcuts (manifest.json) land here with a plain query param —
    // no checkout/link round trip involved, so handle them independently.
    if (params.get('tab') === 'contacts') {
      history.replaceState({}, '', location.pathname);
      App.go('contacts');
    } else if (params.get('action') === 'share') {
      history.replaceState({}, '', location.pathname);
      CardView.shareSheet();
    }

    // Returning from the account-linking confirmation email.
    if (params.get('linked') === 'success') {
      history.replaceState({}, '', location.pathname);
      Store.refreshProfile().then(() => {
        toast(Store.state.accountSecured ? '🔐 Account secured — you can now recover it anytime' : '✓ Confirmed');
        App.renderTab();
        // If they were mid-upgrade when we sent them to link an email,
        // pick that back up rather than making them find Plans again.
        Paywall.resumePending();
      }).catch(err => {
        console.error(err);
        toast('Could not confirm your account — please reload.');
      });
    }
  } else {
    document.getElementById('app').classList.add('hidden');
    Onboarding.start();
    /* Arriving with ?signedin=1 and no card is ambiguous, and the two cases
       need opposite messages:

         - The link FAILED (expired, or a redirect URL missing from the
           Supabase allowlist). The user lands on a fresh ANONYMOUS account.
           Saying nothing is how a returning user builds a second card and
           strands the first, so this has to be called out.

         - The link WORKED but the account genuinely has no card yet — it was
           deleted, or the email was secured before a card was ever built.
           The user is signed in as themselves. Telling them the link failed
           would be a lie that pushes them to request another one forever.

       is_anonymous is what separates them. */
    if (new URLSearchParams(location.search).get('signedin') === '1') {
      history.replaceState({}, '', location.pathname);
      sb.auth.getUser().then(({ data }) => {
        const u = data && data.user;
        if (u && u.is_anonymous === false) {
          toast('✓ Signed in as ' + (u.email || 'your account') + ' — build your card to get started');
        } else {
          toast('That sign-in link didn’t work — it may have expired. Send a fresh one.');
        }
      }).catch(() => {
        toast('That sign-in link didn’t work — it may have expired. Send a fresh one.');
      });
    }
  }
})();
