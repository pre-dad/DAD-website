# Self-hosted CI runner

CI for this repository runs on one self-hosted runner, `dad-website-1`. Every job in
`.github/workflows/ci.yml` (`checks`, `php-tests`, `e2e`) targets it with
`runs-on: [self-hosted, dad, macOS]`.

The host is **macOS on Apple Silicon**. GitHub adds `self-hosted`, `macOS` and `ARM64`
automatically from what the host reports; `dad` is the custom label we add at
registration. (An earlier `linux` label was a misnomer for a macOS host and has been
removed — do not re-add it.)

There is a single runner, so jobs run one at a time and queue behind each other. If the
runner is offline, jobs wait for it instead of failing.

## Runner prerequisites

The runner host must provide:

- **PHP 8.3** with the `pdo_sqlite`, `sqlite3` and `mbstring` extensions, plus
  **Composer**. The jobs use the PHP already on `PATH`; they do not install one.
- **shellcheck** on `PATH`. The `checks` job fails on purpose if it is missing, so broken
  deploy scripts cannot slip through unnoticed.
- **git** and **curl** on `PATH` (`checks` lints with `git ls-files`; the E2E job waits for
  the PHP server's health endpoint with `curl`).
- Network access, because the jobs download Node 20 (via `actions/setup-node`), their npm
  and Composer dependencies, and Playwright's Chromium on every run.
- A writable `$RUNNER_TEMP` and the ability to bind `127.0.0.1:8080` for the PHP dev server
  the E2E job starts.

## Things that hang on this runner

Do not add these to `ci.yml`; each one has stalled jobs here:

- `shivammathur/setup-php`
- `cache: npm` on `actions/setup-node` (the cache-save post-step hangs)
- a Composer cache step
- `npx playwright install --with-deps` (it runs `apt-get`, which does not exist on macOS)

The comments in `ci.yml` record the same list next to the steps that avoid them. The
`checks` job also sets `timeout-minutes: 10` so a stuck step fails instead of holding the
only runner.

## Registration

`CoachCoe` is a GitHub user account, so the runner is registered per repository (no
org-level runner groups). The `macOS`/`ARM64`/`self-hosted` labels are auto-added by the
host, so only the `dad` custom label is set. Register from this repo's
**Settings → Actions → Runners → New self-hosted runner** page:

```sh
./config.sh --url https://github.com/CoachCoe/DAD-website \
  --token <TOKEN_FROM_THE_RUNNERS_PAGE> \
  --labels dad --name dad-website-1
./svc.sh install && ./svc.sh start
```

To check that it is online without opening the page:

```sh
gh api repos/CoachCoe/DAD-website/actions/runners \
  --jq '.runners[] | "\(.name) \(.status) \([.labels[].name] | join(","))"'
```
