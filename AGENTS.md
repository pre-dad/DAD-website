# Agent guide — DAD-website

Static dynamicaid.org site plus a PHP 8 + SQLite forms API. Start with these; this file
only adds what they do not say.

- **[README.md](README.md)** — layout, local setup, editing rules, tests, deploy model.
  There is no CONTRIBUTING.md; the README is the contract.
- **[deploy/README.md](deploy/README.md)** — box setup, logs, rollback.
  **[DEPLOY.md](DEPLOY.md)** — manual `deploy.sh` push.
- **[dad/api/README.txt](dad/api/README.txt)** — forms API manual and contract.
- Cross-repo system docs live in the separate **DAD-Docs** repo.

## The gate (CI runs these in `.github/workflows/ci.yml`)

```sh
npm run check                                  # repo root: generated files are current
(cd dad/tests-e2e && npm ci && npm run typecheck)
shellcheck deploy.sh deploy/*.sh dad/tests-e2e/ci-setup-config.sh
(cd dad && git ls-files -z '*.php' | xargs -0 -n1 php -l > /dev/null)
cd dad && composer install && ./.phpunit-vendor/bin/phpunit
cd dad/tests-e2e && npm ci && npx playwright install chromium && npx playwright test
bash deploy/smoke-test.sh --base-url http://127.0.0.1:8080 --form
```

The e2e job needs the local server from the README ("Run it locally"). The first four
commands are the `checks` job; a missing `shellcheck` on the runner fails it on purpose.

## Branch and push discipline

- Feature branch → PR into `staging` → promote `staging` → `main`. Never push to `main`
  directly.
- Run `git commit` and `git push` as two separate commands.
- **A merge to `staging` is a deploy.** The staging box pulls every 3 minutes via cron.
  Prod changes only when `staging` is promoted to `main`.

## Code comments

- Comments explain **why** (a constraint, a trade-off, a non-obvious behavior), not what the
  code already says.
- No commented-out code (git keeps history). A `TODO` names a tracked issue.

## Gotchas not written in the docs

- **Never read, print, commit or paste secrets or live data.** `dad/api/config.php`,
  `stripe.key`, `*.sqlite` and `dad/dad-site-data-*/` (also `ds-data-*`, `ds-stage-*`) are
  git-ignored and hold real credentials and donor data. Name config by key only; work
  from `dad/api/config.sample.php`.
- **`deploy/rsync-excludes` is high risk.** Both deploy scripts rsync with `--delete`, so
  anything excluded is also never deleted on the server. Do not edit it casually.
- **`dad/vendor/` is shipped frontend JS** (GSAP, Lenis), not PHP dependencies. PHP dev
  dependencies live in `dad/.phpunit-vendor`.
- **Only `css/site.css` is served; never hand-edit it.** Edit `dad/css/*.css` or `dad/js/**`,
  then run `npm run build` (`tools/build.mjs`) to regenerate it and the `?v=` versions.
  CI fails on stale output via `npm run check` (the `checks` job), so commit the
  regenerated files.
- **CI is on a self-hosted runner** (`self-hosted, dad, linux`). Do not add
  `setup-php`, `cache: npm`, a composer cache or `playwright install --with-deps`; the
  `ci.yml` comments record that they hang or call `apt-get`. The runner is a macOS host
  that carries a custom `linux` label; `.github/SELF_HOSTED_RUNNERS.md` has the details.
- **The axe gate has no waivers.** `dad/tests-e2e/specs/a11y.spec.ts` fails on any
  critical or serious violation on `/`, `/give/`, `/contact/`, `/faq/`; no rules are
  disabled. Fix the markup rather than excluding it.
- **Never track working documents** (plans, status, findings, session notes). They go in
  the git-ignored `*.local.md` and `.agents/`.
