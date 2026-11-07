// Scroll reveals, split text, counters, parallax, scrubbed progress.
//
// data-reveal="up|fade|scale|clip|blur|left|split-lines|split-chars|split-words|count"
// data-delay="0.2"            seconds
// data-stagger[="up"]          on a parent: reveals its direct children in sequence
// data-stagger-step="0.08"    seconds between children
// data-start="top 85%"        ScrollTrigger start override
// data-count-to="617200000000" data-count-format="currency|int|percent" data-count-decimals="1"
//   data-count-style="roll"   odometer digit roll (default: numeric tween)
//   data-count-prefix / data-count-suffix
// data-parallax="0.2"         gentle scroll parallax (+ moves slower, - moves faster)
// data-progress               element gets --p 0..1 scrubbed while it crosses the viewport
import { $$, html, prefersReduced } from './util.js?v=e1a91ab979';

let ctx = null;
let killers = [];
let reduced = false;
let gate = Promise.resolve();
const globalBound = new WeakSet();

export function init({ ready } = {}) {
  reduced = prefersReduced();
  if (ready) gate = ready;
}

function fmt(n, el) {
  const f = el.dataset.countFormat || 'int';
  const dec = parseInt(el.dataset.countDecimals || '0', 10);
  const pre = el.dataset.countPrefix || '';
  const suf = el.dataset.countSuffix || '';
  const num = Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (f === 'currency') return `${pre}$${num}${suf}`;
  if (f === 'percent') return `${pre}${num}%${suf}`;
  return `${pre}${num}${suf}`;
}

function delayOf(el) { return parseFloat(el.dataset.delay || '0') || 0; }

function revealClass(el) {
  gate.then(() => el.classList.add('is-in'));
}

function splitReveal(el, type) {
  const gsap = window.gsap;
  const ST = window.SplitText;
  if (!ST || !gsap) { el.classList.add('is-in'); return null; }
  const kind = type === 'split-chars' ? 'chars' : type === 'split-words' ? 'words' : 'lines';
  let split = null;
  let done = false;
  let tl = null;
  const make = () => {
    split = ST.create(el, {
      type: kind === 'lines' ? 'lines' : kind === 'words' ? 'lines,words' : 'lines,words,chars',
      linesClass: 'sl',
      wordsClass: 'sw',
      charsClass: 'sc',
      mask: kind === 'chars' ? 'lines' : kind === 'words' ? 'lines' : 'lines',
      // aria:'none' leaves the host element's own text in the a11y tree (no
      // aria-label added to the <p>, no aria-hidden on the split pieces). A <p>
      // has no role that permits aria-label, so aria:'auto' produced an
      // aria-prohibited-attr violation; 'none' preserves the accessible name
      // (the element's text) without the prohibited attribute.
      aria: 'none',
    });
    const targets = split[kind];
    gsap.set(targets, kind === 'chars' ? { yPercent: 115, rotate: 8, transformOrigin: '0% 100%' } : { yPercent: 112 });
    el.classList.add('is-split');
    return targets;
  };
  let targets = null;
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  const prep = fontsReady.then(() => { if (!done) targets = make(); });
  return {
    play() {
      Promise.all([prep, gate]).then(() => {
        if (done || !targets) return;
        done = true;
        el.classList.add('is-in');
        tl = gsap.to(targets, {
          yPercent: 0,
          rotate: 0,
          duration: kind === 'chars' ? 1.1 : 1.25,
          ease: 'expo.out',
          delay: delayOf(el),
          stagger: kind === 'chars' ? 0.024 : kind === 'words' ? 0.04 : 0.1,
          onComplete: () => { split?.revert(); split = null; },
        });
      });
    },
    kill() { done = true; tl?.kill(); split?.revert(); },
  };
}

function buildOdometer(el, finalText) {
  // The visible digit columns below are decorative (aria-hidden), so the
  // accessible name must come from real text. A <p> has no role permitting
  // aria-label, so instead of el.setAttribute('aria-label', ...) we append a
  // visually-hidden .sr-only span carrying the number for screen readers.
  el.textContent = '';
  const srLabel = document.createElement('span');
  srLabel.className = 'sr-only';
  srLabel.textContent = finalText;
  el.appendChild(srLabel);
  const cols = [];
  for (const ch of finalText) {
    if (/\d/.test(ch)) {
      const col = document.createElement('span');
      col.className = 'odo__col';
      col.setAttribute('aria-hidden', 'true');
      const strip = document.createElement('span');
      strip.className = 'odo__strip';
      // two full cycles then the target digit so it visibly rolls
      const seq = [];
      for (let c = 0; c < 2; c++) for (let d = 0; d < 10; d++) seq.push(d);
      seq.push(+ch);
      strip.innerHTML = seq.map((d) => `<span>${d}</span>`).join('');
      col.appendChild(strip);
      el.appendChild(col);
      cols.push({ strip, steps: seq.length - 1 });
    } else {
      const s = document.createElement('span');
      s.className = 'odo__sep';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = ch;
      el.appendChild(s);
    }
  }
  el.classList.add('odo');
  return cols;
}

function countReveal(el) {
  const gsap = window.gsap;
  const to = parseFloat(el.dataset.countTo || el.textContent.replace(/[^\d.]/g, '')) || 0;
  const finalText = fmt(to, el);
  if (!gsap) { el.textContent = finalText; return null; }
  if (el.dataset.countStyle === 'roll') {
    const cols = buildOdometer(el, finalText);
    cols.forEach(({ strip }) => gsap.set(strip, { yPercent: 0 }));
    return {
      play() {
        gate.then(() => {
          const n = cols.length;
          cols.forEach(({ strip, steps }, i) => {
            gsap.to(strip, {
              y: () => -steps * strip.firstChild.getBoundingClientRect().height,
              duration: 1.6 + (n - i) * 0.07,
              delay: delayOf(el) + i * 0.035,
              ease: 'expo.inOut',
            });
          });
          el.classList.add('is-in');
        });
      },
    };
  }
  const st = { v: 0 };
  // No aria-label here: a <p> has no role permitting it (aria-prohibited-attr).
  // The element's own text is the accessible name, and onComplete restores the
  // exact finalText, so the resting announcement is correct without the attr.
  el.textContent = fmt(0, el);
  return {
    play() {
      gate.then(() => {
        el.classList.add('is-in');
        gsap.to(st, {
          v: to,
          duration: 2.2,
          delay: delayOf(el),
          ease: 'power3.out',
          onUpdate: () => { el.textContent = fmt(Math.round(st.v * 10 ** (+el.dataset.countDecimals || 0)) / 10 ** (+el.dataset.countDecimals || 0), el); },
          onComplete: () => { el.textContent = finalText; },
        });
      });
    },
  };
}

/** On scene pages a reveal is keyed to its scene, so everything in a scene
 *  lands together as that scene glides in (nothing waits below a fold that no
 *  longer exists). Tall scenes and pinned sequences keep per-element triggers. */
function fitScene(el) {
  const s = el.closest?.('.is-scene');
  if (!s || s.dataset.sceneSteps) return null;
  // the engine's own verdict (a near-fit scene counts as fitting); plain measure otherwise
  const fits = window.__scenes?.fitsScreen ? window.__scenes.fitsScreen(s) : s.offsetHeight <= innerHeight + 4;
  if (!fits) return null;
  return s;
}

function bindRoot(root) {
  const gsap = window.gsap;
  const ST = window.ScrollTrigger;

  // staggered groups: children inherit the reveal type
  $$('[data-stagger]', root).forEach((group) => {
    const type = group.dataset.stagger || 'up';
    const step = group.dataset.staggerStep;
    Array.from(group.children).forEach((child, i) => {
      if (!child.dataset.reveal) child.dataset.reveal = type;
      child.style.setProperty('--i', i);
      if (step) child.style.setProperty('--stagger', `${step}s`);
      child.dataset.revealGroup = '1';
    });
  });

  const els = $$('[data-reveal]', root);
  if (reduced || !gsap || !ST) {
    els.forEach((el) => {
      el.classList.add('is-in');
      if (el.dataset.reveal === 'count') el.textContent = fmt(parseFloat(el.dataset.countTo) || 0, el);
    });
    return;
  }

  els.forEach((el) => {
    const type = el.dataset.reveal;
    if (el.dataset.delay && !type.startsWith('split') && type !== 'count') el.style.setProperty('--delay', `${el.dataset.delay}s`);
    let handler;
    if (type.startsWith('split')) handler = splitReveal(el, type);
    else if (type === 'count') handler = countReveal(el);
    const own = el.dataset.revealGroup ? el.parentElement : el;
    const scene = fitScene(own);
    const trigger = scene || own;
    ST.create({
      trigger,
      start: scene ? 'top 72%' : (el.dataset.start || (own.closest('.is-scene') ? 'top 94%' : 'top 88%')),
      once: true,
      onEnter: () => (handler ? handler.play() : revealClass(el)),
    });
    if (handler?.kill) killers.push(handler.kill);
  });

  // parallax
  $$('[data-parallax]', root).forEach((el) => {
    const f = parseFloat(el.dataset.parallax) || 0.2;
    gsap.fromTo(el, { y: () => f * innerHeight * 0.35 }, {
      y: () => -f * innerHeight * 0.35,
      ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true },
    });
  });

  // scrubbed progress (--p 0..1), e.g. the .steps connecting line
  $$('[data-progress], .steps', root).forEach((el) => {
    const scene = fitScene(el);
    if (scene) {
      // the whole line draws as its scene settles
      const st = { p: 0 };
      el.style.setProperty('--p', '0');
      ST.create({
        trigger: scene,
        start: 'top 72%',
        once: true,
        onEnter: () => gsap.to(st, { p: 1, duration: 1.6, delay: 0.25, ease: 'power2.inOut', onUpdate: () => el.style.setProperty('--p', st.p.toFixed(4)) }),
      });
      return;
    }
    ST.create({
      trigger: el,
      start: el.dataset.progressStart || 'top 75%',
      end: el.dataset.progressEnd || 'bottom 55%',
      scrub: 0.6,
      onUpdate: (self) => el.style.setProperty('--p', self.progress.toFixed(4)),
    });
  });
}

export function bind(main) {
  const gsap = window.gsap;
  if (!gsap) { bindRoot(main); return; }
  ctx = gsap.context(() => { bindRoot(main); }, main);
}

/** Persistent regions outside <main> (footer). Bound once. */
export function bindGlobal(el) {
  if (!el || globalBound.has(el)) return;
  globalBound.add(el);
  const keep = killers;
  killers = [];
  if (window.gsap) window.gsap.context(() => bindRoot(el), el);
  else bindRoot(el);
  killers = keep;
}

export function unbind() {
  killers.forEach((k) => { try { k(); } catch (e) { /* ignore */ } });
  killers = [];
  ctx?.revert();
  ctx = null;
}

export { fmt as formatCount };
html.classList.add('reveals-ready');
