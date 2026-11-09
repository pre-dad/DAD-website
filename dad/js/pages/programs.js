// /programs/ page module: the category panels drive the sticky dot illustration
// (food -> health -> opportunities -> infrastructure, each in its category colour),
// and the coin's landing target is pinned to the map's hub site.
import { pinToHub } from './pp-util.js?v=7df28338d2';

let triggers = [];
let cleanups = [];

export function mount(main, ctx) {
  const ST = ctx.ScrollTrigger;
  const stage = main.querySelector('.prg-stage');
  const morphEl = main.querySelector('#prg-morph');
  const panels = [...main.querySelectorAll('.prg-panel')];
  const rail = [...main.querySelectorAll('.prg-rail li')];
  let current = 0;

  const activate = (i) => {
    if (i === current || !panels[i]) return;
    current = i;
    const p = panels[i];
    panels.forEach((x, k) => x.classList.toggle('is-active', k === i));
    rail.forEach((x, k) => x.classList.toggle('is-on', k <= i));
    if (stage) stage.className = 'prg-stage ' + p.dataset.cat;
    if (morphEl) {
      morphEl.dataset.dotsColor = p.dataset.color; // read by the engine when it re-targets
      const d = ctx.dots;
      if (d && d.morph) d.morph(morphEl, p.dataset.shape);
      else morphEl.setAttribute('data-dots', p.dataset.shape);
    }
  };

  if (ST) {
    panels.forEach((p, i) => {
      triggers.push(ST.create({
        trigger: p,
        start: 'top 55%',
        end: 'bottom 55%',
        onToggle: (self) => { if (self.isActive) activate(i); },
      }));
    });
  }

  cleanups.push(pinToHub(main.querySelector('.prg-map'), main.querySelector('#prg-site')));
}

export function unmount() {
  triggers.forEach((t) => t.kill());
  triggers = [];
  cleanups.forEach((fn) => fn && fn());
  cleanups = [];
}
