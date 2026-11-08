// HOME page choreography: "Follow one dollar".
// Loaded through the page front-matter "module" key; app.js calls mount(main, ctx) / unmount(main).
//
//  · Problem: the $617.2B counter pins full-screen, shrinks away, "3.6%" falls in (desktop pin, mobile stack)
//  · Facts slam in one by one and jolt the cracked coin
//  · THE TURN: one scene. As it settles the drop pours over the screen as a liquid front that turns to
//    paper (dollar.pour); the theme switches under full cover, then "So we started over." rises and the
//    recycle icon condenses below it. Without WebGL the theme's CSS flood pours instead.
//  · "What DAD is not": a glass window table (rows stagger in through the shared reveals)
//  · Follow the dollar: steps light up as they pass (the liquid drop shows each step)
//  · Ledger: map rain + Open Ledger deck live in core/ledger.js
//  · Programs fan into place (the leadership grid uses the shared reveals)
import * as theme from '../core/theme.js?v=96b7c0d426';

const DESK = '(min-width: 960px) and (pointer: fine)';

let gctx = null;
let mm = null;
let split = null;
let timers = [];
let listeners = [];
let turnOff = null;
let root = null;

/* ---------------- 3 · THE TURN ---------------- */
// One scene. As it settles, the drop swells and its edge runs over the screen as a liquid front that
// turns to warm paper (dollar.pour). The theme switches under full cover, the liquid clears,
// "So we started over." rises dead centre and the recycle shape condenses below it. Back up past it,
// everything resets. Without WebGL the theme's own flood pours instead.
function setupTurn(c) {
  const { gsap, ScrollTrigger: ST, reduced } = c;
  const sec = root.querySelector('#turn');
  if (!sec) return;
  const h = sec.querySelector('.hm-turn__h');
  const stage = sec.querySelector('.hm-turn__stage');
  const coin = sec.querySelector('.hm-turn__coin');
  // the headline sits a little above centre (CSS); the recycle sits just under it, a touch below
  // the middle of the screen, never down by the bottom edge
  const placeCoin = () => {
    if (!coin || !stage) return;
    const st = stage.getBoundingClientRect(), hr = h.getBoundingClientRect();
    const room = st.bottom - hr.bottom;
    const gap = Math.max(18, innerHeight * 0.035);
    const d = Math.max(56, Math.min(innerHeight * 0.24, innerWidth * 0.4, (room - gap - 48) / 1.15));
    coin.style.setProperty('--da-w', `${Math.round(d)}px`);
    coin.style.top = `${Math.round(hr.bottom - st.top + gap + d * 0.55)}px`;
  };
  placeCoin();
  const onResize = () => placeCoin();
  addEventListener('resize', onResize);
  turnOff = () => { removeEventListener('resize', onResize); turnOff = null; };

  if (reduced) {
    h.classList.add('is-split');
    ST.create({
      trigger: sec, start: 'top 50%',
      onEnter: () => theme.set('light'),
      onLeaveBack: () => theme.set('dark'),
    });
    return;
  }

  let chars = [];
  if (window.SplitText) {
    split = window.SplitText.create(h, { type: 'words,chars', mask: 'words', wordsClass: 'sw', charsClass: 'sc', aria: 'auto' });
    chars = split.chars;
  }
  h.classList.add('is-split');
  const hide = () => { if (chars.length) { gsap.killTweensOf(chars); gsap.set(chars, { yPercent: 118, rotate: 6, transformOrigin: '0% 100%' }); } };
  const show = (now) => {
    if (!chars.length) return;
    gsap.killTweensOf(chars);
    if (now) gsap.set(chars, { yPercent: 0, rotate: 0 });
    else gsap.to(chars, { yPercent: 0, rotate: 0, duration: 0.9, ease: 'power3.out', stagger: 0.022 });
  };
  hide();
  placeCoin();

  const liquid = () => { const d = c.dollar; return d && !d.stub && d.enabled && typeof d.pour === 'function' ? d : null; };
  let state = 0; // 0 before the turn · 1 pouring · 2 turned
  const pour = () => {
    if (state) return;
    state = 1;
    const d = liquid();
    if (!d) { theme.set('light'); show(false); state = 2; return; }
    d.pour({
      onCovered: () => theme.set('light', { instant: true }),
      onCleared: () => { state = 2; show(false); },
    });
  };
  ST.create({
    trigger: sec, start: 'top 8%', end: 'top -8%',
    onEnter: pour, // the scene has (nearly) settled
    onEnterBack: () => { if (!state) { state = 2; liquid()?.pourDone?.(); show(true); } }, // back up from below
    onLeaveBack: () => { state = 0; hide(); liquid()?.pourReset?.(); }, // back up into "Delivery is broken"
  });
}

/* the "!" after $617,200,000,000 stands right after the last digit; if it can't fit there (a narrow
   screen the number fills), it drops to the next line, aligned right */
function setupExclaim() {
  const nw = root.querySelector('.hm-count__nw');
  const inner = nw?.offsetParent;
  if (!nw || !inner) return;
  const fit = () => {
    nw.classList.remove('is-wrap');
    const fs = parseFloat(getComputedStyle(nw).fontSize) || 16;
    const right = inner.getBoundingClientRect().left + nw.offsetLeft + nw.offsetWidth;
    nw.classList.toggle('is-wrap', right + fs * 0.45 + 24 > document.documentElement.clientWidth);
  };
  fit();
  document.fonts?.ready?.then(() => { if (root) fit(); });
  addEventListener('resize', fit);
  window.ScrollTrigger?.addEventListener('refresh', fit);
  listeners.push(() => { removeEventListener('resize', fit); window.ScrollTrigger?.removeEventListener('refresh', fit); });
}

/* ---------------- 2 · PROBLEM ---------------- */
function setupCount(c, desk) {
  const { gsap } = c;
  const wrap = root.querySelector('#hm-count');
  if (!wrap) return;
  const a = wrap.querySelector('.hm-count__a');
  const stop = wrap.querySelector('.hm-count__stop');
  const num = wrap.querySelector('.hm-fall__num');
  const txt = wrap.querySelector('.hm-fall__txt');
  if (desk) {
    // the 3.6% is not scrubbed: once the second stop is reached it drops in and bounces, in real time
    gsap.set(num, { yPercent: -60, opacity: 0, '--trail': 1 });
    let dropped = false;
    const drop = () => {
      if (dropped) return;
      dropped = true;
      gsap.killTweensOf(num);
      gsap.fromTo(num, { yPercent: -60, y: -60, opacity: 0, '--trail': 1 }, { yPercent: 0, y: 0, opacity: 1, '--trail': 0, duration: 1.15, ease: 'bounce.out', delay: 0.12 });
    };
    const lift = () => { if (!dropped) return; dropped = false; gsap.killTweensOf(num); gsap.to(num, { opacity: 0, duration: 0.25, onComplete: () => gsap.set(num, { yPercent: -60, y: -60, '--trail': 1 }) }); };
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: wrap, start: 'top top', end: '+=140%', pin: true, scrub: 0.8, refreshPriority: 2,
        onUpdate: (self) => { if (self.progress > 0.42) drop(); else if (self.progress < 0.3) lift(); },
      },
    });
    tl.to({}, { duration: 1 }, 0)
      .to(a, { scale: 0.44, y: () => -innerHeight * 0.22, opacity: 0.3, duration: 0.32, ease: 'power2.inOut' }, 0.16)
      .fromTo(stop, { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 0.24, ease: 'power3.out' }, 0.3)
      .fromTo(txt, { x: -24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.16, ease: 'power2.out' }, 0.62);
  } else {
    // phones: plays once the scene has (nearly) landed, so the drop-and-bounce is seen, not missed mid-swipe
    gsap.set([stop, num, txt], { opacity: 0 });
    const tl = gsap.timeline({ paused: true });
    c.ScrollTrigger.create({ trigger: wrap, start: "top 30%", once: true, onEnter: () => tl.play() });
    tl.fromTo(stop, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'expo.out' }, 0.15)
      .fromTo(num, { yPercent: -60, y: -60, opacity: 0, '--trail': 1 }, { yPercent: 0, y: 0, opacity: 1, '--trail': 0, duration: 1.15, ease: 'bounce.out' }, 0.4)
      .fromTo(txt, { x: -16, opacity: 0 }, { x: 0, opacity: 1, duration: 0.8, ease: 'expo.out' }, 0.95);
  }
}

function setupSlams(c) {
  const { gsap, ScrollTrigger: ST } = c;
  const box = root.querySelector('.hm-facts');
  root.querySelectorAll('[data-slam]').forEach((el) => {
    gsap.set(el, { opacity: 0 });
    ST.create({
      trigger: el,
      start: 'top 82%',
      once: true,
      onEnter: () => {
        const tl = gsap.timeline();
        tl.fromTo(el, { opacity: 0, scale: 1.32, y: -18, filter: 'blur(12px)' }, { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', duration: 0.62, ease: 'expo.out', clearProps: 'filter' })
          .fromTo(el, { '--hit': 0 }, { '--hit': 1, duration: 0.9, ease: 'expo.out' }, 0.06);
        if (box) tl.fromTo(box, { x: -9 }, { x: 0, duration: 0.8, ease: 'elastic.out(1.1, 0.3)', clearProps: 'transform' }, 0.08);
      },
    });
  });
}

/* ---------------- 4 · FOLLOW THE DOLLAR ---------------- */
function setupFollow(c) {
  const { ScrollTrigger: ST } = c;
  root.querySelectorAll('.hm-step, .hm-loop').forEach((step) => {
    ST.create({
      trigger: step,
      start: 'top 58%',
      end: 'bottom 42%',
      toggleClass: { targets: step, className: 'is-active' },
    });
  });
}

/* ---------------- 5 · LEDGER ---------------- */
function setupLedger() {
  // the map rain, the flow and the Open Ledger deck are core: js/core/ledger.js
}

/* ---------------- 6 · PROGRAMS ---------------- */
function setupPrograms(c, desk) {
  const { gsap, ScrollTrigger: ST } = c;
  const grid = root.querySelector('.hm-programs__grid');
  if (!grid) return;
  const cards = [...grid.children];
  if (desk) {
    const ys = [170, 70, 230, 120];
    const rs = [-2.5, 1.5, -1.5, 2.5];
    gsap.fromTo(cards, { '--fy': (i) => `${ys[i % 4]}px`, '--fr': (i) => `${rs[i % 4]}deg`, opacity: 0 }, {
      '--fy': '0px', '--fr': '0deg', opacity: 1, ease: 'power2.out',
      stagger: 0.04,
      scrollTrigger: { trigger: grid, start: 'top 96%', end: 'top 38%', scrub: 0.8 },
    });
  } else {
    cards.forEach((card) => {
      gsap.set(card, { opacity: 0, '--fy': '56px' });
      ST.create({ trigger: card, start: 'top 90%', once: true, onEnter: () => gsap.to(card, { opacity: 1, '--fy': '0px', duration: 1.1, ease: 'expo.out' }) });
    });
  }
}

/* ---------------- lifecycle ---------------- */
export function mount(main, c) {
  root = main;
  const { gsap, ScrollTrigger: ST, reduced } = c;
  if (!gsap || !ST) { main.querySelector('.hm-turn__h')?.classList.add('is-split'); return; }

  gctx = gsap.context(() => {
    if (reduced) {
      setupTurn(c);
      return;
    }
    setupSlams(c);
    setupFollow(c);
    setupLedger(c);
  }, main);

  if (!reduced) {
    mm = gsap.matchMedia();
    mm.add({ desk: DESK, mob: `not all and ${DESK}` }, (m) => {
      const desk = !!m.conditions.desk;
      if (desk) main.classList.add('hm-pinning');
      // pins are created top-to-bottom so later triggers account for their spacing
      setupCount(c, desk);
      setupTurn(c);
      setupPrograms(c, desk);
      return () => {
        main.classList.remove('hm-pinning');
        split?.revert();
        split = null;
        turnOff?.();
      };
    });
  }
  setupExclaim(); // after the desktop layout (pinning font size) is in place
  ST.sort();
  ST.refresh();
}

export function unmount() {
  timers.forEach(clearTimeout);
  timers = [];
  listeners.forEach((f) => f());
  listeners = [];
  mm?.revert();
  mm = null;
  gctx?.revert();
  gctx = null;
  split?.revert();
  split = null;
  turnOff?.();
  root = null;
}
