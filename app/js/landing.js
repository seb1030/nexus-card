/* Landing page interactivity: scroll reveals, hero parallax, and the
   two-phone exchange demo. All motion respects prefers-reduced-motion. */
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- scroll reveal ---------- */
if (!reduced) {
  const els = document.querySelectorAll(
    'section h2, .sect-sub, .grid3 > *, .privacy-inner > *, .final-inner > *, .ex-stage, .ex-steps');
  els.forEach(el => el.classList.add('reveal'));
  document.querySelectorAll('.grid3').forEach(g =>
    [...g.children].forEach((c, i) => c.style.transitionDelay = (i * 90) + 'ms'));
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.15 });
  els.forEach(el => io.observe(el));
}

/* ---------- hero parallax (fine pointers only) ---------- */
const phone = document.querySelector('.hero-phone .phone');
if (phone && !reduced && matchMedia('(pointer: fine)').matches) {
  const hero = document.querySelector('.hero');
  hero.addEventListener('mousemove', e => {
    const r = hero.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5;
    const dy = (e.clientY - r.top) / r.height - 0.5;
    phone.style.transform = `translate(${dx * -10}px, ${dy * -8}px) rotate(${dx * 1.6}deg)`;
  });
  hero.addEventListener('mouseleave', () => { phone.style.transform = ''; });
}

/* ---------- exchange demo ---------- */
const exYou = document.getElementById('ex-you');
const exThem = document.getElementById('ex-them');
const exDot = document.getElementById('ex-dot');
const exSteps = document.getElementById('ex-steps');

if (exYou) {
  const qr = `<div class="ex-qr">${Array.from({ length: 25 }, () =>
    `<i style="opacity:${Math.random() > .45 ? 1 : 0}"></i>`).join('')}</div>`;
  const yourCard = (small) => `
    <div class="ex-card${small ? ' small' : ''}">
      <div class="ex-avatar">AR</div><b>Alex Rivera</b>
      <span>Product Designer @ Acme</span>
      <div class="ex-btn">Book a call</div>
    </div>`;

  const STEPS = [
    {
      label: 'You tap Share',
      you: `${yourCard(true)}${qr}<p class="ex-cap">Your QR — works offline</p>`,
      them: `<div class="ex-camera">📷<p>Sarah opens her camera</p></div>`,
      dot: null
    },
    {
      label: 'Sarah scans — your card opens in her browser',
      you: `${yourCard(true)}${qr}<p class="ex-cap">Sharing…</p>`,
      them: `${yourCard(false)}<div class="ex-btn ghost">Save to Contacts</div><p class="ex-cap">No app download</p>`,
      dot: 'go'
    },
    {
      label: 'She shares her info back — one tap',
      you: `<div class="ex-camera">📤<p>Incoming…</p></div>`,
      them: `<div class="ex-form"><b>Share your info back?</b>
        <div class="ex-field">Sarah Chen</div>
        <div class="ex-field">VP Product @ Stripe</div>
        <div class="ex-btn">Share my info</div></div>`,
      dot: 'back'
    },
    {
      label: 'Nexus preps the follow-up',
      you: `<div class="ex-new"><div class="ex-avatar sc">SC</div><b>Sarah Chen</b>
        <span>VP Product @ Stripe</span>
        <div class="ex-pill">📍 Met at SaaStr Annual</div>
        <div class="ex-pill hot">⏰ Reminder: follow up in 3 days</div></div>`,
      them: `<div class="ex-camera">✅<p>Card saved to her phone</p></div>`,
      dot: null
    },
  ];

  exSteps.innerHTML = STEPS.map((s, i) =>
    `<button class="ex-step" data-i="${i}"><span>${i + 1}</span>${s.label}</button>`).join('');
  const stepBtns = [...exSteps.children];

  let cur = -1, timer = null;
  function setStep(i) {
    cur = i;
    const s = STEPS[i];
    exYou.innerHTML = s.you;
    exThem.innerHTML = s.them;
    stepBtns.forEach((b, j) => b.classList.toggle('on', j === i));
    exDot.className = 'ex-dot';
    if (s.dot && !reduced) {
      void exDot.offsetWidth;               // restart the travel animation
      exDot.classList.add(s.dot);
    }
  }
  function play() {
    clearInterval(timer);
    timer = setInterval(() => setStep((cur + 1) % STEPS.length), 3000);
  }
  stepBtns.forEach(b => b.addEventListener('click', () => { setStep(+b.dataset.i); play(); }));

  setStep(0);
  if (!reduced) play();
}
