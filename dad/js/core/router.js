// Seamless page transitions. Same-origin page links are fetched and swapped
// into <main id="swap"> behind the liquid drop's cover (dollar.cover() starts on the click and
// fills the screen in ~.55s; dollar.flyTo()/reveal() after the swap pulls the liquid back out into
// the new page). The swap never waits more than .7s for the cover.
// Any error falls back to a normal navigation.
import { html, $, $$, wait, prefersReduced } from './util.js?v=3badc3b098';

const cache = new Map();
let busy = false;
let hooks = {};
let bar = null;
let reduced = false;
let currentPath = location.pathname + location.search;
let pending = null;
let saveT = 0;

function eligible(a, e) {
  if (!a || !a.href) return false;
  if (e && (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return false;
  if (a.target && a.target !== '_self') return false;
  if (a.hasAttribute('download') || a.dataset.noRouter !== undefined || a.getAttribute('rel')?.includes('external')) return false;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return false;
  if (!/^https?:$/.test(url.protocol)) return false;
  const p = url.pathname;
  if (p.startsWith('/partners') || p.startsWith('/api') || p.startsWith('/assets') || p.startsWith('/vendor')) return false;
  if (/\.(?!html?$)[a-z0-9]{2,5}$/i.test(p)) return false;
  return true;
}

function samePage(url) {
  return url.pathname === location.pathname && url.search === location.search;
}

async function fetchPage(url) {
  const key = url.pathname + url.search;
  if (cache.has(key)) return cache.get(key);
  const p = fetch(key, { credentials: 'same-origin', headers: { 'X-Requested-With': 'dad-router' } })
    .then((r) => {
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('text/html')) throw new Error('not html');
      return r.text().then((t) => ({ status: r.status, text: t }));
    });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

function prefetch(e) {
  const a = e.target.closest?.('a');
  if (!eligible(a)) return;
  const url = new URL(a.href, location.href);
  if (samePage(url)) return;
  fetchPage(url).catch(() => {});
}

function scrollToY(y, immediate = true) {
  if (window.__lenis) window.__lenis.scrollTo(y, { immediate, force: true });
  else window.scrollTo({ top: y, behavior: immediate ? 'instant' : 'smooth' });
}

function scrollToHash(hash, immediate) {
  if (!hash) return false;
  let t = null;
  try { t = document.getElementById(decodeURIComponent(hash.slice(1))); } catch (e) { /* ignore */ }
  if (!t) return false;
  if (window.__scenes?.goToElement(t, { immediate })) return true;
  if (window.__lenis) window.__lenis.scrollTo(t, { offset: -80, immediate, force: true, duration: 1.1, easing: (k) => 1 - Math.pow(1 - k, 4.4) });
  else t.scrollIntoView({ behavior: immediate ? 'instant' : 'smooth', block: 'start' });
  return true;
}

function runScripts(main) {
  $$('script', main).forEach((old) => {
    const s = document.createElement('script');
    Array.from(old.attributes).forEach((at) => s.setAttribute(at.name, at.value));
    s.textContent = old.textContent;
    old.replaceWith(s);
  });
}

function updateHead(doc) {
  document.title = doc.title;
  ['description', 'robots'].forEach((n) => {
    const src = doc.querySelector(`meta[name="${n}"]`);
    const dst = document.querySelector(`meta[name="${n}"]`);
    if (src && dst) dst.setAttribute('content', src.getAttribute('content'));
  });
  ['og:title', 'og:description', 'og:url'].forEach((p) => {
    const src = doc.querySelector(`meta[property="${p}"]`);
    const dst = document.querySelector(`meta[property="${p}"]`);
    if (src && dst) dst.setAttribute('content', src.getAttribute('content'));
  });
  const c1 = doc.querySelector('link[rel="canonical"]');
  const c2 = document.querySelector('link[rel="canonical"]');
  if (c1 && c2) c2.setAttribute('href', c1.getAttribute('href'));
  document.body.dataset.page = doc.body.dataset.page || '';
  document.body.dataset.mobileCta = doc.body.dataset.mobileCta || 'on';
}

function barTo(v, dur = 0.5) {
  const g = window.gsap;
  if (!bar || !g) return;
  g.to(bar, { scaleX: v, duration: dur, ease: 'power3.out', overwrite: true, opacity: 1 });
}

// a refresh mid-glide would hitch the glide: wait for the page to be still
function refreshWhenStill(tries = 0) {
  if (html.classList.contains('is-routing')) return;
  if ((html.classList.contains('is-scene-moving') || window.__lenis?.isScrolling) && tries < 20) {
    setTimeout(() => refreshWhenStill(tries + 1), 150);
    return;
  }
  window.ScrollTrigger?.refresh();
}

export async function navigate(href, { push = true, restore = null } = {}) {
  const url = new URL(href, location.href);
  // a click or Back/Forward during a transition runs once it lands (never dropped:
  // after a popstate the address bar has already changed)
  if (busy) { pending = { href, push, restore }; return; }
  const gsap = window.gsap;
  const main = document.getElementById('swap');
  if (!gsap || !main) { location.href = url.href; return; }
  busy = true;
  html.classList.add('is-routing');
  clearTimeout(saveT);
  // save scroll position of the page we're leaving (after a popstate the current
  // entry is already the destination: its position was kept up to date by saveY)
  if (push) { try { history.replaceState({ ...(history.state || {}), y: window.scrollY }, ''); } catch (e) { /* ignore */ } }

  let page;
  try {
    // the liquid drop flies through the lens at once (resolves at once if it can't)
    let covering = Promise.resolve();
    try { if (!reduced && window.__dollar?.cover) covering = Promise.resolve(window.__dollar.cover()).catch(() => {}); } catch (e) { /* ignore */ }
    barTo(0.25, 0.4);
    const fetching = fetchPage(url);
    const exit = reduced ? Promise.resolve() : new Promise((r) => {
      gsap.to(main, { opacity: 0, y: -28, duration: 0.38, ease: 'power2.in', onComplete: r });
    });
    // swap under the liquid as soon as the page is here and the screen is covered (cap .7s)
    const cap = new Promise((r) => setTimeout(r, 700));
    const [res] = await Promise.all([fetching, Promise.race([Promise.all([exit, covering]), cap])]);
    page = res;
    barTo(0.7, 0.4);
  } catch (err) {
    location.href = url.href;
    return;
  }

  try {
    const doc = new DOMParser().parseFromString(page.text, 'text/html');
    const next = doc.getElementById('swap');
    if (!next) throw new Error('no #swap');
    hooks.unmount?.(main);
    if (push) history.pushState({ y: 0 }, '', url.pathname + url.search + url.hash);
    updateHead(doc);
    currentPath = url.pathname + url.search;
    main.innerHTML = next.innerHTML;
    main.dataset.page = next.dataset.page || '';
    main.dataset.module = next.dataset.module || '';
    main.toggleAttribute('data-scenes', next.hasAttribute('data-scenes'));
    runScripts(main);
    // jump to the top (or the hash / restored position) before measuring.
    // <main> keeps its exit offset until now: clear it so every trigger and
    // scene stop is measured at its true position
    scrollToY(0, true);
    gsap.set(main, { y: 0 });
    window.ScrollTrigger?.clearScrollMemory?.();
    await hooks.mount?.(main, { routed: true });
    window.ScrollTrigger?.refresh();
    if (restore !== null && restore !== undefined) { scrollToY(restore, true); window.__scenes?.align(); }
    else if (url.hash) scrollToHash(url.hash, true);

    // enter (anything measured while it slides is re-measured once it lands)
    if (reduced) gsap.set(main, { opacity: 1, y: 0 });
    else {
      gsap.fromTo(main, { opacity: 0, y: 36 }, {
        opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', clearProps: 'transform',
        onComplete: () => refreshWhenStill(),
      });
    }
    const anchor = $('[data-dollar]', main);
    try {
      if (anchor) window.__dollar?.flyTo?.(anchor, { duration: reduced ? 0 : 1.3 });
      else window.__dollar?.reveal?.();
    } catch (e) { /* ignore */ }

    if (bar) gsap.to(bar, { scaleX: 1, duration: 0.35, ease: 'power2.out', onComplete: () => gsap.to(bar, { opacity: 0, duration: 0.4, onComplete: () => gsap.set(bar, { scaleX: 0 }) }) });

    // a11y: move focus to the hash target (or the new page heading) and announce the title.
    // (the scene engine ignores focus while routing, so this never drags the view
    // back from a hash target or a restored position)
    let ht = null;
    if (url.hash && restore == null) { try { ht = document.getElementById(decodeURIComponent(url.hash.slice(1))); } catch (e) { /* ignore */ } }
    const h = ht || $('h1', main) || $('h2', main) || main;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
    const live = document.getElementById('announcer');
    if (live) { live.textContent = ''; setTimeout(() => { live.textContent = document.title; }, 60); }
    hooks.after?.(main);
  } catch (err) {
    console.error('[router]', err);
    location.href = url.href;
    return;
  } finally {
    await wait(50);
    busy = false;
    html.classList.remove('is-routing');
    const p = pending;
    pending = null;
    if (p) {
      if (!p.push) {
        if (location.pathname + location.search !== currentPath) navigate(location.href, { push: false, restore: history.state && typeof history.state.y === 'number' ? history.state.y : 0 });
      } else {
        const u = new URL(p.href, location.href);
        if (u.pathname + u.search !== currentPath) navigate(p.href);
      }
    }
  }
}

// keep the current history entry's scroll position fresh, so Back/Forward restore it
function saveY() {
  if (busy) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    if (busy) return;
    try { history.replaceState({ ...(history.state || {}), y: window.scrollY }, ''); } catch (e) { /* ignore */ }
  }, 250);
}

// keyboard users continue from the target, like a native anchor jump (the skip link)
function focusHash(hash) {
  let t = null;
  try { t = document.getElementById(decodeURIComponent(hash.slice(1))); } catch (e) { /* ignore */ }
  if (!t) return;
  if (!t.matches('a[href], button, input, select, textarea, summary, [tabindex]')) t.setAttribute('tabindex', '-1');
  t.focus({ preventScroll: true });
}

function onClick(e) {
  const a = e.target.closest?.('a');
  if (!a) return;
  const raw = a.getAttribute('href') || '';
  // in-page hash links: smooth scroll with Lenis
  if (raw.startsWith('#') && raw.length > 1) {
    if (scrollToHash(raw, reduced)) { e.preventDefault(); history.pushState(history.state, '', raw); focusHash(raw); }
    return;
  }
  if (!eligible(a, e)) return;
  const url = new URL(a.href, location.href);
  if (samePage(url)) {
    e.preventDefault();
    if (url.hash) { scrollToHash(url.hash, reduced); history.pushState(history.state, '', url.hash); focusHash(url.hash); }
    else scrollToY(0, reduced);
    return;
  }
  e.preventDefault();
  navigate(url.href);
}

export function init(opts = {}) {
  hooks = opts;
  reduced = prefersReduced();
  bar = document.querySelector('#route-bar i');
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  try { history.replaceState({ y: window.scrollY }, ''); } catch (e) { /* ignore */ }
  document.addEventListener('click', onClick);
  document.addEventListener('pointerover', prefetch, { passive: true });
  document.addEventListener('touchstart', prefetch, { passive: true });
  document.addEventListener('focusin', prefetch);
  window.addEventListener('scroll', saveY, { passive: true });
  window.addEventListener('popstate', (e) => {
    if (location.pathname + location.search === currentPath) {
      if (location.hash) scrollToHash(location.hash, reduced);
      else {
        scrollToY(e.state && typeof e.state.y === 'number' ? e.state.y : 0, true);
        window.__scenes?.align();
      }
      return;
    }
    navigate(location.href, { push: false, restore: e.state && typeof e.state.y === 'number' ? e.state.y : 0 });
  });
}
