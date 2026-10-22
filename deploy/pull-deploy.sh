#!/usr/bin/env bash
#
# pull-deploy.sh — pull-based deploy for the DAD website, run ON a box by cron.
#
# The box pulls from GitHub on a schedule (no inbound SSH from GitHub; the box
# firewall stays locked). Every few minutes cron runs this; if origin/<branch>
# moved, it syncs/builds, fixes perms, runs the Tier 2 smoke test, and either
# publishes (prod) or leaves it live (staging). See deploy/README.md for the
# full install + rollback story.
#
# Usage:
#   pull-deploy.sh --branch <staging|main> --webroot /var/www/html \
#                  --repo ~admin/dad-main-website --mode <staging|prod>
#
# MODES
#   staging  (log-on-fail / preview only)
#     rsync dad/ -> webroot (--delete, same HARD excludes as deploy.sh), fix
#     perms, smoke-test the local site. If smoke FAILS: LOG + ALERT but leave the
#     deploy in place (NO auto-rollback — it's only a preview) and exit non-zero.
#   prod     (atomic release-dir swap)
#     webroot is a SYMLINK to a release dir. Build a NEW candidate release dir,
#     fix perms, smoke-test the candidate on a temp localhost port, and ONLY if
#     smoke PASSES atomically repoint the symlink (ln -sfn is atomic on Linux).
#     Keep the PREVIOUS release dir for a one-command rollback. If smoke FAILS:
#     DISCARD the candidate, leave the live symlink untouched, LOG + ALERT with
#     the prior good commit noted, exit non-zero (no live rollback needed —
#     nothing was swapped).
#
# BOTH MODES
#   - git fetch origin <branch>; if local HEAD == origin/<branch>, log "no change"
#     and exit 0 quietly.
#   - BEFORE changing anything, write the current (pre-deploy) commit hash to the
#     state file $DAD_DEPLOY_LOG_DIR/last-good (for one-command rollback context).
#   - checkout <branch> + reset --hard origin/<branch>.
#   - Log every run (timestamp, before->after commit, smoke result) to
#     $DAD_DEPLOY_LOG_DIR/deploy.log via BOTH `logger` (journald/syslog) and file.
#   - NEVER touch the data dir ($DAD_DATA_DIR = /var/dad-data), config.php, or
#     *.sqlite. These live OUTSIDE the swapped tree (see CONFIG/DATA DESIGN).
#
# CONFIG / DATA DESIGN (config.php and data live OUTSIDE the deploy tree)
#   The ONLY copy of live sign-ups and the server-only secrets must survive every
#   deploy and (on prod) every atomic swap, so they live outside the tree that
#   gets synced/swapped:
#     * config.php lives at a fixed SHARED path, $DAD_SHARED_CONFIG
#       (default /var/www/shared/config.php). Each release/webroot gets a SYMLINK
#       at api/config.php -> $DAD_SHARED_CONFIG. The rsync HARD-excludes
#       api/config.php so it never overwrites or deletes the symlink/target.
#     * the data dir stays at the absolute path $DAD_DATA_DIR
#       (default /var/dad-data) and is referenced by SITE_DATA_DIR as an ABSOLUTE
#       path inside the shared config. api/lib/bootstrap.php already supports an
#       absolute SITE_DATA_DIR, so nothing in the release tree points at it.
#   Result: a staging rsync --delete and a prod symlink swap can never move, wipe,
#   or overwrite config.php or the data dir — they are not inside what we touch.
#
# ENV OVERRIDES (production uses the defaults; overrides exist so the LOCAL logic
# dry-run can redirect the /var/... paths into temp dirs — see deploy/README.md):
#   DAD_DEPLOY_LOG_DIR   default /var/log/dad-deploy
#   DAD_DATA_DIR         default /var/dad-data          (never touched; documented)
#   DAD_SHARED_CONFIG    default /var/www/shared/config.php
#   DAD_RELEASE_ROOT     default /var/www/releases       (prod candidate/release dirs)
#   DAD_SMOKE_TEST       default <dir of this script>/smoke-test.sh
#   DAD_SMOKE_PORT       default 8181                    (prod candidate temp port)
#   DAD_PHP_BIN          default php                     (box PHP for candidate serve)
#   DAD_SMOKE_ROUTER     default <repo>/dad/tests-e2e/router.php (candidate serve
#                        router; on the box Apache serves the live site, so the
#                        candidate is smoke-tested via a short-lived php -S — this
#                        and the real Apache swap are the box-only pieces).

set -euo pipefail

# ---- defaults (overridable via env; see header) -------------------------------
DAD_DEPLOY_LOG_DIR="${DAD_DEPLOY_LOG_DIR:-/var/log/dad-deploy}"
DAD_DATA_DIR="${DAD_DATA_DIR:-/var/dad-data}"
DAD_SHARED_CONFIG="${DAD_SHARED_CONFIG:-/var/www/shared/config.php}"
DAD_RELEASE_ROOT="${DAD_RELEASE_ROOT:-/var/www/releases}"
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
    _home="$(eval echo "$_tilde$_user")"; REPO="$_home/$_rest" ;;
esac

# ---- HARD EXCLUDES ------------------------------------------------------------
# MUST mirror deploy.sh exactly (patterns relative to dad/, since we sync dad/'s
# CONTENTS). deploy.sh says: "any future pull-based deploy script MUST mirror
# these same excludes." vendor/ is intentionally NOT excluded — dad/vendor/ holds
# the SHIPPED frontend JS (gsap.min.js etc.). Plus a defensive exclude for the new
# deploy/ tooling dir (it's a sibling of dad/, so the dad/-rooted rsync never
# reaches it, but the exclude keeps intent explicit and the two lists in sync).
EXCLUDES=(
  # --- NEVER wipe server data / secrets ---
  "--exclude=dad-site-data-*/"
  "--exclude=ds-data-*/"
  "--exclude=ds-stage-*/"
  "--exclude=api/config.php"     # symlink to the shared config; never overwrite
  "--exclude=**/stripe.key"
  "--exclude=*.sqlite"
  "--exclude=*.sqlite3"
  "--exclude=*.db"
  # --- repo-only / non-deployable ---
  "--exclude=.git/"
  "--exclude=.gitignore"
  "--exclude=*.local.md"
  "--exclude=SITE-ASSESSMENT.md"
  "--exclude=MIGRATION-NOTES*"
  "--exclude=deploy.sh"
  "--exclude=DEPLOY.md"
  "--exclude=.DS_Store"
  "--exclude=deploy/"            # the deploy tooling dir (defensive; sibling of dad/)
  # --- PHP test tooling (dev-only; never shipped). vendor/ NOT excluded. ---
  "--exclude=tests/"
  "--exclude=.phpunit-vendor/"
  "--exclude=.phpunit.cache/"
  "--exclude=.phpunit.result.cache"
  "--exclude=composer.json"
  "--exclude=composer.lock"
  "--exclude=phpunit.xml"
  # --- Tier 3 E2E tooling (dev/CI-only; never shipped). ---
  "--exclude=tests-e2e/"
  "--exclude=playwright*.config.*"
  "--exclude=playwright-report/"
  "--exclude=test-results/"
)

# Candidate serve router for prod smoke (box-only). Default lives in the repo tree.
DAD_SMOKE_ROUTER="${DAD_SMOKE_ROUTER:-$REPO/dad/tests-e2e/router.php}"

# ---- logging / alerting -------------------------------------------------------
LOG_FILE="$DAD_DEPLOY_LOG_DIR/deploy.log"
LAST_GOOD="$DAD_DEPLOY_LOG_DIR/last-good"
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

# alert MESSAGE -> stderr + logger (priority err) + ALERT marker file. Used when a
# smoke test fails so the box operator notices (and the cron log shows it too).
alert() {
  local line
  line="$(ts) [$MODE/$BRANCH] ALERT: $*"
  printf '%s\n' "$line" >&2
  printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null || true
  printf '%s\n' "$line" >> "$ALERT_MARKER" 2>/dev/null || true
  logger -p user.err -t dad-deploy -- "$line" 2>/dev/null || true
}

mkdir -p "$DAD_DEPLOY_LOG_DIR" 2>/dev/null || true

# ---- fix perms on a served tree ----------------------------------------------
# dirs 755, files 644. api/config.php is a SYMLINK to the shared config set to
# 640 admin:www-data (done on the shared file, see README); we do NOT chmod the
# symlink target here. chown admin:www-data on the tree is best-effort (needs
# privileges on the box; harmless/no-op in the local dry-run).
fix_perms() {
  local root="$1"
  find "$root" -type d -not -path '*/.git/*' -exec chmod 755 {} + 2>/dev/null || true
  find "$root" -type f -not -path '*/.git/*' -exec chmod 644 {} + 2>/dev/null || true
  chown -R admin:www-data "$root" 2>/dev/null || true
}

# Ensure api/config.php in a served tree is a symlink to the shared config.
link_shared_config() {
  local root="$1"
  if [[ -d "$root/api" ]]; then
    ln -sfn "$DAD_SHARED_CONFIG" "$root/api/config.php"
  fi
}

# ---- main ---------------------------------------------------------------------
cd "$REPO"

# Fetch the target branch without merging.
git fetch origin "$BRANCH" --quiet

BEFORE="$(git rev-parse HEAD)"
AFTER="$(git rev-parse "origin/$BRANCH")"

if [[ "$BEFORE" == "$AFTER" ]]; then
  log "no change ($BRANCH @ ${AFTER:0:12}); nothing to deploy"
  exit 0
fi

# Record the pre-deploy commit BEFORE we touch anything (rollback context).
printf '%s\n' "$BEFORE" > "$LAST_GOOD" 2>/dev/null || true
log "deploying $BRANCH: ${BEFORE:0:12} -> ${AFTER:0:12} (prior good commit recorded in $LAST_GOOD)"

# Move the working tree to the new commit.
git checkout "$BRANCH" --quiet
git reset --hard "origin/$BRANCH" --quiet

SRC="$REPO/dad/"   # trailing slash: sync the CONTENTS of dad/, mirrors deploy.sh

# shellcheck disable=SC2054  # the comma is inside the single --chmod=D755,F644 flag value, not an array separator
RSYNC_FLAGS=(-a --delete --chmod=D755,F644 "${EXCLUDES[@]}")

if [[ "$MODE" == "staging" ]]; then
  # ---- STAGING: rsync into the live webroot, smoke-test, log-on-fail ----------
  mkdir -p "$WEBROOT"
  rsync "${RSYNC_FLAGS[@]}" "$SRC" "$WEBROOT/"
  link_shared_config "$WEBROOT"
  fix_perms "$WEBROOT"

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
SMOKE_PID=""
cleanup_candidate_server() {
  [[ -n "$SMOKE_PID" ]] && kill "$SMOKE_PID" 2>/dev/null || true
}
trap cleanup_candidate_server EXIT

"$DAD_PHP_BIN" -S "127.0.0.1:$DAD_SMOKE_PORT" -t "$CANDIDATE" "$DAD_SMOKE_ROUTER" \
  >"$DAD_DEPLOY_LOG_DIR/candidate-serve.log" 2>&1 &
SMOKE_PID="$!"

# Wait for the candidate server to answer health before testing.
CANDIDATE_URL="http://127.0.0.1:$DAD_SMOKE_PORT"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "$CANDIDATE_URL/api/health.php" 2>/dev/null | grep -q '"ok":true'; then
    break
  fi
  sleep 0.5
done

if "$DAD_SMOKE_TEST" --base-url "$CANDIDATE_URL" --form; then
  cleanup_candidate_server; SMOKE_PID=""
  PREV_RELEASE="$(readlink "$WEBROOT" 2>/dev/null || true)"
  # Atomic publish: repoint the webroot symlink to the candidate (atomic on Linux).
  ln -sfn "$CANDIDATE" "$WEBROOT"
  log "smoke PASS (prod) — published ${AFTER:0:12} at $CANDIDATE (previous release kept for rollback: ${PREV_RELEASE:-none})"
  exit 0
else
  cleanup_candidate_server; SMOKE_PID=""
  # DISCARD the candidate; the live symlink was never touched.
  rm -rf "$CANDIDATE" 2>/dev/null || true
  alert "smoke FAIL (prod) at ${AFTER:0:12} — candidate DISCARDED, live site untouched. Prior good commit: ${BEFORE:0:12}"
  exit 1
fi
