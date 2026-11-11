import { bodySize, buildBlocks, buildLines, isRtlText, itemsFromContent, pageText, type Line } from './pdfText'

/** The bits of a PDF.js document/page this module uses (so tests can pass Node's legacy build). */
interface PageLike {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] }
  getTextContent(): Promise<{ items: unknown[] }>
  cleanup(): void
}
export interface DocLike {
  numPages: number
  getPage(n: number): Promise<PageLike>
}

export interface PageText {
  /** 1-based page number. */
  number: number
  width: number
  height: number
  lines: Line[]
  /** Fragments in page (viewport) space, for the exact-layout HTML text layer. */
  spans: Span[]
}

export interface Span {
  str: string
  /** Baseline origin in CSS pixels at 72 dpi, top-left origin. */
  x: number
  y: number
  size: number
  /** Rotation in degrees (clockwise, CSS/SVG convention). */
  angle: number
  width: number
}

function mul(m1: number[], m2: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1]
}

/** Read one page's text (nothing is rendered or executed). */
export async function readPageText(doc: DocLike, n: number): Promise<PageText> {
  const page = await doc.getPage(n)
  try {
    const vp = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const lines = buildLines(itemsFromContent(content))
    const spans: Span[] = []
    for (const raw of content.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number }
      if (!it.str?.trim() || !it.transform) continue
      const m = mul(vp.transform, it.transform)
      const size = Math.hypot(m[2], m[3])
      if (!size || !Number.isFinite(m[4]) || !Number.isFinite(m[5])) continue
      spans.push({ str: it.str, x: m[4], y: m[5], size, angle: (Math.atan2(m[1], m[0]) * 180) / Math.PI, width: Math.abs(it.width ?? 0) })
    }
    return { number: n, width: vp.width, height: vp.height, lines, spans }
  } finally {
    page.cleanup()
  }
}

export interface TextExportOptions {
  layout: 'lines' | 'paragraphs'
  pageMarkers: boolean
  lineEnding: 'lf' | 'crlf'
}

/** Pages → one .txt body. `markerLabel` makes the page heading ("--- Page 3 ---") translatable. */
export function toPlainText(pages: PageText[], o: TextExportOptions, markerLabel: (n: number) => string): string {
  const body = bodySize(pages.flatMap((p) => p.lines))
  const parts = pages.map((p) => {
    const text = pageText(p.lines, o.layout, body)
    return o.pageMarkers ? `${markerLabel(p.number)}\n\n${text}` : text
  })
  const out = parts.join(o.pageMarkers ? '\n\n\n' : '\n\n') + '\n'
  return o.lineEnding === 'crlf' ? out.replace(/\n/g, '\r\n') : out
}

export function hasText(pages: PageText[]): boolean {
  return pages.some((p) => p.lines.some((l) => l.text.trim()))
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r = (n: number) => Math.round(n * 100) / 100

/**
 * The exported page may be opened anywhere, so it carries its own lock-down: no scripts, no
 * network, images only from data: URLs. Every piece of PDF text is escaped.
 */
function shell(title: string, rtl: boolean, style: string, body: string, labels: HtmlLabels): string {
  return `<!DOCTYPE html>
<html${rtl ? ' lang="ar" dir="rtl"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="generator" content="FreePDF">
<title>${esc(title)}</title>
<style>
body{margin:0;background:#f3f2ee;color:#16171b;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Arabic",sans-serif}
main{max-width:52rem;margin:0 auto;padding:2rem 1.25rem 4rem}
.page-label{margin:2.5rem 0 1rem;color:#6b6d74;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase}
${style}
</style>
</head>
<body>
<main aria-label="${esc(labels.document)}">
${body}
</main>
</body>
</html>
`
}

export interface HtmlLabels {
  document: string
  page: (n: number) => string
}

/** Semantic HTML: headings and paragraphs, in reading order. Images and exact positions are not kept. */
export function toFlowHtml(title: string, pages: PageText[], labels: HtmlLabels): string {
  const body = bodySize(pages.flatMap((p) => p.lines))
  const all = pages.flatMap((p) => p.lines.map((l) => l.text)).join(' ')
  const rtl = isRtlText(all)
  const sections = pages.map((p) => {
    const blocks = buildBlocks(p.lines, body)
      .map((b) => {
        const dir = b.rtl !== rtl ? ` dir="${b.rtl ? 'rtl' : 'ltr'}"` : ''
        return `<${b.kind}${dir}>${esc(b.text)}</${b.kind}>`
      })
      .join('\n')
    return `<section id="page-${p.number}" aria-label="${esc(labels.page(p.number))}">\n<p class="page-label" aria-hidden="true">${esc(labels.page(p.number))}</p>\n${blocks}\n</section>`
  })
  const style = 'h1,h2,h3{line-height:1.25;margin:1.6em 0 .6em}p{margin:0 0 1em}'
  return shell(title, rtl, style, sections.join('\n'), labels)
}

/**
 * Exact layout: each page is its rendered image with the text laid over it, transparent but
 * selectable and searchable (SVG text stretched to each fragment's measured width).
 */
export function toLayoutHtml(title: string, pages: (PageText & { image: string })[], labels: HtmlLabels): string {
  const all = pages.flatMap((p) => p.spans.map((s) => s.str)).join(' ')
  const rtl = isRtlText(all)
  const figures = pages.map((p) => {
    const w = r(p.width)
    const h = r(p.height)
    const texts = p.spans
      .map((s) => {
        const len = s.width > 0 ? ` textLength="${r(s.width)}" lengthAdjust="spacingAndGlyphs"` : ''
        const rot = Math.abs(s.angle) > 0.01 ? ` transform="rotate(${r(s.angle)} ${r(s.x)} ${r(s.y)})"` : ''
        return `<text x="${r(s.x)}" y="${r(s.y)}" font-size="${r(s.size)}"${len}${rot}>${esc(s.str)}</text>`
      })
      .join('')
    return `<p class="page-label" aria-hidden="true">${esc(labels.page(p.number))}</p>
<figure class="page" id="page-${p.number}" aria-label="${esc(labels.page(p.number))}"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><image href="${p.image}" width="${w}" height="${h}" preserveAspectRatio="none"/>${texts}</svg></figure>`
  })
  const style = `main{max-width:none}
.page{margin:0 auto 1.5rem;max-width:100%;width:fit-content;box-shadow:0 1px 3px rgba(0,0,0,.12),0 10px 30px -12px rgba(0,0,0,.25);background:#fff}
.page svg{display:block;max-width:100%;height:auto}
.page text{fill:transparent;white-space:pre;font-family:sans-serif}
.page-label{text-align:center}`
  return shell(title, rtl, style, figures.join('\n'), labels)
}
