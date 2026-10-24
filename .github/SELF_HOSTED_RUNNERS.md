# Self-hosted CI runner

CI for this repository runs on a self-hosted runner labelled `self-hosted, dad,
linux`. Every job (`php-tests`, `e2e-a11y`) targets that runner.

## Runner prerequisites

The runner host must provide:

- **PHP 8.3** with the `pdo_sqlite`, `sqlite3` and `mbstring` extensions, plus
  **Composer**. `shivammathur/setup-php` configures the active PHP but does not
  install one on a self-hosted host, so PHP must already be on `PATH`.
- **Node.js 20** (the `e2e-a11y` job installs its own Playwright Chromium; no
  `--with-deps`, since that runs `apt-get` and the host is macOS).
- A writable `$RUNNER_TEMP` and the ability to bind `127.0.0.1:8080` for the
  PHP dev server the E2E job starts.

## Registration

`CoachCoe` is a GitHub user account, so the runner is registered per-repository
(no org-level runner groups). Register from this repo's
**Settings → Actions → Runners → New self-hosted runner** page, applying the
labels `dad,linux`:

```sh
./config.sh --url https://github.com/CoachCoe/dad-main-website \
  --token <TOKEN_FROM_THE_RUNNERS_PAGE> \
  --labels dad,linux --name dad-website-1
./svc.sh install && ./svc.sh start
```

Do **not** merge this branch until the runner shows **online** on that page, or
CI will hang waiting for a matching runner.
