import { describe, expect, it } from 'vitest'
import { imageDimensions, sniffKind, validateFiles } from '../../src/lib/validate'
import { parseRanges, parsePageSet, formatRanges } from '../../src/lib/ranges'
import { sanitizeFilename, deriveName, uniqueNames } from '../../src/lib/files'
import { fixture } from './helpers'

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
    expect(rejected[0]).toMatch(/fake\.pdf/)
  })

  it('rejects a JPEG named .pdf and names what it is', async () => {
    const { rejected } = await validateFiles([asFile(fixture('photo.jpg'), 'x.pdf')], ['pdf'])
    expect(rejected[0]).toMatch(/looks like JPG/)
  })

  it('blocks image decompression bombs by header dimensions', async () => {
    // Forge a PNG header claiming 50000x50000 pixels.
    const png = fixture('alpha.png').slice()
    const dv = new DataView(png.buffer)
    dv.setUint32(16, 50000)
    dv.setUint32(20, 50000)
    const { accepted, rejected } = await validateFiles([asFile(png, 'bomb.png')], ['png'])
    expect(accepted).toHaveLength(0)
    expect(rejected[0]).toMatch(/too large/)
  })

  it('rejects empty files', async () => {
    const { rejected } = await validateFiles([asFile(new Uint8Array(), 'e.pdf')], ['pdf'])
    expect(rejected[0]).toMatch(/empty/)
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
