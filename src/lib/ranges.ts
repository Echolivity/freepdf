import { UserFacingError } from './validate'

/** Accept Arabic-Indic / Persian digits, the Arabic comma and semicolon, and common dash variants. */
export function normalizeRangeInput(input: string): string {
  return input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u060c\u061b]/g, ',')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
}

/**
 * Parse page-range syntax such as "1-3, 5, 8-" or "-4" into groups of 0-based page indices.
 * Each comma-separated part becomes one group (used by Split to produce one file per range).
 * Throws a UserFacingError on invalid input.
 */
export function parseRanges(input: string, pageCount: number): number[][] {
  const text = normalizeRangeInput(input).trim()
  if (!text) throw new UserFacingError('rng.empty')
  const groups: number[][] = []
  for (const raw of text.split(/[,;]+/)) {
    const part = raw.trim().toLowerCase()
    if (!part) continue
    const m = /^(\d+|last)?\s*(?:(-|–|to)\s*(\d+|last)?)?$/.exec(part)
    if (!m || (!m[1] && !m[3] && !m[2])) throw new UserFacingError('rng.invalid', { part: raw.trim() })
    const num = (s: string | undefined, fallback: number) => (s === undefined ? fallback : s === 'last' ? pageCount : parseInt(s, 10))
    const start = num(m[1], 1)
    const end = m[2] ? num(m[3], pageCount) : start
    if (start < 1 || end < 1) throw new UserFacingError('rng.startAt1')
    if (start > pageCount || end > pageCount) throw new UserFacingError('rng.pastEnd', { part: raw.trim(), count: pageCount })
    const group: number[] = []
    if (start <= end) for (let i = start; i <= end; i++) group.push(i - 1)
    else for (let i = start; i >= end; i--) group.push(i - 1)
    groups.push(group)
  }
  if (!groups.length) throw new UserFacingError('rng.empty')
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
  if (!Number.isInteger(size) || size < 1) throw new UserFacingError('err.chunkSize')
  const groups: number[][] = []
  for (let i = 0; i < pageCount; i += size) groups.push(Array.from({ length: Math.min(size, pageCount - i) }, (_, k) => i + k))
  return groups
}

