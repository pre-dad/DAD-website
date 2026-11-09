<?php
// Stripe donor check (read-only). After a donor pays, Stripe sends them to /give/welcome/?session_id=cs_...
// We look that Checkout Session up with a RESTRICTED key (Checkout Sessions: read) to confirm the gift
// is real, so the Founding Donor badge can't be claimed without giving.
//
// The key is NOT in config.php (that file holds no secrets). It lives in <data dir>/stripe.key, which is
// locked with "Require all denied" and never mirrored. No key = donors still sign up; their session id is
// stored unverified and can be checked later.
defined('SITE_API') || exit;

function stripe_key(): ?string {
  try { $f = site_data_dir() . '/stripe.key'; } catch (Throwable $e) { return null; }
  if (!is_file($f)) return null;
  $k = trim((string)file_get_contents($f));
  return preg_match('/^(rk|sk)_(live|test)_[A-Za-z0-9]{10,200}$/', $k) ? $k : null;
}

function valid_session_id($id): bool {
  return is_string($id) && (bool)preg_match('/^cs_(live|test)_[A-Za-z0-9]{10,200}$/', $id);
}

/** GET /v1/checkout/sessions/{id}. Returns the decoded session, or null on any failure. */
function stripe_session(string $id): ?array {
  $key = stripe_key();
  if (!$key || !valid_session_id($id)) return null;
  $url = 'https://api.stripe.com/v1/checkout/sessions/' . rawurlencode($id);
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 4,
      CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key],
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  } else {
    $ctx = stream_context_create(['http' => ['header' => 'Authorization: Bearer ' . $key, 'timeout' => 8, 'ignore_errors' => true]]);
    $body = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $hl) { if (preg_match('#^HTTP/\S+ (\d{3})#', $hl, $m)) $code = (int)$m[1]; }
  }
  if ($code !== 200 || !is_string($body)) { error_log('[dad-site] stripe: session lookup HTTP ' . $code); return null; }
  $s = json_decode($body, true);
  return is_array($s) ? $s : null;
}

/** A completed, paid gift → donor details. Anything else → null. */
function donor_from_session(string $id, string $email): ?array {
  return donor_details(stripe_session($id), $id, $email);
}

/** Receipt metadata is attached only to a submission with the same billing email. */
function donor_details(?array $s, string $id, string $email): ?array {
  if (!$s || ($s['status'] ?? '') !== 'complete') return null;
  if (!in_array($s['payment_status'] ?? '', ['paid', 'no_payment_required'], true)) return null;
  $cd = is_array($s['customer_details'] ?? null) ? $s['customer_details'] : [];
  $billingEmail = strtolower(trim((string)($cd['email'] ?? '')));
  if ($billingEmail === '' || !hash_equals($billingEmail, strtolower(trim($email)))) return null;
  return [
    'session'      => $id,
    'verified'     => true,
    'verified_at'  => time(),
    'customer'     => is_string($s['customer'] ?? null) ? $s['customer'] : null,
    'subscription' => is_string($s['subscription'] ?? null) ? $s['subscription'] : null,
    'amount'       => (int)($s['amount_total'] ?? 0),       // cents, first charge
    'name'         => clamp_str(clean_line($cd['name'] ?? ''), 120),
    'email'        => strtolower(clamp_str(clean_line($cd['email'] ?? ''), 254)),
  ];
}
