import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility scan with axe-core on the four highest-traffic / interactive
// pages. We GATE on critical + serious violations only (those are the ones that
// block real users), and report ALL violations (including minor/moderate) to the
// test output so the team has visibility. We never loosen the threshold to force
// green — a real critical/serious finding should fail here and be fixed in markup.
//
// Note: axe catches a subset of WCAG issues. Full conformance still requires
// manual testing with assistive technologies.

const A11Y_PAGES = ['/', '/give/', '/contact/', '/faq/'];

for (const path of A11Y_PAGES) {
  test(`a11y: ${path} has no critical/serious axe violations`, async ({ page }, testInfo) => {
    await page.goto(path, { waitUntil: 'load' });

    const results = await new AxeBuilder({ page }).analyze();

    // Report everything for visibility.
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
    }));
    const report = JSON.stringify(summary, null, 2);
    console.log(`axe violations for ${path} (all impacts):\n${report}`);
    await testInfo.attach(`axe-${path.replace(/\//g, '_') || 'home'}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    const blockingMsg = blocking
      .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join('\n');

    expect(blocking, `critical/serious a11y violations on ${path}:\n${blockingMsg}`).toEqual([]);
  });
}
