// Contact: copy-to-clipboard on the address rows, with a tick and an
// announcement for screen readers.
let cleanup = null;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

export function mount(main) {
  const onClick = async (e) => {
    const btn = e.target.closest?.('[data-copy-email]');
    if (!btn || !main.contains(btn)) return;
    const email = btn.dataset.copyEmail;
    await copyText(email);
    btn.classList.add('is-done');
    const label = btn.getAttribute('aria-label');
    btn.setAttribute('aria-label', `Copied ${email}`);
    const live = document.getElementById('announcer');
    if (live) { live.textContent = ''; setTimeout(() => { live.textContent = `Copied ${email}`; }, 30); }
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.classList.remove('is-done'); btn.setAttribute('aria-label', label.startsWith('Copied') ? `Copy ${email}` : label); }, 2000);
  };
  main.addEventListener('click', onClick);
  cleanup = () => main.removeEventListener('click', onClick);
}

export function unmount() { cleanup?.(); cleanup = null; }
