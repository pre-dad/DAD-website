// Forms: <form class="form" data-form="founding|updates|support|volunteer|contact|partner">
// Progressive enhancement over a normal POST to /api/submit.php. With JS we post
// JSON, validate inline, keep typed input on error and swap in the success copy.
import { $, $$, store, id } from './util.js?v=96b7c0d426';

const ENDPOINT = '/api/submit.php';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const TOPICS = ['Giving', 'Partnership', 'Press', 'Careers', 'Something else'];

// Same wording as result_html() in api/submit.php, which answers no-JS posts.
const SUCCESS = {
  founding: {
    title: "You're a Founding Donor.",
    text: "Permanently. The badge will be on your profile the day the app opens.",
    share: true,
  },
  updates: { title: "You're on the list.", text: '' },
  support: { title: 'Got it.', text: "We'll let you know as soon as a program opens near you. Nothing else, nothing more." },
  volunteer: { title: "You're on the list.", text: "When an Impact Team forms in your city, you'll hear from us first." },
  contact: { title: 'Message received.', text: 'A real person from the founding team will reply.' },
  // partner modal (core/partner-modal.js)
  partner: { title: "We'll be in touch.", text: 'A real person from the founding team will reply to you directly. Check your inbox for a note from us.' },
};

const MSG = {
  first_name: 'Please add your first name.',
  name: 'Please add your name.',
  email: 'Please add your email.',
  email_bad: "That email doesn't look right.",
  contact: 'Please add an email or a phone number.',
  phone_bad: "That phone number doesn't look right.",
  zip: 'Please add a 5-digit ZIP code.',
  city: 'Please add your city.',
  topic: 'Please choose what this is about.',
  message: 'Please add a message.',
  company: 'Please add your company name.',
  network: "We couldn't reach the server. Check your connection and try again.",
  generic: 'Something went wrong. Please try again.',
};

let bound = [];

// capture ?ref= once per visit so a referral survives navigation
try {
  const r = new URLSearchParams(location.search).get('ref');
  if (r && /^[\w-]{1,40}$/.test(r)) store.set('dad-ref', r);
} catch (e) { /* ignore */ }

function fieldOf(input) { return input.closest('.field') || input.parentElement; }

function errEl(input) {
  const f = fieldOf(input);
  let e = $('.field__err', f);
  if (!e) {
    e = document.createElement('p');
    e.className = 'field__err';
    e.id = id('err');
    e.setAttribute('aria-live', 'polite');
    f.appendChild(e);
  }
  return e;
}

function setError(input, msg) {
  const e = errEl(input);
  e.textContent = msg || '';
  fieldOf(input).classList.toggle('is-invalid', !!msg);
  if (msg) {
    input.setAttribute('aria-invalid', 'true');
    const d = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    d.add(e.id);
    input.setAttribute('aria-describedby', [...d].join(' '));
  } else input.removeAttribute('aria-invalid');
}

function enhance(form) {
  form.setAttribute('novalidate', '');
  if (!form.getAttribute('action')) form.setAttribute('action', ENDPOINT);
  form.setAttribute('method', 'post');
  // inputs: ids, labels, placeholders for floating labels, error slots
  $$('.field__input', form).forEach((input) => {
    if (!input.id) input.id = id('f');
    const label = $('.field__label', fieldOf(input));
    if (label && !label.htmlFor) label.htmlFor = input.id;
    if (input.tagName !== 'SELECT' && !input.hasAttribute('placeholder')) input.setAttribute('placeholder', ' ');
    errEl(input);
    input.addEventListener('input', () => { if (fieldOf(input).classList.contains('is-invalid')) setError(input, ''); });
  });
  // type + honeypot + timing
  const type = form.dataset.form;
  if (!$('input[name="type"]', form)) form.insertAdjacentHTML('afterbegin', `<input type="hidden" name="type" value="${type}">`);
  if (!$('input[name="website"]', form)) {
    form.insertAdjacentHTML('afterbegin', '<div class="form__hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>');
  }
  if (!$('.form__status', form)) {
    const s = document.createElement('p');
    s.className = 'form__status';
    s.setAttribute('role', 'status');
    s.setAttribute('aria-live', 'polite');
    const btn = $('[type="submit"]', form);
    (btn?.closest('.form__row') || btn || form.lastElementChild).insertAdjacentElement('afterend', s);
  }
  form.dataset.tsOpen = String(Date.now());
}

function collect(form) {
  const fd = new FormData(form);
  const v = (k) => (fd.get(k) || '').toString().trim();
  const d = { type: form.dataset.form };
  ['first_name', 'name', 'email', 'phone', 'zip', 'city', 'topic', 'message', 'company', 'note'].forEach((k) => { if (fd.has(k)) d[k] = v(k); });
  // support form: one "Email or phone" field
  if (fd.has('email_or_phone')) {
    const c = v('email_or_phone');
    if (c.includes('@')) d.email = c; else d.phone = c;
  }
  if (d.email) d.email = d.email.toLowerCase();
  if (fd.has('session_id')) d.session_id = v('session_id');   // post-donation waitlist (/give/welcome/)
  d.ref = store.get('dad-ref') || '';
  d.page = location.pathname;
  d.website = v('website');
  d.ts_open = parseInt(form.dataset.tsOpen || '0', 10);
  return d;
}

function input(form, name) { return form.querySelector(`[name="${name}"]`); }

function validate(form, d) {
  const errs = [];
  const need = (name, msg) => { const el = input(form, name); if (el && !d[name]) errs.push([el, msg]); };
  const t = d.type;
  if (t === 'contact' || t === 'partner') need('name', MSG.name); else need('first_name', MSG.first_name);
  if (t === 'support') {
    const el = input(form, 'email_or_phone') || input(form, 'email') || input(form, 'phone');
    if (!d.email && !d.phone) errs.push([el, MSG.contact]);
    else if (d.email && !EMAIL_RE.test(d.email)) errs.push([el, MSG.email_bad]);
    else if (d.phone && (!/^[0-9+().\-\s]{7,25}$/.test(d.phone) || d.phone.replace(/\D/g, '').length < 10 || d.phone.replace(/\D/g, '').length > 15)) errs.push([el, MSG.phone_bad]); // mirrors api/lib/validate.php valid_phone()
    const z = input(form, 'zip');
    if (z && !/^\d{5}$/.test(d.zip || '')) errs.push([z, MSG.zip]);
  } else {
    const el = input(form, 'email');
    if (el && !d.email) errs.push([el, MSG.email]);
    else if (el && !EMAIL_RE.test(d.email)) errs.push([el, MSG.email_bad]);
  }
  if (t === 'volunteer') need('city', MSG.city);
  if (t === 'partner') need('company', MSG.company);
  if (t === 'contact') {
    const tp = input(form, 'topic');
    if (tp && !TOPICS.includes(d.topic)) errs.push([tp, MSG.topic]);
    need('message', MSG.message);
  }
  return errs.filter((e) => e[0]);
}

function successMarkup(type, rid) {
  const c = SUCCESS[type] || SUCCESS.updates;
  const link = `https://dynamicaid.org/?ref=${encodeURIComponent(rid || '')}`;
  const share = c.share ? `
    <div class="form-success__share">
      <p>Want to bring someone?</p>
      <button class="btn btn--primary btn--sm" type="button" data-copy="${link}"><span class="btn__label">Copy link</span></button>
      <button class="btn btn--ghost btn--sm" type="button" data-share="${link}"><span class="btn__label">Share</span></button>
    </div>` : '';
  return `<div class="form-success" tabindex="-1" role="status">
    <span class="form-success__mark" aria-hidden="true"></span>
    <h2 class="form-success__title">${c.title}</h2>
    ${c.text ? `<p class="form-success__text">${c.text}</p>` : ''}${share}
  </div>`;
}

function showSuccess(form, type, rid) {
  const wrap = document.createElement('div');
  wrap.innerHTML = successMarkup(type, rid).trim();
  const node = wrap.firstElementChild;
  const gsap = window.gsap;
  const swap = () => {
    // keep the form's trailing note (e.g. "One email a month...") out; replace the form only
    form.replaceWith(node);
    window.__ui?.enhanceButtons?.(node);
    node.focus({ preventScroll: true });
    if (gsap) gsap.from(node.children, { y: 24, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.07 });
    window.ScrollTrigger?.refresh();
    if (window.gtag) window.gtag('event', 'sign_up', { method: type });
  };
  if (gsap) gsap.to(form, { opacity: 0, y: -12, duration: 0.3, ease: 'power2.in', onComplete: swap });
  else swap();
  wireShare(node);
  // data-redirect: after the success state has had a moment, move on (welcome page -> /movement/)
  const to = form.dataset.redirect;
  if (to && /^\/[\w\-/]*$/.test(to)) setTimeout(() => { location.href = to; }, 6000);
}

// Post-donation waitlist: Stripe returns ?session_id=cs_...; fill the hidden field and, when the server
// can confirm the gift, prefill name and email.
async function donorPrefill(form) {
  let sid = '';
  try { sid = new URLSearchParams(location.search).get('session_id') || ''; } catch (e) { /* ignore */ }
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sid)) return;
  const h = input(form, 'session_id');
  if (h) h.value = sid;
  try {
    const r = await fetch('/api/donor.php?session_id=' + encodeURIComponent(sid), { credentials: 'same-origin' });
    const b = await r.json();
    if (!b || !b.ok) return;
    const fn = input(form, 'first_name'); const em = input(form, 'email');
    if (fn && !fn.value && b.first_name) fn.value = b.first_name;
    if (em && !em.value && b.email) em.value = b.email;
  } catch (e) { /* blank form is fine */ }
}

function wireShare(root) {
  root.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    const s = e.target.closest('[data-share]');
    if (c) {
      const url = c.dataset.copy;
      try { await navigator.clipboard.writeText(url); } catch (err) {
        const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e2) { /* ignore */ } ta.remove();
      }
      const old = c.getAttribute('aria-label');
      c.setAttribute('aria-label', 'Link copied');
      c.classList.add('is-done');
      const live = document.getElementById('announcer'); if (live) live.textContent = 'Link copied';
      setTimeout(() => { if (old) c.setAttribute('aria-label', old); else c.removeAttribute('aria-label'); c.classList.remove('is-done'); }, 2200);
    }
    if (s) {
      const url = s.dataset.share;
      if (navigator.share) { try { await navigator.share({ url, title: 'DAD · Dynamic Aid Delivery' }); } catch (err) { /* cancelled */ } }
      else { const cp = root.querySelector('[data-copy]'); cp?.click(); }
    }
  });
}

async function onSubmit(e) {
  const form = e.currentTarget;
  e.preventDefault();
  if (form.classList.contains('is-busy')) return;
  const status = $('.form__status', form);
  status.textContent = '';
  $$('.field__input', form).forEach((i) => setError(i, ''));
  const d = collect(form);
  const errs = validate(form, d);
  if (errs.length) {
    errs.forEach(([el, msg]) => setError(el, msg));
    errs[0][0].focus();
    shake(form);
    return;
  }
  const btn = $('[type="submit"]', form);
  form.classList.add('is-busy');
  btn?.classList.add('is-loading');
  btn?.setAttribute('aria-busy', 'true');
  btn && (btn.disabled = true);
  const done = () => {
    form.classList.remove('is-busy');
    btn?.classList.remove('is-loading');
    btn?.removeAttribute('aria-busy');
    btn && (btn.disabled = false);
  };
  let res, body;
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    res = await fetch(form.getAttribute('action') || ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(d),
      signal: ctl.signal,
      credentials: 'same-origin',
    });
    clearTimeout(to);
    body = await res.json().catch(() => ({}));
  } catch (err) {
    done();
    status.textContent = MSG.network;
    return;
  }
  done();
  if (res.ok && body && body.ok) { showSuccess(form, d.type, body.id); return; }
  const msg = (body && body.error) || (res.status === 429 ? 'Too many requests' : MSG.generic);
  const fieldName = body && body.field;
  let target = fieldName ? input(form, fieldName) : null;
  if (!target && fieldName && (fieldName === 'email' || fieldName === 'phone')) target = input(form, 'email_or_phone');
  if (target) { setError(target, msg); target.focus(); }
  else status.textContent = msg;
  shake(form);
}

function shake(form) {
  const gsap = window.gsap;
  if (!gsap || document.documentElement.classList.contains('reduced')) return;
  gsap.fromTo(form, { x: 0 }, { x: 0, duration: 0.5, ease: 'none', keyframes: { x: [0, -7, 6, -4, 3, 0] } });
}

export function bind(root) {
  $$('form[data-form]', root).forEach((form) => {
    if (form.dataset.bound) return;
    form.dataset.bound = '1';
    enhance(form);
    form.addEventListener('submit', onSubmit);
    if (form.hasAttribute('data-donor-prefill')) donorPrefill(form);
    bound.push(form);
  });
}

export function unbind() {
  bound.forEach((f) => f.removeEventListener('submit', onSubmit));
  bound = [];
}
