import { defineConfig, devices, type Project } from '@playwright/test'

// Chromium on Linux needs a UTF-8 locale to save downloads with non-ASCII (e.g. Arabic) names;
// without one it silently falls back to "download". Real desktops and CI runners are UTF-8.
if (!/utf-?8/i.test(process.env.LC_ALL || process.env.LANG || '')) process.env.LC_ALL = process.env.LANG = 'C.UTF-8'

const executablePath = process.env.CHROME_PATH || undefined
const chromium = (d: (typeof devices)[string]) => ({ ...d, ...(executablePath ? { launchOptions: { executablePath } } : {}) })

/** Specs that matter on every device/browser (layout, Arabic, a11y, core flows). */
const DEVICE_SPECS = /smoke|arabic|responsive|a11y|mobile-flow/

const projects: Project[] = [
  // Full suite on desktop Chromium.
  { name: 'desktop', use: chromium(devices['Desktop Chrome']) },
  // Emulated devices (Chromium engine, real viewport/touch/DPR). Not physical hardware.
  { name: 'tablet-android', use: chromium(devices['Galaxy Tab S4']), testMatch: DEVICE_SPECS },
  { name: 'android-midrange', use: chromium(devices['Galaxy A55']), testMatch: DEVICE_SPECS },
  { name: 'mobile', use: chromium(devices['Pixel 7']), testMatch: DEVICE_SPECS },
  { name: 'narrow-320', use: chromium(devices['Galaxy S9+']), testMatch: /responsive|smoke|mobile-flow/ },
]

// Firefox and WebKit engines. Enabled with ALL_BROWSERS=1 (CI does this); their binaries must be
// installed with `npx playwright install firefox webkit`.
if (process.env.ALL_BROWSERS) {
  projects.push(
    { name: 'firefox', use: devices['Desktop Firefox'], testIgnore: /privacy-guard/ },
    { name: 'webkit', use: devices['Desktop Safari'], testIgnore: /privacy-guard/ },
    { name: 'ipad-webkit', use: devices['iPad (gen 7)'], testMatch: DEVICE_SPECS },
    { name: 'iphone-se-webkit', use: devices['iPhone SE'], testMatch: /responsive|smoke|mobile-flow/ },
  )
}

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
  },
  projects,
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
