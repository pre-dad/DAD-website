import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// /on-prem-infra/ is an internal budget viewer: it stays out of search indexes,
// ships its own three.js, and must say so when WebGL is unavailable.

test('on-prem: is kept out of search indexes and has its own CSP', async ({ request }) => {
  const res = await request.get('/on-prem-infra/');
  expect(res.headers()['x-robots-tag']).toContain('noindex');
  const csp = res.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/https?:\/\//);
  expect(await res.text()).toMatch(/<meta name="robots" content="noindex/);
});

test('on-prem: three.js is served from this origin, with no third-party requests', async ({ page }) => {
  const external: string[] = [];
  const cspViolations: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')) external.push(r.url()); });
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });
  const vendor = page.waitForResponse((r) => r.url().endsWith('/vendor/three/three.module.min.js'));
  await page.goto('/on-prem-infra/', { waitUntil: 'domcontentloaded' });
  expect((await vendor).status()).toBe(200);
  await page.waitForTimeout(1500);
  expect(external).toEqual([]);
  expect(cspViolations).toEqual([]);
});

test('on-prem: without WebGL the page says so instead of staying blank, and passes axe', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return /webgl/.test(type) ? null : (getContext as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof getContext;
  });
  await page.goto('/on-prem-infra/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#load [role="alert"]')).toContainText('could not start');
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(blocking.map((v) => v.id)).toEqual([]);
});

test('on-prem: parts list exposes the selected part to assistive technology', async ({ page }) => {
  // The scene builds before the list is filled, which is slow under a software renderer.
  test.setTimeout(150_000);
  await page.goto('/on-prem-infra/', { waitUntil: 'domcontentloaded' });
  const gw = page.locator('#list .item[data-key="gateway"]');
  await expect(gw).toHaveAttribute('aria-pressed', 'false', { timeout: 100_000 });
  await gw.click();
  await expect(gw).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(gw).toHaveAttribute('aria-pressed', 'false');
  expect(await gw.evaluate((el) => el.querySelector('div'))).toBeNull();
});
