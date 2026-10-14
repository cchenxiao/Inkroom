import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/** Use an installed Chrome on macOS; CI can install Playwright Chromium normally. */
const channel =
  process.env.PLAYWRIGHT_CHANNEL ||
  (existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined);
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    channel,
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1600, height: 1100 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
