# DAD pull-based deploy automation

This directory holds the **pull-based** deploy automation for the DAD website plus
the post-deploy smoke test. It is tooling, **not** part of the served site
(the served site is `dad/`); both `deploy.sh` and `pull-deploy.sh` exclude this
`deploy/` dir from every sync.

## Why pull-based

Each box pulls from GitHub on a schedule. GitHub never connects **in**, so the box
firewall stays **locked** (no inbound SSH/webhook). Cron runs `pull-deploy.sh` every
3 minutes; if the tracked branch has not moved it exits quietly, otherwise it
syncs/builds, fixes perms, runs the smoke test, and publishes (prod) or leaves the
preview live (staging).

This **replaces manual `deploy.sh` for routine deploys.** `deploy.sh` (the SSH
push-from-laptop script) stays for one-off manual syncs and emergencies; day-to-day
deploys happen automatically via cron.

## Branch → box → domain model

```
feature branches ──PR──▶ staging ──▶ staging box ──▶ staging.dynamicaid.org   (preview)
                              │
                         approved
                              ▼
                            main   ──▶ prod box    ──▶ dynamicaid.org          (live)
```

- Work happens on `staging` (or feature branches merged into `staging`).
- The **staging box** tracks `staging` and deploys to a preview at
  `staging.dynamicaid.org`.
- When approved, **merge `staging` → `main`**; the **prod box** tracks `main` and
  deploys to `dynamicaid.org`. `main` is protected/stable = whatever is live.

## Files

| File | Purpose |
|------|---------|
| `pull-deploy.sh` | Core pull-deploy, run ON a box by cron. Modes `staging` / `prod`. |
| `smoke-test.sh`  | Post-deploy smoke test (curl-only HTTP assertions). |
| `rsync-excludes` | Paths every sync skips (and so never deletes): live data, secrets, test tooling. Shared with `../deploy.sh`. |
| `dad-deploy.cron`| The two cron lines (each box installs only its own). |
| `README.md`      | This document. |

## config.php + data live OUTSIDE the deploy tree

The single copy of live sign-ups and the server-only secrets must survive every
deploy — and on prod, every atomic swap. So they live **outside** the synced/swapped
tree:

- **`config.php`** lives at a fixed shared path **`/var/www/shared/config.php`**.
  Each release (and the staging webroot) gets a **symlink** `api/config.php` →
  `/var/www/shared/config.php`. The rsync hard-excludes `api/config.php`, so a sync
  never overwrites or deletes that symlink or its target.
- **The data dir** stays at the absolute path **`/var/dad-data`** and is referenced
  by `SITE_DATA_DIR` as an **absolute** path inside the shared `config.php`
  (`api/lib/bootstrap.php` already supports an absolute `SITE_DATA_DIR`). Nothing in
  the release tree points at it, so a swap never moves or wipes it.

A staging `rsync --delete` and a prod symlink swap therefore can never touch
`config.php`, `/var/dad-data`, or any `*.sqlite`.

## One-time install (per box)

Do this once on each box (staging and prod). Run as the deploy user (`admin`).

### 1. Put the scripts on the box

```sh
# copy the whole deploy/ dir to /home/admin/deploy/ (e.g. via the checkout below);
# pull-deploy.sh reads rsync-excludes from its own directory
chmod +x /home/admin/deploy/pull-deploy.sh /home/admin/deploy/smoke-test.sh
```

### 2. Clone the repo (the box's working copy it pulls into)

```sh
git clone <repo-url> /home/admin/dad-main-website
cd /home/admin/dad-main-website
git checkout staging   # staging box;   use `main` on the prod box
```

### 3. Create the log dir

```sh
sudo mkdir -p /var/log/dad-deploy
sudo chown admin:admin /var/log/dad-deploy
```

Logs that land here: `deploy.log` (every run), `cron.log` (raw cron stdout/stderr),
`ALERT` (appended only on a smoke failure), and on prod `candidate-serve.log` (the
short-lived candidate php server output).

### 4. Create the shared config + data dir (server-only, once)

```sh
sudo mkdir -p /var/www/shared /var/dad-data
# create /var/www/shared/config.php from dad/api/config.sample.php, set
#   SITE_DATA_DIR = '/var/dad-data'   (absolute)
# and the real SMTP / origins / keys. This file is server-only and NEVER in git.
sudo chown admin:www-data /var/www/shared/config.php
sudo chmod 640 /var/www/shared/config.php
sudo chown -R www-data:www-data /var/dad-data
```

### 5a. Staging webroot (plain dir)

```sh
sudo mkdir -p /var/www/html
# first deploy will rsync into it and symlink api/config.php -> shared config.
```

### 5b. Prod webroot (symlink to a release dir — enables atomic swap + rollback)

```sh
sudo mkdir -p /var/www/releases
# seed the first release however you like (e.g. let pull-deploy.sh build it, or
# do an initial manual rsync of dad/ into /var/www/releases/<timestamp>), then:
sudo ln -sfn /var/www/releases/<first-release> /var/www/html
# ensure <first-release>/api/config.php -> /var/www/shared/config.php
```

On prod, `/var/www/html` must be a **symlink** to a release dir. `pull-deploy.sh`
builds each new release under `/var/www/releases/`, smoke-tests it, and only then
repoints the symlink (atomic). The previous release dir is kept for rollback, and
only the newest five `<timestamp>-<commit>` release dirs are kept
(`DAD_RELEASES_KEPT`). A candidate that fails at any step is deleted.

### 6. Install the cron line (only this box's line)

```sh
crontab -e
# paste the STAGING line on the staging box, or the PROD line on the prod box,
# from dad-deploy.cron.
```

## Reading logs

```sh
tail -f /var/log/dad-deploy/deploy.log     # one line per run: timestamp, before->after, smoke result
tail -f /var/log/dad-deploy/cron.log       # raw cron output
cat     /var/log/dad-deploy/ALERT          # only present/appended when a smoke test failed
journalctl -t dad-deploy                   # the same lines via logger (syslog/journald)
cat     /var/log/dad-deploy/last-good      # the commit that was live BEFORE the most recent deploy
cat     /var/log/dad-deploy/last-deployed  # the commit most recently deployed; a run whose deploy failed before
                                           # this was written retries on the next cron tick
```

Any failed deploy (smoke test, rsync, build) writes one line to `ALERT`, logs at
priority `err` via `logger`, and makes the cron run exit non-zero (so it stands out
in `cron.log`). The box does not retry a failed commit: push a fix, or reset the
checkout to the previous commit so the next run redeploys it.

## Manual rollback (prod) — one command

Prod keeps the previous release dir. To roll back, repoint the symlink to it:

```sh
ln -sfn /var/www/releases/<previous-release> /var/www/html.new && mv -T /var/www/html.new /var/www/html
```

The rename makes the swap atomic. To find the previous release, list `/var/www/releases/` (dirs
are named `<timestamp>-<commit>`); `cat /var/log/dad-deploy/last-good` shows the
commit that was live before the most recent deploy.

Staging has no release dirs (it syncs straight into the webroot); to recover staging,
let the next cron run redeploy the fixed branch, or run `deploy.sh` manually.

## What is verifiable only on the box

The control flow, exclude list, smoke call, release pruning and swap-vs-alert
branching can be exercised locally against temp dirs with the `DAD_*` overrides in
`pull-deploy.sh`. These pieces only exist on a box:

- real Apache file ownership/perms (`chown admin:www-data`, mod_php serving);
- `logger` → syslog/journald output;
- the atomic symlink swap under a live Apache-served webroot;
- cron scheduling itself;
- the candidate smoke-serve (`php -S` on a temp localhost port against the candidate
  release before the swap), using the box PHP.
