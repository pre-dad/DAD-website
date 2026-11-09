// ONE DROP OF LIQUID
// A single persistent glossy red-orange drop of 3D liquid that travels with the reader.
// Raw WebGL, no libraries: a raymarched signed-distance field (gl.js) built from 3D metaball
// formations and ICON shapes (forms.js), seen through a perspective camera.
//
// THREADS. The simulation and the WebGL rendering live in engine.js, and run in a Web Worker on an
// OffscreenCanvas wherever the browser supports it (worker.js), so a busy main thread (GSAP, layout,
// image decode) never stalls the liquid. Where OffscreenCanvas WebGL is missing (older Safari) the same
// engine runs on the main thread. This file is the page side: it reads the DOM once per frame (scroll,
// the ACTIVE anchor's rect, nothing in loops), posts a destination only when it changed, and applies
// what the engine reports back (glow, layer, state) after its reads, so it never forces a reflow.
// A capability probe measures the live frame time (first ~1s, then a rolling window) and logs it
// (window.__liquidProbe); it does not switch anything yet.
//
// Anchors in the page say where the drop should be and what it should become:
//   <div class="dollar-anchor" data-dollar="spin|rest|leak|exclaim|shocked|logo|underline|recycle|galaxy|…|ambient"
//        data-dollar-size="hero|feature|companion|fill|1.2" data-dollar-size-mobile="…" (under 720px) data-dollar-align="center|left|right"
//        data-dollar-rotate="135" data-dollar-rotate-mobile="90"   ('point': aim, deg clockwise from right)
//        data-dollar-aim=".selector"  ('point', 720px and up: aim at the centre of that element)
//        data-dollar-shift="0,-.2"    (nudge the resting place, in drop radii: x right, y down)
//        data-dollar-shift-media="(…)" (the shift only applies while this media query matches, checked on bind)
//        data-dollar-glide             (arrive by a glide: no pull back, sets off with the scroll; engine.js)
//        data-dollar-pin-at=".7"      (inside a pinned element: fraction of the pin's scroll distance)
//        data-dollar-pre="leak"       (the turn: the form shown until pour() has run)
//        data-dollar-media="(…)"      (only an anchor while this media query matches, checked on bind)
//        data-dollar-hold="1.6"       (a beat: arriving from above, the previous shape stays this many
//        data-dollar-when=".selector"  seconds, and until that element is visible, then melts into this one)
//        data-dollar-target="#selector"></div>  ('rain': the map · 'underline': the text to underline)
// LANDING LOCK: once the drop has settled on an anchor, that anchor's place is locked (in document
// coordinates, so it still scrolls with the page). Late layout, font or reveal-driven rect changes are
// ignored; only a viewport resize or a new anchor re-measures. Nothing shifts after it has formed.
// 'underline' is a vector line (SVG): the drop shrinks to a droplet, lands at the start of the text and
// draws the glossy wavy line as it travels to the end; the line then waves gently.
//
// Public API: new Dollar(canvas, {tier, reduced}) · bind(root) · unbind() · flyTo(el, {duration})
//             cover() · reveal() · rain(pts, opts) · rainReset() · pour({onCovered, onCleared}) · pour(null)
//             pourReset() · pourDone() · setTheme('dark'|'light') · intro() · getScreenPosition() · ready · state · dispose()
import { Engine, TIERS, tierQ, N_PRIMS, SIZES, COVER_IN, dispatch, hostTick, absNow } from './engine.js?v=7df28338d2';
import { ICON_STATES } from './forms.js?v=7df28338d2';
const TICK = { type: 'tick' };
// WebKit's worker rAF is timer-driven (not display-synced), so there the page paces the worker. ?liqpace=0|1 overrides.
const PACE_FROM_PAGE = (() => { try { const o = new URLSearchParams(location.search).get('liqpace'); if (o) return o === '1'; return /Apple/.test(navigator.vendor || ''); } catch (e) { return false; } })();
// formations drawn from the icon atlas (256KB): it is fetched only on pages that use one (the faces, '!',
// flex, people, 'logo', 'code' and 'hiker' are analytic)
const ANALYTIC = new Set(['exclaim', 'annoyed', 'shocked', 'frown', 'angry', 'flex', 'people', 'logo', 'code', 'hiker']);
const ATLAS_STATES = new Set(ICON_STATES.filter((s) => !ANALYTIC.has(s)));
// phones and tablets get the capped quality (engine.js tierQ)
const isMobile = () => { try { const o = new URLSearchParams(location.search).get('liqcap'); if (o) return o === '1'; return matchMedia('(hover: none) and (pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820); } catch (e) { return false; } };
import { View } from './gl.js?v=7df28338d2';

const STATES = new Set(['spin', 'rest', 'underline', 'crack', 'leak', 'reform', 'ring', 'split', 'pool', 'vessel', 'disc', 'network', 'orbit9', 'four', 'galaxy', 'land', 'line', 'hide', 'ambient', 'rain', 'exclaim', 'annoyed', 'shocked', 'frown', 'angry', 'recycle', 'flex', 'people', 'dollar', 'shield', 'point', 'loop', 'logo', 'code', 'hiker']);
const ALIAS = { pool: 'vessel', hide: 'ambient', land: 'ambient', line: 'ambient' };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const SVGNS = 'http://www.w3.org/2000/svg';

// can this browser render WebGL on an OffscreenCanvas in a worker? (cached for the visit)
function canWorker() {
  try {
    const q = new URLSearchParams(location.search).get('liquid');
    if (q === 'main') return false;
    if (q === 'worker') return true;
  } catch (e) { /* ignore */ }
  if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined' || !HTMLCanvasElement.prototype.transferControlToOffscreen) return false;
  try { const c = sessionStorage.getItem('dad-ocw'); if (c) return c === '1'; } catch (e) { /* ignore */ }
  let ok = false;
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl');
    ok = !!gl;
    gl && gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch (e) { ok = false; }
  try { sessionStorage.setItem('dad-ocw', ok ? '1' : '0'); } catch (e) { /* ignore */ }
  return ok;
}

export class Dollar {
  constructor(canvas, { tier = 'mid', reduced = false } = {}) {
    this.canvas = canvas;
    this.tierName = TIERS[tier] ? tier : 'mid';
    this.reduced = !!reduced;
    this.mobile = isMobile();
    this.anchors = [];
    this.enabled = false;
    this.state = { a: null, b: null, t: 1, i: -1 };
    this.ready = Promise.resolve();
    this._act = -1;
    this._light = 0;
    this._everBound = false;
    this._screen = null;
    this._lock = null;
    this._sentKey = '';
    this._writes = {};
    if (!canvas) { document.documentElement.classList.add('no-gl'); return; }
    canvas.setAttribute('aria-hidden', 'true');
    if (getComputedStyle(canvas).position !== 'fixed') Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1' });
    this._W = canvas.clientWidth || innerWidth; this._H = canvas.clientHeight || innerHeight;
    this._z0 = getComputedStyle(canvas).zIndex || '1';
    try {
      if (canWorker()) this._startWorker();
      else this._startLocal();
      this.enabled = true;
    } catch (e) {
      console.warn('[dollar] WebGL unavailable, drop disabled:', e && e.message);
      document.documentElement.classList.add('no-gl');
      return;
    }
    // the ambient glow: a big soft light behind the content (same layer as the canvas, under it)
    const g = this._glowEl = document.createElement('div');
    g.className = 'liquid-glow';
    g.setAttribute('aria-hidden', 'true');
    Object.assign(g.style, {
      position: 'fixed', left: '0', top: '0', width: '120vmax', height: '120vmax', pointerEvents: 'none', zIndex: this._z0,
      borderRadius: '50%', opacity: '0', willChange: 'transform, opacity',
      background: 'radial-gradient(closest-side, rgba(255,96,44,1) 0%, rgba(255,80,36,.62) 32%, rgba(255,74,34,.22) 62%, rgba(255,74,34,0) 100%)',
    });
    this.canvas.before(g);

    this._onResize = () => { this._resizeQueued = true; if (this.reduced) this._still(); };
    window.addEventListener('resize', this._onResize, { passive: true });
    this._onVis = () => this._send('hidden', { v: document.hidden });
    document.addEventListener('visibilitychange', this._onVis);
    // the page-side tick: measure, post, apply. With reduced motion only on scroll/resize.
    if (this.reduced) {
      this._onScrollStill = () => this._still();
      window.addEventListener('scroll', this._onScrollStill, { passive: true });
    } else {
      this._tickFn = () => this._tick();
      if (window.gsap) gsap.ticker.add(this._tickFn);
      else { const loop = () => { this._raf = requestAnimationFrame(loop); this._tick(); }; this._raf = requestAnimationFrame(loop); }
    }
    // after load, in an idle moment: the icon atlas, then pre-warm every program and formation
    const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 1200));
    const go = () => idle(() => { this._idle = true; this._needAtlas(); idle(() => this._send('warm')); });
    if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
  }

  // ------------------------------------------------------------------ hosts
  _startWorker() {
    const c = this.canvas, off = c.transferControlToOffscreen();
    const url = new URL('./worker.js' + new URL(import.meta.url).search, import.meta.url);
    const w = this._worker = new Worker(url, { type: 'module' });
    w.onmessage = (ev) => this._onEvent(ev.data.type, ev.data.data);
    w.onerror = (e) => { e && e.preventDefault && e.preventDefault(); this._onEvent('fail', 'worker error'); };
    this.mode = 'worker';
    w.postMessage({ type: 'init', canvas: off, tier: this.tierName, reduced: this.reduced, mobile: this.mobile, W: this._W, H: this._H, dpr: window.devicePixelRatio || 1 }, [off]);
  }

  _startLocal() {
    const q = tierQ(this.tierName, this.mobile);
    const view = new View(this.canvas, N_PRIMS, q.steps);
    const eng = this._eng = new Engine(view, { tier: this.tierName, reduced: this.reduced, mobile: this.mobile, emit: (t, d) => this._onEvent(t, d), W: this._W, H: this._H, dpr: window.devicePixelRatio || 1 });
    eng._dirty = true;
    this.mode = 'main';
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); eng._lost = true; });
    let last = 0;
    this._localTick = () => {
      const now = performance.now(), dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      hostTick(eng, dt);
    };
  }

  // the worker could not start (no WebGL there, or it crashed): the same engine on the main thread,
  // on a fresh canvas (the old one was handed to the worker), replaying what the page had set
  _fallback(why) {
    if (this.mode !== 'worker') return;
    console.warn('[dollar] worker unavailable, rendering on the main thread:', why);
    try { this._worker.terminate(); } catch (e) { /* ignore */ }
    this._worker = null;
    try { sessionStorage.setItem('dad-ocw', '0'); } catch (e) { /* ignore */ }
    const c = document.createElement('canvas');
    c.id = this.canvas.id; c.className = this.canvas.className; c.style.cssText = this.canvas.style.cssText;
    this.canvas.replaceWith(c);
    this.canvas = c;
    try {
      this._startLocal();
      this._send('theme', { v: this._light, animate: false });
      if (this.anchors.length) this._send('bind', { first: true, light: this._light });
      if (this._introSent) this._send('intro');
      this._atlasSent = false; this._needAtlas(); this._send('warm');
      this._sentKey = '';
    } catch (e) {
      console.warn('[dollar] WebGL unavailable, drop disabled:', e && e.message);
      document.documentElement.classList.add('no-gl');
      this.enabled = false;
    }
  }

  _send(type, data) {
    if (!this.enabled && type !== 'theme') return;
    const m = data ? { type, ...data } : { type };
    if (this._worker) this._worker.postMessage(m);
    else if (this._eng) { dispatch(this._eng, m); this._eng._dirty = true; }
  }

  _onEvent(type, d) {
    switch (type) {
      case 'ready':
        this._workerReady = true; this._workerRaf = !(d && d.raf === false);
        this._paced = PACE_FROM_PAGE;
        if (this._paced && this._worker) this._worker.postMessage({ type: 'pace', on: true });
        break;
      case 'fail': this._fallback(d); break;
      case 'glow': this._writes.glow = d; break;
      case 'top': this._writes.top = d; break;
      case 'screen': this._screen = d; break;
      case 'state': this.state = d; break;
      case 'coverRes': if (this._cvRes) { const r = this._cvRes; this._cvRes = null; r(); } break;
      case 'pourCovered': { const o = this._pr; try { o && o.onCovered && o.onCovered(); } catch (e) { /* ignore */ } break; }
      case 'pourCleared': { const o = this._pr; try { o && o.onCleared && o.onCleared(); } catch (e) { /* ignore */ } break; }
      case 'pourRes': { const o = this._pr; this._pr = null; o && o.res(); break; }
      case 'impact': { const rn = this._rainJob; if (rn) { const p = (rn.get() || [])[d]; try { rn.onImpact && rn.onImpact(p, d); } catch (e) { /* ignore */ } } break; }
      case 'rainDone': { const rn = this._rainJob; if (rn) { rn.done = true; rn.resolve(); } break; }
      case 'uline': this._writes.uline = d || 0; break;
      case 'perf': this._probe(d); break;
      default: break;
    }
    if (this.reduced && (type === 'glow' || type === 'top' || type === 'uline')) this._apply();
  }

  // ------------------------------------------------------------------ capability probe (log only)
  // first ~1s of real frames, then a rolling 3s window. p90 > 18ms, or no WebGL2, would mean the
  // pre-rendered path; for now it is only recorded (window.__liquidProbe) and logged.
  _probe(ms) {
    const now = performance.now(), P = this._pb || (this._pb = { t0: now, buf: [], first: null, jank: 0, webgl2: null });
    for (const v of ms) P.buf.push([now, v]);
    while (P.buf.length && now - P.buf[0][0] > 3000) P.buf.shift();
    const p90 = () => { const a = P.buf.map((x) => x[1]).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length * 0.9)] : 0; };
    if (!P.first && now - P.t0 > 1000 && P.buf.length > 20) {
      if (P.webgl2 == null) { try { P.webgl2 = sessionStorage.getItem('dad-gl2'); if (P.webgl2 == null) { const g = document.createElement('canvas').getContext('webgl2'); P.webgl2 = g ? '1' : '0'; g && g.getExtension('WEBGL_lose_context')?.loseContext(); sessionStorage.setItem('dad-gl2', P.webgl2); } } catch (e) { P.webgl2 = '?'; } }
      const v = p90();
      P.first = { p90: +v.toFixed(1), n: P.buf.length, mode: this.mode, tier: this.tierName, webgl2: P.webgl2 === '1', verdict: v > 18 || P.webgl2 === '0' || this.tierName === 'low' ? 'would use pre-rendered' : 'live' };
      console.info('[dad:liquid] probe', JSON.stringify(P.first));
    } else if (P.first && now - (P.lastCheck || 0) > 1000) {
      P.lastCheck = now;
      const v = p90();
      if (v > 22 && P.buf.length > 60) { P.jank++; if (P.jank === 3) console.info('[dad:liquid] sustained jank, p90', v.toFixed(1), 'ms'); } else P.jank = 0;
      P.rolling = +v.toFixed(1);
    }
    window.__liquidProbe = { mode: this.mode, first: P.first, rolling: P.rolling, jank: P.jank };
    try { if (P.first) sessionStorage.setItem('dad-liquid-probe', JSON.stringify(window.__liquidProbe)); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ the page-side tick
  _tick() {
    if (!this.enabled) return;
    // 1. reads (all layout reads happen here, before any write)
    if (this._resizeQueued) {
      this._resizeQueued = false;
      const W = this.canvas.clientWidth || innerWidth, H = this.canvas.clientHeight || innerHeight;
      if (W !== this._W || H !== this._H) { this._W = W; this._H = H; this._lock = null; this._needStarts = true; this._send('resize', { W, H, dpr: window.devicePixelRatio || 1 }); }
    }
    const d = this._dest();
    let pts = null;
    const rn = this._rainJob;
    if (rn && !rn.done) pts = (rn.get() || []).map((p) => (p ? { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 } : null));
    // 2. posts, only when something changed
    const k = d ? JSON.stringify(d) : 'null';
    if (k !== this._sentKey) { this._sentKey = k; this._send('dest', { d }); }
    // WebKit, or a worker without its own rAF: the page's vsync frames pace the worker (worker.js)
    if (this._worker && this._workerReady && (this._paced || !this._workerRaf)) this._worker.postMessage(TICK);
    if (pts) { const pk = JSON.stringify(pts); if (pk !== this._ptsKey) { this._ptsKey = pk; this._send('rainPts', { pts }); } }
    // 3. writes
    this._apply();
    if (this._localTick) this._localTick();
  }

  _still() {
    if (!this.enabled) return;
    if (this._rafQueued) return;
    this._rafQueued = true;
    requestAnimationFrame(() => { this._rafQueued = false; this._tick(); });
  }

  _apply() {
    const w = this._writes;
    if (w.glow) {
      const g = w.glow, el = this._glowEl;
      w.glow = null;
      if (el) { el.style.opacity = String(g.op); el.style.transform = `translate3d(${g.x}px, ${g.y}px, 0) scale(${g.sc})`; }
    }
    if (w.top != null) {
      this._topOn = w.top;
      let z = '';
      if (w.top) z = '94';
      else if (this._foot) { const zm = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--z-main'), 10); z = String((isFinite(zm) ? zm : 2) + 1); }
      this.canvas.style.zIndex = z;
      if (this._glowEl) this._glowEl.style.zIndex = z && !w.top ? z : this._z0;
      w.top = null;
    }
    if (w.uline !== undefined) { const u = w.uline; w.uline = undefined; this._uline(u || null); }
  }

  // ------------------------------------------------------------------ anchors
  bind(root) {
    if (!this.enabled) return;
    this.unbind();
    this.root = root || document;
    // the page's anchors, then the persistent footer's (it lives outside main#swap, so it is re-read on
    // every bind and stays the last stop on every page)
    const foot = document.getElementById('footer');
    const pool = [...this.root.querySelectorAll('[data-dollar]')];
    if (foot && !(this.root.contains && this.root.contains(foot))) pool.push(...foot.querySelectorAll('[data-dollar]'));
    const els = pool.filter((el) => { const m = el.getAttribute('data-dollar-media'); return !m || matchMedia(m).matches; });
    this.anchors = els.map((el) => this._anchor(el)).filter(Boolean);
    this._act = -1;
    this._needStarts = true;
    this._lock = null;
    if (window.ScrollTrigger) {
      for (const a of this.anchors) {
        a.st = ScrollTrigger.create({ trigger: a.el, start: 'center center', end: 'center center', onRefresh: () => { this._needStarts = true; this._lock = null; } });
      }
    }
    let first = false;
    if (!this._everBound) {
      const sec = this.anchors[0]?.el.closest('[data-theme]') || document.documentElement;
      this._light = (sec.getAttribute('data-theme') || 'dark') === 'light' ? 1 : 0;
      this._everBound = true;
      first = true;
    }
    this._send('bind', { first, light: this._light });
    this._needAtlas();
    if (first && !this.reduced) this._autoIntro();
    if (this.reduced) this._still();
  }

  _needAtlas() {
    if (this._atlasSent || !this._idle) return;
    if (!this.anchors.some((a) => ATLAS_STATES.has(a.state) || ATLAS_STATES.has(a.pre))) return;
    this._atlasSent = true;
    this._send('atlas');
  }

  unbind() {
    if (!this.enabled) return;
    for (const a of this.anchors) a.st && a.st.kill();
    this.anchors = [];
    this._lock = null;
    if (this._rainJob && !this._rainJob.done) this._rainJob.resolve();
    this._rainJob = null;
    this._uline(null, true);
    this._send('unbind');
    this.root = null;
  }

  _anchor(el) {
    let state = (el.getAttribute('data-dollar') || 'spin').trim();
    if (!STATES.has(state)) return null;
    state = ALIAS[state] || state;
    const sz = (el.getAttribute('data-dollar-size') || '1').trim();
    const szm = (el.getAttribute('data-dollar-size-mobile') || '').trim();
    const pin = parseFloat(el.getAttribute('data-dollar-pin-at'));
    const shm = el.getAttribute('data-dollar-shift-media');
    const sh = (shm && !matchMedia(shm).matches ? '' : el.getAttribute('data-dollar-shift') || '').split(',').map(parseFloat);
    return {
      el, state,
      preset: SIZES[sz] ? sz : null,
      size: parseFloat(sz) || 1,
      fill: sz === 'fill',
      foot: !!el.closest('#footer'),
      presetM: szm ? (SIZES[szm] ? szm : null) : undefined,
      sizeM: parseFloat(szm) || 1,
      align: el.getAttribute('data-dollar-align') || 'center',
      target: el.getAttribute('data-dollar-target') || '',
      rot: parseFloat(el.getAttribute('data-dollar-rotate')) || 0,
      rotM: el.hasAttribute('data-dollar-rotate-mobile') ? parseFloat(el.getAttribute('data-dollar-rotate-mobile')) || 0 : null,
      aimAt: el.getAttribute('data-dollar-aim') || '',
      shift: [isFinite(sh[0]) ? sh[0] : 0, isFinite(sh[1]) ? sh[1] : 0],
      pinAt: isFinite(pin) ? pin : null,
      pinned: false,
      pre: el.getAttribute('data-dollar-pre') || '',
      hold: parseFloat(el.getAttribute('data-dollar-hold')) || 0,
      when: el.getAttribute('data-dollar-when') || '',
      glide: el.hasAttribute('data-dollar-glide'),
      start: 0,
    };
  }

  _computeStarts() {
    this._needStarts = false;
    const n = this.anchors.length;
    if (!n) return;
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const sy = window.scrollY;
    const pins = window.ScrollTrigger ? ScrollTrigger.getAll().filter((t) => t.pin) : [];
    const s = this.anchors.map((a) => {
      let v;
      const pst = pins.find((t) => t.pin.contains(a.el));
      a.pinned = !!pst;
      if (pst && a.pinAt !== null) v = pst.start + a.pinAt * (pst.end - pst.start);
      else if (a.st && isFinite(a.st.start)) v = a.st.start;
      else { const r = a.el.getBoundingClientRect(); v = r.top + sy + r.height / 2 - innerHeight / 2; }
      return clamp(v, 0, max);
    });
    const gap = innerHeight * 0.3;
    for (let i = n - 2; i >= 0; i--) if (s[i] > s[i + 1] - gap) s[i] = s[i + 1] - gap;
    for (let i = 1; i < n; i++) if (s[i] < s[i - 1] + 1) s[i] = s[i - 1] + 1;
    this.anchors.forEach((a, i) => { a.start = s[i]; });
  }

  _scrollShift() {
    const t = window.__scenes && window.__scenes.target;
    return typeof t === 'number' && isFinite(t) ? t - window.scrollY : 0;
  }

  _scrollG() {
    const a = this.anchors, n = a.length, y = window.scrollY + (this._shift || 0);
    if (n < 2 || y <= a[0].start) return 0;
    if (y >= a[n - 1].start) return n - 1;
    let i = 0;
    while (i < n - 2 && y >= a[i + 1].start) i++;
    return i + (y - a[i].start) / Math.max(1, a[i + 1].start - a[i].start);
  }

  _pick(still) {
    const n = this.anchors.length;
    if (n === 1) return (this._act = 0);
    const g = this._scrollG();
    let i = this._act;
    if (i < 0 || i >= n || still) i = clamp(Math.round(g), 0, n - 1);
    else if (g > i + 0.55) i = Math.min(n - 1, Math.round(g - 0.05));
    else if (g < i - 0.55) i = Math.max(0, Math.round(g + 0.05));
    return (this._act = i);
  }

  _gate(i) {
    const A = this.anchors, a = A[i], T = performance.now() / 1000;
    for (let j = i + 1; j < A.length; j++) A[j]._ok = false;
    if (!a || !a.hold || i === 0 || this.reduced || a._ok) { this._gI = -1; return i; }
    if (this._gI !== i) { this._gI = i; this._gT = T; }
    let ok = T - this._gT >= a.hold;
    if (ok && a.when) {
      let w = null;
      try { w = (this.root || document).querySelector(a.when); } catch (e) { w = null; }
      ok = !w || parseFloat(getComputedStyle(w).opacity) > 0.6;
    }
    if (ok) { a._ok = true; this._gI = -1; return i; }
    return i - 1;
  }

  _sizeR(a, r) {
    const W = this._W, H = this._H, m = W < 720 && a.presetM !== undefined;
    const preset = m ? a.presetM : a.preset, size = m ? a.sizeM : a.size;
    // 'fill': the shape fits the anchor box, contained, with a margin (sized for the logo's ~2.3 x 1.9 radii)
    if (a.fill) return Math.max(10, Math.min(r.width / 2.6, r.height / 2.2) * 0.86);
    if (preset) { const [fh, fw] = SIZES[preset]; return Math.max(8, Math.min(H * fh, W * fw) / 2); }
    return Math.max(10, Math.min(r.width, r.height) / 2 * size);
  }

  // the destination for this frame (one anchor measured), with the landing lock applied
  _dest() {
    if (!this.anchors.length) return null;
    this._shift = this.reduced ? 0 : this._scrollShift();
    if (this._needStarts) this._computeStarts();
    const i = this._gate(this._pick(this.reduced));
    const a = this.anchors[i];
    // the footer has a solid background: while its anchor is active the canvas sits just above it
    if (a.foot !== this._foot) { this._foot = a.foot; this._writes.top = this._writes.top ?? this._topOn ?? false; }
    const sy = window.scrollY, sh = a.pinned ? 0 : this._shift, H = this._H;
    const L = this._lock;
    if (L && L.i === i) {
      // locked: the settled place, carried by the scroll only
      const dy = L.sy + L.sh - sy - sh;
      const d = { ...L.d, y: L.d.y + dy };
      if (d.line) d.line = { ...d.line, y: d.line.y + dy, ly: d.line.y + dy };
      if (d.y < -H * 0.3 || d.y > H * 1.3) return { i, state: 'ambient', amb: 1 };
      return d;
    }
    if (L) this._lock = null;
    const d = this._place(a, i);
    // settled on this anchor (engine says so): lock it
    const st = this.state;
    if (!d.amb && !d.stk && d.state !== 'rain' && !a.pinned && st && st.i === i && st.t >= 1 && !this._shift) {
      this._lock = { i, d, sy, sh };
    }
    return d;
  }

  _place(a, i) {
    const state = a.state;
    if (state === 'ambient') return { i, state: 'ambient', amb: 1 };
    if (state === 'rain') return this._rainPlace(a, i);
    if (state === 'underline') return this._linePlace(a, i);
    const r = a.el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return { i, state, amb: 1 };
    const W = this._W, H = this._H, sh = a.pinned ? 0 : this._shift;
    const R = this._sizeR(a, r);
    let top = r.top - sh, stk = false;
    // a CSS-sticky anchor (the how-it-works loop rail) does not travel with the scroll once stuck: predict
    // where it will be when the scene move ends (stuck at its band) instead of where the page will carry it
    if (!a.pinned && (a.el.classList.contains('ph-stick') || a.sticky)) {
      const cs = getComputedStyle(a.el);
      if (cs.position === 'sticky') {
        a.sticky = stk = true;
        const st = parseFloat(cs.top), sb = parseFloat(cs.bottom);
        if (sh > 0 && isFinite(st) && r.top >= st - 1) top = Math.max(top, st);
        else if (sh < 0 && isFinite(sb)) { const lim = H - sb - r.height; if (r.top <= lim + 1) top = Math.min(top, lim); }
      }
    }
    let x = r.left + r.width / 2, y = top + r.height / 2;
    if (a.align === 'left') x = r.left + R; else if (a.align === 'right') x = r.right - R;
    x += a.shift[0] * R; y += a.shift[1] * R;
    if (y < -H * 0.3 || y > H * 1.3 || x < -R || x > W + R) return { i, state, amb: 1 };
    const mob = W < 720 && a.rotM !== null;
    let aim = mob ? a.rotM : a.rot;
    if (a.aimAt && !mob) {
      let t = null;
      try { t = (this.root || document).querySelector(a.aimAt); } catch (e) { t = null; }
      const q = t && t.getBoundingClientRect();
      if (q && q.width > 1) aim = Math.atan2(q.top + q.height / 2 - sh - y, q.left + q.width / 2 - x) * 180 / Math.PI;
    }
    const d = { i, state, x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2, R: Math.round(R * 2) / 2, aim: Math.round(aim * 10) / 10 };
    if (a.pre) d.pre = a.pre;
    if (a.glide) {
      d.glide = 1;
      // ly: where the anchor is right now, while the scene move is still carrying it in (a glide rides
      // with its content and is never overtaken by it)
      if (sh) d.ly = Math.round((y + sh) * 2) / 2;
    }
    if (stk) d.stk = 1;
    return d;
  }

  _target(a) {
    let t = null;
    if (a.target) { try { t = (a.el.parentElement && a.el.parentElement.querySelector(a.target)) || (this.root || document).querySelector(a.target); } catch (e) { t = null; } }
    // a split-text reveal (reveals.js) leaves an empty twin of the target in front of the real one,
    // with the same id: take the one that holds the text
    if (t && a.state === 'underline' && !t.textContent.trim()) {
      try { const all = [...(this.root || document).querySelectorAll(a.target)]; t = all.find((e) => e.textContent.trim()) || t; } catch (e) { /* keep t */ }
    }
    return t;
  }

  // the last line of t's text (left, right, bottom) where it RESTS: a split-line reveal still sliding
  // the line up into its mask is discounted, so the line is known before the words have risen
  _lineRect(t) {
    let L = null;
    try {
      const rg = document.createRange(); rg.selectNodeContents(t);
      const rs = [...rg.getClientRects()].filter((q) => q.width > 1 && q.height > 1);
      if (rs.length) {
        const bot = Math.max(...rs.map((q) => q.bottom)), line = rs.filter((q) => q.bottom > bot - 6);
        L = { l: Math.min(...line.map((q) => q.left)), r: Math.max(...line.map((q) => q.right)), b: bot };
        const sl = t.closest('.sl'), mk = sl && sl.parentElement;
        if (mk && mk.classList.contains('sl-mask')) L.b -= sl.getBoundingClientRect().top - mk.getBoundingClientRect().top;
      }
    } catch (e) { L = null; }
    return L;
  }

  // 'underline': the last line of the target's text (left, right, baseline) and its font size
  _linePlace(a, i) {
    const t = this._target(a) || a.el;
    let L = this._lineRect(t);
    if (!L) { const q = t.getBoundingClientRect(); L = { l: q.left, r: q.right, b: q.bottom }; }
    const w = L.r - L.l, W = this._W, H = this._H;
    if (w < 6) return { i, state: 'underline', amb: 1 };
    const fs = parseFloat(getComputedStyle(t).fontSize) || 16;
    const ly = L.b - 0.02 * fs, y = ly - (a.pinned ? 0 : this._shift);
    if (y < -H * 0.3 || y > H * 1.3 || L.r < 0 || L.l > W) return { i, state: 'underline', amb: 1 };
    this._ulTarget = t;
    // y: where the line will rest when the scene move ends · ly: where it is right now (still scrolling in)
    return { i, state: 'underline', line: { l: Math.round(L.l), r: Math.round(L.r), y: Math.round(y), ly: Math.round(ly), fs: Math.round(fs) } };
  }

  _rainPlace(a, i) {
    const t = this._target(a);
    const r = (t || a.el).getBoundingClientRect();
    const vis = r.width >= 2 && r.bottom >= 0 && r.top <= this._H;
    return { i, state: 'rain', rain: { cx: Math.round(r.left + r.width / 2), top: Math.round(r.top), w: Math.round(r.width), vis } };
  }

  // ------------------------------------------------------------------ the vector underline
  // d: { t0 (absolute ms), dur (s), l, r, y, fs } from the engine when the droplet lands; null clears.
  // The reveal is a pair of compositor-only transform animations (a wipe), so it stays in step with the
  // droplet even while the main thread is busy. Glossy red-orange via SVG gradients; a gentle slow wave.
  _uline(d, now = false) {
    const old = this._ul;
    if (old && (!d || old.key !== `${d.l}|${d.r}|${d.y}`)) {
      this._ul = null;
      if (now || this.reduced) old.el.remove();
      else { old.el.style.transition = 'opacity .45s ease'; old.el.style.opacity = '0'; setTimeout(() => old.el.remove(), 500); }
    }
    if (!d || this._ul) return;
    const t = this._ulTarget;
    const host = (t && (t.closest('section') || t.parentElement)) || document.body;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    // measured now, in the host's own coordinates (so it scrolls with the text)
    const hr = host.getBoundingClientRect();
    const L = t && this._lineRect(t);
    if (!L || !isFinite(L.l)) return;
    const fs = d.fs, w = Math.round(L.r - L.l), yl = L.b - 0.02 * fs;
    const sw = clamp(0.075 * fs, 3.5, 8), amp = clamp(0.05 * fs, 2, 5.5), lam = clamp(1.25 * fs, 48, 150);
    const pad = Math.ceil(sw + amp + 4), hgt = pad * 2;
    const light = (host.closest('[data-theme]')?.getAttribute('data-theme') || 'dark') === 'light';
    // the wave, two wavelengths longer than the line so it can travel
    const pts = [];
    for (let x = -lam; x <= w + lam + 2; x += 3) pts.push(`${x.toFixed(1)},${(pad + amp * Math.sin(x / lam * 6.2832)).toFixed(2)}`);
    const dPath = 'M' + pts.join(' L');
    const id = 'ul' + Math.random().toString(36).slice(2, 7);
    const wrap = document.createElement('div');
    wrap.className = 'liquid-underline';
    wrap.setAttribute('aria-hidden', 'true');
    // place it in the host's coordinates, where the line will be when the scene settles
    const left = L.l - hr.left - host.clientLeft, top = yl - hr.top - host.clientTop - pad;
    Object.assign(wrap.style, { position: 'absolute', left: left.toFixed(1) + 'px', top: top.toFixed(1) + 'px', width: w + 'px', height: hgt + 'px', pointerEvents: 'none', overflow: 'hidden', zIndex: '2', contain: 'layout paint' });
    const inner = document.createElement('div');
    Object.assign(inner.style, { position: 'absolute', inset: '0', willChange: 'transform' });
    wrap.appendChild(inner);
    const glow = light ? 'drop-shadow(0 1px 1.5px rgba(150,30,10,.28))' : 'drop-shadow(0 0 5px rgba(255,80,36,.5))';
    inner.innerHTML = `<svg xmlns="${SVGNS}" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" style="display:block;overflow:visible;filter:${glow}">
<defs>
<linearGradient id="${id}g" x1="0" y1="${pad - amp - sw / 2}" x2="0" y2="${pad + amp + sw / 2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff9a5c"/><stop offset=".42" stop-color="#ff4a22"/><stop offset="1" stop-color="#b3180a"/></linearGradient>
<linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}m" x1="0" y1="0" x2="${w}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset="${Math.min(0.08, 10 / w)}" stop-color="#fff"/><stop offset="${1 - Math.min(0.08, 10 / w)}" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="${id}k" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${hgt}"><rect x="0" y="0" width="${w}" height="${hgt}" fill="url(#${id}m)"/></mask>
<mask id="${id}s" maskUnits="userSpaceOnUse" x="${-lam}" y="0" width="${w + 2 * lam}" height="${hgt}"><rect class="ul-gloss" x="${-0.3 * w}" y="0" width="${Math.max(30, 0.22 * w)}" height="${hgt}" fill="url(#${id}h)"/></mask>
</defs>
<g mask="url(#${id}k)"><g class="ul-wave">
<path d="${dPath}" fill="none" stroke="url(#${id}g)" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${dPath}" fill="none" stroke="#ffd2b8" stroke-opacity=".55" stroke-width="${(sw * 0.24).toFixed(2)}" stroke-linecap="round" transform="translate(0 ${(-sw * 0.2).toFixed(2)})"/>
<path d="${dPath}" fill="none" stroke="#fff" stroke-width="${(sw * 0.34).toFixed(2)}" stroke-linecap="round" transform="translate(0 ${(-sw * 0.18).toFixed(2)})" mask="url(#${id}s)"/>
</g>
</g></svg>`;
    host.appendChild(wrap);
    const wave = inner.querySelector('.ul-wave'), gloss = inner.querySelector('.ul-gloss');
    const el = (absNow() - d.t0) / 1000, dur = d.dur * 1000;
    const ease = 'cubic-bezier(0.65, 0, 0.35, 1)';
    if (!this.reduced && el < d.dur) {
      // the wipe: outer slides in from the left while the content counter-slides (compositor only)
      const o = { duration: dur, easing: ease, fill: 'both', delay: -el * 1000 };
      wrap.animate([{ transform: `translateX(${-w}px)` }, { transform: 'translateX(0)' }], o);
      inner.animate([{ transform: `translateX(${w}px)` }, { transform: 'translateX(0)' }], o);
      gloss.animate([{ transform: `translateX(0)` }, { transform: `translateX(${1.3 * w}px)` }], { duration: dur, easing: ease, fill: 'both', delay: -el * 1000 });
    }
    if (!this.reduced) {
      wave.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-lam}px)` }], { duration: 4200, iterations: Infinity, easing: 'linear', delay: 0 });
      gloss.animate([{ transform: `translateX(0)` }, { transform: `translateX(${1.6 * w}px)` }], { duration: 2600, delay: Math.max(0, dur - el * 1000) + 2200, iterations: Infinity, easing: 'ease-in-out' });
    }
    this._ul = { el: wrap, key: `${d.l}|${d.r}|${d.y}` };
  }

  // ------------------------------------------------------------------ rain
  rain(pts, { el = null, onImpact = null } = {}) {
    if (!this.enabled) return Promise.resolve();
    const get = typeof pts === 'function' ? pts : () => pts;
    const list = get() || [];
    const idx = this.anchors.findIndex((a) => a.el === el);
    const rn = this._rainJob = { get, onImpact, done: false };
    rn.promise = new Promise((res) => { rn.resolve = res; });
    this._ptsKey = '';
    this._send('rainPts', { pts: list.map((p) => (p ? { x: p.x, y: p.y } : null)) });
    this._send('rain', { idx, n: list.length });
    if (this.reduced) this._still();
    return rn.promise;
  }
  rainReset() {
    if (this._rainJob && !this._rainJob.done) this._rainJob.resolve();
    this._rainJob = null;
    this._send('rainReset');
  }

  // ------------------------------------------------------------------ page transitions
  cover() {
    if (!this.enabled || this.reduced || document.hidden) return Promise.resolve();
    if (this._cvP && this._cvRes) return this._cvP;
    this._lock = null;
    this._cvP = new Promise((r) => { let d = false; this._cvRes = () => { if (!d) { d = true; r(); } }; });
    const res = this._cvRes;
    setTimeout(() => res(), COVER_IN * 1000 + 40);
    this._send('cover');
    return this._cvP;
  }
  reveal() { this._send('reveal'); }
  flyTo(anchorEl, { duration = 1.1 } = {}) {
    if (!this.enabled) return;
    this._send('fly', { duration });
    if (this.reduced) this._still();
  }

  pour(opts) {
    if (!this.enabled) return Promise.resolve();
    if (opts === null) { this._send('pourCancel'); return Promise.resolve(); }
    if (this._pr && !this._pr.cancelled) return this._pr.promise;
    const o = opts || {};
    const pr = this._pr = { onCovered: o.onCovered, onCleared: o.onCleared };
    pr.promise = new Promise((r) => { let d = false; pr.res = () => { if (!d) { d = true; r(); } }; });
    this._send('pour');
    return pr.promise;
  }
  pourReset() { this._send('pourReset'); }
  pourDone() { this._send('pourDone'); }

  _autoIntro() {
    if (this._introQueued) return;
    this._introQueued = true;
    const go = () => { if (this._introSent) return; this._introSent = true; this._send('intro'); };
    const h = document.documentElement;
    const waiting = !h.classList.contains('no-pl') && !h.classList.contains('is-ready') && document.getElementById('preloader');
    if (waiting) {
      window.addEventListener('dad:preloader-done', () => setTimeout(go, 120), { once: true });
      setTimeout(go, 2600);
    } else setTimeout(go, 60);
  }
  intro() {
    if (!this.enabled || this._introSent) return;
    this._introSent = true;
    this._send('intro');
  }

  getScreenPosition() {
    if (!this.enabled || !this._screen) return null;
    return { ...this._screen };
  }

  setTheme(theme) {
    if (!this.enabled) return;
    this._light = theme === 'light' ? 1 : 0;
    this._send('theme', { v: this._light, animate: !this.reduced && !!window.gsap });
    if (this.reduced) this._still();
  }

  dispose() {
    if (!this.enabled) return;
    this.unbind();
    if (this._tickFn && window.gsap) gsap.ticker.remove(this._tickFn);
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    if (this._onScrollStill) window.removeEventListener('scroll', this._onScrollStill);
    document.removeEventListener('visibilitychange', this._onVis);
    this.canvas.style.zIndex = '';
    if (this._worker) this._worker.terminate();
    if (this._eng) this._eng.dispose();
    if (this._glowEl) this._glowEl.remove();
    this.enabled = false;
  }
}
