import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib'
import { setFontLoader } from '../../src/lib/pdf/fonts'
import { fillSign, type FieldValue } from '../../src/lib/pdf/fillSign'
import { readPageText, type DocLike } from '../../src/lib/convert/pdfExport'
import { openNode } from './render'

const fontDir = join(process.cwd(), 'node_modules', '@expo-google-fonts', 'ibm-plex-sans-arabic')
beforeAll(() => {
  setFontLoader(async (f) => new Uint8Array(readFileSync(join(fontDir, f.includes('Bold') ? '700Bold/IBMPlexSansArabic_700Bold.ttf' : '400Regular/IBMPlexSansArabic_400Regular.ttf'))))
})
const form = () => ({ name: 'application.pdf', bytes: new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'forms', 'application.pdf'))) })
async function lines(bytes: Uint8Array) {
  const { doc, close } = await openNode(bytes)
  try { return (await readPageText(doc as unknown as DocLike, 1)).lines.map((l) => l.text) } finally { await close() }
}

const answers: FieldValue[] = [
  { name: 'applicant.full_name', kind: 'text', value: 'Sara Example' },
  { name: 'applicant.name_ar', kind: 'text', value: 'سارة المثال' },
  { name: 'applicant.id_number', kind: 'text', value: '10234567891234' },
  { name: 'applicant.city', kind: 'choice', value: ['الدمام'] },
  { name: 'membership.plan', kind: 'radio', value: 'yearly' },
  { name: 'applicant.notes', kind: 'text', value: 'Prefers evening sessions. Has attended the club as a guest several times before.' },
  { name: 'consent.agree', kind: 'check', value: true },
  { name: 'no.such.field', kind: 'text', value: 'x' },
]

describe('Fill & Sign', () => {
  it('fills every kind of field and keeps the form editable', async () => {
    const r = await fillSign(form(), { fields: answers, items: [], flatten: false })
    expect(r.skipped).toEqual(['no.such.field'])
    const f = (await PDFDocument.load(r.bytes)).getForm()
    expect((f.getField('applicant.full_name') as PDFTextField).getText()).toBe('Sara Example')
    expect((f.getField('applicant.name_ar') as PDFTextField).getText()).toBe('سارة المثال')
    expect((f.getField('applicant.id_number') as PDFTextField).getText()).toBe('1023456789') // max length 10
    expect((f.getField('applicant.city') as PDFDropdown).getSelected()).toEqual(['الدمام'])
    expect((f.getField('membership.plan') as PDFRadioGroup).getSelected()).toBe('yearly')
    expect((f.getField('consent.agree') as PDFCheckBox).isChecked()).toBe(true)
  })

  it('flattens: answers become page text, Arabic in reading order, fields gone', async () => {
    const r = await fillSign(form(), { fields: answers, items: [], flatten: true })
    const out = await PDFDocument.load(r.bytes)
    expect(out.getForm().getFields()).toHaveLength(0)
    // No dangling annotation references left behind (pdf-lib leaves them; we clean up).
    expect(out.getPage(0).node.Annots()).toBeUndefined()
    const text = await lines(r.bytes)
    expect(text.some((l) => l.includes('Sara Example'))).toBe(true)
    expect(text.some((l) => l.includes('سارة المثال'))).toBe(true)
    expect(text.some((l) => l.includes('الدمام'))).toBe(true)
    expect(text.join(' ')).toMatch(/1\s*0\s*2\s*3\s*4\s*5\s*6\s*7\s*8\s*9/) // comb cells, one digit each
    expect(text.join(' ')).toContain('Prefers evening sessions.')
  })

  it('places text, a tick and a signature anywhere, upright on rotated pages too', async () => {
    const src = await PDFDocument.create()
    src.addPage([400, 300])
    const p2 = src.addPage([300, 400]); p2.setRotation({ type: 'degrees', angle: 90 } as never)
    // A 2×2 PNG (red, transparent) standing in for a signature.
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwnwEIGBkZGRkYGQAX8gL+fK1j6QAAAABJRU5ErkJggg==', 'base64'))
    const r = await fillSign({ name: 'flat.pdf', bytes: await src.save() }, {
      fields: [],
      flatten: false,
      items: [
        { page: 0, kind: 'text', x: 40, y: 200, w: 200, h: 30, angle: 0, text: 'Approved — موافق', size: 14 },
        { page: 0, kind: 'mark', mark: 'check', x: 300, y: 200, w: 16, h: 16, angle: 0 },
        { page: 0, kind: 'image', png, x: 40, y: 60, w: 120, h: 40, angle: 0 },
        { page: 1, kind: 'text', x: 60, y: 50, w: 150, h: 20, angle: 90, text: 'Sideways page', size: 12 },
      ],
    })
    const { doc, close } = await openNode(r.bytes)
    try {
      const t1 = await readPageText(doc as unknown as DocLike, 1)
      // Drawn left to right with the Arabic word last; read-back order of a lone mixed line is the extractor's.
      const l1 = t1.lines.map((l) => l.text).join(' ')
      expect(l1).toContain('Approved —')
      expect(l1).toContain('موافق')
      const t2 = await readPageText(doc as unknown as DocLike, 2)
      const s = t2.spans.find((x) => x.str.includes('Sideways'))!
      expect(Math.round(s.angle)).toBe(0) // reads upright on the displayed (rotated) page
      const ops = await (await doc.getPage(1)).getOperatorList()
      expect(ops.fnArray.filter((f: number) => f === 85 /* paintImageXObject */).length).toBe(1)
    } finally { await close() }
  })
})
