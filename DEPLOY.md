# Manual deploy to Lightsail

Routine deploys are automatic: each box pulls its branch on a schedule (see
[`deploy/README.md`](deploy/README.md)). `deploy.sh` is the manual push from a
laptop for one-off syncs and emergencies. It syncs the site (`dad/`) to a
Lightsail box over SSH with `rsync`, shows a dry run first, and never touches the
server without explicit confirmation.

It needs rsync 3.x. macOS ships `openrsync`, which lacks `--chmod`; install the
real one with `brew install rsync`. The script stops with that message otherwise.

## Usage

```
./deploy.sh <ssh-target> [remote-webroot] [--go]
```

Examples:

```
# Dry run, then prompt before the real sync:
./deploy.sh admin@1.2.3.4

# Explicit webroot, skip the prompt with --go:
./deploy.sh admin@1.2.3.4 /var/www/html --go
```

- `<ssh-target>` — the SSH login, e.g. `admin@<lightsail-ip>`.
- `[remote-webroot]` — defaults to `/var/www/html`. On prod that is a symlink to
  the live release directory, so a manual sync edits the live release in place.
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

The sync uses `--delete` so the webroot stays a clean mirror of `dad/`. Both this
script and `deploy/pull-deploy.sh` read their excludes from
[`deploy/rsync-excludes`](deploy/rsync-excludes), and an excluded path is never
uploaded or deleted. That list covers the live data folder (`dad-site-data-*/`,
the **only** copy of the sign-ups), `api/config.php`, `stripe.key`, any SQLite
file, and the repo-only test tooling. The data folder lives beside `/api`, outside
anything a sync replaces, for exactly this reason.

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
