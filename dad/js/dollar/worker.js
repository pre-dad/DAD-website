// The liquid drop's render worker: owns the WebGL context (an OffscreenCanvas transferred from the
// page) and its own animation loop, so a busy main thread never stalls the liquid. The page only
// posts what it measured (destinations, scroll-relative rects, state changes, theme); see dollar.js.
import { Engine, N_PRIMS, tierQ, dispatch, hostTick } from './engine.js?v=e1a91ab979';
import { View } from './gl.js?v=e1a91ab979';

let eng = null, last = 0, paced = false, lastTick = -1e9;
const emit = (type, data) => postMessage({ type, data });
const hasRaf = typeof self.requestAnimationFrame === 'function';

// one rendered frame, paced by the worker's own rAF (a busy main thread never stalls the liquid).
// WebKit (every iOS browser) runs worker rAF on a timer, not the display: measured ~45/s against a
// 60Hz page, which beats against the screen as a small regular stutter. There, and in a worker without
// rAF, the page paces the frames ('tick' from its own vsync rAF); the worker's rAF only covers for a
// stalled page (no tick for 28ms).
function render(now) {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
  last = now;
  try { hostTick(eng, dt); } catch (e) { emit('fail', String(e && e.message)); eng._lost = true; }
}
function loop() {
  self.requestAnimationFrame(loop);
  const now = performance.now();
  if (paced && now - lastTick < 28) return;
  render(now);
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    try {
      const q = tierQ(m.tier, m.mobile);
      const view = new View(m.canvas, N_PRIMS, q.steps);
      m.canvas.addEventListener && m.canvas.addEventListener('contextlost', () => { if (eng) eng._lost = true; emit('fail', 'context lost'); });
      eng = new Engine(view, { tier: m.tier, reduced: m.reduced, mobile: m.mobile, emit, W: m.W, H: m.H, dpr: m.dpr });
      eng._dirty = true;
      // no rAF in this worker (older engines): the page drives every frame with 'tick'
      emit('ready', { steps: q.steps, raf: hasRaf });
      if (hasRaf) self.requestAnimationFrame(loop);
    } catch (e) { emit('fail', String(e && e.message)); }
    return;
  }
  if (!eng) return;
  if (m.type === 'tick') { const now = performance.now(); lastTick = now; if (now - last > 4) render(now); return; }
  if (m.type === 'pace') { paced = !!m.on; return; }
  dispatch(eng, m);
  eng._dirty = true;
};
