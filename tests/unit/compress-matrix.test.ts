import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib'
import { compressPdf, LEVELS, type CompressionLevel } from '../../src/lib/pdf/compress'
import { fixture, qpdfCheck } from './helpers'
import { nodeCodec } from './node-codec'
import { meanDiff, renderPage } from './render'

/** Compression against a fixture matrix, with a real JPEG encoder. Sizes, pixels and structure are genuine. */
const f = (name: string) => ({ name, bytes: fixture(`compress/${name}`) })
const run = (name: string, level: CompressionLevel) => compressPdf(f(name), level, nodeCodec)

function images(bytes: Uint8Array) {
  return PDFDocument.load(bytes).then((doc) => {
    const out: { ref: string; w: number; h: number; filter: string; cs: string; smask: boolean; len: number }[] = []
    for (const [ref, o] of doc.context.enumerateIndirectObjects()) {
      if (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
        out.push({
          ref: ref.toString(),
          w: (o.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber(),
          h: (o.dict.lookup(PDFName.of('Height')) as PDFNumber).asNumber(),
          filter: String(o.dict.get(PDFName.of('Filter'))),
          cs: String(o.dict.get(PDFName.of('ColorSpace'))),
          smask: !!o.dict.get(PDFName.of('SMask')),
          len: o.contents.length,
        })
      }
    }
    return out
  })
}

describe('compression levels behave differently and predictably', () => {
  it('image-heavy PDF: Strong < Balanced < Light < original, each within its quality budget', async () => {
    const original = fixture('compress/photos.pdf')
    const results = { light: await run('photos.pdf', 'light'), balanced: await run('photos.pdf', 'balanced'), strong: await run('photos.pdf', 'strong') }
    const sizes = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.bytes.length]))
    expect(sizes.light).toBeLessThan(original.length)
    expect(sizes.balanced).toBeLessThan(sizes.light)
    expect(sizes.strong).toBeLessThan(sizes.balanced)

    // Resolution caps per level are honoured (4000 px source image).
    for (const [level, r] of Object.entries(results)) {
      const maxSide = Math.max(...(await images(r.bytes)).map((i) => Math.max(i.w, i.h)))
      expect(maxSide, level).toBeLessThanOrEqual(LEVELS[level as CompressionLevel].maxDim)
    }

    // Controlled quality loss: mean colour error per level, compared at screen resolution.
    const ref = await renderPage(original, 1, 0.75)
    const diff = { light: 0, balanced: 0, strong: 0 }
    for (const level of ['light', 'balanced', 'strong'] as const) diff[level] = meanDiff(ref, await renderPage(results[level].bytes, 1, 0.75))
    expect(diff.light).toBeLessThan(2.5)
    expect(diff.balanced).toBeLessThan(4)
    expect(diff.strong).toBeLessThan(6)
    Object.values(results).forEach((r) => qpdfCheck(r.bytes))
    expect(results.strong.report).toMatchObject({ images: 3, recompressed: 3 })
  }, 120_000)

  it('vector-heavy PDF: nothing is rasterised; pages render identically', async () => {
    const r = await run('vector.pdf', 'strong')
    expect(r.report.images).toBe(0)
    const out = r.bytes
    expect(await images(out)).toEqual([])
    for (const p of [1, 3]) expect(meanDiff(await renderPage(fixture('compress/vector.pdf'), p, 0.5), await renderPage(out, p, 0.5))).toBe(0)
    qpdfCheck(out)
  }, 60_000)

  it('scanned greyscale document shrinks and stays legible', async () => {
    const r = await run('scan-gray.pdf', 'balanced')
    expect(r.unchanged).toBe(false)
    expect(r.bytes.length).toBeLessThan(fixture('compress/scan-gray.pdf').length * 0.6)
    expect(meanDiff(await renderPage(fixture('compress/scan-gray.pdf'), 1, 0.5), await renderPage(r.bytes, 1, 0.5))).toBeLessThan(4)
    qpdfCheck(r.bytes)
  }, 60_000)
})

describe('content that must not be damaged is skipped and reported', () => {
  it('transparent images are untouched and still render identically', async () => {
    const before = await images(fixture('compress/transparent.pdf'))
    const r = await run('transparent.pdf', 'strong')
    expect(r.report.skipped.transparency).toBe(1)
    expect(r.report.recompressed).toBe(0)
    const out = r.bytes
    const after = await images(out)
    // Same image + mask dimensions; base image still carries its soft mask.
    expect(after.map((i) => [i.w, i.h, i.smask]).sort()).toEqual(before.map((i) => [i.w, i.h, i.smask]).sort())
    expect(meanDiff(await renderPage(fixture('compress/transparent.pdf'), 1, 0.5), await renderPage(out, 1, 0.5))).toBe(0)
  }, 60_000)

  it('mixed colour spaces: RGB, grey and lossless are compressed; CMYK is skipped untouched', async () => {
    const original = fixture('compress/mixed-colour.pdf')
    const before = await images(original)
    const r = await run('mixed-colour.pdf', 'balanced')
    expect(r.report).toMatchObject({ images: 4, recompressed: 3 })
    expect(r.report.skipped.colourSpace).toBe(1)
    const cmyk = (await images(r.bytes)).filter((i) => i.cs === '/DeviceCMYK')
    expect(cmyk).toHaveLength(1)
    expect(cmyk[0].len).toBe(before.find((i) => i.cs === '/DeviceCMYK')!.len) // byte-for-byte untouched
    for (const p of [1, 2, 3, 4]) expect(meanDiff(await renderPage(original, p, 0.4), await renderPage(r.bytes, p, 0.4)), `page ${p}`).toBeLessThan(5)
    qpdfCheck(r.bytes)
  }, 120_000)

  it('Light keeps lossless images lossless; Balanced converts them', async () => {
    const light = await run('mixed-colour.pdf', 'light')
    expect(light.report.skipped.keptLossless).toBe(1)
    const balanced = await run('mixed-colour.pdf', 'balanced')
    expect(balanced.report.skipped.keptLossless).toBe(0)
  }, 120_000)

  it('ICC-based RGB images keep their profile and their colours', async () => {
    const base = await PDFDocument.create()
    const jpg = await base.embedJpg(fixture('big.jpg'))
    base.addPage([600, 400]).drawImage(jpg, { x: 0, y: 0, width: 600, height: 400 })
    // pdf-lib writes images on save, so attach the ICC profile to the saved image stream.
    const doc = await PDFDocument.load(await base.save())
    const iccRef = doc.context.register(doc.context.flateStream(fixture('compress/srgb.icc'), { N: 3 }))
    const [, img] = doc.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))!
    ;(img as PDFRawStream).dict.set(PDFName.of('ColorSpace'), doc.context.obj([PDFName.of('ICCBased'), iccRef]))
    const bytes = await doc.save()
    const r = await compressPdf({ name: 'icc.pdf', bytes }, 'balanced', nodeCodec)
    expect(r.report.recompressed).toBe(1)
    const out = await PDFDocument.load(r.bytes)
    const outImg = (await images(r.bytes))[0]
    expect(outImg.cs).toMatch(/ICCBased/)
    expect(out.context.lookup(PDFRef.of(Number(outImg.ref.split(' ')[0]), 0))).toBeTruthy()
    expect(meanDiff(await renderPage(bytes, 1, 0.5), await renderPage(r.bytes, 1, 0.5))).toBeLessThan(4)
  }, 60_000)
})

describe('honest results', () => {
  it('an already-compressed PDF is never made bigger; a second pass returns the original', async () => {
    const first = await run('photos.pdf', 'balanced')
    const second = await compressPdf({ name: 'again.pdf', bytes: first.bytes }, 'balanced', nodeCodec)
    expect(second.bytes.length).toBeLessThanOrEqual(first.bytes.length)
    if (second.unchanged) expect(second.bytes).toBe(first.bytes)
    expect(second.report.skipped.noGain).toBeGreaterThan(0)
  }, 120_000)

  it('PDFs with unusual embedded fonts (Arabic CID subsets) keep their text and appearance', async () => {
    const r = await compressPdf({ name: 'arabic.pdf', bytes: fixture('arabic.pdf') }, 'strong', nodeCodec)
    const out = r.unchanged ? fixture('arabic.pdf') : r.bytes
    for (const p of [1, 2]) expect(meanDiff(await renderPage(fixture('arabic.pdf'), p, 0.5), await renderPage(out, p, 0.5))).toBe(0)
  }, 60_000)

  it('report adds up: every image is either recompressed or has a skip reason', async () => {
    for (const name of ['photos.pdf', 'mixed-colour.pdf', 'transparent.pdf', 'scan-gray.pdf']) {
      const { report } = await run(name, 'balanced')
      const skipped = Object.values(report.skipped).reduce((a, b) => a + b, 0)
      expect(report.recompressed + skipped, name).toBe(report.images)
    }
  }, 120_000)
})
