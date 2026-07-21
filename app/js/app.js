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
        let tries = 0;
        const poll = setInterval(async () => {
          tries++;
          const plan = await Store.refreshProfile();
          if (plan !== 'free' || tries >= 6) {
            clearInterval(poll);
            toast(plan !== 'free'
              ? '🎉 Welcome to ' + (plan === 'team' ? 'Team' : 'Pro') + '!'
              : 'Still activating — reload in a moment if it doesn’t update.');
            App.renderTab();
            // A paying account is still a silent anonymous session unless
            // linked — without this, clearing browser data or switching
            // devices loses access to the subscription with no way back.
            if (plan !== 'free' && !Store.state.accountSecured) {
              sb.auth.getSession().then(({ data: { session } }) => {
                if (session?.user?.is_anonymous) {
                  Account.promptSecure('You just went ' + (plan === 'team' ? 'Team' : 'Pro') + ' — add an email so you never lose access to it.');
                }
              });
            }
          }
        }, 1200);
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
      });
    }
  } else {
    Onboarding.start();
  }
})();
