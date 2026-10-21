// /transparency/ page module: scroll-spy for the sticky "On this page" index.
let triggers = [];

export function mount(main, ctx) {
  const ST = ctx.ScrollTrigger;
  if (!ST) return;
  const links = [...main.querySelectorAll('.tx-toc a')];
  const set = (id) => links.forEach((a) => {
    const on = a.getAttribute('href') === '#' + id;
    a.classList.toggle('is-current', on);
    if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  });
  main.querySelectorAll('[data-toc]').forEach((b) => {
    triggers.push(ST.create({
      trigger: b, start: 'top 45%', end: 'bottom 45%',
      onToggle: (self) => { if (self.isActive) set(b.id); },
    }));
  });
}

export function unmount() {
  triggers.forEach((t) => t.kill());
  triggers = [];
}
