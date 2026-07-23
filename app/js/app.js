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
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    this.renderTab();
  },

  renderTab(keepFocus) {
    const view = document.getElementById('view');
    const active = keepFocus ? document.activeElement : null;
    const pos = view.scrollTop;
    view.innerHTML = this.views[this.tab]();
    view.scrollTop = pos;
    if (active && active.tagName === 'INPUT') {
      const again = view.querySelector('input[type=text]');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }
    this.refreshBadge();
  },

  refreshBadge() {
    const overdue = Store.dueReminders().filter(d => d.reminder.due < Date.now()).length;
    const b = document.getElementById('due-badge');
    b.textContent = overdue;
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

/* boot */
(async () => {
  try {
    await Store.load();
  } catch (err) {
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
    Onboarding.start();
  }
})();
