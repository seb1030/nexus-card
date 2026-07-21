/* Landing V2 — the Madde-style self-drawing network.
   A navy route draws from tile to tile; each tile it reaches lights up as a
   person you've met. Loops forever. Reduced-motion gets the final state. */
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* tile centers in the 440x440 viewBox: 4 cols/rows */
const C = [68, 169, 271, 372];          // slightly inset to match grid padding
const tilesEl = document.getElementById('tiles');
const lattice = document.getElementById('lattice');
const routes = document.getElementById('routes');
const logos = [...document.getElementById('logos').children];

/* people in the story: [col,row] on the grid (0-indexed) */
const CAST = [
  { at: [1, 3], label: 'AR', tag: 'You' },
  { at: [0, 2], label: 'SC', tag: 'Sarah · SaaStr' },
  { at: [2, 0], label: 'MR', tag: 'Mike · SaaStr' },
  { at: [3, 2], label: 'LM', tag: 'Leo · Vercel' },
  { at: [2, 3], label: '⏰', tag: 'Follow-up set' },
];

/* orthogonal routes between consecutive cast members */
const ROUTE_D = [
  `M${C[1]} ${C[3]} L${C[1]} ${C[2]} L${C[0]} ${C[2]}`,
  `M${C[0]} ${C[2]} L${C[0]} ${C[0]} L${C[2]} ${C[0]}`,
  `M${C[2]} ${C[0]} L${C[3]} ${C[0]} L${C[3]} ${C[2]}`,
  `M${C[3]} ${C[2]} L${C[3]} ${C[3]} L${C[2]} ${C[3]}`,
];

/* ---------- build the 4x4 tiles ---------- */
const tileAt = {};
for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
  const t = document.createElement('div');
  t.className = 'tile';
  tilesEl.appendChild(t);
  tileAt[c + ',' + r] = t;
}
CAST.forEach(p => {
  const t = tileAt[p.at.join(',')];
  t.textContent = p.label;
  t.insertAdjacentHTML('beforeend', `<span class="tag">${p.tag}</span>`);
});

/* ---------- static lattice (thin lines between neighbors) ---------- */
let latticeHtml = '';
for (let i = 0; i < 4; i++) {
  latticeHtml += `<line x1="${C[0]}" y1="${C[i]}" x2="${C[3]}" y2="${C[i]}"/>`;
  latticeHtml += `<line x1="${C[i]}" y1="${C[0]}" x2="${C[i]}" y2="${C[3]}"/>`;
}
lattice.innerHTML = latticeHtml;

/* ---------- route drawing ---------- */
function makePath(d) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  routes.appendChild(p);
  const len = p.getTotalLength();
  p.style.strokeDasharray = len;
  p.style.strokeDashoffset = len;
  return p;
}

function light(i) { tileAt[CAST[i].at.join(',')].classList.add('lit'); }
function showLogo(i) { if (logos[i]) logos[i].classList.add('in'); }

function resetAll() {
  routes.innerHTML = '';
  Object.values(tileAt).forEach(t => t.classList.remove('lit'));
  logos.forEach(l => l.classList.remove('in'));
}

/* final state for reduced motion (and as a fallback) */
function finalState() {
  ROUTE_D.forEach(d => { const p = makePath(d); p.style.strokeDashoffset = 0; });
  CAST.forEach((_, i) => light(i));
  logos.forEach((_, i) => showLogo(i));
}

if (reduced) {
  finalState();
} else {
  const DRAW_MS = 750, HOLD_MS = 2600, GAP_MS = 420;
  function cycle() {
    resetAll();
    light(0); showLogo(0);
    ROUTE_D.forEach((d, i) => {
      setTimeout(() => {
        const p = makePath(d);
        requestAnimationFrame(() => {
          p.style.transition = `stroke-dashoffset ${DRAW_MS}ms ease`;
          p.style.strokeDashoffset = 0;
        });
        setTimeout(() => { light(i + 1); showLogo(i + 1); }, DRAW_MS);
      }, 500 + i * (DRAW_MS + GAP_MS));
    });
  }
  cycle();
  setInterval(cycle, 500 + ROUTE_D.length * (750 + 420) + 2600);

  /* gentle parallax on the grid, like the shot's live cursor feel */
  const wrap = document.getElementById('gridwrap');
  if (matchMedia('(pointer: fine)').matches) {
    const hero = document.querySelector('.v2-hero');
    hero.addEventListener('mousemove', e => {
      const r = hero.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - 0.5;
      const dy = (e.clientY - r.top) / r.height - 0.5;
      wrap.style.transform = `translate(${dx * 8}px, ${dy * 6}px)`;
    });
    hero.addEventListener('mouseleave', () => { wrap.style.transform = ''; });
  }
}
