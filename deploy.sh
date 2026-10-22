#!/usr/bin/env bash
#
# deploy.sh — push the DAD marketing site to an AWS Lightsail instance over SSH.
#
# Usage:
#   ./deploy.sh <ssh-target> [remote-webroot] [--go]
#   e.g.  ./deploy.sh bitnami@1.2.3.4
#         ./deploy.sh bitnami@1.2.3.4 /opt/bitnami/apache/htdocs --go
#
# It ALWAYS does a --dry-run first and shows exactly what would change, then
# requires confirmation (a --go flag OR an interactive y/N prompt) before the
# real sync. It never contacts a server without that confirmation.
#
# SAFETY: the sync uses --delete to keep the webroot a clean mirror of dad/, but
# it HARD-EXCLUDES the live data folders and server-only secrets so --delete can
# NEVER wipe or overwrite them. See api/README.txt: the data folder lives BESIDE
# /api precisely because "deploy.sh mirrors with --delete, so data inside /api
# would be wiped on every redeploy" — these excludes enforce that rule.

set -euo pipefail

# Default Lightsail LAMP/Bitnami webroot; override with arg 2.
DEFAULT_WEBROOT="/opt/bitnami/apache/htdocs"

# Resolve this script's own directory so it works when run from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/dad/"   # trailing slash: sync the CONTENTS of dad/, not the folder itself

# ---- Parse args ---------------------------------------------------------------
GO=0
POSITIONAL=()
for arg in "$@"; do
  if [[ "$arg" == "--go" ]]; then
    GO=1
  else
    POSITIONAL+=("$arg")
  fi
done

if [[ ${#POSITIONAL[@]} -lt 1 ]]; then
  echo "Usage: $0 <ssh-target> [remote-webroot] [--go]" >&2
  echo "  e.g. $0 bitnami@1.2.3.4 ${DEFAULT_WEBROOT}" >&2
  exit 2
fi

SSH_TARGET="${POSITIONAL[0]}"
REMOTE_WEBROOT="${POSITIONAL[1]:-$DEFAULT_WEBROOT}"
DEST="${SSH_TARGET}:${REMOTE_WEBROOT}/"

# ---- HARD EXCLUDES ------------------------------------------------------------
# Never let --delete touch the live data folders or server-only secrets, and do
# not upload repo-only files. Patterns are relative to SRC (dad/).
EXCLUDES=(
  # --- NEVER wipe server data / secrets (README: "never wipe the data folder") ---
  "--exclude=dad-site-data-*/"   # live sign-ups SQLite DB — the ONLY copy, lives beside /api
  "--exclude=ds-data-*/"         # DeckSend data folder (if present at the webroot)
  "--exclude=ds-stage-*/"        # DeckSend staging data folder
  "--exclude=api/config.php"     # server-only config, created at first deploy; not in git
  "--exclude=**/stripe.key"      # server-only secret
  "--exclude=*.sqlite"           # any SQLite database
  "--exclude=*.sqlite3"
  "--exclude=*.db"
  # --- repo-only / non-deployable (don't upload) ---
  "--exclude=.git/"
  "--exclude=.gitignore"
  "--exclude=*.local.md"
  "--exclude=SITE-ASSESSMENT.md"
  "--exclude=MIGRATION-NOTES*"
  "--exclude=deploy.sh"
  "--exclude=DEPLOY.md"
  "--exclude=.DS_Store"
  "--exclude=deploy/"            # pull-based deploy tooling dir (scripts, cron, README); sibling of dad/, excluded defensively
  # --- PHP test tooling (dev-only; never shipped). NOTE: vendor/ is NOT excluded
  #     on purpose — it holds the shipped frontend JS (gsap.min.js etc.). ---
  "--exclude=tests/"
  "--exclude=.phpunit-vendor/"
  "--exclude=.phpunit.cache/"
  "--exclude=.phpunit.result.cache"
  "--exclude=composer.json"
  "--exclude=composer.lock"
  "--exclude=phpunit.xml"
  # --- Tier 3 E2E tooling (dev/CI-only; never shipped). The whole tests-e2e/
  #     dir covers the specs, playwright config, package.json/lock, node_modules,
  #     playwright-report/, test-results/, router.php and ci-setup-config.sh.
  #     Defensive extra globs in case any of those ever sit outside tests-e2e.
  #     Still NO vendor/ exclude — dad/vendor/ holds the shipped frontend JS. ---
  #     NOTE: any future pull-based deploy script MUST mirror these same excludes.
  #     deploy/pull-deploy.sh now mirrors this exact exclude set (kept in sync).
  "--exclude=tests-e2e/"
  "--exclude=playwright*.config.*"
  "--exclude=playwright-report/"
  "--exclude=test-results/"
)

# shellcheck disable=SC2054  # the comma is inside the single --chmod=D755,F644 flag value, not an array separator
RSYNC_FLAGS=(-az --human-readable --chmod=D755,F644 -e ssh --delete "${EXCLUDES[@]}")

echo "Source:         $SRC"
echo "SSH target:     $SSH_TARGET"
echo "Remote webroot: $REMOTE_WEBROOT"
echo "Destination:    $DEST"
echo

# ---- Step 1: dry run ----------------------------------------------------------
echo "=== DRY RUN (nothing is uploaded; this only shows what WOULD change) ==="
rsync --dry-run --itemize-changes "${RSYNC_FLAGS[@]}" "$SRC" "$DEST"
echo "=== END DRY RUN ==="
echo

# ---- Step 2: confirm ----------------------------------------------------------
if [[ "$GO" -ne 1 ]]; then
  read -r -p "Proceed with the REAL sync shown above? [y/N] " REPLY
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    echo "Aborted. No changes were made on the server."
    exit 0
  fi
fi

# ---- Step 3: real sync --------------------------------------------------------
echo "=== REAL SYNC ==="
rsync "${RSYNC_FLAGS[@]}" "$SRC" "$DEST"
echo "=== DONE ==="
echo

# ---- Step 4: post-deploy checklist (from api/README.txt) ----------------------
HOST="${SSH_TARGET#*@}"
cat <<EOF
Post-deploy checklist (see api/README.txt):
  1. Open https://${HOST}/api/health.php   — must show {"ok":true}
  2. Open https://${HOST}/api/admin/?setup=THE-KEY once; Chris sets his password
     (the setup link then stops working).
  3. In the dashboard: "Send a test alert" and "Preview the donor email"; on the
     Emails page open "Partner confirmation" and "Send me a test". Check all arrive
     (and not in spam).
  4. Submit each form once with an @example.com address (saved, never emailed),
     then delete them in the dashboard.
  5. Submit the Founding Donor form with a real Gmail address: confirm the email
     lands in the inbox, the Unsubscribe link works, and Gmail shows its own
     one-click Unsubscribe button.
EOF
