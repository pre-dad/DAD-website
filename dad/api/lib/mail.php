<?php
// Email through PHP mail() on IONOS (same route DeckSend uses). Every send is logged to mail_log.
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

  $ok = false;
  try {
    $ok = @mail($to, mime_header($subject), $body, implode($eol, $hdr), '-f' . $from);
  } catch (Throwable $e) {
    $ok = false;
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
