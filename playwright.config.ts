import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:5173',
    // Headless Chromium — no real wallet extension needed, we inject a mock
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 8_000,
    trace: 'on-first-retry',
    // Use the installed Chromium headless shell
    channel: undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],
  // Dev server is already running on port 5173 — don't start/stop it
  webServer: undefined,
})
