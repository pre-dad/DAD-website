<?php
// Outbound email: an SMTP relay (Amazon SES) when SITE_SMTP_HOST is set, otherwise PHP mail().
// Every send is logged to mail_log.
declare(strict_types=1);
defined('SITE_API') || exit;

/** RFC 2047 encode a display name or subject only when it needs it. */
function mime_header(string $s): string {
  $s = trim((string)preg_replace('/[\r\n\t]+/', ' ', $s));
  if (preg_match('/^[\x20-\x7E]*$/', $s)) return $s;
  return mb_encode_mimeheader($s, 'UTF-8', 'B', "\r\n");
}

function mime_address(string $name, string $addr): string {
  $name = trim((string)preg_replace('/[\r\n\t"\\\\<>]+/', ' ', $name));
  if ($name === '') return $addr;
  if (preg_match('/^[A-Za-z0-9 ]+$/', $name)) return $name . ' <' . $addr . '>';
  if (preg_match('/^[\x20-\x7E]+$/', $name)) return '"' . $name . '" <' . $addr . '>';
  return mb_encode_mimeheader($name, 'UTF-8', 'B', "\r\n") . ' <' . $addr . '>';
}

function addr_ok(string $a): bool {
  return $a !== '' && !preg_match('/[\r\n]/', $a) && filter_var($a, FILTER_VALIDATE_EMAIL) !== false;
}

/**
 * Minimal SMTP client (PHP core only, no Composer/PHPMailer) for an SES-style relay.
 * Sends the already-assembled message ($data = headers + blank line + body) over
 * EHLO / optional STARTTLS / AUTH LOGIN / MAIL FROM / RCPT TO / DATA. The envelope
 * sender is $from (the same address the mail() path passes via -f).
 * Returns true only on the 250 that follows end-of-data. Any error returns false
 * (never throws). NEVER logs the password, the AUTH tokens, or the email addresses.
 */
function smtp_send(string $host, int $port, string $secure, string $user, string $pass, string $from, string $to, string $data): bool {
  $fp = @stream_socket_client("tcp://$host:$port", $errno, $errstr, 15, STREAM_CLIENT_CONNECT);
  if (!$fp) return false;
  stream_set_timeout($fp, 15);

  // Read one SMTP reply, following multi-line continuations ("250-..." lines until a "250 " line).
  // Returns the leading 3-digit status code, or 0 on timeout/EOF/parse failure.
  $read = static function () use ($fp): int {
    $code = 0;
    while (($line = fgets($fp, 2048)) !== false) {
      $m = stream_get_meta_data($fp);
      if (!empty($m['timed_out'])) return 0;
      if (strlen($line) >= 3 && ctype_digit(substr($line, 0, 3))) {
        $code = (int)substr($line, 0, 3);
      }
      // A 4th char of '-' means the reply continues; a space (or no 4th char) ends it.
      if (strlen($line) < 4 || $line[3] !== '-') return $code;
    }
    return 0;
  };
  // Write one command line with CRLF.
  $write = static function (string $line) use ($fp): void {
    @fwrite($fp, $line . "\r\n");
  };

  $ok = false;
  try {
    if ($read() !== 220) { @fclose($fp); return false; }               // greeting

    $clientHost = mail_domain($from);
    if ($clientHost === '') $clientHost = 'localhost';

    $write('EHLO ' . $clientHost);
    if ($read() !== 250) { @fclose($fp); return false; }

    if (strtolower($secure) === 'tls') {
      $write('STARTTLS');
      if ($read() !== 220) { @fclose($fp); return false; }
      $crypto = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
      if (@stream_socket_enable_crypto($fp, true, $crypto) !== true) { @fclose($fp); return false; }
      $write('EHLO ' . $clientHost);                                    // re-EHLO after the TLS upgrade
      if ($read() !== 250) { @fclose($fp); return false; }
    }

    $write('AUTH LOGIN');
    if ($read() !== 334) { @fclose($fp); return false; }
    $write(base64_encode($user));
    if ($read() !== 334) { @fclose($fp); return false; }
    $write(base64_encode($pass));
    if ($read() !== 235) { @fclose($fp); return false; }

    $write('MAIL FROM:<' . $from . '>');
    if ($read() !== 250) { @fclose($fp); return false; }
    $write('RCPT TO:<' . $to . '>');
    $rc = $read();
    if ($rc !== 250 && $rc !== 251) { @fclose($fp); return false; }
    $write('DATA');
    if ($read() !== 354) { @fclose($fp); return false; }

    // Emit the message with CRLF wire endings and dot-stuffing, then end with CRLF.CRLF.
    foreach (preg_split('/\r\n|\r|\n/', $data) as $line) {
      if ($line !== '' && $line[0] === '.') $line = '.' . $line;       // dot-stuff leading dots
      @fwrite($fp, $line . "\r\n");
    }
    @fwrite($fp, ".\r\n");
    $ok = ($read() === 250);                                            // the 250 after end-of-data is authoritative

    $write('QUIT');
    $read();
  } catch (Throwable $e) {
    $ok = false;
  }
  @fclose($fp);
  return $ok;
}

/**
 * Send one email. $html optional (multipart/alternative when given).
 * $o: from, from_name, reply_to, unsubscribe (URL, adds List-Unsubscribe + one-click), kind (mail_log label)
 */
function send_mail(string $to, string $subject, string $text, ?string $html = null, array $o = []): bool {
  $from     = (string)($o['from'] ?? SITE_NOTIFY_FROM);
  $fromName = (string)($o['from_name'] ?? SITE_NOTIFY_FROM_NAME);
  $replyTo  = (string)($o['reply_to'] ?? '');
  $kind     = (string)($o['kind'] ?? 'mail');
  if (!addr_ok($to) || !addr_ok($from) || ($replyTo !== '' && !addr_ok($replyTo))) { mail_log($kind, false); return false; }

  $eol = "\r\n";
  $hdr = [];
  $hdr[] = 'From: ' . mime_address($fromName, $from);
  if ($replyTo !== '') $hdr[] = 'Reply-To: ' . $replyTo;
  $hdr[] = 'Date: ' . date('r');
  $hdr[] = 'Message-ID: <' . tok(12) . '@' . mail_domain($from) . '>';
  $hdr[] = 'MIME-Version: 1.0';
  if (!empty($o['unsubscribe'])) {
    $u = (string)$o['unsubscribe'];
    if (!preg_match('/[\r\n<>]/', $u)) {
      $hdr[] = 'List-Unsubscribe: <' . $u . '>, <mailto:' . SITE_MAIL_REPLY_TO . '?subject=unsubscribe>';
      $hdr[] = 'List-Unsubscribe-Post: List-Unsubscribe=One-Click';
    }
  }
  if (!empty($o['auto'])) $hdr[] = 'Auto-Submitted: auto-generated';

  $text = str_replace(["\r\n", "\r"], "\n", $text);
  if ($html === null) {
    $hdr[] = 'Content-Type: text/plain; charset=UTF-8';
    $hdr[] = 'Content-Transfer-Encoding: quoted-printable';
    $body = quoted_printable_encode(str_replace("\n", "\r\n", $text));
  } else {
    $b = 'dad-' . tok(12);
    $hdr[] = 'Content-Type: multipart/alternative; boundary="' . $b . '"';
    $body = 'This is a multi-part message in MIME format.' . $eol . $eol
      . '--' . $b . $eol
      . 'Content-Type: text/plain; charset=UTF-8' . $eol
      . 'Content-Transfer-Encoding: quoted-printable' . $eol . $eol
      . quoted_printable_encode(str_replace("\n", "\r\n", $text)) . $eol . $eol
      . '--' . $b . $eol
      . 'Content-Type: text/html; charset=UTF-8' . $eol
      . 'Content-Transfer-Encoding: quoted-printable' . $eol . $eol
      . quoted_printable_encode(str_replace(["\r\n", "\r", "\n"], "\r\n", $html)) . $eol . $eol
      . '--' . $b . '--' . $eol;
  }

  $smtpHost = defined('SITE_SMTP_HOST') ? (string)SITE_SMTP_HOST : '';
  $ok = false;
  if ($smtpHost !== '') {
    // mail() takes the subject as its own argument, so it is not in $hdr.
    $message = 'Subject: ' . mime_header($subject) . $eol . implode($eol, $hdr) . $eol . $eol . $body;
    $ok = smtp_send(
      $smtpHost,
      (int)(defined('SITE_SMTP_PORT') ? SITE_SMTP_PORT : 587),
      (string)(defined('SITE_SMTP_SECURE') ? SITE_SMTP_SECURE : 'tls'),
      (string)(defined('SITE_SMTP_USER') ? SITE_SMTP_USER : ''),
      (string)(defined('SITE_SMTP_PASS') ? SITE_SMTP_PASS : ''),
      $from, $to, $message
    );
  } else {
    try {
      $ok = @mail($to, mime_header($subject), $body, implode($eol, $hdr), '-f' . $from);
    } catch (Throwable $e) {
      $ok = false;
    }
  }
  mail_log($kind, (bool)$ok);
  return (bool)$ok;
}

/** Plain-text note to the team. */
function notify_team(string $subject, string $body, string $replyTo = ''): bool {
  return send_mail(SITE_NOTIFY_TO, $subject, $body, null, [
    'from' => SITE_NOTIFY_FROM, 'from_name' => SITE_NOTIFY_FROM_NAME,
    'reply_to' => $replyTo, 'kind' => 'notify', 'auto' => true,
  ]);
}

function unsubscribe_url(string $token): string {
  return rtrim(SITE_BASE, '/') . '/api/unsubscribe.php?t=' . rawurlencode($token);
}

function referral_url(string $pid): string {
  return rtrim(SITE_BASE, '/') . '/?ref=' . rawurlencode($pid);
}

/**
 * Founding Donor confirmation. The wording lives in lib/emails.php (defaults) and in the dashboard's
 * Emails page (overrides); the Unsubscribe link and the one-click header are always added here.
 * Returns [subject, text, html].
 */
function founding_email(string $firstName, string $unsubUrl, string $refUrl = ''): array {
  $r = email_render_confirm('confirm_founding', ['first_name' => $firstName, 'referral_link' => $refUrl !== '' ? $refUrl : rtrim(SITE_BASE, '/') . '/'],
    ['unsubscribe' => $unsubUrl]);
  return [$r['subject'], $r['text'], $r['html']];
}

/** True when the hourly cap on confirmation emails is reached (logs the hold-back). */
function confirm_capped(): bool {
  if (mail_count('confirm', 3600) < SITE_MAX_CONFIRMATIONS_PER_HOUR) return false;
  mail_log('confirm_capped', false);
  return true;
}

/** Sends the Founding Donor confirmation, respecting the quiet list and the hourly cap. */
function send_founding_confirmation(string $email, string $firstName, string $token, string $pid = ''): bool {
  if (is_quiet($email)) return false;
  if (confirm_capped()) return false;
  [$subject, $text, $html] = founding_email($firstName, unsubscribe_url($token), $pid !== '' ? referral_url($pid) : '');
  return send_mail($email, $subject, $text, $html, [
    'from' => SITE_MAIL_FROM, 'from_name' => SITE_MAIL_FROM_NAME, 'reply_to' => SITE_MAIL_REPLY_TO,
    'unsubscribe' => unsubscribe_url($token), 'kind' => 'confirm',
  ]);
}

/** Footer line on the partner confirmation (it is a one-off reply, not a mailing list). */
const PARTNER_EMAIL_FOOTER = 'You got this because you sent the "Partner with us" form on dynamicaid.org. It is a one-time reply: you are not on any list.';

/** Sends the short confirmation to someone who sent the Partner form. Same quiet list and cap. */
function send_partner_confirmation(string $email, string $name, string $company): bool {
  if (is_quiet($email)) return false;
  if (confirm_capped()) return false;
  $r = email_render_confirm('confirm_partner', ['first_name' => first_word($name), 'name' => $name, 'company' => $company],
    ['footer' => PARTNER_EMAIL_FOOTER]);
  return send_mail($email, $r['subject'], $r['text'], $r['html'], [
    'from' => SITE_MAIL_FROM, 'from_name' => SITE_MAIL_FROM_NAME, 'reply_to' => SITE_MAIL_REPLY_TO,
    'kind' => 'confirm', 'auto' => true,
  ]);
}
