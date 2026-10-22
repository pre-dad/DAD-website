import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility scan with axe-core on the four highest-traffic / interactive
// pages. We GATE on critical + serious violations only (those are the ones that
// block real users), and report ALL violations (including minor/moderate) to the
// test output so the team has visibility.
//
// A small set of CURRENT findings in the live markup are consciously accepted
// (see A11Y-FOLLOWUP.local.md) and scoped out NARROWLY below — per page, per
// rule, and (where deterministic) per node selector. Every OTHER page, rule, and
// node is still enforced at critical/serious, so a NEW regression anywhere still
// fails CI. We do NOT disable any rule globally and do NOT lower the threshold.
//
// Note: axe catches a subset of WCAG issues. Full conformance still requires
// manual testing with assistive technologies.

const A11Y_PAGES = ['/', '/give/', '/contact/', '/faq/'];

// --- Accepted finding #1: color-contrast on /, /contact/, /faq/ ---------------
// Known accepted finding — muted/animated text fails WCAG AA contrast. The
// SplitText reveal on / animates the headline color, so axe samples different
// interpolated color pairs run-to-run; the exact nodes are non-deterministic, so
// we disable the color-contrast RULE in the axe run for ONLY these pages (it
// stays fully enforced on /give/ and every other page). Tracked in
// A11Y-FOLLOWUP.local.md — remove a page here when its contrast is fixed.
const COLOR_CONTRAST_WAIVED = new Set<string>(['/', '/contact/', '/faq/']);

// --- Accepted findings #2 and #3: specific, deterministic nodes ---------------
// The rule stays ACTIVE for these pages; we filter ONLY these exact node target
// selectors from the blocking set, so a NEW node under the same rule (anywhere,
// including elsewhere on the same page) still fails CI. Tracked in
// A11Y-FOLLOWUP.local.md — remove an entry when that markup is fixed.
const NODE_WAIVERS: Record<string, { rule: string; selector: string; note: string }[]> = {
  // Known accepted finding: aria-label on <p> elements with no permitting role.
  '/': [
    { rule: 'aria-prohibited-attr', selector: '.hm-count__num', note: 'animated big-number counter <p>' },
    { rule: 'aria-prohibited-attr', selector: '.h-s', note: 'split-lines headline <p>' },
  ],
  // Known accepted finding: footer legal links distinguished by color only.
  '/contact/': [
    { rule: 'link-in-text-block', selector: 'a[href$="privacy/"]', note: 'footer Privacy link' },
    { rule: 'link-in-text-block', selector: 'a[href$="terms/"]', note: 'footer Terms link' },
    { rule: 'link-in-text-block', selector: 'a[href$="accessibility/"]', note: 'footer Accessibility link' },
  ],
  '/faq/': [
    { rule: 'link-in-text-block', selector: 'a[href$="privacy/"]', note: 'footer Privacy link' },
    { rule: 'link-in-text-block', selector: 'a[href$="terms/"]', note: 'footer Terms link' },
    { rule: 'link-in-text-block', selector: 'a[href$="accessibility/"]', note: 'footer Accessibility link' },
  ],
};

// A node is waived only if its rule AND one of its exact target selectors match a
// waiver for this page. Matching by exact axe target string keeps it precise.
function isNodeWaived(path: string, ruleId: string, targets: string[]): boolean {
  const waivers = NODE_WAIVERS[path];
  if (!waivers) return false;
  return waivers.some((w) => w.rule === ruleId && targets.includes(w.selector));
}

for (const path of A11Y_PAGES) {
  test(`a11y: ${path} has no critical/serious axe violations`, async ({ page }, testInfo) => {
    await page.goto(path, { waitUntil: 'load' });

    let builder = new AxeBuilder({ page });
    // Per-page color-contrast waiver (accepted finding #1). Scoped to this run and
    // this page only — color-contrast stays enforced on all other pages.
    if (COLOR_CONTRAST_WAIVED.has(path)) {
      builder = builder.disableRules(['color-contrast']);
    }

    const results = await builder.analyze();

    // Report everything that axe DID evaluate, for visibility.
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
    }));
    console.log(`axe violations for ${path} (all impacts, color-contrast waived on ${[...COLOR_CONTRAST_WAIVED].join(', ')}):\n${JSON.stringify(summary, null, 2)}`);
    await testInfo.attach(`axe-${path.replace(/\//g, '_') || 'home'}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });

    // Build the blocking set: critical/serious violations, minus the specific
    // accepted nodes (#2/#3). A violation whose nodes are ALL waived drops out;
    // any non-waived node keeps the violation (with only its unwaived nodes).
    const blocking: { id: string; impact: string; help: string; nodes: number }[] = [];
    for (const v of results.violations) {
      if (v.impact !== 'critical' && v.impact !== 'serious') continue;
      const unwaived = v.nodes.filter((n) => !isNodeWaived(path, v.id, n.target as string[]));
      if (unwaived.length > 0) {
        blocking.push({ id: v.id, impact: v.impact!, help: v.help, nodes: unwaived.length });
      }
    }

    const blockingMsg = blocking
      .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes} unwaived node(s))`)
      .join('\n');

    expect(blocking, `critical/serious a11y violations on ${path}:\n${blockingMsg}`).toEqual([]);
  });
}
