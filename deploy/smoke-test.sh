#!/usr/bin/env bash
#
# smoke-test.sh: post-deploy HTTP checks against a running copy of the site (the
# box's Apache, a prod candidate on php -S, or a local dev server). Needs only curl.
#
#   smoke-test.sh --base-url http://127.0.0.1:PORT [--form]
#
# Checks health, key pages, the /get-involved/ redirect, the branded 404 and the
# impactledger content type, stopping at the first failure. --form also posts a
# Founding Donor sign-up as smoke-test@example.com: example.com is a quiet domain,
# so the row is saved (once; repeats dedupe) but no email is sent.

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
BASE_URL="${BASE_URL%/}"

FAILURES=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; FAILURES=$((FAILURES + 1)); }

core_fail() {
  fail "$1"
  printf '\nSMOKE TEST FAILED (core check): %s\n' "$1" >&2
  exit 1
}

# Neither helper follows redirects.
http_status() {
  curl -s -o /dev/null -w '%{http_code}' "$1"
}

http_body() {
  curl -s "$1"
}

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

check_page_200() {
  local path="$1" code
  code="$(http_status "$BASE_URL$path")"
  [[ "$code" == "200" ]] || core_fail "GET $path expected 200, got $code"
  pass "GET $path -> 200"
}

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
