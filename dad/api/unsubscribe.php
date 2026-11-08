<?php
// /api/unsubscribe.php?t=<token>
//   GET   asks the visitor to confirm; a link prefetcher or scanner opening it changes nothing.
//   POST  a=unsubscribe&t=<token>: the confirm button. Unsubscribes that email from every DAD mailing list, then offers an undo.
//   POST  List-Unsubscribe=One-Click (RFC 8058, sent by Gmail/Apple Mail's own unsubscribe button): same, no page.
//   POST  a=resubscribe&t=<token>: undo, for that one list.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

$t = strtolower(trim((string)($_GET['t'] ?? $_POST['t'] ?? '')));
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$home = '<div class="acts"><a class="btn" href="/">Back to dynamicaid.org <span class="arr">&rarr;</span></a></div>';

function invalid_link(): void {
  ui_card_page('Unsubscribe | DAD', ui_logo()
    . '<h1>This link isn\'t active.</h1>'
    . '<p>To stop our emails, write to <b>hello@dynamicaid.org</b> and we\'ll take you off the list by hand.</p>'
    . '<div class="acts"><a class="btn btn--ghost" href="/">Back to dynamicaid.org</a></div>', 404);
  exit;
}

if (!site_configured()) {
  ui_card_page('Unsubscribe | DAD', ui_logo() . '<h1>Back in a minute.</h1><p>Please try this link again shortly.</p>', 503);
  exit;
}
if (!preg_match('/^[a-f0-9]{32}$/', $t)) invalid_link();

try {
  $row = q('SELECT id, type, email, unsubscribed_at FROM submissions WHERE unsub_token = ?', [$t])->fetch();
} catch (Throwable $e) {
  error_log('[dad-site] unsubscribe.php: ' . $e->getMessage());
  ui_card_page('Unsubscribe | DAD', ui_logo() . '<h1>Back in a minute.</h1><p>Please try this link again shortly.</p>', 503);
  exit;
}
if (!$row) invalid_link();

function unsubscribe_all(array $row): void {
  $now = time();
  if (!empty($row['email'])) {
    q("UPDATE submissions SET unsubscribed_at = ?, updated_at = ?
         WHERE email = ? AND type IN ('founding','updates') AND unsubscribed_at IS NULL", [$now, $now, $row['email']]);
  } else {
    q('UPDATE submissions SET unsubscribed_at = ?, updated_at = ? WHERE id = ? AND unsubscribed_at IS NULL', [$now, $now, $row['id']]);
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
    q('UPDATE submissions SET unsubscribed_at = NULL, updated_at = ? WHERE id = ?', [time(), $row['id']]);
    ui_card_page('Unsubscribe | DAD', ui_logo()
      . '<h1>You\'re back on the list.</h1>'
      . '<p>Welcome back. We\'ll keep it to one email a month, at most.</p>' . $home);
    exit;
  }
  if (($_POST['a'] ?? '') === 'unsubscribe') {
    unsubscribe_all($row);
    unsubscribed_page($row, $t, $home);
    exit;
  }
  // RFC 8058 one-click from the mail app: body "List-Unsubscribe=One-Click"
  unsubscribe_all($row);
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
