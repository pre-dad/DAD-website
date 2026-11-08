#!/usr/bin/env bash
#
# pull-deploy.sh: run by cron on a box. When origin/<branch> has moved it deploys
# dad/ and runs the smoke test. deploy/README.md covers install, logs and rollback.
#
#   pull-deploy.sh --branch <staging|main> --webroot /var/www/html \
#                  --repo ~admin/dad-main-website --mode <staging|prod>
#
# staging: rsync into the webroot. A failed smoke test alerts but leaves the
#          preview in place.
# prod:    the webroot is a symlink to a release dir. Build a new release, smoke
#          test it on a local php -S, and only then repoint the symlink (atomic).
#          A failed candidate is deleted and the live site is never touched.
#
# config.php and the database live outside every synced or swapped tree (the
# release's api/config.php is a symlink to the shared config), so no deploy can
# overwrite or delete them.
#
# Overrides (the defaults are the box layout; overrides let the script run
# against temp dirs): DAD_DEPLOY_LOG_DIR, DAD_SHARED_CONFIG, DAD_RELEASE_ROOT,
# DAD_RELEASES_KEPT, DAD_SMOKE_TEST, DAD_SMOKE_PORT, DAD_PHP_BIN, DAD_SMOKE_ROUTER.

set -euo pipefail

DAD_DEPLOY_LOG_DIR="${DAD_DEPLOY_LOG_DIR:-/var/log/dad-deploy}"
DAD_SHARED_CONFIG="${DAD_SHARED_CONFIG:-/var/www/shared/config.php}"
DAD_RELEASE_ROOT="${DAD_RELEASE_ROOT:-/var/www/releases}"
DAD_RELEASES_KEPT="${DAD_RELEASES_KEPT:-5}"
DAD_SMOKE_PORT="${DAD_SMOKE_PORT:-8181}"
DAD_PHP_BIN="${DAD_PHP_BIN:-php}"

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAD_SMOKE_TEST="${DAD_SMOKE_TEST:-$SELF_DIR/smoke-test.sh}"

# ---- parse args ---------------------------------------------------------------
BRANCH=""
WEBROOT=""
REPO=""
MODE=""

usage() {
  echo "Usage: $0 --branch <staging|main> --webroot <path> --repo <path> --mode <staging|prod>" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)  [[ $# -ge 2 ]] || usage; BRANCH="$2";  shift 2 ;;
    --webroot) [[ $# -ge 2 ]] || usage; WEBROOT="$2"; shift 2 ;;
    --repo)    [[ $# -ge 2 ]] || usage; REPO="$2";    shift 2 ;;
    --mode)    [[ $# -ge 2 ]] || usage; MODE="$2";    shift 2 ;;
    -h|--help) usage ;;
    *) echo "pull-deploy.sh: unknown arg '$1'" >&2; usage ;;
  esac
done

[[ -n "$BRANCH" && -n "$WEBROOT" && -n "$REPO" && -n "$MODE" ]] || usage
case "$MODE" in staging|prod) ;; *) echo "pull-deploy.sh: --mode must be staging|prod" >&2; usage ;; esac
case "$BRANCH" in staging|main) ;; *) echo "pull-deploy.sh: --branch must be staging|main" >&2; usage ;; esac

# Expand a leading ~ in --repo (e.g. ~admin/dad-main-website) the way a shell would.
_tilde='~'
case "$REPO" in
  "$_tilde/"*)
    REPO="$HOME/${REPO#"$_tilde"/}" ;;
  "$_tilde"*/*)
    _user="${REPO%%/*}"; _user="${_user#"$_tilde"}"; _rest="${REPO#*/}"
    _home="$(getent passwd "$_user" | cut -d: -f6)"; REPO="$_home/$_rest" ;;
esac

DAD_SMOKE_ROUTER="${DAD_SMOKE_ROUTER:-$REPO/dad/tests-e2e/router.php}"

# ---- logging / alerting -------------------------------------------------------
LOG_FILE="$DAD_DEPLOY_LOG_DIR/deploy.log"
LAST_GOOD="$DAD_DEPLOY_LOG_DIR/last-good"
LAST_DEPLOYED="$DAD_DEPLOY_LOG_DIR/last-deployed"
ALERT_MARKER="$DAD_DEPLOY_LOG_DIR/ALERT"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }

# log MESSAGE -> stdout + deploy.log + syslog/journald via logger.
log() {
  local line
  line="$(ts) [$MODE/$BRANCH] $*"
  printf '%s\n' "$line"
  printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null || true
  logger -t dad-deploy -- "$line" 2>/dev/null || true
}

# alert MESSAGE -> stderr + logger (priority err) + the ALERT file the operator watches.
alert() {
  ALERTED=1
  local line
  line="$(ts) [$MODE/$BRANCH] ALERT: $*"
  printf '%s\n' "$line" >&2
  printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null || true
  printf '%s\n' "$line" >> "$ALERT_MARKER" 2>/dev/null || true
  logger -p user.err -t dad-deploy -- "$line" 2>/dev/null || true
}

mkdir -p "$DAD_DEPLOY_LOG_DIR" 2>/dev/null || true

# -type f skips the api/config.php symlink, so the shared config keeps its own 640 mode.
# chown needs root on the box and is a harmless no-op elsewhere.
fix_perms() {
  local root="$1"
  find "$root" -type d -not -path '*/.git/*' -exec chmod 755 {} + 2>/dev/null || true
  find "$root" -type f -not -path '*/.git/*' -exec chmod 644 {} + 2>/dev/null || true
  chown -R admin:www-data "$root" 2>/dev/null || true
}

link_shared_config() {
  local root="$1"
  if [[ -d "$root/api" ]]; then
    ln -sfn "$DAD_SHARED_CONFIG" "$root/api/config.php"
  fi
}

# Release dirs are named <timestamp>-<commit>, so a reverse sort is newest first.
# The live and previous releases, and any hand-made dir, are never pruned.
prune_releases() {
  local live="$1" prev="${2%/}" dir n=0
  while IFS= read -r dir; do
    n=$((n + 1))
    [[ $n -le $DAD_RELEASES_KEPT || "$dir" == "$live" || "$dir" == "$prev" ]] && continue
    rm -rf -- "$dir"
  done < <(find "$DAD_RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*-*' | sort -r)
}

# ---- main ---------------------------------------------------------------------
# Cron fires every 3 minutes; a slow deploy must not overlap the next run.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$DAD_DEPLOY_LOG_DIR/deploy.lock"
  flock -n 9 || { log "another deploy is running; skipping"; exit 0; }
fi

cd "$REPO"

git fetch origin "$BRANCH" --quiet

BEFORE="$(git rev-parse HEAD)"
AFTER="$(git rev-parse "origin/$BRANCH")"

# The checkout moves before the deploy runs, so HEAD alone cannot tell a deployed
# commit from one whose deploy failed part-way; last-deployed records only the former.
DEPLOYED="$(cat "$LAST_DEPLOYED" 2>/dev/null || true)"

if [[ "$DEPLOYED" == "$AFTER" ]]; then
  log "no change ($BRANCH @ ${AFTER:0:12}); nothing to deploy"
  exit 0
fi

ALERTED=0
SMOKE_PID=""
CANDIDATE=""
PUBLISHED=0
# Any failure from here on alerts once, and a prod candidate that was never published is discarded.
on_exit() {
  local rc=$?
  [[ -n "$SMOKE_PID" ]] && kill "$SMOKE_PID" 2>/dev/null
  [[ -n "$CANDIDATE" && "$PUBLISHED" -eq 0 ]] && rm -rf -- "$CANDIDATE"
  [[ $rc -ne 0 && "$ALERTED" -eq 0 ]] && alert "deploy FAILED (exit $rc) at ${AFTER:0:12}; live site untouched on prod. See cron.log"
  return 0
}
trap on_exit EXIT

# Record the pre-deploy commit BEFORE we touch anything (rollback context).
printf '%s\n' "$BEFORE" > "$LAST_GOOD" 2>/dev/null || true
log "deploying $BRANCH: ${BEFORE:0:12} -> ${AFTER:0:12} (prior good commit recorded in $LAST_GOOD)"

# Move the working tree to the new commit.
git checkout "$BRANCH" --quiet
git reset --hard "origin/$BRANCH" --quiet

SRC="$REPO/dad/"

# shellcheck disable=SC2054  # the comma is inside the single --chmod=D755,F644 flag value, not an array separator
RSYNC_FLAGS=(-a --delete --chmod=D755,F644 --exclude-from="$SELF_DIR/rsync-excludes")

if [[ "$MODE" == "staging" ]]; then
  # ---- STAGING: rsync into the live webroot, smoke-test, log-on-fail ----------
  mkdir -p "$WEBROOT"
  rsync "${RSYNC_FLAGS[@]}" "$SRC" "$WEBROOT/"
  link_shared_config "$WEBROOT"
  fix_perms "$WEBROOT"
  printf '%s\n' "$AFTER" > "$LAST_DEPLOYED"

  if "$DAD_SMOKE_TEST" --base-url "http://127.0.0.1/" --form; then
    log "smoke PASS (staging) now live at ${AFTER:0:12}"
    exit 0
  else
    alert "smoke FAIL (staging) at ${AFTER:0:12} — deploy left in place (preview only, no auto-rollback). Prior good: ${BEFORE:0:12}"
    exit 1
  fi
fi

# ---- PROD: build candidate, smoke-test, atomic swap on PASS -------------------
mkdir -p "$DAD_RELEASE_ROOT"
CANDIDATE="$DAD_RELEASE_ROOT/$(date '+%Y%m%d%H%M%S')-${AFTER:0:12}"
mkdir -p "$CANDIDATE"
rsync "${RSYNC_FLAGS[@]}" "$SRC" "$CANDIDATE/"
link_shared_config "$CANDIDATE"
fix_perms "$CANDIDATE"

# Smoke-test the CANDIDATE before publishing. Apache serves the live symlink, so
# the candidate is served by a short-lived localhost php -S (box-only piece).
PHP_CLI_SERVER_WORKERS=4 "$DAD_PHP_BIN" -S "127.0.0.1:$DAD_SMOKE_PORT" -t "$CANDIDATE" "$DAD_SMOKE_ROUTER" \
  >"$DAD_DEPLOY_LOG_DIR/candidate-serve.log" 2>&1 &
SMOKE_PID="$!"

CANDIDATE_URL="http://127.0.0.1:$DAD_SMOKE_PORT"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "$CANDIDATE_URL/api/health.php" 2>/dev/null | grep -q '"ok":true'; then
    break
  fi
  sleep 0.5
done

if ! "$DAD_SMOKE_TEST" --base-url "$CANDIDATE_URL" --form; then
  alert "smoke FAIL (prod) at ${AFTER:0:12} — candidate DISCARDED, live site untouched. Prior good commit: ${BEFORE:0:12}"
  exit 1
fi

PREV_RELEASE="$(readlink "$WEBROOT" 2>/dev/null || true)"
# Atomic publish: repoint the webroot symlink to the candidate (atomic on Linux).
# ln -sfn alone unlinks the old symlink before creating the new one; rename over it instead.
ln -sfn "$CANDIDATE" "$WEBROOT.new"
mv -T "$WEBROOT.new" "$WEBROOT"
PUBLISHED=1
printf '%s\n' "$AFTER" > "$LAST_DEPLOYED"
prune_releases "$CANDIDATE" "$PREV_RELEASE"
log "smoke PASS (prod) — published ${AFTER:0:12} at $CANDIDATE (previous release kept for rollback: ${PREV_RELEASE:-none})"
