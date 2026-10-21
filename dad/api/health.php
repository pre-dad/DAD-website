<?php
// GET /api/health.php  ->  200 {"ok":true} when config is in place and the database is writable.
//                          503 {"ok":false,"error":"..."} otherwise (no paths or details leak).
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';
base_headers();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'HEAD') json_exit(405, ['ok' => false, 'error' => 'Method not allowed'], ['Allow: GET, HEAD']);

if (!site_configured()) json_exit(503, ['ok' => false, 'error' => 'Not configured']);
try {
  $dir = site_data_dir();
  if (!is_writable($dir)) throw new RuntimeException('data folder not writable');
  db()->query('SELECT COUNT(*) FROM settings')->fetchColumn();
  set_setting('last_health_check', (string)time());   // proves a write works
} catch (Throwable $e) {
  error_log('[dad-site] health.php: ' . $e->getMessage());
  json_exit(503, ['ok' => false, 'error' => 'Storage unavailable']);
}
json_exit(200, ['ok' => true]);
