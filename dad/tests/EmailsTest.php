<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Rendering of the automatic emails (api/lib/emails.php). Visitor input lands in these
 * emails, so escaping and link handling are the security-relevant behaviour.
 */
final class EmailsTest extends TestCase
{
    private const UNSUB = 'https://dynamicaid.test/api/unsubscribe.php?t=0123456789abcdef0123456789abcdef';

    private static function founding(array $vars, array $o = ['unsubscribe' => self::UNSUB]): array
    {
        return email_render_confirm('confirm_founding', $vars + ['referral_link' => referral_url('k7m2p9qx4a')], $o,
            email_defs()['confirm_founding']['default']);
    }

    public function testVisitorInputIsEscapedInTheHtmlEmail(): void
    {
        $r = self::founding(['first_name' => '<img src=x onerror=alert(1)>']);
        $this->assertStringNotContainsString('<img src=x', $r['html']);
        $this->assertStringContainsString('&lt;img src=x onerror=alert(1)&gt;', $r['html']);
        $this->assertStringContainsString('<img src=x onerror=alert(1)>,', $r['text']);
    }

    public function testOnlyTheReferralPlaceholderBecomesALink(): void
    {
        $r = self::founding(['first_name' => 'https://evil.example/phish']);
        $this->assertStringContainsString('href="https://dynamicaid.test/?ref=k7m2p9qx4a"', email_fill_html('{referral_link}', ['referral_link' => referral_url('k7m2p9qx4a')]));
        $this->assertStringNotContainsString('href="https://evil.example', $r['html']);
    }

    public function testANonHttpReferralValueIsNeverLinked(): void
    {
        $html = email_fill_html('{referral_link}', ['referral_link' => 'javascript:alert(1)']);
        $this->assertStringNotContainsString('<a ', $html);
        $this->assertSame('javascript:alert(1)', $html);
    }

    public function testTheListEmailAlwaysCarriesItsUnsubscribeLink(): void
    {
        $tpl = ['subject' => 'Hi', 'greeting' => '', 'body' => 'Short note.', 'closer' => '', 'signature' => ''];
        $r = email_render_confirm('confirm_founding', ['first_name' => 'Ada'], ['unsubscribe' => self::UNSUB], $tpl);
        $this->assertStringContainsString('Unsubscribe: ' . self::UNSUB, $r['text']);
        $this->assertStringContainsString('href="' . h(self::UNSUB) . '"', $r['html']);
    }

    public function testAOneOffEmailShowsItsFooterInsteadOfAnUnsubscribeLink(): void
    {
        $r = email_render_confirm('confirm_partner', ['first_name' => 'Ada', 'name' => 'Ada L', 'company' => 'Acme'],
            ['footer' => PARTNER_EMAIL_FOOTER], email_defs()['confirm_partner']['default']);
        $this->assertSame("Got it, Ada. Let's talk.", $r['subject']);
        $this->assertStringContainsString(PARTNER_EMAIL_FOOTER, $r['text']);
        $this->assertStringNotContainsString('Unsubscribe', $r['text']);
    }

    public function testEditorRejectsUnknownPlaceholdersAndAnEmptySubject(): void
    {
        [, $err] = email_clean_input('confirm_founding', ['subject' => 'Hi {nickname}', 'body' => 'x']);
        $this->assertStringContainsString('does not know {nickname}', $err);

        [, $err] = email_clean_input('confirm_founding', ['subject' => '  ', 'body' => 'x']);
        $this->assertSame('The subject line cannot be empty.', $err);

        [$tpl, $err] = email_clean_input('confirm_founding', ['subject' => "Hi {first_name}\r\nBcc: x@y.z", 'body' => 'x']);
        $this->assertSame('', $err);
        $this->assertSame('Hi {first_name} Bcc: x@y.z', $tpl['subject']);
    }

    public function testTeamAlertListsTheSubmissionAndLinksToTheDashboard(): void
    {
        $fields = ['name' => 'Ada Lovelace', 'email' => 'ada@example.com', 'topic' => 'Press', 'message' => "Line one\nLine two"];
        [$subject, $body] = email_render_alert('contact', $fields,
            ['page' => '/contact/', 'pid' => 'k7m2p9qx4a', 'when' => 0, 'ref_line' => '', 'resub' => false],
            email_defs()['alert_contact']['default']);

        $this->assertSame('Message (Press) from Ada Lovelace', $subject);
        $this->assertStringContainsString("Email:        ada@example.com\n", $body);
        $this->assertStringContainsString("Line one\nLine two", $body);
        $this->assertStringContainsString('Reply to this email to answer Ada Lovelace directly.', $body);
        $this->assertStringContainsString('https://dynamicaid.test/api/admin/?q=k7m2p9qx4a', $body);
    }

    public function testTeamAlertSubjectCannotCarryALineBreak(): void
    {
        [$subject] = email_render_alert('updates', ['first_name' => "Eve\r\nBcc: x@y.z", 'email' => 'e@example.com'],
            ['page' => '/', 'pid' => 'k7m2p9qx4a'], email_defs()['alert_updates']['default']);
        $this->assertStringNotContainsString("\n", $subject);
        $this->assertStringNotContainsString("\r", $subject);
    }
}
