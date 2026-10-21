// Get Involved: the sticky in-page switcher (desktop). Highlights the section
// in view and slides a red pill under it. Hash links are smooth-scrolled by
// the router; this module only tracks state.
let triggers = [];
let onResize = null;

export function mount(main) {
  const ST = window.ScrollTrigger;
  const body = main.querySelector('.gi-body');
  const track = main.querySelector('.gi-switch__track');
  if (!ST || !body || !track) return;
  const ind = track.querySelector('.gi-switch__ind');
  const links = Array.from(track.querySelectorAll('[data-gi]'));
  let active = null;

  const place = () => {
    const a = links.find((l) => l.dataset.gi === active);
    if (!a || !ind) { ind?.style.setProperty('--o', '0'); return; }
    ind.style.setProperty('--x', `${a.offsetLeft}px`);
    ind.style.setProperty('--w', `${a.offsetWidth}px`);
    ind.style.setProperty('--o', '1');
  };
  const setActive = (id) => {
    if (id === active) return;
    active = id;
    links.forEach((l) => {
      const on = l.dataset.gi === id;
      l.classList.toggle('is-active', on);
      if (on) l.setAttribute('aria-current', 'true'); else l.removeAttribute('aria-current');
    });
    place();
  };

  // show the bar once the hero has scrolled away; hide it at the very end
  triggers.push(ST.create({
    trigger: body,
    start: 'top 70%',
    end: 'bottom 85%',
    onToggle: (self) => body.classList.toggle('is-switch-on', self.isActive),
  }));

  main.querySelectorAll('[data-gi-sec]').forEach((sec) => {
    triggers.push(ST.create({
      trigger: sec,
      start: 'top 45%',
      end: 'bottom 45%',
      onToggle: (self) => { if (self.isActive) setActive(sec.dataset.giSec); },
    }));
  });

  onResize = () => place();
  window.addEventListener('resize', onResize, { passive: true });
  if (document.fonts) document.fonts.ready.then(place);
}

export function unmount() {
  triggers.forEach((t) => t.kill());
  triggers = [];
  if (onResize) window.removeEventListener('resize', onResize);
  onResize = null;
}
