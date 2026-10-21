// /proof/ page module: ledger rows "write themselves in", the principle cards
// stack and recede. The live ledger stage is core (js/core/ledger.js).

let triggers = [];
let cleanups = [];

export function mount(main, ctx) {
  const { ScrollTrigger: ST, gsap, reduced } = ctx;
  const rows = [...main.querySelectorAll('.pf-row')];

  if (reduced || !ST) rows.forEach((r) => r.classList.add('is-written'));
  else {
    // rows inside a one-screen scene write in sequence as it lands (a row low in
    // the scene never crossed the 84% line and stayed blank); otherwise per row
    const groups = new Map();
    rows.forEach((r) => {
      const sc = r.closest('.is-scene');
      const fits = sc && !sc.dataset.sceneSteps && (window.__scenes?.fitsScreen ? window.__scenes.fitsScreen(sc) : sc.offsetHeight <= innerHeight + 4);
      if (fits) { if (!groups.has(sc)) groups.set(sc, []); groups.get(sc).push(r); return; }
      triggers.push(ST.create({ trigger: r, start: 'top 84%', once: true, onEnter: () => r.classList.add('is-written') }));
    });
    groups.forEach((list, sc) => {
      triggers.push(ST.create({ trigger: sc, start: 'top 62%', once: true, onEnter: () => list.forEach((r, k) => setTimeout(() => r.classList.add('is-written'), 200 + k * 140)) }));
    });
  }

  // stacked principle cards: each one recedes as the next slides over it
  if (!reduced && ST && gsap) {
    const cards = [...main.querySelectorAll('.pf-p')];
    cards.forEach((c, i) => {
      const next = cards[i + 1];
      if (!next) return;
      const tw = gsap.to(c, {
        scale: 0.94, '--dim': 1, ease: 'none',
        scrollTrigger: { trigger: next, start: 'top 85%', end: 'top 25%', scrub: true },
      });
      triggers.push(tw.scrollTrigger, { kill: () => { tw.kill(); gsap.set(c, { clearProps: 'transform,--dim' }); } });
    });
  }

}

export function unmount() {
  triggers.forEach((t) => t && t.kill && t.kill());
  triggers = [];
  cleanups.forEach((fn) => fn && fn());
  cleanups = [];
}
