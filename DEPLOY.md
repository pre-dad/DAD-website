# Deploying the DAD marketing site to Lightsail

`deploy.sh` syncs the marketing site (`dad/`) to an AWS Lightsail instance over
SSH using `rsync`. It is deliberately cautious: it shows you a dry run first and
never touches the server without explicit confirmation.

## Usage

```
./deploy.sh <ssh-target> [remote-webroot] [--go]
```

Examples:

```
# Dry run, then prompt before the real sync:
./deploy.sh bitnami@1.2.3.4

# Explicit webroot, skip the prompt with --go:
./deploy.sh bitnami@1.2.3.4 /opt/bitnami/apache/htdocs --go
```

- `<ssh-target>` — the SSH login, e.g. `bitnami@<lightsail-ip>`.
- `[remote-webroot]` — defaults to the Bitnami LAMP webroot
  `/opt/bitnami/apache/htdocs`. Override it as the second argument if your
  instance serves from a different path.
- `--go` — skip the interactive prompt (useful for a scripted run). Without it
  you get a `y/N` prompt after the dry run.

The source is always the **contents** of `dad/` (resolved relative to the script,
so you can run it from anywhere). Files are written with `--chmod=D755,F644`
because the server cannot read `600` files.

## How a run goes

1. Prints the resolved source, SSH target, and remote webroot.
2. **Dry run first** (`rsync --dry-run --itemize-changes`): shows exactly what
   would be added, changed, or deleted. Nothing is uploaded.
3. **Confirmation**: either you passed `--go`, or you answer `y` to the prompt.
   Any other answer aborts with no changes.
4. Runs the same `rsync` for real.
5. Prints the post-deploy checklist (below).

The script never runs anything against the server before step 4, and step 4 only
happens after you confirm.

## Safety guarantees

The sync uses `--delete` so the webroot stays a clean mirror of `dad/`. To make
that safe, these paths are **hard-excluded** so `--delete` can never wipe or
overwrite them, and they are never uploaded over the server's copies:

| Excluded pattern      | Why |
|-----------------------|-----|
| `dad-site-data-*/`    | Live sign-ups SQLite DB — the **only** copy. Lives beside `/api` for exactly this reason. |
| `ds-data-*/`          | DeckSend data folder, if present at the webroot. |
| `ds-stage-*/`         | DeckSend staging data folder. |
| `api/config.php`      | Server-only config, created at first deploy. Not in git. |
| `**/stripe.key`       | Server-only secret. |
| `*.sqlite`            | Any SQLite database file. |
| `*.sqlite3`           | Any SQLite database file. |
| `*.db`                | Any database file. |

This enforces the rule in `dad/api/README.txt`: the data folder lives **beside**
`/api` precisely because "deploy.sh mirrors with --delete, so data inside /api
would be wiped on every redeploy." These excludes are what keep that promise.

Repo-only files are also excluded from upload: `.git/`, `.gitignore`,
`*.local.md`, `SITE-ASSESSMENT.md`, `MIGRATION-NOTES*`, `deploy.sh`, `DEPLOY.md`,
and `.DS_Store`.

## Post-deploy checklist

From `dad/api/README.txt`, after a real deploy:

1. Open `https://<host>/api/health.php` — must show `{"ok":true}`.
2. Open `https://<host>/api/admin/?setup=THE-KEY` once; Chris sets his password
   (the setup link then stops working).
3. In the dashboard: "Send a test alert" and "Preview the donor email"; on the
   Emails page open "Partner confirmation" and "Send me a test". Check all arrive
   (and not in spam).
4. Submit each form once with an `@example.com` address (saved, never emailed),
   then delete them in the dashboard.
5. Submit the Founding Donor form with a real Gmail address: confirm the email
   lands in the inbox, the Unsubscribe link works, and Gmail shows its own
   one-click Unsubscribe button.
