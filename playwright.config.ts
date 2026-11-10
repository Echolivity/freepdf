import { defineConfig, devices } from '@playwright/test'

// Chromium on Linux needs a UTF-8 locale to save downloads with non-ASCII (e.g. Arabic) names;
// without one it silently falls back to "download". Real desktops and CI runners are UTF-8.
if (!/utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '')) process.env.LC_ALL = process.env.LANG = 'C.UTF-8'

const executablePath = process.env.CHROME_PATH || undefined

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...(executablePath ? { launchOptions: { executablePath } } : {}) } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...(executablePath ? { launchOptions: { executablePath } } : {}) }, testMatch: /smoke|mobile|arabic/ },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
