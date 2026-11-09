// Logo ticker: two rows drifting in opposite directions at a slow, constant
// speed. Each track is duplicated once (aria-hidden clones) and its loop
// duration is set from its measured width, so both rows move at the same
// pace whatever their content. Pauses on hover/focus, off-screen, and via
// the toggle button. Reduced motion shows a static wrapped wall (CSS).
import { $, $$ } from './util.js?v=3badc3b098';

const PX_PER_SEC = 26;
let cleanups = [];

function setup(t) {
  if (t.dataset.tickerReady) return;
  t.dataset.tickerReady = '1';
  const tracks = $$('.ticker__track', t);
  if (!tracks.length) return;
  tracks.forEach((track) => {
    Array.from(track.children).forEach((li) => {
      const c = li.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      $$('img', c).forEach((img) => { img.alt = ''; img.loading = 'eager'; });
      track.appendChild(c);
    });
  });
  const measure = () => {
    tracks.forEach((track) => {
      const half = track.scrollWidth / 2;
      if (half > 0) track.style.setProperty('--speed', `${(half / PX_PER_SEC).toFixed(1)}s`);
    });
  };
  measure();
  $$('img', t).forEach((img) => { if (!img.complete) img.addEventListener('load', measure, { once: true }); });
  const ro = 'ResizeObserver' in window ? new ResizeObserver(measure) : null;
  ro?.observe(t);
  const btn = $('.ticker__toggle', t);
  const onBtn = () => {
    const paused = t.classList.toggle('is-paused');
    btn.setAttribute('aria-pressed', String(paused));
    btn.setAttribute('aria-label', paused ? 'Play logo ticker' : 'Pause logo ticker');
  };
  btn?.addEventListener('click', onBtn);
  // pause while off-screen (saves battery)
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => {
    tracks.forEach((track) => { track.style.animationPlayState = e.isIntersecting ? '' : 'paused'; });
  }) : null;
  io?.observe(t);
  cleanups.push(() => { ro?.disconnect(); io?.disconnect(); btn?.removeEventListener('click', onBtn); });
}

export function bind(root) { $$('[data-ticker], .ticker', root).forEach(setup); }
export function unbind() { cleanups.forEach((f) => f()); cleanups = []; }
