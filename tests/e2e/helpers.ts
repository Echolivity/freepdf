import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const fixturePath = (name: string) => join(here, '..', 'fixtures', name)
export const fixtureBytes = (name: string) => readFileSync(fixturePath(name))

/** Fail the test on any uncaught error or CSP violation; record any request that leaves the origin. */
export function guardPage(page: Page) {
  const problems: string[] = []
  const external: string[] = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`csp: ${m.text()}`)
  })
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !['blob:', 'data:'].includes(u.protocol)) external.push(r.url())
  })
  return {
    assertClean() {
      expect(problems, problems.join('\n')).toEqual([])
      expect(external, `Requests left the origin: ${external.join(', ')}`).toEqual([])
    },
  }
}

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
