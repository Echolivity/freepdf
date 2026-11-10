/**
 * Parse page-range syntax such as "1-3, 5, 8-" or "-4" into groups of 0-based page indices.
 * Each comma-separated part becomes one group (used by Split to produce one file per range).
 * Throws an Error with a user-readable message on invalid input.
 */
export function parseRanges(input: string, pageCount: number): number[][] {
  const text = input.trim()
  if (!text) throw new Error('Enter at least one page or range, for example 1-3, 5.')
  const groups: number[][] = []
  for (const raw of text.split(/[,;]+/)) {
    const part = raw.trim().toLowerCase()
    if (!part) continue
    const m = /^(\d+|last)?\s*(?:(-|–|to)\s*(\d+|last)?)?$/.exec(part)
    if (!m || (!m[1] && !m[3] && !m[2])) throw new Error(`“${raw.trim()}” isn't a valid page or range.`)
    const num = (s: string | undefined, fallback: number) => (s === undefined ? fallback : s === 'last' ? pageCount : parseInt(s, 10))
    const start = num(m[1], 1)
    const end = m[2] ? num(m[3], pageCount) : start
    if (start < 1 || end < 1) throw new Error('Page numbers start at 1.')
    if (start > pageCount || end > pageCount)
      throw new Error(`“${raw.trim()}” goes past the last page (this document has ${pageCount} page${pageCount === 1 ? '' : 's'}).`)
    const group: number[] = []
    if (start <= end) for (let i = start; i <= end; i++) group.push(i - 1)
    else for (let i = start; i >= end; i--) group.push(i - 1)
    groups.push(group)
  }
  if (!groups.length) throw new Error('Enter at least one page or range, for example 1-3, 5.')
  return groups
}

/** Unique, sorted page indices from a range string. */
export function parsePageSet(input: string, pageCount: number): number[] {
  return [...new Set(parseRanges(input, pageCount).flat())].sort((a, b) => a - b)
}

/** Compact 0-based indices back into "1-3, 5" form for display. */
export function formatRanges(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    out.push(i === j ? `${sorted[i] + 1}` : `${sorted[i] + 1}-${sorted[j] + 1}`)
    i = j + 1
  }
  return out.join(', ')
}

/** Groups for "split every N pages". */
export function chunkGroups(pageCount: number, size: number): number[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('Pages per file must be a whole number of at least 1.')
  const groups: number[][] = []
  for (let i = 0; i < pageCount; i += size) groups.push(Array.from({ length: Math.min(size, pageCount - i) }, (_, k) => i + k))
  return groups
}

