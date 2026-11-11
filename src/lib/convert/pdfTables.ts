/**
 * Rows and columns from positioned text, for PDF → Excel.
 *
 * Fragments on one baseline form a row; within a row, a gap wider than about one character height
 * starts a new cell. Columns are the x-ranges where cells of multi-cell rows overlap (rows with a single
 * cell — a title or a paragraph — don't shape the columns; they go in the first column).
 */
import { fixArabic, isRtlText } from './pdfText'
import type { Span } from './pdfExport'

export interface GridCell { text: string; x0: number; x1: number }
export interface Grid { rows: (string | null)[][]; widths: number[]; rtl: boolean }

export function rowsFromSpans(spans: Span[]): { y: number; cells: GridCell[] }[] {
  const upright = spans.filter((s) => Math.abs(s.angle) < 1 && s.str.trim())
  upright.sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: { y: number; size: number; items: Span[] }[] = []
  for (const s of upright) {
    const r = rows[rows.length - 1]
    if (r && Math.abs(r.y - s.y) <= Math.min(r.size, s.size) * 0.5) r.items.push(s)
    else rows.push({ y: s.y, size: s.size, items: [s] })
  }
  return rows.map((r) => {
    const items = [...r.items].sort((a, b) => a.x - b.x)
    const groups: { items: Span[]; x0: number; x1: number }[] = []
    for (const it of items) {
      const last = groups[groups.length - 1]
      if (last && it.x - last.x1 <= it.size * 0.9) { last.items.push(it); last.x1 = Math.max(last.x1, it.x + it.width) }
      else groups.push({ items: [it], x0: it.x, x1: it.x + it.width })
    }
    const cells: GridCell[] = groups.map((g) => {
      // Fragments of a right-to-left cell read from the right.
      const rtl = isRtlText(g.items.map((i) => fixArabic(i.str)).join(''))
      const ordered = rtl ? [...g.items].reverse() : g.items
      let text = ''
      let prev: Span | null = null
      for (const it of ordered) {
        if (prev) {
          const gap = Math.max(prev.x, it.x) - Math.min(prev.x + prev.width, it.x + it.width)
          if (gap > it.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' '
        }
        text += fixArabic(it.str)
        prev = it
      }
      return { text: text.replace(/\s+/g, ' ').trim(), x0: g.x0, x1: g.x1 }
    })
    return { y: r.y, cells: cells.filter((c) => c.text) }
  })
}

export function gridFromSpans(spans: Span[]): Grid {
  const rows = rowsFromSpans(spans)
  const rtl = isRtlText(rows.flatMap((r) => r.cells.map((c) => c.text)).join(' '))
  // Column bands from rows with two or more cells.
  const bands: [number, number][] = []
  for (const r of rows) {
    if (r.cells.length < 2) continue
    for (const c of r.cells) bands.push([c.x0, c.x1])
  }
  bands.sort((a, b) => a[0] - b[0])
  const cols: [number, number][] = []
  for (const b of bands) {
    const last = cols[cols.length - 1]
    if (last && b[0] <= last[1] + 2) last[1] = Math.max(last[1], b[1])
    else cols.push([b[0], b[1]])
  }
  if (!cols.length) cols.push([0, 1])
  // Right-to-left tables read from the right: column 1 is the rightmost.
  const ordered = rtl ? [...cols].reverse() : cols
  const colOf = (c: GridCell) => {
    let best = 0
    let overlap = -Infinity
    ordered.forEach(([a, b], i) => {
      const o = Math.min(b, c.x1) - Math.max(a, c.x0)
      const d = o > 0 ? o : -Math.min(Math.abs(c.x0 - b), Math.abs(a - c.x1))
      if (d > overlap) { overlap = d; best = i }
    })
    return best
  }
  const out: (string | null)[][] = rows.map((r) => {
    const row: (string | null)[] = Array(ordered.length).fill(null)
    if (r.cells.length === 1) { row[0] = r.cells[0].text; return row }
    for (const c of r.cells) {
      const i = colOf(c)
      row[i] = row[i] ? `${row[i]} ${c.text}` : c.text
    }
    return row
  })
  const widths = ordered.map(([a, b]) => b - a)
  return { rows: out, widths, rtl }
}

/** A cell's text as a number (with the Excel format that shows it the same way), if it is one. */
export function parseNumber(text: string): { value: number; format: string } | null {
  const t = text.replace(/[  \s]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, ',')
  const m = /^([-−(]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%?)(\)?)$/.exec(t)
  if (!m) return null
  if ((m[1] === '(') !== (m[5] === ')')) return null
  // Leading zeros (IDs, phone numbers, postcodes) stay text.
  if (/^0\d/.test(m[2])) return null
  const decimals = m[3]?.length ?? 0
  let value = Number(`${m[2].replace(/,/g, '')}${decimals ? `.${m[3]}` : ''}`)
  if (!Number.isFinite(value) || m[2].replace(/,/g, '').length > 15) return null
  if (m[1]) value = -value
  const pct = m[4] === '%'
  if (pct) value = Number((value / 100).toPrecision(15))
  const grouping = m[2].includes(',')
  let format = `${grouping ? '#,##0' : '0'}${decimals ? '.' + '0'.repeat(decimals) : ''}${pct ? '%' : ''}`
  if (m[1] === '(') format = `${format};(${format})`
  return { value, format }
}
