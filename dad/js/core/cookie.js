// Cookie notice. GA4 loads ONLY after Accept, and never on localhost.
import { store } from './util.js?v=c2c7328da2';

const GA_ID = 'G-Z2E5PJ5EDE';
const KEY = 'dad-consent';
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost|.*\.test)$/.test(location.hostname);
let loaded = false;

function loadGA() {
  if (loaded || LOCAL) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { anonymize_ip: true });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

export function pageview() {
  if (window.gtag && loaded) window.gtag('event', 'page_view', { page_path: location.pathname, page_title: document.title });
}

export function init(ready = Promise.resolve()) {
  const el = document.getElementById('cookie');
  const choice = store.get(KEY);
  // (the head script reserves the chip's strip before first paint when no choice is stored)
  const off = () => document.documentElement.classList.remove('has-cookie');
  if (choice === 'accepted') { loadGA(); el?.remove(); off(); return; }
  if (choice === 'declined' || !el) { el?.remove(); off(); return; }
  document.documentElement.classList.add('has-cookie');
  ready.then(() => setTimeout(() => {
    el.hidden = false;
    document.documentElement.classList.add('has-cookie');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-on')));
  }, 1400));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-consent]');
    if (!b) return;
    const ok = b.dataset.consent === 'accept';
    store.set(KEY, ok ? 'accepted' : 'declined');
    if (ok) loadGA();
    el.classList.remove('is-on');
    document.documentElement.classList.remove('has-cookie');
    setTimeout(() => el.remove(), 800);
  });
}
