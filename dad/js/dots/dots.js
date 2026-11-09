// DAD dot-matrix illustration engine.
//
//   import { Dots } from './dots/dots.js?v=3badc3b098';
//   const dots = new Dots({ tier, reduced });
//   dots.bind(main);            // mounts every <div class="dots" data-dots="<shape>"> in main
//   dots.unbind();              // tears down everything bound by bind() (or unbind(root) for one root)
//   dots.morph(el, 'health');   // morphs a mounted element into another shape (also dots.api.morph)
//   dots.ripple(el, clientX, clientY)  // a shockwave through the dots (also fired by a 'dollar:land' event)
//   dots.siteScreenPositions(el)  // map: [{ index, name, cat, color, x, y }] current viewport coords of every site
//   dots.lightSite(el, index, color?) // map: flash + ripple one site (color: category, token or CSS colour); returns {x, y}
//
// Markup:
//   <div class="dots" data-dots="food"
//        data-dots-color="red|cyan|gold|paper|teal|ink|multi"   (optional; default: --fg + the shape's accent)
//        data-dots-accent="gold"        (optional accent override)
//        data-dots-density="1"          (optional multiplier)
//        data-dots-sites="off"          (map only: hide the pulsing sites)
//        data-dots-arcs="off"           (map only: hide the travelling arcs)
//        data-dots-tilt="off"           (map only: no soft 3D tilt / pointer parallax)
//        data-dots-align="center|left|right"
//        data-dots-delay="400"          (ms to wait after scrolling into view before assembling)
//        data-dots-amp="1.6"            (optional motion strength multiplier; 1 = the shape's own)
//        data-dots-sequence="food,health,opportunities,infrastructure"  (scroll-scrubbed morph through the closest section)
//        data-dots-steps                (morph to each [data-dots-step="shape"] element in the closest section as it crosses 60%)
//        data-dots-trigger="#selector"  (element whose scroll range drives sequence/steps)
//   ></div>
// The element is sized by CSS. If it has no height, an aspect-ratio matching the shape is applied.

import { getShape, SHAPE_NAMES, MAP_SITES, MAP_SITE_CATS, MAP_SITE_NAMES, MAP_HUB } from './shapes.js?v=3badc3b098';

const TAU = Math.PI * 2;
const TIERS = {
  low:  { cells: .55, dpr: 1.5, glow: false, maxDots: 1500, arcs: 1, fieldStep: 30 },
  mid:  { cells: .8,  dpr: 2,   glow: true,  maxDots: 2800, arcs: 3, fieldStep: 26 },
  high: { cells: 1,   dpr: 2,   glow: true,  maxDots: 3600, arcs: 4, fieldStep: 24 }
};
const TOKENS = {
  red: ['--red', '#FF4A22'], cyan: ['--cyan', '#00D4FF'], gold: ['--gold', '#FFB800'], paper: ['--paper', '#F8F9FA'],
  teal: ['--teal', '#007A7A'], ink: ['--ink', '#0E1E1E'], fg: ['--fg', '#0E1E1E']
};
const CAT_TOKEN = { food: 'red', health: 'cyan', opportunities: 'gold', infrastructure: 'infra' };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapPI = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash2(a, b) { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }
function strSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return; styleInjected = true;
  const st = document.createElement('style');
  st.id = 'dots-style';
  st.textContent = `:where(.dots){position:relative;display:block}
.dots>canvas.dots-canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none}
.dots>.dots-site,.dots>.dots-hub{position:absolute;width:2px;height:2px;margin:-1px 0 0 -1px;pointer-events:none}
.dots>.dots-probe{position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;transition:none!important;animation:none!important}`;
  document.head.appendChild(st);
}

const fontCache = new Map();
function loadFont() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  if (!fontCache.has('d')) {
    fontCache.set('d', Promise.race([
      document.fonts.load('700 100px "Space Grotesk"').catch(() => {}),
      new Promise(r => setTimeout(r, 1500))
    ]));
  }
  return fontCache.get('d');
}

/* ------------------------------------------------------------------ */
/*  Sampling: shape -> dot targets                                    */
/* ------------------------------------------------------------------ */
let maskCanvas = null, maskCtx = null;
function getMask(w, h) {
  if (!maskCanvas) { maskCanvas = document.createElement('canvas'); maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true }); }
  if (maskCanvas.width !== w || maskCanvas.height !== h) { maskCanvas.width = w; maskCanvas.height = h; }
  return maskCtx;
}

function sampleShape(shape, W, H, opt) {
  // fitted box
  let bw, bh, ox, oy, aspect = shape.aspect;
  if (shape.cover) { bw = W; bh = H; ox = 0; oy = 0; aspect = W / H; }
  else {
    const pad = Math.max(6, Math.min(W, H) * .045);
    const aw = Math.max(10, W - pad * 2), ah = Math.max(10, H - pad * 2);
    bh = Math.min(ah, aw / aspect); bw = bh * aspect;
    ox = opt.align === 'left' ? pad : opt.align === 'right' ? W - pad - bw : (W - bw) / 2;
    oy = (H - bh) / 2;
  }
  const unit = bh / 100;
  const S = { w: 100 * aspect, h: 100 };

  let step;
  if (shape.cover) step = opt.fieldStep / Math.sqrt(opt.density);
  else {
    // bigger illustrations get a finer lattice (more, smaller dots) so silhouettes stay crisp
    const grow = clamp(Math.sqrt(bw * bh) / 260, 1, 2.1);
    step = clamp(Math.sqrt((bw * bh) / ((shape.cells || 2300) * grow * opt.density * opt.cells)), shape.minStep || 4.6, shape.maxStep || 18);
  }

  // rasterise every drawn layer once
  const ms = Math.min(1, 1200 / Math.max(bw, bh));
  const mw = Math.max(2, Math.ceil(bw * ms)), mh = Math.max(2, Math.ceil(bh * ms));
  const masks = shape.layers.map(L => {
    if (!L.draw) return null;
    const c = getMask(mw, mh);
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, mw, mh);
    c.setTransform(ms * unit, 0, 0, ms * unit, 0, 0);
    c.fillStyle = '#000'; c.strokeStyle = '#000';
    c.save(); L.draw(c, S); c.restore();
    if (L.holes) { c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.strokeStyle = '#000'; L.holes(c, S); c.restore(); }
    const data = c.getImageData(0, 0, mw, mh).data;
    const a = new Uint8Array(mw * mh);
    for (let i = 0, j = 3; i < a.length; i++, j += 4) a[i] = data[j];
    return a;
  });
  const inMask = (li, x, y) => {
    const a = masks[li]; if (!a) return false;
    const mx = Math.round(x * ms), my = Math.round(y * ms);
    if (mx < 0 || my < 0 || mx >= mw || my >= mh) return false;
    return a[my * mw + mx] >= 128;
  };

  const r = rng(opt.seed);
  const out = [];
  const push = (li, x, y, edge, extra) => {
    out.push(Object.assign({ L: li, hx: ox + x, hy: oy + y, ux: x / unit, uy: y / unit, e: edge, k: r() }, extra));
  };

  // offset grid, centred in the box (same lattice as the Open Ledger map)
  const rows = Math.floor(bh / step), cols = Math.floor(bw / step);
  const gx0 = (bw - (cols - .5) * step) / 2 + step * .0, gy0 = (bh - (rows - 1) * step) / 2;
  const drawn = shape.layers.map((L, i) => (L.draw ? i : -1)).filter(i => i >= 0);
  if (drawn.length) {
    const nb = [[step, 0], [-step, 0], [step / 2, step], [-step / 2, step], [step / 2, -step], [-step / 2, -step]];
    for (let j = 0; j < rows; j++) {
      const y = gy0 + j * step, off = (j % 2) ? step / 2 : 0;
      for (let i = 0; i < cols; i++) {
        const x = gx0 + i * step + off;
        let hit = -1;
        for (let q = drawn.length - 1; q >= 0; q--) if (inMask(drawn[q], x, y)) { hit = drawn[q]; break; }
        if (hit < 0) continue;
        let edge = false;
        for (let n = 0; n < 6 && !edge; n++) if (!inMask(hit, x + nb[n][0], y + nb[n][1])) edge = true;
        push(hit, x, y, edge);
      }
    }
  }
  shape.layers.forEach((L, li) => {
    if (!L.pts) return;
    L.pts(step / unit, S).forEach(p => {
      const extra = { s3: p.s3 };
      if (p.u != null) extra.u = p.u;
      if (p.k != null) extra.kk = p.k;
      push(li, p.x * unit, p.y * unit, true, extra);
    });
  });

  // per-layer normalised parameters: u (along axis), v (top->bottom), centroid
  const meta = shape.layers.map(() => ({ minU: 1e9, maxU: -1e9, minV: 1e9, maxV: -1e9, cx: 0, cy: 0, n: 0 }));
  out.forEach(d => {
    const L = shape.layers[d.L], m = meta[d.L], ax = L.axis || [1, 0];
    const al = Math.hypot(ax[0], ax[1]) || 1;
    d.pu = (d.hx * ax[0] + d.hy * ax[1]) / al;
    m.minU = Math.min(m.minU, d.pu); m.maxU = Math.max(m.maxU, d.pu);
    m.minV = Math.min(m.minV, d.hy); m.maxV = Math.max(m.maxV, d.hy);
    m.cx += d.hx; m.cy += d.hy; m.n++;
  });
  meta.forEach(m => { if (m.n) { m.cx /= m.n; m.cy /= m.n; } });
  const cx = ox + bw / 2, cy = oy + bh / 2;
  out.forEach(d => {
    const m = meta[d.L];
    if (d.u == null) d.u = (d.pu - m.minU) / Math.max(1e-6, m.maxU - m.minU);
    d.v = (d.hy - m.minV) / Math.max(1e-6, m.maxV - m.minV);
    d.ang = Math.atan2(d.hy - cy, d.hx - cx);
    d.dn = Math.hypot(d.hx - cx, d.hy - cy) / (Math.hypot(bw, bh) / 2);
    d.dg = ((d.hx - ox) / bw + (d.hy - oy) / bh) / 2;
    d.kc = hash2(Math.floor(d.ux / 7), Math.floor(d.uy / 9)); // cluster seed (windows, nodes)
    if (d.kk != null) d.k = d.kk;
  });
  return { dots: out, step, unit, box: { ox, oy, bw, bh, cx, cy }, meta };
}

/* ------------------------------------------------------------------ */
/*  One mounted illustration                                          */
/* ------------------------------------------------------------------ */
class DotField {
  constructor(el, mgr, root) {
    this.el = el; this.mgr = mgr; this.root = root;
    this.reduced = mgr.reduced; this.tier = mgr.T;
    this.shapeName = (el.dataset.dotsSequence ? el.dataset.dotsSequence.split(',')[0] : el.dataset.dots || 'field').trim();
    this.originalShape = this.shapeName;
    this.shape = getShape(this.shapeName) || getShape('field');
    this.seed = strSeed(this.shapeName + (el.id || '') + mgr.count++);
    this.rand = rng(this.seed ^ 0x9e3779b9);
    this.dots = []; this.dying = []; this.pins = []; this.arcs = []; this.waves = [];
    this.palette = []; this.layerPal = [];
    this.started = false; this.visible = false; this.startT = 0; this.lastArc = 0;
    this.W = 0; this.H = 0; this.dark = false; this.colorDirtyUntil = 0; this.frameN = 0;
    this.triggers = []; this.observers = [];
    this.amp = clamp(parseFloat(el.dataset.dotsAmp || '1') || 1, .2, 3);

    el.classList.add('dots-mounted');
    if (!el.hasAttribute('aria-label') && !el.hasAttribute('role')) el.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dots-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
    this.probe = document.createElement('span'); this.probe.className = 'dots-probe'; this.probe.style.transition = 'none'; this.probe.setAttribute('aria-hidden', 'true');
    el.prepend(this.probe); el.prepend(this.canvas);
    el.__dots = this;

    // size: CORE's .dots uses aspect-ratio: var(--ar, 1). Give it the shape's own ratio unless the author set one.
    if (this.shape.aspect && !getComputedStyle(el).getPropertyValue('--ar').trim()) el.style.setProperty('--ar', String(+this.shape.aspect.toFixed(4)));
    if (el.offsetHeight < 4 && this.shape.aspect) el.style.aspectRatio = String(this.shape.aspect);

    const ready = this.shape.needsFont || this.needsFontAny() ? loadFont() : Promise.resolve();
    ready.then(() => { if (this.dead) return; this.layout(true); this.observe(); });
  }

  needsFontAny() {
    const seq = (this.el.dataset.dotsSequence || '').split(',');
    return seq.some(n => getShape(n)?.needsFont);
  }

  opts() {
    const el = this.el;
    return {
      density: clamp(parseFloat(el.dataset.dotsDensity || '1') || 1, .2, 3),
      cells: this.tier.cells, fieldStep: this.tier.fieldStep * (this.W < 600 ? .86 : 1),
      align: el.dataset.dotsAlign || 'center', seed: this.seed
    };
  }

  /* ---------- colours ---------- */
  read(value) {
    this.probe.style.color = '';
    this.probe.style.color = value;
    const m = getComputedStyle(this.probe).color.match(/[\d.]+/g) || [0, 0, 0];
    return [+m[0], +m[1], +m[2]];
  }
  token(name) {
    if (name === 'infra') return this.token(this.dark ? 'paper' : 'teal');
    if (name === 'trust') return this.token(this.dark ? 'cyan' : 'teal');
    if (name.startsWith('cat:')) return this.token(CAT_TOKEN[name.slice(4)] || 'red');
    const t = TOKENS[name]; if (!t) return this.read(name);
    return this.read(`var(${t[0]}, ${t[1]})`);
  }
  resolveColors() {
    const fg = this.read('var(--fg, #0E1E1E)');
    this.dark = (0.2126 * fg[0] + 0.7152 * fg[1] + 0.0722 * fg[2]) / 255 > .5;
    const attr = (this.el.dataset.dotsColor || '').trim();
    const mono = attr && attr !== 'multi';
    const base = mono ? this.token(attr) : fg;
    const accent = this.el.dataset.dotsAccent ? this.token(this.el.dataset.dotsAccent) : this.token(this.shape.accent || 'red');
    const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    this.shape.layers.forEach((L, i) => {
      let c;
      const tone = L.tone || 'base';
      if (tone === 'base' || tone === 'dim') c = base;
      else if (mono) c = base;
      else if (tone === 'accent') c = accent;
      else c = this.token(tone);
      const pi = this.layerPal[i];
      if (pi != null) this.palette[pi] = css(c);
    });
    this.catCol = {};
    for (const k in CAT_TOKEN) this.catCol[k] = css(this.token(CAT_TOKEN[k]));
    this.glowSprites = null; // rebuilt lazily
  }
  allocPalette() {
    this.layerPal = this.shape.layers.map(() => { this.palette.push('#000'); return this.palette.length - 1; });
  }
  glowSprite(col) {
    if (!this.glowSprites) this.glowSprites = new Map();
    let s = this.glowSprites.get(col);
    if (!s) {
      s = document.createElement('canvas'); s.width = s.height = 64;
      const g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, col); gr.addColorStop(.25, col.replace('rgb', 'rgba').replace(')', ',.45)'));
      gr.addColorStop(1, col.replace('rgb', 'rgba').replace(')', ',0)'));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      this.glowSprites.set(col, s);
    }
    return s;
  }

  /* ---------- geometry ---------- */
  layout(initial) {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (W < 4 || H < 4) return;
    const changed = Math.abs(W - this.W) > 1 || Math.abs(H - this.H) > 1;
    if (!changed && !initial) return;
    this.W = W; this.H = H;
    let dpr = Math.min(window.devicePixelRatio || 1, this.tier.dpr);
    while (W * H * dpr * dpr > 9e6 && dpr > 1) dpr -= .25;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (initial || !this.dots.length) {
      this.palette = []; this.allocPalette();
      this.resolveColors();
      this.build(this.shape);
      this.dots = this.target.dots.map(t => this.makeDot(t));
      this.scatter();
      if (this.reduced) this.settleAll();
    } else {
      this.retarget(this.shape, { instant: true });
    }
    this.updateTilt();
    this.buildPins();
    if (this.reduced || !this.visible) this.render(this.mgr.now());
  }

  build(shape) {
    const o = this.opts();
    let res = sampleShape(shape, this.W, this.H, o);
    let guard = 0;
    const maxD = this.tier.maxDots * (shape.dotsMul || 1);
    while (res.dots.length > maxD && guard++ < 4) {
      o.density *= (maxD / res.dots.length) * .96;
      res = sampleShape(shape, this.W, this.H, o);
    }
    this.target = res;
    this.step = res.step;
    this.hasOrbit = shape.layers.some(L => [].concat(L.anim || []).includes('orbit'));
  }

  makeDot(t) {
    const L = this.shape.layers[t.L], r = this.rand;
    const flat = L.edge === false || t.e;
    const a0 = (L.alpha ?? 1) * (flat ? 1 : (L.inner ?? .62)) * (1 - (L.jitter || 0) * r());
    const rf = L.r ?? this.shape.rFactor ?? .3;
    return Object.assign(t, {
      col: this.layerPal[t.L], layer: L, anims: [].concat(L.anim || []),
      a0, r0: this.step * rf * (flat ? 1 : .86) * (.9 + r() * .2),
      x: t.hx, y: t.hy, vx: 0, vy: 0, a: 0, on: false, delay: 0,
      ks: 64 * (.75 + r() * .5), rx: 0, ry: 0
    });
  }

  scatter() {
    const W = this.W, H = this.H, r = this.rand, field = this.shape.cover || this.el.dataset.dotsStart === 'instant';
    this.dots.forEach(d => {
      if (field) { d.rx = d.hx; d.ry = d.hy; }
      else { d.rx = r() * W; d.ry = r() * H; }
      d.x = d.rx; d.y = d.ry; d.a = 0; d.on = false; d.hold = false; d.prevCol = null;
    });
  }

  settleAll() { this.dots.forEach(d => { d.x = d.hx; d.y = d.hy; d.vx = d.vy = 0; d.on = true; d.a = d.a0; }); this.started = true; this.startT = -10; }

  assemble(now) {
    if (this.started) return;
    this.started = true;
    const extra = (parseFloat(this.el.dataset.dotsDelay || '0') || 0) / 1000;
    this.startT = now + extra;
    const mode = this.shape.kind === 'map' ? 'sweep' : this.shape.kind === 'field' ? 'radial' : 'radial';
    const r = this.rand;
    this.dots.forEach(d => {
      const order = mode === 'sweep' ? (d.hx / this.W) : d.dn;
      d.delay = this.startT + .06 + order * (mode === 'sweep' ? .9 : .55) + r() * .32;
    });
    this.pins.forEach((p, i) => { p.t0 = this.startT + 1.0 + (p.x / this.W) * .9 + (i % 5) * .03; });
    this.el.classList.add('dots-assembling');
    setTimeout(() => { if (!this.dead) { this.el.classList.add('dots-assembled'); this.el.dispatchEvent(new CustomEvent('dots:assembled', { bubbles: true })); } }, (extra + 1.6) * 1000);
  }

  // re-home the existing dots onto a new shape/size (morph)
  retarget(shape, { instant = false } = {}) {
    const now = this.mgr.now();
    const oldDots = this.dots.slice();
    this.shape = shape;
    this.allocPalette();
    this.resolveColors();
    this.build(shape);
    const next = this.target.dots.map(t => this.makeDot(t));
    const cx = this.target.box.cx, cy = this.target.box.cy;
    const keyOld = d => Math.atan2(d.y - cy, d.x - cx), keyNew = d => d.ang;
    oldDots.sort((a, b) => keyOld(a) - keyOld(b));
    const order = next.map((d, i) => i).sort((a, b) => keyNew(next[a]) - keyNew(next[b]));
    const used = new Uint8Array(oldDots.length);
    const nO = oldDots.length, nN = next.length;
    order.forEach((ni, rank) => {
      const d = next[ni];
      if (!nO) { d.x = d.hx; d.y = d.hy; d.a = 0; }
      else {
        const oi = Math.min(nO - 1, Math.floor(rank * nO / nN));
        const s = oldDots[oi];
        d.x = s.x; d.y = s.y; d.vx = s.vx; d.vy = s.vy;
        d.a = used[oi] ? 0 : s.a; d.prevCol = s.col; used[oi] = 1;
      }
      d.on = false; d.hold = true;
      d.delay = instant ? now : now + (rank / Math.max(1, nN)) * .32 + this.rand() * .18;
      d.swirl = instant ? 0 : 1;
    });
    // leftovers fade out where they are
    oldDots.forEach((s, i) => { if (!used[i]) { s.dying = true; this.dying.push(s); } });
    this.dots = next;
    if (!this.started) { this.scatter(); }
    if (this.reduced) this.settleAll();
    this.buildPins();
    if (this.started && !this.reduced) this.pins.forEach(p => (p.t0 = instant ? 0 : now + .6 + (p.x / this.W) * .6));
    // compact the palette later (once old colours are no longer needed)
    clearTimeout(this.compactT);
    this.compactT = setTimeout(() => this.compact(), 2500);
  }

  compact() {
    if (this.dead) return;
    this.dying = [];
    const map = new Map(); const pal = [];
    this.layerPal = this.layerPal.map(pi => { if (!map.has(pi)) { map.set(pi, pal.length); pal.push(this.palette[pi]); } return map.get(pi); });
    this.dots.forEach(d => { d.col = map.has(d.col) ? map.get(d.col) : this.layerPal[d.L]; d.prevCol = null; });
    this.palette = pal;
  }

  buildPins() {
    this.pins = [];
    this.anchors?.forEach(a => a.remove());
    this.anchors = [];
    if (this.shape.kind !== 'map') return;
    const { ox, oy, bh } = this.target.box, unit = bh / 100;
    const hidden = this.el.dataset.dotsSites === 'off';
    const r = rng(this.seed ^ 77);
    MAP_SITES.forEach(([ux, uy], i) => {
      const x = ox + ux * unit, y = oy + uy * unit, cat = MAP_SITE_CATS[i];
      const s = (i < 10 ? 1.2 : i < 26 ? 1 : .86) * (.94 + r() * .12); // bigger metros, bigger marks
      this.pins.push({ x, y, cat, s, i, hidden, per: 3.4 + r() * 2.6, ph: r() * 6, t0: this.started ? 0 : 1e9, lit: null, litOn: false });
      const a = document.createElement('span');
      a.className = i === MAP_HUB ? 'dots-site dots-hub' : 'dots-site';
      a.dataset.cat = cat; a.dataset.site = String(i); a.setAttribute('aria-hidden', 'true');
      this.el.appendChild(a); this.anchors.push(a);
    });
    this.placeAnchors(true);
    this.lastArc = 0; this.arcs = [];
  }

  /* ---------- soft 3D tilt (map only) ---------- */
  tiltTarget() {
    const on = this.shape.kind === 'map' && this.el.dataset.dotsTilt !== 'off';
    if (!on) return [0, 0];
    let a = .2, b = 0; // ~11.5deg back
    const P = this.mgr.pointer;
    if (P.active && !this.reduced) {
      const rc = this.canvas.getBoundingClientRect();
      const nx = clamp((P.x - rc.left) / rc.width * 2 - 1, -1.4, 1.4), ny = clamp((P.y - rc.top) / rc.height * 2 - 1, -1.4, 1.4);
      a += ny * .04; b = nx * .055;
    }
    return [a, b];
  }
  updateTilt(dt) {
    const [ta, tb] = this.tiltTarget();
    if (!this.tilt) this.tilt = { a: ta, b: tb };
    const e = dt == null ? 1 : Math.min(1, dt * 3);
    this.tilt.a += (ta - this.tilt.a) * e; this.tilt.b += (tb - this.tilt.b) * e;
    const T = this.tilt, on = Math.abs(T.a) > 1e-4 || Math.abs(T.b) > 1e-4;
    const box = this.target ? this.target.box : { cx: this.W / 2, cy: this.H / 2 };
    const P = this.P || (this.P = {});
    P.on = on; P.cx = box.cx; P.cy = box.cy; P.ca = Math.cos(T.a); P.sa = Math.sin(T.a); P.cb = Math.cos(T.b); P.sb = Math.sin(T.b);
    P.D = Math.max(this.W, this.H) * 1.5; P.k = 1 - .9 * Math.abs(Math.sin(T.a)) * .25;
  }
  // home (layout) coords -> drawn coords. Writes [x, y, scale] into out.
  proj(x, y, out) {
    const P = this.P;
    if (!P || !P.on) { out[0] = x; out[1] = y; out[2] = 1; return out; }
    const dx = x - P.cx, dy = y - P.cy;
    const y1 = dy * P.ca, z = -dy * P.sa;
    const x1 = dx * P.cb + z * P.sb, z1 = -dx * P.sb + z * P.cb;
    const f = P.D / (P.D + z1) * P.k;
    out[0] = P.cx + x1 * f; out[1] = P.cy + y1 * f; out[2] = f;
    return out;
  }
  placeAnchors(force) {
    if (!this.anchors?.length) return;
    const o = this._pa || (this._pa = [0, 0, 1]);
    this.pins.forEach((p, i) => {
      const a = this.anchors[i]; if (!a) return;
      this.proj(p.x, p.y, o);
      if (!force && Math.abs(o[0] - (p.ax ?? -1e9)) < .3 && Math.abs(o[1] - (p.ay ?? -1e9)) < .3) return;
      p.ax = o[0]; p.ay = o[1];
      a.style.left = (o[0] / this.W * 100) + '%'; a.style.top = (o[1] / this.H * 100) + '%';
    });
  }

  /* ---------- site API (map only) ---------- */
  siteScreenPositions() {
    if (this.shape.kind !== 'map' || !this.pins.length) return [];
    const rc = this.canvas.getBoundingClientRect(), sx = rc.width / (this.W || 1), sy = rc.height / (this.H || 1), o = [0, 0, 1];
    return this.pins.map(p => {
      this.proj(p.x, p.y, o);
      return { index: p.i, name: MAP_SITE_NAMES[p.i], cat: p.cat, color: this.catCol[p.cat], x: rc.left + o[0] * sx, y: rc.top + o[1] * sy };
    });
  }
  lightSite(index, color) {
    const p = this.pins.find(q => q.i === index); if (!p) return null;
    let col = this.catCol[p.cat];
    if (color) col = this.catCol[color] || `rgb(${(TOKENS[color] || color === 'infra' ? this.token(color) : this.read(color)).map(v => v | 0).join(',')})`;
    const now = this.mgr.now();
    p.lit = now; p.litOn = true; p.litCol = col;
    if (p.t0 > now) p.t0 = now - 1;
    if (!this.reduced) this.waves.push({ x: p.x, y: p.y, t0: now, life: 1.6, amp: .9, speed: Math.max(this.W, this.H) * .3 });
    this.mgr.schedule(this);
    if (this.reduced) this.render(now);
    const pos = this.siteScreenPositions()[this.pins.indexOf(p)];
    return pos ? { x: pos.x, y: pos.y } : null;
  }

  /* ---------- observers / triggers ---------- */
  observe() {
    const el = this.el;
    if ('IntersectionObserver' in window) {
      const run = new IntersectionObserver(es => {
        es.forEach(e => {
          if (e.isIntersecting && !this.visible) { this.resolveColors(); this.lastColor = this.mgr.now(); }
          this.visible = e.isIntersecting;
        });
        this.mgr.schedule(this);
      }, { rootMargin: '140px 0px' });
      run.observe(el); this.observers.push(run);
      const trig = new IntersectionObserver(es => {
        es.forEach(e => {
          if (!e.isIntersecting) return;
          const need = Math.min(.22, (innerHeight * .45) / Math.max(1, e.boundingClientRect.height));
          if (e.intersectionRatio >= need - .001) { this.assemble(this.mgr.now()); trig.disconnect(); this.mgr.schedule(this); }
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: [0, .05, .1, .15, .22] });
      trig.observe(el); this.observers.push(trig);
    } else { this.visible = true; this.assemble(this.mgr.now()); this.mgr.schedule(this); }

    if ('ResizeObserver' in window) {
      let raf = 0;
      const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => !this.dead && this.layout(false)); });
      ro.observe(el); this.observers.push(ro);
    }
    this.bindScroll();
  }

  bindScroll() {
    const el = this.el, ST = window.ScrollTrigger;
    const trigSel = el.dataset.dotsTrigger;
    const trigger = (trigSel && (this.root.querySelector(trigSel) || document.querySelector(trigSel))) || el.closest('section') || el;
    if (el.dataset.dotsSequence) {
      const list = el.dataset.dotsSequence.split(',').map(s => s.trim()).filter(Boolean);
      if (ST && list.length > 1) {
        let cur = 0;
        this.triggers.push(ST.create({
          trigger, start: 'top 60%', end: 'bottom 40%',
          onUpdate: self => {
            const idx = Math.min(list.length - 1, Math.floor(self.progress * list.length));
            if (idx !== cur) { cur = idx; this.morph(list[idx]); }
          },
          onRefresh: self => {
            const idx = Math.min(list.length - 1, Math.floor(self.progress * list.length));
            if (idx !== cur) { cur = idx; this.morph(list[idx]); }
          }
        }));
      }
    }
    if (el.hasAttribute('data-dots-steps')) {
      const steps = [...trigger.querySelectorAll('[data-dots-step]')];
      if (ST && steps.length) {
        // One trigger over the whole steps range: the active step is the last one whose top
        // has crossed the reading line (62% of the viewport). Robust to scroll jumps, which
        // per-step onToggle triggers miss (a jump straight past a step never toggles it).
        let cur = null;
        const pick = () => {
          if (this.dead) return;
          const line = innerHeight * .62;
          let name = this.originalShape;
          for (const s of steps) if (s.getBoundingClientRect().top <= line) name = s.dataset.dotsStep; else break;
          if (name !== cur) { cur = name; this.morph(name); }
        };
        this.triggers.push(ST.create({
          trigger: steps[0], endTrigger: steps[steps.length - 1],
          start: 'top bottom', end: 'bottom top',
          onUpdate: pick, onToggle: pick, onRefresh: pick
        }));
      } else if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && this.morph(e.target.dataset.dotsStep)), { rootMargin: '-38% 0px -38% 0px' });
        steps.forEach(s => io.observe(s)); this.observers.push(io);
      }
    }
  }

  morph(name) {
    const shape = getShape(name);
    if (!shape || shape === this.shape) return;
    this.shapeName = name;
    if (!this.W || !this.dots.length) { this.shape = shape; return; } // not laid out yet: layout() builds it
    const go = () => {
      if (this.dead) return;
      this.retarget(shape);
      if (!this.started) this.assemble(this.mgr.now());
      this.mgr.schedule(this);
      this.el.dispatchEvent(new CustomEvent('dots:morph', { bubbles: true, detail: { shape: name } }));
    };
    shape.needsFont ? loadFont().then(go) : go();
  }

  ripple(x, y, opts = {}) {
    if (this.reduced) return;
    const rect = this.canvas.getBoundingClientRect();
    this.waves.push({ x: x - rect.left, y: y - rect.top, t0: this.mgr.now(), life: opts.life || 1.8, amp: opts.amp || 1, speed: opts.speed || Math.max(this.W, this.H) * .55 });
    this.mgr.schedule(this);
  }

  destroy() {
    this.dead = true;
    this.observers.forEach(o => o.disconnect());
    this.triggers.forEach(t => t.kill && t.kill());
    clearTimeout(this.compactT);
    this.canvas.remove(); this.probe.remove();
    this.anchors?.forEach(a => a.remove());
    this.el.classList.remove('dots-mounted', 'dots-assembling', 'dots-assembled');
    delete this.el.__dots;
  }

  /* ---------- per-frame ---------- */
  frame(t, dt) {
    this.frameN++;
    if (t < this.colorDirtyUntil || t - (this.lastColor || 0) > .5) { this.resolveColors(); this.lastColor = t; }
    if (!this.reduced) this.step_(t, dt);
    if (this.tilt || this.shape.kind === 'map') this.updateTilt(this.reduced ? null : dt);
    this.render(t);
  }

  animate(d, t, out) {
    // out: [dx, dy, alphaMul, sizeMul, alphaAdd]
    const step = this.step;
    out[0] = 0; out[1] = 0; out[2] = 1; out[3] = 1; out[4] = 0;
    const st = this.reduced; // static frame: narrative anims hold a readable mid state
    for (let i = 0; i < d.anims.length; i++) {
      switch (d.anims[i]) {
        case 'shimmer': if (!st) out[2] *= .8 + .2 * Math.sin(t * 1.2 + d.k * 40); break;
        case 'breathe': { // a slow swell rolling west to east across the land
          if (st) break;
          const w = .5 + .5 * Math.sin(t * .55 - d.ux * .045 + d.uy * .015);
          out[2] *= .78 + .3 * w; out[3] *= .94 + .1 * w;
          break;
        }
        case 'rise': {
          const tt = 1 - d.v;
          const w = st ? .7 : .5 + .5 * Math.sin(tt * 8.5 - t * 3.2 + d.kc * .8);
          out[2] *= (.3 + .7 * w) * (1 - smooth(.72, 1, tt) * .75);
          if (!st) { out[0] += Math.sin(t * 1.3 + d.uy * .16) * step * .4 * tt; out[1] -= w * step * .3; }
          break;
        }
        case 'beat': {
          if (st) break;
          const p = (t % 1.5) / 1.5;
          const b = Math.exp(-Math.pow((p - .06) / .045, 2)) + .55 * Math.exp(-Math.pow((p - .22) / .05, 2));
          const m = this.target.meta[d.L];
          out[0] += (d.hx - m.cx) * .055 * b; out[1] += (d.hy - m.cy) * .055 * b;
          out[4] += .25 * b; out[3] *= 1 + .14 * b;
          break;
        }
        case 'orbit': {
          const head = st ? -2.2 : t * 1.05;
          const dd = wrapPI(d.ang - head);
          const g = dd > 0 ? Math.exp(-dd * dd * 40) : Math.exp(dd * 1.6);
          out[2] *= .45 + .55 * g; out[3] *= 1 + .22 * g;
          break;
        }
        case 'node': {
          if (st) break;
          const m = this.target.meta[d.L];
          let pulse;
          if (this.hasOrbit) {
            const na = Math.atan2(m.cy - this.target.box.cy, m.cx - this.target.box.cx);
            const dd = wrapPI(t * 1.05 - na);
            pulse = dd > 0 ? Math.exp(-dd * 3.2) : Math.exp(-dd * dd * 60);
          } else pulse = Math.pow(.5 + .5 * Math.sin(t * 1.5 + d.kc * TAU), 3);
          if (this.hasOrbit) { out[0] += (d.hx - m.cx) * .16 * pulse; out[1] += (d.hy - m.cy) * .16 * pulse; }
          out[4] += .2 * pulse; out[3] *= 1 + .18 * pulse;
          break;
        }
        case 'flow': {
          if (st) break;
          const p = ((t * .3 + (d.L * .37)) % 1.5) - .25;
          const g = Math.exp(-Math.pow((d.u - p) / .13, 2));
          out[2] *= .72 + .28 * g; out[4] += .35 * g; out[3] *= 1 + .3 * g;
          break;
        }
        case 'twinkle': {
          if (st) break;
          const w = .5 + .5 * Math.sin(t * (.35 + d.kc * .7) + d.kc * 50);
          out[2] *= .2 + .8 * smooth(.3, .62, w);
          break;
        }
        case 'fall': {
          if (st) break;
          const w = .5 + .5 * Math.sin(d.v * 12 - t * 7);
          out[2] *= .25 + .75 * w * w;
          break;
        }
        case 'wander': {
          if (st) break;
          out[0] += (Math.sin(t * .75) * 1.0 + Math.sin(t * 1.7) * .3) * step;
          out[1] += Math.sin(t * 1.05 + 1) * .8 * step;
          break;
        }
        case 'glint': {
          if (st) break;
          const p = ((t * .26) % 1.7) - .35;
          const g = Math.exp(-Math.pow((d.dg - p) / .06, 2));
          out[4] += .55 * g; out[3] *= 1 + .35 * g;
          break;
        }
        case 'eat': {
          const half = st ? .62 : .22 + .95 * (.5 - .5 * Math.cos(t * .7));
          const ins = smooth(half + .1, half - .1, Math.abs(d.ang));
          out[2] *= 1 - .94 * ins; out[3] *= 1 - .35 * ins;
          out[0] += Math.cos(d.ang) * ins * step * 1.6; out[1] += Math.sin(d.ang) * ins * step * 1.6;
          break;
        }
        case 'crumbs': {
          const half = st ? .62 : .22 + .95 * (.5 - .5 * Math.cos(t * .7));
          const ph = st ? d.k : (t * .32 + d.k) % 1;
          const vis = Math.abs(d.ang) < half ? 1 : 0;
          out[2] *= (1 - ph) * vis * smooth(.15, .5, half);
          out[0] += Math.cos(d.ang) * ph * step * 3.2; out[1] += Math.sin(d.ang) * ph * step * 3.2 + ph * ph * step * 3;
          break;
        }
        case 'type': {
          if (st) break;
          const line = Math.round(d.uy / 4);
          const c = ((t * .28 + hash2(line, 3) * 1.3) % 1.6);
          out[2] *= d.u < c ? 1 : .22;
          if (Math.abs(d.u - c) < .05) out[4] += .4;
          break;
        }
        case 'fade': {
          // relief that wears off: the bandage dissolves from one end, then re-applies.
          // Never fully gone (floor .2) and the static frame is barely touched, so it always reads.
          const P = 7, ph = st ? .36 : (t % P) / P;
          let vis;
          if (ph < .4) vis = 1;
          else if (ph < .78) { const front = 1.15 - 1.0 * ((ph - .4) / .38); vis = 1 - smooth(front - .14, front + .14, d.u); }
          else vis = smooth(.8, .96, ph);
          out[2] *= .2 + .8 * vis;
          out[1] += (1 - vis) * step * 1.4; out[0] += (1 - vis) * step * .8 * Math.sin(d.k * 20);
          break;
        }
        case 'edgeflow': {
          if (st) break;
          const p = ((t * .42 + d.k * 3.1) % 1.6) - .3;
          const g = Math.exp(-Math.pow((d.u - p) / .1, 2));
          out[4] += .7 * g; out[3] *= 1 + .5 * g;
          break;
        }
        case 'spin3d': {
          const s = d.s3; if (!s) break;
          const a = st ? .6 : t * .32, tl = .38;
          const x1 = s[0] * Math.cos(a) + s[2] * Math.sin(a), z1 = -s[0] * Math.sin(a) + s[2] * Math.cos(a);
          const y2 = s[1] * Math.cos(tl) - z1 * Math.sin(tl), z2 = s[1] * Math.sin(tl) + z1 * Math.cos(tl);
          const R = 46 * this.target.unit, b = this.target.box;
          out[0] += b.ox + 50 * this.target.unit + x1 * R - d.hx;
          out[1] += b.oy + 50 * this.target.unit + y2 * R - d.hy;
          const depth = (z2 + 1) / 2;
          out[2] *= .05 + .95 * Math.pow(depth, 2.2); out[3] *= .5 + .6 * depth;
          break;
        }
        case 'ripple': break; // handled by waves
      }
    }
    // data-dots-amp="1.6": the same motion, drawn bigger (moves, swells and glows read from further away)
    const A = this.amp;
    if (A !== 1 && !st) {
      out[0] *= A; out[1] *= A; out[4] *= A;
      out[2] = clamp(1 - (1 - out[2]) * A, out[2] * .55, 1.4);
      out[3] = Math.max(.2, 1 + (out[3] - 1) * A);
    }
  }

  step_(t, dt) {
    const W = this.W, H = this.H, step = this.step, field = this.shape.kind === 'field';
    // pointer
    const P = this.mgr.pointer;
    let px = -1e6, py = -1e6, R = clamp(step * 10, 70, 130);
    if (P.active && !field) { const rc = this.canvas.getBoundingClientRect(); px = P.x - rc.left; py = P.y - rc.top; }
    let fpx = -1e6, fpy = -1e6;
    if (P.active && field) { const rc = this.canvas.getBoundingClientRect(); fpx = P.x - rc.left; fpy = P.y - rc.top; }
    // ambient waves for fields
    if (field && this.started && t > this.startT && t - (this.lastWave || 0) > 2.6) {
      this.lastWave = t;
      this.waves.push({ x: W * (.15 + this.rand() * .7), y: H * (.2 + this.rand() * .6), t0: t, life: 3.2, amp: .8, speed: Math.max(W, H) * .32 });
    }
    this.waves = this.waves.filter(w => t - w.t0 < w.life);
    const waves = this.waves;

    const out = this._out || (this._out = [0, 0, 1, 1, 0]);
    const sub = Math.min(8, Math.max(1, Math.ceil(dt * 60 - .2))), h = dt / sub; // fixed-ish 60Hz substeps: real-time on slow devices
    const zeta = .5;
    for (let i = 0, n = this.dots.length; i < n; i++) {
      const d = this.dots[i];
      let tx, ty, ta;
      if (!this.started || t < d.delay) {
        if (d.hold) { tx = d.x; ty = d.y; ta = d.a; }           // morph: wait in the old shape
        else {                                                   // at rest: a faint drifting scatter
          tx = d.rx + Math.sin(t * .3 + d.k * 9) * 10; ty = d.ry + Math.cos(t * .26 + d.k * 7) * 10;
          ta = (field ? 0 : .1 + .06 * Math.sin(t + d.k * 20)) * Math.min(1, d.a0 * 2);
        }
      } else {
        if (!d.on) {
          d.on = true; d.hold = false; d.prevCol = null;
          const dx = d.hx - d.x, dy = d.hy - d.y, sw = (d.swirl ?? 1) * (this.rand() - .5) * 2.4;
          d.vx += -dy * sw; d.vy += dx * sw;
        }
        this.animate(d, t, out);
        tx = d.hx + out[0]; ty = d.hy + out[1];
        if (!field && d.anims[0] !== 'spin3d') { tx += Math.sin(t * .9 + d.k * 12) * step * .13; ty += Math.cos(t * .7 + d.k * 17) * step * .13; }
        ta = clamp(d.a0 * out[2] + out[4], 0, 1);
        d.sm = out[3];
        // waves
        for (let w = 0; w < waves.length; w++) {
          const wv = waves[w], age = t - wv.t0, rad = age * wv.speed;
          const ddx = d.hx - wv.x, ddy = d.hy - wv.y, dist = Math.hypot(ddx, ddy) || 1;
          const g = Math.exp(-Math.pow((dist - rad) / (step * 2.2), 2)) * (1 - age / wv.life) * wv.amp;
          if (g > .01) {
            tx += ddx / dist * g * step * (field ? .5 : 1.4); ty += ddy / dist * g * step * (field ? .5 : 1.4) - (field ? g * step * .3 : 0);
            ta = clamp(ta + g * (field ? .5 : .35), 0, 1); d.sm *= 1 + g * (field ? 1.8 : .5);
          }
        }
        // pointer
        if (px > -1e5) {
          const ddx = tx - px, ddy = ty - py, dist = Math.hypot(ddx, ddy);
          if (dist < R && dist > .01) { const f = 1 - dist / R, push = f * f * R * .42; tx += ddx / dist * push; ty += ddy / dist * push; ta = clamp(ta + f * .25, 0, 1); }
        }
        if (fpx > -1e5) {
          const dist = Math.hypot(d.hx - fpx, d.hy - fpy), g = Math.exp(-Math.pow(dist / 130, 2));
          ta = clamp(ta + g * .55, 0, 1); d.sm *= 1 + g * 1.6;
          if (dist > .01 && dist < 160) { const f = 1 - dist / 160; tx += (d.hx - fpx) / dist * f * f * 14; ty += (d.hy - fpy) / dist * f * f * 14; }
        }
      }
      // spring
      const k = d.ks, c = 2 * zeta * Math.sqrt(k);
      for (let s = 0; s < sub; s++) {
        d.vx += (k * (tx - d.x) - c * d.vx) * h; d.vy += (k * (ty - d.y) - c * d.vy) * h;
        d.x += d.vx * h; d.y += d.vy * h;
      }
      d.a += (ta - d.a) * Math.min(1, dt * (d.on ? 5 : 3));
    }
    // fading leftovers from a morph
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.a += (0 - d.a) * Math.min(1, dt * 4); d.x += d.vx * dt * .3; d.y += d.vy * dt * .3; d.vx *= .95; d.vy *= .95;
      if (d.a < .01) this.dying.splice(i, 1);
    }
    // map arcs
    if (this.pins.length && this.el.dataset.dotsArcs !== 'off' && this.started && t > this.startT + 2.2) {
      if (this.arcs.length < this.tier.arcs && t - this.lastArc > .55) {
        this.lastArc = t;
        const vis = this.pins.filter(p => !p.hidden);
        const a = vis[(this.rand() * vis.length) | 0];
        const near = !a ? [] : vis.filter(p => p !== a && Math.hypot(p.x - a.x, p.y - a.y) > this.W * .07 && Math.hypot(p.x - a.x, p.y - a.y) < this.W * .36);
        if (near.length) {
          const b = near[(this.rand() * near.length) | 0];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          this.arcs.push({ a, b, t0: t, dur: 1.4 + len / this.W * 2.2, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 - len * .3 });
        }
      }
      this.arcs = this.arcs.filter(r => {
        if (t - r.t0 > r.dur + .5) { r.b.hit = t; return false; }
        return true;
      });
    }
  }

  render(t) {
    const ctx = this.ctx, W = this.W, H = this.H;
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    const reduced = this.reduced;
    const pal = this.palette, nb = pal.length * 13;
    if (!this.buckets || this.buckets.length < nb) this.buckets = Array.from({ length: nb }, () => []);
    const B = this.buckets;
    for (let i = 0; i < nb; i++) B[i].length = 0;
    const out = this._out || (this._out = [0, 0, 1, 1, 0]);
    const all = this.dying.length ? this.dots.concat(this.dying) : this.dots;
    const tilted = !!(this.P && this.P.on), pp = this._pp || (this._pp = [0, 0, 1]);
    for (let i = 0; i < all.length; i++) {
      const d = all[i];
      if (reduced) { // static frame
        this.animate(d, 0, out);
        d.x = d.hx + out[0]; d.y = d.hy + out[1]; d.a = clamp(d.a0 * out[2] + out[4], 0, 1); d.sm = out[3];
      }
      if (d.a < .012) continue;
      const q = Math.min(12, Math.round(d.a * 12));
      if (!q) continue;
      const col = d.prevCol != null ? d.prevCol : d.col;
      const bk = B[col * 13 + q]; if (bk) bk.push(d);
    }
    for (let ci = 0; ci < pal.length; ci++) {
      ctx.fillStyle = pal[ci];
      for (let q = 1; q <= 12; q++) {
        const arr = B[ci * 13 + q]; if (!arr.length) continue;
        ctx.globalAlpha = q / 12;
        ctx.beginPath();
        for (let j = 0; j < arr.length; j++) {
          const d = arr[j];
          let r = d.on || reduced ? d.r0 * (d.sm || 1) : d.r0 * .8, x = d.x, y = d.y;
          if (tilted) { this.proj(x, y, pp); x = pp[0]; y = pp[1]; r *= pp[2]; }
          ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
        }
        ctx.fill();
      }
    }
    // glow for accent layers on dark backgrounds
    if (this.dark && this.tier.glow && !reduced) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.dots.length; i++) {
        const d = this.dots[i];
        if (!d.layer.glow || d.a < .3 || !d.on) continue;
        let gr = d.r0 * 4.2 * (d.sm || 1), x = d.x, y = d.y;
        if (tilted) { this.proj(x, y, pp); x = pp[0]; y = pp[1]; gr *= pp[2]; }
        ctx.globalAlpha = d.a * .13;
        ctx.drawImage(this.glowSprite(pal[d.col]), x - gr, y - gr, gr * 2, gr * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    if (this.pins.length) this.renderMap(t);
  }

  renderMap(t) {
    const ctx = this.ctx, reduced = this.reduced, step = this.step, o = this._pm || (this._pm = [0, 0, 1]);
    const base = clamp(step * .36, 1.8, 4.6);
    this.placeAnchors(false);
    // arcs (behind pins)
    if (!reduced) {
      this.arcs.forEach(r => {
        const p = (t - r.t0) / r.dur;
        if (p < 0) return;
        const col = this.catCol[r.a.cat];
        ctx.fillStyle = col;
        for (let s = 0; s < 14; s++) {
          const u = p - s * .022; if (u < 0 || u > 1) continue;
          const fade = 1 - s / 14, endFade = p > 1 ? Math.max(0, 1 - (p - 1) * 2.5) : 1;
          this.proj((1 - u) * (1 - u) * r.a.x + 2 * (1 - u) * u * r.mx + u * u * r.b.x,
            (1 - u) * (1 - u) * r.a.y + 2 * (1 - u) * u * r.my + u * u * r.b.y, o);
          ctx.globalAlpha = .8 * fade * endFade;
          ctx.beginPath(); ctx.arc(o[0], o[1], Math.max(.7, base * .4 * (1 - s / 18) * o[2]), 0, TAU); ctx.fill();
        }
      });
    }
    const dark = this.dark;
    this.pins.forEach(p => {
      const age = reduced ? 9 : t - p.t0;
      if (age < 0 || (p.hidden && !p.litOn)) return;
      const ap = clamp(age / .55, 0, 1);
      const sc = ap < 1 ? 1 + 2.70158 * Math.pow(ap - 1, 3) + 1.70158 * Math.pow(ap - 1, 2) : 1; // easeOutBack
      const col = p.litCol || this.catCol[p.cat];
      const la = p.lit == null || reduced ? 9 : t - p.lit;          // seconds since lightSite()
      const flash = la < 2.4 ? Math.exp(-la * 2.4) : 0;
      const breathe = reduced ? 1 : 1 + .09 * Math.sin(t * 1.5 + p.ph * 3);
      this.proj(p.x, p.y, o);
      const x = o[0], y = o[1];
      const r = base * p.s * sc * o[2] * breathe * (1 + flash * .9 + (p.litOn ? .15 : 0));
      if (r <= 0) return;
      // soft halo
      if (this.tier.glow || flash > .01) {
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
        ctx.globalAlpha = Math.min(1, ((dark ? .3 : .16) * (p.litOn ? 1.5 : 1) + flash * .6) * ap);
        const g = r * (4 + flash * 5);
        ctx.drawImage(this.glowSprite(col), x - g, y - g, g * 2, g * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.strokeStyle = col;
      // breathing pulse ring, staggered per site
      if (!reduced) {
        const ph = ((t + p.ph) % p.per) / p.per;
        ctx.lineWidth = 1; ctx.globalAlpha = .55 * Math.pow(1 - ph, 1.6) * ap;
        ctx.beginPath(); ctx.arc(x, y, r * (1.5 + ph * 3.6), 0, TAU); ctx.stroke();
        // lightSite ripple: two expanding rings
        for (let q = 0; q < 2; q++) {
          const u = (la - q * .22) / 1.4; if (u <= 0 || u >= 1) continue;
          ctx.lineWidth = 1.6 - q * .5; ctx.globalAlpha = .9 * (1 - u) * (1 - u);
          ctx.beginPath(); ctx.arc(x, y, r * 1.4 + u * Math.max(26, step * 7), 0, TAU); ctx.stroke();
        }
        if (p.hit && t - p.hit < 1.2) {
          const h = (t - p.hit) / 1.2;
          ctx.lineWidth = 1; ctx.globalAlpha = .6 * (1 - h) * ap;
          ctx.beginPath(); ctx.arc(x, y, r * (1.6 + h * 3), 0, TAU); ctx.stroke();
        }
      } else {
        ctx.lineWidth = 1; ctx.globalAlpha = .38;
        ctx.beginPath(); ctx.arc(x, y, r * 2, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = ap;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (dark && (flash > .02 || p.litOn)) { // hot white core when lit
        ctx.globalAlpha = ap * Math.min(1, .35 + flash);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, r * .45, 0, TAU); ctx.fill();
      }
    });
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }
}

/* ------------------------------------------------------------------ */
/*  Manager                                                           */
/* ------------------------------------------------------------------ */
export class Dots {
  constructor({ tier = window.__tier || 'mid', reduced = false } = {}) {
    this.tier = TIERS[tier] ? tier : 'mid';
    this.T = TIERS[this.tier];
    this.reduced = !!reduced;
    this.count = 0;
    this.items = new Set();
    this.running = new Set();
    this.raf = 0; this.last = 0;
    this.pointer = { x: 0, y: 0, active: false };
    this.api = {
      morph: (el, s) => this.morph(el, s), ripple: (el, x, y, o) => this.ripple(el, x, y, o), shapes: SHAPE_NAMES,
      siteScreenPositions: el => this.siteScreenPositions(el), lightSite: (el, i, c) => this.lightSite(el, i, c)
    };
    this._tick = this._tick.bind(this);
    injectStyle();

    if (!this.reduced && matchMedia('(pointer: fine)').matches) {
      addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') { this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.active = true; } }, { passive: true });
      document.addEventListener('pointerleave', () => { this.pointer.active = false; });
      addEventListener('blur', () => { this.pointer.active = false; });
    }
    // CORE tweens the theme vars for ~1s; follow the colours every frame while it does.
    const onTheme = () => this.setTheme();
    ['themechange', 'dad:theme'].forEach(n => { document.addEventListener(n, onTheme); addEventListener(n, onTheme); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.items.forEach(it => this.schedule(it)); });
    // the coin landing on a map (or anything dotted) sends a shockwave through it
    let lastLand = 0;
    const onLand = e => {
      const { x, y } = e.detail || {}; if (x == null || e.timeStamp === lastLand) return;
      lastLand = e.timeStamp;
      this.items.forEach(it => {
        if (!it.visible) return;
        const r = it.el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) it.ripple(x, y, { amp: 1.2 });
      });
    };
    document.addEventListener('dollar:land', onLand); addEventListener('dollar:land', onLand);
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener?.('change', () => { this.reduced = mq.matches; this.items.forEach(it => { it.reduced = this.reduced; if (it.reduced) { it.settleAll(); it.render(this.now()); } this.schedule(it); }); });
  }

  now() { return performance.now() / 1000; }

  bind(root = document) {
    const els = root.querySelectorAll('[data-dots], [data-dots-sequence]');
    els.forEach(el => {
      if (el.__dots || el.hasAttribute('data-dots-step')) return;
      try { this.items.add(new DotField(el, this, root)); } catch (err) { console.warn('[dots] could not mount', el, err); }
    });
    return this;
  }

  unbind(root) {
    [...this.items].forEach(it => {
      if (root && !(root === it.root || root.contains(it.el))) return;
      it.destroy(); this.items.delete(it); this.running.delete(it);
    });
  }

  morph(el, shape) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return;
    if (el.__dots) el.__dots.morph(shape);
    else el.setAttribute('data-dots', shape);
  }

  ripple(el, x, y, opts) {
    if (typeof el === 'string') el = document.querySelector(el);
    const it = el && el.__dots; if (!it) return;
    if (x == null) { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    it.ripple(x, y, opts);
  }

  // Map sites, for the drop that "rains" onto them. el: a mounted map element (or selector).
  // Returns [{ index, name, cat, color, x, y }] in viewport (client) px, tilt included. [] if not a map.
  siteScreenPositions(el) {
    if (typeof el === 'string') el = document.querySelector(el);
    const it = el && el.__dots; return it ? it.siteScreenPositions() : [];
  }
  // Flash one site with expanding rings + a shockwave through the dots; it stays softly lit afterwards.
  // color: 'food' | 'health' | 'opportunities' | 'infrastructure' | a token ('red', 'gold'...) | any CSS colour.
  // Returns the site's viewport {x, y} (or null).
  lightSite(el, index, color) {
    if (typeof el === 'string') el = document.querySelector(el);
    const it = el && el.__dots; return it ? it.lightSite(index, color) : null;
  }

  refresh() { this.items.forEach(it => it.layout(false)); }

  // Contract alias: CORE's theme system may call dots.setTheme(theme) directly as well as
  // dispatching 'themechange' / 'dad:theme'. Either way the colours follow the tween.
  setTheme() {
    const until = this.now() + 1.5;
    this.items.forEach(it => { it.colorDirtyUntil = until; this.schedule(it); });
  }

  schedule(it) {
    const need = it.visible && !it.dead && !document.hidden && (!it.reduced || it.colorDirtyUntil > this.now());
    if (need) this.running.add(it); else this.running.delete(it);
    if (it.visible && it.reduced) it.render(this.now());
    if (this.running.size && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this._tick); }
  }

  _tick(ms) {
    this.raf = 0;
    if (document.hidden) return;
    const dt = clamp((ms - this.last) / 1000, 0, 1 / 8); this.last = ms;
    const t = ms / 1000;
    this.running.forEach(it => {
      if (it.dead) { this.running.delete(it); return; }
      it.frame(t, dt);
      if (it.reduced && t > it.colorDirtyUntil) this.running.delete(it);
    });
    if (this.running.size) this.raf = requestAnimationFrame(this._tick);
  }

  destroy() { this.unbind(); cancelAnimationFrame(this.raf); }
}

Dots.shapes = SHAPE_NAMES;
export default Dots;
