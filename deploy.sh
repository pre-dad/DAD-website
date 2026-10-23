#!/usr/bin/env bash
#
# deploy.sh — push the DAD marketing site to an AWS Lightsail instance over SSH.
#
# Usage:
#   ./deploy.sh <ssh-target> [remote-webroot] [--go]
#   e.g.  ./deploy.sh admin@1.2.3.4
#         ./deploy.sh admin@1.2.3.4 /var/www/html --go
#
# It ALWAYS does a --dry-run first and shows exactly what would change, then
# requires confirmation (a --go flag OR an interactive y/N prompt) before the
# real sync. It never contacts a server without that confirmation.
#
# The sync uses --delete to keep the webroot a mirror of dad/; deploy/rsync-excludes
# keeps it away from the live data folder and server-only secrets.

set -euo pipefail

# Override with arg 2.
DEFAULT_WEBROOT="/var/www/html"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/dad/"

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
  echo "  e.g. $0 admin@1.2.3.4 ${DEFAULT_WEBROOT}" >&2
  exit 2
fi

if ! rsync --version 2>/dev/null | grep -q 'version 3'; then
  echo "deploy.sh needs rsync 3.x for --chmod; macOS ships openrsync. Install it with: brew install rsync" >&2
  exit 1
fi

SSH_TARGET="${POSITIONAL[0]}"
REMOTE_WEBROOT="${POSITIONAL[1]:-$DEFAULT_WEBROOT}"
DEST="${SSH_TARGET}:${REMOTE_WEBROOT}/"

# shellcheck disable=SC2054  # the comma is inside the single --chmod=D755,F644 flag value, not an array separator
RSYNC_FLAGS=(-az --human-readable --chmod=D755,F644 -e ssh --delete --exclude-from="$SCRIPT_DIR/deploy/rsync-excludes")

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
