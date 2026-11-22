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
  // Rollback journal, not WAL: site.sqlite stays one self-contained file, so copying it is a backup.
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
    $ver = 2;
  }
  if ($ver < 3) {
    // v3: opt-outs outlive the record they came from (a salted email hash, never the address),
    // and a re-subscribe stays pending until the person clicks the link emailed to them.
    // Concurrent first requests can each get here, and an earlier step may even lower user_version
    // again, so take turns and test for the column itself rather than trusting the version.
    $pdo->exec('BEGIN IMMEDIATE');
    try {
      $pdo->exec('CREATE TABLE IF NOT EXISTS suppressions(email_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL)');
      $cols = $pdo->query("SELECT name FROM pragma_table_info('submissions')")->fetchAll(PDO::FETCH_COLUMN);
      if (!in_array('resub_token', $cols, true)) $pdo->exec('ALTER TABLE submissions ADD COLUMN resub_token TEXT');
      $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS submissions_resub_token ON submissions(resub_token) WHERE resub_token IS NOT NULL');
      $pdo->exec('PRAGMA user_version = 3');
      $pdo->exec('COMMIT');
    } catch (Throwable $e) {
      $pdo->exec('ROLLBACK');
      throw $e;
    }
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

/** Salted hash that identifies an opted-out address without keeping it. */
function suppression_hash(string $email): string {
  return hash('sha256', ip_salt() . '|suppress|' . strtolower(trim($email)));
}

function is_suppressed(?string $email): bool {
  if (!$email) return false;
  return q('SELECT 1 FROM suppressions WHERE email_hash = ?', [suppression_hash($email)])->fetchColumn() !== false;
}

function suppress_email(string $email): void {
  q('INSERT OR IGNORE INTO suppressions(email_hash, created_at) VALUES(?, ?)', [suppression_hash($email), time()]);
}

function unsuppress_email(string $email): void {
  q('DELETE FROM suppressions WHERE email_hash = ?', [suppression_hash($email)]);
}

/** Unsubscribes the row's address from every mailing list (or just that row when it has no email). */
function unsubscribe_all(array $row): void {
  $now = time();
  if (!empty($row['email'])) {
    q("UPDATE submissions SET unsubscribed_at = ?, updated_at = ?
         WHERE email = ? AND type IN ('founding','updates') AND unsubscribed_at IS NULL", [$now, $now, $row['email']]);
  } else {
    q('UPDATE submissions SET unsubscribed_at = ?, updated_at = ? WHERE id = ? AND unsubscribed_at IS NULL', [$now, $now, $row['id']]);
  }
}

/** Undoes unsubscribe_all: restores only the rows that one unsubscribe switched off (same timestamp). */
function resubscribe_all(array $row): void {
  if ($row['unsubscribed_at'] === null) return;
  $now = time();
  if (!empty($row['email'])) {
    q("UPDATE submissions SET unsubscribed_at = NULL, updated_at = ?
         WHERE email = ? AND type IN ('founding','updates') AND unsubscribed_at = ?", [$now, $row['email'], $row['unsubscribed_at']]);
  } else {
    q('UPDATE submissions SET unsubscribed_at = NULL, updated_at = ? WHERE id = ?', [$now, $row['id']]);
  }
}

/**
 * Sliding-window counter. Records one hit for $key and returns how many hits $key has in the
 * last $window seconds (including this one). Rows past their retention are pruned when a hit is recorded.
 */
function hit_count(string $key, int $window, bool $record = true): int {
  if ($window > HITS_RETENTION) throw new InvalidArgumentException('window exceeds HITS_RETENTION');
  $now = time();
  if ($record) {
    q('DELETE FROM hits WHERE ts < ?', [$now - HITS_RETENTION]);
    q('DELETE FROM mail_log WHERE ts < ?', [$now - MAIL_LOG_RETENTION]);
    q('INSERT INTO hits(k, ts) VALUES(?, ?)', [$key, $now]);
  }
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
