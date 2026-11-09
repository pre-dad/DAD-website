// /problem/ page module.
//  - coin stage in "Why they left" (the cracked coin holds still while the facts pass)
//  - facts + "Why now" forces light up as they cross the reading line
//  - scrubbed word-by-word reading for the verdict lines
//  - desktop: the five leaks run as a pinned horizontal sequence (sticky stage)
import { coinStage, readText, activeOnLine, desktopPin } from './ph-util.js?v=7df28338d2';

let cleanups = [];

export function mount(main, ctx) {
  const ST = ctx.ScrollTrigger;
  const gsap = ctx.gsap;
  const reduced = ctx.reduced;

  cleanups.push(coinStage(ST));
  cleanups.push(readText(main, ST, reduced));
  cleanups.push(activeOnLine([...main.querySelectorAll('.ph-fact')], ST, { line: '58%' }));
  cleanups.push(activeOnLine([...main.querySelectorAll('.ph-force')], ST, { line: '60%' }));

  // ---- the five leaks
  const sec = main.querySelector('.ph-leaks');
  const track = main.querySelector('.ph-leaks__track');
  const bar = main.querySelector('.ph-leaks__bar');
  const leaks = [...main.querySelectorAll('.ph-leak')];
  if (sec && track && ST && gsap && !reduced && desktopPin()) {
    const dist = () => Math.max(0, track.scrollWidth - innerWidth);
    const size = () => { sec.style.setProperty('--ph-h', `${innerHeight + dist()}px`); };
    size();
    ST.addEventListener('refreshInit', size);
    let active = -1;
    const setActive = () => {
      const mid = innerWidth * 0.46;
      let best = 0, bd = Infinity;
      leaks.forEach((l, i) => {
        const r = l.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - mid);
        if (d < bd) { bd = d; best = i; }
      });
      if (best !== active) {
        active = best;
        leaks.forEach((l, i) => l.classList.toggle('is-active', i === best));
      }
    };
    const tw = gsap.to(track, {
      x: () => -dist(),
      ease: 'none',
      scrollTrigger: {
        trigger: sec,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.8,
        invalidateOnRefresh: true,
        onUpdate: (self) => { bar?.style.setProperty('--p', self.progress.toFixed(4)); },
      },
      onUpdate: setActive,
    });
    setActive();
    cleanups.push(() => {
      ST.removeEventListener('refreshInit', size);
      tw.scrollTrigger?.kill();
      tw.kill();
      gsap.set(track, { clearProps: 'transform' });
      sec.style.removeProperty('--ph-h');
    });
  } else if (ST) {
    // (92%: a leak already on screen at a scene stop must not wait for another scroll)
    const sts = leaks.map((l) => ST.create({ trigger: l, start: 'top 92%', once: true, onEnter: () => l.classList.add('is-in') }));
    cleanups.push(() => sts.forEach((s) => s.kill()));
  } else {
    leaks.forEach((l) => l.classList.add('is-in'));
  }
}

export function unmount() {
  cleanups.forEach((fn) => { try { fn && fn(); } catch (e) { /* ignore */ } });
  cleanups = [];
}
