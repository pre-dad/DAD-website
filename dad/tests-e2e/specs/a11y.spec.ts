import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Gates on critical and serious axe violations; every violation is attached to the
// report. axe covers only part of WCAG, so manual assistive-technology testing is
// still needed.

const A11Y_PAGES = ['/', '/give/', '/contact/', '/faq/'];

for (const path of A11Y_PAGES) {
  test(`a11y: ${path} has no critical/serious axe violations`, async ({ browser }, testInfo) => {
    // Under reduced motion every reveal lands in its final state at once, so axe
    // scans the settled page instead of a random mid-tween frame (which made
    // color-contrast results flaky).
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(path, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // Walk the page so every scroll-triggered reveal fires and every
      // <section data-theme> applies its theme in turn.
      const step = Math.round(window.innerHeight * 0.5);
      for (let y = 0; y <= document.body.scrollHeight; y += step) { window.scrollTo(0, y); await sleep(110); }
      // Then centre the tallest section: muted text is only meant to sit on its own
      // section's background, and theme.js themes the page from the section in view.
      const secs = Array.from(document.querySelectorAll<HTMLElement>('main [data-theme], main section, main'));
      let big: HTMLElement | null = null, h = 0;
      for (const s of secs) { if (s.offsetHeight > h) { h = s.offsetHeight; big = s; } }
      (big || document.body).scrollIntoView({ block: 'center' });
      await sleep(1200);
    });

    const results = await new AxeBuilder({ page }).analyze();
    await context.close();

    await testInfo.attach(`axe-${path.replace(/\//g, '_') || 'home'}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });

    const blocking = results.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(' ')}: ${n.failureSummary}`).join('\n')}`);
    expect(blocking, `critical/serious a11y violations on ${path}`).toEqual([]);
  });
}
