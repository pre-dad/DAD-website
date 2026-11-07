// Small UI enhancements bound per page: button label roll, FAQ accordion
// with animated height, pointer-following card glow.
import { $, $$, isFinePointer, prefersReduced } from './util.js?v=e1a91ab979';

let cleanups = [];

export function enhanceButtons(root) {
  $$('.btn', root).forEach((btn) => {
    if (btn.dataset.rolled || btn.classList.contains('btn--link')) return;
    let label = $('.btn__label', btn);
    if (!label) {
      // wrap loose text nodes
      const text = Array.from(btn.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!text.length) return;
      label = document.createElement('span');
      label.className = 'btn__label';
      label.textContent = text.map((n) => n.textContent).join('').trim();
      text.forEach((n) => n.remove());
      btn.prepend(label);
    }
    const txt = label.textContent.trim();
    if (!txt) return;
    btn.dataset.rolled = '1';
    label.innerHTML = '';
    const roll = document.createElement('span');
    roll.className = 'btn__roll';
    const a = document.createElement('span');
    a.textContent = txt;
    const b = document.createElement('span');
    b.textContent = txt;
    b.setAttribute('aria-hidden', 'true');
    roll.append(a, b);
    label.appendChild(roll);
  });
}

function faq(root) {
  const gsap = window.gsap;
  $$('.faq__item', root).forEach((d) => {
    const sum = $('summary', d);
    const body = $('.faq__a', d);
    if (!sum || !body || d.dataset.faq) return;
    d.dataset.faq = '1';
    const onClick = (e) => {
      if (!gsap || prefersReduced()) return; // native behaviour
      e.preventDefault();
      if (d.dataset.anim) return;
      d.dataset.anim = '1';
      if (!d.open) {
        d.open = true;
        gsap.fromTo(body, { height: 0, opacity: 0 }, {
          height: 'auto', opacity: 1, duration: 0.6, ease: 'expo.out',
          onComplete: () => { delete d.dataset.anim; gsap.set(body, { clearProps: 'height,opacity' }); window.ScrollTrigger?.refresh(); },
        });
      } else {
        gsap.to(body, {
          height: 0, opacity: 0, duration: 0.45, ease: 'power3.inOut',
          onComplete: () => { d.open = false; delete d.dataset.anim; gsap.set(body, { clearProps: 'height,opacity' }); window.ScrollTrigger?.refresh(); },
        });
      }
    };
    sum.addEventListener('click', onClick);
    cleanups.push(() => sum.removeEventListener('click', onClick));
  });
}

function cardGlow(root) {
  if (!isFinePointer()) return;
  const onMove = (e) => {
    const card = e.target.closest?.('.card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  root.addEventListener('pointermove', onMove, { passive: true });
  cleanups.push(() => root.removeEventListener('pointermove', onMove));
}

export function bind(root) {
  enhanceButtons(root);
  faq(root);
  cardGlow(root);
}

export function unbind() { cleanups.forEach((f) => f()); cleanups = []; }

window.__ui = { enhanceButtons };
