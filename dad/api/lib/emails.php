<?php
// The automatic emails: built-in default wording, the overrides Chris saves on the dashboard's
// Emails page (table email_templates), and rendering into the branded HTML + plain-text versions.
//
// Wording is data, never markup: every value is escaped on the way into HTML, and the parts that
// keep us legal (Unsubscribe link, one-click unsubscribe header) are added by code, not by the
// template, so no edit can remove them.
declare(strict_types=1);
defined('SITE_API') || exit;

const EMAIL_LINK_VARS = ['referral_link'];      // placeholders whose value is a link (made clickable in HTML)
const EMAIL_MAX_SUBJECT = 200;
const EMAIL_MAX_PART = 4000;

/** Labels and help text for each editable part, in the order the editor shows them. */
const EMAIL_PART_LABELS = [
  'subject'   => ['Subject line', ''],
  'greeting'  => ['Greeting', 'The first line, in bold. Leave empty to skip it.'],
  'body'      => ['Message', 'Leave an empty line between paragraphs.'],
  'closer'    => ['Big closing line', 'Shown large and bold under the message. Leave empty to skip it.'],
  'signature' => ['Signed', 'First line in bold (your name), the next line small (your title).'],
  'intro'     => ['Note at the top', 'Optional. The details of the submission are always added below it.'],
];

/**
 * Every automatic email the site sends.
 *   group:  confirm (to the person who filled in the form) | alert (to the team, SITE_NOTIFY_TO)
 *   parts:  which parts can be edited
 *   vars:   placeholders it understands, with a plain description
 *   always: what code always adds, whatever the wording says
 */
function email_defs(): array {
  static $defs = null;
  if ($defs !== null) return $defs;
  $sig = "Chris Watley\nFounder & CEO, DAD";
  $who = ['first_name' => 'Their first name'];
  $defs = [
    'confirm_founding' => [
      'group' => 'confirm', 'title' => 'Founding Donor confirmation',
      'to' => 'The person who joined the Founding Donor waitlist',
      'when' => 'Right after someone joins the Founding Donor waitlist. Not again if they sign up twice.',
      'parts' => ['subject', 'greeting', 'body', 'closer', 'signature'],
      'vars' => $who + ['referral_link' => 'Their personal referral link'],
      'always' => ['The Unsubscribe link at the bottom', 'The one-click unsubscribe button Gmail and Apple Mail show'],
      'default' => [
        'subject'   => "You're a Founding Donor.",
        'greeting'  => '{first_name},',
        'body'      => "You're on the list. When giving opens in January 2027, you'll be first in, and your Founding Donor badge will be waiting.\n\n"
                     . "Until then, we'll send one update a month, at most, on what we're building, what's late, and what we changed our minds about.",
        'closer'    => "Don't trust us. Watch us.",
        'signature' => $sig,
      ],
    ],
    'confirm_partner' => [
      'group' => 'confirm', 'title' => 'Partner confirmation',
      'to' => 'The person who sent the "Partner with us" form',
      'when' => 'Right after someone sends the "Partner with us" form.',
      'parts' => ['subject', 'greeting', 'body', 'closer', 'signature'],
      'vars' => $who + ['name' => 'Their full name, as typed', 'company' => 'Their company name'],
      'always' => ['A short line at the bottom saying why they got this email'],
      'default' => [
        'subject'   => 'Got it, {first_name}. Let\'s talk.',
        'greeting'  => '{first_name},',
        'body'      => "Thanks for reaching out about partnering with DAD. We read every note ourselves, and a real person from the founding team will reply to you directly.\n\n"
                     . "If there's something we should see before we talk, a deck, a link, a number, just reply to this email.",
        'closer'    => "Don't trust us. Watch us.",
        'signature' => $sig,
      ],
    ],
  ];
  $alerts = [
    'founding'  => ['New Founding Donor: {first_name}', $who + ['email' => 'Their email']],
    'updates'   => ['Build updates sign-up: {first_name}', $who + ['email' => 'Their email']],
    'support'   => ['Support request: {first_name}, ZIP {zip}', $who + ['email' => 'Their email (may be empty)', 'phone' => 'Their phone (may be empty)', 'zip' => 'Their ZIP code']],
    'volunteer' => ['New volunteer: {first_name}, {city}', $who + ['email' => 'Their email', 'city' => 'Their city']],
    'contact'   => ['Message ({topic}) from {name}', ['name' => 'Their name', 'email' => 'Their email', 'topic' => 'What it is about']],
    'partner'   => ['New partner: {name}, {company}', ['name' => 'Their name', 'first_name' => 'Their first name', 'email' => 'Their email', 'company' => 'Their company name']],
  ];
  foreach ($alerts as $type => [$subject, $vars]) {
    $defs['alert_' . $type] = [
      'group' => 'alert', 'title' => 'Team alert: ' . (SITE_TYPE_LABELS[$type] ?? $type),
      'to' => 'The team (' . SITE_NOTIFY_TO . ')',
      'when' => 'Each new ' . strtolower(SITE_TYPE_LABELS[$type] ?? $type) . ' submission'
        . (in_array($type, SITE_NOTIFY_TYPES, true) ? '.' : '. Switched OFF in config.php (SITE_NOTIFY_TYPES), so it is not sent right now.'),
      'parts' => ['subject', 'intro'],
      'vars' => $vars + ['page' => 'The page the form was sent from'],
      'always' => array_merge(['Every field they filled in', 'Who referred them, if anyone', 'A link to the record in this dashboard'],
        in_array($type, ['contact', 'partner'], true) ? ['Reply-to set to their address, so you can just hit Reply'] : []),
      'default' => ['subject' => $subject, 'intro' => ''],
    ];
  }
  return $defs;
}

/** Saved wording for one email (default where nothing is saved). Never throws. */
function email_template(string $key): array {
  $def = email_defs()[$key] ?? null;
  if (!$def) throw new InvalidArgumentException('Unknown email ' . $key);
  $tpl = $def['default'];
  try {
    $row = q('SELECT data FROM email_templates WHERE k = ?', [$key])->fetch();
    if ($row) {
      $saved = json_decode((string)$row['data'], true);
      if (is_array($saved)) foreach ($def['parts'] as $p) if (isset($saved[$p]) && is_string($saved[$p])) $tpl[$p] = $saved[$p];
    }
  } catch (Throwable $e) {
    error_log('[dad-site] email_template: ' . $e->getMessage());
  }
  return $tpl;
}

function email_saved_at(string $key): ?int {
  try {
    $t = q('SELECT updated_at FROM email_templates WHERE k = ?', [$key])->fetchColumn();
    return $t === false ? null : (int)$t;
  } catch (Throwable $e) { return null; }
}

/**
 * Clean the editor's input for one email. Returns [$tpl, $error]; $error is '' when it can be saved.
 */
function email_clean_input(string $key, array $in): array {
  $def = email_defs()[$key];
  $tpl = [];
  foreach ($def['parts'] as $p) {
    $v = $p === 'subject' ? clean_line($in[$p] ?? '') : clean_text($in[$p] ?? '');
    $tpl[$p] = clamp_str($v, $p === 'subject' ? EMAIL_MAX_SUBJECT : EMAIL_MAX_PART);
  }
  if ($tpl['subject'] === '') return [$tpl, 'The subject line cannot be empty.'];
  if (in_array('body', $def['parts'], true) && $tpl['body'] === '') return [$tpl, 'The message cannot be empty.'];
  $unknown = [];
  foreach ($tpl as $v) {
    if (preg_match_all('/\{([A-Za-z0-9_]+)\}/', $v, $m)) {
      foreach ($m[1] as $name) if (!isset($def['vars'][$name])) $unknown['{' . $name . '}'] = true;
    }
  }
  if ($unknown) {
    return [$tpl, 'This email does not know ' . implode(', ', array_keys($unknown)) . '. Use one of: '
      . implode(', ', array_map(fn($n) => '{' . $n . '}', array_keys($def['vars']))) . '.'];
  }
  return [$tpl, ''];
}

function email_save(string $key, array $tpl): void {
  q('INSERT INTO email_templates(k, data, updated_at) VALUES(?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    [$key, json_encode($tpl, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), time()]);
}

function email_reset(string $key): void {
  q('DELETE FROM email_templates WHERE k = ?', [$key]);
}

/** Made-up values used by the preview and "Send me a test". */
function email_sample_vars(): array {
  return [
    'first_name' => 'Jordan', 'name' => 'Jordan Lee', 'email' => 'jordan@example.com', 'phone' => '(555) 010-0199',
    'zip' => '30303', 'city' => 'Atlanta', 'topic' => 'Partnership', 'company' => 'Northwind Foods',
    'referral_link' => referral_url('k7m2p9qx4a'), 'page' => '/get-involved/',
  ];
}

/** Plain-text fill: {name} -> value for every known placeholder; anything else is left as typed. */
function email_fill(string $s, array $vars): string {
  return (string)preg_replace_callback('/\{([A-Za-z0-9_]+)\}/', fn($m) => array_key_exists($m[1], $vars) ? (string)$vars[$m[1]] : $m[0], $s);
}

/** Escaped HTML fill. Typed web addresses and link placeholders become links; line breaks become <br>. */
function email_fill_html(string $s, array $vars, string $linkColor = '#C9340F'): string {
  $parts = preg_split('/(\{[A-Za-z0-9_]+\})/', $s, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [];
  $a = fn(string $url) => '<a href="' . h($url) . '" style="color:' . $linkColor . ';text-decoration:underline;word-break:break-all;">' . h($url) . '</a>';
  $out = '';
  foreach ($parts as $i => $part) {
    if ($i % 2 === 1) {
      $name = substr($part, 1, -1);
      if (!array_key_exists($name, $vars)) { $out .= h($part); continue; }
      $val = (string)$vars[$name];
      $out .= (in_array($name, EMAIL_LINK_VARS, true) && preg_match('~^https?://~', $val)) ? $a($val) : h($val);
    } else {
      // only text Chris typed is auto-linked (never what a visitor typed into a form)
      $out .= (string)preg_replace_callback('~https?://[^\s<>"\']*[^\s<>"\'.,;:!?)]~', fn($m) => $a(html_entity_decode($m[0], ENT_QUOTES, 'UTF-8')), h($part));
    }
  }
  return nl2br($out, false);
}

/**
 * Render a confirmation email (group "confirm").
 * $o: unsubscribe (URL; adds the footer link), footer (plain sentence when there is no unsubscribe link)
 * Returns ['subject', 'text', 'html', 'inner'] (inner = the card alone, for the dashboard preview).
 */
function email_render_confirm(string $key, array $vars, array $o = [], ?array $tpl = null): array {
  $tpl ??= email_template($key);
  $unsub = (string)($o['unsubscribe'] ?? '');
  $footer = (string)($o['footer'] ?? '');

  $subject = clamp_str(clean_line(email_fill($tpl['subject'], $vars)), EMAIL_MAX_SUBJECT);
  $paras = array_values(array_filter(array_map('trim', preg_split('/\n\s*\n/', (string)$tpl['body']) ?: []), fn($p) => $p !== ''));
  $greeting = trim((string)($tpl['greeting'] ?? ''));
  $closer = trim((string)($tpl['closer'] ?? ''));
  $sig = array_values(array_filter(array_map('trim', explode("\n", (string)($tpl['signature'] ?? ''))), fn($l) => $l !== ''));

  // ---- plain text
  $tp = [];
  if ($greeting !== '') $tp[] = email_fill($greeting, $vars);
  foreach ($paras as $p) $tp[] = email_fill($p, $vars);
  if ($closer !== '') $tp[] = email_fill($closer, $vars);
  if ($sig) $tp[] = email_fill(implode("\n", $sig), $vars);
  $text = implode("\n\n", $tp) . "\n";
  if ($unsub !== '') $text .= "\nUnsubscribe: " . $unsub . "\n";
  elseif ($footer !== '') $text .= "\n--\n" . $footer . "\n";

  // ---- HTML (brand card; inline styles only, for email clients)
  $font = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  $disp = "'Space Grotesk',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  $mono = "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
  $msg = '';
  if ($greeting !== '') $msg .= '<p style="margin:0 0 18px;color:#0E1E1E;font-weight:600;">' . email_fill_html($greeting, $vars) . '</p>';
  foreach ($paras as $i => $p) {
    $last = $i === count($paras) - 1;
    $msg .= '<p style="margin:0 0 ' . ($last ? '26' : '18') . 'px;">' . email_fill_html($p, $vars) . '</p>';
  }
  if ($closer !== '') $msg .= '<p style="margin:0 0 28px;font:700 22px/1.25 ' . $disp . ';letter-spacing:-0.02em;color:#0E1E1E;">' . email_fill_html($closer, $vars) . '</p>';
  foreach ($sig as $i => $line) {
    $msg .= $i === 0
      ? '<p style="margin:0;color:#0E1E1E;font-weight:600;">' . email_fill_html($line, $vars) . '</p>'
      : '<p style="margin:4px 0 0;font:500 12px/1.4 ' . $mono . ';letter-spacing:0.14em;text-transform:uppercase;color:#4A5757;">' . email_fill_html($line, $vars) . '</p>';
  }
  $foot = $unsub !== ''
    ? '<a href="' . h($unsub) . '" style="color:#4A5757;text-decoration:underline;">Unsubscribe</a>'
    : h($footer);

  $inner = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E3E6E8;border-radius:18px;">'
    // wordmark: DAD + the two gold tail bars from the logo
    . '<tr><td style="padding:34px 36px 0;">'
    .   '<span style="font:700 26px/1 ' . $disp . ';letter-spacing:-0.03em;color:#0E1E1E;">DAD</span>'
    .   '<span style="display:inline-block;width:5px;height:20px;margin-left:6px;background:#FFB800;border-radius:3px;vertical-align:-2px;"></span>'
    .   '<span style="display:inline-block;width:3px;height:11px;margin-left:4px;background:#FFB800;border-radius:2px;vertical-align:-1px;"></span>'
    . '</td></tr>'
    . '<tr><td style="padding:22px 36px 0;"><div style="width:40px;height:3px;background:#FF4A22;border-radius:2px;line-height:3px;font-size:0;">&nbsp;</div></td></tr>'
    . '<tr><td style="padding:26px 36px 8px;font:16px/1.65 ' . $font . ';color:#4A5757;">' . $msg . '</td></tr>'
    . '<tr><td style="padding:30px 36px 32px;"><div style="border-top:1px solid #E3E6E8;padding-top:18px;font:13px/1.5 ' . $font . ';color:#4A5757;">' . $foot . '</div></td></tr>'
    . '</table>';
  $pre = $paras ? email_fill($paras[0], $vars) : '';
  $html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    . '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>' . h($subject) . '</title></head>'
    . '<body style="margin:0;padding:0;background:#F8F9FA;-webkit-text-size-adjust:100%;">'
    . '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F8F9FA;">' . h($pre) . '</div>'
    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8F9FA;"><tr><td align="center" style="padding:40px 16px;">'
    . $inner
    . '</td></tr></table></body></html>';

  return ['subject' => $subject, 'text' => $text, 'html' => $html, 'inner' => $inner];
}

/**
 * Team alert for one submission (group "alert"). Returns [subject, body] (plain text).
 * $ctx: page, pid, when (unix time), ref_line (already formatted, or ''), resub (bool)
 */
function email_render_alert(string $type, array $fields, array $ctx, ?array $tpl = null): array {
  $tpl ??= email_template('alert_' . $type);
  $vars = $fields;
  $vars['page'] = (string)($ctx['page'] ?? '/');
  if (!isset($vars['first_name']) && isset($vars['name'])) $vars['first_name'] = first_word((string)$vars['name']);
  $who = (string)($fields['first_name'] ?? $fields['name'] ?? '');

  $lines = [];
  foreach (['first_name' => 'First name', 'name' => 'Name', 'email' => 'Email', 'phone' => 'Phone', 'zip' => 'ZIP',
            'city' => 'City', 'topic' => 'About', 'company' => 'Company'] as $k => $label) {
    if (isset($fields[$k]) && $fields[$k] !== '') $lines[] = str_pad($label . ':', 14) . $fields[$k];
  }
  if (!empty($ctx['ref_line'])) $lines[] = str_pad('Referred by:', 14) . $ctx['ref_line'];
  $lines[] = str_pad('Page:', 14) . $vars['page'];
  $lines[] = str_pad('When:', 14) . date('D M j, g:i A T', (int)($ctx['when'] ?? time()));

  $intro = trim(email_fill((string)($tpl['intro'] ?? ''), $vars));
  $body = ($intro !== '' ? $intro . "\n\n" : '') . implode("\n", $lines) . "\n";
  if ($type === 'contact') $body .= "\n" . ($fields['message'] ?? '') . "\n\nReply to this email to answer " . $who . " directly.\n";
  if ($type === 'partner') {
    $body .= "\n" . (($fields['note'] ?? '') !== '' ? "Note:\n" . $fields['note'] . "\n" : "(No note.)\n")
      . "\nReply to this email to answer " . $who . " directly.\n";
  }
  if (!empty($ctx['resub'])) $body .= "\nThis person had unsubscribed before and just signed up again.\n";
  $body .= "\nDashboard: " . rtrim(SITE_BASE, '/') . '/api/admin/?q=' . rawurlencode((string)($ctx['pid'] ?? '')) . "\n";

  $subject = clamp_str(clean_line(email_fill((string)$tpl['subject'], $vars)), 120);
  if ($subject === '') $subject = 'New form submission';
  return [$subject, $body];
}

function first_word(string $name): string {
  $w = preg_split('/\s+/u', trim($name)) ?: [''];
  return (string)$w[0];
}
