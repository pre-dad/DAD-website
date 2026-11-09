<?php
declare(strict_types=1);

// A Checkout Session ID in a return URL is not proof of the visitor's identity.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
http_response_code(410);
echo '{"ok":false}';
