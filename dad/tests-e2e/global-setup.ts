import type { FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0].use.baseURL;
  try {
    const r = await fetch(`${base}/api/health.php`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) return;
    throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    throw new Error(
      `No healthy PHP server at ${base} (${e instanceof Error ? e.message : e}). Run ci-setup-config.sh, then start it with ` +
        'PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8080 -t "$PWD" tests-e2e/router.php (from dad/).',
    );
  }
}
