import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { en } from '../../src/i18n/en'
import { ar } from '../../src/i18n/ar'
import { loadLang, translate } from '../../src/i18n/core'
import { beforeAll } from 'vitest'

beforeAll(() => loadLang('ar'))
import { parseRanges } from '../../src/lib/ranges'
import { searchTools } from '../../src/tools/registry'
import { extractPages, mergePdfs, organizePdf, removePages } from '../../src/lib/pdf/organize'
import { fixture, qpdfCheck } from './helpers'
import { meanDiff, renderPage } from './render'

const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
const ARABIC = /[؀-ۿﭐ-﷿ﹰ-﻿]/

async function pageText(bytes: Uint8Array, n: number): Promise<string> {
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: join(root, 'standard_fonts') + '/' })
  const doc = await task.promise
  try {
    const tc = await (await doc.getPage(n)).getTextContent()
    return tc.items.map((i) => ('str' in i ? i.str : '')).join(' ')
  } finally {
    await task.destroy()
  }
}

describe('Arabic dictionary', () => {
  const placeholders = (s: unknown) => new Set(JSON.stringify(s).match(/\{\w+\}/g) ?? [])

  it('has exactly the same keys as English, none empty', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
    for (const [k, v] of Object.entries(ar)) {
      const strings = typeof v === 'string' ? [v] : Object.values(v)
      for (const s of strings) expect(s.trim().length, k).toBeGreaterThan(0)
    }
  })

  it('keeps every placeholder the English text uses (except {count} where Arabic spells the number out)', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      const need = [...placeholders(en[k])].filter((p) => p !== '{count}')
      const have = placeholders(ar[k])
      for (const p of need) expect(have.has(p), `${k} is missing ${p}`).toBe(true)
    }
  })

  it('uses all six Arabic plural forms', () => {
    const forms = [0, 1, 2, 5, 11, 100].map((count) => translate('ar', 'home.found', { count }))
    expect(forms).toEqual(['لم يُعثر على أدوات', 'أداة واحدة', 'أداتان', '5 أدوات', '11 أداة', '100 أداة'])
    expect(translate('en', 'home.found', { count: 1 })).toBe('1 tool found')
  })

  it('isolates Latin file names inside Arabic sentences', () => {
    expect(translate('ar', 'val.empty', { name: 'report.pdf' })).toBe('الملف «⁨report.pdf⁩» فارغ.')
  })
})

describe('Arabic input', () => {
  it('accepts Arabic-Indic digits, the Arabic comma and different dashes in page ranges', () => {
    expect(parseRanges('١-٢، ٥', 9)).toEqual([[0, 1], [4]])
    expect(parseRanges('۳–۴', 9)).toEqual([[2, 3]])
  })

  it('finds tools by Arabic words, ignoring hamza/diacritic differences', () => {
    expect(searchTools('دمج')[0].slug).toBe('merge-pdf')
    expect(searchTools('ضغط').map((t) => t.slug)).toContain('compress-pdf')
    expect(searchTools('استخراج').map((t) => t.slug)).toContain('extract-pages')
    expect(searchTools('إستخراج').map((t) => t.slug)).toContain('extract-pages')
    expect(searchTools('تدوير').map((t) => t.slug)).toContain('rotate-pdf')
    expect(searchTools('combine')[0].slug).toBe('merge-pdf')
  })
})

describe('Arabic PDFs are processed without damage', () => {
  const src = () => ({ name: 'عقد إيجار.pdf', bytes: fixture('arabic.pdf') })

  it('fixture contains real Arabic text', async () => {
    expect(await pageText(fixture('arabic.pdf'), 1)).toMatch(ARABIC)
  })

  it('remove / extract / organize / merge keep Arabic pages pixel-identical and text extractable', async () => {
    const original = fixture('arabic.pdf')
    const removed = await removePages(src(), [0])
    expect(meanDiff(await renderPage(removed, 1), await renderPage(original, 2))).toBe(0)
    expect(await pageText(removed, 1)).toMatch(ARABIC)

    const extracted = await extractPages(src(), [2])
    expect(meanDiff(await renderPage(extracted, 1), await renderPage(original, 3))).toBe(0)

    const organized = await organizePdf(src(), [{ index: 2 }, { index: 1 }, { index: 0 }])
    expect(meanDiff(await renderPage(organized, 3), await renderPage(original, 1))).toBe(0)

    const merged = await mergePdfs([src(), { name: 'b.pdf', bytes: fixture('text-8p.pdf') }])
    expect(meanDiff(await renderPage(merged, 2), await renderPage(original, 2))).toBe(0)
    expect(await pageText(merged, 3)).toMatch(ARABIC)
    ;[removed, extracted, organized, merged].forEach(qpdfCheck)
  }, 60_000)
})
