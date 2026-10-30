// Raw WebGL view for the liquid drop: one full-screen canvas, one quad drawn only over the
// drop's screen bounding box, one fragment shader that RAYMARCHES a 3D signed-distance field:
// spheres/capsules plus one analytic part (torus, disc, bowl) smooth-unioned into one liquid
// body, seen through a perspective camera. Two cheap extras: a 2D full-screen liquid sheet
// (page changes, the home flood) and point-sprite droplets (the galaxy). No libraries.

import { ATLAS } from './icons.js?v=e09c939d0f';

const VS = `
attribute vec2 aP;
uniform vec4 uBox;
void main() { gl_Position = vec4(mix(uBox.xy, uBox.zw, aP), 0.0, 1.0); }`;

const FS = `
precision highp float;
#define N __N__
#define STEPS __S__
uniform vec2 uRes, uScale;
uniform vec4 uCam;   // centre x, y (css px, y down), radius (css px), camera distance (drop radii)
uniform vec4 uA[N];  // capsule start xyz + radius (drop-local, y up, +z toward camera)
uniform vec4 uB[N];  // capsule end xyz
uniform vec4 uS[6];  // two analytic parts: (c.xyz, type) (axis.xyz, weight) (R, r, x, -)
uniform vec4 uLook;  // paper amount, alpha, ink glow, paper shadow
uniform vec4 uShE;   // contact shadow ellipse (local): cx, cy, rx, ry
uniform vec4 uMisc;  // smoothing k, time, aa width (local), bound radius
uniform sampler2D uAtlas;
uniform vec4 uI0;    // icon: tile A, tile B, A->B mix, weight (0 melts it away)
uniform vec4 uI1;    // icon: scale, half thickness, bevel radius, idle wobble
uniform vec4 uI2;    // icon: detail depth (<0 carved, >0 embossed), cloth wave, -, core glow
uniform vec4 uI3;    // icon centre xyz, atlas ready
uniform mat3 uIM;    // drop-local -> icon rotation
uniform vec4 uSt;    // squash/stretch: screen dir xy, factor, cover ripple
uniform vec4 uX;     // paper surface amount, -, -, -
uniform float uSteps; // live step budget (<= STEPS): the frame-budget guard lowers it before resolution
#define COLS __C__
#define ROWS __R__
#define EXT __E__
#define RR __RR__
#define RG __RG__
#define HT __HT__

float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float sdCap(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float part(vec3 p, vec4 s0, vec4 s1, vec4 s2) {
  vec3 q = p - s0.xyz;
  float h = dot(q, s1.xyz);
  float rr = length(q - h * s1.xyz);
  float d;
  if (s0.w < 1.5) d = length(vec2(rr - s2.x, h)) - s2.y;                       // torus
  else if (s0.w < 2.5) {                                                         // disc / coin
    vec2 e = vec2(rr - s2.x, abs(h) - s2.y);
    d = min(max(e.x, e.y), 0.0) + length(max(e, 0.0)) - s2.z;
  } else {                                                                       // bowl, rim rounded
    d = max(abs(length(q) - s2.x) - s2.y, h - s2.z);
    float rim = sqrt(max(s2.x * s2.x - s2.z * s2.z, 0.0));
    d = min(d, length(vec2(rr - rim, h - s2.z)) - s2.y * 1.15);
  }
  return d + (1.0 - s1.w) * (0.25 + 0.6 * s2.x);   // weight < 1 melts it away
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
// atlas tiles: row 0 = silhouette SDF, row 1 = detail SDF, 16-bit (R hi byte, G lo byte). Linear
// filtering of the two bytes is exact, so the field is smooth to well under a texel.
float dec(vec4 c) { return (c.r * 65280.0 + c.g * 255.0) / 65535.0 - 0.5; }
vec2 atl(float tile, vec2 q) {
  vec2 c = clamp(q / EXT * 0.5 + 0.5, HT, 1.0 - HT);
  vec2 uv = vec2((tile + c.x) / COLS, (1.0 - c.y) / ROWS);
  return vec2(dec(texture2D(uAtlas, uv)) * 2.0 * RR, dec(texture2D(uAtlas, uv + vec2(0.0, 1.0 / ROWS))) * 2.0 * RG);
}
// ---- analytic 3D icons: puffy, perfectly smooth bodies (3D-emoji style); features carved with soft edges
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float sdCapT(vec3 p, vec3 a, vec3 b, float r1, float r2) {   // capsule tapering from r1 to r2
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(r1, r2, h);
}
float sdEll(vec3 p, vec3 r) { float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-5); }
float sdEll2(vec2 p, vec2 r) { float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-5); }
float sdArc(vec2 p, vec2 sc, float ra, float rb) {          // arc around +y, half aperture (sin, cos)
  p.x = abs(p.x);
  return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
}
float sdTrap(vec2 p, float r1, float r2, float he) {         // r1 bottom half width, r2 top
  vec2 k1 = vec2(r2, he), k2 = vec2(r2 - r1, 2.0 * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, (p.y < 0.0) ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
// carve the 2D feature field g into the front of body b: depth dep below the surface, soft edges k
float carve(float b, float g, vec3 q, float dep, float k) {
  float c = max(smax(g, -b - dep, k * 0.7), -q.z);
  return smax(b, -c, k);
}
// a mirrored D: a half disc (centre cx, radius R) bulging left, a flat side at xr, right corners rounded rc
float sdDee(vec2 p, float cx, float R, float xr, float rc) {
  if (p.x < cx) return max(length(p - vec2(cx, 0.0)) - R, p.x - xr);
  float x0 = cx - R;
  vec2 hb = vec2((xr - x0) * 0.5, R);
  vec2 e = abs(p - vec2(x0 + hb.x, 0.0)) - hb + rc;
  return min(max(e.x, e.y), 0.0) + length(max(e, 0.0)) - rc;
}
// the DAD logomark (brand svg, 1 unit = 56 svg units, centred): a puffy mirrored D with its counter,
// and two rounded motion bars to its right, the second shorter
float logoD(vec3 q) {
  float d2 = smax(sdDee(q.xy, -0.2054, 0.8929, 0.4732, 0.07), -sdDee(q.xy, -0.1696, 0.4643, 0.0446, 0.05), 0.03);
  vec2 w = vec2(d2 + 0.19, abs(q.z) - 0.2 + 0.19);
  float d = min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 0.19;
  vec3 r = vec3(q.xy, q.z * 0.85);
  d = min(d, sdCap(r, vec3(0.768, 0.507, 0.0), vec3(0.768, -0.507, 0.0), 0.1));
  return min(d, sdCap(r, vec3(1.045, 0.25, 0.0), vec3(1.045, -0.25, 0.0), 0.072));
}
// the pointing hand (a puffy 3D-emoji hand, back of the hand toward the reader): the index finger
// extended along +x, the other three fingers curled into the palm as rounded rolls, the thumb resting
// along the top, a short wrist on the left. Creases come from small smooth-union radii.
float handD(vec3 q) {
  vec3 r = vec3(q.xy, q.z * 1.25);
  float palm = sdEll(r - vec3(-0.3, -0.06, 0.0), vec3(0.44, 0.42, 0.34));
  float wrist = sdCapT(r, vec3(-0.62, -0.1, 0.0), vec3(-0.92, -0.12, 0.0), 0.27, 0.255);
  float d = smin(palm, wrist, 0.1);
  float idx = sdCapT(r, vec3(-0.08, 0.2, 0.02), vec3(0.78, 0.21, 0.02), 0.165, 0.145);
  d = smin(d, idx, 0.07);
  float c1 = sdCap(r, vec3(-0.1, -0.05, 0.03), vec3(0.14, -0.05, 0.03), 0.122);
  float c2 = sdCap(r, vec3(-0.12, -0.27, 0.02), vec3(0.11, -0.27, 0.02), 0.118);
  float c3 = sdCap(r, vec3(-0.15, -0.47, 0.0), vec3(0.05, -0.47, 0.0), 0.108);
  float curl = min(min(c1, c2), c3);
  d = smin(d, curl, 0.035);
  float th = sdCapT(r, vec3(-0.42, 0.3, 0.1), vec3(-0.02, 0.36, 0.17), 0.135, 0.115);
  d = smin(d, th, 0.04);
  // a soft nail on the fingertip and a crease line where the wrist meets the hand
  d = smax(d, -(length(r - vec3(0.7, 0.27, 0.21)) - 0.035), 0.03);
  return d / 1.25;
}
float sdRBox(vec3 p, vec3 b, float r) { vec3 e = abs(p) - b + r; return length(max(e, 0.0)) + min(max(e.x, max(e.y, e.z)), 0.0) - r; }
float sdRRect(vec2 p, vec2 b, float r) { vec2 e = abs(p) - b + r; return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r; }
// "code": a puffy liquid monitor on a short stand, the screen a soft recess; a 4 x 2 grid of raised
// liquid digits flips 1 <-> 0 in a checkerboard rhythm (each cell melts between the two glyphs)
float codeD(vec3 q) {
  float T = uMisc.y;
  vec3 s = q - vec3(0.0, 0.16, 0.0);
  float d = sdRBox(s, vec3(0.94, 0.64, 0.17), 0.15);
  d = smin(d, sdCapT(q, vec3(0.0, -0.42, -0.05), vec3(0.0, -0.7, -0.05), 0.1, 0.075), 0.08);
  d = smin(d, sdEll(q - vec3(0.0, -0.76, -0.02), vec3(0.44, 0.075, 0.22)), 0.08);
  // the screen: a rounded recess carved into the front face
  d = carve(d, sdRRect(s.xy, vec2(0.76, 0.47), 0.1), q, 0.075, 0.035);
  // the digit in this cell (cells 0.38 x 0.46; only the local cell is evaluated)
  vec2 c = clamp(floor((s.xy + vec2(0.76, 0.46)) / vec2(0.38, 0.46)), vec2(0.0), vec2(3.0, 1.0));
  vec2 l = s.xy - (vec2(-0.57, -0.23) + c * vec2(0.38, 0.46));
  float par = mod(c.x + c.y, 2.0);
  float m = smoothstep(-0.35, 0.35, sin(T * 2.6 + 3.14159 * par + c.x * 0.28));
  float one = min(sdSeg(l, vec2(0.012, -0.13), vec2(0.012, 0.13)), sdSeg(l, vec2(0.012, 0.13), vec2(-0.07, 0.07)));
  float zero = abs(sdEll2(l, vec2(0.085, 0.125)));
  float g = mix(one, zero, m);
  float dig = length(vec2(g, s.z - 0.1)) - 0.042;
  return smin(d, dig, 0.025);
}
// "hiker": a rounded liquid stick figure striding uphill, a flag on a pole in the front hand; the flag
// carries the DAD logomark (logoD) embossed on its face, riding the cloth wave
float hikerD(vec3 q) {
  float T = uMisc.y, w = T * 3.4;
  float bob = 0.04 * cos(2.0 * w);   // the hips ride highest mid-stride
  vec3 r = vec3(q.x, q.y + 0.03 - bob, q.z * 1.15);   // figure space (hips at y -0.2), on the slope
  vec3 hip = vec3(-0.06, -0.2, 0.0);
  float d = length(r - vec3(0.13, 0.42, 0.0)) - 0.17;                               // head
  d = smin(d, sdCapT(r, hip, vec3(0.07, 0.2, 0.0), 0.1, 0.085), 0.08);               // torso, leaning into the hill
  // legs: two strides in opposite phase, the swinging knee bends
  for (int k = 0; k < 2; k++) {
    float ph = w + 3.14159 * float(k);
    float th = 0.56 * sin(ph) + 0.12, fl = 0.7 * max(0.0, cos(ph));
    vec3 z = vec3(0.0, 0.0, k == 0 ? 0.07 : -0.07);
    vec3 kn = hip + 0.3 * vec3(sin(th), -cos(th), 0.0);
    vec3 ft = kn + 0.3 * vec3(sin(th - fl), -cos(th - fl), 0.0);
    kn.y += 0.15 * (kn.x - hip.x); ft.y += 0.3 * (ft.x - hip.x);   // uphill: the forward foot lands higher
    d = smin(d, min(sdCap(r, hip + z, kn + z, 0.072), sdCap(r, kn + z, ft + z + vec3(0.04, 0.0, 0.0), 0.068)), 0.05);
  }
  // the back arm swings with the stride; the front arm holds the pole
  vec3 sh = vec3(0.05, 0.12, 0.0), zb = vec3(0.0, 0.0, 0.08);
  float sa = -0.5 * sin(w);
  vec3 el = sh + 0.24 * vec3(sin(sa), -cos(sa), 0.0), hd = el + 0.2 * vec3(sin(sa + 0.5), -cos(sa + 0.5), 0.0);
  d = smin(d, min(sdCap(r, sh - zb, el - zb, 0.062), sdCap(r, el - zb, hd - zb, 0.058)), 0.05);
  d = smin(d, min(sdCap(r, sh + zb, vec3(0.22, -0.04, 0.08), 0.062), sdCap(r, vec3(0.22, -0.04, 0.08), vec3(0.35, 0.06, 0.06), 0.058)), 0.05);
  // the pole, a round cap on top
  d = smin(d, min(sdCap(r, vec3(0.36, -0.36, 0.06), vec3(0.36, 0.86, 0.06), 0.03), length(r - vec3(0.36, 0.89, 0.06)) - 0.046), 0.04);
  d /= 1.15;
  // the hill underfoot: a liquid slope rising to the right under the stride, flat underneath
  float hill = (q.y + 0.8 - 0.4 * q.x) / 1.08;
  hill = smax(hill, -1.06 - q.y, 0.05);
  hill = smax(hill, abs(q.z) - 0.22, 0.08);
  hill = smax(hill, max(-0.86 - q.x, q.x - 0.9), 0.12);
  d = smin(d, hill, 0.07);
  // the flag, waving off the pole, and the logomark embossed on its face
  vec3 f = q - vec3(0.36, -0.03 + bob, 0.06);
  float u = clamp(f.x / 0.58, 0.0, 1.0);
  f.z -= 0.06 * u * sin(u * 5.0 - T * 4.4);
  f.y -= 0.022 * u * sin(u * 4.0 - T * 4.4 + 1.0);
  vec3 fc = f - vec3(0.31, 0.6, 0.0);
  float flag = sdRBox(fc, vec3(0.28, 0.19, 0.026), 0.026);
  flag = smin(flag, logoD((fc - vec3(0.025, 0.0, 0.03)) / 0.135) * 0.135, 0.01);
  return smin(d, flag * 0.9, 0.03);
}
float icoA(float id, vec3 q) {
  if (id > 25.5) return hikerD(q);
  if (id > 24.5) return codeD(q);
  if (id < 16.5) {                                   // "!": a tapered bar and a dot
    vec3 r = vec3(q.xy, q.z * 1.15);
    return min(sdCapT(r, vec3(0.0, 0.7, 0.0), vec3(0.0, -0.2, 0.0), 0.25, 0.15), length(r - vec3(0.0, -0.68, 0.0)) - 0.2) / 1.15;
  }
  if (id > 23.5) return handD(q);
  if (id > 22.5) return logoD(q);
  if (id < 19.5 || id > 21.5) {                      // faces: a puffy pebble, features carved in
    float b = sdEll(q, vec3(0.93, 0.93, 0.52));
    vec2 p = vec2(abs(q.x), q.y);
    float g;
    if (id < 17.5) {        // annoyed: brows pulled down to the middle, flat mouth turned down at the ends
      g = sdSeg(p, vec2(0.58, 0.44), vec2(0.16, 0.27)) - 0.075;
      g = min(g, sdEll2(p - vec2(0.32, 0.06), vec2(0.1, 0.13)));
      g = min(g, min(sdSeg(p, vec2(0.0, -0.42), vec2(0.26, -0.42)), sdSeg(p, vec2(0.26, -0.42), vec2(0.36, -0.5))) - 0.07);
    } else if (id < 18.5) { // frown: sad brows (inner ends up), soft eyes, a frown
      g = sdSeg(p, vec2(0.56, 0.3), vec2(0.18, 0.44)) - 0.065;
      g = min(g, sdEll2(p - vec2(0.3, 0.08), vec2(0.1, 0.14)));
      g = min(g, sdArc(vec2(q.x, q.y + 0.78), vec2(0.788, 0.616), 0.4, 0.075));
    } else if (id > 21.5) { // shocked: raised arched brows, wide round eyes, a round open "O" mouth
      g = sdArc(p - vec2(0.31, 0.37), vec2(0.766, 0.643), 0.2, 0.052);
      g = min(g, sdEll2(p - vec2(0.31, 0.07), vec2(0.13, 0.15)));
      g = min(g, sdEll2(q.xy - vec2(0.0, -0.44), vec2(0.155, 0.19)));
    } else {                // angry: sharp V brows, narrowed eyes, an open shouting mouth
      g = sdSeg(p, vec2(0.55, 0.49), vec2(0.1, 0.24)) - 0.085;
      g = min(g, sdEll2(p - vec2(0.3, 0.02), vec2(0.11, 0.085)));
      g = min(g, sdTrap(p - vec2(0.0, -0.48), 0.33, 0.2, 0.09) - 0.05);
    }
    return carve(b, g, q, 0.11, 0.045);
  }
  if (id < 20.5) {                                   // flex: a flexed arm, shoulder right, fist up left
    vec3 r = vec3(q.xy, q.z * 1.2);
    float d = sdCapT(r, vec3(0.84, -0.56, 0.0), vec3(-0.3, -0.5, 0.0), 0.24, 0.22);
    d = smin(d, sdEll(r - vec3(0.1, -0.22, 0.04), vec3(0.45, 0.37, 0.36)), 0.12);
    d = smin(d, sdCapT(r, vec3(-0.46, -0.44, 0.0), vec3(-0.3, 0.36, 0.0), 0.21, 0.17), 0.1);
    d = smin(d, sdEll(r - vec3(-0.14, 0.58, 0.02), vec3(0.31, 0.26, 0.25)), 0.08) / 1.2;
    float g = min(sdSeg(q.xy, vec2(-0.06, 0.74), vec2(0.0, 0.54)), sdSeg(q.xy, vec2(-0.25, 0.78), vec2(-0.2, 0.54))) - 0.028;
    return carve(d, g, q, 0.045, 0.03);
  }
  // people: two puffy busts, the left one's arm around the right one's shoulder
  vec3 r = vec3(q.xy, q.z * 1.3);
  float h = min(length(r - vec3(-0.4, 0.5, 0.0)) - 0.24, length(r - vec3(0.4, 0.54, 0.0)) - 0.24);
  float b = min(sdCapT(r, vec3(-0.4, -0.14, 0.0), vec3(-0.4, -0.62, 0.0), 0.33, 0.36), sdCapT(r, vec3(0.4, -0.12, 0.0), vec3(0.4, -0.62, 0.0), 0.33, 0.36));
  b = smax(b, -0.8 - r.y, 0.06);
  float arm = min(min(sdCap(r, vec3(-0.2, -0.02, 0.3), vec3(0.12, 0.12, 0.3), 0.09), sdCap(r, vec3(0.12, 0.12, 0.3), vec3(0.5, 0.16, 0.3), 0.09)), sdCap(r, vec3(0.5, 0.16, 0.3), vec3(0.74, 0.08, 0.24), 0.09));
  return min(smin(b, arm, 0.05), h) / 1.3;
}
// one icon: analytic (id >= 16) or an atlas tile extruded with a rounded bevel, details carved/embossed
float iconD(float id, vec3 q) {
  if (id > 15.5) return icoA(id, q);
  vec2 a = atl(id, q.xy);
  float d2 = a.x + length(max(abs(q.xy) - EXT * 0.97, 0.0));
  float h = uI1.y, r = uI1.z;
  vec2 w = vec2(d2 + r, abs(q.z) - h + r);
  float d = min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - r;
  float dep = uI2.x, g = a.y;
  if (dep < -0.001) d = smax(d, -max(g, h + dep - q.z), 0.035);
  // embossed (the bill): a shallow, soft, rounded relief instead of a sheer-walled plateau, so the lines
  // stay glossy liquid and never fall into dark crevices; front face only
  else if (dep > 0.001) return (d - dep * smoothstep(0.045, -0.025, g) * smoothstep(-0.02, h, q.z)) * 0.88;
  return d;
}
// the icon in drop space: two icons blend, so any icon melts into any other; one gentle wobble
float icon(vec3 p) {
  float s = uI1.x, T = uMisc.y;
  vec3 q = uIM * (p - uI3.xyz) / s;
  if (uI2.y > 0.001) {           // cloth in wind (domain warp)
    float fl = 0.35 + 0.65 * smoothstep(-1.0, 1.0, q.x);
    q.z += uI2.y * fl * (0.11 * sin(q.x * 2.6 - T * 3.1) + 0.04 * sin(q.x * 4.6 + q.y * 2.2 - T * 4.7));
    q.y += uI2.y * fl * 0.035 * sin(q.x * 3.0 - T * 3.1 + 0.8);
  }
  float t = uI0.z;
  float d = iconD(uI0.x, q);
  if (t > 0.001) d = mix(d, iconD(uI0.y, q), t);
  d += (uI1.w + 0.09 * sin(3.14159 * t)) * sin(dot(q.xy, vec2(2.9, 2.2)) + T * 1.9);
  return (d + (1.0 - uI0.w) * 1.3) * s;
}
float map(vec3 p) {
  float k = uMisc.x;
  float f = uSt.z;
  if (abs(f - 1.0) > 0.002) {    // squash / stretch along a screen direction, volume kept
    float al = dot(p.xy, uSt.xy);
    p.xy = uSt.xy * (al / f) + (p.xy - uSt.xy * al) * sqrt(f);
  }
  float sc = min(f, inversesqrt(f));
  float d = 1e3;
  for (int i = 0; i < N; i++) {
    vec4 a = uA[i];
    if (a.w > 0.003) d = smin(d, sdCap(p, a.xyz, uB[i].xyz, a.w), min(k, a.w * 1.6 + 0.02));
  }
  if (uS[1].w > 0.01) d = smin(d, part(p, uS[0], uS[1], uS[2]), k);
  if (uS[4].w > 0.01) d = smin(d, part(p, uS[3], uS[4], uS[5]), k);
  if (uI0.w > 0.01 && uI3.w > 0.5) d = smin(d, icon(p), max(k, 0.06));
  if (uSt.w > 0.001) d += uSt.w * 0.035 * sin(p.x * 6.0 + uMisc.y * 2.2) * sin(p.y * 5.0 - uMisc.y * 1.7 + p.x);
  return d * sc;
}
// normals over a footprint of ~3/4 pixel (never under 1.5 atlas texels): smooth, no per-pixel grain
vec3 calcN(vec3 p, float h) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * h) + k.yyx * map(p + k.yyx * h) + k.yxy * map(p + k.yxy * h) + k.xxx * map(p + k.xxx * h));
}
float sbox(vec2 q, vec2 c, vec2 s, float soft) { return 1.0 - smoothstep(0.0, soft, length(max(abs(q - c) - s, 0.0))); }
// studio: a floor/ceiling gradient plus three softboxes (key top-left, strip right, top bounce)
vec3 envBase(vec3 R, float lt) {
  vec3 lo = mix(vec3(0.05, 0.09, 0.09), vec3(0.52, 0.34, 0.27), lt);
  vec3 hi = mix(vec3(0.34, 0.22, 0.2), vec3(0.95, 0.9, 0.85), lt);
  return mix(lo, hi, smoothstep(-0.35, 0.6, R.y));
}
float softbox(vec3 R) {
  vec2 q = R.xy / (1.0 + max(R.z, -0.5));
  return sbox(q, vec2(-0.42, 0.5), vec2(0.2, 0.12), 0.12) * 1.5
       + sbox(q, vec2(0.8, 0.04), vec2(0.045, 0.42), 0.08) * 0.8
       + sbox(q, vec2(0.0, 0.98), vec2(0.6, 0.05), 0.2) * 0.35;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x / uScale.x, (uRes.y - gl_FragCoord.y) / uScale.y);
  vec2 uv = (p - uCam.xy) / uCam.z;
  uv.y = -uv.y;
  float D = uCam.w;
  vec3 ro = vec3(0.0, 0.0, D);
  vec3 rd = normalize(vec3(uv, -D));
  float Bd = uMisc.w;
  float b = dot(ro, rd), c = dot(ro, ro) - Bd * Bd, h = b * b - c;
  float px = uMisc.z;   // one device pixel, in drop units, at the drop's plane
  float dmin = 1e3, tm = -b;
  bool hit = false;
  float eps = max(px * 0.12, 0.00015);
  if (h < 0.0) {
    dmin = map(ro + rd * tm);
  } else {
    // over-relaxed sphere tracing (steps 1.3x the safe distance, backing off on overshoot). Between
    // samples the closest approach is estimated from the two empty spheres, so the silhouette distance
    // (coverage) and the glow are smooth instead of jumping between discrete samples.
    h = sqrt(h);
    float t = max(-b - h, 0.0), t1 = -b + h;
    float w = 1.3, rp = 0.0, stp = 0.0;
    for (int i = 0; i < STEPS; i++) {
      if (float(i) >= uSteps) break;
      float d = map(ro + rd * t), r = abs(d);
      if (w > 1.0 && r + rp < stp) { stp -= w * stp; w = 1.0; }
      else {
        if (d < eps) { hit = true; tm = t; break; }
        if (d < dmin) { dmin = d; tm = t; }
        if (stp > 0.0 && d < px * 5.0 && rp < px * 8.0) {   // only near the silhouette
          float s = (rp * rp - d * d + stp * stp) / (2.0 * stp);
          if (s > 0.0 && s < stp) { float e = sqrt(max(rp * rp - s * s, 0.0)); if (e < dmin) { dmin = e; tm = t - stp + s; } }
        }
        stp = d * w;
      }
      rp = r;
      t += stp;
      if (t > t1) break;
    }
    if (hit) { tm += map(ro + rd * tm); tm += map(ro + rd * tm); }   // refine onto the surface
  }
  float lt = uLook.x;
  vec4 col = vec4(0.0);
  // analytic coverage: a smooth ramp over ~1.25 pixels of closest-approach distance (no hard alpha cut)
  float cov = hit ? 1.0 : 1.0 - smoothstep(0.0, px * 1.25, dmin);
  if (cov > 0.002) {
    vec3 pos = ro + rd * tm;
    float hN = clamp(px * 0.75, 0.0012, 0.03);
    if (uI0.w > 0.01 && min(uI0.x, uI0.y) < 15.5) hN = max(hN, 0.0095 * uI1.x);
    vec3 n = calcN(pos, hN);
    vec3 V = -rd;
    vec3 L = normalize(vec3(-0.5, 0.75, 0.6));
    float nv = clamp(dot(n, V), 0.0, 1.0);
    // 0 right at the silhouette: the grazing terms (rim, fresnel, softboxes, sparkle) fade out there, so
    // the outermost pixels keep the liquid's own colour: no white or speckled fringe on ink or paper
    float edge = smoothstep(0.0, 0.32, nv);
    float wrap = dot(n, L) * 0.5 + 0.5;
    vec3 red = vec3(1.0, 0.29, 0.133);
    vec3 deep = mix(vec3(0.34, 0.035, 0.02), vec3(0.5, 0.06, 0.025), lt);
    // ambient occlusion: carved features and creases darken softly, so faces read crisply
    float ao = 0.42 + 0.58 * clamp(map(pos + n * 0.07) / 0.07, 0.0, 1.0);
    vec3 hot = vec3(1.0, 0.6, 0.3);
    vec3 col3 = mix(deep, red, smoothstep(0.08, 0.9, wrap));
    // subsurface: thin parts let light through, the core glows from inside
    float thick = clamp(-map(pos - n * 0.3) / 0.3, 0.0, 1.0);
    float thinK = 1.0 - 0.75 * clamp(uI2.y, 0.0, 1.0) * uI0.w;   // a flat bill is thin everywhere: don't let it wash out
    col3 += hot * (0.3 * (1.0 - thick) * thinK + 0.16 * nv * nv) * (0.45 + 0.55 * wrap);
    col3 *= ao;
    // rim light from behind-right
    vec3 Lr = normalize(vec3(0.75, 0.15, -0.65));
    col3 += vec3(1.0, 0.72, 0.5) * pow(1.0 - nv, 3.0) * edge * clamp(dot(n, Lr) + 0.45, 0.0, 1.0) * mix(0.75, 0.45, lt);
    // studio reflection with fresnel (warm-tinted, capped toward the silhouette)
    float fres = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
    vec3 R = reflect(rd, n);
    col3 = mix(col3, envBase(R, lt) * vec3(1.0, 0.86, 0.78), fres * 0.8 * mix(0.3, 1.0, edge));
    col3 += vec3(1.0, 0.97, 0.93) * softbox(R) * (0.5 + 0.5 * fres) * (0.3 + 0.7 * ao) * smoothstep(0.06, 0.4, nv);
    // key specular (clamped, faded at grazing angles: no sparkle)
    col3 += vec3(1.0, 0.97, 0.92) * min(pow(max(dot(n, normalize(L + V)), 0.0), 140.0) * 1.3, 1.1) * ao * smoothstep(0.12, 0.4, nv);
    // a faint, slow gold/cyan sheen inside the edge
    vec3 irc = mix(vec3(1.0, 0.76, 0.22), vec3(0.25, 0.86, 1.0), 0.5 + 0.5 * sin(nv * 5.0 + n.y * 2.0 + uMisc.y * 0.4));
    col3 += irc * pow(1.0 - nv, 2.2) * edge * mix(0.13, 0.08, lt);
    // a bright core (galaxy)
    col3 += vec3(1.0, 0.84, 0.58) * uI2.w * exp(-dot(pos, pos) * 22.0) * 1.6;
    // crisp, slightly darker silhouette on warm paper
    col3 *= 1.0 - lt * 0.2 * smoothstep(0.7, 0.98, 1.0 - nv);
    // the surface turns into warm paper (the dark-to-light flood)
    col3 = mix(col3, vec3(0.984, 0.961, 0.933), uX.x);
    float a = cov * uLook.y;
    col = vec4(clamp(col3, 0.0, 1.0) * a, a);
  }
  if (!hit) {
    if (uLook.z > 0.001) {           // ink: warm glow around the body
      // its distance is the field on the plane through the drop's centre (one smooth, continuous value
      // per pixel); the marched closest approach only takes over right at the silhouette, where it is
      // exact. The marched value alone is sparse in open space and different outside the bounding
      // sphere, which drew a hard-edged disc and blocky halos around small orbs.
      float gp = h < 0.0 ? dmin : map(ro - rd * b);
      float gd = mix(min(dmin, gp), gp, smoothstep(px * 3.0, 0.12, dmin));
      float g = clamp(1.0 - max(gd, 0.0) / 0.6, 0.0, 1.0);
      g = uLook.z * g * g * g * uLook.y;
      col += vec4(vec3(1.0, 0.36, 0.16) * g, g) * (1.0 - col.a);
    }
    if (uLook.w > 0.001) {           // paper: soft warm contact shadow, sized from the body
      float s = uLook.w * (1.0 - smoothstep(0.15, 1.0, length((uv - uShE.xy) / uShE.zw))) * uLook.y;
      col += vec4(vec3(0.42, 0.18, 0.08) * s, s) * (1.0 - col.a);
    }
  }
  gl_FragColor = col;
}`;

// THE SHEET: a cheap 2D full-screen pass for the moments the liquid fills the screen (page changes,
// the home flood). No raymarch, no noise: a smoothly warped disc (the organic liquid front) shaded as a glossy
// dome with travelling surface waves, moving highlights from the same studio, and caustics. Once the
// disc is bigger than the screen we are "inside the liquid". uP.y turns the surface to warm paper.
const SHEET_FS = `
precision highp float;
uniform vec2 uRes, uScale;
uniform vec4 uC;   // centre x, y (css px, y down), radius (css px), inside amount
uniform vec4 uP;   // time, paper, alpha, swirl angle
uniform vec4 uQ;   // front warp, light theme, -, -
float sbox(vec2 q, vec2 c, vec2 s, float soft) { return 1.0 - smoothstep(0.0, soft, length(max(abs(q - c) - s, 0.0))); }
vec3 envBase(vec3 R, float lt) {
  vec3 lo = mix(vec3(0.05, 0.09, 0.09), vec3(0.52, 0.34, 0.27), lt);
  vec3 hi = mix(vec3(0.34, 0.22, 0.2), vec3(0.95, 0.9, 0.85), lt);
  return mix(lo, hi, smoothstep(-0.35, 0.6, R.y));
}
float softbox(vec3 R) {
  vec2 q = R.xy / (1.0 + max(R.z, -0.5));
  return sbox(q, vec2(-0.42, 0.5), vec2(0.2, 0.12), 0.12) * 1.5
       + sbox(q, vec2(0.8, 0.04), vec2(0.045, 0.42), 0.08) * 0.8
       + sbox(q, vec2(0.0, 0.98), vec2(0.6, 0.05), 0.2) * 0.35;
}
// light focused by a moving surface (a few trig iterations, tileable)
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.2831, 6.2831) - 250.0, i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005)));
  }
  c = 1.17 - pow(c / 4.0, 1.4);
  return pow(abs(c), 6.0);
}
void main() {
  vec2 vp = uRes / uScale;
  vec2 p = vec2(gl_FragCoord.x / uScale.x, (uRes.y - gl_FragCoord.y) / uScale.y);
  float T = uP.x, lt = uQ.y, ins = uC.w;
  vec2 d = p - uC.xy;
  float r = length(d);
  vec2 dir = d / max(r, 0.001);
  // the front: a circle whose radius breathes with noise sampled around it
  float an = atan(d.y, d.x);   // smooth, seamless (integer harmonics of the angle): no noise creases
  float w = 0.5 + 0.22 * sin(3.0 * an + T * 0.9) + 0.16 * sin(5.0 * an - T * 1.3 + 1.7) + 0.12 * sin(2.0 * an + T * 0.6 + 4.1);
  float Re = uC.z * (1.0 + uQ.x * (w - 0.5) * 2.0);
  float aw = 0.9 / uScale.x;   // ~1.8 device px of anti-aliasing at the front
  float cov = 1.0 - smoothstep(Re - aw, Re + aw, r);
  if (cov <= 0.001) { gl_FragColor = vec4(0.0); return; }
  float s = clamp(r / Re, 0.0, 0.999), m = min(vp.x, vp.y);
  // a dome (the drop seen from outside) plus travelling waves, stronger once we are inside
  float ca = cos(uP.w), sa = sin(uP.w);
  vec2 q = mat2(ca, -sa, sa, ca) * d / m * 3.2;
  vec2 g = vec2(1.3, 0.6) * cos(dot(vec2(1.3, 0.6), q) - T * 1.3) * 0.5
         + vec2(-0.7, 1.4) * cos(dot(vec2(-0.7, 1.4), q) + T * 1.05) * 0.42
         + vec2(2.3, -1.1) * cos(dot(vec2(2.3, -1.1), q) - T * 1.9) * 0.2
         + vec2(-1.6, -1.9) * cos(dot(vec2(-1.6, -1.9), q) + T * 0.8 + 2.0) * 0.16;
  vec3 n = normalize(vec3(dir.x * s + g.x * (0.07 + 0.16 * ins), -dir.y * s - g.y * (0.07 + 0.16 * ins), sqrt(1.0 - s * s)));
  vec3 L = normalize(vec3(-0.5, 0.75, 0.6));
  float nv = clamp(n.z, 0.0, 1.0), wrap = dot(n, L) * 0.5 + 0.5;
  vec3 deep = mix(vec3(0.34, 0.035, 0.02), vec3(0.5, 0.06, 0.025), lt);
  vec3 col = mix(deep, vec3(1.0, 0.29, 0.133), smoothstep(0.08, 0.9, wrap));
  col += vec3(1.0, 0.6, 0.3) * (0.12 + 0.16 * nv * nv) * (0.45 + 0.55 * wrap);
  col = mix(col, col * vec3(0.78, 0.6, 0.55), ins * smoothstep(0.35, 1.1, length((p - 0.5 * vp) / m)));
  float edge = smoothstep(0.0, 0.32, nv);   // same silhouette treatment as the raymarched body
  col += vec3(1.0, 0.72, 0.5) * pow(1.0 - nv, 3.0) * edge * mix(0.75, 0.45, lt);
  float fres = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  vec3 R = vec3(2.0 * n.z * n.x, 2.0 * n.z * n.y, 2.0 * n.z * n.z - 1.0);
  col = mix(col, envBase(R, lt) * vec3(1.0, 0.86, 0.78), fres * 0.8 * mix(0.3, 1.0, edge));
  float sb = softbox(R) * smoothstep(0.06, 0.4, nv), sp = min(pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 140.0) * 1.3, 1.1);
  col += vec3(1.0, 0.97, 0.93) * sb * (0.5 + 0.5 * fres) * (1.0 - 0.45 * ins);
  col += vec3(1.0, 0.97, 0.92) * sp;
  float cs = caustic(q * 0.22, T * 0.55 + 23.0);
  col += vec3(1.0, 0.8, 0.5) * cs * (0.05 + 0.28 * ins) * (0.6 + 0.4 * wrap);
  col += vec3(1.0, 0.82, 0.62) * smoothstep(Re - 10.0, Re - 2.0, r) * (1.0 - smoothstep(Re - 2.0, Re, r)) * 0.22;   // the meniscus, just inside the front
  // flood: the surface turns to warm paper, the middle first, the front last
  float pr = clamp(uP.y * 1.7 - s * 0.7, 0.0, 1.0);
  pr = pr * pr * (3.0 - 2.0 * pr);
  float gw = 1.0 - uP.y;
  vec3 paper = vec3(0.984, 0.961, 0.933) + vec3(1.0, 0.97, 0.93) * (sb * 0.16 + sp * 0.5 + cs * 0.1) * gw - vec3(0.05, 0.08, 0.1) * pow(1.0 - nv, 2.0) * gw;
  col = mix(col, paper, pr);
  float a = cov * uP.z;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * a, a);
}`;

// THE GALAXY: point sprites, each a tiny glossy droplet shaded like a sphere, on a 2-arm logarithmic
// spiral around the raymarched core. Drawn in two halves (behind, then in front of the core).
// uG.y morphs: 0 = every droplet inside the core, 1 = the spiral; they peel off and swirl out.
const GAL_VS = `
attribute vec4 aA;   // arm angle, radius, height, -
attribute vec4 aB;   // size (drop units), morph delay, brightness, -
uniform vec2 uVp;
uniform vec4 uCam;   // centre x, y (css px), R (css px), camera distance
uniform vec4 uG;     // spin, morph, alpha, side (1 front, -1 behind)
uniform vec4 uG2;    // device px per css px, light, core radius, -
uniform mat3 uM;
varying vec4 vS;
void main() {
  float rr = aA.y;
  float th = aA.x + log(rr / 0.13) / 0.42 - uG.x * (0.75 + 0.2 / (0.3 + rr));
  vec3 pf = vec3(cos(th) * rr, aA.z, sin(th) * rr);
  float m = clamp((uG.y - aB.y * 0.4) / 0.6, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);
  vec3 pm = mix(normalize(pf) * uG2.z, pf, m);
  float sw = (1.0 - m) * 1.6, c = cos(sw), s = sin(sw);
  pm.xz = vec2(c * pm.x - s * pm.z, s * pm.x + c * pm.z);
  vec3 p = uM * pm;
  float D = uCam.w, k = D / max(D - p.z, 0.3);
  vec2 scr = uCam.xy + uCam.z * vec2(p.x, -p.y) * k;
  float on = uG.w > 0.0 ? step(0.0, p.z) : 1.0 - step(0.0, p.z);
  float blur = clamp(abs(p.z) * 1.1, 0.0, 1.0);   // slight depth of field around the core's plane
  gl_Position = on > 0.5 ? vec4(scr.x / uVp.x * 2.0 - 1.0, 1.0 - scr.y / uVp.y * 2.0, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = on * max(1.0, aB.x * (0.3 + 0.7 * m) * uCam.z * 2.0 * k * (1.0 + 0.5 * blur) * uG2.x);
  vS = vec4(aB.z * (1.0 + 0.7 * exp(-rr * 5.0)), blur, uG.z * smoothstep(0.0, 0.3, m) / (1.0 + 0.7 * blur), uG2.y);
}`;
const GAL_FS = `
precision mediump float;
varying vec4 vS;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float edge = 1.0 - smoothstep(0.82 - 0.6 * vS.y, 1.0, r2);
  vec3 n = vec3(c.x, -c.y, sqrt(1.0 - r2));
  vec3 L = normalize(vec3(-0.5, 0.75, 0.6));
  float wrap = dot(n, L) * 0.5 + 0.5;
  vec3 col = mix(mix(vec3(0.34, 0.035, 0.02), vec3(0.5, 0.06, 0.025), vS.w), vec3(1.0, 0.29, 0.133), smoothstep(0.08, 0.9, wrap));
  col += vec3(1.0, 0.6, 0.3) * 0.22 * n.z * n.z + vec3(1.0, 0.72, 0.5) * pow(1.0 - n.z, 3.0) * 0.35;
  col += vec3(1.0, 0.97, 0.92) * pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 28.0) * 1.2 * (1.0 - vS.y);
  float a = edge * vS.z;
  gl_FragColor = vec4(clamp(col * vS.x, 0.0, 1.0) * a, a);
}`;

const NO_ICON = new Float32Array(16), ID3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const NO_ST = new Float32Array([1, 0, 1, 0]), NO_X = new Float32Array(4);
let atlasP = null;
function loadAtlas() {
  if (!atlasP) {
    if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
      atlasP = new Promise((res, rej) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = ATLAS.url;
      });
    } else {
      atlasP = fetch(new URL(ATLAS.url, self.location.origin)).then((r) => r.blob()).then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
    }
  }
  return atlasP;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}

export class View {
  constructor(canvas, n, steps = 64) {
    const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('no webgl context');
    const lim = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 16;
    this.n = Math.max(6, Math.min(n, Math.floor((lim - 28) / 2)));
    this.gl = gl; this.canvas = canvas;
    const pr = this.prog = gl.createProgram();
    gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, VS));
    const f1 = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
    const fs = FS.replace('__N__', String(this.n)).replace('__S__', String(steps | 0))
      .replace('__C__', f1(ATLAS.cols)).replace('__R__', f1(ATLAS.rows)).replace('__E__', f1(ATLAS.ext))
      .replace('__RR__', f1(ATLAS.rangeR)).replace('__RG__', f1(ATLAS.rangeG)).replace('__HT__', String(0.5 / ATLAS.tile));
    gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(pr, 0, 'aP');
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const buf = this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // premultiplied output: blending onto a cleared canvas is identical to no blending,
    // and it lets extra small bodies (rain droplets) composite over the main drop
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    this.u = {};
    for (const k of ['uBox', 'uRes', 'uScale', 'uCam', 'uA', 'uB', 'uS', 'uLook', 'uShE', 'uMisc', 'uAtlas', 'uI0', 'uI1', 'uI2', 'uI3', 'uIM', 'uSt', 'uX', 'uSteps']) {
      this.u[k] = gl.getUniformLocation(pr, k) || gl.getUniformLocation(pr, k + '[0]');
    }
    // the icon atlas: 16-bit SDF tiles (two bytes), linear filtered, loaded once per page and shared by contexts
    this.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 0]));
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.uniform1i(this.u.uAtlas, 0);
    this.atlasReady = false;
    this.steps = steps | 0;
    gl.uniform1f(this.u.uSteps, this.steps);
    this.drawn = true;
  }

  // the icon atlas: fetched when the host says so (an idle moment after load), then cached
  loadAtlas() {
    if (this._atlasReq) return this._atlasReq;
    const gl = this.gl;
    return (this._atlasReq = loadAtlas().then((img) => {
      if (gl.isContextLost()) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      this.atlasReady = true;
    }).catch(() => {}));
  }

  setSteps(n) {
    this.steps = n;
    this.gl.useProgram(this.prog);
    this.gl.uniform1f(this.u.uSteps, n);
  }

  // pre-warm: run the body program over a 2x2 pixel box (every formation once, at load), then wipe it
  warmDraw(P) {
    const b = P.box; b[0] = 0; b[1] = 0; b[2] = 2; b[3] = 2;
    this.draw(P, true);
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawn = true;
  }

  resize(W, H, scale) {
    const c = this.canvas;
    const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    this.W = W; this.H = H; this.sx = w / W; this.sy = h / H;
    this.drawn = true;
  }

  clear() {
    if (!this.drawn) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawn = false;
  }

  // p: { box:[x0,y0,x1,y1] css px, cam:[x,y,Rpx,D], A, B (n*4), S (24), look[4], she[4], k, time, bound }
  // keep: draw over what is already there (no clear), e.g. rain droplets after the main drop
  // a small extra program (sheet, galaxy), compiled on first use
  _extra(vs, fs, attrs, names) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {};
    names.forEach((k) => { u[k] = gl.getUniformLocation(p, k); });
    return { p, u };
  }
  _quad(prog) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1);
  }
  // compile the extra programs ahead of time (an idle moment), so a page change never stalls on them
  warm() {
    try { if (!this.sh) this.sh = this._extra(VS, SHEET_FS, ['aP'], ['uBox', 'uRes', 'uScale', 'uC', 'uP', 'uQ']); } catch (e) { this.sheetFailed = true; }
    try { if (!this.gx) this.gx = this._extra(GAL_VS, GAL_FS, ['aA', 'aB'], ['uVp', 'uCam', 'uG', 'uG2', 'uM']); } catch (e) { /* galaxy optional */ }
    // run the sheet once over a tiny box so its first real use never stalls
    if (this.sh) { this.drawSheet({ x: 1, y: 1, R: 1, inside: 0, time: 0, paper: 0, alpha: 0.001, swirl: 0, warp: 0, light: 0 }, true); this.gl.clear(this.gl.COLOR_BUFFER_BIT); this.drawn = true; }
  }

  // the 2D liquid sheet. s: { x, y, R (css px), inside, time, paper, alpha, swirl, warp, light }
  drawSheet(s, keep = false) {
    if (!this.sh) this.warm();
    if (!this.sh) return false;
    const gl = this.gl, u = this.sh.u, W = this.W, H = this.H;
    this._quad(this.sh.p);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (!keep) gl.clear(gl.COLOR_BUFFER_BIT);
    const e = s.R * (1 + s.warp) + 3;
    const b0 = Math.max(0, s.x - e), b1 = Math.max(0, s.y - e), b2 = Math.min(W, s.x + e), b3 = Math.min(H, s.y + e);
    if (b2 > b0 && b3 > b1) {
      gl.uniform4f(u.uBox, b0 / W * 2 - 1, 1 - b1 / H * 2, b2 / W * 2 - 1, 1 - b3 / H * 2);
      gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform2f(u.uScale, this.sx, this.sy);
      gl.uniform4f(u.uC, s.x, s.y, s.R, s.inside);
      gl.uniform4f(u.uP, s.time % 600, s.paper, s.alpha, s.swirl);
      gl.uniform4f(u.uQ, s.warp, s.light, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.drawn = true;
    return true;
  }

  // galaxy droplets: data = Float32Array of 8 floats per droplet (aA, aB)
  setGalaxy(data) {
    const gl = this.gl;
    if (!this.gx) this.gx = this._extra(GAL_VS, GAL_FS, ['aA', 'aB'], ['uVp', 'uCam', 'uG', 'uG2', 'uM']);
    if (!this.gbuf) this.gbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gbuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.gn = data.length / 8;
  }
  // g: { x, y, R, spin, morph, alpha, side, light, core, M (column-major mat3) }
  drawGalaxy(g) {
    if (!this.gx || !this.gn) return;
    const gl = this.gl, u = this.gx.u;
    gl.useProgram(this.gx.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gbuf);
    gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uVp, this.W, this.H);
    gl.uniform4f(u.uCam, g.x, g.y, g.R, g.D);
    gl.uniform4f(u.uG, g.spin, g.morph, g.alpha, g.side);
    gl.uniform4f(u.uG2, this.sx, g.light, g.core, 0);
    gl.uniformMatrix3fv(u.uM, false, g.M);
    gl.drawArrays(gl.POINTS, 0, this.gn);
    this.drawn = true;
  }

  draw(p, keep = false) {
    const gl = this.gl, u = this.u, W = this.W, H = this.H;
    this._quad(this.prog);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (!keep) gl.clear(gl.COLOR_BUFFER_BIT);
    const b = p.box;
    gl.uniform4f(u.uBox, b[0] / W * 2 - 1, 1 - b[1] / H * 2, b[2] / W * 2 - 1, 1 - b[3] / H * 2);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uScale, this.sx, this.sy);
    gl.uniform4f(u.uCam, p.cam[0], p.cam[1], p.cam[2], p.cam[3]);
    gl.uniform4fv(u.uA, p.A);
    gl.uniform4fv(u.uB, p.B);
    gl.uniform4fv(u.uS, p.S);
    gl.uniform4fv(u.uLook, p.look);
    gl.uniform4fv(u.uShE, p.she);
    gl.uniform4f(u.uMisc, p.k, p.time, 1 / Math.max(1e-3, p.cam[2] * this.sx), p.bound);
    const I = p.I || NO_ICON;
    // analytic icons (ids 16+) need no atlas: they show from the first frame
    const ok = this.atlasReady || (I[0] > 15.5 && (I[2] < 0.001 || I[1] > 15.5));
    gl.uniform4f(u.uI0, I[0], I[1], I[2], ok ? I[3] : 0);
    gl.uniform4f(u.uI1, I[4], I[5], I[6], I[7]);
    gl.uniform4f(u.uI2, I[8], I[9], I[10], I[11]);
    gl.uniform4f(u.uI3, I[12], I[13], I[14], ok ? 1 : 0);
    gl.uniformMatrix3fv(u.uIM, false, p.IM || ID3);
    gl.uniform4fv(u.uSt, p.st || NO_ST);
    gl.uniform4fv(u.uX, p.px || NO_X);
    gl.uniform1f(u.uSteps, this.steps);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.drawn = true;
  }

  dispose() {
    try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { /* ignore */ }
  }
}
