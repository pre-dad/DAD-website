# dynamicaid.org

The website of DAD (Dynamic Aid Delivery): a static marketing site plus a small PHP
forms API, served by Apache on AWS Lightsail. Email goes out through Amazon SES.

- **Site:** hand-written HTML pages, CSS and native ES modules. Nothing is compiled
  except the stylesheet bundle and cache-busting versions (see [Editing](#editing)).
- **Forms API:** PHP 8 + SQLite under `dad/api/`. Every form on the site posts to
  `api/submit.php`; a password-protected dashboard at `/api/admin/` lists submissions,
  exports mailing lists and edits the automatic emails.
  [`dad/api/README.txt`](dad/api/README.txt) is its operating manual and API contract.

## Layout

```
dad/                  the webroot: everything here except tests is deployed
  index.html, */      one folder per page (about/, give/, faq/, ...)
  css/                stylesheet sources; site.css is the generated bundle
  js/                 ES modules: app.js boots core/*, pages/* are per-page
  vendor/             third-party JS shipped as-is (GSAP, Lenis)
  assets/             fonts, images, team photos
  api/                forms API (lib/ helpers, admin/ dashboard)
  map/, impactledger, on-prem-infra/   standalone pages, not linked from the nav
  tests/              PHPUnit unit tests
  tests-e2e/          Playwright end-to-end and axe accessibility tests
deploy/               pull-based deploy run by cron on each box, and the smoke test
deploy.sh             manual deploy from a laptop (see DEPLOY.md)
tools/build.mjs       regenerates css/site.css and the ?v= asset versions
```

## Prerequisites

PHP 8.4+ with `pdo_sqlite` and `mbstring`, Composer, and Node 20+.

## Run it locally

```sh
npm ci                                       # build tooling
cd dad
composer install                             # PHPUnit
bash tests-e2e/ci-setup-config.sh --ci       # throwaway api/config.php + temp database
php -S 127.0.0.1:8080 -t "$PWD" tests-e2e/router.php
```

Open http://127.0.0.1:8080/. Forms work against the temp database; `@example.com`
addresses are saved but never emailed. The dashboard is at `/api/admin/`: open
`/api/admin/?setup=ci-setup-key` once to set a password.

`tests-e2e/router.php` stands in for the Apache rules in `dad/.htaccess`
(directory index, the `/get-involved/` redirect, the 404 page). If you already
had an `api/config.php`, the setup script backed it up; put it back with
`bash tests-e2e/ci-setup-config.sh --restore`.

## Editing

- **Pages:** edit the HTML in `dad/<page>/index.html` directly.
- **Styles:** edit `dad/css/*.css`, never `site.css`. Pages load only the bundle.
- **Scripts:** edit `dad/js/**`.

After changing any CSS or JS, run `npm run build` from the repo root. It rebuilds
`css/site.css` and rewrites every `?v=` version so browsers fetch the new files.
CI fails if you forget (`npm run check`).

## Test

From the repo root, with the local server above running:

```sh
npm run check                                        # generated files are current
(cd dad && ./.phpunit-vendor/bin/phpunit)            # PHP unit tests
cd dad/tests-e2e && npm ci && npx playwright install chromium
npm run typecheck && npx playwright test             # e2e + accessibility
cd ../.. && bash deploy/smoke-test.sh --base-url http://127.0.0.1:8080 --form
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of these, plus
shellcheck and `php -l`, on every pull request and on pushes to `staging` and `main`.

## Deploy

Work lands on `staging`, which the staging box serves at staging.dynamicaid.org.
Merging `staging` into `main` publishes to dynamicaid.org. Each box pulls its branch
every three minutes, smoke-tests the result, and on prod swaps it in atomically only
if the smoke test passes. See [`deploy/README.md`](deploy/README.md) for the box
setup, logs and rollback, and [`DEPLOY.md`](DEPLOY.md) for a manual push.

Server-only settings live in `config.php`, created from
[`dad/api/config.sample.php`](dad/api/config.sample.php) and never committed. The
live database sits outside the deployed tree and is the only copy, so back it up.
