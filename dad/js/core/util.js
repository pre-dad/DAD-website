// Shared helpers for the DAD core runtime.
export const html = document.documentElement;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };
export const prefersReduced = () => mq('(prefers-reduced-motion: reduce)');
export const isFinePointer = () => mq('(hover: hover) and (pointer: fine)');
export const isTouch = () => mq('(hover: none), (pointer: coarse)') || 'ontouchstart' in window && !isFinePointer();
export const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
export const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const store = {
  get(k, s = localStorage) { try { return s.getItem(k); } catch (e) { return null; } },
  set(k, v, s = localStorage) { try { s.setItem(k, v); } catch (e) { /* private mode */ } },
};
let uid = 0;
export const id = (p = 'u') => `${p}-${(++uid).toString(36)}`;
