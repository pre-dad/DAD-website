import { test, expect } from '@playwright/test';
import { CANONICAL_PAGES } from './pages';
import { ORIGIN } from './support';

const BASE_ORIGIN = new URL(ORIGIN).origin;

// ---------------------------------------------------------------------------
// Home CTAs + founding form present
// ---------------------------------------------------------------------------
test('home: CTAs and founding form are present', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });

  // Donate link to /give/.
  await expect(page.locator('a[href="/give/"]').first()).toHaveCount(1);

  // At least one visible get-involved CTA to /movement/.
  await expect(page.locator('a[href="/movement/"]').first()).toBeVisible();

  // Partner-modal trigger exists.
  await expect(page.locator('[data-partner-open]').first()).toHaveCount(1);

  // Founding form with its fields visible.
  const form = page.locator('form#hm-join[data-form="founding"]');
  await expect(form).toBeVisible();
  await expect(form.locator('input[name="first_name"]')).toBeVisible();
  await expect(form.locator('input[name="email"]')).toBeVisible();
});

// ---------------------------------------------------------------------------
// get-involved -> movement 301 (router.php mirrors the .htaccess RedirectMatch)
// ---------------------------------------------------------------------------
test('redirect: /get-involved/ 301 -> /movement/', async ({ page }) => {
  const r = await page.request.get('/get-involved/', { maxRedirects: 0 });
  expect(r.status()).toBe(301);
  expect(r.headers()['location']).toBe('/movement/');
});

// ---------------------------------------------------------------------------
// Form round-trip: real submit.php -> validate -> SQLite write against temp DB.
// example.com is a quiet domain, so the row is saved but NO email is sent.
// Unique local-part avoids the founding list's email dedupe.
// ---------------------------------------------------------------------------
test('home: founding form round-trip shows success UI', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });

  const form = page.locator('form#hm-join[data-form="founding"]');
  await expect(form).toBeVisible();

  await form.locator('input[name="first_name"]').fill('Testy');
  await form.locator('input[name="email"]').fill(`ci+${Date.now()}@example.com`);
  await form.locator('button[type="submit"]').click();

  // forms.js replaces the form node with .form-success on a 200.
  await expect(page.locator('.form-success')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.form-success__title')).toContainText('Founding Donor');
});

// ---------------------------------------------------------------------------
// Internal broken-link check across the canonical pages.
// Collect same-origin <a href> values; skip external hosts, mailto/tel,
// javascript:, and pure #fragments. Each unique internal link must return 200
// (or the one known 301: /get-involved/ -> /movement/).
// ---------------------------------------------------------------------------
test('internal links across all pages resolve (200, or the known 301)', async ({ page }) => {
  const internal = new Set<string>();

  for (const path of CANONICAL_PAGES) {
    await page.goto(path, { waitUntil: 'load' });
    const hrefs = await page.locator('a[href]').evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute('href') || ''),
    );
    for (const href of hrefs) {
      if (!href) continue;
      if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
      if (href.startsWith('#')) continue;

      let abs: URL;
      try {
        abs = new URL(href, `${BASE_ORIGIN}${path}`);
      } catch {
        continue;
      }
      if (abs.origin !== BASE_ORIGIN) continue; // skip external
      abs.hash = '';
      internal.add(abs.pathname + abs.search);
    }
  }

  const bad: string[] = [];
  for (const link of internal) {
    const r = await page.request.get(link, { maxRedirects: 0 });
    const status = r.status();
    if (status === 200) continue;
    if (status === 301 && link.replace(/\/$/, '') === '/get-involved') continue; // known redirect
    bad.push(`${status} ${link}`);
  }

  expect(bad, `broken internal links:\n${bad.join('\n')}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// The /problem/ leaks layout follows the viewport instead of the width at load
// ---------------------------------------------------------------------------
test('problem: the pinned leaks layout switches on resize without a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/problem/', { waitUntil: 'load' });
  const pinned = () => page.locator('.ph-leaks').evaluate((el) => el.style.getPropertyValue('--ph-h') !== '');
  await expect.poll(pinned).toBe(true);
  await page.setViewportSize({ width: 800, height: 800 });
  await expect.poll(pinned).toBe(false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(pinned).toBe(true);
});

// ---------------------------------------------------------------------------
// Scroll-driven content stays readable when the app does not boot
// ---------------------------------------------------------------------------
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('how-it-works: every loop step and choice is visible', async ({ page }) => {
    await page.goto('/how-it-works/', { waitUntil: 'load' });
    for (const selector of ['.hw-step', '.hw-pick', '.hw-feed__row']) {
      const items = page.locator(selector);
      const count = await items.count();
      expect(count, `${selector} present`).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) await expect(items.nth(i)).toBeVisible();
      for (let i = 0; i < count; i++) {
        const opacity = await items.nth(i).evaluate((el) => getComputedStyle(el).opacity);
        expect(Number(opacity), `${selector} #${i} opacity`).toBe(1);
      }
    }
  });

  test('problem: every fact and force is fully opaque', async ({ page }) => {
    await page.goto('/problem/', { waitUntil: 'load' });
    for (const selector of ['.ph-fact', '.ph-force']) {
      const items = page.locator(selector);
      const count = await items.count();
      expect(count, `${selector} present`).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const opacity = await items.nth(i).evaluate((el) => getComputedStyle(el).opacity);
        expect(Number(opacity), `${selector} #${i} opacity`).toBe(1);
      }
    }
  });
});
