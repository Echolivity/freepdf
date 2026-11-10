/** Every distinct ArrayBuffer referenced by Uint8Arrays inside `value` (for postMessage transfer lists). */
export function transferablesOf(value: unknown): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>()
  const visit = (v: unknown, depth: number) => {
    if (depth > 6) return
    if (v instanceof Uint8Array) out.add(v.buffer as ArrayBuffer)
    else if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1))
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => visit(x, depth + 1))
  }
  visit(value, 0)
  return [...out]
}
