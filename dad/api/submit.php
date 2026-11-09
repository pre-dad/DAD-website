<?php
// POST /api/submit.php  -  every form on dynamicaid.org posts here.
//
// Request (JSON):  {type, first_name?, name?, email?, phone?, zip?, city?, topic?, message?, company?, note?, ref?, page,
//                   website:"" (honeypot), ts_open:<ms epoch when the form rendered>}
// Responses:       200 {ok:true, id, type}
//                  400 {ok:false, error:"<human message>", field?:"email"}
//                  429 {ok:false, error:"Too many requests"}
//                  403 / 405 / 503 {ok:false, error}  (wrong origin, wrong method, server not ready)
//
// A plain HTML form post (no JavaScript) is also accepted and answered with a small HTML page.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/stripe.php';

ignore_user_abort(true);
base_headers();

$ctype  = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
$isForm = str_starts_with($ctype, 'application/x-www-form-urlencoded') || str_starts_with($ctype, 'multipart/form-data');

/** Answer in JSON, or as a small page for no-JS form posts. Exits. */
function reply(int $status, array $data, array $headers = []): void {
  global $isForm, $page;
  if (!$isForm) json_exit($status, $data, $headers);
  foreach ($headers as $hd) header($hd);
  $back = safe_path($page ?? '/');
  if (!empty($data['ok'])) {
    ui_card_page('DAD', result_html((string)($data['type'] ?? ''), (string)($data['id'] ?? ''), $back), 200);
  } else {
    ui_card_page('DAD', ui_logo() . '<h1>' . h($data['error'] ?? MSG_GENERIC) . '</h1>'
      . '<div class="acts"><a class="btn" href="' . h($back) . '"><span class="arr">&larr;</span> Go back</a></div>', $status);
  }
  finish_response();
  exit;
}

/** Success copy for the no-JS result page; same wording as SUCCESS in js/core/forms.js. */
function result_html(string $type, string $id, string $back): string {
  $logo = ui_logo();
  $home = '<div class="acts"><a class="btn btn--ghost" href="' . h($back) . '"><span class="arr">&larr;</span> Back to dynamicaid.org</a></div>';
  switch ($type) {
    case 'founding':
      return $logo . '<h1>You\'re a Founding Donor.</h1>'
        . '<p>Permanently. The badge will be on your profile the day the app opens.</p>'
        . '<p>Want to bring someone?</p><span class="code">' . h(referral_url($id)) . '</span>' . $home;
    case 'support':
      return $logo . '<h1>Got it.</h1><p>We\'ll let you know as soon as a program opens near you. Nothing else, nothing more.</p>' . $home;
    case 'volunteer':
      return $logo . '<h1>You\'re on the list.</h1><p>When an Impact Team forms in your city, you\'ll hear from us first.</p>' . $home;
    case 'contact':
      return $logo . '<h1>Message received.</h1><p>A real person from the founding team will reply.</p>' . $home;
    case 'partner':
      return $logo . '<h1>We\'ll be in touch.</h1><p>A real person from the founding team will reply to you directly. Check your inbox for a note from us.</p>' . $home;
    default:
      return $logo . '<h1>You\'re on the list.</h1>' . $home;
  }
}

$page = '/';

// ---- method
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  json_exit(405, ['ok' => false, 'error' => 'Method not allowed'], ['Allow: POST']);
}

// ---- origin: refuse posts made from other websites (the site's own host is always allowed)
$origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '' && $origin !== 'null') {
  $oHost = strtolower((string)parse_url($origin, PHP_URL_HOST));
  $self  = strtolower((string)preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? '')));
  $allowed = $oHost !== '' && $oHost === $self;
  foreach (SITE_ALLOWED_ORIGINS as $a) { if (strcasecmp(rtrim((string)$a, '/'), rtrim($origin, '/')) === 0) $allowed = true; }
  if (!$allowed) reply(403, ['ok' => false, 'error' => 'Forbidden']);
}

// ---- configured?
if (!site_configured()) {
  error_log('[dad-site] submit.php: config.php missing or SITE_DATA_DIR not set');
  reply(503, ['ok' => false, 'error' => "We couldn't save that just now. Please try again in a few minutes."]);
}

// ---- read the body
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 32768) reply(400, ['ok' => false, 'error' => "That's too long to send. Please shorten it."]);
if ($isForm) {
  $in = $_POST;
} else {
  $raw = (string)file_get_contents('php://input', false, null, 0, 32769);
  if (strlen($raw) > 32768) reply(400, ['ok' => false, 'error' => "That's too long to send. Please shorten it."]);
  $in = json_decode($raw, true, 8);
  if (!is_array($in)) reply(400, ['ok' => false, 'error' => MSG_GENERIC]);
}
$page = safe_path($in['page'] ?? '/');

try {
  // ---- rate limit: every post counts, 10 per rolling hour per IP (IPv6 per /64)
  $ipHash = ip_hash();
  if (hit_count('s:' . $ipHash, 3600) > SITE_RATE_LIMIT_PER_HOUR) {
    reply(429, ['ok' => false, 'error' => 'Too many requests'], ['Retry-After: ' . hit_retry_after('s:' . $ipHash, 3600)]);
  }

  // ---- type
  $type = is_string($in['type'] ?? null) ? strtolower(trim($in['type'])) : '';
  if (!in_array($type, SITE_TYPES, true)) reply(400, ['ok' => false, 'error' => MSG_GENERIC]);

  // ---- honeypot: a filled "website" field means a bot. Pretend it worked, store nothing.
  $hp = $in['website'] ?? '';
  if (!is_string($hp) || trim($hp) !== '') reply(200, ['ok' => true, 'id' => new_pid(), 'type' => $type]);

  // ---- minimum fill time. JS posts must carry ts_open; no-JS form posts may not have it.
  $ts = $in['ts_open'] ?? null;
  if ($ts === null || $ts === '') {
    if (!$isForm) reply(400, ['ok' => false, 'error' => MSG_GENERIC]);
  } else {
    if (!is_numeric($ts) || (float)$ts <= 0) reply(400, ['ok' => false, 'error' => MSG_GENERIC]);
    $elapsed = now_ms() - (int)$ts;
    // Negative elapsed means the visitor's clock runs ahead of ours: give them the benefit of the doubt.
    if ($elapsed >= 0 && $elapsed < SITE_MIN_FILL_MS) reply(200, ['ok' => true, 'id' => new_pid(), 'type' => $type]);
  }

  // ---- validate
  $v = validate_submission($type, $in);
  if (!$v['ok']) reply(400, $v);
  $fields = $v['fields'];
  $email  = $v['email'];

  // ---- donor link: the post-donation waitlist page (/give/welcome/) sends the Stripe Checkout Session id.
  // Verified with Stripe when a key is installed; otherwise stored unverified so it can be checked later.
  $donor = null;
  if ($type === 'founding' && valid_session_id($in['session_id'] ?? null)) {
    $donor = donor_from_session((string)$in['session_id'], $fields['email']) ?? ['session' => (string)$in['session_id'], 'verified' => false];
    $fields['donor'] = $donor;
  }

  $ref = is_string($in['ref'] ?? null) ? trim($in['ref']) : '';
  $ref = preg_match('/^[A-Za-z0-9_-]{1,40}$/', $ref) ? strtolower($ref) : null;
  $ua  = clamp_str(clean_line($_SERVER['HTTP_USER_AGENT'] ?? ''), 400);
  $now = time();
  $json = json_encode($fields, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

  // ---- store (BEGIN IMMEDIATE serialises the dedupe check with the insert)
  $pdo = db();
  $pdo->exec('BEGIN IMMEDIATE');
  $isNew = false; $resub = false; $pid = ''; $token = null;
  try {
    $row = null;
    if (in_array($type, SITE_LIST_TYPES, true)) {
      $row = q('SELECT id, pid, unsub_token, unsubscribed_at FROM submissions WHERE type = ? AND email = ?', [$type, $email])->fetch() ?: null;
    }
    if ($row) {
      // Same email joined this list before: one row per person. Keep their original details,
      // unless they had unsubscribed: then this is a fresh opt-in and the new details win.
      $pid = (string)$row['pid'];
      $token = $row['unsub_token'] ?: tok();
      $resub = $row['unsubscribed_at'] !== null;
      if ($resub) {
        q('UPDATE submissions SET fields = ?, page = ?, ip_hash = ?, ua = ?, unsub_token = ?, unsubscribed_at = NULL,
             repeat_count = repeat_count + 1, updated_at = ? WHERE id = ?',
          [$json, $page, $ipHash, $ua, $token, $now, $row['id']]);
      } else {
        q('UPDATE submissions SET repeat_count = repeat_count + 1, unsub_token = ?, updated_at = ?,
             ref = COALESCE(ref, CASE WHEN ? = pid THEN NULL ELSE ? END) WHERE id = ?',
          [$token, $now, $ref, $ref, $row['id']]);
        if ($donor) {   // already on the list, now a donor too: keep their details, add the gift
          $old = decode_fields((string)q('SELECT fields FROM submissions WHERE id = ?', [$row['id']])->fetchColumn());
          if (empty($old['donor']['verified'])) {
            $old['donor'] = $donor;
            q('UPDATE submissions SET fields = ? WHERE id = ?', [json_encode($old, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $row['id']]);
          }
        }
      }
    } else {
      do { $pid = new_pid(); } while (q('SELECT 1 FROM submissions WHERE pid = ?', [$pid])->fetchColumn());
      $token = in_array($type, SITE_LIST_TYPES, true) ? tok() : null;
      q('INSERT INTO submissions(pid, type, email, fields, page, ref, ip_hash, ua, unsub_token, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$pid, $type, $email, $json, $page, $ref, $ipHash, $ua, $token, $now, $now]);
      $isNew = true;
    }
    $pdo->exec('COMMIT');
  } catch (Throwable $e) {
    try { $pdo->exec('ROLLBACK'); } catch (Throwable $e2) { /* already rolled back */ }
    throw $e;
  }
} catch (Throwable $e) {
  error_log('[dad-site] submit.php: ' . $e->getMessage());
  reply(503, ['ok' => false, 'error' => "We couldn't save that just now. Please try again in a few minutes."]);
}

// ---- answer the visitor first, then send email (keeps the form snappy)
if ($isForm) {
  ui_card_page('DAD', result_html($type, $pid, $page), 200);
  finish_response();
} else {
  send_json(200, ['ok' => true, 'id' => $pid, 'type' => $type]);
}

if (!$isNew && !$resub) exit;   // a repeat sign-up: nothing new to tell anyone

try {
  // Confirmation to the person (only these two forms send one; the others answer on screen only)
  if ($type === 'founding' && $email && $token) {
    send_founding_confirmation($email, (string)$fields['first_name'], $token, $pid);
  }
  if ($type === 'partner' && $email && $isNew) {
    send_partner_confirmation($email, (string)$fields['name'], (string)$fields['company']);
  }

  // Note to the team (wording of the subject and an optional top note: dashboard > Emails)
  if (in_array($type, SITE_NOTIFY_TYPES, true) && !is_quiet($email)) {
    $refLine = '';
    if ($ref) {
      $r = q('SELECT type, email, fields FROM submissions WHERE pid = ?', [$ref])->fetch();
      $rf = $r ? decode_fields($r['fields']) : [];
      $refLine = $r ? trim(($rf['first_name'] ?? $rf['name'] ?? '') . ' (' . ($r['email'] ?? '') . ')') : $ref . ' (unknown code)';
    }
    [$subject, $body] = email_render_alert($type, $fields, ['page' => $page, 'pid' => $pid, 'when' => $now, 'ref_line' => $refLine, 'resub' => $resub]);
    notify_team($subject, $body, (in_array($type, ['contact', 'partner'], true) && $email) ? $email : '');
  }
} catch (Throwable $e) {
  error_log('[dad-site] submit.php mail: ' . $e->getMessage());
}
exit;
