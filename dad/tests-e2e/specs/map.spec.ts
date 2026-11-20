import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

// The county impact map (/map/): responsive panels, keyboard and screen reader access,
// printing, image export and the data it loads.

async function open(page: Page, width: number, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto('/map/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#ranking .rank-row').first()).toBeAttached();
}

test('map: the opening layer is shown as selected', async ({ page }) => {
  await open(page, 1280);
  await expect(page.locator('#layer-list input[name="layer"]:checked')).toHaveCount(1);
  await expect(page.locator('#layer-list .layer-item.is-active')).toHaveCount(1);
});

test('map: between 821 and 1040px the ranking is still reachable', async ({ page }) => {
  await open(page, 900);
  const rank = page.locator('#mobile-bar [data-sheet="rank"]');
  await expect(rank).toBeVisible();
  await expect(rank).toHaveAttribute('aria-controls', 'panel-right');
  await expect(rank).toHaveAttribute('aria-expanded', 'false');
  await rank.click();
  await expect(rank).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#panel-right')).toBeVisible();
  await expect(page.locator('#ranking .rank-row').first()).toBeInViewport();
});

test('map: a closed sheet is hidden from the keyboard and screen readers', async ({ page }) => {
  await open(page, 390, 844);
  await expect(page.locator('#panel-left')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#panel-right')).toHaveCSS('visibility', 'hidden');
  await page.locator('#mobile-bar [data-sheet="layers"]').click();
  await expect(page.locator('#panel-left')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('#panel-right')).toHaveCSS('visibility', 'hidden');
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel-left')).toHaveCSS('visibility', 'hidden');
});

test('map: tab bar labels are at least 11px and fit on a 320px screen', async ({ page }) => {
  await open(page, 320, 640);
  const fit = await page.locator('#mobile-bar button').evaluateAll((els) =>
    els.map((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), over: el.scrollWidth - el.clientWidth })));
  for (const b of fit) {
    expect(b.size).toBeGreaterThanOrEqual(11);
    expect(b.over).toBeLessThanOrEqual(0);
  }
});

test('map: moving a slider keeps the ranking scroll position', async ({ page }) => {
  await open(page, 1280);
  await page.locator('.mode-btn[data-mode="index"]').click();
  const scroll = page.locator('#panel-right .panel-scroll');
  await scroll.evaluate((el) => { el.scrollTop = 150; });
  const before = await scroll.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);
  await page.locator('[data-weight]').first().evaluate((el: HTMLInputElement) => {
    el.value = '90';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  expect(await scroll.evaluate((el) => el.scrollTop)).toBe(before);
});

test('map: printing a county brief prints the brief, not the map', async ({ page }) => {
  await open(page, 1280);
  await page.locator('#ranking .rank-name').first().click();
  await page.locator('#btn-brief').click();
  await expect(page.locator('#modal-body')).toContainText('data built');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.modal-box table.brief').first()).toBeVisible();
  await expect(page.locator('.layout')).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('visible');
});

test('map: Save PNG keeps the state outlines unfilled', async ({ page }) => {
  await open(page, 1280);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-png').click()]);
  const png = readFileSync(await download.path());
  const share = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let black = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 12) black++;
    return black / (px.length / 4);
  }, png.toString('base64'));
  // The page background is dark teal ink, never pure black; a stylesheet-less export paints the state outlines solid black.
  expect(share).toBeLessThan(0.02);
});

test('map: a shortlist in storage that is not a list of known counties is ignored', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('dad.shortlist', JSON.stringify(['99999', '13121']));
  });
  await open(page, 1280);
  await expect(page.locator('#shortlist-count')).toHaveText('1');
  await page.evaluate(() => localStorage.setItem('dad.shortlist', '"13121"'));
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#shortlist-count')).toHaveText('0');
});

test('map: a failed data request shows a plain message, not a build command', async ({ page }) => {
  await page.route('**/data/counties.json', (r) => r.fulfill({ status: 404, body: '<html>missing</html>', contentType: 'text/html' }));
  await page.goto('/map/');
  const err = page.locator('#boot-err');
  await expect(err).toContainText('could not be loaded');
  await expect(err).not.toContainText('refresh.sh');
});

test('map: the debug handle is not exposed without ?debug', async ({ page }) => {
  await open(page, 1280);
  expect(await page.evaluate(() => 'DADMap' in window)).toBe(false);
  await page.goto('/map/?debug');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 20_000 });
  expect(await page.evaluate(() => 'DADMap' in window)).toBe(true);
});

test('map: no critical or serious axe violations with a sheet open on a phone', async ({ page }) => {
  await open(page, 390, 844);
  await page.locator('#mobile-bar [data-sheet="rank"]').click();
  await expect(page.locator('#panel-right')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});
