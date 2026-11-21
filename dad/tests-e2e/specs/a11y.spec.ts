import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CANONICAL_PAGES, EXTRA_PAGES } from './pages';

// Gates on critical and serious axe violations; every violation is attached to the
// report. axe covers only part of WCAG, so manual assistive-technology testing is
// still needed.

// /on-prem-infra/ is a WebGL viewer that does not settle under CI's software renderer, so axe skips it;
// it is checked by hand with the axe browser extension whenever its markup or colours change.
const A11Y_PAGES = [...new Set([...CANONICAL_PAGES, ...EXTRA_PAGES, '/map/', '/impactledger'])];

for (const path of A11Y_PAGES) {
  test(`a11y: ${path} has no critical/serious axe violations`, async ({ browser, contextOptions }, testInfo) => {
    // Under reduced motion every reveal lands in its final state at once, so axe
    // scans the settled page instead of a random mid-tween frame (which made
    // color-contrast results flaky).
    const context = await browser.newContext({ ...contextOptions, reducedMotion: 'reduce' });
    // The WebGL dollar is aria-hidden decoration (html.no-gl only hides its canvas). Its first scroll-driven
    // render blocks the main thread for about 5 s under software GL, so every scroll step after it waits on
    // that stall and a loaded runner runs past the test timeout. Load the page without it, as a visitor
    // without WebGL does.
    await context.route('**/js/dollar/dollar.js*', (route) => route.abort());
    const page = await context.newPage();
    await page.goto(path, { waitUntil: 'load' });
    // app.js sets __booted once the page is wired up and __ready once the preloader is done; /map/ and /impactledger do not load it.
    if (await page.locator('script[src^="/js/app.js"]').count()) {
      await page.waitForFunction(() => (window as any).__booted === true);
      await page.evaluate(() => (window as any).__ready);
    }
    await page.evaluate(async () => {
      const frames = (n: number) => new Promise<void>((r) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); });
      // Walk the page so every scroll-triggered reveal fires and every
      // <section data-theme> applies its theme in turn.
      const step = Math.round(window.innerHeight * 0.5);
      for (let y = 0; y <= document.body.scrollHeight; y += step) { window.scrollTo(0, y); await frames(6); }
      // Then centre the tallest section: muted text is only meant to sit on its own
      // section's background, and theme.js themes the page from the section in view.
      const secs = Array.from(document.querySelectorAll<HTMLElement>('main [data-theme], main section, main'));
      let big: HTMLElement | null = null, h = 0;
      for (const s of secs) { if (s.offsetHeight > h) { h = s.offsetHeight; big = s; } }
      (big || document.body).scrollIntoView({ block: 'center' });
      // A theme switch leaves a background-color transition that headless Chromium may not
      // have ticked yet; jump finite animations to their end state so axe reads the settled page.
      // The switch itself starts a few frames after the scroll, so finish once it has begun and again after.
      const settle = () => document.getAnimations().forEach((an) => { try { an.finish(); } catch { /* infinite */ } });
      await frames(30);
      settle();
      await frames(10);
      settle();
    });

    const results = await new AxeBuilder({ page }).analyze();
    await context.close();

    await testInfo.attach(`axe-${(path === '/' ? 'home' : path.replace(/\//g, '_'))}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });

    const blocking = results.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(' ')}: ${n.failureSummary}`).join('\n')}`);
    expect(blocking, `critical/serious a11y violations on ${path}`).toEqual([]);
  });
}
