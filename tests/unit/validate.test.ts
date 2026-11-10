import { describe, expect, it } from 'vitest'
import { imageDimensions, sniffKind, validateFiles } from '../../src/lib/validate'
import { parseRanges, parsePageSet, formatRanges } from '../../src/lib/ranges'
import { sanitizeFilename, deriveName, uniqueNames } from '../../src/lib/files'
import { fixture } from './helpers'
import { translateMsg, type Message } from '../../src/i18n/core'

const en = (m: Message) => translateMsg('en', m)

const asFile = (bytes: Uint8Array, name: string, type = '') => new File([bytes as BlobPart], name, { type })

describe('file signatures', () => {
  it('detects types by content, not name', () => {
    expect(sniffKind(fixture('text-8p.pdf'))).toBe('pdf')
    expect(sniffKind(fixture('photo.jpg'))).toBe('jpeg')
    expect(sniffKind(fixture('alpha.png'))).toBe('png')
    expect(sniffKind(fixture('photo.webp'))).toBe('webp')
    expect(sniffKind(fixture('not-a-pdf.pdf'))).toBeNull()
  })

  it('reads image dimensions from headers', () => {
    expect(imageDimensions(fixture('photo.jpg'), 'jpeg')).toEqual({ width: 400, height: 300 })
    expect(imageDimensions(fixture('alpha.png'), 'png')).toEqual({ width: 120, height: 80 })
    expect(imageDimensions(fixture('photo.webp'), 'webp')).toEqual({ width: 400, height: 300 })
  })

  it('rejects a renamed non-PDF and accepts a real one', async () => {
    const { accepted, rejected } = await validateFiles(
      [asFile(fixture('not-a-pdf.pdf'), 'fake.pdf', 'application/pdf'), asFile(fixture('text-8p.pdf'), 'real.pdf')],
      ['pdf'],
    )
    expect(accepted.map((a) => a.name)).toEqual(['real.pdf'])
    expect(en(rejected[0])).toMatch(/fake\.pdf/)
  })

  it('rejects a JPEG named .pdf and names what it is', async () => {
    const { rejected } = await validateFiles([asFile(fixture('photo.jpg'), 'x.pdf')], ['pdf'])
    expect(en(rejected[0])).toMatch(/looks like JPG/)
  })

  it('blocks image decompression bombs by header dimensions', async () => {
    // Forge a PNG header claiming 50000x50000 pixels.
    const png = fixture('alpha.png').slice()
    const dv = new DataView(png.buffer)
    dv.setUint32(16, 50000)
    dv.setUint32(20, 50000)
    const { accepted, rejected } = await validateFiles([asFile(png, 'bomb.png')], ['png'])
    expect(accepted).toHaveLength(0)
    expect(en(rejected[0])).toMatch(/too large/)
  })

  it('rejects empty files', async () => {
    const { rejected } = await validateFiles([asFile(new Uint8Array(), 'e.pdf')], ['pdf'])
    expect(en(rejected[0])).toMatch(/empty/)
  })
})

describe('page ranges', () => {
  it('parses lists, open ranges and "last"', () => {
    expect(parseRanges('1-3, 5, 8-', 9)).toEqual([[0, 1, 2], [4], [7, 8]])
    expect(parseRanges('-2', 5)).toEqual([[0, 1]])
    expect(parseRanges('last', 4)).toEqual([[3]])
    expect(parseRanges('3-1', 4)).toEqual([[2, 1, 0]])
  })
  it('gives readable errors', () => {
    expect(() => parseRanges('1-20', 5)).toThrow(/past the last page/)
    expect(() => parseRanges('abc', 5)).toThrow(/isn't a valid/)
    expect(() => parseRanges('0', 5)).toThrow(/start at 1/)
    expect(() => parseRanges('  ', 5)).toThrow()
  })
  it('round-trips sets', () => {
    expect(parsePageSet('5, 1-3, 2', 9)).toEqual([0, 1, 2, 4])
    expect(formatRanges([0, 1, 2, 4, 6, 7])).toBe('1-3, 5, 7-8')
  })
})

describe('filenames', () => {
  it('strips paths, control characters and reserved names', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('C:\\Users\\me\\report.pdf')).toBe('report.pdf')
    expect(sanitizeFilename('a\u0000b<>:"|?*.pdf')).toBe('ab.pdf')
    expect(sanitizeFilename('evil\u202Efdp.exe')).toBe('evilfdp.exe')
    expect(sanitizeFilename('CON.pdf')).toBe('_CON.pdf')
    expect(sanitizeFilename('...')).toBe('document')
    expect(sanitizeFilename('x'.repeat(300) + '.pdf').length).toBeLessThanOrEqual(150)
  })
  it('derives output names', () => {
    expect(deriveName('My Report.pdf', '-merged', 'pdf')).toBe('My Report-merged.pdf')
    expect(deriveName('scan.jpeg', '', 'pdf')).toBe('scan.pdf')
  })
  it('deduplicates names for ZIPs', () => {
    expect(uniqueNames(['a.pdf', 'a.pdf', 'A.pdf', 'b'])).toEqual(['a.pdf', 'a (2).pdf', 'A (3).pdf', 'b'])
  })
})

describe('JPEG dimension check beyond the first 64 KB', () => {
  /** photo.jpg with two 60 KB APP15 segments inserted after SOI, optionally with forged frame size. */
  function padded(forge?: [number, number]) {
    const jpg = fixture('photo.jpg')
    const seg = new Uint8Array(4 + 60_000)
    seg.set([0xff, 0xef, (60_002 >> 8) & 0xff, 60_002 & 0xff])
    const out = new Uint8Array(jpg.length + seg.length * 2)
    out.set(jpg.subarray(0, 2), 0)
    out.set(seg, 2)
    out.set(seg, 2 + seg.length)
    out.set(jpg.subarray(2), 2 + seg.length * 2)
    if (forge) {
      // find SOF0 and overwrite height/width
      for (let i = 2 + seg.length * 2; i < out.length - 9; i++) {
        if (out[i] === 0xff && out[i + 1] === 0xc0) {
          out[i + 5] = forge[1] >> 8; out[i + 6] = forge[1] & 0xff
          out[i + 7] = forge[0] >> 8; out[i + 8] = forge[0] & 0xff
          break
        }
      }
    }
    return out
  }

  it('finds the frame size deep in the file and accepts a normal photo', async () => {
    const { accepted } = await validateFiles([asFile(padded(), 'meta-heavy.jpg')], ['jpeg'])
    expect(accepted).toHaveLength(1)
  })

  it('rejects a decompression bomb whose frame header is hidden past 64 KB', async () => {
    const { accepted, rejected } = await validateFiles([asFile(padded([60000, 60000]), 'hidden-bomb.jpg')], ['jpeg'])
    expect(accepted).toHaveLength(0)
    expect(en(rejected[0])).toMatch(/too large/)
  })

  it('rejects a JPEG with no frame header at all', async () => {
    const bad = new Uint8Array(200)
    bad.set([0xff, 0xd8, 0xff, 0xd9])
    const { rejected } = await validateFiles([asFile(bad, 'empty.jpg')], ['jpeg'])
    expect(en(rejected[0])).toMatch(/couldn't be read as an image/)
  })
})

describe('Arabic and right-to-left filenames', () => {
  it('keeps Arabic names intact and derives outputs from them', () => {
    expect(sanitizeFilename('تقرير الربع الأول.pdf')).toBe('تقرير الربع الأول.pdf')
    expect(deriveName('عقد إيجار.pdf', '-merged', 'pdf')).toBe('عقد إيجار-merged.pdf')
  })
  it('still strips bidi override characters used to disguise extensions', () => {
    expect(sanitizeFilename('فاتورة‮fdp.exe')).toBe('فاتورةfdp.exe')
  })
})
