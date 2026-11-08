// 3D liquid formations. Each formation lays out up to N capsule primitives in drop-local 3D
// space (units of the drop radius, y up, +z toward the camera) plus at most one analytic part
// (torus, disc or bowl). The shader smooth-unions everything into one raymarched body.
// Index roles are loosely shared (0 core, 1-3 lobes, 4.. droplets) so morphs read as liquid.
import { ICON } from './icons.js?v=96b7c0d426';
const fr = x => x - Math.floor(x);
export const H1 = [], H2 = [];
for (let i = 0; i < 40; i++) { H1.push(fr(Math.sin(i * 12.9898 + 1.3) * 43758.5453)); H2.push(fr(Math.sin(i * 78.233 + 4.1) * 24634.6345)); }
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// part types (shader): 1 torus · 2 disc (rounded cylinder) · 3 bowl (cut spherical shell)
export const PART = { torus: 1, disc: 2, bowl: 3 };

export function makeForm(n) {
  // a: start xyz + radius · b: end xyz · s: [c.xyz, type, axis.xyz, weight, R, r, x, 0]
  // I: the icon uniforms (see gl.js uI0..uI3) · pose: icon pitch, yaw, roll, mirror · icon: tile or -1
  return { n, a: new Float32Array(n * 4), b: new Float32Array(n * 4), s: new Float32Array(12), I: new Float32Array(16), pose: new Float32Array([0, 0, 0, 1]), icon: -1, k: 0.28, glow: 1, jelly: 1, lean: 1 };
}
export function copyForm(src, dst) {
  dst.a.set(src.a); dst.b.set(src.b); dst.s.set(src.s); dst.I.set(src.I); dst.pose.set(src.pose);
  dst.icon = src.icon; dst.k = src.k; dst.glow = src.glow; dst.jelly = src.jelly; dst.lean = src.lean;
}

// ---- tiny 3x3 maths (row-major). mat3(p, y, r) = Rz(roll) · Rx(pitch) · Ry(yaw)
export function mul3(A, B, o = new Float32Array(9)) {
  const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3], a4 = A[4], a5 = A[5], a6 = A[6], a7 = A[7], a8 = A[8];
  const b0 = B[0], b1 = B[1], b2 = B[2], b3 = B[3], b4 = B[4], b5 = B[5], b6 = B[6], b7 = B[7], b8 = B[8];
  o[0] = a0 * b0 + a1 * b3 + a2 * b6; o[1] = a0 * b1 + a1 * b4 + a2 * b7; o[2] = a0 * b2 + a1 * b5 + a2 * b8;
  o[3] = a3 * b0 + a4 * b3 + a5 * b6; o[4] = a3 * b1 + a4 * b4 + a5 * b7; o[5] = a3 * b2 + a4 * b5 + a5 * b8;
  o[6] = a6 * b0 + a7 * b3 + a8 * b6; o[7] = a6 * b1 + a7 * b4 + a8 * b7; o[8] = a6 * b2 + a7 * b5 + a8 * b8;
  return o;
}
const _ry = new Float32Array(9), _rx = new Float32Array(9), _rz = new Float32Array(9), _t = new Float32Array(9);
export function mat3(pitch, yaw, roll, o = new Float32Array(9)) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
  _ry.set([cy, 0, sy, 0, 1, 0, -sy, 0, cy]);
  _rx.set([1, 0, 0, 0, cp, -sp, 0, sp, cp]);
  _rz.set([cr, -sr, 0, sr, cr, 0, 0, 0, 1]);
  mul3(_rx, _ry, _t);
  return mul3(_rz, _t, o);
}
const T = [0, 0, 0];
function tf(M, x, y, z) {
  if (!M) { T[0] = x; T[1] = y; T[2] = z; return T; }
  T[0] = M[0] * x + M[1] * y + M[2] * z; T[1] = M[3] * x + M[4] * y + M[5] * z; T[2] = M[6] * x + M[7] * y + M[8] * z;
  return T;
}
function put(o, i, ax, ay, az, bx, by, bz, r) {
  if (i >= o.n) return;
  const j = i * 4;
  o.a[j] = ax; o.a[j + 1] = ay; o.a[j + 2] = az; o.a[j + 3] = Math.max(0, r);
  o.b[j] = bx; o.b[j + 1] = by; o.b[j + 2] = bz; o.b[j + 3] = 0;
}
function ball(o, i, M, x, y, z, r) { const t = tf(M, x, y, z); put(o, i, t[0], t[1], t[2], t[0], t[1], t[2], r); }
function stick(o, i, M, ax, ay, az, bx, by, bz, r) {
  let t = tf(M, ax, ay, az); const x0 = t[0], y0 = t[1], z0 = t[2];
  t = tf(M, bx, by, bz); put(o, i, x0, y0, z0, t[0], t[1], t[2], r);
}
function part(o, type, M, cx, cy, cz, nx, ny, nz, R, r, x) {
  const s = o.s;
  let t = tf(M, cx, cy, cz); s[0] = t[0]; s[1] = t[1]; s[2] = t[2]; s[3] = type;
  t = tf(M, nx, ny, nz); const l = Math.hypot(t[0], t[1], t[2]) || 1;
  s[4] = t[0] / l; s[5] = t[1] / l; s[6] = t[2] / l; s[7] = 1;
  s[8] = R; s[9] = r; s[10] = x; s[11] = 0;
}
function reset(o) {
  o.a.fill(0); o.b.fill(0); o.s.fill(0); o.I.fill(0);
  o.I[4] = 1; o.I[5] = 0.3; o.I[6] = 0.12;
  o.pose[0] = 0; o.pose[1] = 0; o.pose[2] = 0; o.pose[3] = 1; o.icon = -1;
  o.k = 0.28; o.glow = 1; o.jelly = 1; o.lean = 1;
}

// ---- icon shapes. The "!", the faces, flex and people are analytic 3D bodies in the shader (puffy,
// smooth, features carved with soft edges; h/bev only matter mid-morph into an atlas icon). The rest
// are 2D SDF atlas tiles extruded in the shader. h: half thickness · bev: bevel radius ·
// dep: detail depth (<0 carved, >0 embossed) · wave: cloth · core: a hidden liquid core (faces)
const ICON_LOOK = {
  exclaim: { h: 0.24, bev: 0.2 },
  annoyed: { h: 0.4, bev: 0.3, core: 0.36 },
  shocked: { h: 0.4, bev: 0.3, core: 0.36 },
  frown: { h: 0.4, bev: 0.3, core: 0.36 },
  angry: { h: 0.4, bev: 0.3, core: 0.36 },
  recycle: { h: 0.2, bev: 0.11 },
  flex: { h: 0.28, bev: 0.2 },
  people: { h: 0.26, bev: 0.2 },
  dollar: { h: 0.085, bev: 0.06, dep: 0.034, wave: 1 },
  shield: { h: 0.27, bev: 0.13, dep: -0.9 },
  point: { h: 0.24, bev: 0.12, dep: -0.05 },
  loop: { h: 0.13, bev: 0.08 },
  logo: { h: 0.2, bev: 0.19 },
  code: { h: 0.2, bev: 0.15 },
  hiker: { h: 0.16, bev: 0.12 },
};
export const ICON_STATES = Object.keys(ICON_LOOK);
function iconInto(o, name, tau, aim) {
  const L = ICON_LOOK[name], I = o.I, t = ICON[name];
  o.icon = t;
  I[0] = t; I[1] = t; I[2] = 0; I[3] = 1;
  I[4] = 1; I[5] = L.h; I[6] = L.bev; I[7] = 0.008;   // one gentle wobble: liquid, but crisp
  I[8] = L.dep || 0; I[9] = L.wave || 0; I[10] = 0; I[11] = 0;
  if (L.core) ball(o, 0, null, 0, 0, 0, L.core);      // a liquid core inside the body (melts and merges)
  I[12] = 0; I[13] = 0; I[14] = 0;
  // a slow orbit so the depth always reads, while the face stays toward the reader
  let pitch = -0.1 + 0.11 * Math.sin(tau * 0.29), yaw = 0.42 * Math.sin(tau * 0.37), roll = 0.04 * Math.sin(tau * 0.23), mir = 1;
  switch (name) {
    case 'exclaim': I[4] = 1 + 0.05 * Math.pow(Math.max(0, Math.sin(tau * 2.4)), 6); break;
    case 'annoyed': break;
    case 'shocked': yaw *= 0.75; I[4] = 1 + 0.018 * Math.sin(tau * 1.3); break;
    case 'frown': pitch -= 0.12; I[13] = -0.03 * (0.5 + 0.5 * Math.sin(tau * 1.1)); break;
    // angry: no shake. It calmly faces the copy on its left: a static yaw and tilt, a slow breath
    case 'angry': yaw = -0.36 + 0.04 * Math.sin(tau * 0.33); pitch = -0.08 + 0.02 * Math.sin(tau * 0.29); roll = 0.07; I[4] = 1 + 0.012 * Math.sin(tau * 1.2); break;
    // the DAD logomark: slow breathing and a slight float, a gentle turn; no wobble on the letterform
    case 'logo': pitch = -0.05 + 0.035 * Math.sin(tau * 0.27); yaw = 0.24 * Math.sin(tau * 0.31); roll = 0; I[4] = 1 + 0.014 * Math.sin(tau * 1.1); I[13] = 0.03 * Math.sin(tau * 0.7); I[7] = 0; break;
    case 'recycle': roll = tau * 0.9; yaw *= 0.6; break;
    // the monitor: a slow, shallow turn so the screen always faces the reader; the digits flip in the shader
    case 'code': pitch = -0.06 + 0.04 * Math.sin(tau * 0.29); yaw = 0.3 * Math.sin(tau * 0.31); roll = 0; I[4] = 1 + 0.01 * Math.sin(tau * 1.1); I[7] = 0.004; break;
    // the hiker: seen from the side, a gentle turn only (the stride and the flag move in the shader)
    case 'hiker': pitch = -0.04 + 0.03 * Math.sin(tau * 0.27); yaw = 0.26 * Math.sin(tau * 0.3); roll = 0; I[7] = 0.003; break;
    case 'flex': roll += 0.07 * Math.sin(tau * 2.2); I[4] = 1 + 0.035 * Math.max(0, Math.sin(tau * 2.2)); break;
    case 'people': roll += 0.05 * Math.sin(tau * 0.9); break;
    case 'dollar': yaw *= 0.7; pitch -= 0.22; break;
    case 'loop': roll = tau * 0.6; yaw *= 0.6; break;
    case 'point': {
      const phi = -(aim || 0) * Math.PI / 180, a = Math.atan2(Math.sin(phi), Math.cos(phi));
      if (Math.abs(a) <= Math.PI / 2 + 0.01) roll = a; else { mir = -1; roll = a - Math.PI; }
      const poke = 0.09 * Math.pow(Math.max(0, Math.sin(tau * 2.6)), 3);
      I[12] = Math.cos(a) * poke; I[13] = Math.sin(a) * poke;
      yaw *= 0.6;
      break;
    }
  }
  o.pose[0] = pitch; o.pose[1] = yaw; o.pose[2] = roll; o.pose[3] = mir;
  o.k = 0.12; o.glow = 0.95; o.jelly = 0.75; o.lean = 0.8;
}
// pose -> the drop-local -> icon matrix the shader wants (column-major M^T, row 0 negated to mirror)
export function iconMatrix(pose, Mp, out) {
  mat3(pose[0], pose[1], pose[2], _mi);
  mul3(Mp, _mi, out);
  if (pose[3] < 0) { out[0] = -out[0]; out[3] = -out[3]; out[6] = -out[6]; }
  return out;
}
const _mi = new Float32Array(9);
// blend icon state from a -> b (e: 0..1) into o
export function blendIcon(a, b, e, o) {
  const A = a.I, B = b.I, I = o.I;
  const ta = A[3] > 0.01 ? (A[2] < 0.5 ? A[0] : A[1]) : -1, tb = B[3] > 0.01 ? B[0] : -1;
  for (let k = 4; k < 15; k++) I[k] = A[k] + (B[k] - A[k]) * e;
  if (ta >= 0 && tb >= 0) { I[0] = ta; I[1] = tb; I[2] = ta === tb ? 0 : clamp(e); I[3] = A[3] + (B[3] - A[3]) * e; }
  else if (tb >= 0) { I[0] = I[1] = tb; I[2] = 0; I[3] = B[3] * e; for (let k = 4; k < 15; k++) I[k] = B[k]; }
  else if (ta >= 0) { I[0] = I[1] = ta; I[2] = 0; I[3] = A[3] * (1 - e); for (let k = 4; k < 15; k++) I[k] = A[k]; }
  else I[3] = 0;
  I[11] = A[11] + (B[11] - A[11]) * e; I[10] = A[10] + (B[10] - A[10]) * e;
  const P = o.pose, pa = a.pose, pb = b.pose;
  const pick = tb >= 0 && (ta < 0 || e > 0.5) ? pb : pa;
  if (ta >= 0 && tb >= 0) {
    let dr = pb[2] - pa[2]; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    P[0] = pa[0] + (pb[0] - pa[0]) * e; P[1] = pa[1] + (pb[1] - pa[1]) * e; P[2] = pa[2] + dr * e; P[3] = e > 0.5 ? pb[3] : pa[3];
  } else P.set(pick);
  o.icon = tb >= 0 ? tb : ta;
}

// eight well-spread directions (for 'reform')
const DIRS = [];
for (let i = 0; i < 8; i++) {
  const y = 1 - (i + 0.5) / 8 * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
  DIRS.push([Math.cos(a) * r, y * 0.8, Math.sin(a) * r]);
}
// a small 3D cluster (for 'network')
const NET = [[0, 0.02, 0], [0.74, 0.34, 0.12], [-0.7, 0.3, -0.22], [0.12, -0.7, 0.26], [-0.3, 0.12, 0.74], [0.36, 0.18, -0.72]];
const EDGES = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 5], [2, 4], [3, 1]];
const ORBITS = [[0.32, 0, 0.18], [1.2, 0.9, 0], [-0.78, 2.1, 0.42]];
const _m1 = new Float32Array(9), _m2 = new Float32Array(9), _m3 = new Float32Array(9), _mg = new Float32Array(9);

// the brand's single drop: one smooth glossy body of liquid, no tip. Three soft lobes drift just
// under the surface (a gentle living wobble) and the whole body breathes.
function drop(o, tau, M, calm) {
  const br = 1 + (calm ? 0.018 : 0.026) * Math.sin(tau * 1.6);
  const sp = calm ? 0.4 : 0.55;
  ball(o, 0, M, 0, 0, 0, 0.74 * br);
  for (let j = 1; j < 4; j++) {
    const a = tau * sp * (j === 2 ? -1 : 1) * (0.8 + 0.2 * j) + j * 2.094;
    const off = 0.16 + 0.055 * Math.sin(tau * 0.9 + j * 1.7);
    ball(o, j, M, Math.cos(a) * off, 0.8 * Math.sin(a * 0.75 + j) * off, Math.sin(a) * off, 0.58 * br);
  }
}
// the galaxy's tilt (shared by its liquid core and the droplet pass in dollar.js)
export function galaxyMatrix(tau, Mp, out) {
  return mul3(Mp, mat3(0.95 + 0.06 * Math.sin(tau * 0.4), 0.22 * Math.sin(tau * 0.17), 0.3, _mg), out);
}

// ctx: { tau, M (tumble + pointer), Mp (pointer tilt only), My (yaw + pointer), aim (deg, for 'point') }
export function formInto(o, state, ctx) {
  const { tau, M, Mp, My } = ctx;
  reset(o);
  if (ICON_LOOK[state]) return iconInto(o, state, tau, ctx.aim);
  switch (state) {
    case 'leak': { // a blob leaking for real: drips swell, stretch, neck, let go, fall and pool below. Steady body.
      const sh = 0;
      ball(o, 0, My, sh, 0.42, 0, 0.58 * (1 + 0.02 * Math.sin(tau * 1.3)));
      ball(o, 1, My, -0.22 + sh, 0.3, 0.1, 0.44);
      ball(o, 2, My, 0.22 + sh, 0.28, -0.08, 0.44);
      for (let d = 0; d < 4; d++) {
        const ang = d * 1.5708 + 0.5;
        const t = tf(My, Math.cos(ang) * 0.27, 0, Math.sin(ang) * 0.27), x = t[0], z = t[2];
        const ph = fr(tau * (0.26 + 0.05 * d) + H1[d + 3]);
        const top = -0.02, n = 3 + d * 2;
        if (ph < 0.5) {            // swelling and stretching
          const u = ph / 0.5, y = top - 0.12 - 0.42 * u * u;
          stick(o, n, null, x, top + 0.05, z, x, y, z, 0.1 - 0.04 * u);
          ball(o, n + 1, null, x, y - 0.02, z, 0.07 + 0.1 * u);
        } else if (ph < 0.62) {    // necking
          const u = (ph - 0.5) / 0.12, y = top - 0.54 - 0.1 * u;
          stick(o, n, null, x, top + 0.05, z, x, y + 0.06, z, 0.06 - 0.045 * u);
          ball(o, n + 1, null, x, y - 0.02 - 0.03 * u, z, 0.17);
        } else {                   // let go: the bead falls, the thread snaps back up
          const v = (ph - 0.62) / 0.38, f = 2.6 * v * v, y = top - 0.66 - f;
          const hit = sstep(0.82, 1, v);
          stick(o, n, null, x, top + 0.05, z, x, top - 0.1 + 0.08 * v, z, 0.04 * (1 - v));
          if (y > -1.42) stick(o, n + 1, null, x, y, z, x, y + 0.06 + 0.22 * v, z, 0.15 * (1 - 0.25 * v) * (1 - hit));
        }
      }
      // spatter: a few small beads that broke off
      for (let i = 11; i < 15; i++) {
        const ph = fr(tau * 0.5 + H2[i]), a = H1[i] * 6.28;
        const t = tf(My, Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
        const y = -0.3 - 1.15 * ph * ph;
        ball(o, i, null, t[0] * (1 + ph * 2), y, t[2] * (1 + ph * 2), 0.05 * sstep(0, 0.1, ph) * (1 - sstep(0.85, 1, ph)));
      }
      part(o, PART.disc, null, 0, -1.42, 0.1, 0, 1, 0.12, 0.6 + 0.05 * Math.sin(tau * 0.6), 0.012, 0.035);
      o.k = 0.15; o.glow = 1.2; o.jelly = 0.6; o.lean = 0.35;
      return;
    }
    case 'galaxy': { // the bright liquid core, a swirling bulge in the disc plane; the spiral arms are
      // ~1000 droplets drawn as point sprites by dollar.js (they peel off this body and flow back in)
      const Mg = galaxyMatrix(tau, Mp, _m1);
      ball(o, 0, Mg, 0, 0, 0, 0.27 * (1 + 0.05 * Math.sin(tau * 2)));
      for (let j = 1; j < 4; j++) { const a = tau * 0.9 + j * 2.094; ball(o, j, Mg, Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13, 0.17); }
      o.I[11] = 1;
      o.k = 0.12; o.glow = 1.15; o.jelly = 0.8; o.lean = 0.7;
      return;
    }
    case 'spin':
      drop(o, tau, M, false);
      o.k = 0.3; o.glow = 1; o.jelly = 1; o.lean = 1;
      return;
    case 'rest': default:
      drop(o, tau, M, true);
      o.k = 0.28; o.glow = 0.85; o.jelly = 0.85; o.lean = 0.7;
      return;
    case 'underline': { // a thin wavy line of liquid under a heading: R = half the text width, so the line
      // runs -1..1. ctx.line = { r, amp } in drop units. The centre prims (the drop's core) take the middle
      // segments, so the liquid flows out from the middle; a subtle slow wave travels along it.
      const L = ctx.line || { r: 0.014, amp: 0.012 }, n = o.n, X = 1 - L.r;
      const y = (x) => L.amp * (Math.sin(x * 6.3 - tau * 1.25) * 0.8 + Math.sin(x * 2.9 + tau * 0.7 + 1.3) * 0.2);
      for (let i = 0; i < n; i++) {
        const k = (n >> 1) + ((i & 1) ? -((i + 1) >> 1) : (i >> 1));   // 0 -> middle, then outward
        const x0 = -X + 2 * X * k / n, x1 = -X + 2 * X * (k + 1) / n;
        put(o, i, x0, y(x0), 0, x1, y(x1), 0, L.r);
      }
      o.k = 0.004; o.glow = 0; o.jelly = 0; o.lean = 0;
      return;
    }
    case 'cover': // one big sphere that fills the viewport during page changes
      ball(o, 0, null, 0, 0, 0, 1);
      for (let j = 1; j < 4; j++) { const a = tau * 0.8 + j * 2.1; ball(o, j, null, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0, 0.86); }
      o.k = 0.3; o.glow = 0; o.jelly = 0.3; o.lean = 0;
      return;
    case 'crack': { // leaking: a fault opens and closes, drips bulge, neck, let go and fall away in 3D
      const sh = 0;
      const gap = 0.07 + 0.045 * Math.sin(tau * 0.9);
      ball(o, 0, M, sh, 0.1, 0, 0.6);
      ball(o, 1, M, -0.2 - gap + sh, 0.12, 0.06, 0.46);
      ball(o, 2, M, 0.2 + gap + sh, 0.08, -0.06, 0.46);
      ball(o, 3, M, sh, -0.16, 0, 0.44);
      for (let i = 4; i < 10; i++) {
        const ang = (i - 4) / 6 * 6.2832 + 0.4;
        const t = tf(My, Math.cos(ang) * 0.32, 0, Math.sin(ang) * 0.32), x = t[0], z = t[2];
        const ph = fr(tau * 0.3 + H1[i]);
        if (ph < 0.35) { const u = ph / 0.35; ball(o, i, null, x, -0.42 - 0.14 * u, z, 0.17 * Math.sqrt(u)); }
        else if (ph < 0.55) { const u = (ph - 0.35) / 0.2; stick(o, i, null, x, -0.5 - 0.2 * u * u, z, x, -0.62 - 0.22 * u, z, 0.15 - 0.03 * u); }
        else { const v = (ph - 0.55) / 0.45, f = 1.4 * v * v; stick(o, i, null, x, -0.86 - f, z, x, -0.8 - f * 0.96, z, 0.12 * Math.pow(1 - v, 0.7)); }
      }
      o.k = 0.16; o.glow = 1.25; o.jelly = 0.7; o.lean = 0.4;
      return;
    }
    case 'reform': { // droplets condense around the body and pull back in to merge
      ball(o, 0, M, 0, 0, 0, 0.6 * (1 + 0.025 * Math.sin(tau * 1.6)));
      for (let j = 1; j < 4; j++) { const a = tau * 0.5 + j * 2.094; ball(o, j, M, Math.cos(a) * 0.14, Math.sin(a * 0.8) * 0.1, Math.sin(a) * 0.14, 0.46); }
      for (let i = 4; i < 12; i++) {
        const d = DIRS[i - 4], u = fr(tau * 0.3 + (i - 4) / 8 + H1[i] * 0.06);
        const dist = 0.32 + 1.1 * Math.pow(1 - u, 1.6);
        ball(o, i, M, d[0] * dist, d[1] * dist, d[2] * dist, (0.1 + 0.07 * u) * sstep(0, 0.25, u));
      }
      o.k = 0.24; o.glow = 1; o.jelly = 1; o.lean = 0.8;
      return;
    }
    case 'ring': { // the loop: a liquid torus, beads riding it, droplets orbiting in another plane
      const Mr = mul3(M, mat3(1.1 + 0.08 * Math.sin(tau * 0.5), 0, 0.12), _m1);
      part(o, PART.torus, Mr, 0, 0, 0, 0, 1, 0, 0.72, 0.16 + 0.01 * Math.sin(tau * 1.4), 0);
      for (let j = 0; j < 4; j++) { const a = tau * 0.8 + j * 1.5708; ball(o, j, Mr, Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72, 0.19 + 0.025 * Math.sin(tau * 2 + j)); }
      const Mo = mul3(M, mat3(-0.55, tau * 0.55, 0.3), _m2);
      for (let j = 0; j < 3; j++) { const b = j * 2.094; ball(o, 4 + j, Mo, Math.cos(b) * 1.06, 0, Math.sin(b) * 1.06, 0.1); }
      o.k = 0.14; o.glow = 0.9; o.jelly = 0.8; o.lean = 0.8;
      return;
    }
    case 'split': { // Fund: droplets rain in from above and merge into one gathering body
      ball(o, 0, My, 0, -0.32, 0, 0.5 * (1 + 0.03 * Math.sin(tau * 2.1)));
      ball(o, 1, My, 0.3, -0.44, 0.06, 0.34);
      ball(o, 2, My, -0.28, -0.42, -0.1, 0.34);
      ball(o, 3, My, 0.02, -0.46, 0.3, 0.32);
      for (let i = 4; i < 12; i++) {
        const ph = fr(tau * 0.48 + (i - 4) / 8 + H1[i] * 0.04);
        const th = i * 2.399, rho = 0.1 + 0.4 * H2[i];
        const t = tf(My, Math.cos(th) * rho, 0, Math.sin(th) * rho), x = t[0], z = t[2];
        const y = 1.45 - 1.6 * ph * ph;
        stick(o, i, null, x, y, z, x, y + 0.05 + 0.16 * ph, z, (0.09 + 0.03 * H1[i]) * sstep(0, 0.12, ph));
      }
      o.k = 0.2; o.glow = 0.9; o.jelly = 1.1; o.lean = 0.5;
      return;
    }
    case 'vessel': { // Operate: a liquid bowl holding liquid, a drop falling in
      const Mv = mul3(My, mat3(0.42 + 0.05 * Math.sin(tau * 0.6), 0, 0.06 * Math.sin(tau * 0.45)), _m1);
      part(o, PART.bowl, Mv, 0, 0.1, 0, 0, 1, 0, 0.8, 0.065, 0.14);
      ball(o, 0, Mv, 0, -0.3, 0, 0.42);
      for (let j = 1; j < 4; j++) { const a = j * 2.094 + tau * 0.4; ball(o, j, Mv, Math.cos(a) * 0.24, -0.32 + 0.025 * Math.sin(tau * 1.8 + j), Math.sin(a) * 0.24, 0.35); }
      const ph = fr(tau * 0.38);
      ball(o, 4, null, 0.04, 1.35 - 1.55 * ph * ph, 0.05, 0.11 * sstep(0, 0.1, ph) * (1 - sstep(0.88, 1, ph)));
      o.k = 0.12; o.glow = 0.75; o.jelly = 0.6; o.lean = 0.5;
      return;
    }
    case 'disc': { // Prove: a glossy coin of liquid, rocking to show its face and edge; a bead runs the rim
      const Md = mul3(Mp, mat3(-0.5 + 0.12 * Math.sin(tau * 0.5), 0.85 * Math.sin(tau * 0.33), 0.1), _m1);
      part(o, PART.disc, Md, 0, 0, 0, 0, 0, 1, 0.74, 0.06, 0.09);
      const a = tau * 1.2;
      ball(o, 0, Md, Math.cos(a) * 0.83, Math.sin(a) * 0.83, 0, 0.11);
      ball(o, 1, Md, Math.cos(a + 3.14) * 0.83, Math.sin(a + 3.14) * 0.83, 0, 0.08);
      o.k = 0.1; o.glow = 0.85; o.jelly = 0.6; o.lean = 0.9;
      return;
    }
    case 'network': { // Grow: drops joined by thin liquid bridges, pulses flowing outward
      for (let k = 0; k < NET.length; k++) {
        const p = NET[k], pulse = 0.5 + 0.5 * Math.sin(tau * 2 - k * 1.1);
        ball(o, k, M, p[0], p[1], p[2], (k === 0 ? 0.3 : 0.19) * (1 + 0.12 * pulse));
      }
      for (let e = 0; e < EDGES.length; e++) {
        const p = NET[EDGES[e][0]], q = NET[EDGES[e][1]];
        stick(o, NET.length + e, M, p[0], p[1], p[2], q[0], q[1], q[2], 0.045 + 0.022 * (0.5 + 0.5 * Math.sin(tau * 3 + e * 1.7)));
      }
      o.k = 0.09; o.glow = 0.9; o.jelly = 0.8; o.lean = 0.8;
      return;
    }
    case 'orbit9': { // Team: nine droplets on three tilted orbits around a small core
      ball(o, 0, M, 0, 0, 0, 0.34 * (1 + 0.03 * Math.sin(tau * 1.5)));
      const mats = [_m1, _m2, _m3];
      for (let p = 0; p < 3; p++) {
        const t = ORBITS[p], Mo = mul3(M, mat3(t[0], t[1], t[2]), mats[p]);
        for (let j = 0; j < 3; j++) {
          const a = tau * (0.55 + 0.12 * p) * (p % 2 ? -1 : 1) + j * 2.094 + p;
          ball(o, 1 + p * 3 + j, Mo, Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95, 0.13);
        }
      }
      o.k = 0.1; o.glow = 0.9; o.jelly = 0.9; o.lean = 0.7;
      return;
    }
    case 'four': { // Get involved: four droplets in a row, hopping in turn (four doors)
      const Mf = mul3(Mp, mat3(0.18, 0.32 * Math.sin(tau * 0.3), 0), _m1);
      for (let j = 0; j < 4; j++) {
        const hop = Math.pow(Math.max(0, Math.sin(tau * 1.6 - j * 0.7)), 3) * 0.16;
        ball(o, j, Mf, (j - 1.5) * 0.56, hop - 0.02, 0, 0.23 * (1 + 0.04 * Math.sin(tau * 2.3 + j)));
      }
      o.k = 0.1; o.glow = 0.9; o.jelly = 1; o.lean = 0.8;
      return;
    }
  }
}
