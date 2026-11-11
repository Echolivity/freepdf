import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { diffTokens, intern, normalizeWord, splitWords, type DiffRun } from '../../src/lib/compare/diff'
import { buildComparison, extractWords, tokenIds } from '../../src/lib/compare/compare'
import { diffPixels } from '../../src/lib/compare/pixels'
import { imagesToPdf } from '../../src/lib/pdf/images'
import { fixture } from './helpers'
import { openNode } from './render'

/** Rebuild B from A and the runs; also checks that "equal" runs really are equal. */
function apply(a: Int32Array, b: Int32Array, runs: DiffRun[]): number[] {
  const out: number[] = []
  let ia = 0
  let ib = 0
  for (const r of runs) {
    expect(r.aStart).toBe(ia)
    expect(r.bStart).toBe(ib)
    if (r.kind === 0) {
      expect(r.aEnd - r.aStart).toBe(r.bEnd - r.bStart)
      for (let k = 0; k < r.aEnd - r.aStart; k++) expect(a[r.aStart + k]).toBe(b[r.bStart + k])
      out.push(...a.subarray(r.aStart, r.aEnd))
    } else if (r.kind === 2) out.push(...b.subarray(r.bStart, r.bEnd))
    ia = r.aEnd
    ib = r.bEnd
  }
  expect(ia).toBe(a.length)
  expect(ib).toBe(b.length)
  return out
}

const words = (s: string) => s.split(' ').filter(Boolean)

describe('word diff', () => {
  it('finds a replaced word', () => {
    const { a, b } = intern(words('the quick brown fox jumps'), words('the quick red fox jumps'))
    const runs = diffTokens(a, b)
    expect(runs.map((r) => r.kind)).toEqual([0, 1, 2, 0])
    expect([runs[1].aStart, runs[1].aEnd, runs[2].bStart, runs[2].bEnd]).toEqual([2, 3, 2, 3])
  })

  it('identical and empty inputs', () => {
    const { a } = intern(words('a b c'), [])
    expect(diffTokens(a, a)).toEqual([{ kind: 0, aStart: 0, aEnd: 3, bStart: 0, bEnd: 3 }])
    expect(diffTokens(new Int32Array(), new Int32Array())).toEqual([])
    expect(diffTokens(a, new Int32Array()).map((r) => r.kind)).toEqual([1])
  })

  it('random edits always reconstruct the target exactly (property test)', () => {
    let seed = 7
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n)
    for (let round = 0; round < 300; round++) {
      const len = rnd(400)
      const a = Int32Array.from({ length: len }, () => rnd(round % 3 === 0 ? 5 : 60))
      const b: number[] = [...a]
      const edits = rnd(20)
      for (let e = 0; e < edits; e++) {
        const pos = rnd(b.length + 1)
        const op = rnd(3)
        if (op === 0) b.splice(pos, 0, rnd(60))
        else if (op === 1 && b.length) b.splice(pos % b.length, 1 + rnd(5))
        else if (b.length) b[pos % b.length] = rnd(60)
      }
      const bb = Int32Array.from(b)
      expect(apply(a, bb, diffTokens(a, bb))).toEqual(b)
      // Same input through the Myers path (no exact-LCS gaps allowed).
      expect(apply(a, bb, diffTokens(a, bb, { lcsLimit: 0 }))).toEqual(b)
    }
  })

  it('stays fast and minimal-ish on a long document with a few edits', () => {
    const base = Array.from({ length: 200_000 }, (_, i) => `w${i % 9973}`)
    const changed = [...base]
    changed.splice(50_000, 3, 'NEW', 'TEXT')
    changed.splice(150_000, 0, 'INSERTED')
    const { a, b } = intern(base, changed)
    const t0 = performance.now()
    const runs = diffTokens(a, b)
    expect(performance.now() - t0).toBeLessThan(5000)
    apply(a, b, runs)
    const removed = runs.filter((r) => r.kind === 1).reduce((s, r) => s + r.aEnd - r.aStart, 0)
    const added = runs.filter((r) => r.kind === 2).reduce((s, r) => s + r.bEnd - r.bStart, 0)
    expect(removed).toBeLessThanOrEqual(6)
    expect(added).toBeLessThanOrEqual(6)
  })

  it('normalises Arabic presentation forms, tatweel and invisible marks', () => {
    expect(normalizeWord('ﻣﺮﺣﺒﺎ')).toBe('مرحبا') // presentation forms
    expect(normalizeWord('مـــرحبا')).toBe('مرحبا') // tatweel
    expect(normalizeWord('‏مرحبا‎')).toBe('مرحبا')
    expect(splitWords('  one  two\tthree ').map((w) => w.word)).toEqual(['one', 'two', 'three'])
  })
})

async function textPdf(lines: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const pageLines of lines) {
    const p = doc.addPage([595, 842])
    pageLines.forEach((l, i) => p.drawText(l, { x: 50, y: 780 - i * 20, size: 12, font }))
  }
  return doc.save()
}

async function compareBytes(x: Uint8Array, y: Uint8Array) {
  const A = await openNode(x)
  const B = await openNode(y)
  try {
    const a = await extractWords(A.doc as never)
    const b = await extractWords(B.doc as never)
    const ids = tokenIds(a.words, b.words)
    return buildComparison(a, b, diffTokens(ids.a, ids.b))
  } finally {
    await A.close()
    await B.close()
  }
}

describe('PDF comparison', () => {
  it('reports the changed words, their pages and boxes', async () => {
    const a = await textPdf([['Payment is due within 30 days.', 'Unchanged line.'], ['Second page text.']])
    const b = await textPdf([['Payment is due within 45 days.', 'Unchanged line.'], ['Second page text.', 'A new clause.']])
    const c = await compareBytes(a, b)
    expect(c.changes.map((x) => [x.removed, x.added])).toEqual([['30', '45'], ['', 'A new clause.']])
    expect(c.changedPages).toEqual([0, 1])
    expect(c.removedCount).toBe(1)
    expect(c.addedCount).toBe(4)
    // The highlighted word has a box on the right line of page 1.
    const i = c.wordsA.findIndex((w) => w.text === '30')
    expect(c.removedA[i]).toBe(1)
    const [x, y, w, h] = c.wordsA[i].box!
    expect(y).toBeGreaterThan(770)
    expect(y).toBeLessThan(785)
    expect(x).toBeGreaterThan(100)
    expect(w).toBeGreaterThan(5)
    expect(h).toBeGreaterThan(8)
  })

  it('identical documents (including Arabic) have no changes', async () => {
    const ar = fixture('arabic.pdf')
    const c = await compareBytes(ar, ar)
    expect(c.changes).toEqual([])
    expect(c.changedPages).toEqual([])
    expect(c.wordsA.some((w) => /[؀-ۿ]/.test(w.text))).toBe(true)
  })

  it('flags page-count and page-size differences', async () => {
    const a = await textPdf([['x'], ['y']])
    const doc = await PDFDocument.load(a)
    doc.getPage(1).setSize(612, 792)
    doc.addPage([595, 842])
    const c = await compareBytes(a, await doc.save())
    expect(c.sizeChanged).toEqual([1])
    expect(c.changedPages).toEqual([1, 2])
  })

  it('scans without text fall back to visual comparison', async () => {
    const scan = await imagesToPdf([{ name: 'p.jpg', kind: 'jpeg', bytes: fixture('photo.jpg') }], { pageSize: 'a4', orientation: 'auto', margin: 0 })
    const c = await compareBytes(scan, scan)
    expect(c.noText).toBe(true)
  })
})

describe('pixel diff', () => {
  const img = (w: number, h: number, fill: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(fill) })
  it('counts differing pixels with a tolerance and colours them by direction', () => {
    const a = img(10, 10, 255)
    const b = img(10, 10, 255)
    for (let i = 0; i < 4; i++) b.data.set([0, 0, 0, 255], i * 4) // 4 dark pixels only in B
    b.data.set([250, 250, 250, 255], 50 * 4) // tiny change, under tolerance
    const d = diffPixels(a, b, 16)
    expect(d.changed).toBe(4)
    expect(d.ratio).toBeCloseTo(0.04)
    expect([...d.data.subarray(0, 3)]).toEqual([22, 163, 74]) // green = added
  })
  it('compares pages of different sizes on a white canvas', () => {
    const d = diffPixels(img(4, 4, 255), img(6, 4, 255), 0)
    expect([d.width, d.height, d.changed]).toEqual([6, 4, 0])
  })
})
