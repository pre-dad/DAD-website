<?php
// Router for PHP's built-in server (CI, local runs and the prod candidate smoke test):
//   php -S 127.0.0.1:8080 -t "$PWD" tests-e2e/router.php   (from dad/)
// php -S ignores .htaccess, so this reproduces the rules from dad/.htaccess the site needs.
// Never deployed.

$root = $_SERVER['DOCUMENT_ROOT'];
$uri  = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));

// RedirectMatch 301 ^/get-involved/?$ /movement/
if ($uri === '/get-involved' || $uri === '/get-involved/') {
    header('Location: /movement/', true, 301);
    exit;
}

$full = $root . $uri;

// DirectoryIndex index.html index.php
if (is_dir($full)) {
    $idx = rtrim($uri, '/') . '/index.html';
    if (is_file($root . $idx)) {
        $uri  = $idx;
        $full = $root . $uri;
    } elseif (is_file($full . '/index.php')) {
        return false;
    }
}

// <Files "impactledger"> ForceType text/html
if (is_file($full) && basename($uri) === 'impactledger') {
    header('Content-Type: text/html; charset=UTF-8');
    readfile($full);
    exit;
}

if (is_file($full)) {
    return false;
}

// ErrorDocument 404 /404.html
http_response_code(404);
header('Content-Type: text/html; charset=UTF-8');
readfile($root . '/404.html');
exit;
