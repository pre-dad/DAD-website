import { test, expect, type Request, type Response } from '@playwright/test';
import { CANONICAL_PAGES, EXTRA_PAGES } from './pages';
import { ORIGIN } from './support';

// Per-page health check for every canonical page:
//   - HTTP 200 and the document loads
//   - no uncaught JS console errors
//   - no failed / 4xx+ SAME-ORIGIN asset requests
//   - a visible <h1> AND the main landmark (main#swap)
//   - the primary nav is present
//
// Only same-origin requests count (compared against baseURL's origin), so third-party
// analytics and fonts cannot make the check flaky. No layout or visual assertions.

const BASE_ORIGIN = new URL(ORIGIN).origin;

// Asset request types whose same-origin 4xx/failure we treat as a broken page.
const ASSET_TYPES = new Set(['stylesheet', 'script', 'font', 'image']);

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === BASE_ORIGIN;
  } catch {
    return false;
  }
}

for (const path of [...CANONICAL_PAGES, ...EXTRA_PAGES]) {
  test(`page health: ${path}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const assetProblems: string[] = [];

    // Attach listeners BEFORE navigating so nothing is missed.
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });
    page.on('requestfailed', (req: Request) => {
      const url = req.url();
      if (isSameOrigin(url)) {
        assetProblems.push(`requestfailed ${req.resourceType()} ${url} (${req.failure()?.errorText ?? 'unknown'})`);
      }
    });
    page.on('response', (resp: Response) => {
      const req = resp.request();
      const url = resp.url();
      if (resp.status() >= 400 && isSameOrigin(url) && ASSET_TYPES.has(req.resourceType())) {
        assetProblems.push(`${resp.status()} ${req.resourceType()} ${url}`);
      }
    });

    const resp = await page.goto(path, { waitUntil: 'load' });
    expect(resp, `no response for ${path}`).not.toBeNull();
    expect(resp!.status(), `expected 200 for ${path}`).toBe(200);

    // Structure: a visible <h1> and the main landmark.
    await expect(page.locator('h1'), `exactly one <h1> on ${path}`).toHaveCount(1);
    await expect(page.locator('h1'), `visible <h1> on ${path}`).toBeVisible();
    await expect(page.locator('main#swap'), `main#swap landmark on ${path}`).toBeVisible();

    // Primary nav present.
    await expect(
      page.locator('nav.nav__links[aria-label="Primary"]'),
      `primary nav on ${path}`,
    ).toBeVisible();

    // app.js sets __booted once the page is wired up; late asset failures surface before that.
    await page.waitForFunction(() => (window as any).__booted === true);

    expect(consoleErrors, `console errors on ${path}:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(assetProblems, `failed same-origin assets on ${path}:\n${assetProblems.join('\n')}`).toEqual([]);
  });
}

