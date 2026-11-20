import { test, expect } from '@playwright/test';

// The Open Ledger mockup: labelled as example data, fonts from this origin, and a
// map whose pins work from the keyboard and respect reduced motion.

test('impactledger: says it is example data and asks not to be indexed', async ({ page }) => {
  await page.goto('/impactledger');
  await expect(page.getByRole('note')).toContainText('Example data, not real records');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('button:not([disabled]):not([id])')).toHaveCount(0);
});

test('impactledger: loads nothing from another origin', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:8080/') && !r.url().startsWith('data:')) external.push(r.url()); });
  const csp: string[] = [];
  page.on('console', (m) => { if (/content security policy/i.test(m.text())) csp.push(m.text()); });
  await page.goto('/impactledger', { waitUntil: 'networkidle' });
  expect(external).toEqual([]);
  expect(csp).toEqual([]);
});

test('impactledger: map pins are reachable and described from the keyboard', async ({ page }) => {
  await page.goto('/impactledger');
  const pins = page.locator('#usmap .pin');
  expect(await pins.count()).toBeGreaterThan(10);
  const first = pins.first();
  await expect(first).toHaveAttribute('tabindex', '0');
  await expect(first).toHaveAttribute('aria-label', /people reached/);
  await first.focus();
  await expect(page.locator('#tip')).toHaveCSS('opacity', '1');
  await expect(page.locator('#tip .t-city')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tip')).toHaveCSS('opacity', '0');
});

test('impactledger: reduced motion removes the map animation', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/impactledger');
  await expect(page.locator('#usmap .pin').first()).toHaveAttribute('opacity', '1');
  expect(await page.locator('#usmap animate').count()).toBe(0);
  await expect(page.locator('#map-pause')).toBeHidden();
  await context.close();
});

test('impactledger: the map animation can be paused', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.goto('/impactledger');
  expect(await page.locator('#usmap animate').count()).toBeGreaterThan(0);
  const pause = page.locator('#map-pause');
  await expect(pause).toHaveAttribute('aria-pressed', 'false');
  await pause.click();
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (document.getElementById('usmap') as unknown as SVGSVGElement).animationsPaused())).toBe(true);
  await pause.click();
  expect(await page.evaluate(() => (document.getElementById('usmap') as unknown as SVGSVGElement).animationsPaused())).toBe(false);
  await context.close();
});
