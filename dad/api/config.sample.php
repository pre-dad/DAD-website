<?php
// DAD website forms API: configuration.
//
// HOW TO USE: copy this file to api/config.php IN THE VAULT (05 - DAD/website/api/config.php)
// and fill in the CHANGE-ME values. Keep config.php in the vault so every deploy carries it:
// a mirror deploy with --delete would wipe a config.php that only exists on the server.
//
// Nothing in here is a secret. The setup key itself is never written down here, only its
// SHA-256. The IP-hash salt is generated on the server and lives in the database, not here.
// api/.htaccess blocks web access to this file and to config.php.

defined('SITE_API') || exit;

// Site
const SITE_TZ   = 'America/New_York';
const SITE_BASE = 'https://dynamicaid.org';          // used in links inside emails (unsubscribe, referral, dashboard)

// Data folder. A folder name is created BESIDE /api in the webroot (e.g. /dad-site-data-1a2b3c4d5e6f7a8b/)
// and locked with "Require all denied". An absolute server path also works. It must never sit inside a
// folder that a deploy mirrors with --delete. Make the name unguessable:
//   python3 -c "import secrets; print('dad-site-data-' + secrets.token_hex(8))"
const SITE_DATA_DIR = 'dad-site-data-CHANGE-ME';

// Admin dashboard (/api/admin/). One-time setup link: https://dynamicaid.org/api/admin/?setup=<key>
//   key:  python3 -c "import secrets; print(secrets.token_urlsafe(24))"
//   hash: printf '%s' '<key>' | shasum -a 256
// Paste only the 64-character hash here. Each key works once. To reset a lost password, put the hash
// of a NEW key here, redeploy, and open the new setup link.
const SITE_SETUP_KEY_SHA256 = 'CHANGE-ME';

// Notifications to the team
const SITE_NOTIFY_TO        = 'chris@dynamicaid.org';
const SITE_NOTIFY_TYPES     = ['founding', 'updates', 'support', 'volunteer', 'contact', 'partner'];  // remove a type to stop its emails
const SITE_NOTIFY_FROM      = 'no-reply@dynamicaid.org';
const SITE_NOTIFY_FROM_NAME = 'DAD Website';

// Emails to the public (Founding Donor and Partner confirmations; wording is edited in the dashboard's Emails page)
const SITE_MAIL_FROM      = 'hello@dynamicaid.org';
const SITE_MAIL_FROM_NAME = 'DAD';
const SITE_MAIL_REPLY_TO  = 'hello@dynamicaid.org';

// Abuse limits
const SITE_RATE_LIMIT_PER_HOUR         = 10;    // form posts per IP per rolling hour (IPv6 counted per /64)
const SITE_MIN_FILL_MS                 = 1500;  // posts faster than this after the form rendered are dropped silently
const SITE_MAX_CONFIRMATIONS_PER_HOUR  = 200;   // safety cap on outgoing confirmation emails (rows are still saved)
const SITE_QUIET_DOMAINS               = ['example.com'];   // saved, but no emails of any kind (testing)

// Extra origins allowed to post forms. The site's own host is always allowed.
const SITE_ALLOWED_ORIGINS = ['https://dynamicaid.org', 'https://www.dynamicaid.org'];

// Outbound email transport (optional)
// Leave SITE_SMTP_HOST blank ('') to keep sending through PHP mail() exactly as before.
// Set it to send through an SMTP relay instead (used on AWS with Amazon SES).
//   - SITE_SMTP_HOST region MUST match where SES is set up (us-east-2), e.g. 'email-smtp.us-east-2.amazonaws.com'.
//   - SITE_SMTP_USER / SITE_SMTP_PASS are the SES SMTP credentials generated in the SES console.
//     They are DISTINCT from your AWS access keys: SES creates a separate SMTP username/password pair.
//   - SITE_SMTP_PASS is a SECRET. It belongs ONLY in config.php on the server, NEVER in this sample
//     file and NEVER in git. Leave it blank here.
//   - Port 587 with SITE_SMTP_SECURE = 'tls' uses STARTTLS (the SES submission port).
const SITE_SMTP_HOST   = '';      // e.g. 'email-smtp.us-east-2.amazonaws.com' (blank = use PHP mail())
const SITE_SMTP_PORT   = 587;     // SES SMTP submission port (STARTTLS)
const SITE_SMTP_USER   = '';      // SES SMTP username (from the SES console, NOT an AWS access key)
const SITE_SMTP_PASS   = '';      // SES SMTP password — SECRET: set in server config.php only, never here/git
const SITE_SMTP_SECURE = 'tls';   // 'tls' = STARTTLS on port 587
