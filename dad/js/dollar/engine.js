// THE LIQUID ENGINE: the drop's whole simulation, with NO DOM access, so it can run in a Web Worker
// (OffscreenCanvas), on the main thread (fallback) or drive the pre-rendered clip player (clips.js).
// The main thread (dollar.js) measures the page and hands the engine a destination ("dest") per frame
// only when it changes; everything time-based (travel, morphs, cover, flood, rain, theme, intro) runs
// here on the engine's own clock. The renderer ("view") is either gl.js View (raymarched) or
// clips.js ClipView (sprite sheets); both take the same calls. Every body draw carries P.sem, a
// semantic description (idle / morph / cover ...) the clip player uses to pick its frames.
//
// dest: null (no anchors) or { i, state, pre, amb, x, y, R, aim, rain: {cx, top, w, vis}, line: {l, r, y, ly, fs} }
// events (emit(type, data)): glow, top, screen, state, coverRes, pourCovered, pourCleared, pourRes,
//   impact, rainDone, uline, perf, fail
import { makeForm, copyForm, formInto, mat3, H1, iconMatrix, blendIcon, galaxyMatrix, ICON_STATES } from './forms.js?v=f5d5bbea69';

export const TIERS = {
  low: { dpr: 1.5, res: 1, steps: 48, stars: 600, adapt: true },
  mid: { dpr: 2.5, res: 1, steps: 64, stars: 1000 },
  high: { dpr: 2.5, res: 1, steps: 96, stars: 1400 },
};
// the effective quality for this device. Phones and tablets (A-series GPUs at 3x, thermal throttling):
// at most 2x device pixels (the analytic edge coverage keeps the silhouette crisp at any scale), at most
// 56 raymarch steps, and the budget may also trim resolution in small steps (never below 80%).
export function tierQ(tier, mobile) {
  const q = TIERS[tier] || TIERS.mid;
  if (!mobile) return q;
  return { ...q, dpr: Math.min(q.dpr, 2), steps: Math.min(q.steps, 56), adapt: true, minRes: q.adapt ? 0.75 : 0.8 };
}
export const N_PRIMS = 16;
export const SIZES = { hero: [0.45, 0.5], feature: [0.3, 0.42], companion: [0.12, 0.22] };
export const CAM = 4.2;
export const COVER_IN = 0.55;
export const FORMATIONS = ['spin', 'rest', 'crack', 'leak', 'reform', 'ring', 'split', 'vessel', 'disc', 'network', 'orbit9', 'four', 'galaxy', ...ICON_STATES];
const MORPH = 1.35, MELT = 0.95, EMERGE = 1.5, CONDENSE = 1.05;
const COVER_OUT = 1.0;
const POUR = { swell: 0.3, full: 1.2, hold: 0.15, clear: 0.45 };
const EDGE = 24, DISC = 1.08, NO_DIR = [0, 1];
const UL_DRAW = 1.15;     // the underline: seconds for the droplet to draw the line
const UL_DART = 0.32;     // the underline: seconds for the droplet to dart straight to the start of the text

const nowS = () => performance.now() / 1000;
export const absNow = () => (performance.timeOrigin || 0) + performance.now();
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a)));
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const ease2 = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const expLerp = (a, b, t) => Math.exp(lerp(Math.log(Math.max(a, 0.5)), Math.log(Math.max(b, 0.5)), t));
// travel: a small pull back at launch, then a smooth landing with no overshoot: the drop reaches its
// final position before the shape has finished forming, so nothing ever slides after it has formed
const travel = (u) => easeIO(u) - 0.12 * Math.sin(Math.PI * u) * (1 - u) * (1 - u);
// glide (anchors with data-dollar-glide, and every underline landing): no pull back, it sets off at once
// with the scroll and eases out long, velocity 12u(1-u)^2: zero at both ends, peak at a third
const glide = (u) => 1 - Math.pow(1 - u, 3) * (1 + 3 * u);
const GLIDE_LAND = 0.72;  // a glide reaches its place at this fraction of the move
const spring = u => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.exp(-6 * u) * (Math.cos(10 * u) + 0.6 * Math.sin(10 * u)));
const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

export function makeStars(n) {
  const d = new Float32Array(n * 8);
  let seed = 9;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  for (let i = 0; i < n; i++) {
    const onArm = rnd() < 0.84, rr = 0.14 + 1.06 * Math.pow(rnd(), 0.85);
    const o = i * 8;
    d[o] = (i % 2) * Math.PI + gauss() * (onArm ? 0.1 + 0.2 * rr : Math.PI);
    d[o + 1] = rr;
    d[o + 2] = gauss() * (0.02 + 0.09 * Math.max(0, 0.55 - rr));
    d[o + 4] = 0.014 + 0.03 * Math.pow(rnd(), 5);
    d[o + 5] = 0.6 * (rr - 0.14) / 1.06 + 0.4 * rnd();
    d[o + 6] = 0.75 + 0.45 * rnd();
  }
  return d;
}

export class Engine {
  constructor(view, { tier = 'mid', reduced = false, mobile = false, emit = () => {}, W = 800, H = 600, dpr = 1 } = {}) {
    this.view = view;
    this.tierName = TIERS[tier] ? tier : 'mid';
    this.q = tierQ(this.tierName, mobile);
    this.reduced = !!reduced;
    this.emit = emit;
    this._light = 0; this._lt = null;
    this._time = 0;
    this._introP = 1; this._intro = null;
    this._resScale = 1; this._bud = { dts: [], n: 0, miss: 0, bad: 0, good: 0, need: 8, upT: -9 };
    this._steps = this.q.steps;
    this._key = null; this._tr = null; this._cv = null; this._pr = null;
    this._poured = false; this._last = null; this._has = false; this._amb = 0; this._ext = 1.3;
    this._topOn = false;
    this._g = { x: 0, y: 0, init: false };
    this._pos = { x: 0, y: 0, R: 1 };
    this._vel = { x: 0, y: 0 };
    this._hist = [];
    this._dest = null;
    this._ul = null;
    this.state = { a: null, b: null, t: 1 };
    const N = this.N = view.n;
    this._form = makeForm(N); this._from = makeForm(N); this._out = makeForm(N);
    this._fa = makeForm(N); this._fb = makeForm(N);
    this._outS2 = new Float32Array(12);
    this._M = new Float32Array(9); this._Mp = new Float32Array(9); this._My = new Float32Array(9);
    this._Mg = new Float32Array(9); this._MgT = new Float32Array(9);
    this._P = { box: [0, 0, 0, 0], cam: [0, 0, 1, CAM], A: new Float32Array(N * 4), B: new Float32Array(N * 4), S: new Float32Array(24), look: new Float32Array(4), she: new Float32Array(4), k: 0.3, time: 0, bound: 1, I: new Float32Array(16), IM: new Float32Array(9), st: new Float32Array([1, 0, 1, 0]), px: new Float32Array(4), sem: null };
    this._perfBuf = []; this._perfT = 0;
    this.resize(W, H, dpr);
  }

  // ------------------------------------------------------------------ inputs
  resize(W, H, dpr) {
    this._W = W; this._H = H; this._dpr = dpr || 1;
    const sc = Math.min(this._dpr, this.q.dpr) * this.q.res * this._resScale;
    this._sc = sc;
    this.view.resize(W, H, sc);
  }
  setDest(d) { this._dest = d; }
  setHidden(v) { this._hidden = !!v; }
  bind({ first = false, light = null } = {}) {
    this._bindT = this._time;
    this._poured = false;
    this._ul = null;
    if (this._cv) this._cv.bound = nowS();
    if (first) {
      if (light != null) this._light = light;
      if (!this.reduced) this._introP = 0;
    }
  }
  unbind() {
    this._rain = null;
    if (this._pr) { this._pr = null; this.emit('pourRes'); }
  }
  intro() {
    if (this._intro || this._introP >= 1) return;
    if (this.reduced) { this._introP = 1; return; }
    this._intro = { t0: nowS(), from: this._introP };
  }
  setTheme(v, animate) {
    if (!animate || this.reduced) { this._light = v; this._lt = null; return; }
    this._lt = { t0: nowS(), from: this._light, to: v };
  }
  flyTo(duration) {
    if (this._cv) { this.reveal(); return; }
    if (!this.reduced && duration) this._key = '__fly';
  }
  pourDone() { this._poured = true; }
  pourReset() { this.pourCancel(); this._poured = false; }

  // ------------------------------------------------------------------ the per-frame driver tick
  // dt seconds since the last frame; still: a single static frame (reduced motion)
  frame(dt, still = false) {
    if (this._lost) return;
    if (this._hidden && !still) return;
    const T = nowS();
    if (this._lt) { const u = clamp((T - this._lt.t0) / 0.9); this._light = lerp(this._lt.from, this._lt.to, ease2(u)); if (u >= 1) this._lt = null; }
    if (this._intro) { const u = clamp((T - this._intro.t0) / 1.5); this._introP = lerp(this._intro.from, 1, 1 - (1 - u) * (1 - u)); if (u >= 1) this._intro = null; }
    if (!still) this._perf(dt, T);
    const rsT = this._rain && !this._rain.done ? this._rain.shrink : this._rain && this._rain.done ? 0.46 : 1;
    this._rs = this._rs == null ? rsT : this._rs + (rsT - this._rs) * Math.min(1, dt * 6);
    const tau = still ? 2.2 : (this._time += dt);
    this._glowFrame(dt, still);
    if (this._cv) this._coverFrame(this._cv, dt, tau, T);
    else {
      let ov = null;
      if (this._pr) {
        ov = this._pourStep(this._pr, T);
        if (ov && ov.full) { this._pourDraw(this._pr, ov, dt, tau); this._post(); return; }
      }
      this._setTop(!!ov);
      this._scene(dt, still, tau, T);
      if (ov) this.view.drawSheet(ov.sheet, true);
    }
    this._post();
  }

  // state and screen position go back to the page (only when they change)
  _post() {
    const s = this.state, k = `${s.a}|${s.b}|${s.t >= 1 ? 1 : 0}|${s.i}`, T = nowS();
    if (k !== this._stK || T - (this._stT || 0) > 0.05) { this._stK = k; this._stT = T; this.emit('state', { a: s.a, b: s.b, t: s.t, i: s.i == null ? -1 : s.i }); }
    const p = this._screen;
    if (p) {
      const sk = `${p.x | 0}|${p.y | 0}|${p.r | 0}|${p.ambient ? 1 : 0}`;
      if (sk !== this._scK) { this._scK = sk; this.emit('screen', p); }
    }
  }

  // frame-time guard. iOS has no GPU timer, so the budget is read from missed refreshes: a frame that took
  // more than ~1.45x the display's own interval (its 20th-percentile dt, so 30Hz Low Power and 120Hz
  // both read right) means the GPU ran over. Two half-second windows with 2+ misses: one notch down,
  // raymarch steps first (8% at a time, to 55%), then resolution (5% at a time) where the tier allows.
  // Back up one notch only after 4s with no misses (8s+ if it bounced), so quality never flickers and
  // every change is too small to see.
  _perf(dt, T) {
    if (dt > 0 && dt < 0.25) this._perfBuf.push(dt * 1000);
    if (T - this._perfT > 0.25) { this._perfT = T; if (this._perfBuf.length) { this.emit('perf', this._perfBuf); this._perfBuf = []; } }
    if (!this.view.setSteps || !(dt > 0) || dt > 0.25) return;
    const B = this._bud;
    B.dts.push(dt); if (B.dts.length > 60) B.dts.shift();
    if (B.dts.length < 20) return;
    if (B.n === 0) { const a = B.dts.slice().sort((x, y) => x - y); B.ref = a[Math.floor(a.length * 0.2)]; }
    if (dt > B.ref * 1.45) B.miss++;
    if (++B.n < 30) return;
    const miss = B.miss; B.n = 0; B.miss = 0;
    const q = this.q, min = Math.round(q.steps * 0.55), minRes = q.minRes || 0.75;
    if (miss >= 2) {
      B.good = 0;
      if (++B.bad < 2) return;
      B.bad = 0;
      if (T - B.upT < 3) B.need = Math.min(32, B.need * 2);   // bounced: wait longer before the next try
      if (this._steps > min) { this._steps = Math.max(min, Math.round(this._steps * 0.92)); this.view.setSteps(this._steps); }
      else if (q.adapt && this._resScale > minRes + 1e-3) { this._resScale = Math.max(minRes, this._resScale - 0.05); this.resize(this._W, this._H, this._dpr); }
    } else if (miss === 0) {
      B.bad = 0;
      if (++B.good < B.need) return;
      B.good = 0;
      if (this._resScale < 1) { this._resScale = Math.min(1, this._resScale + 0.05); this.resize(this._W, this._H, this._dpr); B.upT = T; }
      else if (this._steps < q.steps) { this._steps = Math.min(q.steps, Math.round(this._steps * 1.06) + 1); this.view.setSteps(this._steps); B.upT = T; }
    } else { B.bad = 0; B.good = 0; }
  }

  _setTop(on) {
    if (on === this._topOn) return;
    this._topOn = on;
    this.emit('top', on);
  }

  // ------------------------------------------------------------------ destinations
  _ambient() { return { state: 'spin', ambient: true, x: this._g.x, y: this._g.y, R: 16 }; }

  _resolve(d) {
    if (!d) return null;
    let state = d.state;
    if (d.pre && !this._poured && !this.reduced) state = d.pre;
    if (d.amb || state === 'ambient') return { ...this._ambient(), i: d.i };
    if (state === 'rain') {
      const rn = this._rain, r = d.rain;
      if ((rn && rn.idx === d.i && rn.done) || !r || !r.vis) return { ...this._ambient(), i: d.i };
      const mob = this._W < 720;
      const R = clamp(r.w * (mob ? 0.07 : 0.032), mob ? 17 : 22, 44) * (this._rs || 1);
      return { state: 'spin', key: 'rain', x: r.cx, y: Math.max(r.top + R * 1.5, R + 70), R, i: d.i };
    }
    if (state === 'underline') {
      const L = d.line;
      if (!L) return { ...this._ambient(), i: d.i };
      const R = clamp(0.2 * L.fs, 6, 16);
      return { state: 'spin', key: 'underline', ul: L, x: L.l + R * 0.4, y: L.y, R, i: d.i, glide: 1 };
    }
    const c = this._inView(d.x, d.y, d.R);
    return { state, x: c[0], y: c[1], R: d.R, aim: d.aim || 0, i: d.i, glide: d.glide ? 1 : 0, ly: d.ly == null ? null : d.ly };
  }

  _inView(x, y, R) {
    const e = R * 1.2 + EDGE, W = this._W, H = this._H;
    return [W > 2 * e ? clamp(x, e, W - e) : W / 2, H > 2 * e ? clamp(y, e, H - e) : H / 2];
  }

  // ------------------------------------------------------------------ rain
  rain({ idx, n }) {
    const mob = this._W < 720;
    const rn = this._rain = { idx, t0: this._time, shrink: 1, done: false, drops: [], pts: [] };
    for (let i = 0; i < n; i++) {
      const h = H1[(i * 5 + 3) % H1.length] || 0.5;
      rn.drops.push({ i, delay: 0.12 + i * 0.17 + h * 0.06, dur: 0.78 + h * 0.2, r: (mob ? 6.5 : 9.5) * (0.82 + 0.36 * h), st: 0, hit: false, h });
    }
    if (this.reduced || !n) { for (let i = 0; i < n; i++) this.emit('impact', i); rn.done = true; this.emit('rainDone'); }
  }
  rainPts(pts) { if (this._rain) this._rain.pts = pts || []; }
  rainReset() { if (this._rain && !this._rain.done) this.emit('rainDone'); this._rain = null; }

  _smallP() {
    return this._rp || (this._rp = { box: [0, 0, 0, 0], cam: [0, 0, 1, CAM], A: new Float32Array(this.N * 4), B: new Float32Array(this.N * 4), S: new Float32Array(24), look: new Float32Array(4), she: new Float32Array(4), k: 0.22, time: 0, bound: 1, sem: { k: 'bead' } });
  }
  _drawSmall(P, x, y, R, alpha, bound) {
    const light = clamp(this._light);
    bound = Math.min(bound, CAM * 0.8);
    P.look[0] = light; P.look[1] = alpha; P.look[2] = (1 - light) * 0.15; P.look[3] = 0;
    P.time = this._time; P.bound = bound;
    P.cam[0] = x; P.cam[1] = y; P.cam[2] = R; P.cam[3] = CAM;
    const half = bound * (CAM / (CAM - bound)) * R + 2 + (light < 1 ? 0.85 * R : 0);
    const bx0 = Math.max(0, x - half), by0 = Math.max(0, y - half), bx1 = Math.min(this._W, x + half), by1 = Math.min(this._H, y + half);
    if (bx1 <= bx0 || by1 <= by0) return;
    P.box[0] = bx0; P.box[1] = by0; P.box[2] = bx1; P.box[3] = by1;
    this.view.draw(P, true);
  }

  _rainFrame() {
    const rn = this._rain;
    if (!rn || rn.done || this.reduced) return;
    const T = this._time - rn.t0, pts = rn.pts || [];
    const P = this._smallP();
    let left = 0;
    for (const d of rn.drops) {
      if (d.st === 2) continue;
      left++;
      const t = T - d.delay;
      if (t < 0) continue;
      const p = pts[d.i];
      if (!p) { if (pts.length) d.st = 2; continue; }
      if (d.st === 0) {
        d.st = 1;
        d.sx = this._pos.x + (d.h - 0.5) * this._pos.R * 0.5; d.sy = this._pos.y + this._pos.R * 0.45;
        rn.shrink = Math.max(0.46, rn.shrink - 0.065);
      }
      const A = P.A, B = P.B, N = this.N;
      A.fill(0); B.fill(0);
      const u = t / d.dur;
      let x, y, R = d.r, alpha = 1, bound;
      if (u < 1) {
        const dx = p.x - d.sx, dy = p.y - d.sy, dist = Math.hypot(dx, dy);
        const hgt = clamp(dist * 0.42, 50, 230) * (0.85 + 0.3 * d.h);
        x = d.sx + dx * u; y = d.sy + dy * u - hgt * 4 * u * (1 - u);
        const vx = dx, vy = dy - hgt * 4 * (1 - 2 * u);
        const vl = Math.hypot(vx, vy) || 1, ux = vx / vl, uy = -vy / vl;
        const grow = smooth(clamp(t / 0.16)), str = 0.35 + 0.55 * clamp(vl / 900);
        R *= 0.45 + 0.55 * grow;
        A[0] = 0; A[1] = 0; A[2] = 0; A[3] = 0.66;
        A[4] = -ux * 0.3; A[5] = -uy * 0.3; A[6] = 0; A[7] = 0.48;
        A[8] = -ux * 0.35; A[9] = -uy * 0.35; A[10] = 0; A[11] = 0.2;
        B[8] = -ux * (0.7 + str); B[9] = -uy * (0.7 + str); B[10] = 0;
        bound = 1.05 + str + 0.2;
      } else {
        if (!d.hit) { d.hit = true; this.emit('impact', d.i); }
        const v = (t - d.dur) / 0.46;
        if (v >= 1) { d.st = 2; continue; }
        x = p.x; y = p.y;
        A[0] = 0; A[1] = -0.15 * v; A[2] = 0; A[3] = 0.62 * Math.pow(1 - v, 0.8);
        const nC = Math.min(5, N - 1);
        for (let j = 0; j < nC; j++) {
          const an = j / nC * 6.2832 + d.h * 3, s = 0.25 + 1.7 * Math.pow(v, 0.7), o = (j + 1) * 4;
          A[o] = Math.cos(an) * s; A[o + 1] = 1.1 * v - 1.5 * v * v; A[o + 2] = Math.sin(an) * s * 0.6;
          A[o + 3] = 0.26 * (1 - v);
          B[o] = A[o]; B[o + 1] = A[o + 1]; B[o + 2] = A[o + 2];
        }
        alpha = 1 - smooth(clamp((v - 0.45) / 0.55));
        bound = 2.3;
      }
      for (let i = 0; i < N; i++) { if (u < 1 && i === 2) continue; const j = i * 4; B[j] = A[j]; B[j + 1] = A[j + 1]; B[j + 2] = A[j + 2]; }
      this._drawSmall(P, x, y, R, alpha, bound);
    }
    if (!left) { rn.done = true; this.emit('rainDone'); }
  }

  _trailFrame(amount) {
    if (amount < 0.02 || this.reduced) return;
    const h = this._hist, P = this._smallP();
    const at = (age) => { const t = this._time - age; for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) return h[i]; return h[0]; };
    const A = P.A, B = P.B;
    for (const [age, rf] of [[0.06, 0.17], [0.11, 0.13], [0.17, 0.095]]) {
      const q = at(age);
      if (!q) continue;
      const R = this._pos.R * rf * amount;
      if (R < 1.5) continue;
      A.fill(0); B.fill(0);
      A[3] = 0.85;
      this._drawSmall(P, q.x, q.y, R, 1, 1);
    }
  }

  // ------------------------------------------------------------------ page transitions
  cover() {
    if (this.reduced || this._hidden || this._lost) { this.emit('coverRes'); return; }
    if (this._cv && this._cv.mode !== 'out') return;
    if (this._pr) { this._pr = null; this.emit('pourRes'); }
    const T = nowS(), vis = this._has && this._alpha0 > 0.05 && this._last && !this._last.ambient;
    const st = vis ? (this.state.sb || this.state.b) : 'spin';
    this._cv = {
      mode: 'in', t0: T, tc: T, vis,
      x: vis ? this._pos.x : this._g.x, y: vis ? this._pos.y : this._g.y, R: vis ? Math.max(14, this._pos.R) : 22,
      state: FORMATIONS.includes(st) ? st : 'spin', aim: (this._last && this._last.aim) || 0,
    };
    this._tr = null;
    this._ul = null;
  }
  reveal() {
    const cv = this._cv;
    if (!cv || cv.mode === 'out') return;
    this.emit('coverRes');
    const T = nowS(), c = cv.cur || { x: this._W / 2, y: this._H / 2, Rd: 0.64 * Math.hypot(this._W, this._H), spin: 9 };
    cv.mode = 'out'; cv.t0 = T; cv.sx = c.x; cv.sy = c.y; cv.sR = c.Rd; cv.sSpin = c.spin;
    cv.dur = clamp(1.6 - (T - cv.tc), 0.8, COVER_OUT);
  }

  pour() {
    if (this.reduced || this._cv || this._hidden || this._lost) {
      this.emit('pourCovered'); this._poured = true; this.emit('pourCleared'); this.emit('pourRes');
      return;
    }
    if (this._pr && this._pr.cancel == null) return;
    const vis = this._has && this._alpha0 > 0.05 && this._last && !this._last.ambient;
    this._pr = {
      t0: nowS(), x: vis ? this._pos.x : this._g.x, y: vis ? this._pos.y : this._g.y, R: vis ? Math.max(16, this._pos.R) : 20,
      state: vis && FORMATIONS.includes(this.state.sb) ? this.state.sb : 'spin',
    };
  }
  pourCancel() {
    const pr = this._pr;
    if (pr && pr.cancel == null) { pr.cancel = nowS(); this._has = false; }
  }

  // ------------------------------------------------------------------ per frame
  _glowFrame(dt, still) {
    const g = this._g, W = this._W, H = this._H, t = this._time;
    const hx = W * (0.5 + 0.2 * Math.sin(t * 0.11)), hy = H * (0.55 + 0.13 * Math.sin(t * 0.083 + 1));
    if (!g.init || still) { g.x = hx; g.y = hy; g.init = true; }
    else { const k = Math.min(1, dt * 0.55); g.x += (hx - g.x) * k; g.y += (hy - g.y) * k; }
    const op = this._amb * lerp(0.16, 0.18, clamp(this._light)) * (this._introP < 1 ? clamp(this._introP * 2) : 1);
    const S = Math.max(W, H) * 1.2, sc = 0.8 + 0.2 * this._amb + 0.03 * Math.sin(t * 0.4);
    const x = Math.round(g.x - S / 2), y = Math.round(g.y - S / 2);
    const key = `${x}|${y}|${op.toFixed(3)}|${sc.toFixed(3)}`;
    if (key === this._glowKey) return;
    this._glowKey = key;
    this.emit('glow', { x, y, op: +op.toFixed(3), sc: +sc.toFixed(3), S });
  }

  _blend(fm, F, p, O, flat = false) {
    const N = this.N, A = O.a, B = O.b;
    for (let i = 0; i < N; i++) {
      const ord = flat || i === 0 ? 0 : 0.15 + 0.7 * H1[i];
      const e = flat ? p : spring(clamp((p - 0.2 * ord) / 0.8));
      const j = i * 4;
      for (let k = 0; k < 3; k++) { A[j + k] = lerp(fm.a[j + k], F.a[j + k], e); B[j + k] = lerp(fm.b[j + k], F.b[j + k], e); }
      A[j + 3] = Math.max(0.85 * Math.min(fm.a[j + 3], F.a[j + 3]), lerp(fm.a[j + 3], F.a[j + 3], e)); B[j + 3] = 0;
    }
    O.s.set(fm.s); O.s[7] = fm.s[7] * (1 - smooth(clamp(p / 0.65)));
    this._outS2.set(F.s); this._outS2[7] = F.s[7] * smooth(clamp((p - 0.08) / 0.7));
    blendIcon(fm, F, flat ? p : spring(clamp((p - 0.05) / 0.9)), O);
    const ek = smooth(p);
    O.k = lerp(fm.k, F.k, ek); O.glow = lerp(fm.glow, F.glow, ek); O.jelly = lerp(fm.jelly, F.jelly, ek); O.lean = lerp(fm.lean, F.lean, ek);
  }

  _tumble(dt, still, tau, lean, spin = 0, pitchK = 0) {
    const yaw = tau * 0.32 + spin, pitch = 0.16 * Math.sin(tau * 0.29) + pitchK, roll = 0.08 * Math.sin(tau * 0.21);
    mat3(pitch, yaw, roll, this._M);
    mat3(pitchK, spin, 0, this._Mp);
    mat3(0, yaw * 0.6, 0, this._My);
  }

  _coverFrame(cv, dt, tau, T) {
    const W = this._W, H = this._H, hyp = Math.hypot(W, H), Rh = 0.3 * Math.min(W, H), Rfull = 0.64 * hyp;
    let x, y, Rd, spin, swirl, blendP, place = null, alpha = 1, glowK = 0, u = 0;
    if (cv.mode === 'in' && T - cv.t0 >= COVER_IN) { cv.mode = 'hold'; cv.t1 = cv.t0 + COVER_IN; this.emit('coverRes'); }
    if (cv.mode === 'in') {
      u = clamp((T - cv.t0) / COVER_IN);
      const e = smooth(clamp(u / 0.85));
      x = lerp(cv.x, W / 2, e); y = lerp(cv.y, H / 2, e);
      Rd = expLerp(cv.R * DISC, Rfull, 0.5 - 0.5 * Math.cos(Math.PI * u));
      spin = u * u * 9; swirl = spin;
      blendP = sstep(0.05, 0.6, u);
      glowK = 1 - sstep(0, 0.5, u);
      cv.cur = { x, y, Rd, spin };
    } else if (cv.mode === 'hold') {
      const h = T - cv.t1;
      x = W / 2; y = H / 2; Rd = Rfull * (1 + 0.025 * Math.sin(h * 2.4)); spin = 9 + h * 0.8; swirl = spin;
      blendP = 1; u = 1;
      cv.cur = { x, y, Rd, spin };
      if (h > 4 || (cv.bound && T - cv.bound > 0.15)) this.reveal();
    }
    if (cv.mode === 'out') {
      u = clamp((T - cv.t0) / cv.dur);
      place = this._resolve(this._dest);
      if (place && place.ul) place = { ...place, x: place.ul.l + place.R * 0.4 };
      if (!place || place.ambient) place = { state: 'spin', ambient: true, x: this._g.x, y: this._g.y, R: 26 };
      const v = clamp(u / 0.85);
      x = lerp(cv.sx, place.x, easeIO(v)); y = lerp(cv.sy, place.y, easeIO(v));
      Rd = expLerp(cv.sR, place.R * DISC, 1 - Math.pow(1 - v, 2.6));
      swirl = cv.sSpin + u * 2; spin = Math.pow(1 - u, 2) * 4;
      blendP = sstep(0.4, 1, u);
      glowK = sstep(0.6, 1, u);
      if (place.ambient) alpha = 1 - sstep(0.55, 1, u);
    }
    const k = clamp((Rd - Rh) / (0.3 * Rh));
    this._setTop(k > 0.02 || cv.mode !== 'out');
    this.view.clear();
    if (k < 1) {
      this._tumble(dt, false, tau, 0, spin, cv.mode === 'out' ? 0 : u * u * 0.9);
      const ctx = { tau, M: this._M, Mp: this._Mp, My: this._My, aim: 0 };
      let sem;
      if (cv.mode === 'out') {
        formInto(this._fa, 'cover', ctx);
        formInto(this._fb, place.state, { ...ctx, aim: place.aim || 0 });
        sem = { k: 'cout', b: place.state, u, m: blendP, tau };
      } else {
        formInto(this._fa, cv.state, { ...ctx, aim: cv.aim });
        formInto(this._fb, 'cover', ctx);
        sem = { k: 'cin', a: cv.state, u, m: blendP, tau };
      }
      this._blend(this._fa, this._fb, blendP, this._out);
      this._render(this._out, x, y, Rd / DISC, { tau, alpha, keep: true, glowK, cover: cv.mode === 'out' ? 1 - u : u * 0.6, noShadow: cv.mode !== 'out', sem });
    }
    if (k > 0) {
      this.view.drawSheet({ x, y, R: Rd, inside: sstep(0.42 * hyp, 0.6 * hyp, Rd), time: T, paper: 0, alpha: alpha * k, swirl: swirl * 0.06, warp: 0.04, light: clamp(this._light) }, true);
    }
    this._pos = { x, y, R: Rd / DISC };
    this.state = { a: 'cover', b: place ? (place.ambient ? 'ambient' : place.key || place.state) : 'cover', t: u };
    if (cv.mode === 'out' && u >= 1) {
      this._cv = null;
      this._tr = null;
      this._key = place.ambient ? 'amb' : '__cv';
      this._has = !place.ambient;
      this._amb = place.ambient ? 1 : this._amb;
      this._setTop(false);
    }
  }

  _pourStep(pr, T) {
    const W = this._W, H = this._H, t = T - pr.t0, P = POUR;
    if (pr.cancel != null) {
      const a = 1 - (T - pr.cancel) / 0.3;
      if (a <= 0 || !pr.last) { this._pr = null; this.emit('pourRes'); return null; }
      return { full: false, sheet: { ...pr.last, time: T, alpha: pr.last.alpha * a } };
    }
    const pl = this._resolve(this._dest);
    const sw = clamp(t / P.swell), es = easeIO(sw);
    const cx = pl && !pl.ambient ? lerp(pr.x, pl.x, es) : pr.x, cy = pl && !pl.ambient ? lerp(pr.y, pl.y, es) : pr.y;
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
    const Rh = 0.26 * Math.min(W, H), Rend = far * 1.14 + 40;
    let Rd, paper;
    if (t < P.swell) { Rd = expLerp(pr.R * DISC, Rh, smooth(sw)); paper = 0; }
    else {
      const s = clamp((t - P.swell) / (P.full - P.swell));
      Rd = lerp(Rh, Rend, 1 - Math.pow(1 - s, 2.1));
      paper = sstep(0.06, 1, s);
    }
    if (t >= P.full && !pr.covered) { pr.covered = true; this.emit('pourCovered'); }
    let alpha = 1;
    if (t >= P.full + P.hold) {
      if (!pr.cleared) {
        pr.cleared = true;
        this._poured = true;
        this._key = '__pour';
        this._tr = null;
        this.emit('pourCleared');
      }
      alpha = 1 - sstep(0, P.clear, t - P.full - P.hold);
      if (alpha <= 0.002) { this._pr = null; this.emit('pourRes'); return null; }
    }
    const k = clamp((Rd - Rh * 0.85) / (0.3 * Rh));
    const sheet = { x: cx, y: cy, R: Rd, inside: 0.15 * paper, time: T, paper, alpha: alpha * k, swirl: 0, warp: 0.075, light: clamp(this._light) };
    pr.last = sheet;
    return { full: !pr.cleared, sheet, k, sw };
  }

  _pourDraw(pr, ov, dt, tau) {
    this._setTop(true);
    const s = ov.sheet;
    this.view.clear();
    if (ov.k < 1) {
      this._tumble(dt, false, tau, 0, ov.sw * ov.sw * 2.5);
      const ctx = { tau, M: this._M, Mp: this._Mp, My: this._My, aim: 0 };
      formInto(this._fa, pr.state, ctx); formInto(this._fb, 'cover', ctx);
      const m = sstep(0, 0.9, ov.sw);
      this._blend(this._fa, this._fb, m, this._out);
      this._render(this._out, s.x, s.y, s.R / DISC, { tau, keep: true, cover: 0.5 * ov.sw, glowK: 1 - ov.sw, noShadow: true, sem: { k: 'cin', a: pr.state, u: ov.sw * 0.7, m, tau } });
    }
    if (s.alpha > 0.001) this.view.drawSheet(s, true);
    this._pos = { x: s.x, y: s.y, R: s.R / DISC };
    this.state = { a: 'flood', b: 'flood', t: clamp((nowS() - pr.t0) / POUR.full) };
  }

  // ---- the normal frame: follow the destination
  _scene(dt, still, tau, T) {
    const W = this._W, H = this._H;
    let place = null, key = null;
    if (this._dest) {
      place = this._resolve(this._dest);
      key = place.ambient ? 'amb' : place.i + '|' + (place.key || place.state);
    } else if (this._last) { place = this._last; key = this._key; }
    if (!place) { this._amb += (0 - this._amb) * Math.min(1, dt * 3); this.view.clear(); this._rainFrame(); return; }

    // ---- the underline: the droplet lands at the start of the text, then draws the line to its end
    if (place.ul) {
      const L = place.ul, ul = this._ul;
      if (ul && ul.key === key) {
        const u = clamp((T - ul.t0) / UL_DRAW), e = easeIO(u);
        place = { ...place, x: lerp(L.l + place.R * 0.4, L.r - place.R * 0.2, e), y: L.y };
        const gone = sstep(0, 0.32, T - ul.t0 - UL_DRAW);
        place.R *= 1 - 0.75 * gone;
        place.fade = gone;
      }
    }
    this._last = place;

    if (key !== this._key) {
      const prev = this._key, wasAmb = prev === 'amb' || !this._has;
      const animate = prev !== null && prev !== '__cv' && !still && !this.reduced;
      if (this._ul && this._ul.key !== key) { this._ul = null; this.emit('uline', null); }
      let kind = null;
      if (animate && (this._has || !place.ambient)) {
        kind = prev === '__pour' ? (place.ambient ? null : 'condense') : place.ambient ? 'melt' : wasAmb ? 'emerge' : 'move';
        if (kind === 'melt' && (prev === 'amb' || this._alpha0 < 0.05)) kind = null;
      }
      if (kind) {
        if (!this._has && kind !== 'condense') { formInto(this._out, 'spin', { tau, M: this._M, Mp: this._M, My: this._M }); this._pos = { x: this._g.x, y: this._g.y, R: 16 }; }
        copyForm(this._out, this._from);
        if (this._outS2[7] > this._out.s[7]) this._from.s.set(this._outS2);
        if (kind === 'emerge' || kind === 'condense') formInto(this._from, 'spin', { tau, M: this._M, Mp: this._M, My: this._M });
        if (kind === 'emerge') this._pos = { x: this._g.x, y: this._g.y, R: 2 };
        if (kind === 'condense') this._pos = { x: place.x, y: place.y, R: 2 };
        if (kind === 'melt') { this._g.x = this._pos.x; this._g.y = this._pos.y; }
        let dur = { melt: MELT, emerge: EMERGE, move: MORPH, condense: CONDENSE }[kind];
        // the underline droplet: no wander, no glide; it darts straight to the start of the text and the
        // line starts as it lands (whether it comes from a shape or out of the ambient glow)
        const dart = !!place.ul && (kind === 'move' || kind === 'emerge');
        const gl = kind === 'move' && !!place.glide && !dart;
        if (dart) dur = UL_DART;
        const from = kind === 'emerge' || kind === 'condense' ? 'spin' : (this.state.sb || 'spin');
        this._tr = { t0: T, p: 0, kind, dur, x: this._pos.x, y: this._pos.y, R: this._pos.R, from, to: place.ambient ? 'ambient' : place.state, fromKey: this.state.b, seed: H1[(this._time * 7 | 0) % 40], glide: gl, dart, side: 0, ly: null };
      } else this._tr = null;
      this._key = key;
    }

    const tr = this._tr;
    this._tumble(dt, still, tau, 0);
    formInto(this._form, place.state, { tau, M: this._M, Mp: this._Mp, My: this._My, aim: place.aim || 0 });

    let x = place.x, y = place.y, R = place.R;
    let alpha = 1, stD = NO_DIR, stF = 1, trail = 0, ambT = place.ambient ? 1 : 0;
    const F = this._form, O = this._out;
    let sem;
    this._outS2.fill(0);
    if (tr) {
      tr.p = clamp((T - tr.t0) / tr.dur);
      const p = tr.p, fm = this._from;
      if (tr.kind === 'melt') {
        x = tr.x; y = tr.y; R = tr.R * (1 + 0.5 * smooth(p));
        const m = sstep(0, 0.6, p);
        this._blend(fm, F, m, O, true);
        alpha = 1 - sstep(0, 0.4, p); // melt out quickly so the drop never lingers over the new scene's text
        ambT = sstep(0.05, 0.6, p);
        sem = { k: 'morph', a: tr.from, b: 'spin', m, tau };
      } else if (tr.kind === 'condense') {
        R = Math.max(1, lerp(2, place.R, spring(clamp(p / 0.9))));
        const m = sstep(0.12, 0.85, p);
        this._blend(fm, F, m, O);
        alpha = sstep(0, 0.12, p);
        sem = { k: 'morph', a: 'spin', b: place.state, m, tau };
      } else if (tr.dart) {
        // straight to the start of the text, fast out, soft in; the body shrinks to the droplet on the way
        const s = 1 - Math.pow(1 - p, 3);
        x = lerp(tr.x, place.x, s); y = lerp(tr.y, place.y, s);
        R = Math.max(1, expLerp(tr.R, place.R, clamp(s * 1.2)));
        const m = clamp(p / 0.6);
        this._blend(fm, F, m, O);
        if (tr.kind === 'emerge') ambT = 1 - sstep(0, 0.5, p);
        trail = 0.5 * Math.sin(Math.PI * p);
        sem = { k: 'morph', a: tr.from, b: place.state, m, tau };
      } else if (tr.kind === 'emerge') {
        const cx = W / 2, cy = H / 2, rx = W * 0.4, ry = H * 0.34;
        const a0 = Math.atan2(tr.y - cy, tr.x - cx), dir = tr.seed > 0.5 ? 1 : -1;
        const pts = [[tr.x, tr.y]];
        for (const k of [0.9, 1.9, 2.8]) pts.push([cx + Math.cos(a0 + dir * k) * rx, cy + Math.sin(a0 + dir * k) * ry]);
        pts.push([place.x, place.y]);
        const u = easeIO(clamp(p / 0.78)) * (pts.length - 1), si = Math.min(pts.length - 2, Math.floor(u)), f = u - si;
        const Pt = (k) => pts[clamp(k, 0, pts.length - 1)];
        x = catmull(Pt(si - 1)[0], Pt(si)[0], Pt(si + 1)[0], Pt(si + 2)[0], f);
        y = catmull(Pt(si - 1)[1], Pt(si)[1], Pt(si + 1)[1], Pt(si + 2)[1], f);
        const Rs = clamp(place.R * 0.16, 9, 22);
        R = p < 0.12 ? Rs * smooth(p / 0.12) : p < 0.74 ? Rs : lerp(Rs, place.R, spring(clamp((p - 0.74) / 0.26)));
        R = Math.max(1, R);
        const m = clamp((p - 0.68) / 0.32);
        this._blend(fm, F, m, O);
        ambT = 1 - sstep(0, 0.35, p);
        trail = sstep(0.1, 0.25, p) * (1 - sstep(0.6, 0.8, p));
        const kc = 1 - sstep(0.88, 1, p);
        if (kc > 0) { const c = this._inView(x, y, R); x = lerp(x, c[0], kc); y = lerp(y, c[1], kc); }
        sem = { k: 'morph', a: 'spin', b: place.state, m, tau };
      } else if (tr.glide) {
        // a glide: sets off with the scroll, a gentle bow, the size eases with the travel (no lift), and
        // the new shape forms a beat later, so a big body never shows the new shape at its old size
        const u = clamp(p / GLIDE_LAND), s = glide(u);
        const dx = place.x - tr.x, dy = place.y - tr.y, dist = Math.hypot(dx, dy);
        let nx = 0, ny = 0;
        if (dist > 1) {
          nx = -dy / dist; ny = dx / dist;
          // the bow's side is chosen once, at departure, so a destination that shifts by a pixel never
          // flips it mid-flight (that read as a shake)
          if (!tr.side) tr.side = nx * ((tr.x + place.x) / 2 - W / 2) + ny * ((tr.y + place.y) / 2 - H / 2) > 0 ? -1 : 1;
          nx *= tr.side; ny *= tr.side;
        }
        // a mostly vertical move goes straight (no sideways bow)
        const hz = dist > 1 ? sstep(0.35, 0.7, Math.abs(dx) / dist) : 0;
        const bow = hz * Math.min(dist * 0.08, Math.min(W, H) * 0.06) * Math.sin(Math.PI * s);
        x = lerp(tr.x, place.x, s) + nx * bow; y = lerp(tr.y, place.y, s) + ny * bow;
        // a vertical glide never dips back the way it came (a destination that settles late, or a touch
        // drag, must not pull the drop down and up again): its height only moves toward the target
        // it rides with its content: never left behind the anchor while the scene move carries it in
        if (place.ly != null && Math.abs(dy) > Math.abs(dx)) y = dy < 0 ? Math.min(y, place.ly) : Math.max(y, place.ly);
        if (Math.abs(dy) > Math.abs(dx) && tr.ly != null && u < 1) y = dy < 0 ? Math.min(y, tr.ly) : Math.max(y, tr.ly);
        tr.ly = y;
        R = expLerp(tr.R, place.R, s);
        const m = clamp((p - 0.12) / 0.88);
        this._blend(fm, F, m, O);
        trail = dist > R * 1.5 ? Math.sin(Math.PI * s) * 0.6 : 0;
        const kc = sstep(0, 0.12, p);
        if (kc > 0) { const c = this._inView(x, y, R); x = lerp(x, c[0], kc); y = lerp(y, c[1], kc); }
        sem = { k: 'morph', a: tr.from, b: place.state, m, tau };
      } else {
        const u = clamp((p - 0.04) / 0.74), s = travel(u);
        const dx = place.x - tr.x, dy = place.y - tr.y, dist = Math.hypot(dx, dy);
        const lift = Math.sin(Math.PI * clamp(s));
        let nx = 0, ny = 0;
        if (dist > 1) {
          nx = -dy / dist; ny = dx / dist;
          if (nx * ((tr.x + place.x) / 2 - W / 2) + ny * ((tr.y + place.y) / 2 - H / 2) > 0) { nx = -nx; ny = -ny; }
        }
        const bow = Math.min(dist * 0.24, Math.min(W, H) * 0.18);
        const b1 = 3 * s * (1 - s) * (1 - s), b2 = 3 * s * s * (1 - s), b3 = s * s * s, b0 = (1 - s) * (1 - s) * (1 - s);
        const c1x = tr.x + dx * 0.25 + nx * bow, c1y = tr.y + dy * 0.25 + ny * bow, c2x = tr.x + dx * 0.75 + nx * bow * 0.7, c2y = tr.y + dy * 0.75 + ny * bow * 0.7;
        x = b0 * tr.x + b1 * c1x + b2 * c2x + b3 * place.x; y = b0 * tr.y + b1 * c1y + b2 * c2y + b3 * place.y;
        R = lerp(tr.R, place.R, smooth(clamp(s))) * (1 + 0.16 * lift);
        this._blend(fm, F, p, O);
        if (p < 0.07 && dist > 4) { stD = NO_DIR; stF = 1 - 0.17 * Math.sin(Math.PI * p / 0.07); }
        trail = dist > R * 1.5 ? lift : 0;
        const kc = sstep(0, 0.12, p);
        if (kc > 0) { const c = this._inView(x, y, R); x = lerp(x, c[0], kc); y = lerp(y, c[1], kc); }
        sem = { k: 'morph', a: tr.from, b: place.state, m: p, tau };
      }
      if (p >= 1) this._tr = null;
    } else {
      copyForm(F, O);
      if (place.ambient) alpha = 0;
      sem = { k: 'idle', a: place.state, tau };
    }
    // the underline starts drawing once the droplet has landed at the start of the text, and the text
    // (still finishing its scroll in, ly) has all but reached it
    if (place.ul && (place.ul.ly == null || Math.abs(place.ul.ly - place.ul.y) < 0.06 * H) && (!this._tr || (this._tr.glide && this._tr.p >= GLIDE_LAND) || (this._tr.dart && this._tr.p >= 0.85)) && (!this._ul || this._ul.key !== key)) {
      this._ul = { key, t0: T };
      const L = place.ul;
      this.emit('uline', { t0: absNow(), dur: UL_DRAW, l: L.l, r: L.r, y: L.y, fs: L.fs, i: place.i });
    }
    if (place.fade) alpha *= 1 - place.fade;
    this.state = { a: tr ? tr.fromKey : place.ambient ? 'ambient' : place.key || place.state, b: place.ambient ? 'ambient' : place.key || place.state, sb: place.ambient ? 'spin' : place.state, t: tr ? tr.p : 1, i: place.ambient ? -1 : place.i };
    this._amb += (ambT - this._amb) * Math.min(1, dt * (ambT > this._amb ? 2.2 : 3.5));
    if (still) this._amb = ambT;

    if (!still) {
      const vx = (x - this._pos.x) / Math.max(dt, 1e-3), vy = (y - this._pos.y) / Math.max(dt, 1e-3);
      const k = Math.min(1, dt * 14);
      this._vel.x += (vx - this._vel.x) * k; this._vel.y += (vy - this._vel.y) * k;
      this._hist.push({ t: this._time, x, y });
      while (this._hist.length > 2 && this._time - this._hist[0].t > 0.3) this._hist.shift();
    }
    this._pos.x = x; this._pos.y = y; this._pos.R = R;
    if (tr && tr.kind === 'move' && stF === 1) {
      const sp = Math.hypot(this._vel.x, this._vel.y);
      const soft = tr.glide || tr.dart;
      if (sp > 1) { stD = [this._vel.x / sp, -this._vel.y / sp]; stF = 1 + Math.min(soft ? 0.14 : 0.42, sp / Math.max(R, 10) / (soft ? 20 : 14)); }
    } else if (!tr && !still && place.state === 'spin' && !place.ambient) {
      stD = NO_DIR; stF = 1 + 0.022 * Math.sin(tau * 1.3);
    }

    const ip = this._introP;
    if (ip < 1) { const e = 1 - Math.pow(1 - ip, 3); y -= (1 - e) * H * 0.42; R *= 0.7 + 0.3 * e; alpha *= clamp(ip * 3); }

    const gal = this._galAmount(tr, place);
    let drew;
    if (gal > 0.01 && !this._noStars) {
      this.view.clear();
      this._galaxy(gal, x, y, R, tau, alpha, -1);
      drew = this._render(O, x, y, R, { tau, alpha, stD, stF, keep: true, sem });
      this._galaxy(gal, x, y, R, tau, alpha, 1);
    } else {
      drew = this._render(O, x, y, R, { tau, alpha, stD, stF, sem });
      if (!drew) this.view.clear();
    }
    if (drew) this._trailFrame(trail * alpha);
    this._rainFrame();
  }

  _galAmount(tr, place) {
    if (tr) {
      if (tr.to === 'galaxy') return tr.kind === 'melt' ? 0 : sstep(0.15, 0.95, tr.p);
      if (tr.from === 'galaxy') return 1 - sstep(0, 0.55, tr.p);
      return 0;
    }
    return place.state === 'galaxy' && !place.ambient ? 1 : 0;
  }

  _galaxy(m, x, y, R, tau, alpha, side) {
    const v = this.view;
    if (!this._starsOn) {
      try { v.setGalaxy(this._stars || (this._stars = makeStars(this.q.stars))); this._starsOn = true; } catch (e) { this._noStars = true; return; }
    }
    const M = galaxyMatrix(tau, this._Mp, this._Mg), G = this._MgT;
    G[0] = M[0]; G[1] = M[3]; G[2] = M[6]; G[3] = M[1]; G[4] = M[4]; G[5] = M[7]; G[6] = M[2]; G[7] = M[5]; G[8] = M[8];
    v.drawGalaxy({ x, y, R, D: CAM, spin: tau * 0.32, morph: m, alpha, side, light: clamp(this._light), core: 0.22, M: G });
  }

  // upload one body (form O at x, y with radius R, CSS px) and draw it; false if nothing was drawn.
  _render(O, x, y, R, o) {
    const W = this._W, H = this._H, N = this.N, A = O.a, B = O.b;
    const P = this._P, PA = P.A, PB = P.B;
    const alpha = o.alpha == null ? 1 : o.alpha, cover = o.cover || 0;
    let bound = 0.2, minY = 1e9, x0 = 1e9, x1 = -1e9, ex = 0, ey = 0;
    for (let i = 0; i < N; i++) {
      const j = i * 4, r = A[j + 3];
      const ax = A[j], ay = A[j + 1], bx = B[j], by = B[j + 1];
      PA[j] = ax; PA[j + 1] = ay; PA[j + 2] = A[j + 2]; PA[j + 3] = r;
      PB[j] = bx; PB[j + 1] = by; PB[j + 2] = B[j + 2]; PB[j + 3] = 0;
      if (r > 0.003) {
        bound = Math.max(bound, Math.hypot(ax, ay, A[j + 2]) + r, Math.hypot(bx, by, B[j + 2]) + r);
        ex = Math.max(ex, Math.abs(ax) + r, Math.abs(bx) + r); ey = Math.max(ey, Math.abs(ay) + r, Math.abs(by) + r);
        if (r > 0.18) { minY = Math.min(minY, ay - r, by - r); x0 = Math.min(x0, ax - r, bx - r); x1 = Math.max(x1, ax + r, bx + r); }
      }
    }
    const S = P.S;
    S.set(O.s, 0); S.set(this._outS2, 12);
    for (const k of [0, 12]) {
      if (S[k + 7] > 0.01) {
        const ext = S[k + 8] + S[k + 9] + S[k + 10];
        bound = Math.max(bound, Math.hypot(S[k], S[k + 1], S[k + 2]) + ext);
        ex = Math.max(ex, Math.abs(S[k]) + ext); ey = Math.max(ey, Math.abs(S[k + 1]) + ext);
        if (S[k + 7] > 0.3) { minY = Math.min(minY, S[k + 1] - ext * 0.75); x0 = Math.min(x0, S[k] - ext); x1 = Math.max(x1, S[k] + ext); }
      }
    }
    const I = P.I;
    I.set(O.I);
    if (I[3] > 0.01) {
      iconMatrix(O.pose, this._Mp, P.IM);
      const ext = I[4] * (1.42 + 0.15 * I[9]);
      bound = Math.max(bound, Math.hypot(I[12], I[13], I[14]) + ext);
      ex = Math.max(ex, Math.abs(I[12]) + ext); ey = Math.max(ey, Math.abs(I[13]) + ext);
      if (I[3] > 0.3) { minY = Math.min(minY, I[13] - 0.9 * I[4]); x0 = Math.min(x0, I[12] - 0.9 * I[4]); x1 = Math.max(x1, I[12] + 0.9 * I[4]); }
    }
    const stF = o.stF || 1, stD = o.stD || NO_DIR;
    bound = Math.min(bound * Math.max(1, stF) + 0.04, CAM * 0.8);
    P.st[0] = stD[0]; P.st[1] = stD[1]; P.st[2] = stF; P.st[3] = clamp(cover);
    P.px[0] = o.paper || 0;
    P.sem = o.sem || null;

    const light = clamp(this._light), cv1 = 1 - clamp(cover);
    const glow = (1 - light) * 0.2 * O.glow * cv1 * (o.glowK == null ? 1 : o.glowK);
    const shadow = x1 > x0 && !o.noShadow ? light * 0.24 * cv1 : 0;
    const she = P.she;
    if (shadow > 0) {
      const span = Math.min(x1 - x0, 2.4);
      she[0] = (x0 + x1) / 2; she[1] = minY - 0.07; she[2] = span * 0.5 + 0.12; she[3] = 0.1 + span * 0.07;
    }
    P.look[0] = light; P.look[1] = alpha; P.look[2] = glow; P.look[3] = shadow;
    P.k = Math.max(0.004, O.k); P.time = o.tau; P.bound = bound;
    P.cam[0] = x; P.cam[1] = y; P.cam[2] = R; P.cam[3] = CAM;
    const proj = CAM / (CAM - bound);
    this._ext = bound * proj;
    this._alpha0 = alpha;
    this._screen = { x: alpha < 0.08 ? this._g.x : x, y: alpha < 0.08 ? this._g.y : y, r: alpha < 0.08 ? 0 : R * 0.8, ambient: alpha < 0.08 };
    this._has = true;
    if (alpha < 0.003) return false;
    const fx = stF !== 1 ? bound : Math.min(bound, ex + 0.08), fy = stF !== 1 ? bound : Math.min(bound, ey + 0.08);
    let hx = fx * proj * R + 3, hy = fy * proj * R + 3;
    if (glow > 0.001) { hx += 0.62 * proj * R; hy += 0.62 * proj * R; }
    let bx0 = x - hx, by0 = y - hy, bx1 = x + hx, by1 = y + hy;
    if (shadow > 0) {
      bx0 = Math.min(bx0, x + (she[0] - she[2]) * R * proj - 2); bx1 = Math.max(bx1, x + (she[0] + she[2]) * R * proj + 2);
      by1 = Math.max(by1, y - (she[1] - she[3]) * R * proj + 2);
    }
    if (!o.free) { bx0 = Math.max(0, bx0); by0 = Math.max(0, by0); bx1 = Math.min(W, bx1); by1 = Math.min(H, by1); }
    if (bx1 <= bx0 || by1 <= by0) return false;
    P.box[0] = bx0; P.box[1] = by0; P.box[2] = bx1; P.box[3] = by1;
    this.view.draw(P, !!o.keep);
    return true;
  }

  // ------------------------------------------------------------------ pre-warm and offline posing
  // compile every program and render every formation once, tiny and invisible, so first use never
  // hitches. Spread over idle frames by the host (one call per step); returns false when done.
  warmStep() {
    if (!this._wq) {
      this._wq = ['__programs', ...FORMATIONS.map((s) => 'f:' + s), '__stars'];
    }
    const job = this._wq.shift();
    if (!job) return false;
    try {
      if (job === '__programs') this.view.warm && this.view.warm();
      else if (job === '__stars') { if (!this._starsOn && this.view.setGalaxy) { this.view.setGalaxy(this._stars || (this._stars = makeStars(this.q.stars))); this._starsOn = true; } }
      else if (this.view.warmDraw) {
        const s = job.slice(2), tau = 1.3;
        this._tumble(0, true, tau, 0);
        formInto(this._fa, s, { tau, M: this._M, Mp: this._Mp, My: this._My, aim: 0 });
        this._outS2.fill(0);
        const keep = this._light;
        this._render(this._fa, -100, -100, 40, { tau, alpha: 1, keep: true, free: true });
        this._light = keep;
        this.view.warmDraw(this._P);
      }
    } catch (e) { /* warming is best effort */ }
    return this._wq.length > 0;
  }

  dispose() { this._lost = true; try { this.view.dispose(); } catch (e) { /* ignore */ } }
}

// one message -> engine call (shared by the worker and the same-thread host)
export function dispatch(eng, m) {
  switch (m.type) {
    case 'resize': eng.resize(m.W, m.H, m.dpr); break;
    case 'dest': eng.setDest(m.d); break;
    case 'bind': eng.bind(m); break;
    case 'unbind': eng.unbind(); break;
    case 'intro': eng.intro(); break;
    case 'theme': eng.setTheme(m.v, m.animate); break;
    case 'hidden': eng.setHidden(m.v); break;
    case 'cover': eng.cover(); break;
    case 'reveal': eng.reveal(); break;
    case 'fly': eng.flyTo(m.duration); break;
    case 'rain': eng.rain(m); break;
    case 'rainPts': eng.rainPts(m.pts); break;
    case 'rainReset': eng.rainReset(); break;
    case 'pour': eng.pour(); break;
    case 'pourCancel': eng.pourCancel(); break;
    case 'pourReset': eng.pourReset(); break;
    case 'pourDone': eng.pourDone(); break;
    case 'atlas': eng.view.loadAtlas && eng.view.loadAtlas(); break;
    case 'warm': eng._warming = true; break;
    default: break;
  }
}

// the render loop both hosts run: dt from the host's clock; pre-warm one formation per frame; with
// reduced motion only redraw when something changed
export function hostTick(eng, dt) {
  if (eng._warming && !eng._tr && !eng._cv && !eng._pr) eng._warming = eng.warmStep();
  if (eng.reduced) { if (eng._dirty) { eng._dirty = false; eng.frame(0.016, true); } return; }
  eng.frame(dt);
}
