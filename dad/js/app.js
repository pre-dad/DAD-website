// DAD website runtime. Boot order (see the runtime contract):
// tier -> Lenis -> Dollar -> Dots -> mountPage(main). Router swaps pages and
// calls unmountPage/mountPage. Every module is defensive: a failure in one
// never blocks the content.
import { detectTier } from './core/tier.js?v=f5d5bbea69';
import { html, isTouch, prefersReduced } from './core/util.js?v=f5d5bbea69';
import * as theme from './core/theme.js?v=f5d5bbea69';
import * as reveals from './core/reveals.js?v=f5d5bbea69';
import * as router from './core/router.js?v=f5d5bbea69';
import * as nav from './core/nav.js?v=f5d5bbea69';
import * as preloader from './core/preloader.js?v=f5d5bbea69';
import * as forms from './core/forms.js?v=f5d5bbea69';
import * as partnerModal from './core/partner-modal.js?v=f5d5bbea69';
import * as cookie from './core/cookie.js?v=f5d5bbea69';
import * as ticker from './core/ticker.js?v=f5d5bbea69';
import * as cursor from './core/cursor.js?v=f5d5bbea69';
import * as magnetic from './core/magnetic.js?v=f5d5bbea69';
import * as ui from './core/ui.js?v=f5d5bbea69';
import * as scenes from './core/scenes.js?v=f5d5bbea69';
import * as ledger from './core/ledger.js?v=f5d5bbea69';

const gsap = window.gsap;
const ST = window.ScrollTrigger;
const reduced = prefersReduced();
const tier = detectTier();
window.__tier = tier;
html.classList.add(`tier-${tier}`);
if (reduced) html.classList.add('reduced');

const safe = (label, fn) => { try { return fn(); } catch (e) { console.error(`[dad:${label}]`, e); return undefined; } };

/* ---------- GSAP + smooth scroll ---------- */
if (gsap && ST) {
  gsap.registerPlugin(ST);
  if (window.SplitText) gsap.registerPlugin(window.SplitText);
  ST.config({ ignoreMobileResize: true });
  gsap.config({ nullTargetWarn: false });
}
let lenis = null;
if (gsap && ST && window.Lenis && !isTouch() && !reduced) {
  safe('lenis', () => {
    lenis = new window.Lenis({ lerp: 0.12, smoothWheel: true, wheelMultiplier: 0.95, touchMultiplier: 1, syncTouch: false });
    lenis.on('scroll', ST.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  });
}
window.__lenis = lenis;

/* ---------- liquid drop + dot illustrations (loaded in parallel, optional) ---------- */
const stubDollar = { bind() {}, unbind() {}, flyTo() {}, setTheme() {}, stub: true };
const stubDots = { bind() {}, unbind() {}, morph() {}, stub: true };
let dollar = stubDollar;
let dots = stubDots;
window.__dollar = dollar;
window.__dots = dots;

const main = () => document.getElementById('swap');
let pageModule = null;
let mountedMain = null;

/* ---------- deferred images ----------
   <img src="(1px placeholder)" data-src="..."> (home's team photos): fetched once the page
   has painted and gone idle, so they never compete with the first view, but are cached
   long before a visitor reaches them. Boxes are sized by width/height, so nothing shifts. */
function warmImages(el) {
  const imgs = el.querySelectorAll('img[data-src]');
  if (!imgs.length) return;
  const go = () => imgs.forEach((img) => { if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); } });
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 2500 }) : setTimeout(go, 300));
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

/* ---------- page lifecycle ---------- */
async function mountPage(el, { routed = false } = {}) {
  mountedMain = el;
  safe('images', () => warmImages(el));
  const name = el.dataset.page || document.body.dataset.page || '';
  safe('scenes', () => scenes.bind(el));
  safe('theme', () => theme.bind(el, { animate: routed }));
  safe('ui', () => ui.bind(el));
  safe('reveals', () => reveals.bind(el));
  safe('dots', () => dots.bind(el));
  safe('dollar', () => dollar.bind(el));
  safe('ledger', () => ledger.bind(el));
  safe('forms', () => forms.bind(el));
  safe('partner-modal', () => partnerModal.bind());
  safe('ticker', () => ticker.bind(el));
  safe('magnetic', () => magnetic.bind(el));
  // page-specific code: front-matter "module" or window.__pageHooks[name]
  const ctx = { tier, reduced, lenis, gsap, ScrollTrigger: ST, get dollar() { return dollar; }, get dots() { return dots; } };
  pageModule = null;
  const modUrl = el.dataset.module;
  if (modUrl) {
    try {
      pageModule = await import(modUrl);
      await pageModule.mount?.(el, ctx);
    } catch (e) { console.error('[dad:page-module]', e); }
  }
  safe('hooks', () => window.__pageHooks?.[name]?.mount?.(el, ctx));
  if (ST) ST.refresh();
}

function unmountPage(el) {
  const name = el.dataset.page || '';
  safe('hooks', () => window.__pageHooks?.[name]?.unmount?.(el));
  safe('page-module', () => pageModule?.unmount?.(el));
  pageModule = null;
  safe('ledger', () => ledger.unbind());
  safe('magnetic', () => magnetic.unbind());
  safe('ticker', () => ticker.unbind());
  safe('forms', () => forms.unbind());
  safe('dollar', () => dollar.unbind());
  safe('dots', () => dots.unbind());
  safe('reveals', () => reveals.unbind());
  safe('ui', () => ui.unbind());
  safe('theme', () => theme.unbind());
  safe('scenes', () => scenes.unbind());
}

async function loadModules() {
  const opts = { tier, reduced };
  const [dm, tm] = await Promise.allSettled([
    import('./dollar/dollar.js?v=f5d5bbea69'),
    import('./dots/dots.js?v=f5d5bbea69'),
  ]);
  if (dm.status === 'fulfilled' && dm.value?.Dollar) {
    try {
      dollar = new dm.value.Dollar(document.getElementById('gl'), opts);
      window.__dollar = dollar;
      dollar.setTheme?.(theme.get());
      if (mountedMain) dollar.bind(mountedMain);
    } catch (e) {
      console.warn('[dad:dollar] unavailable', e);
      html.classList.add('no-gl');
      dollar = stubDollar;
      window.__dollar = dollar;
    }
  } else {
    if (dm.status === 'rejected') console.warn('[dad:dollar] not loaded', dm.reason?.message || dm.reason);
    html.classList.add('no-gl');
  }
  if (tm.status === 'fulfilled' && tm.value?.Dots) {
    try {
      dots = new tm.value.Dots(opts);
      window.__dots = dots;
      if (mountedMain) dots.bind(mountedMain);
    } catch (e) {
      console.warn('[dad:dots] unavailable', e);
      dots = stubDots;
      window.__dots = dots;
    }
  } else if (tm.status === 'rejected') console.warn('[dad:dots] not loaded', tm.reason?.message || tm.reason);
  ST?.refresh();
}

/* ---------- boot ---------- */
function boot() {
  window.__booted = true;
  html.classList.add('is-booted');
  const ready = preloader.start();
  window.__ready = ready;
  ready.then(() => {
    html.classList.add('is-ready');
    safe('dollar-intro', () => dollar.intro?.());
  });
  safe('reveals-init', () => reveals.init({ ready }));
  safe('theme-init', () => theme.init({ getDollar: () => dollar }));
  safe('nav', () => nav.init());
  safe('partner-modal-init', () => partnerModal.init());
  // custom cursor removed (Chris, 2026-10-11): the native pointer is used everywhere
  safe('cookie', () => cookie.init(ready));
  safe('ui-global', () => ui.enhanceButtons(document.body));
  safe('magnetic-global', () => magnetic.bindGlobal(document.getElementById('nav')));
  safe('footer', () => reveals.bindGlobal(document.getElementById('footer')));
  safe('router', () => router.init({
    unmount: unmountPage,
    mount: (el, o) => mountPage(el, o),
    after: () => { nav.update(); cookie.pageview(); },
  }));

  const m = main();
  if (m) {
    mountPage(m).then(() => {
      if (location.hash) {
        const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (t) setTimeout(() => { if (scenes.goToElement(t, { immediate: true })) return; if (lenis) lenis.scrollTo(t, { offset: -80, immediate: true }); else t.scrollIntoView(); }, 60);
      }
    });
  }
  loadModules();

  if (document.fonts) document.fonts.ready.then(() => ST?.refresh());
  window.addEventListener('load', () => ST?.refresh());
  // pause smooth scroll while the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!lenis) return;
    if (document.hidden) lenis.stop(); else if (!html.classList.contains('is-locked')) lenis.start();
  });
}

if (!gsap || !ST) {
  // vendor scripts failed: show everything, keep forms + nav working
  html.classList.add('reveal-all');
  window.__booted = true;
  document.getElementById('preloader')?.remove();
  safe('nav', () => nav.init());
  safe('forms', () => forms.bind(document));
  safe('partner-modal-init', () => partnerModal.init());
  safe('cookie', () => cookie.init());
} else {
  boot();
}
