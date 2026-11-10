/**
 * Safety limits. They protect the user's browser from running out of memory; they are not usage quotas.
 * Phones and low-memory devices get lower caps, because parsing, rendering and zipping can briefly need
 * several times a file's size in memory.
 */
export const MB = 1024 * 1024

function detectLowMemory(): boolean {
  if (typeof navigator === 'undefined') return false
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof mem === 'number') return mem <= 4
  // Safari/Firefox don't expose deviceMemory: treat touch-first devices as constrained.
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

export const LOW_MEMORY = detectLowMemory()

/** Both profiles, for transparent display. LIMITS below is the one in force on this device. */
export const LIMIT_PROFILES = {
  standard: { maxFileBytes: 250 * MB, maxJobBytes: 600 * MB },
  constrained: { maxFileBytes: 100 * MB, maxJobBytes: 200 * MB },
} as const

export const LIMITS = {
  /** Largest single input file. */
  maxFileBytes: LIMIT_PROFILES[LOW_MEMORY ? 'constrained' : 'standard'].maxFileBytes,
  /** Largest combined input for one job. */
  maxJobBytes: LIMIT_PROFILES[LOW_MEMORY ? 'constrained' : 'standard'].maxJobBytes,
  /** Show a "this may be slow" warning above this combined size. */
  warnJobBytes: (LOW_MEMORY ? 40 : 150) * MB,
  /** Most files accepted in one job. */
  maxFiles: 200,
  /** Images larger than this (width × height) are refused before decoding (decompression-bomb guard). */
  maxImagePixels: 100_000_000,
  /** Rendered canvas caps (browsers fail silently above these). */
  maxCanvasSide: 16_384,
  maxCanvasPixels: LOW_MEMORY ? 24_000_000 : 60_000_000,
} as const
