<?php
// /api/admin/  -  private dashboard for website form submissions.
//   First run:  /api/admin/?setup=<key>   (key's SHA-256 lives in config.php; each key works once)
//   Then:       password login (session), CSRF on every POST.
//   Shows counts by type, a filterable/searchable table, per-type CSV export, mark handled, delete.
//   ?page=emails: edit the wording of the automatic emails (stored in email_templates, see lib/emails.php).
declare(strict_types=1);
require dirname(__DIR__) . '/lib/bootstrap.php';

$self = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/api/admin/index.php'))), '/') . '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if (!site_configured()) {
  ui_card_page('Site forms | DAD', ui_logo() . '<div class="eb">Site forms</div><h1>Not configured yet.</h1>'
    . '<p>Create <b>api/config.php</b> from <b>config.sample.php</b> and redeploy. See <b>api/README.txt</b>.</p>', 503);
  exit;
}

ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
session_name('dad_site_admin');
session_set_cookie_params(['lifetime' => 0, 'path' => $self, 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
session_start();
if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = tok();

function csrf_ok(): bool { return hash_equals((string)$_SESSION['csrf'], (string)($_POST['csrf'] ?? '')); }
function csrf_field(): string { return '<input type="hidden" name="csrf" value="' . h($_SESSION['csrf']) . '">'; }
function go(string $url): void { header('Location: ' . $url, true, 303); exit; }

try {
  db();
} catch (Throwable $e) {
  error_log('[dad-site] admin: ' . $e->getMessage());
  ui_card_page('Site forms | DAD', ui_logo() . '<h1>Storage unavailable.</h1><p>The data folder could not be opened. Check the server error log.</p>', 503);
  exit;
}

// =====================================================================
// SETUP (one-time link)
// =====================================================================
$setupKey = (string)($_GET['setup'] ?? $_POST['setup'] ?? '');
if ($setupKey !== '') {
  $cfgHash = strtolower((string)SITE_SETUP_KEY_SHA256);
  if (!site_setup_key_ready()) {
    ui_card_page('Setup | DAD', ui_logo() . '<h1>Setup isn\'t ready.</h1><p>Put the SHA-256 of a setup key in <b>config.php</b> first. See <b>api/README.txt</b>.</p>', 403);
    exit;
  }
  if (!hash_equals($cfgHash, hash('sha256', $setupKey))) {
    sleep(1);
    ui_card_page('Setup | DAD', ui_logo() . '<h1>This setup link isn\'t valid.</h1><p>Check that you copied the whole link.</p>', 403);
    exit;
  }
  if (setting('setup_used') === $cfgHash) {
    ui_card_page('Setup | DAD', ui_logo() . '<h1>This setup link has been used.</h1>'
      . '<p>Your password is already set. To reset it, put the hash of a new setup key in config.php, redeploy, and open the new link.</p>'
      . '<div class="acts"><a class="btn" href="' . h($self) . '">Log in <span class="arr">&rarr;</span></a></div>', 410);
    exit;
  }
  $err = '';
  if ($method === 'POST') {
    $a = (string)($_POST['a'] ?? ''); $b = (string)($_POST['b'] ?? '');
    if (!csrf_ok()) $err = 'Your session expired. Please try again.';
    elseif (strlen($a) < 12) $err = 'Use at least 12 characters.';
    elseif (strlen($a) > 200) $err = 'That is too long. Use 200 characters or fewer.';
    elseif ($a !== $b) $err = 'The two passwords do not match.';
    else {
      set_setting('admin_hash', password_hash($a, PASSWORD_DEFAULT));
      set_setting('setup_used', $cfgHash);
      $gen = tok();
      set_setting('admin_gen', $gen);          // signs out any older sessions
      session_regenerate_id(true);
      $_SESSION = ['ok' => 1, 'gen' => $gen, 'seen' => time(), 'csrf' => tok(),
                   'flash' => 'Password saved. Keep it in your password manager.'];
      go($self);
    }
  }
  ui_card_page('Setup | DAD', ui_logo() . '<div class="eb">Site forms</div><h1>Create your password.</h1>'
    . '<p>This password protects the dashboard where website sign-ups and messages arrive.</p>'
    . '<form method="post" action="' . h($self) . '">' . csrf_field()
    . '<input type="hidden" name="setup" value="' . h($setupKey) . '">'
    . '<label for="a">New password</label><input id="a" type="password" name="a" required minlength="12" autocomplete="new-password" autofocus>'
    . '<label for="b">Repeat it</label><input id="b" type="password" name="b" required minlength="12" autocomplete="new-password">'
    . ($err ? '<div class="err" role="alert">' . h($err) . '</div>' : '')
    . '<div class="acts"><button class="btn" type="submit">Save password</button></div></form>'
    . '<p class="fine">At least 12 characters.</p>', $err ? 400 : 200);
  exit;
}

// =====================================================================
// AUTH
// =====================================================================
$hash = setting('admin_hash');
$gen  = setting('admin_gen');
if ($hash && $gen === null) { $gen = tok(); set_setting('admin_gen', $gen); }
$logged = !empty($_SESSION['ok']) && $gen !== null && hash_equals($gen, (string)($_SESSION['gen'] ?? ''))
  && (time() - (int)($_SESSION['seen'] ?? 0)) < 43200;   // 12 h idle timeout
if ($logged) {
  $_SESSION['seen'] = time();
} else {
  unset($_SESSION['ok'], $_SESSION['gen']);
  if (!$hash) {
    ui_card_page('Site forms | DAD', ui_logo() . '<div class="eb">Site forms</div><h1>Not set up yet.</h1><p>Open your setup link to create your password.</p>', 200);
    exit;
  }
  $err = '';
  if ($method === 'POST' && isset($_POST['password'])) {
    $lk = 'l:' . ip_hash();
    if (!csrf_ok()) {
      $err = 'Your session expired. Please try again.';
    } elseif (hit_count($lk, 900, false) >= 10) {
      $err = 'Too many attempts. Try again in 15 minutes.';
    } elseif (password_verify((string)$_POST['password'], $hash)) {
      if (password_needs_rehash($hash, PASSWORD_DEFAULT)) set_setting('admin_hash', password_hash((string)$_POST['password'], PASSWORD_DEFAULT));
      session_regenerate_id(true);
      $_SESSION = ['ok' => 1, 'gen' => (string)$gen, 'seen' => time(), 'csrf' => tok()];
      go($self);
    } else {
      hit_count($lk, 900, true);
      sleep(1);
      $err = 'That password is not right.';
    }
  }
  ui_card_page('Log in | DAD', ui_logo() . '<div class="eb">Site forms</div><h1>Log in</h1>'
    . '<form method="post" action="' . h($self) . '">' . csrf_field()
    . '<label for="pw">Password</label><input id="pw" type="password" name="password" required autocomplete="current-password" autofocus>'
    . ($err ? '<div class="err" role="alert">' . h($err) . '</div>' : '')
    . '<div class="acts"><button class="btn" type="submit">Log in <span class="arr">&rarr;</span></button></div></form>', $err ? 401 : 200);
  exit;
}

// =====================================================================
// FILTERS
// =====================================================================
const PER_PAGE = 50;
const STATUSES = ['open' => 'Open', 'handled' => 'Handled', 'unsubscribed' => 'Unsubscribed'];
const TILE_LABELS = ['founding' => 'Founding Donors', 'updates' => 'Build updates', 'support' => 'Get support', 'volunteer' => 'Volunteers', 'contact' => 'Messages', 'partner' => 'Partners'];

function filters_from(array $src): array {
  $type = (string)($src['type'] ?? '');
  $status = (string)($src['status'] ?? '');
  return [
    'type'   => in_array($type, SITE_TYPES, true) ? $type : '',
    'q'      => clamp_str(clean_line($src['q'] ?? ''), 120),
    'status' => array_key_exists($status, STATUSES) ? $status : '',
    'p'      => max(1, min(100000, (int)($src['p'] ?? 1))),
  ];
}
function qs(array $f, array $over = []): string {
  $f = array_merge($f, $over);
  $out = [];
  foreach (['type', 'q', 'status', 'p'] as $k) {
    if ($k === 'p') { if ((int)$f['p'] > 1) $out['p'] = (int)$f['p']; continue; }
    if ((string)$f[$k] !== '') $out[$k] = (string)$f[$k];
  }
  return $out ? '?' . http_build_query($out) : '';
}
$F = filters_from($_GET);

// =====================================================================
// ACTIONS (POST, CSRF-checked, then redirect back)
// =====================================================================
if ($method === 'POST') {
  if (!csrf_ok()) { http_response_code(400); exit('Your session expired. Go back, refresh the page and try again.'); }
  $act = (string)($_POST['act'] ?? '');
  parse_str((string)($_POST['back'] ?? ''), $backSrc);
  $back = $self . qs(filters_from(is_array($backSrc) ? $backSrc : []));
  $id = (int)($_POST['id'] ?? 0);

  if ($act === 'logout') {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $self, 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
    session_destroy();
    go($self);
  }
  if ($act === 'handle' && $id > 0) {
    q('UPDATE submissions SET handled_at = ? WHERE id = ? AND handled_at IS NULL', [time(), $id]);
    go($back);
  }
  if ($act === 'reopen' && $id > 0) {
    q('UPDATE submissions SET handled_at = NULL WHERE id = ?', [$id]);
    go($back);
  }
  if ($act === 'delete' && $id > 0) {
    q('DELETE FROM submissions WHERE id = ?', [$id]);
    $_SESSION['flash'] = 'Deleted.';
    go($back);
  }
  if ($act === 'delete_email') {
    $em = strtolower(clean_line($_POST['email'] ?? ''));
    if (valid_email($em)) {
      $n = q('DELETE FROM submissions WHERE email = ?', [$em])->rowCount();
      $_SESSION['flash'] = 'Deleted ' . $n . ' record' . ($n === 1 ? '' : 's') . ' for ' . $em . '.';
    }
    go($self);
  }
  if ($act === 'test_notify') {
    $ok = notify_team('DAD website: test notification',
      "This is a test from the website forms dashboard.\n\nIf you can read this, form notifications are working.\n\n" . rtrim(SITE_BASE, '/') . "/api/admin/\n");
    $_SESSION['flash'] = $ok ? 'Test sent to ' . SITE_NOTIFY_TO . '. Check the inbox and the spam folder.' : 'The server refused to send the email.';
    go($back);
  }
  if ($act === 'test_confirm') {
    $first = ucfirst((string)preg_replace('/[^a-z].*$/i', '', strstr(SITE_NOTIFY_TO, '@', true) ?: '')) ?: 'Friend';
    [$subject, $text, $html] = founding_email($first, unsubscribe_url(str_repeat('0', 32)));
    $ok = send_mail(SITE_NOTIFY_TO, $subject, $text, $html, ['from' => SITE_MAIL_FROM, 'from_name' => SITE_MAIL_FROM_NAME,
      'reply_to' => SITE_MAIL_REPLY_TO, 'kind' => 'preview', 'unsubscribe' => unsubscribe_url(str_repeat('0', 32))]);
    $_SESSION['flash'] = $ok ? 'The Founding Donor email was sent to ' . SITE_NOTIFY_TO . ' as a preview.' : 'The server refused to send the email.';
    go($back);
  }
  // ---- Emails page: save / preview / send me a test / reset (one email at a time)
  if (str_starts_with($act, 'email_')) {
    $key = (string)($_POST['key'] ?? '');
    $defs = email_defs();
    if (!isset($defs[$key])) go($self . '?page=emails');
    $url = $self . '?page=emails&e=' . rawurlencode($key);
    if ($act === 'email_reset') {
      email_reset($key);
      $_SESSION['flash'] = 'Back to the default wording.';
      go($url);
    }
    [$tpl, $err] = email_clean_input($key, $_POST);
    $msg = '';
    if ($act === 'email_save' && $err === '') {
      email_save($key, $tpl);
      $_SESSION['flash'] = 'Saved. From now on, this is the wording people get.';
      go($url);
    }
    if ($act === 'email_test' && $err === '') {
      $ok = email_send_test($key, $tpl);
      $msg = $ok ? 'Test sent to ' . SITE_NOTIFY_TO . ', with made-up details (Jordan Lee, Northwind Foods). Check the inbox and the spam folder.'
                 : 'The server refused to send the email.';
    }
    if ($act === 'email_preview' && $err === '') $msg = 'Preview updated below.';
    admin_out('Emails | DAD', email_editor_body($key, $tpl, $msg, $err), 'emails', $err !== '' ? 400 : 200);
    exit;
  }
  go($back);
}

// =====================================================================
// EMAILS PAGE (?page=emails, ?page=emails&e=<key>)
// =====================================================================
if (($_GET['page'] ?? '') === 'emails') {
  $flash = (string)($_SESSION['flash'] ?? '');
  unset($_SESSION['flash']);
  $key = (string)($_GET['e'] ?? '');
  if ($key !== '' && isset(email_defs()[$key])) admin_out('Emails | DAD', email_editor_body($key, email_template($key), $flash, ''), 'emails');
  else admin_out('Emails | DAD', emails_list_body($flash), 'emails');
  exit;
}

/** The list of every automatic email, grouped: to the public, then to the team. */
function emails_list_body(string $flash): string {
  global $self;
  $groups = [
    'confirm' => ['Sent to people who fill in a form', 'Only the Founding Donor and Partner forms send one. The other forms answer on the screen only.'],
    'alert'   => ['Sent to you (team alerts)', 'One plain email to ' . SITE_NOTIFY_TO . ' for each new submission.'],
  ];
  $out = '<div class="head"><h1>Emails</h1><p class="sub">The emails the website sends by itself. Change the words here; the design, '
    . 'the logo and the unsubscribe link stay the same. Nothing changes until you press Save.</p></div>'
    . ($flash ? '<p class="flash" role="status">' . h($flash) . '</p>' : '');
  foreach ($groups as $g => [$title, $sub]) {
    $cards = '';
    foreach (email_defs() as $key => $d) {
      if ($d['group'] !== $g) continue;
      $at = email_saved_at($key);
      $cards .= '<a class="ecard" href="' . h($self . '?page=emails&e=' . rawurlencode($key)) . '"><b>' . h($d['title']) . '</b>'
        . '<span class="mut">' . h($d['when']) . '</span>'
        . ($at ? '<span class="pill edited">Edited ' . h(date('M j', $at)) . '</span>' : '<span class="pill default">Default wording</span>') . '</a>';
    }
    $out .= '<section class="egroup"><h2>' . h($title) . '</h2><p>' . h($sub) . '</p><div class="ecards">' . $cards . '</div></section>';
  }
  return $out;
}

/** Editor for one email: the fields, placeholders beside them, and a rendered preview of $tpl. */
function email_editor_body(string $key, array $tpl, string $msg, string $err): string {
  global $self;
  $d = email_defs()[$key];
  $at = email_saved_at($key);
  $dirty = $tpl !== email_template($key);

  $fields = '';
  foreach ($d['parts'] as $p) {
    [$label, $hint] = EMAIL_PART_LABELS[$p];
    $id = 'e-' . $p;
    $val = (string)($tpl[$p] ?? '');
    $desc = $hint !== '' ? ' aria-describedby="' . $id . '-h"' : '';
    $fields .= '<div class="ef"><label for="' . $id . '">' . h($label) . '</label>'
      . ($hint !== '' ? '<p class="hint" id="' . $id . '-h">' . h($hint) . '</p>' : '')
      . ($p === 'subject'
        ? '<input id="' . $id . '" type="text" name="subject" value="' . h($val) . '" maxlength="' . EMAIL_MAX_SUBJECT . '" required data-ph-target' . $desc . '>'
        : '<textarea id="' . $id . '" name="' . $p . '" rows="' . ($p === 'body' ? 8 : ($p === 'intro' ? 4 : ($p === 'signature' ? 3 : 2))) . '" maxlength="' . EMAIL_MAX_PART . '" data-ph-target' . $desc . ">\n" . h($val) . '</textarea>')
      . '</div>';
  }

  $phs = '';
  foreach ($d['vars'] as $name => $what) {
    $phs .= '<button class="ph" type="button" data-ph="{' . h($name) . '}"><code>{' . h($name) . '}</code><span>' . h($what) . '</span></button>';
  }
  $always = '';
  foreach ($d['always'] as $a) $always .= '<li>' . h($a) . '</li>';

  // preview with made-up details
  if ($d['group'] === 'confirm') {
    $r = email_render_confirm($key, email_sample_vars(), email_confirm_opts($key), $tpl);
    $pv = '<div class="pv"><div class="pv-subj"><span>Subject</span><b>' . h($r['subject']) . '</b></div>'
      . '<div class="pv-mail">' . $r['inner'] . '</div>'
      . '<details class="pvtext"><summary>Plain-text version</summary><pre>' . h($r['text']) . '</pre></details></div>';
  } else {
    [$subj, $body] = email_render_alert(substr($key, 6), email_sample_fields(substr($key, 6)), email_sample_ctx(), $tpl);
    $pv = '<div class="pv"><div class="pv-subj"><span>Subject</span><b>' . h($subj) . '</b></div><pre>' . h($body) . '</pre></div>';
  }

  $status = $at ? 'Edited ' . fmt_time($at) : 'Default wording';
  $out = '<a class="back" href="' . h($self . '?page=emails') . '">&larr; All emails</a>'
    . '<div class="head"><h1>' . h($d['title']) . '</h1>'
    . '<div class="emeta"><span><b>To:</b> ' . h($d['to']) . '</span><span><b>When:</b> ' . h($d['when']) . '</span><span><b>Now using:</b> ' . h($status) . '</span></div></div>'
    . ($err !== '' ? '<p class="err-box" role="alert">' . h($err) . ' Nothing was saved.</p>' : '')
    . ($msg !== '' ? '<p class="flash" role="status">' . h($msg) . '</p>' : '')
    . ($dirty && $err === '' ? '<p class="flash" style="background:#FFF7E0;border-color:#F3DB9A;color:#5C3D00">You have changes that are not saved yet.</p>' : '')
    . '<div class="eedit">'
    . '<form class="eform" method="post" action="' . h($self) . '">' . csrf_field() . '<input type="hidden" name="key" value="' . h($key) . '">'
    . $fields
    . '<div class="eacts">'
    .   '<button class="b" type="submit" name="act" value="email_save">Save</button>'
    .   '<button class="b b--ghost" type="submit" name="act" value="email_preview">Preview changes</button>'
    .   '<button class="b b--ghost" type="submit" name="act" value="email_test" title="Sends this wording to ' . h(SITE_NOTIFY_TO) . '">Send me a test</button>'
    . '</div></form>'
    . '<aside class="easide">'
    .   '<section class="box"><h2>Placeholders</h2><p>Click one to put it where your cursor is. When the email goes out, it is swapped for the real detail.</p><div class="phs">' . $phs . '</div></section>'
    .   '<section class="box"><h2>Always included</h2><p>Added automatically. Edits cannot remove these.</p><ul class="always">' . $always . '</ul></section>'
    .   ($at ? '<section class="box"><h2>Start over</h2><p>Go back to the original wording. Your edits are thrown away.</p><div class="row">'
          . '<form method="post" action="' . h($self) . '" data-confirm="Go back to the default wording for this email? Your edits will be lost.">' . csrf_field()
          . '<input type="hidden" name="key" value="' . h($key) . '"><input type="hidden" name="act" value="email_reset">'
          . '<button class="b b--danger b--sm" type="submit">Reset to default</button></form></div></section>' : '')
    . '</aside></div>'
    . '<section class="pvwrap"><h2>Preview</h2><p>' . ($dirty ? 'Your unsaved changes' : 'What people get') . ', with made-up details (Jordan Lee, Northwind Foods). '
    . 'Press "Preview changes" after editing to refresh it.</p>' . $pv . '</section>';
  return $out;
}

/** Footer options for a confirmation: the real unsubscribe footer for list emails, a plain line otherwise. */
function email_confirm_opts(string $key): array {
  return $key === 'confirm_founding' ? ['unsubscribe' => unsubscribe_url(str_repeat('0', 32))] : ['footer' => PARTNER_EMAIL_FOOTER];
}

function email_sample_fields(string $type): array {
  $v = email_sample_vars();
  return match ($type) {
    'support'   => ['first_name' => $v['first_name'], 'email' => $v['email'], 'zip' => $v['zip']],
    'volunteer' => ['first_name' => $v['first_name'], 'email' => $v['email'], 'city' => $v['city']],
    'contact'   => ['name' => $v['name'], 'email' => $v['email'], 'topic' => $v['topic'], 'message' => 'Hi, I run a food bank in Atlanta and would love to talk.'],
    'partner'   => ['name' => $v['name'], 'email' => $v['email'], 'company' => $v['company'], 'note' => 'We want to sponsor a community-voted initiative in Q2.'],
    default     => ['first_name' => $v['first_name'], 'email' => $v['email']],
  };
}

function email_sample_ctx(): array {
  return ['page' => '/get-involved/', 'pid' => 'k7m2p9qx4a', 'when' => time(), 'ref_line' => '', 'resub' => false];
}

/** "Send me a test": this wording, made-up details, to SITE_NOTIFY_TO. */
function email_send_test(string $key, array $tpl): bool {
  $d = email_defs()[$key];
  if ($d['group'] === 'confirm') {
    $r = email_render_confirm($key, email_sample_vars(), email_confirm_opts($key), $tpl);
    $o = ['from' => SITE_MAIL_FROM, 'from_name' => SITE_MAIL_FROM_NAME, 'reply_to' => SITE_MAIL_REPLY_TO, 'kind' => 'preview'];
    if ($key === 'confirm_founding') $o['unsubscribe'] = unsubscribe_url(str_repeat('0', 32));
    return send_mail(SITE_NOTIFY_TO, '[Test] ' . $r['subject'], $r['text'], $r['html'], $o);
  }
  [$subj, $body] = email_render_alert(substr($key, 6), email_sample_fields(substr($key, 6)), email_sample_ctx(), $tpl);
  return send_mail(SITE_NOTIFY_TO, '[Test] ' . $subj, $body, null, [
    'from' => SITE_NOTIFY_FROM, 'from_name' => SITE_NOTIFY_FROM_NAME, 'kind' => 'preview', 'auto' => true,
  ]);
}

// =====================================================================
// CSV EXPORT  (?export=<type>[&subscribed=1])
// =====================================================================
function csv_cell($v): string {
  $s = (string)$v;
  if ($s !== '' && in_array($s[0], ['=', '+', '-', '@', "\t", "\r"], true)) $s = "'" . $s;   // spreadsheet formula injection guard
  return '"' . str_replace('"', '""', $s) . '"';
}
function csv_line(array $cells): string { return implode(',', array_map('csv_cell', $cells)) . "\r\n"; }
function csv_date(?int $t): string { return $t ? date('Y-m-d H:i', $t) : ''; }

if (isset($_GET['export'])) {
  $type = (string)$_GET['export'];
  if (!in_array($type, SITE_TYPES, true)) { http_response_code(400); exit('Unknown type'); }
  $subscribedOnly = !empty($_GET['subscribed']) && in_array($type, SITE_LIST_TYPES, true);
  $rows = q('SELECT s.*, r.email AS ref_email FROM submissions s LEFT JOIN submissions r ON r.pid = s.ref
             WHERE s.type = ?' . ($subscribedOnly ? ' AND s.unsubscribed_at IS NULL' : '') . ' ORDER BY s.created_at ASC, s.id ASC', [$type]);
  $brought = [];
  if ($type === 'founding') foreach (q('SELECT ref, COUNT(*) c FROM submissions WHERE ref IS NOT NULL GROUP BY ref') as $b) $brought[$b['ref']] = (int)$b['c'];

  $head = ['ID', 'Date (New York)'];
  switch ($type) {
    case 'founding':  $head = array_merge($head, ['First name', 'Email', 'Status', 'Referral link', 'Referred by', 'People brought', 'Signed up again', 'Page', 'Unsubscribe link', 'Handled']); break;
    case 'updates':   $head = array_merge($head, ['First name', 'Email', 'Status', 'Referred by', 'Signed up again', 'Page', 'Unsubscribe link', 'Handled']); break;
    case 'support':   $head = array_merge($head, ['First name', 'Email', 'Phone', 'ZIP', 'Page', 'Handled']); break;
    case 'volunteer': $head = array_merge($head, ['First name', 'Email', 'City', 'Page', 'Handled']); break;
    case 'contact':   $head = array_merge($head, ['Name', 'Email', 'About', 'Message', 'Page', 'Handled']); break;
    case 'partner':   $head = array_merge($head, ['Name', 'Email', 'Company', 'Note', 'Page', 'Handled']); break;
  }
  $name = 'dad-' . $type . ($subscribedOnly ? '-mailing-list' : '') . '-' . date('Y-m-d') . '.csv';
  base_headers();
  header('Content-Type: text/csv; charset=utf-8');
  header('Content-Disposition: attachment; filename="' . $name . '"');
  echo "\xEF\xBB\xBF" . csv_line($head);
  foreach ($rows as $r) {
    $f = decode_fields($r['fields']);
    $line = [$r['pid'], csv_date((int)$r['created_at'])];
    $status = $r['unsubscribed_at'] ? 'Unsubscribed' : 'Subscribed';
    $unsub = $r['unsub_token'] ? unsubscribe_url($r['unsub_token']) : '';
    switch ($type) {
      case 'founding':  $line = array_merge($line, [$f['first_name'] ?? '', $f['email'] ?? '', $status, referral_url($r['pid']), $r['ref_email'] ?? '', $brought[$r['pid']] ?? 0, (int)$r['repeat_count'], $r['page'], $unsub, csv_date($r['handled_at'] ? (int)$r['handled_at'] : null)]); break;
      case 'updates':   $line = array_merge($line, [$f['first_name'] ?? '', $f['email'] ?? '', $status, $r['ref_email'] ?? '', (int)$r['repeat_count'], $r['page'], $unsub, csv_date($r['handled_at'] ? (int)$r['handled_at'] : null)]); break;
      case 'support':   $line = array_merge($line, [$f['first_name'] ?? '', $f['email'] ?? '', $f['phone'] ?? '', $f['zip'] ?? '', $r['page'], csv_date($r['handled_at'] ? (int)$r['handled_at'] : null)]); break;
      case 'volunteer': $line = array_merge($line, [$f['first_name'] ?? '', $f['email'] ?? '', $f['city'] ?? '', $r['page'], csv_date($r['handled_at'] ? (int)$r['handled_at'] : null)]); break;
      case 'contact':   $line = array_merge($line, [$f['name'] ?? '', $f['email'] ?? '', $f['topic'] ?? '', $f['message'] ?? '', $r['page'], csv_date($r['handled_at'] ? (int)$r['handled_at'] : null)]); break;
      case 'partner':   $line = array_merge($line, [$f['name'] ?? '', $f['email'] ?? '', $f['company'] ?? '', $f['note'] ?? '', $r['page'], csv_date($r['handled_at'] ? (int)$r['handled_at'] : null)]); break;
    }
    echo csv_line($line);
  }
  exit;
}

// =====================================================================
// DASHBOARD
// =====================================================================
$flash = (string)($_SESSION['flash'] ?? '');
unset($_SESSION['flash']);
$week = time() - 86400 * 7;

// counts by type
$counts = [];
foreach (SITE_TYPES as $t) $counts[$t] = ['n' => 0, 'w' => 0, 'open' => 0, 'subs' => 0];
foreach (q('SELECT type, COUNT(*) n, SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) w,
              SUM(CASE WHEN handled_at IS NULL THEN 1 ELSE 0 END) open,
              SUM(CASE WHEN unsubscribed_at IS NULL THEN 1 ELSE 0 END) subs
            FROM submissions GROUP BY type', [$week]) as $c) {
  if (isset($counts[$c['type']])) $counts[$c['type']] = ['n' => (int)$c['n'], 'w' => (int)$c['w'], 'open' => (int)$c['open'], 'subs' => (int)$c['subs']];
}
$total = array_sum(array_column($counts, 'n'));
$totalW = array_sum(array_column($counts, 'w'));

// listing
$where = []; $args = [];
if ($F['type'] !== '') { $where[] = 'type = ?'; $args[] = $F['type']; }
if ($F['status'] === 'open') $where[] = 'handled_at IS NULL';
elseif ($F['status'] === 'handled') $where[] = 'handled_at IS NOT NULL';
elseif ($F['status'] === 'unsubscribed') $where[] = 'unsubscribed_at IS NOT NULL';
if ($F['q'] !== '') {
  $like = '%' . like_escape($F['q']) . '%';
  $where[] = "(email LIKE ? ESCAPE '\\' OR fields LIKE ? ESCAPE '\\' OR page LIKE ? ESCAPE '\\' OR pid = ? OR ref = ?)";
  array_push($args, $like, $like, $like, strtolower($F['q']), strtolower($F['q']));
}
$w = $where ? ' WHERE ' . implode(' AND ', $where) : '';
$found = (int)q('SELECT COUNT(*) FROM submissions' . $w, $args)->fetchColumn();
$pages = max(1, (int)ceil($found / PER_PAGE));
$F['p'] = min($F['p'], $pages);
$rows = q('SELECT * FROM submissions' . $w . ' ORDER BY created_at DESC, id DESC LIMIT ' . PER_PAGE . ' OFFSET ' . (($F['p'] - 1) * PER_PAGE), $args)->fetchAll();

// people each founding donor on this page brought in
$brought = [];
$pids = array_values(array_map(fn($r) => $r['pid'], array_filter($rows, fn($r) => $r['type'] === 'founding')));
if ($pids) {
  $in = implode(',', array_fill(0, count($pids), '?'));
  foreach (q('SELECT ref, COUNT(*) c FROM submissions WHERE ref IN (' . $in . ') GROUP BY ref', $pids) as $b) $brought[$b['ref']] = (int)$b['c'];
}

// mail in the last 24 hours
$mail = [];
foreach (q('SELECT kind, COUNT(*) n, SUM(ok) ok FROM mail_log WHERE ts > ? GROUP BY kind', [time() - 86400]) as $m) $mail[$m['kind']] = ['n' => (int)$m['n'], 'ok' => (int)$m['ok']];

$csrf = csrf_field();
$backField = '<input type="hidden" name="back" value="' . h(ltrim(qs($F), '?')) . '">';

// ---- tiles
$tiles = '<a class="tile' . ($F['type'] === '' ? ' on' : '') . '" href="' . h($self . qs($F, ['type' => '', 'p' => 1])) . '">'
  . '<span class="lbl"><i class="dot c-all"></i>All</span><b>' . $total . '</b><small>' . $totalW . ' this week</small></a>';
foreach (SITE_TYPES as $t) {
  $c = $counts[$t];
  $meta = in_array($t, SITE_LIST_TYPES, true)
    ? $c['w'] . ' this week · ' . $c['subs'] . ' subscribed'
    : $c['w'] . ' this week · ' . $c['open'] . ' open';
  $tiles .= '<a class="tile' . ($F['type'] === $t ? ' on' : '') . '" href="' . h($self . qs($F, ['type' => $t, 'p' => 1])) . '">'
    . '<span class="lbl"><i class="dot c-' . $t . '"></i>' . h(TILE_LABELS[$t]) . '</span><b>' . $c['n'] . '</b><small>' . h($meta) . '</small></a>';
}

// ---- filter bar
$statusOpts = '<option value="">Any status</option>';
foreach (STATUSES as $k => $label) $statusOpts .= '<option value="' . $k . '"' . ($F['status'] === $k ? ' selected' : '') . '>' . $label . '</option>';
$exports = '';
if ($F['type'] !== '') {
  $exports .= '<a class="b b--ghost" href="' . h($self . '?export=' . $F['type']) . '">Export CSV</a>';
  if (in_array($F['type'], SITE_LIST_TYPES, true)) {
    $exports .= '<a class="b b--ghost" href="' . h($self . '?export=' . $F['type'] . '&subscribed=1') . '" title="Subscribed people only, with unsubscribe links">Mailing list CSV</a>';
  }
} else {
  $exports = '<span class="mut">Pick a type to export it.</span>';
}
$bar = '<div class="bar"><form class="filters" method="get" action="' . h($self) . '" role="search">'
  . ($F['type'] !== '' ? '<input type="hidden" name="type" value="' . h($F['type']) . '">' : '')
  . '<label class="sr" for="q">Search</label><input id="q" type="search" name="q" value="' . h($F['q']) . '" placeholder="Search name, email, city, message, code">'
  . '<label class="sr" for="status">Status</label><select id="status" name="status" data-autosubmit>' . $statusOpts . '</select>'
  . '<button class="b" type="submit">Search</button>'
  . ($F['q'] !== '' || $F['status'] !== '' ? '<a class="b b--ghost" href="' . h($self . qs(['type' => $F['type'], 'q' => '', 'status' => '', 'p' => 1])) . '">Clear</a>' : '')
  . '</form><div class="exports">' . $exports . '</div></div>';

// ---- privacy request helper: exact email search
$danger = '';
if ($F['q'] !== '' && valid_email(strtolower($F['q']))) {
  $n = (int)q('SELECT COUNT(*) FROM submissions WHERE email = ?', [strtolower($F['q'])])->fetchColumn();
  if ($n > 0) {
    $danger = '<div class="danger"><div><b>Privacy request?</b> <span class="mut">Delete every record for ' . h(strtolower($F['q'])) . ' (' . $n . ').</span></div>'
      . '<form method="post" action="' . h($self) . '" data-confirm="Delete all ' . $n . ' record(s) for ' . h(strtolower($F['q'])) . ' permanently?">' . $csrf
      . '<input type="hidden" name="act" value="delete_email"><input type="hidden" name="email" value="' . h(strtolower($F['q'])) . '">'
      . '<button class="b b--danger" type="submit">Delete all</button></form></div>';
  }
}

// ---- rows
$trs = '';
foreach ($rows as $r) {
  $f = decode_fields($r['fields']);
  $type = (string)$r['type'];
  $done = $r['handled_at'] !== null;
  $name = (string)($f['first_name'] ?? $f['name'] ?? '');
  $contact = '';
  if (!empty($f['email'])) $contact .= '<a href="mailto:' . h($f['email']) . '">' . h($f['email']) . '</a>';
  if (!empty($f['phone'])) $contact .= ($contact ? '<br>' : '') . '<a href="tel:' . h(preg_replace('/[^0-9+]/', '', (string)$f['phone'])) . '">' . h($f['phone']) . '</a>';

  $det = [];
  if ($type === 'support')   $det[] = 'ZIP <b class="num">' . h($f['zip'] ?? '') . '</b>';
  if ($type === 'volunteer') $det[] = h($f['city'] ?? '');
  if ($type === 'contact') {
    $msg = (string)($f['message'] ?? '');
    $det[] = '<span class="tag">' . h($f['topic'] ?? '') . '</span>';
    $short = mb_strlen($msg) > 110 ? mb_substr($msg, 0, 110) . '...' : $msg;
    $det[] = mb_strlen($msg) > 110
      ? '<details><summary>' . h($short) . '</summary><div class="msg">' . h($msg) . '</div></details>'
      : '<div class="msg">' . h($msg) . '</div>';
  }
  if ($type === 'partner') {
    $det[] = '<span class="tag">' . h($f['company'] ?? '') . '</span>';
    $note = (string)($f['note'] ?? '');
    if ($note === '') $det[] = '<span class="mut">No note</span>';
    elseif (mb_strlen($note) > 110) $det[] = '<details><summary>' . h(mb_substr($note, 0, 110) . '...') . '</summary><div class="msg">' . h($note) . '</div></details>';
    else $det[] = '<div class="msg">' . h($note) . '</div>';
  }
  if ($type === 'founding') {
    $det[] = '<span class="mut">Code</span> <span class="pid">' . h($r['pid']) . '</span>';
    $nb = $brought[$r['pid']] ?? 0;
    if ($nb > 0) $det[] = '<a href="' . h($self . '?q=' . rawurlencode($r['pid'])) . '">Brought ' . $nb . ' ' . ($nb === 1 ? 'person' : 'people') . '</a>';
  }
  if ((int)$r['repeat_count'] > 0) $det[] = '<span class="mut">Signed up again ' . (int)$r['repeat_count'] . 'x</span>';

  $src = '<span class="pid">' . h($r['page'] ?: '/') . '</span>';
  if (!empty($r['ref'])) $src .= '<br><span class="mut">via</span> <a class="pid" href="' . h($self . '?q=' . rawurlencode((string)$r['ref'])) . '">' . h($r['ref']) . '</a>';

  $status = '<span class="pill ' . ($done ? 'handled' : 'open') . '">' . ($done ? 'Handled' : 'Open') . '</span>';
  if ($r['unsubscribed_at'] !== null) $status .= ' <span class="pill unsub" title="' . h(fmt_time((int)$r['unsubscribed_at'])) . '">Unsubscribed</span>';

  $acts = '<form method="post" action="' . h($self) . '">' . $csrf . $backField
    . '<input type="hidden" name="id" value="' . (int)$r['id'] . '"><input type="hidden" name="act" value="' . ($done ? 'reopen' : 'handle') . '">'
    . '<button class="b b--ghost b--sm" type="submit">' . ($done ? 'Reopen' : 'Mark handled') . '</button></form>'
    . '<form method="post" action="' . h($self) . '" data-confirm="Delete this ' . h(strtolower(SITE_TYPE_LABELS[$type] ?? 'record')) . ' record permanently?">' . $csrf . $backField
    . '<input type="hidden" name="id" value="' . (int)$r['id'] . '"><input type="hidden" name="act" value="delete">'
    . '<button class="b b--danger b--sm" type="submit" aria-label="Delete ' . h($name) . '">Delete</button></form>';

  // each cell's content sits in one <div> so the phone layout (label | content grid) stays two columns
  $trs .= '<tr class="' . ($done ? 'done' : '') . '">'
    . '<td data-label="When"><div><span class="num">' . h(date('M j, g:i A', (int)$r['created_at'])) . '</span><br><span class="mut">' . h(ago((int)$r['created_at'])) . '</span></div></td>'
    . '<td data-label="Who" class="who"><div><b>' . h($name !== '' ? $name : '(no name)') . '</b>'
    .   ($F['type'] === '' ? '<span class="tag"><i class="dot c-' . h($type) . '"></i>' . h(SITE_TYPE_LABELS[$type] ?? $type) . '</span>' : '') . '</div></td>'
    . '<td data-label="Contact" class="contact"><div>' . ($contact ?: '<span class="mut">none</span>') . '</div></td>'
    . '<td data-label="Details" class="det"><div>' . ($det ? implode('<br>', $det) : '<span class="mut">none</span>') . '</div></td>'
    . '<td data-label="From"><div>' . $src . '</div></td>'
    . '<td data-label="Status"><div>' . $status . '</div></td>'
    . '<td class="acts">' . $acts . '</td></tr>';
}
$from = $found ? (($F['p'] - 1) * PER_PAGE + 1) : 0;
$to = min($found, $F['p'] * PER_PAGE);
$table = '<div class="panel">' . ($trs
  ? '<table><thead><tr><th>When</th><th>Who</th><th>Contact</th><th>Details</th><th>From</th><th>Status</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' . $trs . '</tbody></table>'
  : '<div class="empty">' . ($total ? 'Nothing matches that search.' : 'No submissions yet. They will appear here the moment someone sends a form.') . '</div>')
  . '</div>';
$pager = $found > 0 ? '<nav class="pager" aria-label="Pages"><span class="mut">Showing ' . $from . ' to ' . $to . ' of ' . $found . '</span><span class="row">'
  . ($F['p'] > 1 ? '<a class="b b--ghost b--sm" href="' . h($self . qs($F, ['p' => $F['p'] - 1])) . '">&larr; Newer</a>' : '')
  . ($F['p'] < $pages ? '<a class="b b--ghost b--sm" href="' . h($self . qs($F, ['p' => $F['p'] + 1])) . '">Older &rarr;</a>' : '')
  . '</span></nav>' : '';

// ---- footer boxes
$m = fn(string $k) => $mail[$k] ?? ['n' => 0, 'ok' => 0];
$failed = 0; foreach ($mail as $x) $failed += $x['n'] - $x['ok'];
$notifyTypes = implode(', ', array_map(fn($t) => SITE_TYPE_LABELS[$t] ?? $t, SITE_NOTIFY_TYPES)) ?: 'none';
$boxes = '<div class="grid2">'
  . '<section class="box"><h2>Email</h2><dl class="kv">'
  . '<dt>Team alerts to</dt><dd>' . h(SITE_NOTIFY_TO) . '</dd>'
  . '<dt>For</dt><dd>' . h($notifyTypes) . '</dd>'
  . '<dt>Donor email from</dt><dd>' . h(SITE_MAIL_FROM_NAME . ' <' . SITE_MAIL_FROM . '>') . '</dd>'
  . '<dt>Confirmations</dt><dd>Founding Donor and Partner forms (the others answer on screen only)</dd>'
  . '<dt>Last 24 h</dt><dd>' . $m('confirm')['ok'] . ' confirmations, ' . $m('notify')['ok'] . ' alerts' . ($failed ? ', <b style="color:#B42318">' . $failed . ' failed</b>' : '')
  .   (($mail['confirm_capped']['n'] ?? 0) ? ', ' . (int)$mail['confirm_capped']['n'] . ' held back by the hourly cap' : '') . '</dd>'
  . '</dl><div class="row">'
  . '<form method="post" action="' . h($self) . '">' . $csrf . $backField . '<input type="hidden" name="act" value="test_notify"><button class="b b--ghost b--sm" type="submit">Send a test alert</button></form>'
  . '<form method="post" action="' . h($self) . '">' . $csrf . $backField . '<input type="hidden" name="act" value="test_confirm"><button class="b b--ghost b--sm" type="submit">Preview the donor email</button></form>'
  . '<a class="b b--ghost b--sm" href="' . h($self . '?page=emails') . '">Edit the emails</a>'
  . '</div></section>'
  . '<section class="box"><h2>Good to know</h2><p>Founding Donor and build-update sign-ups are one row per email: signing up twice updates the row. '
  . 'Unsubscribes are kept so nobody is emailed again by mistake. Use the mailing list CSV when sending an update: it only has subscribed people, each with their own unsubscribe link.</p>'
  . '<p style="margin-top:8px">IP addresses are never stored, only a salted hash used for the 10-per-hour limit.</p></section>'
  . '</div>';

// ---- page
$body = '<div class="head"><h1>Submissions</h1><p class="sub">Everything people send through dynamicaid.org. Times are New York time.</p></div>'
  . ($flash ? '<p class="flash" role="status">' . h($flash) . '</p>' : '')
  . '<nav class="tiles" aria-label="Types">' . $tiles . '</nav>' . $bar . $danger . $table . $pager . $boxes;

// =====================================================================
// PAGE SHELL (shared by Submissions and Emails)
// =====================================================================
function admin_css(): string {
  return <<<'CSS'
html{background:var(--paper)}
body{font:400 15px/1.5 var(--f-body);color:var(--ink);background:var(--paper);-webkit-font-smoothing:antialiased;min-height:100vh}
a{color:inherit;text-underline-offset:3px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px clamp(16px,4vw,40px);background:rgba(14,30,30,.97);color:var(--paper)}
.brand{display:flex;align-items:center;gap:14px;text-decoration:none}
.brand .logo{height:22px;width:auto;display:block}
.brand span{font:500 11px/1 var(--f-mono);letter-spacing:.22em;text-transform:uppercase;color:var(--dkmut);padding-left:14px;border-left:1px solid rgba(248,249,250,.18)}
.out{min-height:40px;padding:9px 16px;border-radius:999px;border:1px solid rgba(248,249,250,.2);background:none;color:var(--paper);font:500 13px/1 var(--f-body);cursor:pointer;transition:border-color .3s}
.out:hover{border-color:rgba(248,249,250,.5)}
.wrap{max-width:1320px;margin:0 auto;padding:clamp(26px,4vw,48px) clamp(16px,4vw,40px) 80px}
.head h1{font:700 clamp(32px,4.6vw,50px)/1 var(--f-disp);letter-spacing:-.035em}
.sub{color:var(--body);margin-top:10px;max-width:62ch}
.flash{margin-top:20px;padding:12px 16px;border-radius:12px;background:#E8F5F5;border:1px solid #BFE3E3;color:#0B4F4F;font-weight:500;animation:in .6s var(--ease) both}
@keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:28px 0 24px}
.tile{display:block;text-decoration:none;background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;transition:transform .5s var(--ease),box-shadow .5s var(--ease),border-color .3s;animation:in .7s var(--ease) both}
.tile:nth-child(2){animation-delay:.04s}.tile:nth-child(3){animation-delay:.08s}.tile:nth-child(4){animation-delay:.12s}.tile:nth-child(5){animation-delay:.16s}.tile:nth-child(6){animation-delay:.2s}.tile:nth-child(7){animation-delay:.24s}
.tile:hover{transform:translateY(-2px);box-shadow:0 16px 32px -20px rgba(14,30,30,.4)}
.tile.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.tile .lbl{display:flex;align-items:center;gap:8px;font:500 10.5px/1.2 var(--f-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--body)}
.tile b{display:block;font:700 34px/1 var(--f-disp);letter-spacing:-.03em;margin-top:14px;font-variant-numeric:tabular-nums}
.tile small{display:block;margin-top:8px;font-size:12.5px;color:var(--body)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none;background:var(--c,var(--ink))}
.c-all{--c:#8FA3A3}.c-founding{--c:#FF4A22}.c-updates{--c:#007A7A}.c-support{--c:#00A9CC}.c-volunteer{--c:#E0A200}.c-contact{--c:#0E1E1E}.c-partner{--c:#6B4FD8}
.bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.filters{display:flex;flex-wrap:wrap;gap:10px;flex:1 1 520px}
.filters input[type=search]{flex:1 1 240px;min-height:44px;padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:#fff;font:400 15px var(--f-body);color:var(--ink)}
.filters select{min-height:44px;padding:10px 38px 10px 14px;border-radius:12px;border:1px solid var(--line);font:500 14px var(--f-body);color:var(--ink);-webkit-appearance:none;appearance:none;
  background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%230E1E1E' stroke-width='1.6'/%3E%3C/svg%3E") no-repeat right 14px center}
.filters input:focus,.filters select:focus{outline:none;border-color:var(--ink);box-shadow:0 0 0 3px rgba(255,74,34,.18)}
.exports{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.b{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:10px 18px;border-radius:999px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);font:600 14px/1 var(--f-body);text-decoration:none;cursor:pointer;white-space:nowrap;transition:transform .4s var(--ease),background .3s,color .3s,border-color .3s}
.b:hover{transform:translateY(-1px)}
.b--ghost{background:#fff;color:var(--ink);border-color:var(--line)}.b--ghost:hover{border-color:var(--ink)}
.b--sm{min-height:36px;padding:8px 13px;font-size:12.5px}
.b--danger{background:#fff;color:#B42318;border-color:#F1C8C1}.b--danger:hover{background:#FFF1EE;border-color:#B42318}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.panel{background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden}
.panel table{width:100%;border-collapse:collapse}
.panel th{text-align:left;font:500 10.5px/1.2 var(--f-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--body);padding:14px 16px;border-bottom:1px solid var(--line);background:#FBFCFC;white-space:nowrap}
.panel td{padding:15px 16px;border-bottom:1px solid var(--line);vertical-align:top;font-size:14px}
.panel tbody tr{transition:background .3s}
.panel tbody tr:hover{background:#FCFDFD}
.panel tbody tr:last-child td{border-bottom:0}
tr.done{background:#FAFBFB}
tr.done .who b,tr.done .contact{opacity:.7}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.mut{color:var(--body);font-size:12.5px}
.who b{display:block;font-weight:600}
.contact a{text-decoration:none;border-bottom:1px solid var(--line)}.contact a:hover{border-color:var(--red)}
.pid{font:500 12px var(--f-mono);color:var(--body);letter-spacing:.03em}
a.pid{text-decoration:underline}
.tag{display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:5px 9px;border-radius:999px;border:1px solid var(--line);font:500 10px/1 var(--f-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink);white-space:nowrap}
.pill{display:inline-block;margin:0 4px 4px 0;padding:5px 10px;border-radius:999px;font:600 12px/1 var(--f-body);white-space:nowrap}
.pill.open{background:#FFF1EE;color:#B42318}.pill.handled{background:#E6F4F4;color:#0B5F5F}.pill.unsub{background:#EEF1F2;color:#4A5757}
.det{max-width:460px}
.det details summary{cursor:pointer;list-style:none;color:var(--ink)}
.det details summary::-webkit-details-marker{display:none}
.det details summary::after{content:" Read all";color:#C2381A;font-weight:600;white-space:nowrap}
.det details[open] summary{display:none}
.msg{white-space:pre-wrap;word-break:break-word;margin-top:8px;padding:12px 14px;background:var(--paper);border:1px solid var(--line);border-radius:10px;font-size:14px;line-height:1.55}
td.acts{white-space:nowrap;text-align:right}
td.acts form{display:inline-block;margin-left:6px}
.empty{padding:56px 20px;text-align:center;color:var(--body)}
.pager{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px}
.row{display:flex;gap:8px;flex-wrap:wrap}
.danger{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px;padding:14px 18px;border:1px solid #F1C8C1;background:#FFF7F5;border-radius:14px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:14px;margin-top:30px}
.box{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px}
.box h2{font:700 20px/1.2 var(--f-disp);letter-spacing:-.02em;margin-bottom:10px}
.box p{color:var(--body);font-size:14px}
.box .row{margin-top:16px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:14px}
.kv dt{font:500 10.5px/1.9 var(--f-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--body)}
.kv dd{word-break:break-word}
@media (max-width:900px){
  .panel thead{display:none}
  .panel table,.panel tbody,.panel tr,.panel td{display:block;width:100%}
  .panel tbody tr{padding:14px 16px;border-bottom:1px solid var(--line)}
  .panel tbody tr:last-child{border-bottom:0}
  .panel td{display:grid;grid-template-columns:84px minmax(0,1fr);gap:12px;padding:5px 0;border:0}
  .panel td::before{content:attr(data-label);font:500 10px/1.9 var(--f-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--body)}
  td.acts{display:flex;gap:8px;justify-content:flex-start;padding-top:12px;text-align:left}
  td.acts::before{display:none}
  td.acts form{margin:0}
  .det{max-width:none}
  .brand span{display:none}
}
.top nav.tabs{display:flex;gap:4px;margin-right:auto;margin-left:8px}
.tabs a{display:inline-flex;align-items:center;min-height:40px;padding:8px 14px;border-radius:999px;color:var(--dkmut);font:500 13.5px/1 var(--f-body);text-decoration:none;transition:color .3s,background .3s}
.tabs a:hover{color:var(--paper)}
.tabs a[aria-current="page"]{color:var(--paper);background:rgba(248,249,250,.1)}
.egroup{margin-top:34px}
.egroup>h2{font:700 22px/1.2 var(--f-disp);letter-spacing:-.02em}
.egroup>p{color:var(--body);margin-top:6px;font-size:14px}
.ecards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px;margin-top:16px}
.ecard{display:flex;flex-direction:column;gap:8px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 20px;text-decoration:none;transition:transform .5s var(--ease),box-shadow .5s var(--ease),border-color .3s}
.ecard:hover{transform:translateY(-2px);box-shadow:0 16px 32px -20px rgba(14,30,30,.4);border-color:var(--ink)}
.ecard b{font:700 17px/1.25 var(--f-disp);letter-spacing:-.015em}
.ecard .mut{line-height:1.45}
.ecard .pill{align-self:flex-start;margin-top:auto}
.pill.edited{background:#FFF4D6;color:#7A5200}.pill.default{background:#EEF1F2;color:#4A5757}
.back{display:inline-flex;gap:6px;color:var(--body);font-size:14px;text-decoration:none;margin-bottom:14px}.back:hover{color:var(--ink)}
.emeta{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:12px;color:var(--body);font-size:14px}
.emeta b{color:var(--ink);font-weight:600}
.err-box{margin-top:20px;padding:12px 16px;border-radius:12px;background:#FFF1EE;border:1px solid #F1C8C1;color:#8F1D0E;font-weight:500}
.eedit{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,340px);gap:16px;margin-top:24px;align-items:start}
.eform{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px}
.ef+.ef{margin-top:18px}
.ef label{display:block;font:500 10.5px/1.3 var(--f-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--body);margin-bottom:6px}
.ef .hint{font-size:13px;color:var(--body);margin:-2px 0 8px}
.ef input,.ef textarea{display:block;width:100%;min-height:46px;padding:11px 14px;border-radius:12px;border:1px solid var(--line);background:#fff;font:400 15px/1.55 var(--f-body);color:var(--ink);resize:vertical}
.ef input:focus,.ef textarea:focus{outline:none;border-color:var(--ink);box-shadow:0 0 0 3px rgba(255,74,34,.18)}
.eacts{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}
.easide{display:grid;gap:12px}
.easide .box h2{font-size:17px}
.phs{display:grid;gap:6px;margin-top:10px}
.ph{display:grid;gap:2px;text-align:left;width:100%;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--paper);cursor:pointer;font:inherit;color:var(--ink);transition:border-color .3s,background .3s}
.ph:hover{border-color:var(--ink);background:#fff}
.ph code{font:600 13px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#C2381A;word-break:break-all}
.ph span{font-size:12.5px;color:var(--body)}
.always{margin-top:10px;padding-left:18px;color:var(--body);font-size:13.5px;display:grid;gap:4px}
.pvwrap{margin-top:16px}
.pvwrap>h2{font:700 22px/1.2 var(--f-disp);letter-spacing:-.02em;margin-bottom:6px}
.pvwrap>p{color:var(--body);font-size:14px;margin-bottom:12px}
.pv{background:#F8F9FA;border:1px solid var(--line);border-radius:18px;padding:18px clamp(10px,3vw,28px) 26px;overflow:hidden}
.pv-subj{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;max-width:560px;margin:0 auto 14px;font-size:14px}
.pv-subj span{font:500 10.5px/1.3 var(--f-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--body)}
.pv-subj b{word-break:break-word}
.pv-mail{max-width:560px;margin:0 auto}
.pv pre,.pvtext pre{white-space:pre-wrap;word-break:break-word;font:13.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;max-width:560px;margin:0 auto}
.pvtext{max-width:560px;margin:14px auto 0}
.pvtext summary{cursor:pointer;font-size:14px;font-weight:600;padding:6px 0}
@media (max-width:900px){.eedit{grid-template-columns:minmax(0,1fr)}.tabs a{padding:8px 10px}}
@media (max-width:520px){.top{gap:8px}.top nav.tabs{margin-left:0;gap:0}.out{padding:9px 12px}
  .tiles{gap:8px;margin:20px 0 18px}.tile{padding:12px 14px}.tile b{font-size:26px;margin-top:8px}.tile small{margin-top:4px}}
CSS;
}

/** Print a dashboard page: top bar with the two tabs, then $body (trusted HTML, values escaped by the caller). */
function admin_out(string $title, string $body, string $active, int $status = 200): void {
  global $self;
  $tab = fn(string $href, string $label, string $k) => '<a href="' . h($href) . '"' . ($active === $k ? ' aria-current="page"' : '') . '>' . $label . '</a>';
  ui_headers($status);
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    . '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    . '<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#0E1E1E">'
    . '<title>' . h($title) . '</title><style>' . ui_fonts_css() . ui_base_css() . admin_css() . '</style></head><body>'
    . '<header class="top"><a class="brand" href="' . h($self) . '" aria-label="Submissions home">' . ui_logo('#F8F9FA', 'logo') . '<span>Site forms</span></a>'
    . '<nav class="tabs" aria-label="Dashboard">' . $tab($self, 'Submissions', 'subs') . $tab($self . '?page=emails', 'Emails', 'emails') . '</nav>'
    . '<form method="post" action="' . h($self) . '">' . csrf_field() . '<input type="hidden" name="act" value="logout"><button class="out" type="submit">Log out</button></form></header>'
    . '<main class="wrap">' . $body . '</main>'
    . '<script nonce="' . h(ui_nonce()) . '">'
    . 'document.querySelectorAll("form[data-confirm]").forEach(function(f){f.addEventListener("submit",function(e){if(!confirm(f.getAttribute("data-confirm")))e.preventDefault();});});'
    . 'document.querySelectorAll("select[data-autosubmit]").forEach(function(s){s.addEventListener("change",function(){s.form.submit();});});'
    // Emails page: a placeholder button puts {name} where the cursor was in the last field used
    . 'var lastF=document.querySelector("[data-ph-target]");'
    . 'document.querySelectorAll("[data-ph-target]").forEach(function(el){el.addEventListener("focus",function(){lastF=el;});});'
    . 'document.querySelectorAll("button[data-ph]").forEach(function(b){b.addEventListener("click",function(){if(!lastF)return;var t=b.getAttribute("data-ph"),s=lastF.selectionStart==null?lastF.value.length:lastF.selectionStart,e=lastF.selectionEnd==null?s:lastF.selectionEnd;'
    . 'lastF.value=lastF.value.slice(0,s)+t+lastF.value.slice(e);lastF.focus();lastF.setSelectionRange(s+t.length,s+t.length);});});'
    . '</script></body></html>';
}

admin_out('Submissions | DAD', $body, 'subs');
