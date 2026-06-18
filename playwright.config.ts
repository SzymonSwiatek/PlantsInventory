import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the AI-outage e2e (test-plan Risk #1, change
 * `ai-outage-resilience` Phase 2). See https://playwright.dev/docs/test-configuration.
 *
 * The `webServer` boots the real app on a dedicated port with `AI_API_KEY` forced
 * OFF (via `setup-dev-vars.mjs`), so every suggest call degrades — the zero-stub
 * outage lever that drives the client-rendered manual fallback. `globalSetup`
 * mints an authenticated `storageState` + seeds a location; `globalTeardown`
 * restores `.dev.vars` and deletes the test user.
 */

const PORT = 4323;
const BASE_URL = `http://localhost:${PORT.toString()}`;

export default defineConfig({
  testDir: "./tests/e2e",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: process.env.BASE_URL ?? BASE_URL,
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "Google Chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        storageState: "playwright/.auth/user.json",
      },
    },
  ],

  /* Boot the real app with AI unavailable before the tests run. */
  webServer: {
    command: `node tests/e2e/setup-dev-vars.ts && npm run dev -- --port ${PORT.toString()}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
