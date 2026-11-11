/**
 * Things the browser draws that aren't in the DOM: list markers (1. 2. •) and CSS generated content
 * (::before / ::after, which Word renderers use for numbered paragraphs). They have to become real
 * text before measuring, or the PDF would lose them. CSS counters are evaluated here in document order
 * (a simplification of CSS scoping that matches how Word numbering is expressed).
 */
import { toRoman } from '../pdf/labels'

const PUA_BULLETS: Record<string, string> = { '': '•', '': '▪', '': '❖', '': '➢', '': '✓', '': '◦', '': '◦', '': '○' }

export function formatCounter(n: number, style: string): string {
  const s = style.trim().toLowerCase()
  const alpha = (v: number) => {
    let out = ''
    for (let x = v; x > 0; x = Math.floor((x - 1) / 26)) out = String.fromCharCode(97 + ((x - 1) % 26)) + out
    return out || '0'
  }
  switch (s) {
    case 'none': return ''
    case 'disc': return '•'
    case 'circle': return '◦'
    case 'square': return '▪'
    case 'decimal-leading-zero': return n < 10 && n >= 0 ? `0${n}` : String(n)
    case 'lower-alpha': case 'lower-latin': return alpha(n)
    case 'upper-alpha': case 'upper-latin': return alpha(n).toUpperCase()
    case 'lower-roman': return n > 0 && n < 4000 ? toRoman(n).toLowerCase() : String(n)
    case 'upper-roman': return n > 0 && n < 4000 ? toRoman(n) : String(n)
    case 'arabic-indic': return String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])
    default: return String(n)
  }
}

/** Unescape a CSS string body: \\9 (tab), \\a0, \\" and friends. */
function cssString(body: string): string {
  return body.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, hex: string | undefined, ch: string | undefined) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch ?? ''))
}

/** Evaluate a computed `content` value: strings and counter()/counters() (attr() and images are dropped). */
export function evalContent(content: string, counters: Map<string, number[]>): string {
  let out = ''
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|counters?\(([^)]*)\)/g
  for (const m of content.matchAll(re)) {
    if (m[1] !== undefined || m[2] !== undefined) {
      // Strings may themselves contain counter() text (some renderers quote it): evaluate that too.
      const s = cssString(m[1] ?? m[2])
      out += /counter\(/.test(s) ? evalContent(s.replace(/"/g, ''), counters) : s
      continue
    }
    const args = m[3].split(',').map((a) => a.trim())
    const stack = counters.get(args[0]) ?? [0]
    if (m[0].startsWith('counters(')) {
      const sep = cssString((args[1] ?? '"."').replace(/^["']|["']$/g, ''))
      out += stack.map((v) => formatCounter(v, args[2] ?? 'decimal')).join(sep)
    } else out += formatCounter(stack[stack.length - 1], args[1] ?? 'decimal')
  }
  return [...out].map((c) => PUA_BULLETS[c] ?? c).join('')
}

function pairs(v: string, dflt: number): [string, number][] {
  if (!v || v === 'none') return []
  const t = v.trim().split(/\s+/)
  const out: [string, number][] = []
  for (let i = 0; i < t.length; i++) {
    const n = Number(t[i + 1])
    if (Number.isFinite(n) && t[i + 1] !== undefined) { out.push([t[i], n]); i++ } else out.push([t[i], dflt])
  }
  return out
}

const COPY = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'white-space', 'display', 'min-width', 'width', 'padding-inline-start', 'padding-inline-end', 'margin-inline-start', 'margin-inline-end', 'text-decoration-line', 'vertical-align', 'letter-spacing']

/** Replace generated content and list markers under `root` with real, measurable spans. */
export function materializeGenerated(root: ShadowRoot | Element) {
  const counters = new Map<string, number[]>()
  const apply = (cs: CSSStyleDeclaration) => {
    for (const [name, n] of pairs(cs.getPropertyValue('counter-reset'), 0)) counters.set(name, [n])
    for (const [name, n] of pairs(cs.getPropertyValue('counter-set'), 0)) { const s = counters.get(name) ?? [0]; s[s.length - 1] = n; counters.set(name, s) }
    for (const [name, n] of pairs(cs.getPropertyValue('counter-increment'), 1)) { const s = counters.get(name) ?? [0]; s[s.length - 1] += n; counters.set(name, s) }
  }
  const make = (ps: CSSStyleDeclaration, text: string) => {
    const span = document.createElement('span')
    span.dataset.fpGenerated = ''
    for (const p of COPY) {
      const v = ps.getPropertyValue(p)
      if (v) span.style.setProperty(p, p === 'display' && v === 'block' ? 'block' : v)
    }
    if (span.style.display === 'list-item') span.style.display = 'inline'
    span.textContent = text
    return span
  }

  const elements: Element[] = []
  const collectAll = (n: ParentNode) => { for (const c of n.children) { elements.push(c); collectAll(c) } }
  collectAll(root)

  for (const el of elements) {
    if (!(el instanceof HTMLElement) || el.dataset.fpGenerated !== undefined) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none') continue
    apply(cs)
    for (const which of ['::before', '::after'] as const) {
      const ps = getComputedStyle(el, which)
      const content = ps.getPropertyValue('content')
      if (!content || content === 'none' || content === 'normal') continue
      apply(ps)
      const text = evalContent(content, counters)
      el.dataset[which === '::before' ? 'fpB' : 'fpA'] = ''
      if (!text) continue
      const span = make(ps, text)
      if (which === '::before') el.prepend(span)
      else el.append(span)
    }
    // Native list markers (HTML lists): an absolutely placed span, so the layout doesn't move.
    if (cs.display === 'list-item' && cs.listStyleType !== 'none' && !el.dataset.fpB) {
      const text = listMarker(el, cs.listStyleType)
      if (text) {
        const span = document.createElement('span')
        span.dataset.fpGenerated = ''
        span.textContent = text
        span.style.cssText = 'position:absolute;top:0;inset-inline-end:100%;padding-inline-end:0.45em;white-space:nowrap;font-weight:normal;font-style:normal'
        if (cs.position === 'static') el.style.position = 'relative'
        el.prepend(span)
        el.style.listStyleType = 'none'
      }
    }
  }
  const style = document.createElement('style')
  style.textContent = '[data-fp-b]::before{content:none!important}[data-fp-a]::after{content:none!important}'
  root.appendChild(style)
}

function listMarker(li: HTMLElement, type: string): string {
  const parent = li.parentElement
  if (!parent) return ''
  const t = type.replace(/^"|"$/g, '')
  if (/^(disc|circle|square)$/.test(t)) return formatCounter(0, t)
  if (/^["']/.test(type)) return type.slice(1, -1)
  const items = [...parent.children].filter((c) => c instanceof HTMLElement && getComputedStyle(c).display === 'list-item') as HTMLElement[]
  const ol = parent instanceof HTMLOListElement ? parent : null
  const reversed = !!ol?.reversed
  let n = ol && ol.hasAttribute('start') ? ol.start : reversed ? items.length : 1
  for (const item of items) {
    if (item instanceof HTMLLIElement && item.hasAttribute('value')) n = item.value
    if (item === li) break
    n += reversed ? -1 : 1
  }
  return `${formatCounter(n, t)}.`
}
