// Magnetic buttons (desktop): primary CTAs and [data-magnetic] lean toward the pointer.
import { $$, isFinePointer, prefersReduced } from './util.js?v=e09c939d0f';

let items = [];

function attach(el, list = items) {
  const gsap = window.gsap;
  const inner = el.querySelector('.btn__label') || null;
  const strength = parseFloat(el.dataset.magnetic) || 0.32;
  const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
  const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
  const ixTo = inner ? gsap.quickTo(inner, 'x', { duration: 0.6, ease: 'power3.out' }) : null;
  const iyTo = inner ? gsap.quickTo(inner, 'y', { duration: 0.6, ease: 'power3.out' }) : null;
  const move = (e) => {
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    xTo(dx * strength); yTo(dy * strength);
    ixTo?.(dx * strength * 0.35); iyTo?.(dy * strength * 0.35);
  };
  const leave = () => {
    gsap.to(el, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, 0.4)' });
    if (inner) gsap.to(inner, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, 0.4)' });
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  list.push(() => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerleave', leave);
    // quickTo tweens live on the global timeline until killed: drop them with the page
    // (killed one by one: killTweensOf can't reach a quickTo tween that never ran)
    [xTo, yTo, ixTo, iyTo].forEach((q) => q?.tween?.kill());
    const both = [el, inner].filter(Boolean);
    gsap.killTweensOf(el);
    if (inner) gsap.killTweensOf(inner);
    gsap.set(both, { x: 0, y: 0 });
    delete el.dataset.magBound;
  });
}

export function bind(root) {
  if (!window.gsap || !isFinePointer() || prefersReduced()) return;
  $$('[data-magnetic], .btn--primary.btn--lg, .cta-band .btn--primary', root).forEach((el) => {
    if (el.dataset.magBound) return;
    el.dataset.magBound = '1';
    attach(el);
  });
}

const globalItems = [];
export function bindGlobal(root) {
  if (!window.gsap || !isFinePointer() || prefersReduced()) return;
  $$('[data-magnetic]', root).forEach((el) => {
    if (el.dataset.magBound) return;
    el.dataset.magBound = '1';
    attach(el, globalItems);
  });
}

export function unbind() { items.forEach((f) => f()); items = []; }
