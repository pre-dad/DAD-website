// "Partner with us" modal. Any link with [data-partner-open] opens a small form
// (Name, Email, Company name, Note) that posts as data-form="partner" through forms.js.
// The link keeps a real href (/movement/?partner=1, which auto-opens the form) so it still works without JavaScript.
// Native <dialog> (top layer, inert page behind it) + our own Tab trap, Esc to close, no libraries.
import { $, $$, html, id } from './util.js?v=f5d5bbea69';
import * as forms from './forms.js?v=f5d5bbea69';

let dlg = null;
let lastFocus = null;
let fresh = false;   // false = the form must be rebuilt before the next open (new page, or already sent)

const TITLE_ID = id('pm-title');

function formMarkup() {
  return `<form class="form" data-form="partner" action="/api/submit.php" method="post">
      <div class="form__row form__row--2">
        <div class="field"><input class="field__input" name="name" type="text" autocomplete="name" maxlength="120" placeholder=" " required><label class="field__label">Name</label></div>
        <div class="field"><input class="field__input" name="email" type="email" autocomplete="email" inputmode="email" maxlength="254" placeholder=" " required><label class="field__label">Email</label></div>
      </div>
      <div class="field"><input class="field__input" name="company" type="text" autocomplete="organization" maxlength="160" placeholder=" " required><label class="field__label">Company name</label></div>
      <div class="field"><textarea class="field__input" name="note" rows="4" maxlength="2000" placeholder=" "></textarea><label class="field__label">Note (optional)</label></div>
      <button class="btn btn--primary btn--lg" type="submit"><span class="btn__label">Let's talk</span></button>
      <p class="form__note">A real person from the founding team reads this and replies. Nobody gets added to a list.</p>
    </form>`;
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'pmodal is-light';
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', TITLE_ID);
  dlg.setAttribute('data-lenis-prevent', '');      // let the panel scroll natively under Lenis
  dlg.setAttribute('data-scene-native', '');       // and under scene scrolling
  dlg.innerHTML = `<div class="pmodal__panel">
    <button class="pmodal__close" type="button" aria-label="Close"><span aria-hidden="true"></span></button>
    <p class="eyebrow pmodal__eyebrow">Partners</p>
    <h2 class="pmodal__title" id="${TITLE_ID}">Build it with us.</h2>
    <p class="pmodal__lede">Tell us who you are. We'll take it from there.</p>
    <div class="pmodal__body"></div>
  </div>`;
  document.body.appendChild(dlg);
  $('.pmodal__close', dlg).addEventListener('click', () => close());
  // click on the backdrop (the dialog box itself, outside the panel) closes
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  // Esc: the browser fires "cancel"; animate our own close instead
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('keydown', trap);
}

function focusables() {
  return $$('a[href], button:not([disabled]), input:not([type="hidden"]):not([tabindex="-1"]), textarea, select, [tabindex]:not([tabindex="-1"])', dlg)
    .filter((el) => !el.closest('.form__hp') && el.getClientRects().length > 0);
}

function trap(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key !== 'Tab') return;
  const f = focusables();
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1];
  const a = document.activeElement;
  if (e.shiftKey && (a === first || !dlg.contains(a) || a === $('.form-success', dlg))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (a === last || !dlg.contains(a))) { e.preventDefault(); first.focus(); }
}

function prepare() {
  const body = $('.pmodal__body', dlg);
  // a new page lifecycle (forms.unbind ran) or a sent form: start clean
  if (!fresh || !$('form[data-form="partner"]', body)) {
    body.innerHTML = formMarkup();
    forms.bind(body);
    fresh = true;
  }
}

export function open(trigger) {
  if (!dlg) build();
  if (dlg.open) return;
  prepare();
  lastFocus = trigger || document.activeElement;
  dlg.classList.remove('is-closing');
  try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
  window.__lenis?.stop();
  html.classList.add('is-locked');
  requestAnimationFrame(() => dlg.classList.add('is-open'));
  const first = $('.field__input', dlg) || $('.form-success', dlg);
  first?.focus({ preventScroll: true });
}

export function close() {
  if (!dlg || !dlg.open || dlg.classList.contains('is-closing')) return;
  const sent = !$('form[data-form="partner"]', dlg);
  dlg.classList.remove('is-open');
  dlg.classList.add('is-closing');
  const reduced = html.classList.contains('reduced');
  const finish = () => {
    dlg.classList.remove('is-closing');
    try { dlg.close(); } catch (e) { dlg.removeAttribute('open'); }
    if (sent) fresh = false;   // next open shows a clean form
    if (!html.classList.contains('menu-open')) {
      html.classList.remove('is-locked');
      window.__lenis?.start();
    }
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  };
  if (reduced) finish(); else setTimeout(finish, 260);
}

/** Called on every page mount: forms.unbind() dropped the old form's listener, so rebuild on next open. */
export function bind() {
  fresh = false;
  if (dlg?.open) close();
}

export function init() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const t = e.target.closest && e.target.closest('[data-partner-open]');
    if (!t) return;
    e.preventDefault();
    // let the phone menu finish closing (it unlocks scroll) before the dialog locks it again
    if (html.classList.contains('menu-open')) setTimeout(() => open(t), 60); else open(t);
  }, true);
  // /movement/?partner=1 (old /partners/ links, no-JS fallback) opens the form on arrival
  if (/[?&]partner=1\b/.test(location.search)) {
    history.replaceState(history.state, '', location.pathname + location.hash);
    setTimeout(() => open(), 400);
  }
}
