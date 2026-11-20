import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Every page listed in sitemap.xml, so a page added there is covered without editing this file.
const sitemap = readFileSync(join(__dirname, '../../sitemap.xml'), 'utf8');

export const CANONICAL_PAGES: string[] = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);

// Real pages that are not in the sitemap but follow the same structure (h1, main#swap, primary nav).
// partners/ has no literal <h1> in its source and is left out; the others are scanned by a11y.spec.ts.
export const EXTRA_PAGES: string[] = ['/give/welcome/'];
