<?php
// Loaded first by every endpoint. Loads config, sets defaults, pulls in the helpers.
declare(strict_types=1);

define('SITE_API', 1);

const SITE_TYPES      = ['founding', 'updates', 'support', 'volunteer', 'contact', 'partner'];
const SITE_LIST_TYPES = ['founding', 'updates'];          // mailing lists: deduped by email, carry an unsubscribe token
const SITE_TOPICS     = ['Giving', 'Partnership', 'Press', 'Careers', 'Something else'];
const SITE_TYPE_LABELS = [
  'founding'  => 'Founding Donor',
  'updates'   => 'Build updates',
  'support'   => 'Get support',
  'volunteer' => 'Volunteer',
  'contact'   => 'Message',
  'partner'   => 'Partner',
];

// The real config.php is created at deploy. Without it we load the sample so pages can still
// render a clean "not configured" state; site_configured() stays false and nothing is stored.
if (is_file(dirname(__DIR__) . '/config.php')) {
  require dirname(__DIR__) . '/config.php';
  define('SITE_HAS_CONFIG', true);
} else {
  require dirname(__DIR__) . '/config.sample.php';
  define('SITE_HAS_CONFIG', false);
}

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
date_default_timezone_set(SITE_TZ);
if (function_exists('mb_internal_encoding')) mb_internal_encoding('UTF-8');

require __DIR__ . '/util.php';
require __DIR__ . '/db.php';
require __DIR__ . '/validate.php';
require __DIR__ . '/mail.php';
require __DIR__ . '/emails.php';
require __DIR__ . '/ui.php';

/** True once a real config.php with a real data folder name is in place. */
function site_configured(): bool {
  if (!SITE_HAS_CONFIG) return false;
  $d = (string)SITE_DATA_DIR;
  if ($d === '' || stripos($d, 'CHANGE-ME') !== false) return false;
  return $d[0] === '/' || (bool)preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]*$/', $d);
}

/** True when the setup-key hash in config is a real SHA-256 (64 hex chars). */
function site_setup_key_ready(): bool {
  return (bool)preg_match('/^[a-f0-9]{64}$/', strtolower((string)SITE_SETUP_KEY_SHA256));
}

/** Absolute path of the data folder. Creates it (locked) on first use. */
function site_data_dir(): string {
  if (!site_configured()) throw new RuntimeException('Site API is not configured');
  $d = (string)SITE_DATA_DIR;
  if ($d[0] !== '/') $d = dirname(__DIR__, 2) . '/' . $d;   // lib -> api -> webroot, so the folder sits beside /api
  $d = rtrim($d, '/');
  if (!is_dir($d) && !@mkdir($d, 0750, true) && !is_dir($d)) {
    throw new RuntimeException('Cannot create the data folder');
  }
  if (!is_file($d . '/.htaccess')) @file_put_contents($d . '/.htaccess', "Require all denied\n");
  if (!is_file($d . '/index.html')) @file_put_contents($d . '/index.html', '');
  return $d;
}
