import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib'

/**
 * Fonts for text FreePDF writes onto pages (page numbers, watermarks).
 *
 * - helvetica / times / courier: PDF standard fonts. Nothing is embedded (smallest output), but they
 *   only cover Latin text (WinAnsi).
 * - plex: IBM Plex Sans Arabic (SIL OFL 1.1), embedded when chosen or when the text needs it (Arabic,
 *   Arabic-Indic digits, anything outside WinAnsi). Shaped with fontkit, so Arabic letters join correctly.
 *   Embedded whole (≈100 KB compressed): pdf-lib's subsetting drops glyphs reached through OpenType
 *   substitutions, which breaks joined Arabic forms.
 */
export type FontFamily = 'helvetica' | 'times' | 'courier' | 'plex'
export const FONT_FAMILIES: FontFamily[] = ['helvetica', 'times', 'courier', 'plex']

/** Must match the installed @expo-google-fonts/ibm-plex-sans-arabic version (checked by a unit test). */
export const FONT_VERSION = '0.4.2'

const STANDARD: Record<Exclude<FontFamily, 'plex'>, [StandardFonts, StandardFonts]> = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold],
}

type Loader = (file: string) => Promise<Uint8Array>

/** Same-origin fetch from the worker (CSP: connect-src 'self'). Tests replace it with a file reader. */
let loader: Loader = async (file) => {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  const res = await fetch(`${base}pdfjs/fonts/${FONT_VERSION}/${file}`)
  if (!res.ok) throw new Error(`font ${file}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
export function setFontLoader(fn: Loader) {
  loader = fn
}

/** Characters the standard fonts can encode (WinAnsi), so we know when to switch to the embedded font. */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
export function fitsStandardFont(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) continue
    if (WIN_ANSI_EXTRA.includes(ch)) continue
    return false
  }
  return true
}

/** Embed (once per document) the font for `family`, falling back to Plex when the text needs it. */
export async function fontFor(doc: PDFDocument, family: FontFamily, bold: boolean, texts: string[]): Promise<PDFFont> {
  const needsUnicode = texts.some((t) => !fitsStandardFont(t))
  const fam: FontFamily = needsUnicode ? 'plex' : family
  const cache = (doc as unknown as { __freepdfFonts?: Map<string, PDFFont> })
  cache.__freepdfFonts ??= new Map()
  const key = `${fam}:${bold}`
  const hit = cache.__freepdfFonts.get(key)
  if (hit) return hit
  let font: PDFFont
  if (fam === 'plex') {
    const fontkit = (await import('@pdf-lib/fontkit')).default
    doc.registerFontkit(fontkit)
    font = await doc.embedFont(await loader(bold ? 'IBMPlexSansArabic-Bold.ttf' : 'IBMPlexSansArabic-Regular.ttf'), { subset: false })
  } else {
    font = await doc.embedFont(STANDARD[fam][bold ? 1 : 0])
  }
  cache.__freepdfFonts.set(key, font)
  return font
}
