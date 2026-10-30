import { test, expect, type Request, type Response } from '@playwright/test';
import { CANONICAL_PAGES } from './pages';

// Per-page health check for every canonical page:
//   - HTTP 200 and the document loads
//   - no uncaught JS console errors
//   - no failed / 4xx+ SAME-ORIGIN asset requests
//   - a visible <h1> AND the main landmark (main#swap)
//   - the primary nav is present
//
// Same-origin is compared against baseURL's origin, so cross-origin analytics /
// font CDNs can't make the check flaky. No layout / positional / visual assertions.

const BASE_ORIGIN = new URL('http://127.0.0.1:8080').origin;

// Asset request types whose same-origin 4xx/failure we treat as a broken page.
const ASSET_TYPES = new Set(['stylesheet', 'script', 'font', 'image']);

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === BASE_ORIGIN;
  } catch {
    return false;
  }
}

for (const path of CANONICAL_PAGES) {
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
    await expect(page.locator('h1').first(), `visible <h1> on ${path}`).toBeVisible();
    await expect(page.locator('main#swap'), `main#swap landmark on ${path}`).toBeVisible();

    // Primary nav present.
    await expect(
      page.locator('nav.nav__links[aria-label="Primary"]'),
      `primary nav on ${path}`,
    ).toBeVisible();

    // Let late assets settle, then assert no errors.
    await page.waitForLoadState('networkidle').catch(() => { /* fine if idle never reached */ });

    expect(consoleErrors, `console errors on ${path}:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(assetProblems, `failed same-origin assets on ${path}:\n${assetProblems.join('\n')}`).toEqual([]);
  });
}

