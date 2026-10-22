<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Unit tests for the pure helpers in api/lib/util.php. */
final class UtilTest extends TestCase
{
    // ---- is_quiet ----------------------------------------------------------

    public static function quietProvider(): array
    {
        return [
            'null is not quiet'            => [null, false],
            'empty string is not quiet'    => ['', false],
            'example.com is quiet'         => ['a@example.com', true],
            'case-insensitive domain'      => ['a@EXAMPLE.com', true],
            'different domain not quiet'    => ['a@notexample.com', false],
            'subdomain spoof not quiet'    => ['a@example.com.evil.com', false],
        ];
    }

    #[DataProvider('quietProvider')]
    public function testIsQuiet(?string $email, bool $expected): void
    {
        $this->assertSame($expected, is_quiet($email));
    }

    // ---- clean_line --------------------------------------------------------

    public function testCleanLineCollapsesAndTrims(): void
    {
        $this->assertSame('a b', clean_line("  a\tb  "));
    }

    public function testCleanLineStripsControlAndZeroWidth(): void
    {
        // The control/zero-width class is replaced with a space (then whitespace is
        // collapsed and trimmed), so an interior zero-width or control char leaves a space.
        $this->assertSame('a b', clean_line("a\u{200B}b"));
        $this->assertSame('a b', clean_line("a\x01b"));
        // A leading zero-width char becomes a leading space and is trimmed away.
        $this->assertSame('ab', clean_line("\u{200B}ab"));
    }

    public function testCleanLineNonStringBecomesEmpty(): void
    {
        $this->assertSame('', clean_line(null));
        $this->assertSame('', clean_line(['x']));
        // numeric scalars are allowed through
        $this->assertSame('42', clean_line(42));
    }

    // ---- clean_text --------------------------------------------------------

    public function testCleanTextKeepsNewlines(): void
    {
        $this->assertSame("a\nb", clean_text("a\nb"));
    }

    public function testCleanTextNormalizesCrlfToLf(): void
    {
        $this->assertSame("a\nb", clean_text("a\r\nb"));
        $this->assertSame("a\nb", clean_text("a\rb"));
    }

    public function testCleanTextCollapsesFourPlusNewlines(): void
    {
        $this->assertSame("a\n\n\nb", clean_text("a\n\n\n\n\n\nb"));
    }

    // ---- clamp_str ---------------------------------------------------------

    public function testClampStrMultibyteTruncation(): void
    {
        $this->assertSame('ábc', clamp_str('ábcdé', 3));
    }

    public function testClampStrShortStringUnchanged(): void
    {
        $this->assertSame('hi', clamp_str('hi', 10));
    }

    // ---- mail_domain -------------------------------------------------------

    public function testMailDomainExtractsAfterAt(): void
    {
        $this->assertSame('a.com', mail_domain('x@a.com'));
    }

    public function testMailDomainDefaultsWhenNoAt(): void
    {
        $this->assertSame('dynamicaid.org', mail_domain('no-at-here'));
    }

    // ---- like_escape -------------------------------------------------------

    public function testLikeEscape(): void
    {
        $this->assertSame('50\\%\\_\\\\', like_escape('50%_\\'));
    }
}
