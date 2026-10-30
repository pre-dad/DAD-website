<?php
// Loads the pure API libraries without api/lib/bootstrap.php, which would also pull in
// config.php and open the database. The config values below are test fixtures.
declare(strict_types=1);

define('SITE_API', 1);

$lib = dirname(__DIR__) . '/api/lib';
require $lib . '/constants.php';

const SITE_BASE             = 'https://dynamicaid.test';
const SITE_QUIET_DOMAINS    = ['example.com'];
const SITE_NOTIFY_TO        = 'team@dynamicaid.test';
const SITE_NOTIFY_TYPES     = SITE_TYPES;
const SITE_NOTIFY_FROM      = 'no-reply@dynamicaid.test';
const SITE_NOTIFY_FROM_NAME = 'DAD Website';
const SITE_MAIL_REPLY_TO    = 'hello@dynamicaid.test';

mb_internal_encoding('UTF-8');

require $lib . '/util.php';
require $lib . '/validate.php';
require $lib . '/mail.php';
require $lib . '/emails.php';
