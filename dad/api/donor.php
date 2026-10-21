<?php
// GET /api/donor.php?session_id=cs_...  -  prefill for the post-donation waitlist page (/give/welcome/).
// 200 {ok:true, first_name, email, amount}   (amount in cents)
// 200 {ok:false}                             (no key yet, unknown session, or not paid: the page shows a blank form)
// 429 {ok:false, error}
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/stripe.php';

base_headers();
header('Cache-Control: no-store, max-age=0');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') json_exit(405, ['ok' => false, 'error' => 'Method not allowed'], ['Allow: GET']);
if (!site_configured()) json_exit(200, ['ok' => false]);

$sid = (string)($_GET['session_id'] ?? '');
if (!valid_session_id($sid)) json_exit(200, ['ok' => false]);

try {
  $ipHash = ip_hash();
  if (hit_count('d:' . $ipHash, 3600) > 30) json_exit(429, ['ok' => false, 'error' => 'Too many requests']);
} catch (Throwable $e) {
  json_exit(200, ['ok' => false]);
}

$d = donor_from_session($sid);
if (!$d) json_exit(200, ['ok' => false]);

$first = trim((string)preg_split('/\s+/', $d['name'])[0]);
json_exit(200, ['ok' => true, 'first_name' => $first, 'email' => $d['email'], 'amount' => $d['amount']]);
