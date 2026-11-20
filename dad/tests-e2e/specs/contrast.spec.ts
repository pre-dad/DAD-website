import { test, expect } from '@playwright/test';
import { CANONICAL_PAGES } from './pages';

// axe cannot evaluate text over a gradient (it reports "incomplete"), so check the
// primary button's text against every colour stop of its gradient, resting and hover fill.

const MIN_RATIO = 4.5;

for (const path of CANONICAL_PAGES) {
  test(`contrast: primary buttons on ${path} keep ${MIN_RATIO}:1 on every gradient stop`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    const ratios = await page.evaluate(() => {
      const lum = ([r, g, b]: number[]) => {
        const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const rgb = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      const out: { sel: string; layer: string; stop: string; ratio: number }[] = [];
      document.querySelectorAll<HTMLElement>('.btn--primary').forEach((el, i) => {
        const text = rgb(getComputedStyle(el).color);
        for (const layer of [null, '::before']) {
          const bg = getComputedStyle(el, layer).backgroundImage;
          for (const m of bg.match(/rgb\([^)]+\)/g) ?? []) {
            const a = lum(text), b = lum(rgb(m));
            out.push({ sel: `.btn--primary#${i}`, layer: layer ?? 'self', stop: m, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) });
          }
        }
      });
      return out;
    });
    for (const r of ratios) expect(r.ratio, `${r.sel} ${r.layer} ${r.stop}`).toBeGreaterThanOrEqual(MIN_RATIO);
  });
}
