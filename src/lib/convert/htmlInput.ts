/**
 * Untrusted HTML → a safe, self-contained fragment for layout.
 *
 * Parsed with DOMParser (nothing in it runs), then rebuilt from an allowlist of elements and
 * attributes. Every external reference is removed: scripts, frames, plugins, links, forms, remote and
 * relative images (only data: images stay), url() in CSS except data: images, @import. So rendering
 * the page can't make a single network request (and the CSP would block one anyway).
 */

const KEEP = new Set(
  'p div span h1 h2 h3 h4 h5 h6 b strong i em u s strike del ins sub sup small big mark code pre kbd samp var blockquote q cite br hr ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col img figure figcaption section article header footer main nav aside address center font abbr time label wbr dfn bdi bdo ruby rt rp details summary'.split(' '),
)
/** Removed with everything inside them. */
const DROP = new Set('script style noscript template iframe frame frameset object embed applet link meta base title head input select textarea option button form video audio source track canvas svg math map area portal dialog'.split(' '))
const ATTRS = new Set('class id dir lang style colspan rowspan width height align valign border cellpadding cellspacing bgcolor color face size start type value reversed alt title span'.split(' '))

export interface SanitizedHtml {
  /** Markup for the shadow root: one wrapper standing in for <html>/<body>. */
  html: string
  css: string
  title: string
  removedExternal: number
  removedActive: number
}

/** Remove url(...) except data: images, @import and legacy script hooks from CSS text. */
export function sanitizeCss(css: string): { css: string; removed: number } {
  let removed = 0
  let out = css
    .replace(/@import[^;]*;?/gi, () => { removed++; return '' })
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q, u: string) => {
      if (/^data:image\/(png|jpe?g|gif|webp);/i.test(u.trim())) return m
      removed++
      return 'none'
    })
    .replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript:/gi, () => { removed++; return 'invalid(' })
  // Fixed positioning would be relative to the viewport, far away from the off-screen page.
  out = out.replace(/position\s*:\s*(fixed|sticky)/gi, 'position:static')
  return { css: out, removed }
}

/** Selectors aimed at the document map onto the wrappers inside the shadow root. */
function scopeSelectors(css: string): string {
  return css.replace(/(^|[\s,>+~}{(])(:root|html)(?=[\s,.:#[>+~{)]|$)/gi, '$1.fp-html').replace(/(^|[\s,>+~}{(])body(?=[\s,.:#[>+~{)]|$)/gi, '$1.fp-body')
}

export function sanitizeHtml(source: string): SanitizedHtml {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  let removedExternal = 0
  let removedActive = 0
  const styles: string[] = []
  for (const s of doc.querySelectorAll('style')) {
    const r = sanitizeCss(s.textContent ?? '')
    removedExternal += r.removed
    styles.push(r.css)
  }
  removedExternal += doc.querySelectorAll('link[href], iframe, frame, object, embed, video, audio, source[src]').length
  removedActive += doc.querySelectorAll('script, [onclick], [onload], [onerror], [onmouseover]').length

  const clean = (node: Node, into: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) { into.appendChild(document.createTextNode(child.textContent ?? '')); continue }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as Element
      const tag = el.tagName.toLowerCase()
      if (DROP.has(tag)) continue
      if (!KEEP.has(tag)) { clean(el, into); continue } // unknown or custom element: keep its content
      if (tag === 'img') {
        const src = el.getAttribute('src')?.trim() ?? ''
        if (!/^data:image\/(png|jpe?g|gif|webp);/i.test(src)) {
          removedExternal++
          const alt = el.getAttribute('alt')
          if (alt) {
            const span = document.createElement('span')
            span.className = 'fp-missing-image'
            span.textContent = `[${alt}]`
            into.appendChild(span)
          }
          continue
        }
      }
      const out = document.createElement(tag === 'a' ? 'span' : tag)
      for (const a of [...el.attributes]) {
        const name = a.name.toLowerCase()
        if (name === 'src' && tag === 'img') { out.setAttribute('src', a.value); continue }
        if (!ATTRS.has(name)) continue
        if (name === 'style') {
          const r = sanitizeCss(a.value)
          removedExternal += r.removed
          out.setAttribute('style', r.css)
        } else out.setAttribute(name, a.value)
      }
      into.appendChild(out)
      clean(el, out)
    }
  }

  const wrapper = document.createElement('div')
  wrapper.className = 'fp-html'
  const body = document.createElement('div')
  body.className = 'fp-body'
  for (const [from, to] of [[doc.documentElement, wrapper], [doc.body, body]] as const) {
    for (const name of ['dir', 'lang', 'class', 'bgcolor']) {
      const v = from?.getAttribute(name)
      if (v) to.setAttribute(name, name === 'class' ? `${to.className} ${v}` : v)
    }
    const st = from?.getAttribute('style')
    if (st) to.setAttribute('style', sanitizeCss(st).css)
  }
  if (doc.body) clean(doc.body, body)
  wrapper.appendChild(body)
  return {
    html: wrapper.outerHTML,
    css: scopeSelectors(styles.join('\n')),
    title: doc.title.trim(),
    removedExternal,
    removedActive,
  }
}

/** Is this text an HTML document (as opposed to text that happens to be named .html)? */
export function looksLikeHtml(head: string): boolean {
  return /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<(p|div|h[1-6]|table|ul|ol|span|br)[\s>/]/i.test(head)
}
