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
    const view = document.getElementById('view');
    /* Restore focus to the element that HAD it, at the caret position it
       had. The old version grabbed the first input[type=text] in the view
       and slammed the caret to the end — so typing "stipe", clicking back
       to fix the typo and typing "r" produced "stiper", and on the contact
       detail view it moved focus to a different field entirely. */
    const active = keepFocus ? document.activeElement : null;
    const focusId = active && active.id;
    const selStart = active && active.selectionStart;
    const selEnd = active && active.selectionEnd;
    const pos = view.scrollTop;
    view.innerHTML = this.views[this.tab]();
    view.scrollTop = pos;
    if (focusId) {
      const again = view.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId));
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
    /* Arriving with ?signedin=1 but NO card means the sign-in link did not
       produce the session it promised — an expired link, or a redirect URL
       missing from the Supabase allowlist, which sends the user here on a
       fresh anonymous account instead. Silently showing onboarding is how a
       returning user ends up building a second card and stranding the first;
       say so instead. */
    if (new URLSearchParams(location.search).get('signedin') === '1') {
      history.replaceState({}, '', location.pathname);
      toast('That sign-in link didn’t work — it may have expired. Send a fresh one.');
    }
  }
})();
