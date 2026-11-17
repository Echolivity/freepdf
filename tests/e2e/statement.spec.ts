import { test, expect } from './fixtures'
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { upload, runAndDownload, runAndDownloadZip, expectedDownloadName } from './helpers'

// Synthetic statements (scripts/make-statement-fixtures.py); the .expected.json files hold what they contain.
const expected = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'statements', `${name}.expected.json`), 'utf8')) as {
  opening: number; closing: number; transactions: { date: string; description: string; debit: number | null; credit: number | null; balance: number }[]
}

test.describe('Bank statement to Excel', () => {
  test('English statement to Excel: every transaction, typed, checked, with a summary', async ({ page }) => {
    await page.goto('/bank-statement-to-excel')
    await upload(page, 'statements/en-statement.pdf')
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe(expectedDownloadName('en-statement.xlsx'))
    await expect(page.getByText('46 transactions · all 46 balances check out')).toBeVisible()
    const zip = await JSZip.loadAsync(bytes)
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    const rows = [...sheet.matchAll(/<row r="(\d+)">/g)]
    expect(rows).toHaveLength(47)
    const e = expected('en-statement')
    // Balances in column G, oldest first.
    const balances = [...sheet.matchAll(/<c r="G(\d+)" s="3"><v>([^<]+)<\/v>/g)].map((m) => Number(m[2]))
    expect(balances).toEqual(e.transactions.map((t) => t.balance))
    expect(sheet).not.toContain('s="5"') // no mismatch highlighting
    const summary = await zip.file('xl/worksheets/sheet2.xml')!.async('string')
    expect(summary).toContain(`<v>${e.opening}</v>`)
    expect(summary).toContain('…4821')
  })

  test('Arabic statement to CSV in the Arabic interface', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('freepdf:lang', 'ar'))
    await page.goto('/bank-statement-to-excel')
    await upload(page, 'statements/ar-statement.pdf')
    await page.getByText('CSV', { exact: true }).click()
    const { bytes } = await runAndDownload(page)
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const lines = text.slice(1).trim().split('\r\n')
    expect(lines[0]).toBe('التاريخ,البيان,مدين,دائن,الرصيد,التدقيق')
    const e = expected('ar-statement')
    expect(lines).toHaveLength(e.transactions.length + 1)
    expect(lines[1]).toBe(`${e.transactions[0].date},${e.transactions[0].description},,${e.transactions[0].credit!.toFixed(2)},${e.transactions[0].balance.toFixed(2)},مطابق`)
    await expect(page.getByText(/18 معاملة · كل الأرصدة \(18\) مطابقة/)).toBeVisible()
  })

  test('newest-first statement with one signed column to OFX, oldest first, currency from the statement', async ({ page }) => {
    await page.goto('/bank-statement-to-excel')
    await upload(page, 'statements/signed-statement.pdf')
    await page.getByText('OFX', { exact: true }).click()
    const { bytes } = await runAndDownload(page)
    const text = bytes.toString('utf8')
    expect(text).toContain('<CURDEF>AED')
    const e = expected('signed-statement')
    const amounts = [...text.matchAll(/<TRNAMT>(.*)/g)].map((m) => Number(m[1].trim()))
    expect(amounts).toEqual(e.transactions.map((t) => (t.credit ?? 0) - (t.debit ?? 0)))
    expect(text).toContain(`<BALAMT>${e.closing.toFixed(2)}`)
  })

  test('several statements give a ZIP; a PDF without a transaction table explains why', async ({ page }) => {
    await page.goto('/bank-statement-to-excel')
    await upload(page, 'statements/en-statement.pdf', 'statements/ar-statement.pdf')
    const { bytes } = await runAndDownloadZip(page)
    expect(Object.keys((await JSZip.loadAsync(bytes)).files).sort()).toEqual(['ar-statement.xlsx', 'en-statement.xlsx'])
    await page.getByTestId('start-over').click()
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('run').click()
    await expect(page.getByRole('alert')).toContainText('No transaction table was found in “text-8p.pdf”')
  })
})
