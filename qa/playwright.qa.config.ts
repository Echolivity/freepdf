import { defineConfig, devices } from '@playwright/test'

// Real-world QA run: one worker (realistic timings, no contention), long timeouts, desktop Chromium.
if (!/utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '')) process.env.LC_ALL = process.env.LANG = 'C.UTF-8'

export default defineConfig({
  testDir: '.',
  testMatch: /real-world\.spec\.ts/,
  outputDir: './test-results',
  timeout: 15 * 60_000,
  expect: { timeout: 10 * 60_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PW_BASE_URL || 'http://localhost:4173',
    acceptDownloads: true,
    ...devices['Desktop Chrome'],
    ...(process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH } } : {}),
  },
  webServer: process.env.PW_BASE_URL ? undefined : { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true },
})
