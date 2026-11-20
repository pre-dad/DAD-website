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
    }

    public function testHitCountCountsOnlyTheWindow(): void
    {
        q('INSERT INTO hits(k, ts) VALUES(?, ?)', ['k', time() - 4000]);
        $this->assertSame(1, hit_count('k', 3600));
        $this->assertSame(2, hit_count('k', 3600));
        $this->assertSame(4, hit_count('k', HITS_RETENTION));
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
}
