<?php
// Form validation. One function per the forms contract; returns either the clean fields or the
// first problem, in the order the fields appear on the form.
declare(strict_types=1);
defined('SITE_API') || exit;

// Wording matches src/js/core/forms.js so a visitor sees the same message whichever side catches it.
const MSG_GENERIC = 'Something went wrong. Please try again.';

function v_err(string $error, ?string $field = null): array {
  $r = ['ok' => false, 'error' => $error];
  if ($field !== null) $r['field'] = $field;
  return $r;
}

function valid_email(string $e): bool {
  if ($e === '' || strlen($e) > 254) return false;
  if (filter_var($e, FILTER_VALIDATE_EMAIL) === false) return false;
  return (bool)preg_match('/@([a-z0-9-]+\.)+[a-z0-9-]{2,}$/i', $e);   // needs a real domain with a dot
}

/** First names go into an email we send to that address, so keep them to name characters only. */
function valid_first_name(string $s): bool {
  return mb_strlen($s) <= 60
    && (bool)preg_match("/^[\\p{L}\\p{M}][\\p{L}\\p{M} '\u{2019}.\\-]*$/u", $s)
    && !preg_match('/\p{L}{2,}\.\p{L}{2,}/u', $s);   // no "www.site.com" (initials like "J.R." are fine)
}

function valid_phone(string $s): bool {
  if (!preg_match('/^[0-9+().\-\s]{7,25}$/', $s)) return false;
  $digits = strlen((string)preg_replace('/\D/', '', $s));
  return $digits >= 10 && $digits <= 15;
}

/**
 * @param string $type one of SITE_TYPES
 * @param array  $in   raw input (decoded JSON or $_POST)
 * @return array ['ok'=>true, 'fields'=>[...], 'email'=>?string] or ['ok'=>false, 'error'=>..., 'field'=>...]
 */
function validate_submission(string $type, array $in): array {
  $f = [];

  // ---- first_name (founding, updates, support, volunteer) / name (contact, partner)
  if ($type === 'contact' || $type === 'partner') {
    $name = clean_line($in['name'] ?? '');
    if ($name === '') return v_err('Please add your name.', 'name');
    if (mb_strlen($name) > 120 || preg_match('/[<>]/', $name)) return v_err('Please enter just your name.', 'name');
    $f['name'] = $name;
  } else {
    $first = clean_line($in['first_name'] ?? '');
    if ($first === '') return v_err('Please add your first name.', 'first_name');
    if (!valid_first_name($first)) return v_err('Please enter just your first name.', 'first_name');
    $f['first_name'] = $first;
  }

  // ---- email (and phone for support)
  if ($type === 'support') {
    // The form has one "Email or phone" box (name="email_or_phone"; the JS splits it into email/phone).
    // Accept it under any of the three keys and work out which it is.
    $email = ''; $phone = '';
    $seen = false;
    foreach (['email', 'phone', 'email_or_phone'] as $key) {
      $val = clean_line($in[$key] ?? '');
      if ($val === '') continue;
      $seen = true;
      if (str_contains($val, '@')) {
        $val = strtolower($val);
        if (!valid_email($val)) return v_err("That email doesn't look right.", $key);
        if ($email === '') $email = $val;
      } else {
        if (!valid_phone($val)) return v_err("That phone number doesn't look right.", $key);
        if ($phone === '') $phone = $val;
      }
    }
    if (!$seen) {
      $key = array_key_exists('email_or_phone', $in) ? 'email_or_phone'
        : ((array_key_exists('phone', $in) && !array_key_exists('email', $in)) ? 'phone' : 'email');
      return v_err('Please add an email or a phone number.', $key);
    }
    if ($email !== '') $f['email'] = $email;
    if ($phone !== '') $f['phone'] = $phone;
  } else {
    $email = strtolower(clean_line($in['email'] ?? ''));
    if ($email === '') return v_err('Please add your email.', 'email');
    if (!valid_email($email)) return v_err("That email doesn't look right.", 'email');
    $f['email'] = $email;
  }

  // ---- type-specific fields
  if ($type === 'support') {
    $zip = clean_line($in['zip'] ?? '');
    if (!preg_match('/^\d{5}$/', $zip)) return v_err('Please add a 5-digit ZIP code.', 'zip');
    $f['zip'] = $zip;
  } elseif ($type === 'volunteer') {
    $city = clean_line($in['city'] ?? '');
    if ($city === '') return v_err('Please add your city.', 'city');
    if (mb_strlen($city) > 100 || preg_match('/[<>]/', $city) || !preg_match('/\p{L}/u', $city)) return v_err('Please enter just your city.', 'city');
    $f['city'] = $city;
  } elseif ($type === 'contact') {
    $topicIn = clean_line($in['topic'] ?? '');
    $topic = null;
    foreach (SITE_TOPICS as $t) { if (strcasecmp($t, $topicIn) === 0) { $topic = $t; break; } }
    if ($topic === null) return v_err('Please choose what this is about.', 'topic');
    $f['topic'] = $topic;
    $msg = clean_text($in['message'] ?? '');
    if ($msg === '') return v_err('Please add a message.', 'message');
    if (mb_strlen($msg) > 5000) return v_err('Please keep your message under 5,000 characters.', 'message');
    $f['message'] = $msg;
  } elseif ($type === 'partner') {
    $company = clean_line($in['company'] ?? '');
    if ($company === '') return v_err('Please add your company name.', 'company');
    if (mb_strlen($company) > 160 || preg_match('/[<>]/', $company)) return v_err('Please enter just your company name.', 'company');
    $f['company'] = $company;
    $note = clean_text($in['note'] ?? '');          // optional
    if (mb_strlen($note) > 2000) return v_err('Please keep your note under 2,000 characters.', 'note');
    if ($note !== '') $f['note'] = $note;
  }

  return ['ok' => true, 'fields' => $f, 'email' => $f['email'] ?? null];
}
