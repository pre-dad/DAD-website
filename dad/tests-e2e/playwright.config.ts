import { defineConfig, devices } from '@playwright/test';

// The PHP server is started by the caller (CI, or by hand as in the README) after
// ci-setup-config.sh has written the throwaway config, not by Playwright's webServer.
// Start it with PHP_CLI_SERVER_WORKERS=4: the default single worker serialises requests and times out.

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
