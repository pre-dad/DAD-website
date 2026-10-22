#!/usr/bin/env bash
#
# smoke-test.sh — Tier 2 post-deploy smoke test for the DAD website.
#
# Runs a handful of HTTP assertions against a LOCALLY-serving copy of the site to
# prove a deploy did not break the live surface area donors touch. It is called
# by pull-deploy.sh right after a sync/build, and can be run by hand against any
# base URL (e.g. a localhost php -S dev server, or http://127.0.0.1/ on the box).
#
# Usage:
#   smoke-test.sh --base-url http://127.0.0.1:PORT [--form]
#
# Checks (fail fast — the first failure exits non-zero with a clear message):
#   CORE (always):
#     GET /api/health.php     -> 200 and body contains  "ok":true
#     GET /                    -> 200
#     GET /about/              -> 200
#     GET /give/               -> 200
#     GET /faq/                -> 200
#     GET /movement/           -> 200
#     GET /get-involved/       -> 301, Location ends with /movement/
#     GET /nonexistent-xyz     -> 404, body contains  This dollar went missing  (branded 404)
#     GET /impactledger        -> 200, Content-Type contains text/html
#   OPTIONAL (--form):
#     POST /api/submit.php  a founding submission -> 200 and body contains  "ok":true
#
# --form behaviour (documented decision): the POST is BEST-EFFORT by nature (the
# anti-bot fields — honeypot, min-fill time, Origin — can be fiddly across
# environments). BUT when --form is EXPLICITLY passed the caller is asking for it,
# so a --form failure DOES fail the whole run (non-zero exit). If you want the
# form check to be advisory only, simply don't pass --form; then only the CORE
# checks gate the deploy. The founding row is sent with email
# smoke-test@example.com — example.com is a SITE_QUIET_DOMAIN, so the row is SAVED
# but NO email is sent. That quiet test row is harmless and is cleanable from the
# admin dashboard ("@example.com" submissions).
#
# Dependencies: curl only. No jq, no python, no external deps. POSIX-friendly bash.

set -euo pipefail

BASE_URL=""
DO_FORM=0

usage() {
  echo "Usage: $0 --base-url http://127.0.0.1:PORT [--form]" >&2
  exit 2
}

# ---- parse args ---------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      [[ $# -ge 2 ]] || usage
      BASE_URL="$2"; shift 2 ;;
    --base-url=*)
      BASE_URL="${1#*=}"; shift ;;
    --form)
      DO_FORM=1; shift ;;
    -h|--help)
      usage ;;
    *)
      echo "smoke-test.sh: unknown arg '$1'" >&2; usage ;;
  esac
done

[[ -n "$BASE_URL" ]] || usage
# Normalise: drop any trailing slash so we can append paths cleanly.
BASE_URL="${BASE_URL%/}"

FAILURES=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; FAILURES=$((FAILURES + 1)); }

# Abort immediately on a CORE failure (fail fast — do not mask later problems).
core_fail() {
  fail "$1"
  printf '\nSMOKE TEST FAILED (core check): %s\n' "$1" >&2
  exit 1
}

# ---- helpers ------------------------------------------------------------------
# http_status URL  -> prints the numeric HTTP status (no redirect following).
http_status() {
  curl -s -o /dev/null -w '%{http_code}' "$1"
}

# http_body URL  -> prints the response body (no redirect following).
http_body() {
  curl -s "$1"
}

# ---- CORE: health -------------------------------------------------------------
check_health() {
  local url="$BASE_URL/api/health.php" code body
  code="$(http_status "$url")"
  [[ "$code" == "200" ]] || core_fail "GET /api/health.php expected 200, got $code"
  body="$(http_body "$url")"
  case "$body" in
    *'"ok":true'*) pass "GET /api/health.php -> 200 {\"ok\":true}" ;;
    *) core_fail "GET /api/health.php 200 but body missing \"ok\":true (got: $body)" ;;
  esac
}

# ---- CORE: pages return 200 ---------------------------------------------------
check_page_200() {
  local path="$1" code
  code="$(http_status "$BASE_URL$path")"
  [[ "$code" == "200" ]] || core_fail "GET $path expected 200, got $code"
  pass "GET $path -> 200"
}

# ---- CORE: /get-involved/ -> 301 to /movement/ --------------------------------
check_redirect() {
  local path="/get-involved/" out code loc
  # %{redirect_url} is the Location curl would follow; we do NOT follow it.
  out="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE_URL$path")"
  code="${out%% *}"
  loc="${out#* }"
  [[ "$code" == "301" ]] || core_fail "GET $path expected 301, got $code"
  case "$loc" in
    */movement/) pass "GET $path -> 301 -> $loc" ;;
    *) core_fail "GET $path 301 but Location not /movement/ (got: $loc)" ;;
  esac
}

# ---- CORE: branded 404 --------------------------------------------------------
check_404() {
  local path="/nonexistent-xyz" code body
  code="$(http_status "$BASE_URL$path")"
  [[ "$code" == "404" ]] || core_fail "GET $path expected 404, got $code"
  body="$(http_body "$BASE_URL$path")"
  case "$body" in
    *'This dollar went missing'*) pass "GET $path -> 404 (branded 404 page)" ;;
    *) core_fail "GET $path 404 but body is not the branded 404 page" ;;
  esac
}

# ---- CORE: impactledger served as text/html -----------------------------------
check_impactledger() {
  local path="/impactledger" code ctype
  code="$(http_status "$BASE_URL$path")"
  [[ "$code" == "200" ]] || core_fail "GET $path expected 200, got $code"
  # -I would use HEAD; some handlers differ on HEAD, so GET the headers.
  ctype="$(curl -s -o /dev/null -D - "$BASE_URL$path" \
            | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print tolower($2)}' | tail -1)"
  case "$ctype" in
    *text/html*) pass "GET $path -> 200 Content-Type: $ctype" ;;
    *) core_fail "GET $path 200 but Content-Type not text/html (got: ${ctype:-none})" ;;
  esac
}

# ---- OPTIONAL: founding form POST ---------------------------------------------
now_ms() {
  # Prefer ms precision; fall back to seconds*1000 where %3N is unsupported (BSD date).
  local ms
  ms="$(date +%s%3N 2>/dev/null || true)"
  case "$ms" in
    *N|'' ) echo "$(( $(date +%s) * 1000 ))" ;;   # %3N not expanded -> trailing 'N'
    *)      echo "$ms" ;;
  esac
}

check_form() {
  local url="$BASE_URL/api/submit.php" ts payload code body
  ts="$(( $(now_ms) - 5000 ))"   # rendered 5s ago -> passes any sane min-fill window
  payload="$(printf '{"type":"founding","first_name":"Smoke","email":"smoke-test@example.com","website":"","ts_open":%s,"page":"/give/welcome/"}' "$ts")"
  # Send the matching Origin so the server's own-host check passes on any port.
  # Append the status code on its own trailing line so we can split body vs code.
  local raw
  raw="$(curl -s -w $'\n%{http_code}' \
          -H 'Content-Type: application/json' \
          -H "Origin: $BASE_URL" \
          -X POST --data "$payload" "$url")"
  code="${raw##*$'\n'}"
  body="${raw%$'\n'*}"
  if [[ "$code" != "200" ]]; then
    fail "POST /api/submit.php (founding) expected 200, got $code (body: $body)"
    return 1
  fi
  case "$body" in
    *'"ok":true'*) pass "POST /api/submit.php (founding, quiet @example.com) -> 200 {\"ok\":true}" ; return 0 ;;
    *) fail "POST /api/submit.php 200 but body missing \"ok\":true (got: $body)"; return 1 ;;
  esac
}

# ---- run ----------------------------------------------------------------------
printf 'DAD smoke test -> %s\n' "$BASE_URL"

check_health
check_page_200 "/"
check_page_200 "/about/"
check_page_200 "/give/"
check_page_200 "/faq/"
check_page_200 "/movement/"
check_redirect
check_404
check_impactledger

if [[ "$DO_FORM" -eq 1 ]]; then
  if ! check_form; then
    # --form was explicitly requested, so a failure fails the run (see header).
    printf '\nSMOKE TEST FAILED (--form founding POST)\n' >&2
    exit 1
  fi
fi

if [[ "$FAILURES" -eq 0 ]]; then
  printf '\nSMOKE TEST PASSED\n'
  exit 0
fi
printf '\nSMOKE TEST FAILED (%d check(s))\n' "$FAILURES" >&2
exit 1
