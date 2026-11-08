// Open Ledger: the map rain, the map -> ledger flow, and the three-window deck.
//
// Markup: <div class="lgx" data-ledger data-scene data-scene-steps="4"> + partials/ledger-deck.html.
// The wrapper is 400svh with a sticky 100svh stage, so each scroll stop is one step:
//   step 0  the map. As the step lands, 8 real sites of all four categories light in quick
//           succession (lightSite). Arriving from above, the scene then moves itself on to
//           step 1 once the lights have had a beat (scenes.next(), which refuses mid-glide,
//           mid-touch or mid-drag, so it never fights the reader). Coming back up from the
//           deck, the map just sits lit: no auto-advance.
//   step 1  the deck takes the stage with the Program register in front while glowing lines rise
//           from the lit sites onto the register rows of the same colour; each row lights as its line lands.
//   step 2  Overview to the front.   step 3  Outcomes to the front.  (Window DOM order = shuffle order.)
// Reduced motion: the sites are lit at once and the three windows sit stacked in the flow.
import { html, $, $$, clamp, prefersReduced } from './util.js?v=96b7c0d426';

let items = [];
const SVGNS = 'http://www.w3.org/2000/svg';
const CATS = ['food', 'health', 'opportunities', 'infrastructure'];
const LIGHT_GAP = 85;   // ms between site lights (8 sites: ~0.6s)
const HOLD = 950;       // ms the fully lit map holds before the deck comes in

export function bind(main) {
  unbind();
  $$('[data-ledger]', main).forEach((el) => { try { items.push(new Ledger(el)); } catch (e) { console.warn('[dad:ledger]', e); } });
}
export function unbind() {
  items.forEach((it) => it.destroy());
  items = [];
}

// turn "$6.42M" into rolling digit columns (tabular, transform-only)
function buildRoll(el) {
  if (el.dataset.rollReady) return;
  const text = el.textContent.trim();
  el.dataset.rollReady = '1';
  const digits = [...text].filter((c) => /\d/.test(c)).length;
  let k = 0;
  const vis = [...text].map((c) => {
    if (!/\d/.test(c)) return `<span class="rl__s">${c}</span>`;
    const d = +c;
    const delay = (0.05 + (k++) * (0.55 / Math.max(1, digits))).toFixed(3);
    const col = Array.from({ length: 20 }, (_, i) => `<b>${i % 10}</b>`).join('');
    return `<span class="rl__d"><span class="rl__c" style="--t:${10 + d};--rd:${delay}s">${col}</span></span>`;
  }).join('');
  el.innerHTML = `<span class="rl"><span class="sr-only">${text}</span><span class="rl__vis" aria-hidden="true">${vis}</span></span>`;
}

class Ledger {
  constructor(el) {
    this.el = el;
    this.island = $('.lgx__island', el);
    this.mapEl = $('.lgx__map .dots', el);
    this.svg = $('.lgx__flow', el);
    this.wins = $$('.lw', el);
    this.reduced = prefersReduced();
    this.step = -2;
    this.front = -1;
    this.rained = false;
    this.chosen = null;
    this.timers = [];
    this.tweens = [];
    this.auto = false;      // armed when step 0 is entered from above
    this.touching = false;

    if (this.reduced) {
      el.classList.add('is-deck');
      this.wins.forEach((w) => w.classList.add('is-on'));
      this.waitSites(() => this.chosen.forEach((c) => this.light(c)));
      return;
    }
    $$('[data-roll]', el).forEach(buildRoll);
    // phone outcomes pager: the page dots follow the sideways scroll
    this.ocGrid = $('.lw-out__grid', el);
    this.pageDots = $$('.lw-pages i', el);
    if (this.ocGrid && this.pageDots.length) {
      this.onPage = () => {
        const g = this.ocGrid, cards = [...g.children], x = g.scrollLeft;
        let k = 0; cards.forEach((c, i) => { if (Math.abs(c.offsetLeft - g.offsetLeft - 12 - x) < Math.abs(cards[k].offsetLeft - g.offsetLeft - 12 - x)) k = i; });
        this.pageDots.forEach((d, i) => d.classList.toggle('is-on', i === k));
      };
      this.ocGrid.addEventListener('scroll', this.onPage, { passive: true });
    }
    this.onScroll = () => { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.update(); }); };
    this.onResize = () => { this.front = -1; this.update(true); };
    addEventListener('scroll', this.onScroll, { passive: true });
    addEventListener('resize', this.onResize, { passive: true });
    // a finger on the glass or a key press during the beat on the map = the reader is driving
    this.onTouch = (e) => { this.touching = e.type === 'touchstart'; if (this.touching) this.auto = false; };
    this.onKey = (e) => { if (this.step === 0 && /^(Arrow|Page|Home|End| )/.test(e.key)) this.auto = false; };
    addEventListener('touchstart', this.onTouch, { passive: true });
    addEventListener('touchend', this.onTouch, { passive: true });
    addEventListener('touchcancel', this.onTouch, { passive: true });
    addEventListener('keydown', this.onKey);
    this.poll = setInterval(() => this.tick(), 60);
    this.update(true);
  }

  /* ---------------- sites */
  sites() { const D = window.__dots; return (D && D.siteScreenPositions && this.mapEl) ? D.siteScreenPositions(this.mapEl) : []; }

  choose(all) {
    // only sites comfortably inside the island (the phone map is zoom-cropped at the coasts)
    if (this.island) {
      const ir = this.island.getBoundingClientRect(), m = 22;
      const vis = all.filter((s) => s.x > ir.left + m && s.x < ir.right - m && s.y > ir.top + m && s.y < ir.bottom - m);
      if (vis.length >= 8) all = vis;
    }
    // two sites per category, spread across the country, interleaved so colours alternate
    const qs = [[0.16, 0.72], [0.55, 0.12], [0.86, 0.38], [0.33, 0.92]];
    const per = CATS.map((c) => all.filter((s) => s.cat === c).sort((a, b) => a.x - b.x));
    const out = [];
    for (let r = 0; r < 2; r++) {
      per.forEach((list, k) => {
        if (!list.length) return;
        let s = list[Math.round(qs[k][r] * (list.length - 1))];
        if (out.includes(s)) s = list.find((q) => !out.includes(q));
        if (s) out.push(s);
      });
    }
    this.chosen = out.slice(0, 8).map((s) => ({ index: s.index, cat: s.cat, color: s.color }));
  }

  waitSites(fn, tries = 0) {
    const all = this.sites();
    if (all.length) { if (!this.chosen) this.choose(all); fn(); return; }
    if (tries < 60) this.timers.push(setTimeout(() => this.waitSites(fn, tries + 1), 150));
  }

  light(c) { try { window.__dots?.lightSite?.(this.mapEl, c.index); } catch (e) { /* ignore */ } }

  livePoints() {
    const all = this.sites();
    return this.chosen.map((c) => all.find((s) => s.index === c.index));
  }

  // the sites light at once and fast (LIGHT_GAP apart); then, if armed, a beat and on to the deck
  rain() {
    this.rained = true;
    this.chosen.forEach((c, i) => this.timers.push(setTimeout(() => this.light(c), i * LIGHT_GAP)));
    if (this.auto) this.timers.push(setTimeout(() => this.advance(), (this.chosen.length - 1) * LIGHT_GAP + HOLD));
  }

  advance(tries = 0) {
    if (!this.auto || this.step !== 0) return;
    const S = window.__scenes;
    if (!S || !S.isActive || !S.isActive()) return;
    const settled = Math.abs(this.el.getBoundingClientRect().top) < 3 && S.target == null && !this.touching;
    if (!settled) { if (tries < 12) this.timers.push(setTimeout(() => this.advance(tries + 1), 150)); return; }
    this.auto = false;
    S.next?.();
  }

  /* ---------------- step state */
  stepNow() {
    const r = this.el.getBoundingClientRect(), vh = innerHeight;
    if (r.top > vh * 0.5) return -1;
    if (r.bottom < vh * 0.5) return 4;
    return clamp(Math.round(-r.top / vh), 0, 3);
  }

  update(force = false) {
    const s = this.stepNow();
    if (s === this.step && !force) return;
    const prev = this.step;
    this.step = s;
    const deck = s >= 1;
    this.el.classList.toggle('is-deck', deck);
    if (s === -1 && this.rained) { // left upwards: the sites light again on the way back down
      this.rained = false;
      window.__dollar?.rainReset?.();
    }
    // auto-advance only on the way down into the map, never when the reader came back up to it
    if (s === 0 && prev !== 0) this.auto = prev < 0 && !this.reduced;
    else if (s !== 0) this.auto = false;
    if (deck) {
      if (prev === 0 && s >= 1 && this.chosen) this.flow();
      this.setFront(clamp(s - 1, 0, 2), this.front >= 0 && !force);
    } else if (this.front >= 0) {
      this.wins.forEach((w) => w.classList.remove('is-on'));
      $$('.lw-tr.is-hit', this.el).forEach((r) => r.classList.remove('is-hit'));
      this.front = -1;
      this.place(0, false);
    } else if (force) this.place(0, false);
  }

  // light as the map lands: on the scene engine, once the glide is in its last fifth (it is an
  // out-ease, so ~0.3s in), not after it settles
  tick() {
    if (this.rained || this.step !== 0) return;
    const r = this.el.getBoundingClientRect();
    const engine = html.classList.contains('scenes-on');
    const ok = engine ? Math.abs(r.top) < innerHeight * 0.2 : (r.top < innerHeight * 0.25 && r.top > -innerHeight * 0.35);
    if (!ok) return;
    const all = this.sites();
    if (!all.length) return;
    if (!this.chosen) this.choose(all);
    this.rain();
  }

  /* ---------------- the deck */
  slots() {
    const p = (parseFloat(getComputedStyle($('.lgx__deck', this.el)).paddingTop) / 2) || 20;
    return [
      { y: 0, z: 0, scale: 1, rotationX: 0, dim: 0, sh: 1 },
      { y: -p, z: -70, scale: 0.955, rotationX: 0, dim: 0.46, sh: 0.5 },
      { y: -2 * p, z: -140, scale: 0.91, rotationX: 0, dim: 0.7, sh: 0.25 },
    ];
  }

  place(f, animate) {
    const g = window.gsap, S = this.slots(), prev = this.front, p = S[1].y * -1;
    this.wins.forEach((w, i) => {
      const to = (i - f + 3) % 3, from = prev < 0 ? to : (i - prev + 3) % 3, v = S[to];
      const dim = $('.lw__dim', w), sh = $('.lw__shadow', w);
      w.style.zIndex = String(3 - to);
      const tv = { y: v.y, z: v.z, scale: v.scale, rotationX: 0 };
      if (!g) {
        w.style.transform = `translate3d(0, ${v.y}px, ${v.z}px) scale(${v.scale})`;
        dim.style.opacity = v.dim; sh.style.opacity = v.sh;
        return;
      }
      g.killTweensOf([w, dim, sh]);
      if (!animate || from === to) { g.set(w, tv); g.set(dim, { opacity: v.dim }); g.set(sh, { opacity: v.sh }); return; }
      if (from === 0 && to === 2) {
        // the front tilts back, sinks and slides behind the stack
        g.to(w, { keyframes: [
          { y: p * 1.6, z: -260, rotationX: 7, scale: 0.97, duration: 0.4, ease: 'power2.out' },
          { ...tv, duration: 0.65, ease: 'expo.out' },
        ] });
      } else if (from === 2 && to === 0) {
        // coming back from the very back: lift up and over, then settle in front
        g.to(w, { keyframes: [
          { y: -p * 4, z: 70, rotationX: -5, scale: 0.97, duration: 0.42, ease: 'power2.out' },
          { ...tv, duration: 0.65, ease: 'expo.out' },
        ] });
      } else if (to === 0) {
        g.fromTo(w, { rotationX: -3 }, { ...tv, duration: 1.05, ease: 'expo.out' });
      } else {
        g.to(w, { ...tv, duration: 1.0, ease: 'expo.out' });
      }
      g.to(dim, { opacity: v.dim, duration: 0.9, ease: 'expo.out' });
      g.to(sh, { opacity: v.sh, duration: 1.0, ease: 'expo.out' });
    });
  }

  setFront(f, animate) {
    if (f === this.front && animate) return;
    const enter = this.front < 0;
    this.place(f, animate && !enter);
    this.front = f;
    this.wins.forEach((w, i) => {
      if (i !== f) { w.classList.remove('is-on'); return; }
      const t = setTimeout(() => { if (this.front === i) w.classList.add('is-on'); }, enter ? 480 : 240);
      this.timers.push(t);
    });
  }

  /* ---------------- map -> ledger flow */
  flow() {
    const svg = this.svg, isl = this.island;
    if (!svg || !isl) return;
    svg.textContent = '';
    const reg = $('.lw--reg', this.el);
    const rows = reg ? $$('.lw-tr[data-cat]', reg) : [];
    if (!rows.length) return;
    const W = isl.clientWidth, H = isl.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const used = {};
    const lines = this.chosen.map((c, i) => {
      const cand = rows.filter((r) => r.dataset.cat === c.cat);
      if (!cand.length) return null;
      const row = cand[(used[c.cat] = (used[c.cat] ?? -1) + 1) % cand.length];
      const sq = $('.lw-sq', row);
      const id = `fl-${Date.now().toString(36)}-${i}`;
      const g = document.createElementNS(SVGNS, 'g');
      g.style.setProperty('--fc', c.color);
      g.innerHTML = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${c.color}" stop-opacity="0"/><stop offset=".55" stop-color="${c.color}" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient></defs>`
        + `<path class="fl-line" pathLength="1" stroke="url(#${id})" stroke-dasharray="1 1" stroke-dashoffset="1"/>`
        + `<path class="fl-spark" pathLength="1" stroke="${c.color}" stroke-dasharray=".1 1.1" stroke-dashoffset=".1"/>`;
      svg.appendChild(g);
      return { g, grad: g.querySelector('linearGradient'), line: g.querySelector('.fl-line'), spark: g.querySelector('.fl-spark'), idx: c.index, row, sq, d0: 0.18 + i * 0.07 };
    }).filter(Boolean);
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const run = () => {
      if (!this.svg) return;
      const t = (performance.now() - t0) / 1000;
      const ir = isl.getBoundingClientRect();
      const all = this.sites();
      lines.forEach((L) => {
        const s = all.find((q) => q.index === L.idx);
        if (!s) return;
        const sr = L.sq.getBoundingClientRect();
        L.tx = sr.left + sr.width / 2 - ir.left; L.ty = sr.top + sr.height / 2 - ir.top;
        const sx = s.x - ir.left, sy = s.y - ir.top;
        const dy = Math.max(60, sy - L.ty);
        L.line.setAttribute('d', `M${sx.toFixed(1)},${sy.toFixed(1)} C${sx.toFixed(1)},${(sy - dy * 0.55).toFixed(1)} ${L.tx.toFixed(1)},${(L.ty + dy * 0.5).toFixed(1)} ${L.tx.toFixed(1)},${L.ty.toFixed(1)}`);
        L.spark.setAttribute('d', L.line.getAttribute('d'));
        L.grad.setAttribute('x1', sx); L.grad.setAttribute('y1', sy); L.grad.setAttribute('x2', L.tx); L.grad.setAttribute('y2', L.ty);
        const u = clamp((t - L.d0) / 0.9, 0, 1);
        if (u >= 1 && !L.hit) { L.hit = true; L.row.classList.remove('is-hit'); void L.row.offsetWidth; L.row.classList.add('is-hit'); }
        L.line.setAttribute('stroke-dashoffset', (1 - ease(u)).toFixed(4));
        const v = clamp((t - L.d0 - 0.12) / 0.95, 0, 1);
        L.spark.setAttribute('stroke-dashoffset', (0.1 - 1.1 * ease(v)).toFixed(4));
        if (t > 1.45 + L.d0 * 0.5) L.g.classList.add('is-out');
      });
      if (t < 2.4) this.flowRaf = requestAnimationFrame(run);
      else svg.textContent = '';
    };
    cancelAnimationFrame(this.flowRaf);
    this.flowRaf = requestAnimationFrame(run);
  }

  destroy() {
    removeEventListener('scroll', this.onScroll);
    removeEventListener('resize', this.onResize);
    if (this.onTouch) ['touchstart', 'touchend', 'touchcancel'].forEach((t) => removeEventListener(t, this.onTouch));
    if (this.onKey) removeEventListener('keydown', this.onKey);
    if (this.onPage) this.ocGrid.removeEventListener('scroll', this.onPage);
    clearInterval(this.poll);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.flowRaf);
    this.timers.forEach(clearTimeout);
    const g = window.gsap;
    if (g) this.wins.forEach((w) => g.killTweensOf([w, $('.lw__dim', w), $('.lw__shadow', w)]));
    if (this.rained) window.__dollar?.rainReset?.();
    if (this.svg) this.svg.textContent = '';
    this.svg = null;
  }
}
