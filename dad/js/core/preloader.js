// First-visit preloader: ink screen, DAD glyphs rise, tail bars slide in,
// "AID, DELIVERED.", then the whole screen wipes up revealing the hero.
// Resolves the returned promise when the page should start revealing.
import { html, store, emit, prefersReduced } from './util.js?v=f5d5bbea69';

const MIN = 1250;   // let the logo animation land
const MAX = 1800;   // never longer than this before the wipe starts

export function start() {
  const el = document.getElementById('preloader');
  const skip = !el || html.classList.contains('no-pl') || prefersReduced();
  if (skip) {
    el?.remove();
    emit('dad:preloader-done', { skipped: true });
    return Promise.resolve();
  }
  store.set('dad-pl', '1', sessionStorage);
  return new Promise((resolve) => {
    let fired = false;
    const go = () => {
      if (fired) return;
      fired = true;
      // compositor-driven CSS transition (stays smooth even if the main thread is busy compiling WebGL)
      html.classList.add('pl-leaving');
      // reveals start as the curtain lifts
      setTimeout(() => { resolve(); emit('dad:preloader-done', { skipped: false }); }, 260);
      let gone = false;
      const remove = () => { if (gone) return; gone = true; el.remove(); };
      el.addEventListener('transitionend', (e) => { if (e.target === el && e.propertyName === 'transform') remove(); });
      setTimeout(remove, 1700);
    };
    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    Promise.race([fontsReady, new Promise((r) => setTimeout(r, MAX))]).then(() => {
      // the logo animation started with the first paint (CSS), not when this module ran,
      // so time it from navigation start: a slow JS boot never adds a second wait on top
      setTimeout(go, Math.max(0, Math.min(MAX, MIN) - performance.now()));
    });
    setTimeout(go, Math.max(0, MAX - performance.now()));
  });
}
