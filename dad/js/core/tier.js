// Device tiering: 'low' | 'mid' | 'high'. Override with ?tier=low|mid|high.
export function detectTier() {
  try {
    const q = new URLSearchParams(location.search).get('tier');
    if (q === 'low' || q === 'mid' || q === 'high') return q;
  } catch (e) { /* ignore */ }

  // the GPU probe costs a WebGL context: do it once per session
  try { const c = sessionStorage.getItem('dad-tier'); if (c === 'low' || c === 'mid' || c === 'high') return c; } catch (e) { /* ignore */ }
  const t = probe();
  try { sessionStorage.setItem('dad-tier', t); } catch (e) { /* ignore */ }
  return t;
}

function probe() {
  let score = 0;
  const mem = navigator.deviceMemory;          // Chrome/Android only
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(screen.width || 0, screen.height || 0);
  const small = Math.min(screen.width || 0, screen.height || 0) < 600;

  if (mem !== undefined) score += mem >= 8 ? 2 : mem >= 4 ? 1 : -2;
  score += cores >= 8 ? 2 : cores >= 6 ? 1 : cores <= 2 ? -2 : 0;
  if (small) score -= 1;
  if (w >= 1600 && !small) score += 1;
  if (dpr > 2.5) score -= .5; // lots of pixels to fill on phones

  // quick GPU probe
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', { failIfMajorPerformanceCaveat: false }) || c.getContext('experimental-webgl');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  } catch (e) { return 'low'; }

  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(gpu)) return 'low';
  if (/mali-4|mali-t[67]|adreno \(tm\) [34]\d\d|powervr sgx|intel\(r\) hd graphics [2-5]/.test(gpu)) score -= 2;
  if (/apple m\d|apple gpu|rtx|radeon pro|radeon rx|geforce gtx 1[06-9]|geforce rtx|adreno \(tm\) [67]\d\d|mali-g7\d|mali-g6[18]|arc\(tm\)/.test(gpu)) score += 2;
  if (/apple gpu/.test(gpu) && small) score += 1; // modern iPhones are strong

  return score >= 3 ? 'high' : score >= 0 ? 'mid' : 'low';
}
