<?php
declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class StripePrivacyTest extends TestCase
{
    private function receipt(): array
    {
        return ['status' => 'complete', 'payment_status' => 'paid',
            'amount_total' => 3000, 'customer_details' => ['name' => 'Ada Example', 'email' => 'ada@example.com']];
    }

    public function testReceiptCannotBeAttachedToAnotherEmail(): void
    {
        $this->assertNull(donor_details($this->receipt(), 'cs_test_syntheticreceipt', 'other@example.com'));
        $receipt = $this->receipt();
        unset($receipt['customer_details']['email']);
        $this->assertNull(donor_details($receipt, 'cs_test_syntheticreceipt', 'ada@example.com'));
    }

    public function testOpenSessionIsNotAGift(): void
    {
        $receipt = $this->receipt();
        $receipt['status'] = 'open';
        $this->assertNull(donor_details($receipt, 'cs_test_syntheticreceipt', 'ada@example.com'));
    }

    public function testFreeCheckoutCountsAsComplete(): void
    {
        $receipt = $this->receipt();
        $receipt['payment_status'] = 'no_payment_required';
        $this->assertTrue(donor_details($receipt, 'cs_test_syntheticreceipt', 'ada@example.com')['verified']);
    }

    public function testMatchingEmailStillRequiresCompletedPayment(): void
    {
        $receipt = $this->receipt();
        $this->assertTrue(donor_details($receipt, 'cs_test_syntheticreceipt', 'ADA@example.com')['verified']);
        $receipt['payment_status'] = 'unpaid';
        $this->assertNull(donor_details($receipt, 'cs_test_syntheticreceipt', 'ada@example.com'));
        $this->assertNull(donor_details(null, 'cs_test_syntheticreceipt', 'ada@example.com'));
    }

    public static function sessionIdProvider(): array
    {
        return [
            'live'             => ['cs_live_a1b2c3d4e5f6g7h8', true],
            'test'             => ['cs_test_a1b2c3d4e5f6g7h8', true],
            'too short'        => ['cs_test_abc', false],
            'wrong prefix'     => ['pi_test_a1b2c3d4e5f6g7h8', false],
            'unknown mode'     => ['cs_prod_a1b2c3d4e5f6g7h8', false],
            'path traversal'   => ['cs_test_a1b2c3d4e5/../x', false],
            'trailing newline' => ["cs_test_a1b2c3d4e5f6g7h8\n", false],
            'null'             => [null, false],
            'not a string'     => [12345, false],
        ];
    }

    #[DataProvider('sessionIdProvider')]
    public function testSessionIdFormatIsStrict(mixed $id, bool $expected): void
    {
        $this->assertSame($expected, valid_session_id($id));
    }
}
