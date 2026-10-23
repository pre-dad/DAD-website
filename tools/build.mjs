// Rebuilds the generated parts of the site in dad/:
//   css/site.css  - the minified bundle of every other css/*.css (the only stylesheet pages load)
//   ?v=<hash>     - the cache-busting version on every site.css, vendor and js/ URL
// With --check nothing is written; it exits 1 if a generated file is stale (CI runs this).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = join(ROOT, 'dad');
const BUNDLE = 'css/site.css';
// Later files override earlier ones, so the design tokens and base styles must come first.
const CORE_CSS = ['tokens', 'base', 'layout', 'components'].map((n) => `css/${n}.css`);
const VERSION_RE = /\?v=[0-9a-f]{10}\b/g;
// map/ is a self-contained app with its own versioning; api/ and the test dirs are not pages.
const UNVERSIONED = /^(api|map|tests|tests-e2e)\//;

const check = process.argv.includes('--check');

function siteFiles() {
  // Tracked plus new-but-not-ignored files, so local-only folders under dad/ are never touched.
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'], { cwd: SITE, encoding: 'utf8' });
  return [...new Set(out.split('\0').filter(Boolean))].sort();
}

const files = siteFiles();
const read = (f) => readFile(join(SITE, f), 'utf8');

const extraCss = files.filter((f) => /^css\/[^/]+\.css$/.test(f) && f !== BUNDLE && !CORE_CSS.includes(f));
const sources = await Promise.all([...CORE_CSS, ...extraCss].map(read));
const { code: css } = await transform(sources.join('\n'), { loader: 'css', minify: true });

const versioned = files.filter((f) => !UNVERSIONED.test(f) && (f.endsWith('.html') || f.endsWith('.js')));
const hashed = files.filter((f) => /^(js|vendor)\/.+\.js$/.test(f));
const hash = createHash('sha256').update(css);
for (const f of hashed) hash.update(`${f}\0${(await read(f)).replace(VERSION_RE, '?v=')}\0`);
const version = hash.digest('hex').slice(0, 10);

const outputs = new Map([[BUNDLE, css]]);
for (const f of versioned) outputs.set(f, (await read(f)).replace(VERSION_RE, `?v=${version}`));

const stale = [];
for (const [f, content] of outputs) {
  if ((await read(f)) === content) continue;
  stale.push(f);
  if (!check) await writeFile(join(SITE, f), content);
}

if (check && stale.length) {
  console.error(`Generated files are out of date (run \`npm run build\`):\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
console.log(stale.length ? `Updated ${stale.length} file(s); version ${version}` : `Up to date; version ${version}`);
