DAD WEBSITE FORMS API
=====================
PHP 8 + SQLite backend for every form on dynamicaid.org (Founding Donor waitlist,
build updates, get support, volunteer, contact, partner). It runs under Apache on
the AWS Lightsail boxes and sends email through Amazon SES. To run it locally, see
"Run it locally" in the repo's README.md.


WHAT IS WHERE (on the server)
-----------------------------
  /api/submit.php          every form posts here (JSON in, JSON out)
  /api/unsubscribe.php     one-click unsubscribe link used in emails
  /api/donor.php           retired (410); never returns donor information
  /api/health.php          {"ok":true} when config + database are working
  /api/admin/              private dashboard (password)
  /api/config.php          settings. A symlink to /var/www/shared/config.php, which
                           lives outside the deployed tree. Web access blocked.
  /api/lib/                helpers. Web access blocked.
  SITE_DATA_DIR            the data folder: /var/dad-data on the boxes, outside the
                           deployed tree so no deploy can touch it. Holds
                           site.sqlite and, optionally, stripe.key. A relative name
                           (e.g. dad-site-data-1a2b3c4d5e6f7a8b) also works: the
                           folder is then created beside /api and locked with
                           "Require all denied".


FIRST-TIME SETUP: CREATE config.php
-----------------------------------
1. On the box, copy api/config.sample.php to /var/www/shared/config.php
   (deploy/README.md has the permissions). It is never committed.

2. Set SITE_DATA_DIR to the data folder ('/var/dad-data' on the boxes), SITE_BASE
   to the site's URL, and the SES SMTP settings (SITE_SMTP_*).

3. Make a one-time setup key. Give the KEY to Chris privately; put only its
   HASH in SITE_SETUP_KEY_SHA256. Never write the key itself down anywhere else.
     openssl rand -hex 24
     printf '%s' 'PASTE-THE-KEY' | shasum -a 256

4. Check SITE_NOTIFY_TO (default chris@dynamicaid.org) and SITE_MAIL_FROM
   (default hello@dynamicaid.org). hello@ must be a real mailbox: donors will
   reply to the confirmation email.

config.php is read on every request, so edits take effect at once: no deploy.


DEPLOY
------
  Deploys are automatic: see deploy/README.md. After the first deploy to a box:
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
  Edit SITE_NOTIFY_TO in config.php. To stop alerts for one form type, remove it
  from SITE_NOTIFY_TYPES (it is still saved and shown in the dashboard).


LOST PASSWORD
-------------
  Make a NEW setup key (step 3 above), put its hash in config.php, and open
  https://dynamicaid.org/api/admin/?setup=NEW-KEY. Each key works once; setting a
  new password signs out every old session.


EMAIL DELIVERY
--------------
  Sends through Amazon SES over SMTP (SITE_SMTP_HOST etc. in config.php). With
  SITE_SMTP_HOST blank it falls back to PHP mail().
  - SES needs the dynamicaid.org domain verified (DKIM records in Cloudflare),
    SPF and DMARC records, and production access, or mail stays sandboxed or
    lands in spam.
  - SITE_MAX_CONFIRMATIONS_PER_HOUR (200) caps confirmation emails; anything over
    the cap is still saved and the dashboard shows how many were held back.
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

  BACKUP: site.sqlite is the only copy. Take a consistent copy on the box with
    sqlite3 /var/dad-data/site.sqlite ".backup /tmp/site-backup.sqlite"
  and download that over SFTP now and then.


THE CONTRACT (what the site's JavaScript relies on)
---------------------------------------------------
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
                        Sent from the "Partner with us" modal (js/core/partner-modal.js).
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

DONATION RETURN PRIVACY
-----------------------
The welcome page collects name and email directly; a Checkout Session ID does not
authorize a public lookup. The retired donor endpoint always answers 410 with
{"ok":false}, without contacting Stripe or reading configuration. The welcome page
uses no-referrer and removes session_id from its URL after capturing it for form
submission. Server-side receipt metadata is attached only when the submitted email
matches Stripe's billing email; this is not account verification.
