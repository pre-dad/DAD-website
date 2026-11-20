import { test, expect, type Page } from '@playwright/test';
import { ORIGIN, unique } from './support';

// The dashboard journey end to end: one-time setup, finding a sign-up, the
// mailing-list export, the unsubscribe link and its undo, and the privacy
// "delete every record for this email" action. ci-setup-config.sh sets the
// setup key; the setup link only works once per database, so a retry logs in.

const PASSWORD = 'ci-dashboard-password';
test.describe.configure({ mode: 'serial' });

async function signUp(page: Page, email: string, extra: Record<string, string> = {}) {
  const r = await page.request.post('/api/submit.php', {
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    data: JSON.stringify({ type: 'founding', first_name: 'Grace', email, website: '', ts_open: 1, page: '/', ...extra }),
  });
  expect(r.ok()).toBe(true);
}

async function logIn(page: Page) {
  await page.goto('/api/admin/?setup=ci-setup-key');
  if (await page.getByRole('heading', { name: 'Create your password.' }).isVisible()) {
    await page.getByLabel('New password').fill(PASSWORD);
    await page.getByLabel('Repeat it').fill(PASSWORD);
    await page.getByRole('button', { name: 'Save password' }).click();
  } else {
    await page.goto('/api/admin/');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Submissions' })).toBeVisible();
}

async function search(page: Page, q: string) {
  await page.getByRole('searchbox').fill(q);
  await page.getByRole('button', { name: 'Search' }).click();
}

async function expectNoResults(page: Page) {
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('.panel .empty')).toBeVisible();
}

async function mailingList(page: Page) {
  const r = await page.request.get('/api/admin/?export=founding&subscribed=1');
  expect(r.headers()['content-type']).toContain('text/csv');
  return r.text();
}

test('admin: find, export, unsubscribe, resubscribe and delete a sign-up', async ({ page }) => {
  const email = unique('admin');
  const bot = unique('bot');
  await signUp(page, email);
  await signUp(page, bot, { website: 'https://spam.example' });

  await test.step('find the sign-up and screen out the bot', async () => {
    await logIn(page);

    await search(page, email);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('Founding Donor');

    await search(page, bot);
    await expectNoResults(page);
  });

  let unsubscribe = '';
  await test.step('read the unsubscribe link from the export', async () => {
    const row = (await mailingList(page)).split('\r\n').find((l) => l.includes(email));
    expect(row).toBeDefined();
    const link = row!.match(/"(http[^"]*unsubscribe\.php\?t=[a-f0-9]{32})"/)?.[1];
    expect(link).toBeDefined();
    unsubscribe = link!;
  });

  await test.step('unsubscribe and resubscribe through the link', async () => {
    // Link checkers probe with HEAD; that must never unsubscribe anyone.
    expect((await page.request.head(unsubscribe)).status()).toBe(200);
    expect(await mailingList(page)).toContain(email);

    // Opening the link only asks for confirmation: a prefetcher or scanner must not unsubscribe anyone.
    await page.goto(unsubscribe);
    await expect(page.getByRole('heading', { name: 'Unsubscribe from DAD emails?' })).toBeVisible();
    expect(await mailingList(page)).toContain(email);

    await page.getByRole('button', { name: 'Yes, unsubscribe me' }).click();
    await expect(page.getByRole('heading', { name: "You're unsubscribed." })).toBeVisible();
    expect(await mailingList(page)).not.toContain(email);

    await page.getByRole('button', { name: 'Resubscribe' }).click();
    await expect(page.getByRole('heading', { name: "You're back on the list." })).toBeVisible();
    expect(await mailingList(page)).toContain(email);
  });

  await test.step('one-click unsubscribe', async () => {
    // RFC 8058 one-click from a mail app is a bare POST and still unsubscribes.
    const oneClick = await page.request.post(unsubscribe, { form: { 'List-Unsubscribe': 'One-Click' } });
    expect(oneClick.status()).toBe(200);
    expect(await mailingList(page)).not.toContain(email);
  });

  await test.step('delete every record', async () => {
    await page.goto('/api/admin/');
    await search(page, email);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete all' }).click();
    await expect(page.getByRole('status')).toContainText(`Deleted 1 record for ${email}.`);
    await search(page, email);
    await expectNoResults(page);
  });
});

test('admin: without a session the dashboard is closed and a forged delete does nothing', async ({ page }) => {
  const email = unique('forged');
  await signUp(page, email);

  await page.goto('/api/admin/?export=founding');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  const anonymous = await page.request.post('/api/admin/', { form: { act: 'delete_email', email } });
  expect(await anonymous.text()).not.toContain('Deleted');

  await logIn(page);
  await search(page, email);
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('admin: a signed-in delete without the CSRF field is rejected', async ({ page }) => {
  const email = unique('csrf');
  await signUp(page, email);
  await logIn(page);

  const forged = await page.request.post('/api/admin/', { form: { act: 'delete_email', email } });
  expect(forged.status()).toBe(400);

  await search(page, email);
  await expect(page.locator('tbody tr')).toHaveCount(1);
});
