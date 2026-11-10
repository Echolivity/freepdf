import { test, expect } from './fixtures'

/**
 * The guard itself must work: these tests deliberately misbehave and are *expected to fail*
 * (test.fail()). If the guard stopped catching something, the test would unexpectedly pass and the
 * suite would go red.
 */

test('guard fails a test that POSTs data to the app’s own origin', async ({ page }) => {
  test.fail()
  await page.goto('/')
  await page.evaluate(() => fetch('/collect', { method: 'POST', body: 'secret document text' }).catch(() => {}))
})

test('guard fails a test that tries to reach a third-party origin', async ({ page }) => {
  test.fail()
  await page.goto('/')
  await page.evaluate(() => fetch('https://example.com/beacon').catch(() => {}))
  await page.waitForTimeout(200)
})

test('guard fails a test that leaks data through a GET query string', async ({ page }) => {
  test.fail()
  await page.goto('/')
  await page.evaluate(() => { new Image().src = '/assets/pixel.gif?doc=JVBERi0xLjcK' })
  await page.waitForTimeout(200)
})

test('guard fails a test that leaves undocumented data in localStorage', async ({ page }) => {
  test.fail()
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('freepdf:lastFile', 'tax-return-2026.pdf'))
})

test('guard fails a test that writes a file name into the recent-tools list', async ({ page }) => {
  test.fail()
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('freepdf:recent', JSON.stringify(['merge-pdf', 'My Contract.pdf'])))
})

test('guard passes normal app use (startup, navigation, processing)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /Merge PDF/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Merge PDF')
})
