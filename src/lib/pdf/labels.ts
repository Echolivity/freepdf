/** Page-number labels. No pdf-lib here, so the tool's UI can use it for previews. */

export type NumberStyle = 'decimal' | 'roman' | 'roman-lower' | 'arabic-indic'

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
/** 1–3999 → Roman numerals; outside that range, plain digits (Roman numerals have no standard form). */
export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n)
  let out = ''
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v }
  return out
}

export function toArabicIndic(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)))
}

export function formatNumber(n: number, style: NumberStyle): string {
  switch (style) {
    case 'roman': return toRoman(n)
    case 'roman-lower': return toRoman(n).toLowerCase()
    case 'arabic-indic': return toArabicIndic(n)
    default: return String(n)
  }
}

/** The label each page gets (null = not numbered). Exported for the preview and tests. */
export function pageLabels(count: number, o: { indices: number[] | null; skipFirst: boolean; start: number; style: NumberStyle; prefix: string; suffix: string }): (string | null)[] {
  const targets = new Set((o.indices ?? Array.from({ length: count }, (_, i) => i)).filter((i) => !(o.skipFirst && i === 0)))
  const out: (string | null)[] = []
  let k = 0
  for (let i = 0; i < count; i++) out.push(targets.has(i) ? `${o.prefix}${formatNumber(o.start + k++, o.style)}${o.suffix}` : null)
  return out
}

