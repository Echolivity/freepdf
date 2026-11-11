import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFStream, PDFString, type PDFContext, type PDFDocument, type PDFObject } from 'pdf-lib'

/**
 * Keeps document-level structures consistent after pages are removed in place:
 * form fields, bookmarks (outlines), internal links and named destinations that pointed at removed
 * pages are pruned. Everything else (metadata, attachments, remaining fields/bookmarks) is untouched.
 */

const N = (s: string) => PDFName.of(s)
const key = (r: PDFRef) => r.toString()

export function annotationRefs(leaves: PDFDict[]): Set<string> {
  const out = new Set<string>()
  for (const leaf of leaves) {
    const annots = leaf.lookup(N('Annots'))
    if (annots instanceof PDFArray) for (const a of annots.asArray()) if (a instanceof PDFRef) out.add(key(a))
  }
  return out
}

function text(o: PDFObject | undefined): string | undefined {
  if (o instanceof PDFName) return o.decodeText()
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText()
  return undefined
}

function lookupNameTree(ctx: PDFContext, node: PDFDict | undefined, name: string, depth = 0): PDFObject | undefined {
  if (!node || depth > 32) return undefined
  const names = node.lookup(N('Names'))
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) if (text(names.lookup(i)) === name) return names.get(i + 1)
  }
  const kids = node.lookup(N('Kids'))
  if (kids instanceof PDFArray) {
    for (const k of kids.asArray()) {
      const found = lookupNameTree(ctx, ctx.lookup(k) as PDFDict, name, depth + 1)
      if (found) return found
    }
  }
  return undefined
}

/** Resolve any destination (explicit array, named, or dict with /D) to its target page ref. */
export function destinationPage(doc: PDFDocument, dest: PDFObject | undefined, depth = 0): PDFRef | undefined {
  if (!dest || depth > 8) return undefined
  const ctx = doc.context
  const d = dest instanceof PDFRef ? ctx.lookup(dest) : dest
  if (d instanceof PDFArray) {
    const first = d.get(0)
    return first instanceof PDFRef ? first : undefined
  }
  if (d instanceof PDFDict) return destinationPage(doc, d.get(N('D')), depth + 1)
  const name = text(d)
  if (name === undefined) return undefined
  const catalog = doc.catalog
  const dests = catalog.lookup(N('Dests'))
  if (dests instanceof PDFDict) {
    const v = dests.get(N(name))
    if (v) return destinationPage(doc, v, depth + 1)
  }
  const namesDict = catalog.lookup(N('Names'))
  if (namesDict instanceof PDFDict) {
    const tree = namesDict.lookup(N('Dests'))
    if (tree instanceof PDFDict) return destinationPage(doc, lookupNameTree(ctx, tree, name), depth + 1)
  }
  return undefined
}

/** Target page of an outline item or link annotation (via /Dest or a GoTo action). */
function targetPage(doc: PDFDocument, item: PDFDict): PDFRef | undefined {
  const dest = item.get(N('Dest'))
  if (dest) return destinationPage(doc, dest)
  const action = item.lookup(N('A'))
  if (action instanceof PDFDict && action.get(N('S')) === N('GoTo')) return destinationPage(doc, action.get(N('D')))
  return undefined
}

export function pruneForRemovedPages(doc: PDFDocument, removed: Set<string>, annotsBefore: Set<string>, remaining: PDFDict[]) {
  if (!removed.size) return
  const annotsAfter = annotationRefs(remaining)
  pruneAcroForm(doc, annotsBefore, annotsAfter)
  pruneOutlines(doc, removed)
  pruneLinks(doc, removed, remaining)
  pruneNamedDests(doc, removed)
}

function pruneAcroForm(doc: PDFDocument, before: Set<string>, after: Set<string>) {
  const ctx = doc.context
  const acro = doc.catalog.lookup(N('AcroForm'))
  if (!(acro instanceof PDFDict)) return
  const fields = acro.lookup(N('Fields'))
  if (!(fields instanceof PDFArray)) return
  const gone = (r: PDFRef) => before.has(key(r)) && !after.has(key(r))
  const seen = new Set<string>()

  const keep = (obj: PDFObject, depth: number): boolean => {
    if (!(obj instanceof PDFRef)) return true
    if (seen.has(key(obj)) || depth > 64) return true
    seen.add(key(obj))
    const node = ctx.lookup(obj)
    if (!(node instanceof PDFDict)) return true
    const kids = node.lookup(N('Kids'))
    if (kids instanceof PDFArray && kids.size() > 0) {
      const kept = kids.asArray().filter((k) => keep(k, depth + 1))
      if (!kept.length) return false
      if (kept.length !== kids.size()) node.set(N('Kids'), ctx.obj(kept))
      return true
    }
    return !gone(obj)
  }

  const keptFields = fields.asArray().filter((f) => keep(f, 0))
  acro.set(N('Fields'), ctx.obj(keptFields))
  const co = acro.lookup(N('CO'))
  if (co instanceof PDFArray) {
    const live = new Set<string>()
    const collect = (o: PDFObject, d: number) => {
      if (!(o instanceof PDFRef) || live.has(key(o)) || d > 64) return
      live.add(key(o))
      const kids = (ctx.lookup(o) as PDFDict | undefined)?.lookup?.(N('Kids'))
      if (kids instanceof PDFArray) kids.asArray().forEach((k) => collect(k, d + 1))
    }
    keptFields.forEach((f) => collect(f, 0))
    acro.set(N('CO'), ctx.obj(co.asArray().filter((r) => !(r instanceof PDFRef) || live.has(key(r)))))
  }
}

function pruneOutlines(doc: PDFDocument, removed: Set<string>) {
  const ctx = doc.context
  const root = doc.catalog.lookup(N('Outlines'))
  if (!(root instanceof PDFDict)) return
  const visited = new Set<string>()

  /** Prunes children of `parent`; returns the number of visible descendants. */
  const prune = (parent: PDFDict, depth: number): number => {
    const kept: PDFRef[] = []
    let ref = parent.get(N('First'))
    let guard = 0
    while (ref instanceof PDFRef && !visited.has(key(ref)) && guard++ < 100_000) {
      visited.add(key(ref))
      const item = ctx.lookup(ref)
      const next = item instanceof PDFDict ? item.get(N('Next')) : undefined
      if (item instanceof PDFDict) {
        if (depth < 64 && item.get(N('First'))) prune(item, depth + 1)
        const target = targetPage(doc, item)
        const hasChildren = item.get(N('First')) instanceof PDFRef
        if (target && removed.has(key(target))) {
          if (hasChildren) {
            // Keep the heading so its surviving children stay reachable, but make it non-navigating.
            item.delete(N('Dest'))
            item.delete(N('A'))
            kept.push(ref)
          }
        } else kept.push(ref)
      }
      ref = next
    }
    kept.forEach((r, i) => {
      const item = ctx.lookup(r) as PDFDict
      if (i > 0) item.set(N('Prev'), kept[i - 1]); else item.delete(N('Prev'))
      if (i < kept.length - 1) item.set(N('Next'), kept[i + 1]); else item.delete(N('Next'))
    })
    if (kept.length) {
      parent.set(N('First'), kept[0])
      parent.set(N('Last'), kept[kept.length - 1])
    } else {
      parent.delete(N('First'))
      parent.delete(N('Last'))
    }
    let visible = 0
    for (const r of kept) {
      const c = (ctx.lookup(r) as PDFDict).lookup(N('Count'))
      visible += 1 + (c instanceof PDFNumber && c.asNumber() > 0 ? c.asNumber() : 0)
    }
    const old = parent.lookup(N('Count'))
    const closed = old instanceof PDFNumber && old.asNumber() < 0
    if (!kept.length) parent.delete(N('Count'))
    else parent.set(N('Count'), PDFNumber.of(parent === root ? visible : closed ? -visible : visible))
    return visible
  }
  prune(root, 0)
}

function pruneLinks(doc: PDFDocument, removed: Set<string>, remaining: PDFDict[]) {
  const ctx = doc.context
  for (const leaf of remaining) {
    const annots = leaf.lookup(N('Annots'))
    if (!(annots instanceof PDFArray)) continue
    const kept = annots.asArray().filter((a) => {
      const d = ctx.lookup(a)
      if (!(d instanceof PDFDict) || d.get(N('Subtype')) !== N('Link')) return true
      const t = targetPage(doc, d)
      return !(t && removed.has(key(t)))
    })
    if (kept.length !== annots.size()) leaf.set(N('Annots'), ctx.obj(kept))
  }
}

function pruneNamedDests(doc: PDFDocument, removed: Set<string>) {
  const ctx = doc.context
  const points = (v: PDFObject | undefined) => {
    const t = destinationPage(doc, v)
    return !!t && removed.has(key(t))
  }
  const dests = doc.catalog.lookup(N('Dests'))
  if (dests instanceof PDFDict) for (const [k, v] of dests.entries()) if (points(v)) dests.delete(k)

  const names = doc.catalog.lookup(N('Names'))
  const tree = names instanceof PDFDict ? names.lookup(N('Dests')) : undefined
  const walk = (node: PDFObject | undefined, depth: number) => {
    if (!(node instanceof PDFDict) || depth > 32) return
    const arr = node.lookup(N('Names'))
    if (arr instanceof PDFArray) {
      const out: PDFObject[] = []
      for (let i = 0; i + 1 < arr.size(); i += 2) if (!points(arr.get(i + 1))) out.push(arr.get(i), arr.get(i + 1))
      if (out.length !== arr.size()) node.set(N('Names'), ctx.obj(out))
    }
    const kids = node.lookup(N('Kids'))
    if (kids instanceof PDFArray) kids.asArray().forEach((k) => walk(ctx.lookup(k), depth + 1))
  }
  walk(tree, 0)
}

/** Delete indirect objects not reachable from the trailer (e.g. removed pages). Returns count removed. */
export function removeUnreachable(ctx: PDFContext): number {
  const seen = new Set<string>()
  const stack: PDFObject[] = []
  const { Root, Info } = ctx.trailerInfo
  if (!Root) return 0
  stack.push(Root)
  if (Info) stack.push(Info)
  while (stack.length) {
    const o = stack.pop()!
    if (o instanceof PDFRef) {
      if (seen.has(key(o))) continue
      seen.add(key(o))
      const target = ctx.lookup(o)
      if (target) stack.push(target)
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v)
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) stack.push(v)
    } else if (o instanceof PDFStream) {
      stack.push(o.dict)
    }
  }
  let removedCount = 0
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(key(ref))) {
      ctx.delete(ref)
      removedCount++
    }
  }
  return removedCount
}

const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate']

/** Copy attributes each page inherits from its page-tree ancestors onto the page itself. */
export function pushDownInherited(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    const leaf = page.node
    for (const attr of INHERITABLE) {
      if (!leaf.get(N(attr))) {
        const v = leaf.getInheritableAttribute(N(attr))
        if (v !== undefined) leaf.set(N(attr), v)
      }
    }
  }
}

/**
 * Replace the document's page tree with a flat one containing `order` (indices into the current
 * pages, no duplicates), with optional extra rotation. Inherited attributes are pushed down to each
 * page first so nothing is lost when intermediate tree nodes disappear. Forms, bookmarks, links and
 * named destinations pointing at dropped pages are pruned; unreachable objects are removed.
 */
export function rebuildPageTree(doc: PDFDocument, order: { index: number; rotate?: number }[]) {
  const ctx = doc.context
  const pages = doc.getPages()
  const leaves = pages.map((p) => p.node)
  const annotsBefore = annotationRefs(leaves)
  const keep = new Set(order.map((o) => o.index))
  const removed = new Set(pages.filter((_, i) => !keep.has(i)).map((p) => key(p.ref)))

  pushDownInherited(doc)
  const kids = order.map((o) => pages[o.index].ref)
  const root = ctx.obj({ Type: 'Pages', Kids: kids, Count: kids.length })
  const rootRef = ctx.register(root)
  const remaining: PDFDict[] = []
  for (const o of order) {
    const leaf = leaves[o.index]
    leaf.set(N('Parent'), rootRef)
    if (o.rotate) {
      const cur = leaf.lookup(N('Rotate'))
      const base = cur instanceof PDFNumber ? cur.asNumber() : 0
      leaf.set(N('Rotate'), PDFNumber.of((((Math.round((base + o.rotate) / 90) * 90) % 360) + 360) % 360))
    }
    remaining.push(leaf)
  }
  doc.catalog.set(N('Pages'), rootRef)
  pruneForRemovedPages(doc, removed, annotsBefore, remaining)
  removeUnreachable(ctx)
}
