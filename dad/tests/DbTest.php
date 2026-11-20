<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

if (!function_exists('site_data_dir')) {
    function site_data_dir(): string
    {
        $dir = sys_get_temp_dir() . '/dad-dbtest-' . getmypid();
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        return $dir;
    }
}
require_once dirname(__DIR__) . '/api/lib/db.php';

/** Rate-limit and mail-log bookkeeping in api/lib/db.php, against a throwaway SQLite file. */
final class DbTest extends TestCase
{
    public static function tearDownAfterClass(): void
    {
        $dir = site_data_dir();
        foreach (glob($dir . '/*') ?: [] as $f) unlink($f);
        rmdir($dir);
    }

    protected function setUp(): void
    {
        q('DELETE FROM hits');
        q('DELETE FROM mail_log');
        q('DELETE FROM suppressions');
    }

    public function testSuppressionKeepsAnOptOutWithoutTheAddress(): void
    {
        $this->assertFalse(is_suppressed('gone@example.org'));
        suppress_email('Gone@Example.org');
        $this->assertTrue(is_suppressed('gone@example.org'));
        $this->assertFalse(is_suppressed('other@example.org'));
        $this->assertStringNotContainsString('gone', (string)q('SELECT email_hash FROM suppressions')->fetchColumn());
        unsuppress_email('gone@example.org');
        $this->assertFalse(is_suppressed('gone@example.org'));
    }

    public function testPartnerConfirmationIsOncePerAddressPerHour(): void
    {
        $this->assertFalse(partner_confirm_repeat('p@example.org'));
        $this->assertTrue(partner_confirm_repeat('P@example.org'));
        $this->assertFalse(partner_confirm_repeat('q@example.org'));
    }

    public function testHitCountCountsOnlyTheWindow(): void
    {
        q('INSERT INTO hits(k, ts) VALUES(?, ?)', ['k', time() - 4000]);
        $this->assertSame(1, hit_count('k', 3600));
        $this->assertSame(2, hit_count('k', 3600));
        $this->assertSame(4, hit_count('k', HITS_RETENTION));
    }

    public function testRetryAfterIsTheTimeLeftOnTheOldestHitInTheWindow(): void
    {
        $this->assertSame(3600, hit_retry_after('k', 3600), 'no hits: the whole window');
        q('INSERT INTO hits(k, ts) VALUES(?, ?)', ['k', time() - 3000]);
        q('INSERT INTO hits(k, ts) VALUES(?, ?)', ['k', time() - 10]);
        $this->assertEqualsWithDelta(600, hit_retry_after('k', 3600), 2);
    }

    public function testReadOnlyCheckDoesNotRecordOrPrune(): void
    {
        $old = time() - HITS_RETENTION - 10;
        q('INSERT INTO hits(k, ts) VALUES(?, ?)', ['k', $old]);
        $this->assertSame(0, hit_count('k', 900, false));
        $this->assertSame(1, (int)q('SELECT COUNT(*) FROM hits')->fetchColumn());
    }

    public function testRecordingPrunesExpiredHitsAndOldMailLog(): void
    {
        q('INSERT INTO hits(k, ts) VALUES(?, ?)', ['old', time() - HITS_RETENTION - 10]);
        q('INSERT INTO mail_log(ts, kind, ok) VALUES(?, ?, 1)', [time() - MAIL_LOG_RETENTION - 10, 'confirm']);
        q('INSERT INTO mail_log(ts, kind, ok) VALUES(?, ?, 1)', [time() - 60, 'confirm']);
        hit_count('k', 900);
        $this->assertSame(['k'], q('SELECT k FROM hits')->fetchAll(PDO::FETCH_COLUMN));
        $this->assertSame(1, (int)q('SELECT COUNT(*) FROM mail_log')->fetchColumn());
    }

    public function testWindowBeyondRetentionIsRejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        hit_count('k', HITS_RETENTION + 1);
    }

    // ---- ip_hash -----------------------------------------------------------

    private static function hashFor(string $ip): string
    {
        $_SERVER['REMOTE_ADDR'] = $ip;
        return ip_hash();
    }

    public function testIpv6AddressesInOneSlash64ShareAHash(): void
    {
        $this->assertSame(self::hashFor('2001:db8:1:2::1'), self::hashFor('2001:db8:1:2:ffff:ffff:ffff:ffff'));
        $this->assertNotSame(self::hashFor('2001:db8:1:2::1'), self::hashFor('2001:db8:1:3::1'));
    }

    public function testIpv4MappedIpv6IsTheSameAsPlainIpv4(): void
    {
        $this->assertSame(self::hashFor('1.2.3.4'), self::hashFor('::ffff:1.2.3.4'));
        $this->assertNotSame(self::hashFor('1.2.3.4'), self::hashFor('1.2.3.5'));
    }

    public function testAnInvalidAddressStillHashesStably(): void
    {
        $this->assertSame(self::hashFor('not-an-ip'), self::hashFor('not-an-ip'));
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', self::hashFor(''));
    }

    // ---- unsubscribe_all and the re-subscribe path -------------------------

    private static function addSubmission(string $type, ?string $email, string $pid): int
    {
        q('INSERT INTO submissions(pid, type, email, fields, page, created_at, updated_at, unsub_token) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
            [$pid, $type, $email, '{}', '/', time(), time(), bin2hex(random_bytes(16))]);
        return (int)db()->lastInsertId();
    }

    private static function unsubscribedAt(int $id): ?int
    {
        $v = q('SELECT unsubscribed_at FROM submissions WHERE id = ?', [$id])->fetchColumn();
        return $v === null ? null : (int)$v;
    }

    public function testUnsubscribeAllCoversEveryMailingListForThatAddressOnly(): void
    {
        q('DELETE FROM submissions');
        $founding = self::addSubmission('founding', 'a@example.org', 'pid-founding');
        $updates  = self::addSubmission('updates', 'a@example.org', 'pid-updates');
        $contact  = self::addSubmission('contact', 'a@example.org', 'pid-contact');
        $other    = self::addSubmission('updates', 'b@example.org', 'pid-other');

        unsubscribe_all(['id' => $founding, 'email' => 'a@example.org']);

        $this->assertNotNull(self::unsubscribedAt($founding));
        $this->assertNotNull(self::unsubscribedAt($updates));
        $this->assertNull(self::unsubscribedAt($contact), 'not a mailing list');
        $this->assertNull(self::unsubscribedAt($other), 'someone else');
    }

    public function testUnsubscribeAllKeepsTheFirstTimestampAndHandlesRowsWithoutEmail(): void
    {
        q('DELETE FROM submissions');
        $id = self::addSubmission('founding', null, 'pid-noemail');
        $other = self::addSubmission('founding', 'c@example.org', 'pid-c');
        q('UPDATE submissions SET unsubscribed_at = 1000 WHERE id = ?', [$other]);

        unsubscribe_all(['id' => $id, 'email' => null]);
        unsubscribe_all(['id' => $other, 'email' => 'c@example.org']);

        $this->assertGreaterThan(1000, self::unsubscribedAt($id));
        $this->assertSame(1000, self::unsubscribedAt($other));
    }

    public function testResubscribeClearsTheSuppressionAndTheOptOut(): void
    {
        q('DELETE FROM submissions');
        $id = self::addSubmission('founding', 'd@example.org', 'pid-d');
        unsubscribe_all(['id' => $id, 'email' => 'd@example.org']);
        suppress_email('d@example.org');
        $this->assertTrue(is_suppressed('d@example.org'));

        q('UPDATE submissions SET unsubscribed_at = NULL WHERE id = ?', [$id]);
        unsuppress_email('d@example.org');

        $this->assertNull(self::unsubscribedAt($id));
        $this->assertFalse(is_suppressed('d@example.org'));
    }
}
