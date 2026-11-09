<?php
declare(strict_types=1);

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

    public function testMatchingEmailStillRequiresCompletedPayment(): void
    {
        $receipt = $this->receipt();
        $this->assertTrue(donor_details($receipt, 'cs_test_syntheticreceipt', 'ADA@example.com')['verified']);
        $receipt['payment_status'] = 'unpaid';
        $this->assertNull(donor_details($receipt, 'cs_test_syntheticreceipt', 'ada@example.com'));
        $this->assertNull(donor_details(null, 'cs_test_syntheticreceipt', 'ada@example.com'));
    }
}
