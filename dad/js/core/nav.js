// Fixed top nav + full-screen menu.
import { html, $, $$, isTouch, mq } from './util.js?v=e09c939d0f';

let nav, burger, menu, progress, mcta, lastY = 0, ticking = false, open = false, lastFocus = null;

function setActive() {
  const path = location.pathname.replace(/index\.html$/, '');
  $$('[data-nav]').forEach((a) => {
    const href = a.getAttribute('href');
    const on = href === path || (href !== '/' && path.startsWith(href));
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function onScroll() {
  const y = window.__lenis ? window.__lenis.scroll : window.scrollY;
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  nav.classList.toggle('is-solid', y > 24);
  progress?.style.setProperty('--sp', Math.min(1, y / max).toFixed(4));
  // hide on scroll down / show on scroll up (mobile + tablet)
  if (!open && mq('(max-width: 1139px)')) {
    const dy = y - lastY;
    if (y > 160 && dy > 4) nav.classList.add('is-hidden');
    else if (dy < -4 || y < 160) nav.classList.remove('is-hidden');
  } else nav.classList.remove('is-hidden');
  // sticky mobile CTA: after the first screen, away from forms and the footer
  if (mcta) {
    const footer = document.getElementById('footer');
    const nearFooter = footer && footer.getBoundingClientRect().top < innerHeight;
    const formInView = $$('#swap form, #swap .form-success, #swap [data-no-mcta]').some((f) => {
      const r = f.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0;
    });
    const show = y > innerHeight * 0.85 && !nearFooter && !formInView && !open;
    mcta.classList.toggle('is-on', show);
    html.classList.toggle('has-mcta', show && mq('(max-width: 719px)'));
  }
  lastY = y;
  ticking = false;
}

function requestScroll() {
  if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
}

function focusables() {
  return [burger, ...$$('a[href], button:not([disabled])', menu)].filter((el) => el.offsetParent !== null || el === burger);
}

function trap(e) {
  if (!open) return;
  if (e.key === 'Escape') { e.preventDefault(); toggle(false); return; }
  if (e.key !== 'Tab') return;
  const f = focusables();
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function toggle(force) {
  const next = typeof force === 'boolean' ? force : !open;
  if (next === open) return;
  open = next;
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  html.classList.toggle('menu-open', open);
  if (open) {
    lastFocus = document.activeElement;
    menu.removeAttribute('inert');
    menu.classList.remove('is-closing');
    menu.classList.add('is-open');
    $$('.menu__link > *, .menu__cta, .menu__foot, .menu__tag', menu).forEach((el, i) => { el.style.transitionDelay = `${0.12 + i * 0.035}s`; });
    window.__lenis?.stop();
    html.classList.add('is-locked');
    nav.classList.remove('is-hidden');
    mcta?.classList.remove('is-on');
    setTimeout(() => $('.menu__link', menu)?.focus({ preventScroll: true }), 350);
  } else {
    menu.classList.remove('is-open');
    menu.classList.add('is-closing');
    $$('.menu__link > *, .menu__cta, .menu__foot, .menu__tag', menu).forEach((el) => { el.style.transitionDelay = '0s'; });
    menu.setAttribute('inert', '');
    window.__lenis?.start();
    html.classList.remove('is-locked');
    setTimeout(() => menu.classList.remove('is-closing'), 800);
    if (lastFocus && document.contains(lastFocus) && !menu.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    else burger.focus({ preventScroll: true });
  }
}

export function isOpen() { return open; }

export function init() {
  nav = document.getElementById('nav');
  burger = $('.nav__burger', nav);
  menu = document.getElementById('menu');
  progress = $('.nav__progress', nav);
  mcta = document.getElementById('mobile-cta');
  if (!nav) return;
  setActive();
  burger?.addEventListener('click', () => toggle());
  document.addEventListener('keydown', trap);
  menu?.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a) toggle(false);
  });
  window.addEventListener('scroll', requestScroll, { passive: true });
  window.__lenis?.on('scroll', requestScroll);
  window.addEventListener('resize', () => { if (open && mq('(min-width: 1140px)')) toggle(false); requestScroll(); });
  onScroll();
  if (isTouch()) html.classList.add('is-touch');
}

export function update() {
  setActive();
  if (open) toggle(false);
  nav?.classList.remove('is-hidden');
  lastY = 0;
  requestScroll();
}
