<?php
// Test bootstrap for the Tier 1 PHPUnit suite.
//
// The pure logic under test (validate.php, util.php) begins with
// `defined('SITE_API') || exit;` and relies on a handful of constants that the
// real api/lib/bootstrap.php defines. That real bootstrap, however, also pulls
// in config.php, db.php, mail.php, emails.php and ui.php — i.e. the DB and mail
// stack. To keep these tests pure (no config.php, no DB, no secrets), we define
// ONLY the guard + the three constants the functions need, then require just the
// two library files under test.
//
// NOTE: these constants intentionally duplicate the values in
// api/lib/bootstrap.php (SITE_TYPES, SITE_TOPICS) and config.sample.php
// (SITE_QUIET_DOMAINS). If those drift, update this file in lockstep.
declare(strict_types=1);

define('SITE_API', 1);

const SITE_TYPES  = ['founding', 'updates', 'support', 'volunteer', 'contact', 'partner'];
const SITE_TOPICS = ['Giving', 'Partnership', 'Press', 'Careers', 'Something else'];
const SITE_QUIET_DOMAINS = ['example.com'];

if (function_exists('mb_internal_encoding')) {
    mb_internal_encoding('UTF-8');
}

$lib = dirname(__DIR__) . '/api/lib';
require $lib . '/util.php';      // helpers first (clean_line used by validate.php)
require $lib . '/validate.php';
