<?php
// SQLite storage. One file in the data folder; schema created on first use.
declare(strict_types=1);
defined('SITE_API') || exit;

function db(): PDO {
  static $pdo = null;
  if ($pdo instanceof PDO) return $pdo;
  $pdo = new PDO('sqlite:' . site_data_dir() . '/site.sqlite', null, null, [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  // Rollback journal (not WAL): shared hosting storage may be a network filesystem.
  $pdo->exec('PRAGMA busy_timeout = 5000');
  $ver = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
  if ($ver < 1) {
    $pdo->exec("
      CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS submissions(
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        pid             TEXT NOT NULL UNIQUE,     -- public id, returned to the browser and used as the referral code
        type            TEXT NOT NULL,            -- founding | updates | support | volunteer | contact | partner
        email           TEXT,                     -- lowercased copy of fields.email, for dedupe and search
        fields          TEXT NOT NULL,            -- JSON of the validated form fields
        page            TEXT,                     -- path the form was sent from
        ref             TEXT,                     -- referral code it arrived with (pid of another submission)
        ip_hash         TEXT,                     -- salted sha256, never the raw IP
        ua              TEXT,
        unsub_token     TEXT UNIQUE,              -- mailing-list rows only
        unsubscribed_at INTEGER,
        handled_at      INTEGER,
        repeat_count    INTEGER NOT NULL DEFAULT 0, -- times the same email signed up again
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS submissions_type_created ON submissions(type, created_at);
      CREATE INDEX IF NOT EXISTS submissions_created ON submissions(created_at);
      CREATE INDEX IF NOT EXISTS submissions_email ON submissions(email);
      CREATE INDEX IF NOT EXISTS submissions_ref ON submissions(ref);
      CREATE UNIQUE INDEX IF NOT EXISTS submissions_list_email ON submissions(type, email)
        WHERE type IN ('founding','updates') AND email IS NOT NULL;
      CREATE TABLE IF NOT EXISTS hits(k TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS hits_k_ts ON hits(k, ts);
      CREATE INDEX IF NOT EXISTS hits_ts ON hits(ts);
      CREATE TABLE IF NOT EXISTS mail_log(ts INTEGER NOT NULL, kind TEXT NOT NULL, ok INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS mail_log_kind_ts ON mail_log(kind, ts);
    ");
    $pdo->exec('PRAGMA user_version = 1');
    $ver = 1;
  }
  if ($ver < 2) {
    // v2: wording overrides for the automatic emails, edited on the dashboard's Emails page.
    // One row per email (key from email_defs()); no row = the built-in default wording.
    $pdo->exec("
      CREATE TABLE IF NOT EXISTS email_templates(
        k          TEXT PRIMARY KEY,
        data       TEXT NOT NULL,                 -- JSON: {subject, greeting?, body, closer?, signature?}
        updated_at INTEGER NOT NULL
      );
    ");
    $pdo->exec('PRAGMA user_version = 2');
  }
  return $pdo;
}

function q(string $sql, array $args = []): PDOStatement {
  $st = db()->prepare($sql);
  $st->execute($args);
  return $st;
}

function setting(string $k): ?string {
  $r = q('SELECT v FROM settings WHERE k = ?', [$k])->fetch();
  return $r ? (string)$r['v'] : null;
}

function set_setting(string $k, ?string $v): void {
  if ($v === null) { q('DELETE FROM settings WHERE k = ?', [$k]); return; }
  q('INSERT INTO settings(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [$k, $v]);
}

/** Per-install secret salt for IP hashes. Generated on the server, never leaves the database. */
function ip_salt(): string {
  static $salt = null;
  if ($salt !== null) return $salt;
  $salt = setting('ip_salt');
  if ($salt === null) {
    q('INSERT OR IGNORE INTO settings(k, v) VALUES(?, ?)', ['ip_salt', tok(32)]);   // first run only
    $salt = (string)setting('ip_salt');
  }
  return $salt;
}

/**
 * Sliding-window counter. Records one hit for $key and returns how many hits $key has in the
 * last $window seconds (including this one). Old rows are pruned as we go.
 */
function hit_count(string $key, int $window, bool $record = true): int {
  $now = time();
  q('DELETE FROM hits WHERE ts < ?', [$now - 7200]);
  if ($record) q('INSERT INTO hits(k, ts) VALUES(?, ?)', [$key, $now]);
  return (int)q('SELECT COUNT(*) FROM hits WHERE k = ? AND ts > ?', [$key, $now - $window])->fetchColumn();
}

/** Seconds until the oldest hit in the window expires (for Retry-After). */
function hit_retry_after(string $key, int $window): int {
  $oldest = (int)q('SELECT MIN(ts) FROM hits WHERE k = ? AND ts > ?', [$key, time() - $window])->fetchColumn();
  return $oldest ? max(1, $oldest + $window - time()) : $window;
}

function mail_log(string $kind, bool $ok): void {
  try { q('INSERT INTO mail_log(ts, kind, ok) VALUES(?, ?, ?)', [time(), $kind, $ok ? 1 : 0]); } catch (Throwable $e) { /* logging must never break a request */ }
}

function mail_count(string $kind, int $window): int {
  return (int)q('SELECT COUNT(*) FROM mail_log WHERE kind = ? AND ts > ?', [$kind, time() - $window])->fetchColumn();
}

function decode_fields(?string $json): array {
  $a = json_decode((string)$json, true);
  return is_array($a) ? $a : [];
}
