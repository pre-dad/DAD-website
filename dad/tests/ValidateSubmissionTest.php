<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** The per-type matrix for validate_submission(). */
final class ValidateSubmissionTest extends TestCase
{
    public static function listTypeProvider(): array
    {
        return [['founding'], ['updates']];
    }

    #[DataProvider('listTypeProvider')]
    public function testListTypeSuccess(string $type): void
    {
        $r = validate_submission($type, ['first_name' => 'Jamie', 'email' => 'Jamie@Example.COM']);
        $this->assertTrue($r['ok']);
        $this->assertSame('Jamie', $r['fields']['first_name']);
        $this->assertSame('jamie@example.com', $r['fields']['email']);  // lowercased
        $this->assertSame('jamie@example.com', $r['email']);
    }

    #[DataProvider('listTypeProvider')]
    public function testListTypeMissingFirstName(string $type): void
    {
        $r = validate_submission($type, ['email' => 'a@b.co']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please add your first name.', 'field' => 'first_name'],
            $r
        );
    }

    #[DataProvider('listTypeProvider')]
    public function testListTypeBadFirstName(string $type): void
    {
        $r = validate_submission($type, ['first_name' => 'www.site.com', 'email' => 'a@b.co']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please enter just your first name.', 'field' => 'first_name'],
            $r
        );
    }

    #[DataProvider('listTypeProvider')]
    public function testListTypeMissingEmail(string $type): void
    {
        $r = validate_submission($type, ['first_name' => 'Jamie']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please add your email.', 'field' => 'email'],
            $r
        );
    }

    #[DataProvider('listTypeProvider')]
    public function testListTypeBadEmail(string $type): void
    {
        $r = validate_submission($type, ['first_name' => 'Jamie', 'email' => 'nope']);
        $this->assertSame(
            ['ok' => false, 'error' => "That email doesn't look right.", 'field' => 'email'],
            $r
        );
    }

    public function testSupportSuccessEmailOrPhoneHoldingEmail(): void
    {
        $r = validate_submission('support', ['first_name' => 'Sam', 'email_or_phone' => 'Sam@Example.com', 'zip' => '90210']);
        $this->assertTrue($r['ok']);
        $this->assertSame('sam@example.com', $r['fields']['email']);
        $this->assertArrayNotHasKey('phone', $r['fields']);
        $this->assertSame('90210', $r['fields']['zip']);
    }

    public function testSupportSuccessEmailOrPhoneHoldingPhone(): void
    {
        $r = validate_submission('support', ['first_name' => 'Sam', 'email_or_phone' => '555-123-4567', 'zip' => '90210']);
        $this->assertTrue($r['ok']);
        $this->assertSame('555-123-4567', $r['fields']['phone']);
        $this->assertArrayNotHasKey('email', $r['fields']);
        $this->assertNull($r['email']);
    }

    public function testSupportSuccessSeparateEmailAndZip(): void
    {
        $r = validate_submission('support', ['first_name' => 'Sam', 'email' => 'sam@place.org', 'zip' => '12345']);
        $this->assertTrue($r['ok']);
        $this->assertSame('sam@place.org', $r['fields']['email']);
        $this->assertSame('12345', $r['fields']['zip']);
    }

    public function testSupportBadEmailValueFieldIsKeyUsed(): void
    {
        $r = validate_submission('support', ['first_name' => 'Sam', 'email_or_phone' => 'bad@nope', 'zip' => '12345']);
        $this->assertSame(
            ['ok' => false, 'error' => "That email doesn't look right.", 'field' => 'email_or_phone'],
            $r
        );
    }

    public function testSupportBadPhoneValue(): void
    {
        $r = validate_submission('support', ['first_name' => 'Sam', 'phone' => '12345', 'zip' => '12345']);
        $this->assertSame(
            ['ok' => false, 'error' => "That phone number doesn't look right.", 'field' => 'phone'],
            $r
        );
    }

    public function testSupportNeitherEmailNorPhoneWithEmailOrPhoneKey(): void
    {
        $r = validate_submission('support', ['first_name' => 'Sam', 'email_or_phone' => '', 'zip' => '12345']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please add an email or a phone number.', 'field' => 'email_or_phone'],
            $r
        );
    }

    public function testSupportNeitherDefaultsToEmailField(): void
    {
        // No email/phone/email_or_phone keys present at all → field resolves to 'email'.
        $r = validate_submission('support', ['first_name' => 'Sam', 'zip' => '12345']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please add an email or a phone number.', 'field' => 'email'],
            $r
        );
    }

    public function testSupportNeitherPhoneKeyOnlyResolvesToPhone(): void
    {
        // phone key present (empty) and no email key → field resolves to 'phone'.
        $r = validate_submission('support', ['first_name' => 'Sam', 'phone' => '', 'zip' => '12345']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please add an email or a phone number.', 'field' => 'phone'],
            $r
        );
    }

    public function testSupportKeepsBothAnEmailAndAPhone(): void
    {
        $r = validate_submission('support', ['first_name' => 'Sam', 'email' => 'Sam@Place.org', 'phone' => '(555) 123-4567', 'zip' => '12345']);
        $this->assertTrue($r['ok']);
        $this->assertSame('sam@place.org', $r['fields']['email']);
        $this->assertSame('(555) 123-4567', $r['fields']['phone']);
        $this->assertSame('sam@place.org', $r['email']);
    }

    public function testSupportBadZip(): void
    {
        $r = validate_submission('support', ['first_name' => 'Sam', 'email' => 'sam@place.org', 'zip' => '1234']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please add a 5-digit ZIP code.', 'field' => 'zip'],
            $r
        );
    }

    public function testVolunteerSuccess(): void
    {
        $r = validate_submission('volunteer', ['first_name' => 'Lee', 'email' => 'lee@place.org', 'city' => 'Austin']);
        $this->assertTrue($r['ok']);
        $this->assertSame('Austin', $r['fields']['city']);
    }

    public function testVolunteerMissingCity(): void
    {
        $r = validate_submission('volunteer', ['first_name' => 'Lee', 'email' => 'lee@place.org', 'city' => '']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please add your city.', 'field' => 'city'],
            $r
        );
    }

    public function testVolunteerInvalidCityAngleBracket(): void
    {
        $r = validate_submission('volunteer', ['first_name' => 'Lee', 'email' => 'lee@place.org', 'city' => '<script>']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please enter just your city.', 'field' => 'city'],
            $r
        );
    }

    public function testVolunteerInvalidCityNoLetter(): void
    {
        $r = validate_submission('volunteer', ['first_name' => 'Lee', 'email' => 'lee@place.org', 'city' => '12345']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please enter just your city.', 'field' => 'city'],
            $r
        );
    }

    public function testContactSuccessTopicCanonicalized(): void
    {
        $r = validate_submission('contact', [
            'name' => 'Pat Doe', 'email' => 'pat@place.org',
            'topic' => 'giving', 'message' => 'Hello there.',
        ]);
        $this->assertTrue($r['ok']);
        $this->assertSame('Pat Doe', $r['fields']['name']);
        $this->assertSame('Giving', $r['fields']['topic']);   // canonical case from SITE_TOPICS
        $this->assertSame('Hello there.', $r['fields']['message']);
    }

    public function testContactEmptyName(): void
    {
        $r = validate_submission('contact', ['name' => '', 'email' => 'pat@place.org', 'topic' => 'Giving', 'message' => 'Hi']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please add your name.', 'field' => 'name'],
            $r
        );
    }

    public function testContactNameWithAngleBrackets(): void
    {
        $r = validate_submission('contact', ['name' => 'Pat <b>', 'email' => 'pat@place.org', 'topic' => 'Giving', 'message' => 'Hi']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please enter just your name.', 'field' => 'name'],
            $r
        );
    }

    public function testContactInvalidTopic(): void
    {
        $r = validate_submission('contact', ['name' => 'Pat', 'email' => 'pat@place.org', 'topic' => 'Nonsense', 'message' => 'Hi']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please choose what this is about.', 'field' => 'topic'],
            $r
        );
    }

    public function testContactMissingMessage(): void
    {
        $r = validate_submission('contact', ['name' => 'Pat', 'email' => 'pat@place.org', 'topic' => 'Giving', 'message' => '']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please add a message.', 'field' => 'message'],
            $r
        );
    }

    public function testContactMessageTooLong(): void
    {
        $r = validate_submission('contact', [
            'name' => 'Pat', 'email' => 'pat@place.org', 'topic' => 'Giving',
            'message' => str_repeat('x', 5001),
        ]);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please keep your message under 5,000 characters.', 'field' => 'message'],
            $r
        );
    }

    public function testPartnerSuccessWithNote(): void
    {
        $r = validate_submission('partner', [
            'name' => 'Pat', 'email' => 'pat@place.org',
            'company' => 'Acme Inc', 'note' => 'Lets talk.',
        ]);
        $this->assertTrue($r['ok']);
        $this->assertSame('Acme Inc', $r['fields']['company']);
        $this->assertSame('Lets talk.', $r['fields']['note']);
    }

    public function testPartnerSuccessEmptyNoteOmitted(): void
    {
        $r = validate_submission('partner', [
            'name' => 'Pat', 'email' => 'pat@place.org',
            'company' => 'Acme Inc', 'note' => '',
        ]);
        $this->assertTrue($r['ok']);
        $this->assertArrayNotHasKey('note', $r['fields']);
    }

    public function testPartnerMissingCompany(): void
    {
        $r = validate_submission('partner', ['name' => 'Pat', 'email' => 'pat@place.org', 'company' => '']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please add your company name.', 'field' => 'company'],
            $r
        );
    }

    public function testPartnerCompanyTooLong(): void
    {
        $r = validate_submission('partner', [
            'name' => 'Pat', 'email' => 'pat@place.org',
            'company' => str_repeat('A', 161),
        ]);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please enter just your company name.', 'field' => 'company'],
            $r
        );
    }

    public function testPartnerCompanyAngleBrackets(): void
    {
        $r = validate_submission('partner', ['name' => 'Pat', 'email' => 'pat@place.org', 'company' => 'Acme <b>']);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please enter just your company name.', 'field' => 'company'],
            $r
        );
    }

    public function testPartnerNoteTooLong(): void
    {
        $r = validate_submission('partner', [
            'name' => 'Pat', 'email' => 'pat@place.org',
            'company' => 'Acme Inc', 'note' => str_repeat('x', 2001),
        ]);
        $this->assertSame(
            ['ok' => false, 'error' => 'Please keep your note under 2,000 characters.', 'field' => 'note'],
            $r
        );
    }

    // ---- boundaries and extra branches ------------------------------------

    public function testValuesExactlyAtTheirLimitsAreAccepted(): void
    {
        $this->assertTrue(validate_submission('contact', [
            'name' => str_repeat('n', 120), 'email' => 'a@place.org', 'topic' => 'Giving', 'message' => str_repeat('m', 5000),
        ])['ok']);
        $this->assertTrue(validate_submission('partner', [
            'name' => 'Pat', 'email' => 'pat@place.org', 'company' => 'Acme Inc', 'note' => str_repeat('x', 2000),
        ])['ok']);
        $this->assertTrue(validate_submission('volunteer', [
            'first_name' => 'Lee', 'email' => 'lee@place.org', 'city' => str_repeat('a', 100),
        ])['ok']);
    }

    public function testNameAndCityOverTheLimitAreRejected(): void
    {
        $r = validate_submission('contact', ['name' => str_repeat('n', 121), 'email' => 'a@place.org', 'topic' => 'Giving', 'message' => 'Hello']);
        $this->assertSame(['ok' => false, 'error' => 'Please enter just your name.', 'field' => 'name'], $r);
        $r = validate_submission('volunteer', ['first_name' => 'Lee', 'email' => 'lee@place.org', 'city' => str_repeat('a', 101)]);
        $this->assertSame(['ok' => false, 'error' => 'Please enter just your city.', 'field' => 'city'], $r);
    }

    public function testPlusAddressingAndSurroundingSpacesAreAcceptedInEmail(): void
    {
        $r = validate_submission('updates', ['first_name' => 'Pat', 'email' => '  pat+news@place.org  ']);
        $this->assertTrue($r['ok']);
        $this->assertSame('pat+news@place.org', $r['email']);
    }

    // ---- unknown type ------------------------------------------------------

    public function testUnknownTypeIsRejected(): void
    {
        $r = validate_submission('mystery', ['first_name' => 'Pat', 'email' => 'pat@place.org']);
        $this->assertSame(['ok' => false, 'error' => MSG_GENERIC], $r);
    }
}
