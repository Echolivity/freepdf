import { expect, test } from './fixtures'

test('homepage lists only working tools, searches, and toggles theme', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Private PDF tools. Your files stay on your device.')
  await expect(page.getByRole('link', { name: /Merge PDF/ })).toBeVisible()
  await page.getByLabel('Search tools').fill('combine')
  await expect(page.getByText('1 tool found')).toBeVisible()
  await page.getByLabel('Search tools').fill('zzzz')
  await expect(page.getByText('No tools match')).toBeVisible()
  await page.getByLabel('Search tools').fill('')

  const html = page.locator('html')
  const wasDark = await html.evaluate((el) => el.classList.contains('dark'))
  await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click()
  await expect(html).toHaveClass(wasDark ? /^(?!.*dark)/ : /dark/)
})

test('every tool card opens a working tool page with a drop zone', async ({ page }) => {
  await page.goto('/')
  const hrefs = await page.locator('main a[href^="/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')!))].filter((h) => h !== '/' && h !== '/privacy'))
  expect(hrefs.length).toBeGreaterThanOrEqual(11)
  for (const href of hrefs) {
    await page.goto(href)
    await expect(page.getByRole('button', { name: /^Select (PDF|image|text|Word|Excel|HTML) files?$/ })).toBeVisible()
  }
})

test('recently used tools are remembered locally', async ({ page }) => {
  await page.goto('/rotate-pdf')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Recently used' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByRole('heading', { name: 'Recently used' })).toHaveCount(0)
})

test('unknown routes show a 404 page', async ({ page }) => {
  await page.goto('/does-not-exist')
  await expect(page.getByText("This page doesn't exist")).toBeVisible()
})

test('privacy page documents every stored key, and clearing removes them', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('lang-toggle').click() // writes freepdf:lang
  await page.getByTestId('theme-toggle').click() // writes freepdf:theme
  await page.getByTestId('lang-toggle').click()
  await page.goto('/merge-pdf') // writes freepdf:recent
  await page.goto('/privacy')
  const keys = await page.locator('section[aria-labelledby="storage-h"] code').allTextContents()
  expect(keys).toEqual(['freepdf:theme', 'freepdf:lang', 'freepdf:recent'])
  const stored = await page.evaluate(() => Object.keys(localStorage).sort())
  for (const k of stored) expect(keys).toContain(k)
  await page.getByRole('button', { name: 'Clear these settings' }).click()
  await expect(page.getByText('Settings cleared from this browser.')).toBeVisible()
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('limits are stated up front: no quotas, but technical size limits', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(/no daily quotas/i).first()).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/No limits|unlimited/i)
  await page.goto('/merge-pdf')
  await expect(page.getByText(/up to \d+ MB per file, \d+ MB per job/)).toBeVisible()
  await page.goto('/privacy')
  await expect(page.getByTestId('device-limits')).toBeVisible()
  await expect(page.locator('table').nth(1)).toContainText('250 MB')
  await expect(page.locator('table').nth(1)).toContainText('100 MB')
})

test('each tool page explains formats, limits, privacy and answers common questions', async ({ page }) => {
  await page.goto('/compress-pdf')
  const about = page.locator('section[aria-labelledby="about-h"]')
  await expect(about).toContainText('PDF files (checked by content, not file name)')
  await expect(about).toContainText(/Up to \d+ MB per file and \d+ MB per job on this device\. No daily quota\./)
  await expect(about).toContainText('Your files are never uploaded.')
  const q = page.getByText('Why didn’t my file get smaller?')
  await q.click()
  await expect(page.getByText(/CMYK images and images with transparency/)).toBeVisible()
})

test('every route is served as its own HTML file with its own title and description', async ({ request }) => {
  for (const [path, title] of [['/compress-pdf', 'Compress PDF — FreePDF'], ['/privacy', 'How FreePDF works — privacy'], ['/', 'FreePDF — Private PDF tools. Your files stay on your device.']]) {
    const res = await request.get(path)
    expect(res.status()).toBe(200)
    const html = await res.text()
    expect(html).toContain(`<title>${title}</title>`)
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/)
  }
  expect((await request.get('/robots.txt')).status()).toBe(200)
})

test('security headers are strict and match the app (served from public/_headers)', async ({ request }) => {
  const h = (await request.get('/merge-pdf')).headers()
  const csp = h['content-security-policy']
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("connect-src 'self';")
  expect(csp).toContain("worker-src 'self';")
  expect(csp).toContain("object-src 'none'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).not.toMatch(/'unsafe-eval'|https?:\/\/|\*/) // no eval, no remote hosts, no wildcards
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['referrer-policy']).toBe('no-referrer')
  expect(h['cross-origin-opener-policy']).toBe('same-origin')
  expect(h['cross-origin-resource-policy']).toBe('same-origin')
  expect(h['strict-transport-security']).toMatch(/max-age=\d+/)
})
