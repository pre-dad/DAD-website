<?php
// Brand chrome for the few HTML pages the API serves: unsubscribe, admin setup/login,
// and the no-JavaScript form result page. Brand v2.0: ink/paper, Kinetic Red-Orange, gold tail bars.
declare(strict_types=1);
defined('SITE_API') || exit;

function ui_nonce(): string {
  static $n = null;
  return $n ??= rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=');
}

function ui_headers(int $status = 200): void {
  http_response_code($status);
  base_headers();
  header('Content-Type: text/html; charset=utf-8');
  header('X-Frame-Options: DENY');
  header("Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    . "script-src 'nonce-" . ui_nonce() . "'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
}

/** Site fonts, served from the site's own /assets/fonts (system fonts if the assets are absent). */
function ui_fonts_css(): string {
  $f = function (string $fam, string $file, int $w): string {
    return '@font-face{font-family:"' . $fam . '";src:url(/assets/fonts/' . $file . '.woff2) format("woff2");font-weight:' . $w . ';font-style:normal;font-display:swap}';
  };
  return $f('Space Grotesk', 'SpaceGrotesk-700', 700) . $f('Space Grotesk', 'SpaceGrotesk-500', 500)
    . $f('Inter', 'Inter-400', 400) . $f('Inter', 'Inter-500', 500) . $f('Inter', 'Inter-600', 600) . $f('Inter', 'Inter-700', 700)
    . $f('IBM Plex Mono', 'IBMPlexMono-500', 500) . $f('IBM Plex Mono', 'IBMPlexMono-600', 600);
}

/** The DAD logo (from the partner page nav): D, A, mirrored D, two gold tail bars that stream. */
function ui_logo(string $fill = '#F8F9FA', string $class = 'logo'): string {
  $d = 'M0,0 H38 A50,50 0 0 1 38,100 H0 Z M24,24 H36 A26,26 0 0 1 36,76 H24 Z';
  return '<svg class="' . h($class) . '" viewBox="-8 -4 345 108" role="img" aria-label="DAD">'
    . '<path fill="' . h($fill) . '" fill-rule="evenodd" d="' . $d . '"/>'
    . '<path fill="' . h($fill) . '" fill-rule="evenodd" d="M126,0 H154 L190,100 H164 L156,78 H124 L116,100 H90 Z M140,26 L149,58 H131 Z"/>'
    . '<g transform="translate(280,0) scale(-1,1)"><path fill="' . h($fill) . '" fill-rule="evenodd" d="' . $d . '"/></g>'
    . '<g class="ml"><rect x="292" y="16" width="9" height="68" rx="4.5" fill="#FFB800"/></g>'
    . '<g class="ml l2"><rect x="309" y="32" width="6" height="36" rx="3" fill="#FFB800"/></g>'
    . '</svg>';
}

/** Shared tokens + the tail-bar stream animation. */
function ui_base_css(): string {
  return ':root{--ink:#0E1E1E;--ink2:#0A1616;--paper:#F8F9FA;--red:#FF4A22;--cyan:#00D4FF;--gold:#FFB800;--teal:#007A7A;'
    . '--mut:#8FA3A3;--line:#E3E6E8;--body:#4A5757;--dkmut:#B9C6C6;--ease:cubic-bezier(.16,1,.3,1);'
    . '--f-disp:"Space Grotesk",Inter,system-ui,-apple-system,"Segoe UI",sans-serif;--f-body:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;'
    . '--f-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}'
    . '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}'
    . '::selection{background:var(--red);color:#fff}'
    . '.ml{animation:stream 2.8s ease-in-out infinite;transform-box:fill-box}.ml.l2{animation-delay:.35s}'
    . '@keyframes stream{0%,100%{transform:translateX(0);opacity:1}50%{transform:translateX(-9px);opacity:.55}}'
    . '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}';
}

/**
 * A small centred card on ink: used for unsubscribe, setup, login and the no-JS form result.
 * $inner is trusted HTML built by the caller (escape user values with h()).
 */
function ui_card_page(string $title, string $inner, int $status = 200): void {
  ui_headers($status);
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    . '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    . '<meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="dark">'
    . '<meta name="theme-color" content="#0E1E1E"><title>' . h($title) . '</title>'
    . '<style>' . ui_fonts_css() . ui_base_css()
    . 'html{-webkit-text-size-adjust:100%;background:var(--ink)}'
    . 'body{min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;padding:24px 16px;'
    . 'background:radial-gradient(900px 640px at 12% -12%,rgba(255,74,34,.18),transparent 62%),radial-gradient(820px 640px at 100% 112%,rgba(0,212,255,.10),transparent 60%),var(--ink);'
    . 'color:var(--paper);font:400 16px/1.55 var(--f-body);-webkit-font-smoothing:antialiased}'
    . '.card{position:relative;width:100%;max-width:460px;background:rgba(19,38,38,.86);border:1px solid rgba(248,249,250,.10);border-radius:22px;'
    . 'padding:clamp(28px,7vw,44px);box-shadow:0 40px 90px -30px rgba(0,0,0,.6);animation:rise .9s var(--ease) both;overflow:hidden}'
    . '.card::before{content:"";position:absolute;left:0;top:0;height:2px;width:100%;background:linear-gradient(90deg,var(--red),rgba(255,74,34,0));transform-origin:left;animation:line 1.2s .15s var(--ease) both}'
    . '@keyframes rise{from{opacity:0;transform:translateY(18px) scale(.985)}to{opacity:1;transform:none}}'
    . '@keyframes line{from{transform:scaleX(0)}to{transform:scaleX(1)}}'
    . '.card>*{animation:rise .8s var(--ease) both}.card>*:nth-child(2){animation-delay:.06s}.card>*:nth-child(3){animation-delay:.12s}.card>*:nth-child(4){animation-delay:.18s}.card>*:nth-child(5){animation-delay:.24s}.card>*:nth-child(n+6){animation-delay:.3s}'
    . '.logo{display:block;height:28px;width:auto;margin-bottom:34px}'
    . '.eb{font:500 12px/1.3 var(--f-mono);letter-spacing:.24em;text-transform:uppercase;color:var(--red);margin-bottom:14px}'
    . 'h1{font:700 clamp(28px,7.4vw,36px)/1.04 var(--f-disp);letter-spacing:-.03em;margin-bottom:14px;text-wrap:balance}'
    . 'p{color:#CFD9D9;font-size:15.5px;line-height:1.6}p+p{margin-top:10px}p b{color:var(--paper);font-weight:600}'
    . '.acts{display:flex;flex-direction:column;gap:10px;margin-top:28px}'
    . '.btn{display:flex;align-items:center;justify-content:center;gap:10px;min-height:50px;padding:14px 22px;border-radius:999px;border:1px solid transparent;'
    . 'background:#D2360F;color:#fff;font:600 16px/1 var(--f-body);text-decoration:none;cursor:pointer;width:100%;'
    . 'transition:transform .5s var(--ease),filter .3s,background .3s,border-color .3s}'
    . '.btn:hover{filter:brightness(1.08);transform:translateY(-1px)}.btn:active{transform:translateY(0) scale(.99)}'
    . '.btn--ghost{background:transparent;border-color:rgba(248,249,250,.18);color:var(--paper)}.btn--ghost:hover{border-color:rgba(248,249,250,.4);filter:none}'
    . '.btn .arr{transition:transform .5s var(--ease)}.btn:hover .arr{transform:translateX(4px)}'
    . 'a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--red);outline-offset:3px}'
    . 'label{display:block;font:500 11.5px/1.3 var(--f-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--dkmut);margin:22px 0 8px}'
    . 'input[type=password],input[type=text],input[type=email]{width:100%;min-height:50px;padding:14px 16px;border-radius:12px;border:1px solid rgba(248,249,250,.14);'
    . 'background:#0B1919;color:var(--paper);font:400 16px var(--f-body);transition:border-color .3s,box-shadow .3s}'
    . 'input:focus{outline:none;border-color:var(--red);box-shadow:0 0 0 3px rgba(255,74,34,.22)}'
    . '.err{margin-top:12px;color:#FF8C6B;font-size:14.5px}'
    . '.fine{margin-top:22px;font-size:13px;color:var(--dkmut);line-height:1.5}.fine a{color:var(--paper)}'
    . '.linkbtn{background:none;border:0;padding:12px 2px;margin:-12px 0;font:inherit;color:var(--paper);text-decoration:underline;text-underline-offset:3px;cursor:pointer;border-radius:4px}'
    . '.linkbtn:hover{color:var(--red)}'
    . '.code{display:block;margin-top:12px;padding:12px 14px;border-radius:12px;background:#0B1919;border:1px solid rgba(248,249,250,.1);'
    . 'font:500 13.5px/1.4 var(--f-mono);color:var(--cyan);word-break:break-all;user-select:all}'
    . '</style></head><body><main class="card">' . $inner . '</main></body></html>';
}
