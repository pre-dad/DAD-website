import { defineConfig, devices } from '@playwright/test';

// Tier 3 E2E config for the DAD marketing site.
//
// The PHP server (php -S with tests-e2e/router.php) is started EXPLICITLY by the
// caller (the CI job, or the local verify steps) AFTER tests-e2e/ci-setup-config.sh
// has written the throwaway config. We do NOT use Playwright's `webServer` to
// start PHP, because the server needs that temp config in place first and we want
// the CI job to own server lifecycle + readiness probing against /api/health.php.
//
// No screenshot / visual-regression assertions anywhere — these checks are robust,
// not pixel-exact. Screenshots are captured only on failure, purely for debugging.

const BASE_URL = 'http://127.0.0.1:8080';

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
