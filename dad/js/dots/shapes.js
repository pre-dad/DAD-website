// DAD dot-matrix shape library.
//
// Every illustration is described in a "unit space" that is 100 units tall and
// (100 * aspect) units wide. A shape is a stack of layers. Each layer either
//   - draw(ctx, S)  paints a silhouette with Canvas2D (it is rasterised to a mask and
//                   sampled on the same offset dot grid the Open Ledger map uses), or
//   - pts(step, S)  returns explicit points [{x, y, u?, k?, s3?}] in unit space
//                   (dotted strokes along edges, the globe's sphere, etc).
// Later layers win where they overlap earlier ones.
//
// Layer options:
//   tone   'base' | 'dim' | 'accent' | token ('red','cyan','gold','paper','teal','ink','infra','trust','cat:<program>')
//   alpha  peak opacity of the layer (default 1)
//   inner  opacity multiplier for interior dots, so silhouettes read as lit edges (default .62; 1 = flat)
//   edge   false disables interior/edge distinction
//   r      dot radius as a fraction of grid step (default .3)
//   jitter random opacity variation 0..1
//   anim   string or array of motion names understood by dots.js
//   axis   [dx, dy] direction used to compute the 0..1 parameter `u` for flow-type motion
//   glow   accent glow on dark backgrounds
//   holes  (ctx, S) paints areas to cut out of the layer (destination-out)

const TAU = Math.PI * 2;

function rrect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function poly(c, pts) {
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
}
function circle(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
function arrowHead(c, tipX, tipY, ang, len, half) {
  const bx = tipX - Math.cos(ang) * len, by = tipY - Math.sin(ang) * len;
  const nx = -Math.sin(ang) * half, ny = Math.cos(ang) * half;
  c.moveTo(tipX, tipY); c.lineTo(bx + nx, by + ny); c.lineTo(bx - nx, by - ny); c.closePath();
}
// Display font for glyph-based shapes ($, PDF). CORE declares @font-face for it.
export const DISPLAY_FONT = '"Space Grotesk", "Inter", system-ui, sans-serif';

/* ------------------------------------------------------------------ */
/*  US MAP — real geometry from us-dots.js (us-atlas, Albers USA)        */
/* ------------------------------------------------------------------ */
// us-dots.js is generated offline (~/Library/Caches/dad-site-qa/gen-us-dots.mjs): hexagonal lattices at
// several densities, each point flagged ocean / land / coast / state border, plus ~40 metro sites.
import { US } from './us-dots.js?v=7df28338d2';
export const MAP_ASPECT = US.aspect;
// site positions in unit space (100 tall). Deliberately unlabelled on screen: no names, no numbers.
export const MAP_SITES = US.sites.map(s => [s[1], s[2]]);
export const MAP_SITE_NAMES = US.sites.map(s => s[0]);
export const MAP_SITE_CATS = US.sites.map(s => s[3]);
export const MAP_HUB = US.hub; // Kansas City: the central site (the dollar's landing target)

const SQ3 = Math.sqrt(3) / 2;
// the finest lattice that is no finer than the engine asked for (it coarsens on its own past maxDots)
function usLevel(stepU) {
  let pick = US.levels[0];
  for (const l of US.levels) if (l.sx >= stepU * .9) pick = l;
  if (!pick.pts) {
    const b = atob(pick.d), sy = pick.sx * SQ3, pts = [];
    let k = 0;
    for (let q = 0; q < b.length; q++) {
      const c = b.charCodeAt(q), f = c >> 6, run = (c & 63) + 1;
      if (f) for (let r = 0; r < run; r++) {
        const idx = k + r, j = (idx / pick.cols) | 0, i = idx - j * pick.cols;
        pts.push({ x: pick.x0 + i * pick.sx + (j & 1 ? pick.sx / 2 : 0), y: pick.y0 + j * sy, f });
      }
      k += run;
    }
    pick.pts = pts;
  }
  return pick;
}
const usLayer = (flag) => (stepU) => usLevel(stepU).pts.filter(p => p.f === flag).map(p => ({ x: p.x, y: p.y }));

/* ------------------------------------------------------------------ */
/*  People network layout (unit space 140 x 100)                        */
/* ------------------------------------------------------------------ */
const NET_NODES = [
  [14, 22, 4.4], [40, 12, 4.2], [68, 20, 5.2], [97, 10, 4.2], [126, 22, 4.6],
  [8, 54, 3.8], [36, 44, 7.2, 1], [72, 52, 8.4, 1], [104, 42, 6.4, 1], [132, 56, 4.2],
  [22, 84, 4.6], [52, 78, 4.4], [86, 88, 5.0], [114, 78, 4.4], [134, 92, 3.6]
];
const NET_EDGES = (() => {
  const e = new Set();
  NET_NODES.forEach((a, i) => {
    const d = NET_NODES.map((b, j) => [j, Math.hypot(a[0] - b[0], a[1] - b[1])])
      .filter(([j]) => j !== i).sort((p, q) => p[1] - q[1]);
    d.slice(0, 3).forEach(([j, dist]) => { if (dist < 42) e.add(i < j ? `${i}-${j}` : `${j}-${i}`); });
  });
  return [...e].map(s => s.split('-').map(Number));
})();

/* ------------------------------------------------------------------ */
/*  Convene: experts brought together (unit space 140 x 100)            */
/* ------------------------------------------------------------------ */
// one hub (DAD) and seven experts on a ring; every expert is linked to the hub and to its
// neighbours, so it reads at a glance as a network. Pulses run along the links into the hub.
const CV_HUB = [70, 50, 12];
const CV_NODES = Array.from({ length: 7 }, (_, i) => {
  const a = -Math.PI / 2 + i * (Math.PI * 2 / 7) + .22;
  return [70 + Math.cos(a) * 55, 50 + Math.sin(a) * 38, i % 2 ? 6.4 : 7.4];
});
const CV_EDGES = [
  ...CV_NODES.map((n, i) => [n, CV_HUB, i * .143]),                       // spokes: expert -> hub
  ...CV_NODES.map((n, i) => [n, CV_NODES[(i + 1) % 7], .5 + i * .07])      // the ring: neighbour to neighbour
];
function linkPts(step, edges) {
  const out = [], gap = step * 1.1;
  edges.forEach(([[ax, ay, ar], [bx, by, br], k]) => {
    const L = Math.hypot(bx - ax, by - ay), s0 = ar + step * .9, s1 = L - br - step * .9;
    const n = Math.max(1, Math.round((s1 - s0) / gap));
    for (let m = 0; m <= n; m++) {
      const t = s0 + (s1 - s0) * (m / n);
      out.push({ x: ax + (bx - ax) * t / L, y: ay + (by - ay) * t / L, u: t / L, k });
    }
  });
  return out;
}

/* ------------------------------------------------------------------ */
/*  Shapes                                                             */
/* ------------------------------------------------------------------ */
export const SHAPES = {
  /* ---------- the ledger map ---------- */
  map: {
    aspect: MAP_ASPECT, cells: 7000, minStep: 3.2, rFactor: .24, accent: 'red', kind: 'map', dotsMul: 1.7,
    label: 'Map of the United States',
    layers: [
      { id: 'land', tone: 'base', alpha: .3, jitter: .15, r: .22, anim: ['shimmer', 'breathe'], pts: usLayer(1) },
      { id: 'coast', tone: 'base', alpha: .5, jitter: .1, r: .24, anim: ['shimmer', 'breathe'], pts: usLayer(2) },
      { id: 'border', tone: 'base', alpha: .66, jitter: .1, r: .26, anim: ['shimmer', 'breathe'], pts: usLayer(3) }
    ]
  },

  /* ---------- programs ---------- */
  food: {
    aspect: 1, accent: 'red', label: 'A bowl of food with rising steam',
    layers: [
      { id: 'steam', tone: 'accent', anim: 'rise', edge: false, glow: true, r: .3,
        draw(c) {
          c.lineCap = 'round'; c.lineWidth = 4.8;
          [[35, 0, .9], [50, 2.1, 1], [65, 4.0, .9]].forEach(([x0, ph, h]) => {
            c.beginPath();
            const top = 32 - 26 * h;
            for (let y = 32; y >= top; y -= .5) {
              const t = (32 - y) / 26;
              const x = x0 + Math.sin(y * .2 + ph) * (2.4 + 2.6 * t);
              y === 32 ? c.moveTo(x, y) : c.lineTo(x, y);
            }
            c.stroke();
          });
        } },
      { id: 'food', tone: 'dim', alpha: .55, inner: .8,
        draw(c) {
          c.save(); c.beginPath(); c.rect(0, 0, 100, 52); c.clip();
          c.beginPath(); circle(c, 33, 51, 11.5); circle(c, 51, 48, 13.5); circle(c, 68, 51, 10.5); c.fill();
          c.restore();
        } },
      { id: 'bowl', tone: 'base', inner: .5,
        draw(c) {
          c.beginPath();
          c.moveTo(9, 54); c.lineTo(91, 54);
          c.bezierCurveTo(91, 76, 73, 87, 50, 87);
          c.bezierCurveTo(27, 87, 9, 76, 9, 54);
          c.fill();
          c.beginPath(); rrect(c, 36, 87, 28, 6, 2.5); c.fill();
        } },
      { id: 'rim', tone: 'base', inner: 1, draw(c) { c.beginPath(); rrect(c, 4, 50, 92, 5.5, 2.75); c.fill(); } }
    ]
  },

  /* ---------- program partners: DAD (ink) shaking a partner's (accent) hand ---------- */
  handshake: {
    aspect: 1, accent: 'red', label: 'Two partners shaking hands',
    layers: [
      { id: 'dad', tone: 'base', inner: .6, anim: ['flow', 'breathe'], axis: [1, 0],
        draw(c) {
          c.beginPath(); circle(c, 20, 22, 10); c.fill();
          c.beginPath(); c.moveTo(2, 98); c.quadraticCurveTo(2, 42, 20, 42); c.quadraticCurveTo(33, 42, 37, 55);
          c.lineTo(52, 59); c.lineTo(49, 73); c.lineTo(32, 70); c.lineTo(32, 98); c.closePath(); c.fill();
        } },
      { id: 'partner', tone: 'accent', inner: .6, anim: ['flow', 'breathe'], axis: [-1, 0],
        draw(c) {
          c.beginPath(); circle(c, 80, 22, 10); c.fill();
          c.beginPath(); c.moveTo(98, 98); c.quadraticCurveTo(98, 42, 80, 42); c.quadraticCurveTo(67, 42, 63, 55);
          c.lineTo(48, 59); c.lineTo(51, 73); c.lineTo(68, 70); c.lineTo(68, 98); c.closePath(); c.fill();
        } },
      { id: 'clasp', tone: 'accent', glow: true, inner: .8, anim: 'beat',
        draw(c) { c.beginPath(); c.ellipse(50, 66, 16, 10.5, 0, 0, Math.PI * 2); c.fill(); } },
      { id: 'grip', tone: 'base', inner: 1, anim: 'shimmer',
        draw(c) { c.lineCap = 'round'; c.lineWidth = 5.5; c.beginPath(); c.moveTo(35, 63); c.quadraticCurveTo(50, 53, 65, 63); c.stroke(); } }
    ]
  },

  health: {
    aspect: 1, accent: 'cyan', label: 'A medical cross inside a circle',
    layers: [
      { id: 'ring', tone: 'base', anim: 'orbit', inner: 1,
        draw(c) { c.lineWidth = 6.5; c.beginPath(); c.arc(50, 50, 44, 0, TAU); c.stroke(); } },
      { id: 'cross', tone: 'accent', anim: 'beat', inner: .55, glow: true,
        draw(c) { c.beginPath(); rrect(c, 38.5, 18, 23, 64, 6); rrect(c, 18, 38.5, 64, 23, 6); c.fill(); } }
    ]
  },

  opportunities: {
    aspect: 1.1, accent: 'gold', label: 'Stairs rising with an upward arrow',
    layers: [
      // four separate risers with a small gap between them, so every step reads at any size
      { id: 'stairs', tone: 'base', anim: 'flow', inner: .5, axis: [1, -.7],
        draw(c) {
          c.beginPath();
          [[4, 80], [31, 63], [58, 46], [85, 29]].forEach(([x, top]) => rrect(c, x, top, 23, 97 - top, 1.6));
          c.fill();
        } },
      { id: 'arrow', tone: 'accent', anim: 'flow', inner: 1, glow: true, axis: [80, -56],
        draw(c) {
          const x0 = 6, y0 = 60, x1 = 88, y1 = 4, ang = Math.atan2(y1 - y0, x1 - x0);
          c.lineCap = 'round'; c.lineWidth = 6;
          c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1 - Math.cos(ang) * 15, y1 - Math.sin(ang) * 15); c.stroke();
          c.beginPath(); arrowHead(c, x1, y1, ang, 21, 11); c.fill();
        } }
    ]
  },

  infrastructure: {
    aspect: 1.25, accent: 'infra', label: 'Houses and buildings on a street',
    layers: [
      { id: 'ground', tone: 'dim', alpha: .6, inner: 1, draw(c) { c.beginPath(); rrect(c, 0, 93.5, 125, 3.6, 1.8); c.fill(); } },
      { id: 'buildings', tone: 'base', inner: .26,
        draw(c) {
          c.beginPath();
          rrect(c, 5, 63, 34, 31, 1);                // house walls
          poly(c, [[-1, 66], [22, 41], [45, 66]]);   // roof
          c.rect(31, 45, 6, 13);                      // chimney
          rrect(c, 50, 13, 22, 81, 1.2);             // tower
          c.rect(59.5, 3, 3, 11);                     // antenna
          rrect(c, 76, 36, 22, 58, 1.2);             // mid block
          rrect(c, 103, 69, 19, 25, 1);              // small house
          poly(c, [[99.5, 71], [112.5, 56], [125.5, 71]]);
          c.fill();
        },
        holes(c) { c.beginPath(); rrect(c, 18, 76, 8, 18, 1.5); c.fill(); } },
      { id: 'windows', tone: 'accent', anim: 'twinkle', inner: 1, glow: true,
        draw(c) {
          c.beginPath();
          for (let r = 0; r < 6; r++) for (let k = 0; k < 2; k++) c.rect(54 + k * 9, 19 + r * 11.2, 5, 5.5);
          for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) c.rect(80 + k * 9, 42 + r * 11.5, 5, 5.5);
          c.rect(8.5, 70, 6, 6); c.rect(29.5, 70, 6, 6); c.rect(109.5, 77, 6, 6);
          c.fill();
        } }
    ]
  },

  /* ---------- the five leaks ---------- */
  'leak-1': {
    aspect: .76, accent: 'red', label: 'An hourglass with sand running through',
    layers: [
      { id: 'glass', tone: 'base', alpha: .8, inner: 1,
        draw(c) {
          c.lineWidth = 3.4; c.beginPath();
          c.moveTo(16, 10); c.bezierCurveTo(16, 34, 34.5, 42, 34.5, 50); c.bezierCurveTo(34.5, 58, 16, 66, 16, 90);
          c.moveTo(60, 10); c.bezierCurveTo(60, 34, 41.5, 42, 41.5, 50); c.bezierCurveTo(41.5, 58, 60, 66, 60, 90);
          c.stroke();
        } },
      { id: 'sand', tone: 'accent', inner: .7, glow: true,
        draw(c) {
          const bulb = () => {
            c.beginPath(); c.moveTo(19.5, 10); c.bezierCurveTo(19.5, 33, 37, 42, 38, 50);
            c.bezierCurveTo(39, 42, 56.5, 33, 56.5, 10); c.closePath();
            c.moveTo(19.5, 90); c.bezierCurveTo(19.5, 67, 37, 58, 38, 50);
            c.bezierCurveTo(39, 58, 56.5, 67, 56.5, 90); c.closePath();
          };
          c.save(); bulb(); c.clip();
          c.beginPath(); c.rect(0, 29, 76, 18); c.fill();                     // what's left on top
          c.beginPath(); c.moveTo(14, 92); c.bezierCurveTo(22, 76, 30, 69, 38, 68);
          c.bezierCurveTo(46, 69, 54, 76, 62, 92); c.closePath(); c.fill();     // the pile below
          c.restore();
        } },
      { id: 'stream', tone: 'accent', anim: 'fall', inner: 1, edge: false, glow: true,
        draw(c) { c.beginPath(); c.rect(36.4, 46, 3.2, 26); c.fill(); } },
      { id: 'caps', tone: 'base', inner: .7,
        draw(c) { c.beginPath(); rrect(c, 8, 3, 60, 7, 2.5); rrect(c, 8, 90, 60, 7, 2.5); c.fill(); } }
    ]
  },

  'leak-2': {
    aspect: 1, accent: 'red', label: 'A magnifying glass inspecting a coin',
    layers: [
      { id: 'coin', tone: 'accent', inner: .55, glow: true,
        draw(c) { c.beginPath(); circle(c, 40, 40, 12.5); c.fill(); },
        holes(c) { c.lineWidth = 2.6; c.beginPath(); c.arc(40, 40, 8, 0, TAU); c.stroke(); } },
      { id: 'lens', tone: 'dim', alpha: .3, inner: 1, edge: false, anim: ['wander', 'glint'],
        draw(c) { c.beginPath(); circle(c, 41, 41, 22); c.fill(); },
        holes(c) { c.beginPath(); circle(c, 40, 40, 14.5); c.fill(); } },
      { id: 'frame', tone: 'base', inner: 1, anim: 'wander',
        draw(c) {
          c.lineWidth = 7.5; c.beginPath(); c.arc(41, 41, 27, 0, TAU); c.stroke();
          c.lineCap = 'round'; c.lineWidth = 13; c.beginPath(); c.moveTo(66, 66); c.lineTo(89, 89); c.stroke();
          c.lineWidth = 9; c.beginPath(); c.moveTo(60, 60); c.lineTo(67, 67); c.stroke();
        } }
    ]
  },

  'leak-3': {
    aspect: 1, accent: 'red', label: 'A dollar pie being eaten away',
    needsFont: true,
    layers: [
      { id: 'pie', tone: 'base', inner: .6, anim: 'eat',
        draw(c) { c.beginPath(); circle(c, 50, 50, 43); c.fill(); },
        holes(c) {
          c.font = `700 62px ${DISPLAY_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText('$', 50, 53);
        } },
      { id: 'crumbs', tone: 'accent', inner: 1, edge: false, anim: 'crumbs', glow: true,
        pts(step) {
          const out = [];
          for (let i = 0; i < 46; i++) {
            const a = -0.5 + (i / 46) * 1.1, rr = 46 + ((i * 37) % 11);
            out.push({ x: 50 + Math.cos(a) * rr, y: 50 + Math.sin(a) * rr, k: (i * .618) % 1 });
          }
          return out;
        } }
    ]
  },

  'leak-4': {
    aspect: .8, accent: 'red', label: 'A report document with a PDF tag',
    needsFont: true,
    layers: [
      { id: 'page', tone: 'base', alpha: .9, inner: .2,
        draw(c) { c.beginPath(); poly(c, [[8, 3], [54, 3], [72, 21], [72, 97], [8, 97]]); c.fill(); } },
      { id: 'fold', tone: 'base', inner: .9,
        draw(c) { c.beginPath(); poly(c, [[54, 3], [54, 21], [72, 21]]); c.fill(); } },
      { id: 'lines', tone: 'base', inner: 1, anim: 'type', alpha: .9,
        draw(c) {
          c.beginPath(); rrect(c, 17, 14, 26, 5.5, 2.75);
          [[27, 46], [35, 40], [43, 46], [51, 30]].forEach(([y, w]) => rrect(c, 17, y, w, 3.6, 1.8));
          c.fill();
        } },
      { id: 'badge', tone: 'accent', alpha: .2, inner: 1, edge: false,
        draw(c) { c.beginPath(); rrect(c, 11, 61, 56, 31, 6); c.fill(); } },
      { id: 'pdf', tone: 'accent', inner: 1, glow: true,
        draw(c) {
          c.font = `700 27px ${DISPLAY_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
          if ('letterSpacing' in c) c.letterSpacing = '3px';
          c.lineWidth = 2.4; c.lineJoin = 'round';
          c.fillText('PDF', 39, 77); c.strokeText('PDF', 39, 77);
        } }
    ]
  },

  'leak-5': {
    aspect: 1, accent: 'red', label: 'A bandage fading away',
    layers: [
      { id: 'strip', tone: 'base', inner: .42, anim: 'fade', axis: [Math.cos(-.72), Math.sin(-.72)],
        draw(c) { c.save(); c.translate(50, 50); c.rotate(-.72); c.beginPath(); rrect(c, -48, -16, 96, 32, 16); c.fill(); c.restore(); },
        holes(c) {
          c.save(); c.translate(50, 50); c.rotate(-.72); c.beginPath();
          for (const sx of [-38, -29.5, 29.5, 38]) for (const sy of [-6, 6]) circle(c, sx, sy, 2.7);
          c.fill(); c.restore();
        } },
      { id: 'pad', tone: 'accent', inner: .7, anim: 'fade', glow: true, axis: [Math.cos(-.72), Math.sin(-.72)],
        draw(c) { c.save(); c.translate(50, 50); c.rotate(-.72); c.beginPath(); rrect(c, -16, -11, 32, 22, 4); c.fill(); c.restore(); } }
    ]
  },

  /* ---------- system shapes ---------- */
  loop: {
    aspect: 1, accent: 'red', label: 'A four-step loop',
    layers: [
      { id: 'arcs', tone: 'base', anim: 'orbit', inner: 1,
        draw(c) {
          const R = 37;
          for (let q = 0; q < 4; q++) {
            const a0 = -Math.PI / 2 + q * Math.PI / 2 + .36, a1 = -Math.PI / 2 + (q + 1) * Math.PI / 2 - .46;
            c.lineWidth = 5; c.lineCap = 'round';
            c.beginPath(); c.arc(50, 50, R, a0, a1 - .14); c.stroke();
            // filled arrowhead sitting on the circle, pointing clockwise into the next node
            const ah = a1 + .1, tx = 50 + Math.cos(ah) * R, ty = 50 + Math.sin(ah) * R;
            c.beginPath(); arrowHead(c, tx, ty, ah + Math.PI / 2 - .12, 12, 7.5); c.fill();
          }
        } },
      ...['food', 'health', 'opportunities', 'infrastructure'].map((cat, q) => ({
        id: 'node-' + q, tone: 'cat:' + cat, monoTone: 'accent', inner: .6, anim: 'node', glow: true, phase: q / 4,
        draw(c) { const a = -Math.PI / 2 + q * Math.PI / 2; c.beginPath(); circle(c, 50 + Math.cos(a) * 37, 50 + Math.sin(a) * 37, 9.5); c.fill(); }
      }))
    ]
  },

  people: {
    aspect: 1.4, accent: 'cyan', label: 'A network of connected people',
    layers: [
      { id: 'links', tone: 'base', alpha: .5, inner: 1, edge: false, anim: 'edgeflow', r: .24,
        pts(step) {
          const out = [], gap = step * 1.15;
          NET_EDGES.forEach(([i, j], e) => {
            const [ax, ay, ar] = NET_NODES[i], [bx, by, br] = NET_NODES[j];
            const L = Math.hypot(bx - ax, by - ay), s0 = ar + step * .9, s1 = L - br - step * .9;
            const n = Math.max(1, Math.round((s1 - s0) / gap));
            for (let m = 0; m <= n; m++) {
              const s = s0 + (s1 - s0) * (m / n);
              out.push({ x: ax + (bx - ax) * s / L, y: ay + (by - ay) * s / L, u: s / L, k: (e * .37) % 1 });
            }
          });
          return out;
        } },
      { id: 'nodes', tone: 'base', inner: .7, anim: 'node',
        draw(c) { c.beginPath(); NET_NODES.forEach(([x, y, r, hub]) => { if (!hub) circle(c, x, y, r); }); c.fill(); } },
      { id: 'hubs', tone: 'accent', inner: .6, anim: 'node', glow: true, phase: .5,
        draw(c) { c.beginPath(); NET_NODES.forEach(([x, y, r, hub]) => { if (hub) circle(c, x, y, r); }); c.fill(); } }
    ]
  },

  convene: {
    aspect: 1.4, accent: 'red', label: 'A network: experts linked to one hub',
    layers: [
      { id: 'ring', tone: 'base', alpha: .4, inner: 1, edge: false, anim: 'edgeflow', r: .22,
        pts(step) { return linkPts(step, CV_EDGES.slice(7)); } },
      { id: 'spokes', tone: 'accent', alpha: .55, inner: 1, edge: false, anim: 'edgeflow', r: .25, glow: true,
        pts(step) { return linkPts(step, CV_EDGES.slice(0, 7)); } },
      { id: 'nodes', tone: 'base', inner: .7, anim: 'node',
        draw(c) { c.beginPath(); CV_NODES.forEach(([x, y, r]) => circle(c, x, y, r)); c.fill(); } },
      { id: 'hub', tone: 'accent', inner: .6, anim: 'beat', glow: true,
        draw(c) { c.beginPath(); circle(c, CV_HUB[0], CV_HUB[1], CV_HUB[2]); c.fill(); } }
    ]
  },

  dollar: {
    aspect: .66, accent: 'red', label: 'A dollar sign',
    needsFont: true,
    layers: [
      { id: 'glyph', tone: 'base', inner: .55, anim: 'glint',
        draw(c) {
          c.font = `700 118px ${DISPLAY_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText('$', 33, 56);
        } }
    ]
  },

  shield: {
    aspect: .86, accent: 'trust', label: 'A shield with a check mark',
    layers: [
      { id: 'shield', tone: 'base', inner: .24, anim: 'glint',
        draw(c) {
          c.beginPath(); c.moveTo(43, 3); c.bezierCurveTo(55, 10, 68, 13, 81, 13); c.lineTo(81, 46);
          c.bezierCurveTo(81, 72, 63, 88, 43, 97); c.bezierCurveTo(23, 88, 5, 72, 5, 46); c.lineTo(5, 13);
          c.bezierCurveTo(18, 13, 31, 10, 43, 3); c.closePath(); c.fill();
        } },
      { id: 'check', tone: 'accent', inner: 1, glow: true, anim: 'beat',
        draw(c) {
          c.lineWidth = 11; c.lineCap = 'round'; c.lineJoin = 'round';
          c.beginPath(); c.moveTo(24, 50); c.lineTo(38, 64); c.lineTo(63, 35); c.stroke();
        } }
    ]
  },

  globe: {
    aspect: 1, accent: 'red', label: 'A turning globe',
    layers: [
      { id: 'rim', tone: 'base', alpha: .5, inner: 1, edge: false,
        draw(c) { c.lineWidth = 2.6; c.beginPath(); c.arc(50, 50, 46.5, 0, TAU); c.stroke(); } },
      { id: 'sphere', tone: 'base', inner: 1, edge: false, anim: 'spin3d', r: .3,
        pts(step) {
          const R = 46, gap = step * 1.45, out = [];
          const add = (lat, lon, k) => out.push({ x: 50 + Math.cos(lat) * Math.cos(lon) * R, y: 50 - Math.sin(lat) * R,
            s3: [Math.cos(lat) * Math.cos(lon), -Math.sin(lat), Math.cos(lat) * Math.sin(lon)], k });
          for (let m = 0; m < 6; m++) {                      // meridians
            const lon = m * Math.PI / 6, n = Math.round(Math.PI * R / gap);
            for (let i = 0; i < n * 2; i++) { const lat = -Math.PI / 2 + (i / (n * 2)) * TAU; if (Math.abs(Math.sin(lat)) > .985) continue; add(lat, lon, (m * .13) % 1); }
          }
          [-60, -30, 0, 30, 60].forEach((dg, p) => {           // parallels
            const lat = dg * Math.PI / 180, n = Math.round(TAU * R * Math.cos(lat) / gap);
            for (let i = 0; i < n; i++) add(lat, (i / n) * TAU, .5 + p * .1);
          });
          return out;
        } }
    ]
  },

  /* ---------- ambient hero background ---------- */
  field: {
    aspect: 0, cover: true, kind: 'field', accent: 'red', label: '',
    layers: [{ id: 'grid', tone: 'base', alpha: .2, inner: 1, edge: false, anim: 'ripple', r: .09, jitter: .5,
      draw(c, S) { c.fillRect(0, 0, S.w, S.h); } }]
  }
};

// Friendly aliases page builders may reach for.
export const ALIASES = {
  us: 'map', 'us-map': 'map', ledger: 'map', bowl: 'food', cross: 'health', ladder: 'opportunities', stairs: 'opportunities',
  city: 'infrastructure', skyline: 'infrastructure', hourglass: 'leak-1', magnifier: 'leak-2', pie: 'leak-3',
  document: 'leak-4', pdf: 'leak-4', bandage: 'leak-5', network: 'people', check: 'shield', trust: 'shield', '$': 'dollar',
  'globe-ish': 'globe', ambient: 'field'
};

export function getShape(name) {
  name = (name || '').trim().toLowerCase();
  return SHAPES[name] || SHAPES[ALIASES[name]] || null;
}
export const SHAPE_NAMES = Object.keys(SHAPES);
