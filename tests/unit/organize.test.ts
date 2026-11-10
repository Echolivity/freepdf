import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { mergePdfs, splitPdf, extractPages, removePages, rotatePdf, organizePdf, chunkGroups, getPageCount } from '../../src/lib/pdf/organize'
import { UserFacingError } from '../../src/lib/validate'
import { fixture, numberedPdf, pageIds, qpdfCheck, rotations } from './helpers'

const named = (bytes: Uint8Array, name = 'doc.pdf') => ({ name, bytes })

describe('merge', () => {
  it('concatenates pages in the given order', async () => {
    const a = await numberedPdf(3)
    const b = await numberedPdf(2)
    const out = await mergePdfs([named(b, 'b.pdf'), named(a, 'a.pdf')])
    expect(await pageIds(out)).toEqual([1, 2, 1, 2, 3])
    expect(qpdfCheck(out)).toBe(true)
  })

  it('merges real-world files (ReportLab output)', async () => {
    const out = await mergePdfs([named(fixture('text-8p.pdf')), named(fixture('scan.pdf'))])
    expect((await PDFDocument.load(out)).getPageCount()).toBe(10)
    qpdfCheck(out)
  })

  it('requires two files', async () => {
    await expect(mergePdfs([named(await numberedPdf(1))])).rejects.toThrow(UserFacingError)
  })

  it('reports encrypted input by name', async () => {
    await expect(mergePdfs([named(await numberedPdf(1)), named(fixture('encrypted-user.pdf'), 'secret.pdf')])).rejects.toThrow(/secret\.pdf.*password-protected/)
  })

  it('reports owner-password-only (permissions) PDFs as protected', async () => {
    await expect(mergePdfs([named(await numberedPdf(1)), named(fixture('encrypted-owner.pdf'), 'perm.pdf')])).rejects.toThrow(/password-protected/)
  })

  it('reports corrupted input clearly', async () => {
    await expect(mergePdfs([named(await numberedPdf(1)), named(fixture('garbage.pdf'), 'bad.pdf')])).rejects.toThrow(/bad\.pdf/)
  })
})

describe('split', () => {
  it('splits by ranges into separate files', async () => {
    const src = await numberedPdf(6)
    const parts = await splitPdf(named(src), [[0, 1, 2], [3], [4, 5]])
    expect(parts).toHaveLength(3)
    expect(await pageIds(parts[0])).toEqual([1, 2, 3])
    expect(await pageIds(parts[1])).toEqual([4])
    expect(await pageIds(parts[2])).toEqual([5, 6])
    parts.forEach(qpdfCheck)
  })

  it('chunkGroups splits every N pages with a short last chunk', () => {
    expect(chunkGroups(5, 2)).toEqual([[0, 1], [2, 3], [4]])
    expect(chunkGroups(3, 1)).toEqual([[0], [1], [2]])
    expect(() => chunkGroups(3, 0)).toThrow()
  })

  it('rejects out-of-range pages', async () => {
    await expect(splitPdf(named(await numberedPdf(2)), [[0, 5]])).rejects.toThrow(/Page 6 doesn't exist/)
  })

  it('handles a large document (500 pages) every-page split', async () => {
    const src = await numberedPdf(500)
    const parts = await splitPdf(named(src), chunkGroups(500, 1))
    expect(parts).toHaveLength(500)
    expect(await pageIds(parts[499])).toEqual([500])
  }, 120_000)
})

describe('extract / remove', () => {
  it('extracts selected pages in order', async () => {
    const out = await extractPages(named(await numberedPdf(5)), [1, 3])
    expect(await pageIds(out)).toEqual([2, 4])
  })

  it('removes pages and keeps the rest', async () => {
    const out = await removePages(named(await numberedPdf(5)), [0, 4])
    expect(await pageIds(out)).toEqual([2, 3, 4])
    qpdfCheck(out)
  })

  it('refuses to remove every page', async () => {
    await expect(removePages(named(await numberedPdf(2)), [0, 1])).rejects.toThrow(/at least one/)
  })

  it('refuses an empty selection', async () => {
    await expect(extractPages(named(await numberedPdf(2)), [])).rejects.toThrow(UserFacingError)
  })
})

describe('rotate / organize', () => {
  it('rotates all pages, adding to existing rotation', async () => {
    const once = await rotatePdf(named(await numberedPdf(2)), 90)
    expect(await rotations(once)).toEqual([90, 90])
    const twice = await rotatePdf(named(once), 270)
    expect(await rotations(twice)).toEqual([0, 0])
  })

  it('rotates selected pages only', async () => {
    const out = await rotatePdf(named(await numberedPdf(3)), 180, [1])
    expect(await rotations(out)).toEqual([0, 180, 0])
  })

  it('reorders, rotates and drops pages in one pass', async () => {
    const out = await organizePdf(named(await numberedPdf(4)), [
      { index: 3, rotate: 90 },
      { index: 0 },
      { index: 2, rotate: -90 },
    ])
    expect(await pageIds(out)).toEqual([4, 1, 3])
    expect(await rotations(out)).toEqual([90, 0, 270])
    qpdfCheck(out)
  })

  it('counts pages', async () => {
    expect(await getPageCount(named(fixture('text-8p.pdf')))).toBe(8)
  })

  it('recovers what it can from a partially truncated file', async () => {
    // pdf-lib rebuilds the page tree when the xref table is missing.
    expect(await getPageCount(named(fixture('truncated.pdf'), 'cut.pdf'))).toBeGreaterThan(0)
  })

  it('rejects a file truncated beyond recovery with a readable error', async () => {
    await expect(getPageCount(named(fixture('truncated-severe.pdf'), 'cut.pdf'))).rejects.toThrow(UserFacingError)
  })
})
