// Desktop-only cursor follower. The native cursor stays visible everywhere;
// the follower is a soft ring that grows over interactive elements and can
// show a short label: <a data-cursor="Read">.
import { html, isFinePointer, prefersReduced } from './util.js?v=c2c7328da2';

export function init() {
  const el = document.getElementById('cursor');
  if (!el || !isFinePointer() || prefersReduced()) { el?.remove(); return; }
  html.classList.add('has-cursor');
  const label = el.querySelector('.cursor__label');
  let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y, shown = false;
  const INTERACTIVE = 'a, button, [role="button"], summary, label, [data-cursor]';
  const FIELDS = 'input, textarea, select';

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    x = e.clientX; y = e.clientY;
    if (!shown) { cx = x; cy = y; shown = true; el.classList.add('is-active'); }
  }, { passive: true });
  document.addEventListener('pointerleave', () => { el.classList.remove('is-active'); shown = false; });
  window.addEventListener('pointerdown', () => el.classList.add('is-down'));
  window.addEventListener('pointerup', () => el.classList.remove('is-down'));

  document.addEventListener('pointerover', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest(FIELDS)) { el.classList.add('is-hidden'); el.classList.remove('is-hover', 'is-label'); return; }
    el.classList.remove('is-hidden');
    const lab = t.closest('[data-cursor]');
    if (lab) { label.textContent = lab.dataset.cursor; el.classList.add('is-label'); el.classList.remove('is-hover'); return; }
    el.classList.remove('is-label');
    el.classList.toggle('is-hover', !!t.closest(INTERACTIVE));
  });

  const tick = () => {
    cx += (x - cx) * 0.2;
    cy += (y - cy) * 0.2;
    el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
  };
  if (window.gsap) window.gsap.ticker.add(tick);
  else { const loop = () => { tick(); requestAnimationFrame(loop); }; loop(); }
}
