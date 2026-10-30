<?php
// Form types and labels shared by the API and its tests.
declare(strict_types=1);
defined('SITE_API') || exit;

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
