// Shared helpers for the programs / proof / transparency page modules.

// Keep a coin landing target sitting exactly on the dot map's hub site.
// The dots engine mounts the map (and its .dots-hub marker) asynchronously,
// so poll briefly, then mirror the hub's percentage position.
export function pinToHub(wrap, target) {
  if (!wrap || !target) return null;
  let tries = 0;
  let timer = 0;
  const sync = () => {
    const hub = wrap.querySelector('.dots-hub');
    if (hub && hub.style.left) {
      const dots = hub.parentElement;
      const wr = wrap.getBoundingClientRect();
      const dr = dots.getBoundingClientRect();
      if (wr.width && dr.width) {
        const x = (dr.left - wr.left) + (parseFloat(hub.style.left) / 100) * dr.width;
        const y = (dr.top - wr.top) + (parseFloat(hub.style.top) / 100) * dr.height;
        target.style.left = (x / wr.width * 100) + '%';
        target.style.top = (y / wr.height * 100) + '%';
        return true;
      }
    }
    return false;
  };
  const loop = () => {
    if (sync() || ++tries > 60) return;
    timer = setTimeout(loop, 150);
  };
  loop();
  const onResize = () => sync();
  window.addEventListener('resize', onResize);
  return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
}
