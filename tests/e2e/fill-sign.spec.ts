import { test, expect, type Page } from './fixtures'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { upload, runAndDownload } from './helpers'

// The form fixture comes from scripts/make-form-fixtures.mjs: English and Arabic text fields, a comb
// ID field, a dropdown, a radio group, a multiline notes box and a consent checkbox.

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) } as never)
  const doc = await task.promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    text += c.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
  }
  await task.destroy()
  return text.replace(/\s+/g, ' ')
}

const field = (page: Page, name: string) => page.locator(`[data-field="${name}"]`)

async function fillApplication(page: Page) {
  await page.goto('/fill-pdf-form')
  await upload(page, 'forms/application.pdf')
  await expect(page.getByTestId('fs-summary')).toContainText('7 form fields')
  await field(page, 'applicant.full_name').fill('Layla Haddad')
  await field(page, 'applicant.name_ar').fill('ليلى حداد')
  await field(page, 'applicant.id_number').fill('1234567890')
  await field(page, 'applicant.city').selectOption('Jeddah')
  await page.getByRole('radio', { name: /yearly/ }).check()
  await field(page, 'applicant.notes').fill('Please call after 5pm.')
  await field(page, 'consent.agree').check()
}

test.describe('Fill & Sign', () => {
  test('fills a form and keeps it editable', async ({ page }) => {
    await fillApplication(page)
    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('application-filled.pdf')
    await expect(page.getByText('7 fields filled · 0 item(s) added')).toBeVisible()
    const form = (await PDFDocument.load(bytes)).getForm()
    expect(form.getTextField('applicant.full_name').getText()).toBe('Layla Haddad')
    expect(form.getTextField('applicant.name_ar').getText()).toBe('ليلى حداد')
    expect(form.getTextField('applicant.id_number').getText()).toBe('1234567890')
    expect(form.getDropdown('applicant.city').getSelected()).toEqual(['Jeddah'])
    expect(form.getRadioGroup('membership.plan').getSelected()).toBe('yearly')
    expect(form.getTextField('applicant.notes').getText()).toBe('Please call after 5pm.')
    expect(form.getCheckBox('consent.agree').isChecked()).toBe(true)
  })

  test('locked: answers become page text, Arabic in reading order', async ({ page }) => {
    await fillApplication(page)
    await page.getByText('Locked', { exact: true }).click()
    const { bytes } = await runAndDownload(page)
    const doc = await PDFDocument.load(bytes)
    // Check the catalog first: pdf-lib's getForm() creates an empty AcroForm when there is none.
    expect(doc.catalog.get(PDFName.of('AcroForm'))).toBeUndefined()
    expect(doc.getForm().getFields()).toHaveLength(0)
    const text = await pdfText(bytes)
    for (const s of ['Layla Haddad', 'ليلى حداد', 'Jeddah', 'Please call after 5pm.']) expect(text).toContain(s)
  })

  test('adds text, a date, a tick and a drawn signature to a flat PDF', async ({ page }) => {
    await page.goto('/sign-pdf')
    await upload(page, 'text-8p.pdf')
    await expect(page.getByTestId('fs-summary')).toContainText('No fillable fields')
    await expect(page.getByTestId('run')).toBeDisabled()

    await page.getByTestId('fs-add-text').click()
    await page.getByTestId('fs-item-text').last().fill('Approved by L. Haddad')
    await page.getByTestId('fs-add-date').click()
    await page.getByTestId('fs-add-check').click()
    // A tick can be nudged with the keyboard and removed with Delete.
    const tick = page.getByTestId('fs-item-check')
    await tick.focus()
    await page.keyboard.press('Shift+ArrowRight')
    await page.getByTestId('fs-add-cross').click()
    await page.getByTestId('fs-item-cross').focus()
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('fs-item-cross')).toHaveCount(0)

    await page.getByTestId('fs-add-signature').click()
    const dialog = page.getByTestId('signature-dialog')
    await expect(dialog).toBeVisible()
    const pad = page.getByTestId('signature-pad')
    const b = (await pad.boundingBox())!
    await page.mouse.move(b.x + b.width * 0.15, b.y + b.height * 0.6)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + b.width * (0.15 + i * 0.05), b.y + b.height * (0.6 - Math.sin(i / 2) * 0.25), { steps: 2 })
    await page.mouse.up()
    await page.getByTestId('signature-use').click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('fs-item-signature')).toHaveCount(1)

    const { bytes, name } = await runAndDownload(page)
    expect(name).toBe('text-8p-signed.pdf')
    await expect(page.getByText('Saved · 4 item(s) added')).toBeVisible()
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(8)
    const text = await pdfText(bytes)
    expect(text).toContain('Approved by L. Haddad')
    expect(text).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  test('initials on every page, and a date copied to every page', async ({ page }) => {
    await page.goto('/sign-pdf')
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('fs-add-initials').click()
    const dialog = page.getByTestId('signature-dialog')
    await expect(dialog).toContainText('initials')
    await dialog.getByText('Type', { exact: true }).click()
    await page.getByTestId('signature-typed').fill('LH')
    await page.getByTestId('signature-use').click()
    await expect(page.getByTestId('fs-item-initials')).toHaveCount(8)
    await page.getByTestId('fs-add-date').click()
    await page.getByTestId('fs-item-every-page').click()
    await expect(page.getByTestId('fs-item-date')).toHaveCount(8)
    const { bytes } = await runAndDownload(page)
    await expect(page.getByText('Saved · 16 item(s) added')).toBeVisible()
    const doc = await PDFDocument.load(bytes)
    for (const p of doc.getPages()) {
      const xo = p.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
      expect(xo?.keys().length ?? 0).toBeGreaterThanOrEqual(1)
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) } as never)
    const pdf = await task.promise
    for (let i = 1; i <= pdf.numPages; i++) {
      const c = await (await pdf.getPage(i)).getTextContent()
      expect(c.items.map((it) => ('str' in it ? it.str : '')).join(' ')).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    }
    await task.destroy()
  })

  test('typed signature is reused for the next placement', async ({ page }) => {
    await page.goto('/sign-pdf')
    await upload(page, 'text-8p.pdf')
    await page.getByTestId('fs-add-signature').click()
    await page.getByTestId('signature-dialog').getByText('Type', { exact: true }).click()
    await page.getByTestId('signature-typed').fill('Layla Haddad')
    await page.getByTestId('signature-use').click()
    await page.getByTestId('fs-add-signature').click()
    await expect(page.getByTestId('signature-dialog')).toBeHidden()
    await expect(page.getByTestId('fs-item-signature')).toHaveCount(2)
    const { bytes } = await runAndDownload(page)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(8)
  })
})
