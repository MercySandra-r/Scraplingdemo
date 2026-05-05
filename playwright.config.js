// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the self-healing test suite.
 * Selectors are resolved at runtime from locators.json (Scrapling output).
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',

  // Stop on first failure in local dev; run all in CI
  forbidOnly: !!process.env.CI,
  retries:    process.env.CI ? 2 : 0,
  workers:    process.env.CI ? 4 : undefined,
  fullyParallel: true,

  timeout:        60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    // ── Target app ──────────────────────────────────────────────────────────
    baseURL:           'https://apply-qa.apps.asu.edu',
    ignoreHTTPSErrors: true,   // QA site uses an internal CA not trusted by WebKit
    // ── Debug helpers ────────────────────────────────────────────────────────
    trace:      'on-first-retry',
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Uncomment for mobile testing:
    // { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    // { name: 'mobile-safari', use: { ...devices['iPhone 12'] } },
  ],
});
