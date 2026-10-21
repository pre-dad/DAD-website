DAD WEBSITE FORMS API
=====================
PHP 8 + SQLite backend for every form on dynamicaid.org (Founding Donor waitlist,
build updates, get support, volunteer, contact, partner). Same hosting pattern as DeckSend:
IONOS shared hosting, PHP mail(), data folder outside anything a deploy can wipe.

Nothing here is live until it is deployed. Locally, PHP is not used at all:
serve.py (website root) fakes /api/submit.php and /api/health.php and writes to
05 - DAD/website/_local-data/submissions.jsonl.


WHAT IS WHERE (on the server)
-----------------------------
  /api/submit.php          every form posts here (JSON in, JSON out)
  /api/unsubscribe.php     one-click unsubscribe link used in emails
  /api/health.php          {"ok":true} when config + database are working
  /api/admin/              private dashboard (password)
  /api/config.php          settings (you create it, see below). Web access blocked.
  /api/lib/                helpers. Web access blocked.
  /<SITE_DATA_DIR>/        the data folder, BESIDE /api in the webroot, e.g.
                           /dad-site-data-1a2b3c4d5e6f7a8b/site.sqlite
                           Created automatically on the first form post, locked with
                           "Require all denied". It is outside /api on purpose:
                           deploy.sh mirrors with --delete, so data inside /api would
                           be wiped on every redeploy.


BEFORE THE FIRST DEPLOY: CREATE config.php
------------------------------------------
1. Copy api/config.sample.php to api/config.php IN THE VAULT
   (05 - DAD/website/api/config.php). Keep it in the vault so every deploy
   carries it. It holds no secrets: only addresses, a folder name and a hash.

2. Pick an unguessable data folder name and put it in SITE_DATA_DIR:
     python3 -c "import secrets; print('dad-site-data-' + secrets.token_hex(8))"

3. Make a one-time setup key. Give the KEY to Chris privately; put only its
   HASH in SITE_SETUP_KEY_SHA256. Never write the key itself in the vault.
     python3 -c "import secrets; print(secrets.token_urlsafe(24))"
     printf '%s' 'PASTE-THE-KEY' | shasum -a 256

4. Check SITE_NOTIFY_TO (default chris@dynamicaid.org) and SITE_MAIL_FROM
   (default hello@dynamicaid.org). hello@ must be a real mailbox: donors will
   reply to the confirmation email.


DEPLOY (only when Chris says go)
--------------------------------
  chmod 644 every file first (the server cannot read 600 files):
    find "05 - DAD/website/api" -type f -exec chmod 644 {} \;
  Deploy just this folder, from the vault root:
    .claude/bin/deploy.sh "05 - DAD/website/api/" api

  !! NEVER mirror the whole site to the webroot with --delete
     (deploy.sh <dist>/ with no subpath). That deletes every folder at the root
     that is not in dist/: /decksend, /view, the DeckSend data folder, and this
     data folder with every sign-up in it. Deploy the site folder by folder, or
     run lftp mirror WITHOUT --delete for the root, or with
     --exclude-glob 'dad-site-data-*' --exclude-glob 'ds-data-*'
     --exclude decksend/ --exclude view/

  After deploying:
    1. https://dynamicaid.org/api/health.php      must show {"ok":true}
    2. https://dynamicaid.org/api/admin/?setup=THE-KEY
       Chris creates his password (12+ characters). The link then stops working.
    3. In the dashboard: "Send a test alert" and "Preview the donor email".
       Check both arrive (and not in spam). On the Emails page, open
       "Partner confirmation" and press "Send me a test" too.
    4. Submit each form on the site once with an @example.com address. These are
       saved but never emailed (SITE_QUIET_DOMAINS). Then delete them in the
       dashboard.
    5. Submit the Founding Donor form once with a real Gmail address. Check the
       email lands in the inbox, the Unsubscribe link works, and Gmail shows its
       own "Unsubscribe" button (that is the one-click header).


DAY TO DAY
----------
  Dashboard:   https://dynamicaid.org/api/admin/
  Counts by type at the top (click one to filter). Search finds names, emails,
  cities, message text and referral codes. "Mark handled" when you have dealt
  with something. Delete removes a record for good.

  EXPORT: pick a type, then "Export CSV" (everything of that type) or, for
  Founding Donors and Build updates, "Mailing list CSV" (only people still
  subscribed, each with their own unsubscribe link: use that list and those
  links when sending the monthly update).

  PRIVACY REQUESTS (privacy@dynamicaid.org): search the exact email, then
  "Delete all" removes every record for that address.

  Founding Donor and Build updates are one row per email. Signing up again does
  not create a duplicate and does not resend the confirmation (it only counts
  the repeat), unless the person had unsubscribed: then it re-subscribes them
  and sends the confirmation again.

  Referrals: every Founding Donor gets a code (the "id" the site returns) and a
  link https://dynamicaid.org/?ref=<code>. Sign-ups that arrive with a code show
  "via <code>", and the referrer shows "Brought N people".


EMAILS PAGE: CHANGE WHAT THE AUTOMATIC EMAILS SAY
-------------------------------------------------
  Dashboard > "Emails" (top bar), or https://dynamicaid.org/api/admin/?page=emails

  Two kinds of email are listed:
    - Sent to people who fill in a form: the Founding Donor confirmation and the
      Partner confirmation. (Build updates, Get support, Volunteer and Contact
      send nothing to the person; they only see a message on the screen.)
    - Sent to you: one team alert per form type.

  Click one to edit it:
    - Change the subject line and the words. For the people emails you can edit the
      greeting, the message (empty line = new paragraph), the big closing line and
      the signature. For team alerts you can edit the subject and add a note at
      the top; the details of the submission are always added underneath.
    - Placeholders such as {first_name} or {referral_link} are listed beside the
      editor. Click one to drop it in where your cursor is. When the email goes
      out it is replaced with that person's real detail. A misspelled placeholder
      is caught when you save.
    - "Preview changes" shows the email as people will see it, with made-up
      details. Nothing is saved.
    - "Send me a test" sends the wording on screen to SITE_NOTIFY_TO, marked
      [Test]. Nothing is saved.
    - "Save" makes it live for the next email that goes out.
    - "Reset to default" (only shown after an edit) brings back the original words.

  What you cannot change, on purpose: the design and logo, and on the Founding
  Donor email the Unsubscribe link and the one-click unsubscribe header that
  Gmail and Apple Mail use. Those are added by the code every time.
  Your wording is kept in the database (table email_templates), so deploys do
  not overwrite it. The original wording lives in api/lib/emails.php.


CHANGE THE NOTIFICATION ADDRESS
-------------------------------
  Edit SITE_NOTIFY_TO in api/config.php, then redeploy api. To stop alerts for
  one form type, remove it from SITE_NOTIFY_TYPES (it is still saved and shown
  in the dashboard).


LOST PASSWORD
-------------
  Make a NEW setup key (step 3 above), put its hash in config.php, redeploy, open
  https://dynamicaid.org/api/admin/?setup=NEW-KEY. Each key works once; setting a
  new password signs out every old session.


EMAIL DELIVERY
--------------
  Uses PHP mail() on IONOS (same as DeckSend). Before launch:
  - SPF for dynamicaid.org must include IONOS, DKIM should be on in the IONOS
    mail settings, and a DMARC record should exist, or Gmail may junk the
    confirmation email.
  - IONOS limits how much mail() can send. SITE_MAX_CONFIRMATIONS_PER_HOUR (200)
    caps confirmations; anything over the cap is still saved and the dashboard
    shows how many were held back. At real volume, move confirmations to a
    transactional email service.
  - The monthly update is NOT sent from here. Export the mailing list CSV and use
    the unsubscribe link in each row.


WHAT IS STORED (and what is not)
--------------------------------
  submissions: type, the validated form fields (JSON), page, referral code,
    salted SHA-256 of the IP (never the IP itself), browser user agent,
    created/updated times, handled/unsubscribed times, unsubscribe token.
  hits: salted IP hash + time, kept 2 hours, for the 10-posts-per-hour limit and
    the login lockout (10 wrong passwords in 15 minutes).
  mail_log: time, kind, sent or failed. No addresses.
  email_templates: the wording saved on the Emails page (no personal data).
  The IP salt is generated on the server and lives only in the database.

  BACKUP: download <SITE_DATA_DIR>/site.sqlite over SFTP now and then. It is the
  only copy.


THE CONTRACT (what the site's JavaScript and serve.py's mock must match)
------------------------------------------------------------------------
  POST /api/submit.php   Content-Type: application/json
    {type, first_name?, name?, email?, phone?, zip?, city?, topic?, message?,
     company?, note?, ref?, page, website:"", ts_open:<ms since epoch when the form rendered>}
    type: founding | updates | support | volunteer | contact | partner
    founding, updates:  first_name + email
    support:            first_name + (email or phone) + zip (5 digits).
                        The single "Email or phone" box may be sent as either
                        key; the server works out which it is.
    volunteer:          first_name + email + city
    contact:            name + email + topic + message
                        topic: Giving | Partnership | Press | Careers | Something else
    partner:            name + email + company (160 max) + note (optional, 2,000 max)
                        Sent from the "Partner with us" modal (src/js/core/partner-modal.js).
                        Sends a confirmation to the person and an alert to the team
                        with Reply-To set to the person.
    200 {ok:true, id, type}       id = 10-char referral code
    400 {ok:false, error, field?} field = the input to highlight
    429 {ok:false, error:"Too many requests"} + Retry-After header
    403 {ok:false, error:"Forbidden"}   posted from another website
    503 {ok:false, error}               not configured / storage down
  Silent drops (200 ok:true with a throwaway id, nothing saved, no email):
    website (honeypot) not empty, or 0 <= now - ts_open < 1500 ms.
  A JSON post with no ts_open is refused (400).
  A plain HTML form post (no JavaScript) to the same URL also works and gets a
  small branded result page; ts_open is optional there.
