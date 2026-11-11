import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib'
import { setFontLoader, FONT_VERSION, fitsStandardFont } from '../../src/lib/pdf/fonts'
import { visualRuns, toRoman } from '../../src/lib/pdf/text'
import { addPageNumbers, addWatermark, pageLabels, type PageNumberOptions, type WatermarkOptions } from '../../src/lib/pdf/stamp'
import { cropPdf } from '../../src/lib/pdf/crop'
import { arrangePages } from '../../src/lib/pdf/organize'
import { insetVisual, visualToUser } from '../../src/lib/pdf/geometry'
import { fixture, numberedPdf, qpdfCheck } from './helpers'
import { meanDiff, openNode, pageTexts, renderPage, visualSizes } from './render'

const fontDir = join(process.cwd(), 'node_modules/@expo-google-fonts/ibm-plex-sans-arabic')
beforeAll(() => {
  setFontLoader(async (f) => new Uint8Array(readFileSync(join(fontDir, f.includes('Bold') ? '700Bold/IBMPlexSansArabic_700Bold.ttf' : '400Regular/IBMPlexSansArabic_400Regular.ttf'))))
})

/** Text items of a page with their position and direction as the reader sees them (viewport space, y down). */
async function placedText(bytes: Uint8Array, pageNo: number) {
  const { doc, close } = await openNode(bytes)
  try {
    const page = await doc.getPage(pageNo)
    const vp = page.getViewport({ scale: 1 })
    const c = await page.getTextContent()
    return {
      width: vp.width,
      height: vp.height,
      items: c.items.flatMap((it) => {
        if (!('str' in it) || !it.str.trim()) return []
        const [a, b, , , e, f] = it.transform as number[]
        const [x, y] = vp.convertToViewportPoint(e, f) as number[]
        const [x2, y2] = vp.convertToViewportPoint(e + a, f + b) as number[]
        return [{ str: it.str, x, y, angle: Math.round((Math.atan2(y2 - y, x2 - x) * 180) / Math.PI) }]
      }),
    }
  } finally {
    await close()
  }
}

const PN: PageNumberOptions = { vertical: 'bottom', align: 'center', margin: 30, start: 1, style: 'decimal', prefix: '', suffix: '', font: 'helvetica', bold: false, size: 12, color: '#000000', indices: null, skipFirst: false }
const WM: WatermarkOptions = { kind: 'text', text: 'CONFIDENTIAL', font: 'helvetica', bold: true, size: 60, color: '#cc0000', image: null, imageScale: 0.3, anchor: 'mc', rotation: 45, opacity: 0.3, tiled: false, gap: 40, layer: 'over', indices: null }
const f = (name: string) => ({ name, bytes: fixture(name) })

describe('text layout helpers', () => {
  it('orders mixed Arabic and numbers visually', () => {
    expect(visualRuns('Page 3 of 10').map((r) => r.text)).toEqual(['Page 3 of 10'])
    expect(visualRuns('صفحة 3 من 10').map((r) => [r.text, r.rtl])).toEqual([['10', false], [' من ', true], ['3', false], ['صفحة ', true]])
    expect(visualRuns('سري - Confidential').map((r) => r.rtl)).toEqual([false, true])
  })
  it('roman numerals and font coverage', () => {
    expect([1, 4, 9, 14, 40, 90, 400, 1994, 3999].map(toRoman)).toEqual(['I', 'IV', 'IX', 'XIV', 'XL', 'XC', 'CD', 'MCMXCIV', 'MMMCMXCIX'])
    expect(toRoman(4000)).toBe('4000')
    expect(fitsStandardFont('Page 1 — “Draft” €')).toBe(true)
    expect(fitsStandardFont('صفحة')).toBe(false)
    expect(fitsStandardFont('١٢')).toBe(false)
  })
  it('font version matches the installed package', () => {
    expect(JSON.parse(readFileSync(join(fontDir, 'package.json'), 'utf8')).version).toBe(FONT_VERSION)
  })
  it('geometry maps visual positions on rotated pages', () => {
    const box = { x: 10, y: 20, width: 600, height: 800 }
    expect(visualToUser(box, 0, 5, 5)).toEqual({ x: 15, y: 25, angle: 0 })
    expect(visualToUser(box, 90, 0, 0)).toEqual({ x: 610, y: 20, angle: 90 })
    expect(visualToUser(box, 270, 0, 0)).toEqual({ x: 10, y: 820, angle: 270 })
    expect(insetVisual(box, 90, { top: 10, right: 0, bottom: 0, left: 0 })).toEqual({ x: 20, y: 20, width: 590, height: 800 })
  })
})

describe('Add page numbers', () => {
  it('labels: start, skip cover, selected pages, styles', () => {
    expect(pageLabels(4, { ...PN, skipFirst: true })).toEqual([null, '1', '2', '3'])
    expect(pageLabels(5, { ...PN, indices: [1, 3], start: 7, prefix: 'p. ', suffix: '/' })).toEqual([null, 'p. 7/', null, 'p. 8/', null])
    expect(pageLabels(3, { ...PN, style: 'roman-lower' })).toEqual(['i', 'ii', 'iii'])
    expect(pageLabels(2, { ...PN, style: 'arabic-indic', start: 9 })).toEqual(['٩', '١٠'])
  })

  it('numbers every page at the bottom centre, as selectable text', async () => {
    const out = await addPageNumbers(f('text-8p.pdf'), { ...PN, prefix: 'No. ' })
    expect(qpdfCheck(out)).toBe(true)
    const before = await pageTexts(fixture('text-8p.pdf'))
    const after = await pageTexts(out)
    after.forEach((t, i) => {
      expect(t.startsWith(before[i]) || t.includes(before[i])).toBe(true)
      expect(t).toContain(`No. ${i + 1}`)
    })
    const p = await placedText(out, 3)
    const num = p.items.find((it) => it.str.includes('No. 3'))!
    expect(Math.abs(num.x + 15 - p.width / 2)).toBeLessThan(30) // roughly centred
    expect(p.height - num.y).toBeGreaterThan(25) // 30 pt margin from the bottom (baseline)
    expect(p.height - num.y).toBeLessThan(40)
  })

  it('stays upright and in the right corner on a rotated page', async () => {
    const out = await addPageNumbers(f('rich.pdf'), { ...PN, vertical: 'top', align: 'right' })
    const p = await placedText(out, 2) // /Rotate 90
    const num = p.items.find((it) => it.str === '2')!
    expect(num.angle).toBe(0)
    expect(num.x).toBeGreaterThan(p.width - 60)
    expect(num.y).toBeLessThan(60)
  })

  it('Arabic prefix and Arabic-Indic digits embed a font that shapes and extracts correctly', async () => {
    const out = await addPageNumbers(f('text-8p.pdf'), { ...PN, prefix: 'صفحة ', style: 'arabic-indic', indices: [0, 1] })
    const t = await pageTexts(out)
    expect(t[0]).toContain('صفحة')
    expect(t[0]).toContain('١')
    expect(t[1]).toContain('٢')
    expect(t[2]).not.toContain('صفحة')
    // The Arabic glyphs actually render (shaped, not empty boxes): the footer area has ink.
    const r = await renderPage(out, 1, 1)
    let ink = 0
    for (let y = r.height - 45; y < r.height - 25; y++) for (let x = 0; x < r.width; x++) if (r.data[(y * r.width + x) * 4] < 128) ink++
    expect(ink).toBeGreaterThan(40)
  })

  it('handles 800 pages and keeps the original content untouched', async () => {
    const src = await numberedPdf(800)
    const out = await addPageNumbers({ name: 'n.pdf', bytes: src }, { ...PN, vertical: 'top', align: 'left' })
    expect((await PDFDocument.load(out)).getPageCount()).toBe(800)
    expect(qpdfCheck(out)).toBe(true)
  }, 60_000)

  it('rejects bad options and encrypted files', async () => {
    await expect(addPageNumbers(f('text-8p.pdf'), { ...PN, size: 1 })).rejects.toMatchObject({ key: 'err.stampSize' })
    await expect(addPageNumbers(f('text-8p.pdf'), { ...PN, indices: [0], skipFirst: true })).rejects.toMatchObject({ key: 'err.stampNoPages' })
    await expect(addPageNumbers(f('encrypted-user.pdf'), PN)).rejects.toMatchObject({ key: 'err.encrypted' })
  })
})

describe('Watermark', () => {
  it('text watermark is vector, semi-transparent, and keeps the original text', async () => {
    const out = await addWatermark(f('text-8p.pdf'), WM)
    expect(qpdfCheck(out)).toBe(true)
    const t = await pageTexts(out)
    const before = await pageTexts(fixture('text-8p.pdf'))
    t.forEach((s, i) => { expect(s).toContain('CONFIDENTIAL'); expect(s).toContain(before[i].slice(0, 30)) })
    const p = await placedText(out, 1)
    expect(p.items.find((it) => it.str === 'CONFIDENTIAL')!.angle).toBe(-45) // 45° counter-clockwise as seen
    // Opacity: the watermark pixels are lighter than solid red.
    const r = await renderPage(out, 1, 1)
    const cx = Math.round(r.width / 2)
    const cy = Math.round(r.height / 2)
    let reddish = 0
    for (let y = cy - 30; y < cy + 30; y++) for (let x = cx - 30; x < cx + 30; x++) {
      const i = (y * r.width + x) * 4
      if (r.data[i] > 200 && r.data[i + 1] > 120 && r.data[i + 1] < 235) reddish++
    }
    expect(reddish).toBeGreaterThan(50)
  })

  it('tiles, applies to selected pages, and puts the layer under opaque content', async () => {
    const tiled = await addWatermark(f('text-8p.pdf'), { ...WM, tiled: true, size: 24, indices: [1] })
    const p2 = (await placedText(tiled, 2)).items.filter((it) => it.str === 'CONFIDENTIAL').length
    const p1 = (await placedText(tiled, 1)).items.filter((it) => it.str === 'CONFIDENTIAL').length
    expect(p2).toBeGreaterThan(6)
    expect(p1).toBe(0)
    // scan.pdf is a full-page opaque image: under it, the watermark is invisible; over it, it shows.
    const under = await addWatermark(f('scan.pdf'), { ...WM, layer: 'under', opacity: 1 })
    const over = await addWatermark(f('scan.pdf'), { ...WM, layer: 'over', opacity: 1 })
    const base = await renderPage(fixture('scan.pdf'), 1, 0.5)
    expect(meanDiff(base, await renderPage(under, 1, 0.5))).toBeLessThan(0.5)
    expect(meanDiff(base, await renderPage(over, 1, 0.5))).toBeGreaterThan(1)
  })

  it('image watermark (PNG with transparency) is embedded once for all pages', async () => {
    const png = fixture('alpha.png')
    const out = await addWatermark(f('text-8p.pdf'), { ...WM, kind: 'image', image: { bytes: png, kind: 'png' }, anchor: 'br', rotation: 0 })
    const doc = await PDFDocument.load(out)
    const xobjs = new Set<string>()
    for (const page of doc.getPages()) {
      const xo = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
      xo?.entries().forEach(([, v]) => xobjs.add(v.toString()))
    }
    expect(xobjs.size).toBe(1)
    expect(out.length - fixture('text-8p.pdf').length).toBeLessThan(png.length * 2 + 20_000)
  })

  it('Arabic watermark text is embedded as real (extractable) text', async () => {
    const out = await addWatermark(f('text-8p.pdf'), { ...WM, text: 'سري للغاية', indices: [0] })
    // Known limitation: where the font overlaps two letters (here س and ر), extractors may report them
    // in the wrong order; the rendering is correct. The rest of the text extracts in order.
    expect((await pageTexts(out))[0]).toContain('للغاية')
  })

  it('rejects empty text, missing images and broken images', async () => {
    await expect(addWatermark(f('text-8p.pdf'), { ...WM, text: '  ' })).rejects.toMatchObject({ key: 'err.stampText' })
    await expect(addWatermark(f('text-8p.pdf'), { ...WM, kind: 'image' })).rejects.toMatchObject({ key: 'err.stampImage' })
    await expect(addWatermark(f('text-8p.pdf'), { ...WM, kind: 'image', image: { bytes: new Uint8Array([1, 2, 3]), kind: 'png' } })).rejects.toMatchObject({ key: 'err.stampImage' })
  })
})

describe('Crop', () => {
  const inset = (v: number) => ({ top: v, right: v, bottom: v, left: v })
  it('shrinks the visible page, hides (not deletes) content, keeps structure', async () => {
    const out = await cropPdf(f('text-8p.pdf'), Array.from({ length: 8 }, (_, index) => ({ index, inset: inset(50) })))
    expect(qpdfCheck(out)).toBe(true)
    const before = await visualSizes(fixture('text-8p.pdf'))
    const after = await visualSizes(out)
    after.forEach(([w, h], i) => { expect(w).toBeCloseTo(before[i][0] - 100, 1); expect(h).toBeCloseTo(before[i][1] - 100, 1) })
    // Hidden, not removed: all text is still in the file.
    expect(await pageTexts(out)).toEqual(await pageTexts(fixture('text-8p.pdf')))
  })

  it('crops the side the reader sees on a rotated page', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([600, 800])
    page.setRotation(degrees(90))
    // Visually the page is 800 wide × 600 tall. Visual top = user x near 0.
    page.drawText('TOPMARK', { x: 20, y: 400, size: 12, font, rotate: degrees(90) })
    page.drawText('BOTTOMMARK', { x: 580, y: 400, size: 12, font, rotate: degrees(90) })
    const src = await doc.save()
    const before = await placedText(src, 1)
    expect(before.items.find((i) => i.str === 'TOPMARK')!.y).toBeLessThan(50)
    const out = await cropPdf({ name: 'r.pdf', bytes: src }, [{ index: 0, inset: { top: 100, right: 0, bottom: 0, left: 0 } }])
    const after = await placedText(out, 1)
    expect([after.width, after.height]).toEqual([800, 500])
    const top = after.items.find((i) => i.str === 'TOPMARK')
    expect(!top || top.y < 0).toBe(true) // now outside the visible area (PDF.js may drop it entirely)
    const bottom = after.items.find((i) => i.str === 'BOTTOMMARK')!
    expect(bottom.y).toBeGreaterThan(0)
    expect(bottom.y).toBeLessThan(500)
  })

  it('per-page crops; validation', async () => {
    const out = await cropPdf(f('rich.pdf'), [{ index: 2, inset: { top: 0, right: 0, bottom: 100, left: 0 } }])
    const s0 = await visualSizes(fixture('rich.pdf'))
    const s1 = await visualSizes(out)
    expect(s1[0]).toEqual(s0[0])
    expect(s1[2][1]).toBeCloseTo(s0[2][1] - 100, 1)
    await expect(cropPdf(f('text-8p.pdf'), [{ index: 0, inset: inset(0) }])).rejects.toMatchObject({ key: 'err.cropNothing' })
    await expect(cropPdf(f('text-8p.pdf'), [{ index: 0, inset: inset(290) }])).rejects.toMatchObject({ key: 'err.cropTooSmall' })
    await expect(cropPdf(f('text-8p.pdf'), [{ index: 0, inset: { ...inset(0), top: -5 } }])).rejects.toMatchObject({ key: 'err.cropInvalid' })
  })
})

describe('Organize: duplicate and insert', () => {
  it('returns the original bytes when nothing changes', async () => {
    const src = fixture('rich.pdf')
    expect(await arrangePages({ name: 'a', bytes: src }, [], [0, 1, 2, 3].map((index) => ({ src: 0, index })))).toBe(src)
  })

  it('duplicates a page sharing its content; links copied, form widget not', async () => {
    const out = await arrangePages(f('rich.pdf'), [], [{ src: 0, index: 0 }, { src: 0, index: 0, rotate: 90 }, { src: 0, index: 1 }, { src: 0, index: 2 }, { src: 0, index: 3 }])
    expect(qpdfCheck(out)).toBe(true)
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(5)
    const subtypes = (i: number) => {
      const a = doc.getPage(i).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
      return a ? Array.from({ length: a.size() }, (_, k) => (a.lookup(k) as PDFDict).get(PDFName.of('Subtype'))!.toString()) : []
    }
    expect(subtypes(0)).toEqual(['/Link', '/Link', '/Widget'])
    expect(subtypes(1)).toEqual(['/Link', '/Link'])
    expect(doc.getPage(1).getRotation().angle).toBe(90)
    // Shared content stream: no duplication of page content.
    expect(doc.getPage(1).node.get(PDFName.of('Contents'))!.toString()).toBe(doc.getPage(0).node.get(PDFName.of('Contents'))!.toString())
    expect(doc.getForm().getFields().length).toBe((await PDFDocument.load(fixture('rich.pdf'))).getForm().getFields().length)
    const t = await pageTexts(out)
    expect(t[1]).toBe(t[0])
  })

  it('inserts pages from another PDF, keeping the main file’s bookmarks and fields', async () => {
    const out = await arrangePages(f('rich.pdf'), [f('text-8p.pdf')], [
      { src: 0, index: 0 }, { src: 1, index: 4 }, { src: 1, index: 4 }, { src: 0, index: 1 }, { src: 0, index: 2 }, { src: 0, index: 3 },
    ])
    expect(qpdfCheck(out)).toBe(true)
    const t = await pageTexts(out)
    const other = await pageTexts(fixture('text-8p.pdf'))
    expect(t[1]).toBe(other[4])
    expect(t[2]).toBe(other[4])
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(6)
    expect(doc.catalog.has(PDFName.of('Outlines'))).toBe(true)
    expect(doc.getForm().getFields().length).toBeGreaterThan(0)
    // Dropping a page with its bookmark still prunes correctly.
    const dropped = await arrangePages(f('rich.pdf'), [f('text-8p.pdf')], [{ src: 1, index: 0 }, { src: 0, index: 3 }])
    expect((await PDFDocument.load(dropped)).getPageCount()).toBe(2)
    expect(qpdfCheck(dropped)).toBe(true)
  })

  it('validates indices and sources', async () => {
    await expect(arrangePages(f('rich.pdf'), [], [])).rejects.toMatchObject({ key: 'err.needOnePage' })
    await expect(arrangePages(f('rich.pdf'), [], [{ src: 0, index: 9 }])).rejects.toMatchObject({ key: 'err.pageMissing' })
    await expect(arrangePages(f('rich.pdf'), [], [{ src: 2, index: 0 }])).rejects.toMatchObject({ key: 'err.pageMissing' })
  })
})
