// Shared helpers for the /problem/ and /how-it-works/ page modules.

const html = document.documentElement;

/** The viewport-sized scene holding el (scene pages), or null when free-scrolling / tall. */
export function fitScene(el) {
  const s = el.closest?.('.is-scene');
  if (!s || s.dataset.sceneSteps) return null;
  // the engine's own verdict (a near-fit scene counts as fitting); plain measure otherwise
  const fits = window.__scenes?.fitsScreen ? window.__scenes.fitsScreen(s) : s.offsetHeight <= innerHeight + 4;
  if (!fits) return null;
  return s;
}

/**
 * Coin stages. Anchors with .ph-stick are sticky (top AND bottom) at runtime,
 * so a run of them holds the coin still on screen while their natural
 * positions are spread down a tall section. ScrollTrigger measures with
 * html.ph-measure on, which drops the stickiness so each anchor's start is
 * its natural position. Result: the coin stays put and changes state as you
 * scroll, without pinning.
 */
export function coinStage(ST) {
  if (!ST) return () => {};
  const on = () => html.classList.add('ph-measure');
  const off = () => html.classList.remove('ph-measure');
  ST.addEventListener('refreshInit', on);
  ST.addEventListener('refresh', off);
  return () => {
    ST.removeEventListener('refreshInit', on);
    ST.removeEventListener('refresh', off);
    off();
  };
}

/** Wrap every word of [data-read] elements in .rw spans (keeps inner elements). */
function wrapWords(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => {
    const parts = n.textContent.split(/(\s+)/);
    if (parts.length < 2 && !n.textContent.trim()) return;
    const frag = document.createDocumentFragment();
    parts.forEach((p) => {
      if (!p) return;
      if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
      const s = document.createElement('span');
      s.className = 'rw';
      s.textContent = p;
      frag.appendChild(s);
    });
    n.parentNode.replaceChild(frag, n);
  });
  return [...el.querySelectorAll('.rw')];
}

/** Scroll-scrubbed reading: words light up one by one as the block crosses the viewport. */
export function readText(root, ST, reduced) {
  const killers = [];
  root.querySelectorAll('[data-read]').forEach((el) => {
    if (el.dataset.readDone) return;
    el.dataset.readDone = '1';
    const words = wrapWords(el);
    if (reduced || !ST) { words.forEach((w) => w.classList.add('is-lit')); return; }
    let last = -1;
    const scene = fitScene(el);
    if (scene && window.gsap) {
      // scene page: the words light up in reading rhythm as the scene lands
      const prog = { p: 0 };
      const st = ST.create({
        trigger: scene,
        start: 'top 60%',
        once: true,
        onEnter: () => window.gsap.to(prog, {
          p: 1, duration: Math.min(2.6, 0.9 + words.length * 0.06), delay: 0.35, ease: 'power1.inOut',
          onUpdate: () => {
            const n = Math.round(prog.p * words.length);
            if (n === last) return;
            last = n;
            words.forEach((w, i) => w.classList.toggle('is-lit', i < n));
          },
        }),
      });
      killers.push(() => st.kill());
      return;
    }
    const st = ST.create({
      trigger: el,
      start: 'top 82%',
      end: 'bottom 48%',
      scrub: true,
      onUpdate: (self) => {
        const n = Math.round(self.progress * words.length);
        if (n === last) return;
        last = n;
        words.forEach((w, i) => w.classList.toggle('is-lit', i < n));
      },
    });
    killers.push(() => st.kill());
  });
  return () => killers.forEach((k) => k());
}

/** Toggle .is-active on each item while it sits across the given viewport line. */
export function activeOnLine(items, ST, { line = '55%', onActive } = {}) {
  if (!ST) { items.forEach((x) => x.classList.add('is-active')); return () => {}; }
  const sts = items.map((el, i) => {
    const scene = fitScene(el);
    return ST.create({
    trigger: scene || el,
    start: scene ? 'top 62%' : `top ${line}`,
    end: scene ? 'bottom 38%' : `bottom ${line}`,
    onToggle: (self) => {
      if (scene) {
        // scene page: the items in a scene light up one after another as it lands
        const k = [...scene.querySelectorAll(el.tagName)].filter((x) => items.includes(x)).indexOf(el);
        clearTimeout(el._phT);
        el._phT = setTimeout(() => el.classList.toggle('is-active', self.isActive), self.isActive ? 260 + Math.max(0, k) * 300 : 0);
      } else el.classList.toggle('is-active', self.isActive);
      if (self.isActive && onActive) onActive(i, el);
    },
  });
  });
  return () => sts.forEach((s) => s.kill());
}

export const desktopPin = () => {
  try { return matchMedia('(min-width: 960px) and (hover: hover) and (pointer: fine)').matches; } catch (e) { return false; }
};
