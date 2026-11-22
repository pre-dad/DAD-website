<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Header building in api/lib/mail.php: the defence against header injection. */
final class MailTest extends TestCase
{
    public function testMimeHeaderLeavesPlainAsciiAlone(): void
    {
        $this->assertSame("You're a Founding Donor.", mime_header("You're a Founding Donor."));
    }

    public function testMimeHeaderCannotStartANewHeader(): void
    {
        $h = mime_header("Hi\r\nBcc: victim@example.com");
        $this->assertStringNotContainsString("\r", $h);
        $this->assertStringNotContainsString("\n", $h);
    }

    public function testMimeHeaderEncodesNonAscii(): void
    {
        $h = mime_header('Gracias, María');
        $this->assertMatchesRegularExpression('/^[\x20-\x7E]+$/', $h);
        $this->assertStringContainsString('=?UTF-8?B?', $h);
        $this->assertSame('Gracias, María', mb_decode_mimeheader($h));
    }

    public function testMimeAddressStripsCharactersThatCouldBreakOutOfTheName(): void
    {
        $this->assertSame('"Eve Bcc: x@y.z" <a@b.co>', mime_address("Eve\r\nBcc: x@y.z", 'a@b.co'));
        $this->assertSame('Eve evil <a@b.co>', mime_address('Eve<evil>', 'a@b.co'));
        $this->assertStringNotContainsString('"', mime_address('"Eve" evil', 'a@b.co'));
    }

    public function testMimeAddressQuotesPunctuationAndOmitsAnEmptyName(): void
    {
        $this->assertSame('DAD Website <a@b.co>', mime_address('DAD Website', 'a@b.co'));
        $this->assertSame('"DAD, Inc." <a@b.co>', mime_address('DAD, Inc.', 'a@b.co'));
        $this->assertSame('a@b.co', mime_address('', 'a@b.co'));
    }

    public function testAddrOkRejectsInjectionAndInvalidAddresses(): void
    {
        $this->assertTrue(addr_ok('hello@dynamicaid.org'));
        $this->assertFalse(addr_ok("hello@dynamicaid.org\r\nBcc: x@y.z"));
        $this->assertFalse(addr_ok('not an address'));
        $this->assertFalse(addr_ok(''));
    }

    public function testSmtpMessageNamesTheRecipientAndSubject(): void
    {
        $msg = smtp_message('to@b.co', 'Hello', ['From: a@b.co', 'Date: today'], 'body');
        $this->assertStringStartsWith("Subject: Hello\r\nTo: to@b.co\r\nFrom: a@b.co\r\nDate: today\r\n\r\nbody", $msg);
    }

    public function testSmtpPasswordIsOnlySentOverStarttlsOrToThisMachine(): void
    {
        $this->assertTrue(smtp_secure_ok('email-smtp.us-east-1.amazonaws.com', 'tls'));
        $this->assertTrue(smtp_secure_ok('127.0.0.1', ''));
        $this->assertFalse(smtp_secure_ok('email-smtp.us-east-1.amazonaws.com', ''));
        $this->assertFalse(smtp_secure_ok('email-smtp.us-east-1.amazonaws.com', 'none'));
        $this->assertFalse(smtp_send('email-smtp.us-east-1.amazonaws.com', 587, 'none', 'u', 'p', 'a@b.co', 'c@d.co', 'x'));
    }

    // ---- smtp_send against a fake server on loopback -----------------------

    /** @var resource[] */
    private array $procs = [];
    private string $transcript = '';

    protected function tearDown(): void
    {
        foreach ($this->procs as $p) proc_close($p);
        $this->procs = [];
        if ($this->transcript !== '' && is_file($this->transcript)) unlink($this->transcript);
    }

    private function startServer(string $refuse = ''): int
    {
        $this->transcript = tempnam(sys_get_temp_dir(), 'smtp-');
        $cmd = [PHP_BINARY, __DIR__ . '/fixtures/fake-smtp.php', $this->transcript];
        if ($refuse !== '') $cmd[] = $refuse;
        $proc = proc_open($cmd, [1 => ['pipe', 'w']], $pipes);
        $this->assertIsResource($proc);
        $this->procs[] = $proc;
        $port = (int)trim((string)fgets($pipes[1]));
        $this->assertGreaterThan(0, $port, 'fake SMTP server did not start');
        return $port;
    }

    private function sent(): string
    {
        foreach ($this->procs as $p) proc_close($p);
        $this->procs = [];
        return (string)file_get_contents($this->transcript);
    }

    public function testSmtpSendDeliversTheMessageWithTheEnvelopeAndLoginSteps(): void
    {
        $port = $this->startServer();
        $ok = smtp_send('127.0.0.1', $port, '', 'user', 'pass', 'from@b.co', 'to@d.co', "Subject: Hi\r\n\r\nbody");
        $this->assertTrue($ok);
        $log = explode("\n", $this->sent());
        $this->assertSame('EHLO b.co', $log[0]);
        $this->assertContains('AUTH LOGIN', $log);
        $this->assertContains(base64_encode('user'), $log);
        $this->assertContains(base64_encode('pass'), $log);
        $this->assertContains('MAIL FROM:<from@b.co>', $log);
        $this->assertContains('RCPT TO:<to@d.co>', $log);
        $this->assertContains('Subject: Hi', $log);
        $this->assertContains('QUIT', $log);
    }

    public function testSmtpSendDotStuffsLeadingDotsInTheBody(): void
    {
        $port = $this->startServer();
        $ok = smtp_send('127.0.0.1', $port, '', 'u', 'p', 'a@b.co', 'c@d.co', "Subject: x\r\n\r\n.hidden\r\n..two\r\nplain");
        $this->assertTrue($ok);
        $log = explode("\n", $this->sent());
        $this->assertContains('..hidden', $log);
        $this->assertContains('...two', $log);
        $this->assertContains('plain', $log);
        $this->assertNotContains('.hidden', $log);
    }

    public static function stageProvider(): array
    {
        return [['EHLO'], ['AUTH'], ['USER'], ['PASS'], ['MAIL'], ['RCPT'], ['DATA'], ['END']];
    }

    #[DataProvider('stageProvider')]
    public function testSmtpSendFailsWhenTheServerRefusesAStage(string $stage): void
    {
        $port = $this->startServer($stage);
        $this->assertFalse(smtp_send('127.0.0.1', $port, '', 'u', 'p', 'a@b.co', 'c@d.co', "Subject: x\r\n\r\nbody"));
    }

    public function testSmtpSendFailsWhenNothingIsListening(): void
    {
        $probe = stream_socket_server('tcp://127.0.0.1:0');
        $port = (int)explode(':', (string)stream_socket_get_name($probe, false))[1];
        fclose($probe);
        $this->assertFalse(smtp_send('127.0.0.1', $port, '', 'u', 'p', 'a@b.co', 'c@d.co', 'x'));
    }

    // ---- compose_mail: the assembled message -------------------------------

    public function testComposeMailRejectsAnInvalidAddress(): void
    {
        $this->assertNull(compose_mail('not an address', 'x', null, []));
        $this->assertNull(compose_mail('to@b.co', 'x', null, ['reply_to' => "r@b.co\r\nBcc: x@y.z"]));
        $this->assertNull(compose_mail('to@b.co', 'x', null, ['from' => 'nope']));
    }

    public function testComposeMailPlainTextIsQuotedPrintableWithListHeaders(): void
    {
        [$from, $hdr, $body] = compose_mail('to@b.co', "Caf\u{e9}\nline", null, [
            'from' => 'hello@dynamicaid.test', 'from_name' => 'DAD', 'reply_to' => 'r@dynamicaid.test',
            'unsubscribe' => 'https://dynamicaid.test/u?t=1', 'auto' => true,
        ]);
        $this->assertSame('hello@dynamicaid.test', $from);
        $this->assertContains('From: DAD <hello@dynamicaid.test>', $hdr);
        $this->assertContains('Reply-To: r@dynamicaid.test', $hdr);
        $this->assertContains('Content-Type: text/plain; charset=UTF-8', $hdr);
        $this->assertContains('Content-Transfer-Encoding: quoted-printable', $hdr);
        $this->assertContains('List-Unsubscribe: <https://dynamicaid.test/u?t=1>, <mailto:hello@dynamicaid.test?subject=unsubscribe>', $hdr);
        $this->assertContains('List-Unsubscribe-Post: List-Unsubscribe=One-Click', $hdr);
        $this->assertContains('Auto-Submitted: auto-generated', $hdr);
        $this->assertSame("Caf=C3=A9\r\nline", $body);
        $this->assertMatchesRegularExpression('/^Message-ID: <[a-f0-9]{24}@dynamicaid\.test>$/m', implode("\n", $hdr));
    }

    public function testComposeMailWithHtmlIsMultipartWithBothParts(): void
    {
        [, $hdr, $body] = compose_mail('to@b.co', 'plain', '<p>html</p>', []);
        $type = implode("\n", array_filter($hdr, static fn($h) => str_starts_with($h, 'Content-Type:')));
        $this->assertMatchesRegularExpression('/^Content-Type: multipart\/alternative; boundary="(dad-[a-f0-9]+)"$/', $type);
        preg_match('/boundary="([^"]+)"/', $type, $m);
        $this->assertStringContainsString('--' . $m[1] . "\r\nContent-Type: text/plain", $body);
        $this->assertStringContainsString('--' . $m[1] . "\r\nContent-Type: text/html", $body);
        $this->assertStringEndsWith('--' . $m[1] . "--\r\n", $body);
        $this->assertStringContainsString('<p>html</p>', $body);
    }

    public function testComposeMailDropsAnUnsafeUnsubscribeUrl(): void
    {
        [, $hdr] = compose_mail('to@b.co', 'x', null, ['unsubscribe' => "https://x/\r\nBcc: v@y.z"]);
        foreach ($hdr as $h) $this->assertStringStartsNotWith('List-Unsubscribe', $h);
    }
}
