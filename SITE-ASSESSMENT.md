# DAD Website (dynamicaid.org) — Site Assessment

> **Migration decisions (post-assessment):** Strategy = lift-and-shift onto Amazon
> **Lightsail LAMP** (PHP 8 + SQLite, code unchanged) + **SES** for email. Region
> **us-east-2**. DNS stays on **Cloudflare** (NOT Route 53) — DNS-only records to start.
> Repo `CoachCoe/dad-main-website` is **private** (the §6 "public" note below is corrected
> to private). `site.sqlite` turned out to already be local (2 submissions) — no IONOS SFTP
> pull needed, but back it up off-laptop. CEO copy-editing deferred to a later follow-up.

Read-only investigation of `/Users/shawncoe/Documents/dev/DAD/website/dad`. No files were
modified, moved, or deleted; the PHP backend was not run and nothing was deployed. Secret
values (config.php, any `.sqlite`, Stripe keys, IP salt) were never opened or printed —
they are referenced by key name only, per the brief.

---

## Summary (answer first)

The site is a **static HTML/CSS/JS marketing site** (home + 15 content pages, ~19 MB on
disk) **plus a small PHP 8 + SQLite forms backend** under `/dad/api/`. There is **no build
step** — the `js/` tree is native ES modules loaded straight from disk with `?v=` cache-
busting, and the `vendor/` libs (GSAP, ScrollTrigger, SplitText, Lenis) are pre-minified.
**What is on disk is the deployable artifact as-is.**

The hard part for AWS is the **PHP backend**: one JSON endpoint (`submit.php`) behind every
form, writing to a SQLite file, sending mail via PHP `mail()`, with a password-protected
admin dashboard and a read-only Stripe donor check. The data folder
(`dad-site-data-5d5884f70b9d6b47/site.sqlite`) holds the **only copy** of real sign-ups and a
per-install IP salt — it must be backed up before any migration and must never reach the
public GitHub repo.

Three sibling PHP mini-apps (`decksend/`, `view/`, `r1-prd/`) are **separate tools**, not part
of the dynamicaid.org marketing site, and should be handled/migrated separately or dropped
from this repo. Several hashed/empty dirs (`preview-*`, `probe-*`, `deck-1-*`, `ds-stage-*`,
`convodeckv2/`) are staging/detritus.

`serve.py` (the local dev mock the README describes) is **NOT present** anywhere in the
`website/` tree or one level up — see §5.

---

## 1. Site inventory & routing

### Real pages (have `index.html`)
Home is `dad/index.html` (96 KB). Confirmed `index.html` present in each of:
`about/`, `accessibility/`, `building-in-public/`, `contact/`, `faq/`, `give/`
(+ `give/welcome/`), `how-it-works/`, `movement/`, `privacy/`, `problem/`, `programs/`,
`proof/`, `team/`, `terms/`, `transparency/`, `partners/`, `get-involved/`, `on-prem-infra/`.

Note: `get-involved/` still has an `index.html` on disk **but** `.htaccess` 301-redirects
`/get-involved` → `/movement/` (renamed 2026-10-17), so the redirect shadows the folder.

Other real routes that are not simple content pages:
- `map/` — its own self-contained app (`index.html` + `css/js/vendor/data`, **2.4 MB**,
  1.8 MB of it in `map/data`). Appears to be the interactive map.
- `living-org-chart/`, `on-prem-infra/` — content pages with their own assets.
- `impactledger` — a **47 KB HTML file with no extension** (not a folder). Served as the
  impact-ledger view. A new host must serve it with a correct `Content-Type` (see headers).
- `DAD-Convo Deck.html` — a 112 KB standalone HTML deck at the root (mode `600`, not world-
  readable); looks like a one-off artifact, not linked site navigation.

### Data / staging / detritus dirs (NOT pages — do not deploy, do not commit)
- `dad-site-data-5d5884f70b9d6b47/` — **live data** (`site.sqlite`, 76 KB). Mode `700`.
- `ds-data-d943abb6b681de6a/` — DeckSend's **live data** (`decksend.sqlite`, 72 KB).
- `ds-stage-d11e6c6b33/` — empty `decksend/` + `view/` staging stubs.
- `preview-4b4e82d9/` — a **full second copy of the site** (3.4 MB, its own `index.html`,
  `about/`, `css/`, etc.). A staging snapshot; drop it.
- `probe-d8639c30b6c0/`, `convodeckv2/` — **empty** dirs.
- `deck-1-506b844e9a/` — a single 571-byte `index.html` stub.

### Site-level files
- `robots.txt` — `Allow: /`, `Disallow: /api/`, `Sitemap: https://dynamicaid.org/sitemap.xml`.
- `sitemap.xml` — 16 URLs (home + about, accessibility, building-in-public, contact, faq,
  give, how-it-works, movement, privacy, problem, programs, proof, team, terms,
  transparency). `lastmod` 2026-10-18.
- `404.html` (12 KB), `favicon.svg`.

### Root `.htaccess` behaviors a new host MUST replicate (`dad/.htaccess`)
- `Options -Indexes` (no directory listing).
- `DirectoryIndex index.html index.php` — serve `index.html`, fall back to `index.php`.
- `ErrorDocument 404 /404.html`.
- **301 redirect**: `^/get-involved/?$` → `/movement/`.
- MIME types: `.woff2`→font/woff2, `.webp`→image/webp, `.svg`→image/svg+xml,
  `.js/.mjs`→application/javascript. (The extension-less `impactledger` file needs a
  deliberate `text/html` content-type rule on any new host.)
- DEFLATE compression for html/css/js/json/xml/svg/plain.
- Security headers (always): `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`.
- Cache-Control by type: `.html` → `no-cache`; `.woff2` → `public, max-age=31536000,
  immutable`; `.css/.js/.png/.jpg/.jpeg/.webp/.svg` → `public, max-age=604800`.

### `api/.htaccess` behaviors (must survive if PHP is kept)
- Denies serving `config.php`, `config.sample.php`, `README.txt`, and any
  `.sqlite/.sqlite3/.db/.log/.jsonl/.bak/.md/.txt`.
- `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex, nofollow` on the whole folder.
- `submit.php` / `health.php` → `Cache-Control: no-store`.
- `api/lib/.htaccess` and each data dir's `.htaccess` are `Require all denied`.

---

## 2. Static frontend

**Stack:** hand-authored HTML, a set of CSS files under `css/`
(`tokens.css, base.css, layout.css, components.css, scenes.css, site.css, ledger.css`,
page-specific `page-*.css`, `partner-modal.css`, `touch-perf.css`) and **native ES-module
JavaScript** under `js/`:
- `js/app.js` — runtime entry (`<script type="module" src="/js/app.js?v=…">` in
  `index.html` line 47). It `import`s from `js/core/*` (router, nav, forms, scenes, reveals,
  theme, preloader, ticker, cursor, magnetic, cookie, ledger, tier, ui, util),
  `js/pages/*` (per-page modules), `js/dollar/*` (a WebGL "dollar" animation with a
  `worker.js`), and `js/dots/*`.
- `vendor/` — pre-minified `gsap.min.js`, `ScrollTrigger.min.js`, `SplitText.min.js`,
  `lenis.min.js`, loaded as plain `<script defer>` (lines 43–46).

**Build step: NONE.** Confirmed — no `package.json`, no `*.config.js`, no webpack/vite/
gulp/rollup/grunt config anywhere in the tree, and no `src/` directory. Imports use literal
file paths with `?v=c2c7328da2` cache-busting query strings (the same `?v=` on the vendor
tags), i.e. the browser loads the modules directly. **So the on-disk files ARE the
deployable artifact** — no compile/bundle before upload.

**Size:** ~19 MB total. Largest contributors:
- `decksend/` 8.3 MB and `preview-4b4e82d9/` 3.4 MB — **not part of the real site** (see §1/§4);
  excluding them the marketing site is well under ~7 MB.
- `map/` 2.4 MB (1.8 MB is `map/data`).
- `assets/` 1.7 MB: `team/` 940 KB (team photos), `liquid/` 244 KB, `fonts/` 228 KB
  (9 woff2: Inter 400/500/600/700, Space Grotesk 500/700, IBM Plex Mono 400/500/600),
  `logos/` 216 KB, `img/` 152 KB.
- **No video files** (`.mp4/.webm/.mov`) found. Heaviest media is team photos + the map data.

Everything is cache-friendly and CDN-friendly; the only server-side behavior on the static
side is the `.htaccess` rules in §1.

---

## 3. PHP backend (`/dad/api/`) — the hard part for AWS

**Runtime:** PHP 8 (README). PDO SQLite (`new PDO('sqlite:…')` in `lib/db.php`), and `curl`
for Stripe (`lib/stripe.php` prefers `curl_init`, falls back to a stream context). Implied
extensions: **pdo_sqlite**, **curl**, **mbstring** (`mb_*` used), plus PHP `mail()`.

### Endpoints
| Endpoint | Method | What it does |
|---|---|---|
| `api/submit.php` | POST (JSON or form) | Every form posts here. Validates, rate-limits, dedupes list sign-ups, stores to SQLite, sends mail. |
| `api/health.php` | GET/HEAD | `200 {"ok":true}` when config present and DB writable; `503 {"ok":false,"error":…}` otherwise. Writes `settings.last_health_check` to prove a write works. |
| `api/donor.php` | GET | `?session_id=cs_…` → `{ok:true, first_name, email, amount}` prefill for `/give/welcome/`; `{ok:false}` if no key / unknown / unpaid. Rate-limited 30/hr/IP. |
| `api/unsubscribe.php` | GET/POST/HEAD | One-click unsubscribe from the email link (`?t=<32-hex token>`); RFC 8058 one-click POST; `a=resubscribe` undo. HEAD never unsubscribes (link checkers). |
| `api/admin/index.php` | GET/POST | Password-protected dashboard (53 KB): list/search/filter/export sign-ups, edit email wording, test sends. |

### `POST /api/submit.php` contract (confirmed against `submit.php` + README)
Request JSON (or urlencoded form): `{type, first_name?, name?, email?, phone?, zip?, city?,
topic?, message?, company?, note?, ref?, page, website:"" (honeypot), ts_open:<ms epoch>}`.
`type ∈ {founding, updates, support, volunteer, contact, partner}` (`SITE_TYPES` in
`lib/bootstrap.php`). Per-type required fields are enforced in `lib/validate.php`:
- `founding`, `updates`: `first_name` + `email`
- `support`: `first_name` + (`email` **or** `phone`, single box, server detects which) + 5-digit `zip`
- `volunteer`: `first_name` + `email` + `city`
- `contact`: `name` + `email` + `topic` (∈ Giving|Partnership|Press|Careers|Something else) + `message` (≤5000)
- `partner`: `name` + `email` + `company` (≤160) + optional `note` (≤2000)

Responses: `200 {ok:true, id, type}` (`id` = 10-char referral code / pid);
`400 {ok:false, error, field?}`; `429 {ok:false, error:"Too many requests"}` + `Retry-After`;
`403 {ok:false, error:"Forbidden"}` (cross-origin); `405` (wrong method);
`503` (not configured / storage down). **Silent drops** (return `200` with a throwaway id,
store nothing): honeypot `website` non-empty, or `0 ≤ now−ts_open < 1500 ms`
(`SITE_MIN_FILL_MS`). A JSON post with no `ts_open` → `400`. No-JS HTML form posts get a
small branded result page instead of JSON (`reply()` / `result_html()` in `submit.php`).
Body cap 32768 bytes.

### SQLite schema (read from `lib/db.php` CREATE TABLE, not from any `.sqlite`)
- `settings(k TEXT PK, v TEXT)` — key/value incl. `ip_salt`, `admin_hash`, `setup_used`,
  `admin_gen`, `last_health_check`.
- `submissions(id, pid UNIQUE, type, email, fields JSON, page, ref, ip_hash, ua,
  unsub_token UNIQUE, unsubscribed_at, handled_at, repeat_count, created_at, updated_at)`
  with indexes on `(type,created_at)`, `created_at`, `email`, `ref`, and a **partial unique
  index** `submissions_list_email` on `(type,email)` for `founding`/`updates` (one row per
  email per list → dedupe).
- `hits(k, ts)` — sliding-window rate-limit / login-lockout counters, pruned after 7200 s.
- `mail_log(ts, kind, ok)` — mail send audit (no addresses).
- `email_templates(k PK, data JSON, updated_at)` — dashboard wording overrides (schema v2).

`PRAGMA user_version` migrations: v1 creates the first four tables, v2 adds
`email_templates`. Uses rollback journal (not WAL) on purpose because shared hosting storage
"may be a network filesystem" (`db.php` comment) — **relevant to EFS/NFS on AWS**.

### Email (`lib/mail.php`) — all via PHP `mail()`
`send_mail()` builds MIME headers by hand (From, Reply-To, Message-ID, multipart/alternative
text+html, quoted-printable), adds `List-Unsubscribe` + `List-Unsubscribe-Post`
(one-click, RFC 8058) when an unsubscribe URL is given, and calls `@mail(... '-f'.$from)`.
Every send is logged to `mail_log`. Helpers: `notify_team()` (team alert), 
`send_founding_confirmation()`, `send_partner_confirmation()`. Only `founding` and `partner`
send mail to the person; the rest answer on screen only. Hourly confirmation cap
`SITE_MAX_CONFIRMATIONS_PER_HOUR` (200) via `confirm_capped()`. README notes SPF/DKIM/DMARC
must be set and that at real volume this should move to a transactional service — **this is
the single clearest reason to adopt SES on AWS.**

### Stripe (`lib/stripe.php`) — read-only donor verification, NOT payment processing
- Payments are taken by **Stripe Checkout elsewhere** (the site redirects donors to a Stripe
  URL). This backend only **verifies** the gift: `GET https://api.stripe.com/v1/checkout/
  sessions/{id}` with `Authorization: Bearer <key>`.
- The key is a **restricted key** (Checkout Sessions: read), and is **NOT in config.php** —
  it lives in `<data dir>/stripe.key` (locked `Require all denied`, never mirrored). Key
  format validated as `^(rk|sk)_(live|test)_…$`.
- `donor_from_session()` accepts only sessions with `status === 'complete'` and
  `payment_status ∈ {paid, no_payment_required}`, then returns
  `{session, verified, verified_at, customer, subscription, amount (cents), name, email}`.
- No key → sign-ups still work; the session id is stored **unverified** for later checking.
  No webhooks; this is a pull/lookup only. (All referenced by key NAME; no values read.)

### Rate limiting / abuse
Sliding-window counters in `hits` (`lib/db.php`): submit 10/hr/IP (`SITE_RATE_LIMIT_PER_HOUR`,
key `s:<iphash>`), donor lookup 30/hr/IP (`d:<iphash>`). Admin login lockout 10 wrong in
15 min. Honeypot + min-fill-time silent drops. IPs are stored only as **salted SHA-256**
(`ip_hash()`), salt generated on the server and kept in `settings.ip_salt`.

### Admin auth model (`api/admin/index.php`)
One-time setup link `?setup=<key>`: the key's SHA-256 is in config
(`SITE_SETUP_KEY_SHA256`); `hash_equals(cfgHash, sha256(setupKey))` gates it, each key works
once (`settings.setup_used`). The admin then sets a password (`password_hash`,
`PASSWORD_DEFAULT`, stored as `settings.admin_hash`). Sessions: `dad_site_admin` cookie,
strict mode, cookies-only, `httponly`, `samesite=Lax`, `secure` when HTTPS; CSRF token on
every POST (`csrf_ok()` via `hash_equals`); an `admin_gen` generation value signs out old
sessions when the password is reset.

### Config KEYS (from `api/config.sample.php` — values in the live `config.php` NOT read)
`config.php` itself holds **no secrets** (README/sample); secrets are the setup key (only its
hash is stored), the Stripe key (separate file), and the IP salt (in the DB).
- `SITE_TZ` — timezone (America/New_York).
- `SITE_BASE` — `https://dynamicaid.org`; used in email links.
- `SITE_DATA_DIR` — unguessable data-folder name beside `/api` (e.g. `dad-site-data-…`).
- `SITE_SETUP_KEY_SHA256` — 64-hex hash of the one-time admin setup key.
- `SITE_NOTIFY_TO` — team alert recipient (`chris@dynamicaid.org`).
- `SITE_NOTIFY_TYPES` — which form types email the team.
- `SITE_NOTIFY_FROM`, `SITE_NOTIFY_FROM_NAME` — team-alert From.
- `SITE_MAIL_FROM`, `SITE_MAIL_FROM_NAME`, `SITE_MAIL_REPLY_TO` — public-email identity
  (`hello@dynamicaid.org` must be a real mailbox).
- `SITE_RATE_LIMIT_PER_HOUR` (10), `SITE_MIN_FILL_MS` (1500),
  `SITE_MAX_CONFIRMATIONS_PER_HOUR` (200), `SITE_QUIET_DOMAINS` (`['example.com']` — saved,
  never emailed).
- `SITE_ALLOWED_ORIGINS` — extra origins allowed to post (apex + www).

---

## 4. The other PHP apps (recommendation: out of scope for this migration)

- **`decksend/`** (8.3 MB) — a pitch-deck sharing/tracking tool. `index.php` is a
  password-protected admin ("DeckSend" overview, `dsadmin` session), `lib.php` opens its
  **own** DB `ds-data-d943abb6b681de6a/decksend.sqlite`, `setup.php` + `config.php` (its own
  `DS_TZ`, `DS_DATA_DIR`, `DS_DOCS`, a view password — not read). Has an `assets/` and
  `docs/`. **Independent app, its own data, not the marketing site.**
- **`view/`** — the public/recipient side of DeckSend: `index.php` + `t.php` **both
  `require ../decksend/lib.php`** and share DeckSend's DB. `t.php` is a tracking beacon
  (records `visits`); `.htaccess` rewrites `/view/<slug>` → `index.php?d=<slug>`. **Tied to
  DeckSend, not the marketing site.**
- **`r1-prd/`** — a standalone **password-gated private document viewer**: `index.php` is a
  login (session, constant-time `hash_equals` against a password in its own `config.php`,
  `usleep` throttle), serving `private/content.html` via `private/doc.php`. **Independent
  one-off, not the marketing site.**
- **`convodeckv2/`** — **empty**. Drop.

**Recommendation:** migrate **only** the marketing site + its `/api` to dynamicaid.org on
AWS. Keep `decksend/`, `view/`, `r1-prd/` **out of the `dad-main-website` repo** and migrate
them separately (or retire them) — they have their own databases, their own auth, and
different lifecycles. Including them would also leak their configs/data and bloat the repo
(DeckSend alone is 8.3 MB). The README deploy notes already treat them as separate top-level
folders that must never be wiped.

---

## 5. How to run / verify locally

**`serve.py` is NOT present.** Searched the whole `website/` tree and one level up
(`/Users/shawncoe/Documents/dev/DAD`): no `serve.py`, no `_local-data/`, no `*.jsonl`. The
README describes it living "at the website root," but only the `dad/` folder was copied here —
the dev harness did not come with it. (Fact: the find returned nothing.)

Two practical ways to preview locally:

**A. Static preview (no backend) — good for layout/JS, forms won't save.**
From `dad/`, run any static server rooted there, e.g.
`python3 -m http.server 8000`, then open `http://localhost:8000/`.
- What works: all pages, CSS, ES-module JS, GSAP/Lenis animations, the map, fonts.
- What does NOT: `index.html` loads `app.js` as `type="module"` with absolute paths
  (`/js/…`, `/vendor/…`, `/assets/…`), so it **must** be served from the site root (opening
  `file://` will break module/CORS). Forms will POST to `/api/submit.php` and 404 — the JS
  will show its network-error state. The `.htaccess` 301 and headers are **not** applied by
  `http.server`.

**B. Full backend preview — PHP built-in server (exercises the real API).**
From `dad/`, `php -S localhost:8000` (PHP 8 with pdo_sqlite, curl, mbstring). This serves
static files AND runs the PHP. Caveats:
- `.htaccess` is Apache-only; `php -S` ignores it, so the 301, the config/data denials, and
  the headers won't apply locally (fine for functional testing, not for verifying the
  routing/headers — test those on the real host or a local Apache).
- To make the API actually store/send you'd need a local `config.php` with a valid
  `SITE_DATA_DIR` (`site_configured()` must pass). Without it, `health.php`/`submit.php`
  return `503 Not configured` — which is itself a valid smoke-test result.
- Email: `mail()` almost certainly won't deliver locally — expect `mail_log` to record
  failures. Stripe verification needs `<data dir>/stripe.key`; without it donor checks just
  return unverified. **Do not point a local run at the live data folder.**

**Concrete smoke test (static, safe, no secrets):**
1. `cd /Users/shawncoe/Documents/dev/DAD/website/dad && python3 -m http.server 8000`
2. Open `http://localhost:8000/` — confirm home renders, nav works, animations run.
3. Visit `/about/`, `/give/`, `/faq/`, `/movement/`, `/map/` — confirm each loads.
4. Submit a form — confirm the JS shows a graceful error (no backend), proving the
   front-end contract and error handling, without writing any data.
5. For API behavior, switch to `php -S localhost:8000` and `GET /api/health.php` — expect
   `503 {"ok":false,"error":"Not configured"}` with no local config, which confirms the
   endpoint runs and fails safe.

---

## 6. Secrets & data to protect (MUST be git-ignored before the PUBLIC repo)

Target repo is **public** (`https://github.com/CoachCoe/dad-main-website`). The following must
never be committed:

- `dad/api/config.php` — live config (keys referenced by name only; some mailboxes/addresses).
- `dad/decksend/config.php` — DeckSend config (its own secrets).
- `dad/r1-prd/config.php` — contains the viewer password.
- Any `view/` config (none found as a separate file — `view/` pulls `decksend/config.php`).
- **All data dirs** and their contents — real sign-ups + the IP salt + DeckSend data:
  - `dad/dad-site-data-5d5884f70b9d6b47/` (`site.sqlite`)
  - `dad/ds-data-d943abb6b681de6a/` (`decksend.sqlite`)
  - `dad/ds-stage-d11e6c6b33/`
  - any future `dad-site-data-*`, `ds-data-*`, `ds-stage-*` (hashed names).
- Any `.sqlite/.sqlite3/.db` anywhere; `<data dir>/stripe.key`; any `.env`; `_local-data/`
  and `*.jsonl` (the dev mock's output) if it ever appears.
- Consider excluding staging/detritus too: `preview-*/`, `probe-*/`, `deck-1-*/`,
  `convodeckv2/`, and `DAD-Convo Deck.html` (not part of the site).

**Backup concern (README):** `<SITE_DATA_DIR>/site.sqlite` is the **only copy** of every
sign-up (and the IP salt is only in that DB). **Download/back it up over SFTP before any
migration or repo work**, and keep it out of git. Same for `decksend.sqlite`.

### Proposed `.gitignore` (place at repo root)
```gitignore
# --- Live config (never commit) ---
dad/api/config.php
dad/decksend/config.php
dad/r1-prd/config.php
**/config.php
!**/config.sample.php

# --- Secrets & local env ---
**/stripe.key
.env
.env.*

# --- Data stores (sign-ups, IP salt, DeckSend data) ---
dad/dad-site-data-*/
dad/ds-data-*/
dad/ds-stage-*/
**/*.sqlite
**/*.sqlite3
**/*.db

# --- Local dev output ---
_local-data/
**/*.jsonl

# --- Staging / detritus (optional, not part of the site) ---
dad/preview-*/
dad/probe-*/
dad/deck-1-*/
dad/convodeckv2/

# --- Non-site PHP apps (recommend migrating/retiring separately) ---
# dad/decksend/
# dad/view/
# dad/r1-prd/
```
Note the `!**/config.sample.php` negation keeps the safe template in the repo. The
`**/config.php` catch-all plus explicit lines is belt-and-suspenders. Decide separately
whether `decksend/`, `view/`, `r1-prd/` belong in this repo at all (recommendation §4: no).

---

## 7. AWS migration inputs (facts for the plan, not the plan)

Moving parts an AWS target must satisfy for **dynamicaid.org** (apex) + **www**:

**Static hosting + CDN + TLS** (the HTML/CSS/JS, ~7 MB excluding the non-site apps):
- Natural fit: **S3 (private) + CloudFront + ACM cert**, Route 53 for DNS.
- Behaviors from `.htaccess` that move to CloudFront/S3:
  - `DirectoryIndex index.html` → CloudFront default root object + a function to map
    `/path/` → `/path/index.html`.
  - **301 `/get-involved` → `/movement/`** → CloudFront Function / redirect rule.
  - 404 → `/404.html` → CloudFront custom error response (404 → `/404.html`).
  - Cache-Control per type and the `impactledger` extension-less file's `text/html` →
    S3 object metadata / CloudFront policies (set content-types at upload).
  - Security headers (`nosniff`, `Referrer-Policy`) + compression → CloudFront response-
    headers policy (CloudFront does gzip/brotli, replacing mod_deflate).
  - Deny `/api/` internals and data dirs → simply **don't upload** configs/data; and if the
    API moves off-S3, route `/api/*` to its own origin.

**The PHP backend — three options to note (decision deferred to the plan):**
1. **Lift-and-shift PHP + Apache** on EC2 / Lightsail / Elastic Beanstalk (PHP 8, pdo_sqlite,
   curl, mbstring). SQLite file lives on an attached volume/EFS — note `db.php` deliberately
   uses rollback journal "in case storage is a network filesystem," which matters on EFS.
   Lowest code change; keeps `mail()` (but `mail()` on EC2 is poor — still want SES).
2. **Re-platform the forms API** to **API Gateway + Lambda** (rewrite `submit.php`/
   `unsubscribe.php`/`donor.php`/`health.php` logic). Route `/api/*` from CloudFront to API
   Gateway. The admin dashboard (`admin/index.php`, 53 KB) also needs a home.
3. **Replace SQLite** with **RDS/Aurora (Postgres/MySQL)** or **DynamoDB**. The schema is
   small (5 tables, §3) and portable; the partial unique index on `(type,email)` and the
   sliding-window `hits` table are the only non-trivial bits to translate.

**Email:** replace PHP `mail()` with **Amazon SES** (README itself recommends a transactional
service at volume). Preserve the hand-built `List-Unsubscribe` one-click headers and the
multipart text+html. SPF/DKIM/DMARC for dynamicaid.org must be set up in SES; verify
`hello@dynamicaid.org` (public) and `no-reply@dynamicaid.org` (team-alert From) / notify-to
`chris@dynamicaid.org`.

**Stripe:** unaffected — Checkout is hosted by Stripe; the backend only does a read-only
session lookup over HTTPS. The restricted key must live in a secret store
(**Secrets Manager / SSM Parameter Store**), replacing `<data dir>/stripe.key`.

**Data / persistence story:** `site.sqlite` is the only copy of real sign-ups + the IP salt.
Plan must (a) back it up first, (b) choose the persistence target (EFS-mounted SQLite vs
RDS/DynamoDB migration), and (c) carry the `ip_salt` and `email_templates` rows across
(losing the salt breaks dedupe-by-IP continuity; losing templates reverts email wording to
the `lib/emails.php` defaults — not catastrophic).

**DNS:** name servers already moved (per the user). Likely target **Route 53** hosted zone
for `dynamicaid.org` with `dynamicaid.org` + `www.dynamicaid.org` → CloudFront (alias A/AAAA),
plus the SES mail records (SPF/DKIM/DMARC). `SITE_BASE` stays `https://dynamicaid.org`;
`SITE_ALLOWED_ORIGINS` already lists apex + www.

---

## Facts vs inference (honesty note)

- **Fact (read in code/config):** all endpoint contracts, the SQLite schema, the Stripe
  lookup behavior, the `.htaccess` rules, the config key names, rate limits, the admin auth
  flow, the absence of any build tooling, and that `serve.py`/`_local-data` are not present.
- **Inference:** that `preview-4b4e82d9/`, `deck-1-*`, `convodeckv2/`, `probe-*` are
  staging/detritus (based on contents + hashed names, not a manifest); that `decksend/view/
  r1-prd` are out of scope (based on separate DBs/auth and the README's "deploy folder by
  folder, never --delete the root" guidance); and the AWS service mappings in §7 (standard
  patterns, not yet decided). The live values in `config.php` and the `.sqlite` contents were
  deliberately **not** inspected.
