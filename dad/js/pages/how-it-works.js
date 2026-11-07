// /how-it-works/ page module.
//  - the loop: a tall section with a sticky stage; scroll advances Fund -> Operate -> Prove -> Grow,
//    the progress ring draws, nodes light up, and the coin (held in the ring's centre by a rail of
//    sticky anchors) changes state split -> pool -> reform -> spin
//  - "how we choose" steps, donor feed rows light up on the reading line
//  - compare table: the DAD column wins row by row
import { coinStage, readText, activeOnLine, fitScene } from './ph-util.js?v=e1a91ab979';

let cleanups = [];

export function mount(main, ctx) {
  const ST = ctx.ScrollTrigger;
  const reduced = ctx.reduced;

  cleanups.push(coinStage(ST));
  cleanups.push(readText(main, ST, reduced));
  cleanups.push(activeOnLine([...main.querySelectorAll('.hw-pick')], ST, { line: '60%' }));
  cleanups.push(activeOnLine([...main.querySelectorAll('.hw-feed__row')], ST, { line: '62%' }));
  main.querySelectorAll('.hw-streak i').forEach((el, i) => el.style.setProperty('--k', i));

  // ---- donor app phone: scale the 414x868 frame to fit its box exactly
  const fit = main.querySelector('.hw-phone__fit');
  if (fit && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(() => { const h = fit.getBoundingClientRect().height; if (h) fit.style.setProperty('--s', (h / 868).toFixed(4)); });
    ro.observe(fit);
    cleanups.push(() => ro.disconnect());
  }

  // ---- the loop
  const loop = main.querySelector('.hw-loop');
  const stage = main.querySelector('.hw-loop__stage');
  const steps = [...main.querySelectorAll('.hw-step')];
  const ring = main.querySelector('.hw-loop__ring');
  const dotsEl = ring?.querySelector('.dots');
  if (loop && stage && ST) {
    let cur = -1;
    const nodeXY = [[.5, .13], [.87, .5], [.5, .87], [.13, .5]];
    const go = (i) => {
      if (i === cur) return;
      const first = cur === -1;
      cur = i;
      stage.dataset.step = String(i);
      steps.forEach((s, k) => {
        s.classList.toggle('is-active', k === i);
        s.classList.toggle('is-past', k < i);
        s.setAttribute('aria-hidden', k === i ? 'false' : 'true');
      });
      if (!first && !reduced && dotsEl && ctx.dots?.ripple) {
        const r = dotsEl.getBoundingClientRect();
        try { ctx.dots.ripple(dotsEl, r.left + r.width * nodeXY[i][0], r.top + r.height * nodeXY[i][1], { amp: .8 }); } catch (e) { /* ignore */ }
      }
    };
    go(0);
    const st = ST.create({
      trigger: loop,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        const p = self.progress;
        ring?.style.setProperty('--lp', (p * 100).toFixed(2));
        go(Math.min(steps.length - 1, Math.floor(p * steps.length * 0.999)));
      },
      onRefresh: (self) => ring?.style.setProperty('--lp', (self.progress * 100).toFixed(2)),
    });
    cleanups.push(() => st.kill());
  } else {
    steps.forEach((s) => s.classList.add('is-active'));
  }

  // ---- compare table: DAD wins each row as it reaches the reading line
  const rows = [...main.querySelectorAll('.hw-table tbody tr')];
  const tableScene = rows[0] ? fitScene(rows[0]) : null;
  if (ST && !reduced && tableScene) {
    // scene page: the table never scrolls past a reading line, so DAD wins the
    // rows one after another as the scene lands (the last rows used to stay unwon)
    let timers = [];
    const clear = () => { timers.forEach(clearTimeout); timers = []; };
    const st = ST.create({
      trigger: tableScene,
      start: 'top 62%',
      onEnter: () => { clear(); rows.forEach((tr, k) => timers.push(setTimeout(() => tr.classList.add('is-won'), 350 + k * 230))); },
      onLeaveBack: () => { clear(); rows.forEach((tr) => tr.classList.remove('is-won')); },
    });
    cleanups.push(() => { clear(); st.kill(); });
  } else if (ST && !reduced) {
    const sts = rows.map((tr) => ST.create({
      trigger: tr,
      start: 'top 72%',
      onEnter: () => tr.classList.add('is-won'),
      onLeaveBack: () => tr.classList.remove('is-won'),
    }));
    cleanups.push(() => sts.forEach((s) => s.kill()));
  } else rows.forEach((tr) => tr.classList.add('is-won'));
}

export function unmount() {
  cleanups.forEach((fn) => { try { fn && fn(); } catch (e) { /* ignore */ } });
  cleanups = [];
}
