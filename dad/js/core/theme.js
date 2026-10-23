// Section-driven dark/light theme.
// Each <section data-theme="dark|light"> becomes the page theme while it
// crosses the middle of the viewport. The change is a cinematic "flood":
// the new background pours out of the coin (or the viewport centre) with a
// soft edge and a warm rim, while text colours tween underneath.
import { html, $$, prefersReduced, emit } from './util.js?v=f5d5bbea69';

const TWEEN_KEYS = [
  '--fg', '--fg-mut', '--fg-faint', '--line-c', '--line-strong', '--card', '--card-hi',
  '--accent-text', '--ok', '--err', '--infra', '--skeleton', '--skeleton-hi',
  '--glow-o', '--logo-b', '--logo-o', '--shadow-c', '--grain-o', '--nav-bg', '--bg-2',
];
const VALUES = {};
let current = html.dataset.theme === 'light' ? 'light' : 'dark';
let ctx = null;
let footerTrigger = null;
let flood = null;
let floodTween = null;
let varTween = null;
let getDollar = () => null;
let reduced = false;

function readValues() {
  ['dark', 'light'].forEach((t) => {
    const probe = document.createElement('div');
    probe.className = `is-${t}`;
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    VALUES[t] = {};
    [...TWEEN_KEYS, '--bg'].forEach((k) => { VALUES[t][k] = cs.getPropertyValue(k).trim(); });
    probe.remove();
  });
}

function clearInline() {
  TWEEN_KEYS.forEach((k) => html.style.removeProperty(k));
}

function originPoint() {
  // flood out of the coin if the dollar module can tell us where it is
  try {
    const d = getDollar();
    const p = d && typeof d.getScreenPosition === 'function' ? d.getScreenPosition() : null;
    if (p && isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y };
  } catch (e) { /* ignore */ }
  return { x: innerWidth / 2, y: innerHeight * 0.5 };
}

export function get() { return current; }

export function set(theme, { instant = false } = {}) {
  theme = theme === 'light' ? 'light' : 'dark';
  if (theme === current && !instant) return;
  const prev = current;
  current = theme;
  try { getDollar()?.setTheme?.(theme); } catch (e) { /* ignore */ }
  emit('dad:theme', { theme, prev });
  // contract alias: the Dots module (and page code) listen for 'themechange' on document
  try { document.dispatchEvent(new CustomEvent('themechange', { detail: { theme, prev } })); } catch (e) { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#FBF5EE' : '#0E1E1E');

  const gsap = window.gsap;
  if (instant || reduced || !gsap || !VALUES.dark) {
    floodTween?.kill(); varTween?.kill();
    html.dataset.theme = theme;
    clearInline();
    html.style.removeProperty('--bg');
    if (flood) flood.classList.remove('is-on');
    return;
  }

  // freeze current (possibly mid-tween) values inline, then switch the attribute
  const cs = getComputedStyle(html);
  const from = {};
  TWEEN_KEYS.forEach((k) => { from[k] = cs.getPropertyValue(k).trim(); });
  const oldBg = cs.getPropertyValue('--bg').trim();
  floodTween?.kill(); varTween?.kill();
  TWEEN_KEYS.forEach((k) => html.style.setProperty(k, from[k]));
  html.style.setProperty('--bg', oldBg);
  html.dataset.theme = theme;

  const to = VALUES[theme];
  varTween = gsap.to(html, {
    ...Object.fromEntries(TWEEN_KEYS.map((k) => [k, to[k]])),
    duration: 0.95,
    delay: 0.08,
    ease: 'power2.inOut',
    onComplete: clearInline,
  });

  // the flood
  const o = originPoint();
  const far = Math.hypot(Math.max(o.x, innerWidth - o.x), Math.max(o.y, innerHeight - o.y));
  const soft = Math.max(90, Math.min(220, innerWidth * 0.12));
  flood.style.background = to['--bg'];
  flood.style.setProperty('--fx', `${o.x}px`);
  flood.style.setProperty('--fy', `${o.y}px`);
  flood.style.setProperty('--soft', `${soft}px`);
  flood.style.setProperty('--ring', theme === 'light' ? 'rgba(255,184,0,.32)' : 'rgba(255,74,34,.30)');
  flood.classList.add('is-on');
  const st = { r: 0 };
  floodTween = gsap.to(st, {
    r: far + soft + 40,
    duration: theme === 'light' ? 1.25 : 1.0,
    ease: 'power3.inOut',
    onUpdate: () => flood.style.setProperty('--fr', `${st.r}px`),
    onComplete: () => {
      html.style.removeProperty('--bg');
      flood.classList.remove('is-on');
      flood.style.setProperty('--fr', '0px');
    },
  });
  return prev;
}

export function init(opts = {}) {
  reduced = prefersReduced();
  if (opts.getDollar) getDollar = opts.getDollar;
  flood = document.getElementById('flood');
  readValues();
  // the footer always pulls the page back to ink
  const footer = document.getElementById('footer');
  if (footer && window.ScrollTrigger) {
    footerTrigger = window.ScrollTrigger.create({
      trigger: footer,
      start: 'top 70%',
      onEnter: () => set('dark'),
      onLeaveBack: () => {
        const secs = $$('[data-theme]', document.getElementById('swap'));
        const last = secs[secs.length - 1];
        if (last) set(last.dataset.theme);
      },
    });
  }
}

/** Bind a page. animate=true when arriving via the router (floods into the new page). */
export function bind(main, { animate = false } = {}) {
  const ST = window.ScrollTrigger;
  const sections = $$('section[data-theme], [data-theme-section]', main);
  const first = sections[0]?.dataset.theme || main.dataset.theme || html.dataset.theme;
  set(first, { instant: !animate });
  if (!ST || !window.gsap) return;
  ctx = window.gsap.context(() => {
    sections.forEach((sec) => {
      ST.create({
        trigger: sec,
        start: 'top 50%',
        end: 'bottom 50%',
        onToggle: (self) => { if (self.isActive) set(sec.dataset.theme || sec.dataset.themeSection); },
      });
    });
  }, main);
}

export function unbind() {
  ctx?.revert();
  ctx = null;
}

export function refreshFooter() { footerTrigger?.refresh?.(); }
