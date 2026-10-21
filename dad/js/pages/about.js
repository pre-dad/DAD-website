// ABOUT page: the founder letter reads itself in. Each word of each paragraph
// brightens from faint to full as it scrolls through the reading line
// (scrubbed, reversible). Words are only wrapped, never changed.
// Reduced motion / missing GSAP: the letter is shown fully, untouched.

let ctxG = null;
let splits = [];
let alive = false;

export function mount(main, { gsap, ScrollTrigger: ST, reduced } = {}) {
  alive = true;
  const SplitText = window.SplitText;
  if (reduced || !gsap || !ST || !SplitText) return;
  const paras = Array.from(main.querySelectorAll('[data-readalong] p'));
  // scene pages land each paragraph whole, so it reads itself in on arrival
  const scened = main.hasAttribute('data-scenes');
  if (!paras.length) return;
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  fontsReady.then(() => {
    if (!alive) return;
    ctxG = gsap.context(() => {
      paras.forEach((p) => {
        const s = SplitText.create(p, { type: 'words', wordsClass: 'rw', aria: 'auto' });
        splits.push(s);
        if (scened) {
          gsap.fromTo(s.words, { opacity: 0.16 }, {
            opacity: 1, ease: 'power1.out', duration: 0.5, stagger: { amount: 1.8 },
            scrollTrigger: { trigger: p, start: 'top 88%', toggleActions: 'play none none none' },
          });
          return;
        }
        gsap.fromTo(s.words, { opacity: 0.16 }, {
          opacity: 1,
          ease: 'none',
          stagger: 0.12,
          scrollTrigger: { trigger: p, start: 'top 82%', end: 'bottom 52%', scrub: 0.6 },
        });
      });
    }, main);
    ST.refresh();
  });
}

export function unmount() {
  alive = false;
  ctxG?.revert();
  ctxG = null;
  splits.forEach((s) => { try { s.revert(); } catch (e) { /* ignore */ } });
  splits = [];
}
