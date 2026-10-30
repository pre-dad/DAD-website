import { test, expect } from '@playwright/test';

// The forms API contract (api/README.txt), exercised over HTTP against the real
// submit.php and a throwaway SQLite database. example.com is a quiet domain, so
// rows are saved but no email is sent.

const ORIGIN = 'http://127.0.0.1:8080';
const unique = (tag: string) => `${tag}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const post = (data: Record<string, unknown>, headers: Record<string, string> = {}) => ({
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
  data: JSON.stringify({ website: '', ts_open: 1, page: '/', ...data }),
});

test('submit: a valid sign-up returns its referral id', async ({ request }) => {
  const r = await request.post('/api/submit.php', post({ type: 'updates', first_name: 'Ada', email: unique('ok') }));
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body).toMatchObject({ ok: true, type: 'updates' });
  expect(body.id).toMatch(/^[a-z2-9]{10}$/);
});

test('submit: an invalid field is rejected and named so the form can highlight it', async ({ request }) => {
  const r = await request.post('/api/submit.php', post({ type: 'volunteer', first_name: 'Ada', email: 'not-an-email', city: 'Atlanta' }));
  expect(r.status()).toBe(400);
  expect(await r.json()).toEqual({ ok: false, error: "That email doesn't look right.", field: 'email' });
});

test('submit: an unknown form type is rejected', async ({ request }) => {
  const r = await request.post('/api/submit.php', post({ type: 'admin', first_name: 'Ada', email: unique('type') }));
  expect(r.status()).toBe(400);
  expect((await r.json()).ok).toBe(false);
});

test('submit: posts from another website are refused', async ({ request }) => {
  const r = await request.post('/api/submit.php', post({ type: 'updates', first_name: 'Ada', email: unique('xo') }, { Origin: 'https://evil.example' }));
  expect(r.status()).toBe(403);
});

test('submit: a JSON post without ts_open is refused', async ({ request }) => {
  const r = await request.post('/api/submit.php', {
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    data: JSON.stringify({ type: 'updates', first_name: 'Ada', email: unique('nots'), website: '' }),
  });
  expect(r.status()).toBe(400);
});

test('submit: only POST is allowed', async ({ request }) => {
  const r = await request.get('/api/submit.php');
  expect(r.status()).toBe(405);
  expect(r.headers()['allow']).toBe('POST');
});

test('submit: a mailing-list email signs up once; repeats return the same referral id', async ({ request }) => {
  const email = unique('dup');
  const first = await (await request.post('/api/submit.php', post({ type: 'founding', first_name: 'Ada', email }))).json();
  const again = await (await request.post('/api/submit.php', post({ type: 'founding', first_name: 'Ada', email: email.toUpperCase() }))).json();
  expect(first.ok).toBe(true);
  expect(again).toEqual(first);
});

test('submit: a no-JavaScript form post gets the branded result page', async ({ request }) => {
  const r = await request.post('/api/submit.php', {
    headers: { Origin: ORIGIN },
    form: { type: 'volunteer', first_name: 'Ada', email: unique('nojs'), city: 'Atlanta', website: '', page: '/movement/' },
  });
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('text/html');
  const html = await r.text();
  expect(html).toContain("You're on the list.");
  expect(html).toContain('href="/movement/"');
});

test('health: reports ok when config and storage work', async ({ request }) => {
  const r = await request.get('/api/health.php');
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ ok: true });
});
