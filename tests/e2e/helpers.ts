import { expect } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const fixturePath = (name: string) => join(here, '..', 'fixtures', name)
export const fixtureBytes = (name: string) => readFileSync(fixturePath(name))

export async function upload(page: Page, ...names: string[]) {
  await page.getByTestId('file-input').first().setInputFiles(names.map(fixturePath))
}

/** Click the primary action and wait for the single-file download. Returns the downloaded bytes. */
export async function runAndDownload(page: Page): Promise<{ bytes: Buffer; name: string }> {
  await page.getByTestId('run').click()
  const btn = page.getByTestId('download')
  await expect(btn).toBeVisible({ timeout: 60_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()])
  return { bytes: readFileSync((await dl.path())!), name: dl.suggestedFilename() }
}

export async function runAndDownloadZip(page: Page): Promise<{ bytes: Buffer; name: string }> {
  await page.getByTestId('run').click()
  const btn = page.getByTestId('download-zip')
  await expect(btn).toBeVisible({ timeout: 60_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()])
  return { bytes: readFileSync((await dl.path())!), name: dl.suggestedFilename() }
}

/**
 * Playwright's WebKit reports download names with spaces replaced by underscores (an engine/driver quirk;
 * the app sets the same `download` attribute in every browser). Compare against what that engine reports.
 */
export const expectedDownloadName = (name: string, browserName: string) => (browserName === 'webkit' ? name.replace(/ /g, '_') : name)
