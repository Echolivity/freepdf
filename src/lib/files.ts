/** Make a filename safe for downloads and ZIP entries: no paths, control chars, reserved names or traversal. */
export function sanitizeFilename(name: string, fallback = 'document'): string {
  let base = name.split(/[\\/]/).pop() ?? ''
  base = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*‪-‮⁦-⁩]/g, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(base)) base = `_${base}`
  if (!base) base = fallback
  if (base.length > 150) {
    const dot = base.lastIndexOf('.')
    const ext = dot > 0 && base.length - dot <= 8 ? base.slice(dot) : ''
    base = base.slice(0, 150 - ext.length) + ext
  }
  return base
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** "report.pdf" + "_page-3" + "pdf" → "report_page-3.pdf" (sanitised). */
export function deriveName(original: string, suffix: string, ext: string): string {
  return sanitizeFilename(`${stripExtension(sanitizeFilename(original))}${suffix}.${ext}`, `document${suffix}.${ext}`)
}

/** Ensure names are unique within a ZIP / result set: "a.pdf", "a (2).pdf". */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((n) => {
    const key = n.toLowerCase()
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    if (count === 0) return n
    const dot = n.lastIndexOf('.')
    const candidate = dot > 0 ? `${n.slice(0, dot)} (${count + 1})${n.slice(dot)}` : `${n} (${count + 1})`
    seen.set(candidate.toLowerCase(), 1)
    return candidate
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`
}
