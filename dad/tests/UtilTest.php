<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Unit tests for the pure helpers in api/lib/util.php. */
final class UtilTest extends TestCase
{
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

    public function testCleanLineStripsBidiIsolatesAndMarks(): void
    {
        foreach (["\u{2066}", "\u{2069}", "\u{061C}", "\u{00AD}"] as $c) {
            $this->assertSame('a b', clean_line("a{$c}b"));
        }
    }

    public function testCleanTextStripsBidiIsolatesAndMarks(): void
    {
        $this->assertSame('ab', clean_text("a\u{2066}b\u{2069}"));
        $this->assertSame('ab', clean_text("a\u{061C}b\u{00AD}"));
    }

    public function testAgoRoundsDown(): void
    {
        $this->assertSame('59 min ago', ago(time() - 3599));
        $this->assertSame('23 h ago', ago(time() - 86399));
        $this->assertSame('6 d ago', ago(time() - 86400 * 7 + 1));
    }

    public function testCleanLineNonStringBecomesEmpty(): void
    {
        $this->assertSame('', clean_line(null));
        $this->assertSame('', clean_line(['x']));
        // numeric scalars are allowed through
        $this->assertSame('42', clean_line(42));
    }

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

    public function testClampStrMultibyteTruncation(): void
    {
        $this->assertSame('ábc', clamp_str('ábcdé', 3));
    }

    public function testClampStrAtTheLimitIsUnchanged(): void
    {
        $this->assertSame('ábc', clamp_str('ábc', 3));
        $this->assertSame('', clamp_str('abc', 0));
    }

    public function testCleanTextRemovesZeroWidthWithoutASpace(): void
    {
        $this->assertSame('ab', clean_text("a\u{200B}b"));
        $this->assertSame('ab', clean_text("a\u{FEFF}b"));
    }

    public function testCleanLineAndTextRepairInvalidUtf8(): void
    {
        $this->assertTrue(mb_check_encoding(clean_line("caf\xE9 ok"), 'UTF-8'));
        $this->assertTrue(mb_check_encoding(clean_text("caf\xE9\nok"), 'UTF-8'));
    }

    public function testClampStrShortStringUnchanged(): void
    {
        $this->assertSame('hi', clamp_str('hi', 10));
    }

    public function testMailDomainExtractsAfterAt(): void
    {
        $this->assertSame('a.com', mail_domain('x@a.com'));
    }

    public function testMailDomainDefaultsWhenNoAt(): void
    {
        $this->assertSame('dynamicaid.org', mail_domain('no-at-here'));
    }

    public function testLikeEscape(): void
    {
        $this->assertSame('50\\%\\_\\\\', like_escape('50%_\\'));
    }

    // ---- safe_path ---------------------------------------------------------

    public static function pathProvider(): array
    {
        return [
            'plain path'        => ['/give/', '/give/'],
            'path with query'   => ['/give/?a=1', '/give/?a=1'],
            'empty'             => ['', '/'],
            'protocol-relative' => ['//evil.com', '/'],
            'backslash trick'   => ['/\\evil.com', '/'],
            'absolute url'      => ['https://x', '/'],
            'javascript scheme' => ['javascript:alert(1)', '/'],
            'not a string'      => [['/x'], '/'],
            'clamped to 300'    => ['/' . str_repeat('a', 400), '/' . str_repeat('a', 299)],
        ];
    }

    #[DataProvider('pathProvider')]
    public function testSafePath(mixed $in, string $expected): void
    {
        $this->assertSame($expected, safe_path($in));
    }

    // ---- csv_cell ----------------------------------------------------------

    public static function csvProvider(): array
    {
        return [
            'plain'             => ['Ada', '"Ada"'],
            'quotes doubled'    => ['say "hi"', '"say ""hi"""'],
            'comma kept inside' => ['a,b', '"a,b"'],
            'formula ='         => ['=SUM(A1)', '"\'=SUM(A1)"'],
            'formula +'         => ['+1', '"\'+1"'],
            'formula -'         => ['-1', '"\'-1"'],
            'formula @'         => ['@cmd', '"\'@cmd"'],
            'formula tab'       => ["\tx", "\"'\tx\""],
            'empty'             => ['', '""'],
            'int'               => [5, '"5"'],
        ];
    }

    #[DataProvider('csvProvider')]
    public function testCsvCell(mixed $in, string $expected): void
    {
        $this->assertSame($expected, csv_cell($in));
    }

    public function testCsvLineEndsWithCrlf(): void
    {
        $this->assertSame("\"a\",\"b\"\r\n", csv_line(['a', 'b']));
    }
}
