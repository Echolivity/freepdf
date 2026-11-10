import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { imagesToPdf, jpegOrientation } from '../../src/lib/pdf/images'
import { fixture, qpdfCheck } from './helpers'

const opts = { pageSize: 'fit' as const, orientation: 'auto' as const, margin: 0 }

describe('images to PDF', () => {
  it('reads EXIF orientation', () => {
    expect(jpegOrientation(fixture('rotated-exif6.jpg'))).toBe(6)
    expect(jpegOrientation(fixture('photo.jpg'))).toBe(1)
  })

  it('makes one page per image, sized to the image', async () => {
    const out = await imagesToPdf(
      [
        { name: 'a.jpg', kind: 'jpeg', bytes: fixture('photo.jpg') },
        { name: 'b.png', kind: 'png', bytes: fixture('alpha.png') },
      ],
      opts,
    )
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getSize()).toEqual({ width: 300, height: 225 }) // 400x300 px at 96 DPI
    expect(doc.getPage(1).getSize()).toEqual({ width: 90, height: 60 })
    qpdfCheck(out)
  })

  it('swaps page dimensions for EXIF-rotated photos', async () => {
    const out = await imagesToPdf([{ name: 'r.jpg', kind: 'jpeg', bytes: fixture('rotated-exif6.jpg') }], opts)
    const size = (await PDFDocument.load(out)).getPage(0).getSize()
    expect(size).toEqual({ width: 225, height: 300 })
  })

  it('embeds JPEGs without re-encoding (byte-identical stream)', async () => {
    const jpg = fixture('photo.jpg')
    const out = await imagesToPdf([{ name: 'a.jpg', kind: 'jpeg', bytes: jpg }], opts)
    // The original JPEG bytes appear verbatim in the output.
    const hay = Buffer.from(out)
    expect(hay.indexOf(Buffer.from(jpg.subarray(0, 2048)))).toBeGreaterThan(0)
  })

  it('uses A4 landscape automatically for wide images', async () => {
    const out = await imagesToPdf([{ name: 'a.jpg', kind: 'jpeg', bytes: fixture('photo.jpg') }], { pageSize: 'a4', orientation: 'auto', margin: 18 })
    const { width, height } = (await PDFDocument.load(out)).getPage(0).getSize()
    expect(Math.round(width)).toBe(842)
    expect(Math.round(height)).toBe(595)
  })

  it('rejects a corrupt image with its name', async () => {
    const bad = new Uint8Array(500)
    bad.set([0xff, 0xd8, 0xff, 0xe0])
    await expect(imagesToPdf([{ name: 'broken.jpg', kind: 'jpeg', bytes: bad }], opts)).rejects.toThrow(/broken\.jpg/)
  })
})
