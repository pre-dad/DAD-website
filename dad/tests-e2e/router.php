<?php
// router.php — CI-only front controller for PHP's built-in server (php -S).
//
// php -S does NOT read .htaccess, so this router replicates the four Apache
// rules the E2E suite depends on. It is launched as:
//
//   php -S 127.0.0.1:8080 -t "$PWD" tests-e2e/router.php
//
// where $PWD is the absolute path to dad/. Use $_SERVER['DOCUMENT_ROOT'] (the
// -t docroot) as the web root, NOT __DIR__ (which is tests-e2e/).
//
// This file is dev/CI-only and is excluded from deploys (see deploy.sh) — it is
// never shipped to the live site, which runs under Apache + .htaccess.

$root = $_SERVER['DOCUMENT_ROOT'];
$uri  = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));

// 1) RedirectMatch 301 ^/get-involved/?$ /movement/  (mirrors .htaccess; the
//    page was renamed The Movement on 2026-10-17). The E2E suite asserts this.
if ($uri === '/get-involved' || $uri === '/get-involved/') {
    header('Location: /movement/', true, 301);
    exit;
}

$full = $root . $uri;

// 2) DirectoryIndex index.html index.php
if (is_dir($full)) {
    $idx = rtrim($uri, '/') . '/index.html';
    if (is_file($root . $idx)) {
        $uri  = $idx;
        $full = $root . $uri;
    } elseif (is_file($full . '/index.php')) {
        return false;
    }
}

// 3) <Files "impactledger"> ForceType text/html — the impact-ledger view ships
//    as an extension-less file; serve it as HTML (php -S would otherwise send it
//    as octet-stream).
if (is_file($full) && basename($uri) === 'impactledger') {
    header('Content-Type: text/html; charset=UTF-8');
    readfile($full);
    exit;
}

// 4) Existing file or *.php: let php -S serve it statically or execute it.
if (is_file($full)) {
    return false;
}

// 5) Everything else: ErrorDocument 404 /404.html.
http_response_code(404);
header('Content-Type: text/html; charset=UTF-8');
readfile($root . '/404.html');
exit;
