<?php
declare(strict_types=1);

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
}
