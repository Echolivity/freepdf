/** Safety limits. They protect the user's browser from running out of memory; they are not usage quotas. */
export const LIMITS = {
  /** Largest single input file. */
  maxFileBytes: 250 * 1024 * 1024,
  /** Largest combined input for one job. */
  maxJobBytes: 600 * 1024 * 1024,
  /** Most files accepted in one job. */
  maxFiles: 200,
  /** Images larger than this (width × height) are refused before decoding (decompression-bomb guard). */
  maxImagePixels: 100_000_000,
  /** Rendered canvas caps (browsers fail silently above these). */
  maxCanvasSide: 16_384,
  maxCanvasPixels: 60_000_000,
} as const

export const MB = 1024 * 1024
