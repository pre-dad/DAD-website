<?php
// /api/unsubscribe.php?t=<token>
//   GET   asks the visitor to confirm; a link prefetcher or scanner opening it changes nothing.
//   POST  a=unsubscribe&t=<token>: the confirm button. Unsubscribes that email from every DAD mailing list, then offers an undo.
//   POST  List-Unsubscribe=One-Click (RFC 8058, sent by Gmail/Apple Mail's own unsubscribe button): same, no page.
//   POST  a=resubscribe&t=<token>: undo, restoring the rows that unsubscribe switched off together.
//   GET/POST ?c=<token>: confirm a re-subscribe requested by a sign-up form (the link in the confirmation email).
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

$t = strtolower(trim((string)($_GET['t'] ?? $_POST['t'] ?? '')));
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$home = '<div class="acts"><a class="btn" href="/">Back to dynamicaid.org <span class="arr">&rarr;</span></a></div>';

function unavailable(): void {
  ui_card_page('Unsubscribe | DAD', ui_logo() . '<h1>Back in a minute.</h1><p>Please try this link again shortly.</p>', 503);
  exit;
}

function invalid_link(): void {
  ui_card_page('Unsubscribe | DAD', ui_logo()
    . '<h1>This link isn\'t active.</h1>'
    . '<p>To stop our emails, write to <b>hello@dynamicaid.org</b> and we\'ll take you off the list by hand.</p>'
    . '<div class="acts"><a class="btn btn--ghost" href="/">Back to dynamicaid.org</a></div>', 404);
  exit;
}

if (!site_configured()) unavailable();

$c = strtolower(trim((string)($_GET['c'] ?? $_POST['c'] ?? '')));
if ($c !== '') {
  if (!preg_match('/^[a-f0-9]{32}$/', $c)) invalid_link();
  try {
    $pend = q('SELECT id, email FROM submissions WHERE resub_token = ?', [$c])->fetch();
  } catch (Throwable $e) {
    error_log('[dad-site] unsubscribe.php: ' . $e->getMessage());
    unavailable();
  }
  if (!$pend) invalid_link();
  if ($method === 'POST') {
    try {
      q('UPDATE submissions SET unsubscribed_at = NULL, resub_token = NULL, updated_at = ? WHERE id = ?', [time(), $pend['id']]);
      if (!empty($pend['email'])) unsuppress_email((string)$pend['email']);
    } catch (Throwable $e) {
      error_log('[dad-site] unsubscribe.php: ' . $e->getMessage());
      unavailable();
    }
    ui_card_page('Unsubscribe | DAD', ui_logo()
      . '<h1>You\'re on the list.</h1>'
      . '<p>Thanks for confirming. We\'ll keep it to one email a month, at most.</p>' . $home);
    exit;
  }
  if ($method === 'HEAD') { ui_headers(200); exit; }
  ui_card_page('Unsubscribe | DAD', ui_logo()
    . '<h1>Get DAD emails again?</h1>'
    . '<p>You unsubscribed earlier. Confirm to be added back.</p>'
    . '<form method="post" action="unsubscribe.php">'
    . '<input type="hidden" name="c" value="' . h($c) . '">'
    . '<div class="acts"><button class="btn" type="submit">Yes, add me back</button>'
    . '<a class="btn btn--ghost" href="/">No thanks</a></div></form>');
  exit;
}
if (!preg_match('/^[a-f0-9]{32}$/', $t)) invalid_link();

try {
  $row = q('SELECT id, type, email, unsubscribed_at FROM submissions WHERE unsub_token = ?', [$t])->fetch();
} catch (Throwable $e) {
  error_log('[dad-site] unsubscribe.php: ' . $e->getMessage());
  unavailable();
}
if (!$row) invalid_link();

// One timestamp marks every row a single unsubscribe switched off, so the undo restores exactly those.
function unsubscribe_all(array $row): void {
  $now = time();
  if (!empty($row['email'])) {
    q("UPDATE submissions SET unsubscribed_at = ?, updated_at = ?
         WHERE email = ? AND type IN ('founding','updates') AND unsubscribed_at IS NULL", [$now, $now, $row['email']]);
  } else {
    q('UPDATE submissions SET unsubscribed_at = ?, updated_at = ? WHERE id = ? AND unsubscribed_at IS NULL', [$now, $now, $row['id']]);
  }
}

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

function unsubscribed_page(array $row, string $t, string $home): void {
  ui_card_page('Unsubscribe | DAD', ui_logo()
    . '<h1>You\'re unsubscribed.</h1>'
    . '<p>You won\'t get any more emails from DAD.</p>'
    . ($row['type'] === 'founding' ? '<p>Your Founding Donor spot is still yours.</p>' : '')
    . $home
    . '<form class="fine" method="post" action="unsubscribe.php">'
    . '<input type="hidden" name="t" value="' . h($t) . '"><input type="hidden" name="a" value="resubscribe">'
    . 'Clicked by mistake? <button class="linkbtn" type="submit">Resubscribe</button>'
    . '</form>');
}

if ($method === 'POST') {
  // Undo from the confirmation page
  if (($_POST['a'] ?? '') === 'resubscribe') {
    try {
      resubscribe_all($row);
    } catch (Throwable $e) {
      error_log('[dad-site] unsubscribe.php: ' . $e->getMessage());
      unavailable();
    }
    ui_card_page('Unsubscribe | DAD', ui_logo()
      . '<h1>You\'re back on the list.</h1>'
      . '<p>Welcome back. We\'ll keep it to one email a month, at most.</p>' . $home);
    exit;
  }
  if (($_POST['a'] ?? '') === 'unsubscribe') {
    try {
      unsubscribe_all($row);
    } catch (Throwable $e) {
      error_log('[dad-site] unsubscribe.php: ' . $e->getMessage());
      unavailable();
    }
    unsubscribed_page($row, $t, $home);
    exit;
  }
  // RFC 8058 one-click from the mail app: body "List-Unsubscribe=One-Click"
  if (($_POST['List-Unsubscribe'] ?? '') !== 'One-Click') {
    base_headers();
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Bad request\n";
    exit;
  }
  try {
    unsubscribe_all($row);
  } catch (Throwable $e) {
    error_log('[dad-site] unsubscribe.php: ' . $e->getMessage());
    http_response_code(503);
    exit;
  }
  base_headers();
  header('Content-Type: text/plain; charset=utf-8');
  echo "Unsubscribed\n";
  exit;
}

if ($method === 'HEAD') { ui_headers(200); exit; }   // link checkers probe with HEAD: never unsubscribe on it
if ($method !== 'GET') { header('Allow: GET, POST'); http_response_code(405); exit; }

ui_card_page('Unsubscribe | DAD', ui_logo()
  . '<h1>Unsubscribe from DAD emails?</h1>'
  . '<p>This stops every DAD mailing list for this address.</p>'
  . '<form method="post" action="unsubscribe.php">'
  . '<input type="hidden" name="t" value="' . h($t) . '"><input type="hidden" name="a" value="unsubscribe">'
  . '<div class="acts"><button class="btn" type="submit">Yes, unsubscribe me</button>'
  . '<a class="btn btn--ghost" href="/">Keep me subscribed</a></div>'
  . '</form>');
