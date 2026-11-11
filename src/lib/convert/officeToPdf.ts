/**
 * Word, Excel and HTML → laid-out DOM → PDF (see domToPdf.ts). Main thread; no network.
 */
import { flowsToPdf, offscreenHost, type Flow } from './domToPdf'
import { sanitizeHtml } from './htmlInput'
import { materializeGenerated } from './pseudo'
import { readXlsx, sheetToHtml } from './xlsx'
import { UserFacingError } from '../validate'
import { CancelledError } from '../workerClient'

export type PaperSize = 'a4' | 'letter'
export type Orientation = 'auto' | 'portrait' | 'landscape'
const PAPER: Record<PaperSize, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] }

export interface ConvertResult { pdf: Uint8Array; pages: number; removed?: number; sheets?: number; skippedImages: number }

interface Common { signal?: AbortSignal; onProgress?: (f: number) => void }

const BASE_CSS = `:host{all:initial;display:block;color:#000;font:16px/1.4 Arial,Helvetica,"Liberation Sans",sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%}
img{max-width:100%;height:auto}`

async function settle(root: ShadowRoot | HTMLElement, signal?: AbortSignal) {
  const imgs = [...root.querySelectorAll('img')]
  await Promise.all(imgs.map((i) => (i.complete ? null : i.decode().catch(() => undefined))))
  await document.fonts.ready
  // Two frames: layout and any late style recalculation are done.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  if (signal?.aborted) throw new CancelledError()
}

function pageFor(size: PaperSize, orientation: Orientation, wideContent: boolean): [number, number] {
  const [w, h] = PAPER[size]
  return orientation === 'landscape' || (orientation === 'auto' && wideContent) ? [h, w] : [w, h]
}

// ---------------------------------------------------------------- Word

export async function docxToPdf(bytes: Uint8Array, name: string, o: Common & { headersFooters: boolean }): Promise<ConvertResult> {
  const { renderAsync } = await import('docx-preview')
  const { shadow, dispose } = offscreenHost(1200)
  try {
    const style = document.createElement('div')
    const body = document.createElement('div')
    const base = document.createElement('style')
    // Lay pages out flat (no grey preview background, gaps or shadows); keep docx-preview's page boxes.
    base.textContent = `${BASE_CSS}
section.docx{box-shadow:none!important;margin:0!important;background:#fff}`
    shadow.append(base, style, body)
    try {
      await renderAsync(bytes, body, style, {
        inWrapper: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        renderHeaders: o.headersFooters,
        renderFooters: o.headersFooters,
        renderFootnotes: true,
        renderEndnotes: true,
        renderComments: false,
        renderChanges: false,
        renderAltChunks: false, // embedded HTML would need an iframe
        useBase64URL: true,
        experimental: false,
        className: 'docx',
      })
    } catch {
      throw new UserFacingError('err.officeBrokenNamed', { kind: 'DOCX', name })
    }
    o.onProgress?.(0.2)
    await settle(shadow, o.signal)
    tightenLists(shadow)
    materializeGenerated(shadow)
    await settle(shadow, o.signal)
    const sections = [...shadow.querySelectorAll<HTMLElement>('section.docx')]
    if (!sections.length) throw new UserFacingError('err.officeBrokenNamed', { kind: 'DOCX', name })
    const flows: Flow[] = sections.map((sec) => {
      const cs = getComputedStyle(sec)
      const r = sec.getBoundingClientRect()
      const minH = parseFloat(cs.minHeight) || r.height
      const px = (v: string) => (parseFloat(v) || 0) * 0.75
      return {
        root: sec,
        pageWidth: r.width * 0.75,
        pageHeight: minH * 0.75,
        margin: { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) },
        paddingIsMargin: true,
        header: sec.querySelector<HTMLElement>(':scope > header'),
        footer: sec.querySelector<HTMLElement>(':scope > footer'),
      }
    })
    const out = await flowsToPdf(flows, { signal: o.signal, onProgress: (f) => o.onProgress?.(0.25 + f * 0.75), title: name.replace(/\.docx$/i, '') })
    return out
  } finally {
    dispose()
  }
}

/**
 * Word list styles normally use "contextual spacing" (no space between paragraphs of the same list),
 * which the renderer doesn't apply: remove the gap between consecutive items of one list.
 */
function tightenLists(root: ShadowRoot) {
  for (const p of root.querySelectorAll<HTMLElement>('p[class*="-num-"]')) {
    const next = p.nextElementSibling
    const num = (el: Element) => [...el.classList].find((c) => /-num-\d+-\d+$/.test(c))?.replace(/-\d+$/, '')
    if (next instanceof HTMLElement && next.tagName === 'P' && num(p) && num(p) === num(next)) {
      p.style.marginBottom = '0'
      next.style.marginTop = '0'
    }
  }
}

// ---------------------------------------------------------------- HTML

export interface PageOptions { size: PaperSize; orientation: Orientation; margin: number; fit: boolean }

export async function htmlToPdf(text: string, name: string, o: Common & PageOptions): Promise<ConvertResult> {
  const clean = sanitizeHtml(text)
  const [pw0] = pageFor(o.size, o.orientation === 'auto' ? 'portrait' : o.orientation, false)
  const contentPx = (pw0 - o.margin * 2) / 0.75
  const { shadow, dispose } = offscreenHost(contentPx)
  try {
    const style = document.createElement('style')
    style.textContent = `${BASE_CSS}\n.fp-missing-image{color:#666;font-style:italic}\n${clean.css}`
    const holder = document.createElement('div')
    holder.innerHTML = clean.html // already rebuilt from an allowlist; contains no script or external reference
    shadow.append(style, holder)
    await settle(shadow, o.signal)
    materializeGenerated(shadow)
    await settle(shadow, o.signal)
    const root = holder.firstElementChild as HTMLElement
    const natural = Math.max(root.scrollWidth, ...[...root.querySelectorAll('*')].map((e) => e.getBoundingClientRect().right - root.getBoundingClientRect().left))
    const wide = natural > contentPx + 2
    const [pw, ph] = pageFor(o.size, o.orientation, wide)
    const available = (pw - o.margin * 2) / 0.75
    const fit = o.fit && natural > available + 2 ? available / natural : 1
    o.onProgress?.(0.2)
    const out = await flowsToPdf(
      [{ root, pageWidth: pw, pageHeight: ph, margin: { top: o.margin, right: o.margin, bottom: o.margin, left: o.margin }, fit }],
      { signal: o.signal, onProgress: (f) => o.onProgress?.(0.2 + f * 0.8), title: clean.title || name.replace(/\.x?html?$/i, '') },
    )
    return { ...out, removed: clean.removedExternal + clean.removedActive }
  } finally {
    dispose()
  }
}

// ---------------------------------------------------------------- Excel

export interface SheetOptions extends PageOptions { gridlines: boolean; sheetNames: boolean }

export async function xlsxToPdf(bytes: Uint8Array, name: string, o: Common & SheetOptions): Promise<ConvertResult> {
  const sheets = (await readXlsx(bytes)).filter((s) => s.rows.length)
  if (!sheets.length) throw new UserFacingError('err.sheetEmpty', { name })
  o.onProgress?.(0.1)
  const [pw0] = PAPER[o.size]
  const { shadow, dispose } = offscreenHost(4000)
  try {
    const style = document.createElement('style')
    style.textContent = `${BASE_CSS}\n.fp-sheet{width:max-content}\n.fp-sheet-name{font:600 13px Arial,sans-serif;color:#555;margin:0 0 6px}`
    shadow.append(style)
    const roots = sheets.map((s) => {
      const div = document.createElement('div')
      div.className = 'fp-sheet'
      div.dir = s.rtl ? 'rtl' : 'ltr'
      div.innerHTML = (o.sheetNames ? `<p class="fp-sheet-name">${s.name.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</p>` : '') + sheetToHtml(s, o.gridlines && s.gridlines)
      shadow.append(div)
      return div
    })
    await settle(shadow, o.signal)
    const flows: Flow[] = roots.map((root) => {
      const natural = root.getBoundingClientRect().width
      const wide = natural * 0.75 > pw0 - o.margin * 2 + 1
      const [pw, ph] = pageFor(o.size, o.orientation, wide)
      const available = (pw - o.margin * 2) / 0.75
      return { root, pageWidth: pw, pageHeight: ph, margin: { top: o.margin, right: o.margin, bottom: o.margin, left: o.margin }, fit: o.fit && natural > available ? available / natural : 1, alignEnd: root.dir === 'rtl' }
    })
    const out = await flowsToPdf(flows, { signal: o.signal, onProgress: (f) => o.onProgress?.(0.1 + f * 0.9), title: name.replace(/\.xlsx$/i, '') })
    return { ...out, sheets: sheets.length }
  } finally {
    dispose()
  }
}
