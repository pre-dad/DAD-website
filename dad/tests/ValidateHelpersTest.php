<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Unit tests for the validation predicates in api/lib/validate.php. */
final class ValidateHelpersTest extends TestCase
{
    // ---- valid_email -------------------------------------------------------

    public static function emailProvider(): array
    {
        return [
            'simple'              => ['a@b.co', true],
            'subdomain'           => ['user@sub.domain.org', true],
            'empty'               => ['', false],
            'no dot in domain'    => ['a@b', false],
            'not an email'        => ['not-an-email', false],
            'too long'            => [str_repeat('a', 250) . '@b.co', false],
            'bad domain'          => ['a@-bad', false],
        ];
    }

    #[DataProvider('emailProvider')]
    public function testValidEmail(string $email, bool $expected): void
    {
        $this->assertSame($expected, valid_email($email));
    }

    // ---- valid_first_name --------------------------------------------------

    public static function firstNameProvider(): array
    {
        return [
            'initials'              => ['J.R.', true],
            'accented'              => ['María', true],
            'apostrophe'            => ["O'Hara", true],
            'curly apostrophe'      => ["O\u{2019}Hara", true],
            'hyphenated'            => ['Jean-Luc', true],
            'domain-like rejected'  => ['www.site.com', false],
            'empty rejected'        => ['', false],
            'too long rejected'     => [str_repeat('a', 61), false],
            'digits rejected'       => ['José3', false],
            'angle brackets'        => ['<b>', false],
        ];
    }

    #[DataProvider('firstNameProvider')]
    public function testValidFirstName(string $name, bool $expected): void
    {
        $this->assertSame($expected, valid_first_name($name));
    }

    // ---- valid_phone -------------------------------------------------------

    public static function phoneProvider(): array
    {
        return [
            'dashed'                => ['555-123-4567', true],
            'parenthesized'         => ['(555) 123-4567', true],
            'intl spaced'           => ['+1 (555) 123 4567', true],
            'too few digits'        => ['12345', false],
            'letters'               => ['abcdefg', false],
            'too many digits'       => ['1234567890123456', false],
            'too short overall'     => ['555-12', false],
        ];
    }

    #[DataProvider('phoneProvider')]
    public function testValidPhone(string $phone, bool $expected): void
    {
        $this->assertSame($expected, valid_phone($phone));
    }

    // ---- v_err -------------------------------------------------------------

    public function testVErrWithField(): void
    {
        $this->assertSame(
            ['ok' => false, 'error' => 'Nope.', 'field' => 'email'],
            v_err('Nope.', 'email')
        );
    }

    public function testVErrWithoutFieldOmitsFieldKey(): void
    {
        $r = v_err('Nope.');
        $this->assertSame(['ok' => false, 'error' => 'Nope.'], $r);
        $this->assertArrayNotHasKey('field', $r);
    }
}
