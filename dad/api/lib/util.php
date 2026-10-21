<?php
// Small shared helpers: escaping, tokens, IP hashing, string cleaning, HTTP output.
declare(strict_types=1);
defined('SITE_API') || exit;

function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

/** Random hex token. 16 bytes = 32 hex chars = 128 bits. */
function tok(int $bytes = 16): string { return bin2hex(random_bytes($bytes)); }

/** Public id / referral code: 10 chars, no look-alike characters (31^10, about 8e14). */
function new_pid(): string {
  $a = 'abcdefghjkmnpqrstuvwxyz23456789';
  $n = strlen($a);
  $s = '';
  for ($i = 0; $i < 10; $i++) $s .= $a[random_int(0, $n - 1)];
  return $s;
}

function now_ms(): int { return (int)floor(microtime(true) * 1000); }

function is_https(): bool {
  if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') return true;
  if ((string)($_SERVER['SERVER_PORT'] ?? '') === '443') return true;
  return strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

/** The connecting address. X-Forwarded-For is ignored on purpose: anyone can forge it. */
function client_ip(): string { return (string)($_SERVER['REMOTE_ADDR'] ?? ''); }

/**
 * Salted SHA-256 of the client address. The raw IP is never stored.
 * IPv6 is reduced to its /64 (one household or phone usually owns a whole /64);
 * IPv4-mapped IPv6 (::ffff:1.2.3.4) is treated as plain IPv4.
 */
function ip_hash(): string {
  $ip = strtolower(client_ip());
  if (str_starts_with($ip, '::ffff:') && filter_var(substr($ip, 7), FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
    $ip = substr($ip, 7);
  } elseif (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
    $bin = @inet_pton($ip);
    if ($bin !== false && strlen($bin) === 16) $ip = inet_ntop(substr($bin, 0, 8) . str_repeat("\0", 8)) . '/64';
  }
  return hash('sha256', ip_salt() . '|' . $ip);
}

/** Single line of text: valid UTF-8, no control characters, whitespace collapsed, trimmed. */
function clean_line($v): string {
  if (!is_string($v) && !is_int($v) && !is_float($v)) return '';
  $s = (string)$v;
  if (!mb_check_encoding($s, 'UTF-8')) $s = mb_convert_encoding($s, 'UTF-8', 'UTF-8');
  $s = (string)preg_replace('/[\x{0000}-\x{001F}\x{007F}-\x{009F}\x{200B}-\x{200F}\x{2028}-\x{202E}\x{2060}-\x{2064}\x{FEFF}]+/u', ' ', $s);
  $s = (string)preg_replace('/\s+/u', ' ', $s);
  return trim($s);
}

/** Multi-line text (messages): keeps line breaks, drops other control characters. */
function clean_text($v): string {
  if (!is_string($v) && !is_int($v) && !is_float($v)) return '';
  $s = (string)$v;
  if (!mb_check_encoding($s, 'UTF-8')) $s = mb_convert_encoding($s, 'UTF-8', 'UTF-8');
  $s = str_replace(["\r\n", "\r"], "\n", $s);
  $s = (string)preg_replace('/[\x{0000}-\x{0008}\x{000B}-\x{001F}\x{007F}-\x{009F}\x{200B}-\x{200F}\x{2028}-\x{202E}\x{2060}-\x{2064}\x{FEFF}]+/u', '', $s);
  $s = (string)preg_replace("/\n{4,}/", "\n\n\n", $s);
  return trim($s);
}

function clamp_str(string $s, int $max): string { return mb_strlen($s) > $max ? mb_substr($s, 0, $max) : $s; }

/** Escape % and _ for a LIKE pattern used with ESCAPE '\'. */
function like_escape(string $s): string { return strtr($s, ['\\' => '\\\\', '%' => '\\%', '_' => '\\_']); }

/** Same-origin path only (for "back" links). Anything else becomes "/". */
function safe_path($p): string {
  $p = clean_line($p);
  if ($p === '' || $p[0] !== '/' || str_starts_with($p, '//') || str_contains($p, '\\')) return '/';
  return clamp_str($p, 300);
}

function fmt_time(int $t): string { return date('M j, Y g:i A', $t); }

function ago(int $t): string {
  $d = time() - $t;
  if ($d < 45) return 'just now';
  if ($d < 3600) return (int)round($d / 60) . ' min ago';
  if ($d < 86400) return (int)round($d / 3600) . ' h ago';
  if ($d < 86400 * 7) return (int)round($d / 86400) . ' d ago';
  return date('M j', $t);
}

/** Domain part of an address, for Message-ID headers. */
function mail_domain(string $addr): string {
  $p = strrpos($addr, '@');
  return $p === false ? 'dynamicaid.org' : substr($addr, $p + 1);
}

/** Emails to these domains are saved but never sent anything (testing). */
function is_quiet(?string $email): bool {
  if (!$email) return false;
  $email = strtolower($email);
  foreach (SITE_QUIET_DOMAINS as $d) {
    if (str_ends_with($email, '@' . strtolower((string)$d))) return true;
  }
  return false;
}

/** Common response headers for every API response. */
function base_headers(): void {
  header('X-Content-Type-Options: nosniff');
  header('Referrer-Policy: same-origin');
  header('X-Robots-Tag: noindex, nofollow');
  header('Cache-Control: no-store, max-age=0');
}

/**
 * Send a JSON response and close the connection to the browser where the server allows it,
 * so slow work (sending email) can continue after the visitor already has an answer.
 * Does NOT exit; callers exit when they are done.
 */
function send_json(int $status, array $data, array $extraHeaders = []): void {
  $body = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  if ($body === false) $body = '{"ok":false,"error":"Server error"}';
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  foreach ($extraHeaders as $hd) header($hd);
  header('Content-Length: ' . strlen($body));
  echo $body;
  finish_response();
}

function finish_response(): void {
  if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); return; }
  if (function_exists('litespeed_finish_request')) { litespeed_finish_request(); return; }
  while (ob_get_level() > 0) @ob_end_flush();
  @flush();
}

/** JSON response, then stop. */
function json_exit(int $status, array $data, array $extraHeaders = []): void {
  send_json($status, $data, $extraHeaders);
  exit;
}
