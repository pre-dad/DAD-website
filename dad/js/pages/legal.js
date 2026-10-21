// Legal pages (Privacy, Terms, Accessibility): sticky contents with a
// scrubbed reading-progress rail and the active section highlighted.
let triggers = [];

export function mount(main) {
  const ST = window.ScrollTrigger;
  const toc = main.querySelector('.lg-toc');
  const doc = main.querySelector('.lg-doc');
  if (!ST || !toc || !doc) return;
  const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
  const setActive = (id) => links.forEach((a) => {
    const on = a.getAttribute('href') === `#${id}`;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
  });

  triggers.push(ST.create({
    trigger: doc,
    start: 'top 65%',
    end: 'bottom 75%',
    scrub: 0.4,
    onUpdate: (self) => toc.style.setProperty('--p', self.progress.toFixed(4)),
  }));
  main.querySelectorAll('[data-lg][id]').forEach((blk) => {
    triggers.push(ST.create({
      trigger: blk,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => { if (self.isActive) setActive(blk.id); },
    }));
  });
}

export function unmount() {
  triggers.forEach((t) => t.kill());
  triggers = [];
}
