// Scene-based scrolling.
//
// A page opts in with <main data-scenes> (front-matter "scenes": true). Every
// [data-scene] element is one viewport tall (100svh) and composed to fit it.
// One wheel/trackpad gesture, one touch swipe, or one PageDown/Space/Arrow
// press moves EXACTLY one scene with an eased glide. Input is locked while
// moving and trackpad inertia is swallowed, so one flick = one scene.
//
//   data-scene                 a scene (one viewport)
//   data-scene="tall"          content taller than the viewport: scrolls freely
//                              inside, then snaps on to the next scene. Any scene
//                              whose content overflows is treated as tall
//                              automatically, so nothing is ever cut off.
//   data-scene-name="The loop" label for the chapter rail
//   data-scene-steps="4"       a pinned / sticky sequence: N evenly spaced stops
//                              across its scroll distance ("0,.4,1" for custom)
//   data-scene-media="(…)"     only a scene while this media query matches
//                              (nested scenes: the outermost active one wins)
//
// Falls back to normal scrolling under reduced motion or on viewports shorter
// than 560px. The page keeps its scene sizing either way.
import { html, $$, prefersReduced, isTouch, mq, clamp } from './util.js?v=e09c939d0f';

const MIN_H = 560;
const DUR = 1.05;          // seconds per scene move
const STEP_DUR = 1.0;      // sub-step inside a pinned sequence
const TOL = 3;             // px tolerance when matching stops
const GAP = 190;           // ms of wheel silence that starts a new gesture
const RAIL_MQ = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
// premium out-ease: fast start, long soft landing (between quart and expo)
const ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(1 - t, 4.4));

let main = null;
let bound = false;     // a scene page is mounted (sizing applied)
let active = false;    // the input engine is running
let scenes = [];       // [{ el, name, segs: [] }]
let segs = [];         // [{ kind: 'stop', y, s } | { kind: 'free', a, b, s }]
let rail = null;
let bar = null;
let moving = false;
let animTarget = 0;
let animT0 = 0;
let animDur = 0;
let rafId = 0;
let safety = 0;
let settleT = 0;
let measureT = 0;
let lastWheelT = 0;
let hist = [];
let gesture = null;
let touch = null;
let pointerDown = false;
let lastKeyNav = 0;
let restY = 0;
let cleanups = [];

const sy = () => window.scrollY || document.documentElement.scrollTop || 0;
const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);
// layout position, blind to transforms: the router's enter tween slides <main>
// (and reveals slide scenes), and a stop measured mid-slide would be off by
// those pixels for the rest of the visit
const docTop = (el) => {
  let y = 0;
  let n = el;
  while (n && n.nodeType === 1) {
    if (getComputedStyle(n).position === 'fixed') return el.getBoundingClientRect().top + sy();
    y += n.offsetTop + (n !== el ? n.clientTop : 0);
    n = n.offsetParent;
  }
  return y;
};
const now = () => performance.now();

/* ------------------------------------------------------------------ build */
function collect() {
  const all = $$('[data-scene]', main).filter((el) => {
    const m = el.dataset.sceneMedia;
    return !m || mq(m);
  });
  const list = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
  $$('[data-scene]', main).forEach((el) => el.classList.toggle('is-scene', list.includes(el)));
  list.forEach((el) => el.classList.toggle('is-scene-stepped', !!stepsOf(el)));
  return list.map((el, i) => ({ el, i, name: el.dataset.sceneName || el.getAttribute('aria-label') || `Scene ${i + 1}`, segs: [] }));
}

function stepsOf(el) {
  const sm = el.dataset.sceneStepsMedia;
  if (sm && !mq(sm)) return null;
  const v = (el.dataset.sceneSteps || '').trim();
  if (v.includes(',')) return v.split(',').map(parseFloat).filter((n) => Number.isFinite(n));
  const n = parseInt(v, 10);
  if (n > 1) return Array.from({ length: n }, (_, k) => k / (n - 1));
  return null;
}

function measure() {
  if (!main) return;
  const vh = innerHeight;
  const max = maxScroll();
  const cy = (y) => clamp(Math.round(y), 0, max);
  segs = [];
  scenes.forEach((s) => {
    const box = s.el.parentElement?.classList.contains('pin-spacer') ? s.el.parentElement : s.el;
    const top = docTop(box);
    const h = box.offsetHeight;
    s.top = top;
    s.h = h;
    s.segs = [];
    const extra = h - vh;
    const steps = stepsOf(s.el);
    // a near-fit (a few px over on a short laptop window, or with the cookie strip
    // reserved): still one stop. The overflow comes out of the scene's own empty
    // top/bottom padding, so no content is hidden and no flick is spent on a 20px nudge.
    let lift = -1;
    if (extra > 4 && extra <= vh * 0.2 && !steps && box === s.el) {
      const sl = slackOf(s.el, top, h);
      if (extra <= sl.top + sl.bottom) lift = Math.max(0, extra - sl.bottom);
    }
    if (extra > 4 && steps) steps.forEach((f) => s.segs.push({ kind: 'stop', y: cy(top + extra * f), s }));
    else if (extra > 4 && lift < 0) s.segs.push({ kind: 'free', a: cy(top), b: cy(top + extra), s });
    else s.segs.push({ kind: 'stop', y: cy(top + Math.max(0, lift)), s });
    s.tall = extra > 4 && !steps && lift < 0;
    s.stepped = !!(steps && extra > 4);
    s.el.classList.toggle('is-scene-stepped', s.stepped);
    s.el.classList.toggle('is-scene-tall', s.tall);
    s.el.classList.toggle('is-scene-near', lift >= 0);
    segs.push(...s.segs);
  });
  if (!segs.length) return;
  // safety net: content sitting BETWEEN two scenes still gets a stop
  for (let k = scenes.length - 1; k > 0; k--) {
    const a = scenes[k - 1];
    const b = scenes[k];
    const end = a.top + a.h;
    // (a gap of mere spacing, or of sticky chrome like the Get Involved switcher,
    // gets no stop of its own: it would cost a whole flick for a 40-160px nudge)
    if (b.top - end > 40 && (b.top - end > vh * 0.4 || gapHasContent(end, b.top))) {
      const at = segs.indexOf(b.segs[0]);
      const gapSeg = b.top - end > vh ? { kind: 'free', a: cy(end), b: cy(b.top - vh), s: a } : { kind: 'stop', y: cy(end), s: a };
      gapSeg.gap = true;
      segs.splice(at, 0, gapSeg);
    }
  }
  // whatever sits above the first scene / below the last one (the footer)
  const first = scenes[0];
  if (first.top > TOL) segs.unshift({ kind: 'stop', y: 0, s: first });
  const last = scenes[scenes.length - 1];
  const tailStart = last.top + last.h;
  const end = segs[segs.length - 1];
  const endY = end.kind === 'stop' ? end.y : end.b;
  if (max > endY + TOL) {
    const tailH = document.documentElement.scrollHeight - tailStart;
    if (tailH <= vh) segs.push({ kind: 'stop', y: max, s: null });
    else segs.push({ kind: 'free', a: cy(tailStart), b: max, s: null });
  }
  // dedupe stops that collapsed onto each other
  segs = segs.filter((g, k) => k === 0 || !(g.kind === 'stop' && segs[k - 1].kind === 'stop' && Math.abs(g.y - segs[k - 1].y) < 2));
}

/** Does anything a reader needs (text, media, controls) sit between y0 and y1,
 *  outside every scene? Sticky / fixed / absolute layers don't count. */
function gapHasContent(y0, y1) {
  let found = false;
  const walk = (n) => {
    for (let c = n.firstElementChild; c && !found; c = c.nextElementSibling) {
      if (c.classList.contains('is-scene')) continue;
      const cs = getComputedStyle(c);
      if (cs.display === 'none' || /^(absolute|fixed|sticky)$/.test(cs.position) || cs.visibility === 'hidden') continue;
      if (c.classList.contains('sr-only') || c.classList.contains('dollar-anchor')) continue;
      const leaf = CONTROL.test(c.tagName) || [...c.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim());
      if (leaf && c.offsetHeight > 0) {
        const t = docTop(c);
        if (t + c.offsetHeight > y0 + 2 && t < y1 - 2) { found = true; return; }
      }
      if (!CONTROL.test(c.tagName)) walk(c);
    }
  };
  walk(main);
  return found;
}

/** Empty padding a near-fit scene may give up: the top down to just under the
 *  fixed nav, the bottom down to the strip kept clear for the cookie chip (and,
 *  on phones, the sticky donor bar, so none there). */
function slackOf(el, top, h) {
  const nav = document.getElementById('nav');
  const navH = nav ? nav.offsetHeight : 76;
  const phone = innerWidth < 720;
  const keep = phone ? 84 : html.classList.contains('has-cookie') ? 64 : 16;
  const ext = contentExtent(el, top);
  if (!ext) return { top: 0, bottom: 0 };
  // (top capped: some pages park sticky chrome under the nav, e.g. the Get Involved switcher)
  return { top: clamp(ext.t - navH - 10, 0, 24), bottom: Math.max(0, h - ext.b - keep) };
}

/** Where the scene's visible content starts and ends (px from the scene top):
 *  text, media, controls and any visible box (cards, ruled rows), blind to
 *  transforms (reveals still pending) and ignoring absolutely placed decoration
 *  (glows, drop anchors, dot fields). */
const CONTROL = /^(IMG|SVG|CANVAS|VIDEO|INPUT|BUTTON|SELECT|TEXTAREA)$/i;
function contentExtent(el, top) {
  let t = Infinity;
  let b = -Infinity;
  const add = (c) => {
    const y = docTop(c) - top;
    t = Math.min(t, y);
    b = Math.max(b, y + c.offsetHeight);
  };
  const boxed = (cs) => (cs.backgroundImage !== 'none' || !/rgba\(.*,\s*0\)|transparent/.test(cs.backgroundColor)
    || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 || cs.boxShadow !== 'none');
  const walk = (n) => {
    for (let c = n.firstElementChild; c; c = c.nextElementSibling) {
      const cs = getComputedStyle(c);
      if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
      if (c.classList.contains('sr-only') || c.classList.contains('dollar-anchor')) continue;
      const shown = cs.visibility !== 'hidden' && c.offsetHeight > 0;
      if (CONTROL.test(c.tagName) || c.classList.contains('btn')) { if (shown) add(c); continue; }
      if (shown && (boxed(cs) || [...c.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()))) add(c);
      walk(c);
    }
  };
  walk(el);
  return Number.isFinite(t) ? { t, b } : null;
}

/** Does this scene fit one screen (as the engine measured it)? Reveals and page
 *  code key their triggers to the scene when it does. */
export function fitsScreen(el) {
  if (bound && el.classList.contains('is-scene')) return !el.classList.contains('is-scene-tall') && !el.classList.contains('is-scene-stepped');
  return el.offsetHeight <= innerHeight + 4;
}

/* --------------------------------------------------------------- locating */
const entry = (g, dir) => (g.kind === 'stop' ? g.y : dir > 0 ? g.a : g.b);

/** The scroll target one move away from y in dir, or { free } when y sits inside a tall scene. */
function nextTarget(y, dir) {
  if (dir > 0) {
    for (const g of segs) {
      if (g.kind === 'stop') { if (g.y > y + TOL) return { y: g.y, g }; }
      else { if (g.a > y + TOL) return { y: g.a, g }; if (g.b > y + TOL) return { free: g }; }
    }
  } else {
    for (let k = segs.length - 1; k >= 0; k--) {
      const g = segs[k];
      if (g.kind === 'stop') { if (g.y < y - TOL) return { y: g.y, g }; }
      else { if (g.b < y - TOL) return { y: g.b, g }; if (g.a < y - TOL) return { free: g }; }
    }
  }
  return null;
}

function freeAt(y) {
  return segs.find((g) => g.kind === 'free' && y >= g.a - TOL && y <= g.b + TOL) || null;
}

function nearest(y) {
  let best = null;
  let bd = Infinity;
  segs.forEach((g) => {
    const d = g.kind === 'stop' ? Math.abs(y - g.y) : y < g.a ? g.a - y : y > g.b ? y - g.b : 0;
    if (d < bd) { bd = d; best = g; }
  });
  return best;
}

function sceneAt(y) {
  const g = nearest(y);
  if (!g) return 0;
  if (!g.s) return scenes.length - 1;
  return g.s.i;
}

/* -------------------------------------------------------------- animation */
function setScroll(y) {
  if (window.__lenis) window.__lenis.scrollTo(y, { immediate: true, force: true });
  else window.scrollTo({ top: y, behavior: 'instant' });
}

function finish(dest) {
  clearTimeout(safety);
  cancelAnimationFrame(rafId);
  if (!moving) return;
  moving = false;
  html.classList.remove('is-scene-moving');
  restY = dest;
  syncTouchAction();
  updateRail(dest);
}

function animate(dest, { duration = DUR } = {}) {
  dest = clamp(Math.round(dest), 0, maxScroll());
  const from = sy();
  if (Math.abs(dest - from) < 1) { finish(dest); restY = dest; return; }
  moving = true;
  animTarget = dest;
  animT0 = now();
  animDur = duration * 1000;
  html.classList.add('is-scene-moving');
  updateRail(dest);
  clearTimeout(safety);
  cancelAnimationFrame(rafId);
  const lenis = window.__lenis;
  if (lenis) {
    lenis.scrollTo(dest, { duration, easing: ease, force: true, lock: true, onComplete: () => finish(dest) });
  } else {
    const y0 = from;
    const tick = (t) => {
      const p = Math.min(1, (t - animT0) / animDur);
      window.scrollTo({ top: y0 + (dest - y0) * ease(p), behavior: 'instant' });
      if (p < 1) rafId = requestAnimationFrame(tick);
      else finish(dest);
    };
    rafId = requestAnimationFrame(tick);
  }
  safety = setTimeout(() => { if (moving) { setScroll(dest); finish(dest); } }, animDur + 450);
}

/** Move one step in dir. kind: 'scene' (wheel/touch/PageDown) or 'line' (arrows, scroll a bit inside tall scenes). */
function step(dir, kind = 'scene') {
  const base = moving ? animTarget : sy();
  const r = nextTarget(base, dir);
  if (!r) { if (moving) return; animate(base, { duration: 0.4 }); return; }
  if (r.free) {
    const g = r.free;
    const d = kind === 'line' ? 160 : innerHeight * 0.82;
    animate(clamp(base + dir * d, g.a, g.b), { duration: 0.75 });
    return;
  }
  const sameScene = r.g.s && nearest(base)?.s === r.g.s;
  animate(r.y, { duration: sameScene ? STEP_DUR : DUR });
}

/** Can a new move start now? Allows chaining once the current glide is mostly done. */
function canChain(dir) {
  if (!moving) return true;
  const p = (now() - animT0) / animDur;
  const goingDown = animTarget > sy();
  if ((dir > 0) !== goingDown) return p > 0.2; // reversal: let them turn back early
  return p > 0.5;
}

/* ------------------------------------------------------------------ wheel */
function norm(e, v) {
  if (e.deltaMode === 1) return v * 16;
  if (e.deltaMode === 2) return v * innerHeight;
  return v;
}

function scrollableParent(el, dy) {
  for (let n = el; n && n !== main && n !== document.body && n.nodeType === 1; n = n.parentElement) {
    if (n.hasAttribute('data-lenis-prevent') || n.hasAttribute('data-scene-native')) return true;
    if (n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        if (dy > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) return true;
        if (dy < 0 && n.scrollTop > 0) return true;
      }
    }
  }
  return false;
}

function accelerating() {
  if (hist.length < 6) return false;
  const n = hist.length;
  const recent = (hist[n - 1] + hist[n - 2] + hist[n - 3]) / 3;
  const before = (hist[n - 4] + hist[n - 5] + hist[n - 6]) / 3;
  return recent > 14 && recent > before * 1.7;
}

function onWheel(e) {
  if (!active || e.ctrlKey || html.classList.contains('is-locked') || html.classList.contains('menu-open')) return;
  const dy = norm(e, e.deltaY);
  const dx = norm(e, e.deltaX);
  if (Math.abs(dx) > Math.abs(dy)) return; // horizontal: leave it alone
  if (!dy) return;
  if (scrollableParent(e.target, dy)) return;
  // event time, not handler time: a busy main thread must not split one
  // flick into several "gestures"
  const t = e.timeStamp > 0 ? e.timeStamp : now();
  const gap = t - lastWheelT;
  lastWheelT = t;
  const mag = Math.abs(dy);
  // per-frame speed, not per-event size: while the main thread is busy (a glide,
  // the drop's WebGL) Chrome coalesces 2-4 wheel events into one bigger one, and
  // a decaying inertia tail must not read as a fresh, accelerating flick
  const vel = mag / clamp(gap / 16.7, 1, 4);
  const prev = hist.length ? hist[hist.length - 1] : 0;
  hist.push(vel);
  if (hist.length > 12) hist.shift();
  const dir = dy > 0 ? 1 : -1;
  // a pause inside a still-decaying inertia tail is not a new flick
  const tailing = gesture && dir === gesture.dir && (mag <= prev || vel <= prev) && prev < 24 && gap < 480;
  const fresh = !gesture || dir !== gesture.dir || (gap > GAP && !tailing) || (accelerating() && t - gesture.t > 300);
  if (fresh) {
    hist = hist.slice(-1);
    const y = moving ? animTarget : sy();
    const g = freeAt(y);
    const inside = g && !moving && (dir > 0 ? y < g.b - TOL : y > g.a + TOL);
    gesture = { dir, t, acc: 0, mode: inside ? 'free' : 'snap', fired: false, g };
    if (gesture.mode === 'snap' && moving && !canChain(dir)) gesture.fired = true; // swallow this one whole
  }

  if (gesture.mode === 'free') {
    const g = gesture.g;
    const lenis = window.__lenis;
    const cur = lenis ? lenis.targetScroll : sy();
    const next = cur + dy;
    if (next > g.a - 1 && next < g.b + 1) return; // inside the tall scene: let Lenis / the browser scroll it
    e.preventDefault();
    e.stopPropagation();
    const edge = dir > 0 ? g.b : g.a;
    if (Math.abs(cur - edge) > 1) {
      if (lenis) lenis.scrollTo(edge, { duration: 0.6, easing: ease, force: true });
      else window.scrollTo({ top: edge, behavior: 'instant' });
    }
    restY = edge;
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  if (gesture.fired) return;
  gesture.acc += dy;
  if (Math.abs(gesture.acc) < 4) return;
  gesture.fired = true;
  step(dir, 'scene');
}

/* --------------------------------------------------------------- keyboard */
function onKey(e) {
  if (!active || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (html.classList.contains('is-locked') || html.classList.contains('menu-open')) return;
  const t = e.target;
  if (t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="listbox"], [role="menu"], [data-scene-native]')) return;
  let dir = 0;
  let kind = 'scene';
  switch (e.key) {
    case 'PageDown': dir = 1; break;
    case 'PageUp': dir = -1; break;
    case ' ': case 'Spacebar':
      if (t && t.closest && t.closest('button, a, summary, [role="button"], [role="link"]')) return;
      dir = e.shiftKey ? -1 : 1; break;
    case 'ArrowDown': dir = 1; kind = 'line'; break;
    case 'ArrowUp': dir = -1; kind = 'line'; break;
    case 'Home': e.preventDefault(); if (segs[0]) animate(entry(segs[0], 1)); return;
    case 'End': e.preventDefault(); if (segs.length) animate(entry(segs[segs.length - 1], -1)); return;
    default: return;
  }
  e.preventDefault();
  if (e.repeat && now() - lastKeyNav < 650) return;
  if (!canChain(dir)) return;
  lastKeyNav = now();
  step(dir, kind);
}

/* ------------------------------------------------------------------ touch */
function syncTouchAction() {
  // At a scene boundary the browser must not pan vertically: we own the swipe.
  // Inside a tall scene native panning comes back.
  const g = freeAt(sy());
  html.classList.toggle('scene-snap', active && isTouchLike() && !g);
}
const isTouchLike = () => isTouch() || navigator.maxTouchPoints > 0;

// Touch events keep going to the element the finger landed on. If that node
// leaves the DOM mid-swipe (a split-text reveal reverting its line wrappers),
// they stop bubbling to window and the swipe is lost half-way. So the target
// gets its own listeners for the length of the touch; window skips what they
// already handled.
let touchTarget = null;
const fromTarget = (fn) => (e) => { e.__sceneSeen = true; fn(e); };
const tMove = fromTarget((e) => onTouchMove(e));
const tEnd = fromTarget((e) => onTouchEnd(e));
const winMove = (e) => { if (!e.__sceneSeen) onTouchMove(e); };
const winEnd = (e) => { if (!e.__sceneSeen) onTouchEnd(e); };
function holdTarget(el) {
  releaseTarget();
  if (!el || !el.addEventListener || el === window || el === document) return;
  touchTarget = el;
  el.addEventListener('touchmove', tMove, { passive: false });
  el.addEventListener('touchend', tEnd, { passive: true });
  el.addEventListener('touchcancel', tEnd, { passive: true });
}
function releaseTarget() {
  if (!touchTarget) return;
  touchTarget.removeEventListener('touchmove', tMove, { passive: false });
  touchTarget.removeEventListener('touchend', tEnd, { passive: true });
  touchTarget.removeEventListener('touchcancel', tEnd, { passive: true });
  touchTarget = null;
}

function onTouchStart(e) {
  if (!active || e.touches.length > 1 || html.classList.contains('is-locked')) { touch = null; return; }
  holdTarget(e.target);
  const p = e.touches[0];
  const y = sy();
  touch = { x0: p.clientX, y0: p.clientY, t0: now(), base: moving ? animTarget : y, free: moving ? null : freeAt(y), mode: null, ly: p.clientY, lt: now(), v: 0, hx: !!e.target?.closest?.('.swipe-m') };
  if (moving) touch.mode = 'block';
}

function onTouchMove(e) {
  if (!touch) return;
  const p = e.touches[0];
  const dy = touch.y0 - p.clientY;
  const dx = touch.x0 - p.clientX;
  const t = now();
  if (t > touch.lt) { touch.v = (touch.ly - p.clientY) / (t - touch.lt); touch.ly = p.clientY; touch.lt = t; }
  if (!touch.mode) {
    // (inside a sideways swipe row the first moves must stay native, or the row can't pan)
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) { if (!touch.free && !touch.hx && e.cancelable) e.preventDefault(); return; }
    if (Math.abs(dx) > Math.abs(dy) * 1.2) { touch.mode = 'x'; return; }
    const dir = dy > 0 ? 1 : -1;
    const g = touch.free;
    if (g && (dir > 0 ? touch.base < g.b - TOL : touch.base > g.a + TOL)) touch.mode = 'free';
    else touch.mode = 'snap';
  }
  if (touch.mode === 'snap' || touch.mode === 'block') {
    if (e.cancelable) e.preventDefault();
    if (touch.mode === 'snap' && !moving) {
      // the page follows the finger a little, then the release decides
      const lim = innerHeight * 0.16;
      const follow = clamp(dy * 0.32, -lim, lim);
      const r = nextTarget(touch.base, dy > 0 ? 1 : -1);
      setScroll(clamp(touch.base + (r ? follow : follow * 0.25), 0, maxScroll()));
    }
  }
}

function onTouchEnd(e) {
  if (!e.touches || !e.touches.length) releaseTarget();
  if (!touch) return;
  const tc = touch;
  touch = null;
  if (tc.mode !== 'snap') { if (tc.mode === 'free') armSettle(); return; }
  const p = e.changedTouches?.[0];
  const dy = p ? tc.y0 - p.clientY : 0;
  const dt = now() - tc.t0;
  const v = tc.v;
  const go = Math.abs(dy) > 46 || (Math.abs(dy) > 14 && (Math.abs(v) > 0.3 || dt < 220));
  if (go) {
    const dir = dy > 0 ? 1 : -1;
    const r = nextTarget(tc.base, dir);
    if (r) {
      if (r.free) { animate(clamp(tc.base + dir * innerHeight * 0.82, r.free.a, r.free.b), { duration: 0.8 }); return; }
      const sameScene = r.g.s && nearest(tc.base)?.s === r.g.s;
      animate(r.y, { duration: sameScene ? STEP_DUR * 0.92 : DUR * 0.92 });
      return;
    }
  }
  animate(tc.base, { duration: 0.5 });
}

/* ----------------------------------------------------------------- settle */
// Any scroll we didn't drive (scrollbar drag, find-in-page, focus, a free
// swipe overshooting a tall scene) comes to rest on a scene boundary.
function armSettle() {
  clearTimeout(settleT);
  settleT = setTimeout(settle, 170);
}

function settle() {
  if (!active || moving || touch || pointerDown || !segs.length) return;
  const lenis = window.__lenis;
  if (lenis && lenis.isScrolling) { armSettle(); return; }
  const y = sy();
  const g = freeAt(y);
  if (g) { restY = y; syncTouchAction(); return; }
  const n = nearest(y);
  const ny = n.kind === 'stop' ? n.y : y < n.a ? n.a : n.b;
  if (Math.abs(ny - y) <= TOL) { restY = ny; syncTouchAction(); return; }
  // overshot the end of a tall scene we were reading: go back to its edge
  const from = freeAt(restY);
  if (from) {
    const dir = y > restY ? 1 : -1;
    const edge = dir > 0 ? from.b : from.a;
    const r = nextTarget(edge, dir);
    const towards = r && !r.free ? r.y : edge;
    animate(Math.abs(y - edge) < Math.abs(y - towards) * 0.6 ? edge : towards, { duration: 0.7 });
    return;
  }
  animate(ny, { duration: 0.7 });
}

let scrollTick = false;
function onScroll() {
  if (!active) {
    // scenes off (reduced motion, short window): the rail still tracks the reader
    if (bound && !scrollTick) { scrollTick = true; requestAnimationFrame(() => { scrollTick = false; paintFill(sy()); settleBar(); }); }
    return;
  }
  if (!scrollTick) {
    scrollTick = true;
    requestAnimationFrame(() => { scrollTick = false; if (!moving) { paintFill(sy()); updateRail(sy()); } settleBar(); });
  }
  if (!moving && !touch) armSettle();
}

/* ------------------------------------------------------------ focus, links */
function stopFor(el) {
  const s = scenes.find((x) => x.el.contains(el));
  const y = sy();
  if (!s) {
    const tail = segs[segs.length - 1];
    // the footer: the tail
    if (el.closest?.('#footer') || !main?.contains(el)) return tail && !tail.s ? entry(tail, 1) : null;
    // content beside or between scenes (the sticky founding form next to the
    // Give scenes on desktop): the stop nearest to where it sits
    const want = docTop(el) - innerHeight * 0.3;
    const g = nearest(want);
    if (!g) return null;
    return g.kind === 'stop' ? g.y : clamp(want, g.a, g.b);
  }
  if (s.tall) {
    const g = s.segs[0];
    return clamp(docTop(el) - innerHeight * 0.25, g.a, g.b);
  }
  let best = s.segs[0];
  s.segs.forEach((g) => { if (Math.abs(g.y - y) < Math.abs(best.y - y)) best = g; });
  return best.kind === 'stop' ? best.y : best.a;
}

/** Glide to the scene that holds el (anchor links, the rail, hash routes). */
export function goToElement(el, { immediate = false } = {}) {
  if (!bound || !el) return false;
  if (!active) return false;
  const s = scenes.find((x) => x.el === el || x.el.contains(el) || el.contains(x.el));
  let y;
  if (s && (s.el === el || el.contains(s.el))) y = entry(s.segs[0], 1);
  else y = stopFor(el);
  if (y == null) return false;
  if (immediate) { setScroll(y); restY = y; updateRail(y); syncTouchAction(); }
  else animate(y);
  return true;
}

function onFocusIn(e) {
  // the router places focus itself after a page swap (heading or hash target)
  if (!active || pointerDown || moving || html.classList.contains('is-routing')) return;
  const el = e.target;
  if (!el || el === main || el === document.body || rail?.contains(el)) return;
  if (el.closest?.('#nav, .menu, .skip-link, .cookie, .mobile-cta')) return;
  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    const navH = 76;
    const visible = r.top >= navH - 4 && r.bottom <= innerHeight + 2;
    const y = stopFor(el);
    if (y == null) return;
    if (visible && Math.abs(y - sy()) <= TOL) return;
    if (visible && freeAt(sy())) return;
    // already on screen and not part of any one scene (a sticky aside): leave the view be
    if (visible && !scenes.some((x) => x.el.contains(el))) return;
    animate(y, { duration: 0.7 });
  });
}

/* ------------------------------------------------------------------- rail */
function buildRail() {
  rail?.remove();
  bar?.remove();
  if (scenes.length < 2) return;
  rail = document.createElement('nav');
  rail.className = 'scene-rail';
  rail.setAttribute('aria-label', 'Page sections');
  const ol = document.createElement('ol');
  scenes.forEach((s, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scene-rail__dot';
    b.dataset.i = String(i);
    b.setAttribute('aria-label', s.name);
    const lab = document.createElement('span');
    lab.className = 'scene-rail__label';
    lab.setAttribute('aria-hidden', 'true');
    lab.textContent = s.name;
    b.appendChild(lab);
    li.appendChild(b);
    ol.appendChild(li);
  });
  rail.appendChild(ol);
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const s = scenes[+b.dataset.i];
    if (s?.segs[0]) animate(entry(s.segs[0], 1));
  });
  document.body.appendChild(rail);
  // touch / small screens: one thin, purely visual line on the right edge. It fills orange
  // down to where the reader is; a glowing pulse runs on through the rest of the line and
  // flashes twice at its foot ("there's more below"). Transforms and opacity only.
  bar = document.createElement('div');
  bar.className = 'scene-mrail';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<i class="scene-mrail__fill"></i><span class="scene-mrail__pulse"><i></i></span>';
  document.body.appendChild(bar);
  barH = 0;
}

let barH = 0;
let barSp = -1;
let barEnd = null;
// progress = how far down the page the reader is (0 top, 1 bottom)
function paintFill(y) {
  if (!bar) return 0;
  const max = maxScroll();
  const p = max > 0 ? clamp(y / max, 0, 1) : 1;
  if (Math.abs(p - barSp) > 0.0005) { barSp = p; bar.style.setProperty('--sp', p.toFixed(4)); }
  const end = max - y < 8;
  if (end !== barEnd) { barEnd = end; bar.classList.toggle('is-end', end); }
  return p;
}
// the pulse starts from the current fill: restart its run whenever the reader settles somewhere new
function restartPulse(p) {
  if (!bar) return;
  if (!barH) barH = bar.offsetHeight || 0;
  const pulse = bar.firstElementChild?.nextElementSibling;
  if (!pulse || !barH) return;
  bar.style.setProperty('--pa', `${Math.round(p * barH)}px`);
  bar.style.setProperty('--pb', `${barH}px`);
  bar.classList.remove('is-run');
  void pulse.offsetWidth; // restart the CSS animation from its first frame
  bar.classList.add('is-run');
}

function paintBar() {
  if (!bar) return;
  restartPulse(paintFill(sy()));
}

// once the page stops moving, the pulse sets off again from the new position
let barSettleT = 0;
function settleBar() {
  clearTimeout(barSettleT);
  barSettleT = setTimeout(() => { if (!moving) paintBar(); }, 180);
}

let railIdx = -1;
function updateRail(y) {
  if (!scenes.length) return;
  const i = sceneAt(y);
  if (i === railIdx) return;
  railIdx = i;
  if (rail) {
    rail.querySelectorAll('button').forEach((b, k) => {
      if (k === i) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
  }
  paintFill(y);
  html.dataset.scene = String(i);
  main?.dispatchEvent(new CustomEvent('scene:change', { detail: { index: i, scene: scenes[i]?.el } }));
}

/* -------------------------------------------------------------- lifecycle */
function shouldRun() {
  return bound && !prefersReduced() && innerHeight >= MIN_H;
}

function remeasure({ realign = true } = {}) {
  if (!bound) return;
  const prevScene = sceneAt(restY);
  const wasStop = !freeAt(restY);
  measure();
  if (!active || moving || touch || !realign || !segs.length) return;
  // keep the reader on the scene they were on
  const s = scenes[prevScene];
  if (wasStop && s && s.segs.length) {
    const y = sy();
    let best = s.segs[0];
    s.segs.forEach((g) => { if (Math.abs(entry(g, 1) - y) < Math.abs(entry(best, 1) - y)) best = g; });
    const target = entry(best, 1);
    if (Math.abs(target - y) > TOL && Math.abs(target - y) < innerHeight * 1.5) setScroll(target);
    restY = target;
  }
  updateRail(sy());
}

function onResize() {
  barH = 0;
  clearTimeout(measureT);
  measureT = setTimeout(() => {
    const run = shouldRun();
    if (run !== active) setActive(run);
    remeasure();
  }, 160);
}

function setActive(on) {
  active = on;
  html.classList.toggle('scenes-on', on);
  if (!on) {
    html.classList.remove('scene-snap', 'is-scene-moving');
    moving = false;
  }
  syncTouchAction();
}

const onPointerDown = () => { pointerDown = true; };
const onPointerUp = () => { pointerDown = false; if (active && !moving) armSettle(); };

export function bind(el) {
  unbind();
  if (!el || !el.hasAttribute('data-scenes')) return;
  main = el;
  scenes = collect();
  if (!scenes.length) return;
  bound = true;
  el.classList.add('has-scenes');
  html.classList.add('has-scenes');
  buildRail();
  measure();
  setActive(shouldRun());
  restY = sy();
  updateRail(restY);
  settleBar();

  const opts = { passive: false, capture: true };
  window.addEventListener('wheel', onWheel, opts);
  window.addEventListener('keydown', onKey);
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', winMove, { passive: false });
  window.addEventListener('touchend', winEnd, { passive: true });
  window.addEventListener('touchcancel', winEnd, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('focusin', onFocusIn);
  // sideways swipe rows (.swipe-m): keep their page dots in step
  $$('.swipe-m', main).forEach((row) => {
    const sib = (el) => (el?.nextElementSibling?.classList.contains('swipe-m__hint') ? el.nextElementSibling : null);
    const hint = sib(row) || sib(row.closest('table'));
    if (!hint) return;
    const dots = [...hint.children];
    const sync = () => {
      const max = row.scrollWidth - row.clientWidth;
      const k = max > 2 ? Math.round((row.scrollLeft / max) * (dots.length - 1)) : 0;
      dots.forEach((d, i) => d.classList.toggle('is-on', i === k));
    };
    sync();
    row.addEventListener('scroll', sync, { passive: true });
    cleanups.push(() => row.removeEventListener('scroll', sync));
  });
  const ST = window.ScrollTrigger;
  const onRefresh = () => remeasure();
  ST?.addEventListener('refresh', onRefresh);
  // late layout (images, fonts) can grow a scene: re-measure, never jump
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { clearTimeout(measureT); measureT = setTimeout(() => remeasure(), 120); }) : null;
  scenes.forEach((s) => ro?.observe(s.el));
  cleanups.push(() => {
    window.removeEventListener('wheel', onWheel, opts);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('touchstart', onTouchStart, { passive: true });
    window.removeEventListener('touchmove', winMove, { passive: false });
    window.removeEventListener('touchend', winEnd, { passive: true });
    window.removeEventListener('touchcancel', winEnd, { passive: true });
    releaseTarget();
    window.removeEventListener('scroll', onScroll, { passive: true });
    window.removeEventListener('resize', onResize);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('focusin', onFocusIn);
    ST?.removeEventListener('refresh', onRefresh);
    ro?.disconnect();
  });
}

export function unbind() {
  cleanups.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
  cleanups = [];
  clearTimeout(safety);
  clearTimeout(settleT);
  clearTimeout(measureT);
  cancelAnimationFrame(rafId);
  rail?.remove();
  bar?.remove();
  rail = null;
  bar = null;
  barSp = -1;
  barEnd = null;
  clearTimeout(barSettleT);
  main?.classList.remove('has-scenes');
  html.classList.remove('has-scenes', 'scenes-on', 'scene-snap', 'is-scene-moving');
  delete html.dataset.scene;
  main = null;
  bound = false;
  active = false;
  moving = false;
  scenes = [];
  segs = [];
  gesture = null;
  touch = null;
  railIdx = -1;
}

/** After a router restore or hash jump: land exactly on the nearest scene boundary. */
export function align() {
  if (!active || !segs.length) return;
  measure();
  const y = sy();
  if (freeAt(y)) { restY = y; updateRail(y); syncTouchAction(); return; }
  const n = nearest(y);
  const ny = n.kind === 'stop' ? n.y : y < n.a ? n.a : n.b;
  if (Math.abs(ny - y) > 1) setScroll(ny);
  restY = ny;
  updateRail(ny);
  syncTouchAction();
}

export const isActive = () => active;
/** One programmatic step forward (the ledger's map auto-advance). Refuses while a glide,
 *  a touch or a pointer drag is in progress, so it can never fight the reader. */
export function next() {
  if (!active || moving || touch || pointerDown || html.classList.contains('is-locked') || html.classList.contains('menu-open')) return false;
  step(1);
  return true;
}
export const refresh = () => remeasure();

// target: where a glide is heading (null when still); the liquid drop reads it to leave at once
window.__scenes = { goToElement, align, isActive, refresh, next, fitsScreen, get segs() { return segs; }, get scenes() { return scenes; }, get target() { return moving ? animTarget : null; } };
