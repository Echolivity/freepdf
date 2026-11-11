/**
 * Word-level diff for document comparison. Patience diff (unique common words as anchors, longest
 * increasing subsequence), with an exact LCS for small gaps between anchors. Patience keeps moved or
 * repeated boilerplate from producing a noisy diff, and runs in near-linear time on real documents.
 *
 * Tokens are integer ids (equal ids = equal normalised words), so the worker never sees text it doesn't
 * need. Output: runs of equal, deleted (only in A) and inserted (only in B) tokens.
 */

export type DiffKind = 0 | 1 | 2 // 0 equal, 1 deleted from A, 2 inserted in B
export interface DiffRun {
  kind: DiffKind
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
}

/** Gaps up to this many cells (a × b) use an exact LCS; larger gaps without anchors become replace. */
const LCS_LIMIT = 4_000_000
/** Large gaps without unique anchors (very repetitive text) use Myers' O((N+M)·D) diff up to this many edits. */
const MAX_EDITS = 2000

export function diffTokens(a: Int32Array, b: Int32Array, opts: { lcsLimit?: number } = {}): DiffRun[] {
  const lcsLimit = opts.lcsLimit ?? LCS_LIMIT
  const out: DiffRun[] = []
  const push = (kind: DiffKind, aStart: number, aEnd: number, bStart: number, bEnd: number) => {
    if (aEnd === aStart && bEnd === bStart) return
    const last = out[out.length - 1]
    if (last && last.kind === kind && last.aEnd === aStart && last.bEnd === bStart) {
      last.aEnd = aEnd
      last.bEnd = bEnd
    } else out.push({ kind, aStart, aEnd, bStart, bEnd })
  }
  // Explicit stack: no recursion depth limit on long documents.
  const stack: [number, number, number, number][] = [[0, a.length, 0, b.length]]
  const segments: { kind: DiffKind; a0: number; a1: number; b0: number; b1: number }[] = []
  while (stack.length) {
    let [a0, a1, b0, b1] = stack.pop()!
    // Common prefix and suffix.
    let p = 0
    while (a0 + p < a1 && b0 + p < b1 && a[a0 + p] === b[b0 + p]) p++
    if (p) segments.push({ kind: 0, a0, a1: a0 + p, b0, b1: b0 + p })
    a0 += p
    b0 += p
    let s = 0
    while (a1 - s > a0 && b1 - s > b0 && a[a1 - 1 - s] === b[b1 - 1 - s]) s++
    if (s) segments.push({ kind: 0, a0: a1 - s, a1, b0: b1 - s, b1 })
    a1 -= s
    b1 -= s
    if (a0 === a1 || b0 === b1) {
      if (a1 > a0) segments.push({ kind: 1, a0, a1, b0, b1: b0 })
      if (b1 > b0) segments.push({ kind: 2, a0: a1, a1, b0, b1 })
      continue
    }
    const anchors = uniqueAnchors(a, a0, a1, b, b0, b1)
    if (anchors.length) {
      let pa = a0
      let pb = b0
      for (const [ia, ib] of anchors) {
        stack.push([pa, ia, pb, ib])
        segments.push({ kind: 0, a0: ia, a1: ia + 1, b0: ib, b1: ib + 1 })
        pa = ia + 1
        pb = ib + 1
      }
      stack.push([pa, a1, pb, b1])
      continue
    }
    const emit = (kind: DiffKind, x0: number, x1: number, y0: number, y1: number) => segments.push({ kind, a0: x0, a1: x1, b0: y0, b1: y1 })
    if ((a1 - a0) * (b1 - b0) <= lcsLimit) lcs(a, a0, a1, b, b0, b1, emit)
    else if (!myers(a, a0, a1, b, b0, b1, MAX_EDITS, emit)) {
      segments.push({ kind: 1, a0, a1, b0, b1: b0 })
      segments.push({ kind: 2, a0: a1, a1, b0, b1 })
    }
  }
  // Order by position in both sequences; deletions before insertions at the same spot.
  segments.sort((x, y) => x.a0 - y.a0 || x.b0 - y.b0 || x.kind - y.kind)
  for (const g of segments) push(g.kind, g.a0, g.a1, g.b0, g.b1)
  return out
}

/** Tokens that occur exactly once in both ranges, kept in an order increasing in both (LIS). */
function uniqueAnchors(a: Int32Array, a0: number, a1: number, b: Int32Array, b0: number, b1: number): [number, number][] {
  const countA = new Map<number, number>()
  for (let i = a0; i < a1; i++) countA.set(a[i], countA.has(a[i]) ? -1 : i)
  const countB = new Map<number, number>()
  for (let i = b0; i < b1; i++) countB.set(b[i], countB.has(b[i]) ? -1 : i)
  const pairs: [number, number][] = []
  for (let i = a0; i < a1; i++) {
    const ia = countA.get(a[i])!
    if (ia !== i) continue
    const ib = countB.get(a[i])
    if (ib !== undefined && ib >= 0) pairs.push([ia, ib])
  }
  if (!pairs.length) return []
  // Longest increasing subsequence on the B positions (pairs are already sorted by A position).
  const tails: number[] = []
  const prev = new Int32Array(pairs.length).fill(-1)
  for (let i = 0; i < pairs.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[tails[mid]][1] < pairs[i][1]) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]
    tails[lo] = i
  }
  const res: [number, number][] = []
  for (let k = tails[tails.length - 1]; k >= 0; k = prev[k]) res.push(pairs[k])
  return res.reverse()
}

/** Exact LCS (dynamic programming) for one gap; emits runs in order. */
function lcs(
  a: Int32Array, a0: number, a1: number, b: Int32Array, b0: number, b1: number,
  emit: (kind: DiffKind, a0: number, a1: number, b0: number, b1: number) => void,
) {
  const n = a1 - a0
  const m = b1 - b0
  const w = m + 1
  const t = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[a0 + i] === b[b0 + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[a0 + i] === b[b0 + j]) { emit(0, a0 + i, a0 + i + 1, b0 + j, b0 + j + 1); i++; j++ }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) { emit(1, a0 + i, a0 + i + 1, b0 + j, b0 + j); i++ }
    else { emit(2, a0 + i, a0 + i, b0 + j, b0 + j + 1); j++ }
  }
  if (i < n) emit(1, a0 + i, a1, b0 + j, b0 + j)
  if (j < m) emit(2, a0 + i, a0 + i, b0 + j, b1)
}

/**
 * Myers' greedy diff (shortest edit script), for long repetitive gaps where patience finds no anchors.
 * Returns false (emitting nothing) if more than `maxD` edits would be needed; the caller then reports
 * the gap as replaced. Memory is O(D²) for the trace, bounded by `maxD`.
 */
function myers(
  a: Int32Array, a0: number, a1: number, b: Int32Array, b0: number, b1: number, maxD: number,
  emit: (kind: DiffKind, a0: number, a1: number, b0: number, b1: number) => void,
): boolean {
  const n = a1 - a0
  const m = b1 - b0
  const off = maxD + 1
  const v = new Int32Array(2 * maxD + 3)
  const trace: Int32Array[] = []
  let found = -1
  outer: for (let d = 0; d <= maxD; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2)) // V after step d-1, for k in [-d-1, d+1]
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) { x++; y++ }
      v[off + k] = x
      if (x >= n && y >= m) { found = d; break outer }
    }
  }
  if (found < 0) return false
  const rev: [DiffKind, number, number, number, number][] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d]
    const get = (k: number) => prev[k + d + 1]
    const k = x - y
    const down = k === -d || (k !== d && get(k - 1) < get(k + 1))
    const pk = down ? k + 1 : k - 1
    const px = get(pk)
    const py = px - pk
    const sx = down ? px : px + 1 // start of the snake, after the single edit
    const sy = down ? py + 1 : py
    if (x > sx) rev.push([0, a0 + sx, a0 + x, b0 + sy, b0 + y])
    if (down) rev.push([2, a0 + px, a0 + px, b0 + py, b0 + py + 1])
    else rev.push([1, a0 + px, a0 + px + 1, b0 + py, b0 + py])
    x = px
    y = py
  }
  if (x > 0) rev.push([0, a0, a0 + x, b0, b0 + y])
  for (let i = rev.length - 1; i >= 0; i--) emit(...rev[i])
  return true
}

/** Normalise a word for comparison: compatibility forms (incl. Arabic presentation forms), no tatweel or invisible marks. */
export function normalizeWord(w: string): string {
  return w.normalize('NFKC').replace(/[ـ​-‏‪-‮⁦-⁩﻿­]/g, '')
}

/** Split text into words (whitespace-separated, punctuation kept attached). */
export function splitWords(s: string): { word: string; start: number; end: number }[] {
  const out: { word: string; start: number; end: number }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const word = normalizeWord(m[0])
    if (word) out.push({ word, start: m.index, end: m.index + m[0].length })
  }
  return out
}

/** Map words to integer ids shared between both documents. */
export function intern(aWords: string[], bWords: string[]): { a: Int32Array; b: Int32Array } {
  const ids = new Map<string, number>()
  const id = (w: string) => {
    let v = ids.get(w)
    if (v === undefined) ids.set(w, (v = ids.size))
    return v
  }
  return { a: Int32Array.from(aWords, id), b: Int32Array.from(bWords, id) }
}
