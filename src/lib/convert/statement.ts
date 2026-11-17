/**
 * Bank statements: find the transaction table in a text PDF's positioned words, rebuild each
 * transaction (date, description, reference, debit, credit, balance), and check every row against the
 * printed running balance. Pure functions over PageText, so they run anywhere and are unit-tested.
 *
 * How it reads a statement:
 * - The header row names the columns (English or Arabic keywords). Each word below it goes to the
 *   header it overlaps most, or the nearest one, so right-aligned numbers and two dates close together
 *   land in the right column. A page without a header reuses the previous page's columns.
 * - Lines are grouped into rows by vertical spacing (cells with padding leave bigger gaps than lines
 *   inside a cell). A row with a date is a transaction; the row's other lines are its wrapped
 *   description, whether the cell text sits above, beside or below the date.
 * - "Opening balance" / "balance brought forward" rows give the starting balance, "closing balance"
 *   rows the end. Text that isn't in a row with a date (page titles, footers) is ignored.
 * - Balance check: previous balance + credit − debit must equal the printed balance, oldest first
 *   (newest-first statements are checked in their own order).
 */
import type { PageText, Span } from './pdfExport'
import { rowsFromSpans } from './pdfTables'
import { fixArabic, isRtlText } from './pdfText'

export type Role = 'date' | 'valueDate' | 'description' | 'reference' | 'debit' | 'credit' | 'amount' | 'balance'

export interface Transaction {
  /** ISO date (YYYY-MM-DD). */
  date: string
  valueDate?: string
  description: string
  reference?: string
  /** Money out, positive. */
  debit: number | null
  /** Money in, positive. */
  credit: number | null
  balance: number | null
  page: number
  /** ok: matches the running balance; mismatch: doesn't (see `expected`); unchecked: nothing to check against. */
  check: 'ok' | 'mismatch' | 'unchecked'
  expected?: number
}

export interface Statement {
  transactions: Transaction[]
  opening: number | null
  closing: number | null
  /** The order the statement lists transactions in. */
  order: 'oldest-first' | 'newest-first'
  dateOrder: 'dmy' | 'mdy' | 'ymd'
  currency: string | null
  /** Last digits of the account number, if printed (e.g. "4821"). */
  account: string | null
  columns: Role[]
  rtl: boolean
  checked: number
  mismatches: number
  /** Closing balance printed on the statement agrees with the last transaction's balance (null: no closing row). */
  closingOk: boolean | null
}

// ---- Header keywords. Matched against a whole header cell, case-insensitive.
const HEADERS: [Role, RegExp][] = [
  ['valueDate', /^(value\s*date|val\.?\s*date|تاريخ\s*(القيمة|الاستحقاق|الحق))$/i],
  ['date', /^((transaction|txn|trans\.?|posting|post|booking|entry)\s*date|date|التاريخ|تاريخ(\s*(العملية|القيد|الحركة|المعاملة))?)$/i],
  ['description', /^(description|details|transaction\s*details|narration|narrative|particulars|remarks|البيان|الوصف|التفاصيل|تفاصيل\s*العملية|الشرح)$/i],
  ['reference', /^(ref\.?|reference|ref\.?\s*no\.?|reference\s*no\.?|cheque\s*no\.?|chq\.?\s*no\.?|المرجع|رقم\s*المرجع|الرقم\s*المرجعي|رقم\s*الشيك)$/i],
  ['debit', /^(debit|debits|dr|withdrawal|withdrawals|money\s*out|paid\s*out|مدين|المدين|سحب|المسحوبات|خصم)$/i],
  ['credit', /^(credit|credits|cr|deposit|deposits|money\s*in|paid\s*in|دائن|الدائن|إيداع|الإيداعات|ايداع)$/i],
  ['amount', /^(amount|transaction\s*amount|المبلغ|مبلغ\s*العملية)$/i],
  ['balance', /^(balance|running\s*balance|available\s*balance|الرصيد|رصيد)$/i],
]
const OPENING = /(opening\s*balance|balance\s*(brought|b\/)\s*f(or)?w(ar)?d|balance\s*b\/f|previous\s*balance|start(ing)?\s*balance|الرصيد\s*(الافتتاحي|السابق|المنقول)|رصيد\s*(افتتاحي|سابق|أول\s*المدة))/i
const CLOSING = /(closing\s*balance|balance\s*(carried)\s*f(or)?w(ar)?d|balance\s*c\/f|end(ing)?\s*balance|الرصيد\s*(الختامي|النهائي|الحالي)|رصيد\s*(ختامي|آخر\s*المدة))/i
const TOTAL = /^(total|totals|المجموع|الإجمالي|اجمالي)\b/i

const AR_DIGITS = /[٠-٩۰-۹]/g
/** Arabic-Indic and Persian digits to ASCII, Arabic decimal/thousands separators to . and , */
export function asciiDigits(s: string): string {
  return s
    .replace(AR_DIGITS, (d) => String((d.charCodeAt(0) - (d >= '۰' ? 0x06f0 : 0x0660))))
    .replace(/٫/g, '.')
    .replace(/[٬،]/g, ',')
}

export function roleOf(text: string): Role | null {
  const t = text.replace(/[:：]$/, '').replace(/\s+/g, ' ').trim()
  for (const [role, re] of HEADERS) if (re.test(t)) return role
  return null
}

/**
 * A money amount, or null. Handles 1,234.56 / 1.234,56 / (1,234.56) / -1,234.56 / 1,234.56- /
 * "1,234.56 CR" / "DR 12.00", currency codes and Arabic-Indic digits. `sign` is -1/1 when the text
 * says so, 0 when it doesn't.
 */
export function parseAmount(raw: string): { value: number; sign: -1 | 0 | 1 } | null {
  let s = asciiDigits(fixArabic(raw)).replace(/ | /g, ' ').trim()
  if (!s || !/\d/.test(s)) return null
  let sign: -1 | 0 | 1 = 0
  if (/\b(CR|Cr|cr)\b\.?|دائن/.test(s)) sign = 1
  if (/\b(DR|Dr|dr)\b\.?|مدين/.test(s)) sign = -1
  s = s.replace(/\b(CR|DR|Cr|Dr|cr|dr)\b\.?|دائن|مدين/g, '').replace(/[A-Za-z؀-ۿ$€£¥.]*\s*$/, (m) => (/^\.\d/.test(m) ? m : '')).trim()
  s = s.replace(/^(SAR|AED|USD|EUR|GBP|KWD|QAR|BHD|OMR|EGP|JOD|ر\.?\s?س|د\.?\s?إ|[$€£])\s*/i, '').trim()
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1).trim() }
  if (/^[-−–]/.test(s)) { sign = -1; s = s.slice(1).trim() }
  else if (/[-−–]$/.test(s)) { sign = -1; s = s.slice(0, -1).trim() }
  else if (/^\+/.test(s)) { sign = 1; s = s.slice(1).trim() }
  if (!/^\d[\d,. '’]*$/.test(s)) return null
  // Decimal separator: the last of . or , when followed by 1–2 digits at the end.
  const m = /[.,](\d{1,2})$/.exec(s)
  let n: number
  if (m) n = Number(s.slice(0, m.index).replace(/[.,'’ ]/g, '') + '.' + m[1])
  else n = Number(s.replace(/[.,'’ ]/g, ''))
  if (!Number.isFinite(n)) return null
  return { value: n, sign }
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const DATE_NUM = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/
const DATE_MON = /^(\d{1,2})[\s\-/.]*([A-Za-z]{3,9})\.?[\s\-/.,]*(\d{2,4})$/
const DATE_MON_FIRST = /^([A-Za-z]{3,9})\.?\s*(\d{1,2}),?\s*(\d{2,4})$/

/** The first date-looking token in a cell, normalised (ASCII digits, single spaces). */
function dateToken(text: string): string | null {
  const s = asciiDigits(fixArabic(text)).replace(/\s+/g, ' ').trim()
  const num = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/.exec(s)
  if (num) return num[0]
  const mon = /\b\d{1,2}[\s\-/.]*[A-Za-z]{3,9}\.?[\s\-/.,]*\d{2,4}\b/.exec(s) ?? /\b[A-Za-z]{3,9}\.? \d{1,2},? \d{2,4}\b/.exec(s)
  if (mon && (MONTHS[mon[0].replace(/[^A-Za-z]/g, '').slice(0, 4).toLowerCase()] || MONTHS[mon[0].replace(/[^A-Za-z]/g, '').slice(0, 3).toLowerCase()])) return mon[0]
  return null
}

function year(y: number): number { return y < 100 ? 2000 + y : y }
function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Day/month order for numeric dates: whichever reading every date in the statement allows (Gulf default: day first). */
export function detectDateOrder(tokens: string[]): 'dmy' | 'mdy' | 'ymd' {
  let dmyOk = true, mdyOk = true, ymd = 0, num = 0
  for (const t of tokens) {
    const m = DATE_NUM.exec(t)
    if (!m) continue
    num++
    if (m[1].length === 4) { ymd++; continue }
    const a = Number(m[1]), b = Number(m[2])
    if (b > 12) dmyOk = false
    if (a > 12) mdyOk = false
  }
  if (num && ymd === num) return 'ymd'
  if (!dmyOk && mdyOk) return 'mdy'
  return 'dmy'
}

export function parseDate(token: string, order: 'dmy' | 'mdy' | 'ymd'): string | null {
  let m = DATE_NUM.exec(token)
  if (m) {
    if (m[1].length === 4) return iso(Number(m[1]), Number(m[2]), Number(m[3]))
    const a = Number(m[1]), b = Number(m[2]), y = year(Number(m[3]))
    return order === 'mdy' ? iso(y, a, b) : iso(y, b, a)
  }
  m = DATE_MON.exec(token)
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()]
    return mon ? iso(year(Number(m[3])), mon, Number(m[1])) : null
  }
  m = DATE_MON_FIRST.exec(token)
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()]
    return mon ? iso(year(Number(m[3])), mon, Number(m[2])) : null
  }
  return null
}

// ---- Layout

interface Line { y: number; size: number; spans: Span[] }
interface Column { role: Role; x0: number; x1: number }

function linesOf(spans: Span[]): Line[] {
  const upright = spans.filter((s) => Math.abs(s.angle) < 1 && s.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x)
  const out: Line[] = []
  for (const s of upright) {
    const l = out[out.length - 1]
    if (l && Math.abs(l.y - s.y) <= Math.min(l.size, s.size) * 0.5) { l.spans.push(s); l.size = Math.max(l.size, s.size) }
    else out.push({ y: s.y, size: s.size, spans: [s] })
  }
  return out
}

/** Text of a set of spans on one line, in reading order (right-to-left cells read from the right). */
function textOf(spans: Span[]): string {
  return rowsFromSpans(spans).map((r) => r.cells.map((c) => c.text).join(' ')).join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Header columns from one line, or from two adjacent lines (headers like "Value / Date" wrap). Words
 * that overlap horizontally across the two lines belong to one header cell.
 */
function headerColumns(lines: Line[], i: number): { columns: Column[]; used: number } | null {
  const tryLines = (ls: Line[]): Column[] | null => {
    const spans = ls.flatMap((l) => l.spans).sort((a, b) => a.x - b.x)
    const groups: { spans: Span[]; x0: number; x1: number }[] = []
    for (const s of spans) {
      const g = groups.find((g) => s.x < g.x1 + s.size * 0.6 && s.x + s.width > g.x0 - s.size * 0.6)
      if (g) { g.spans.push(s); g.x0 = Math.min(g.x0, s.x); g.x1 = Math.max(g.x1, s.x + s.width) }
      else groups.push({ spans: [s], x0: s.x, x1: s.x + s.width })
    }
    const cols: Column[] = []
    for (const g of groups) {
      // Top line first, then the line below.
      const text = ls.map((l) => textOf(g.spans.filter((s) => l.spans.includes(s)))).filter(Boolean).join(' ')
      const role = roleOf(text)
      if (role) cols.push({ role, x0: g.x0, x1: g.x1 })
      else return null // every cell of a header row is a column name
    }
    const roles = new Set(cols.map((c) => c.role))
    const money = roles.has('debit') || roles.has('credit') || roles.has('amount')
    if (cols.length < 3 || !roles.has('date') || !(money || roles.has('balance'))) return null
    if (roles.size !== cols.length) return null
    return cols.sort((a, b) => a.x0 - b.x0)
  }
  const one = tryLines([lines[i]])
  if (one) return { columns: one, used: 1 }
  const next = lines[i + 1]
  if (next && next.y - lines[i].y < Math.max(lines[i].size, next.size) * 1.8) {
    const two = tryLines([lines[i], next])
    if (two) return { columns: two, used: 2 }
  }
  return null
}

/**
 * The vertical gap above which a line starts a new table row. Most rows are one line, so the median
 * full-line gap is the row pitch; a clearly smaller full-line gap is the line pitch inside a cell, and
 * the split goes between the two. Half-line gaps (text centred beside a two-line cell) never split. If
 * rows are as tight as lines, everything is one group and dated lines split it (see parseStatement).
 */
function rowBreak(lines: Line[]): number {
  const size = lines.length ? [...lines.map((l) => l.size)].sort((a, b) => a - b)[Math.floor(lines.length / 2)] : 10
  const full = lines.slice(1).map((l, k) => l.y - lines[k].y).filter((g) => g >= size * 0.8).sort((a, b) => a - b)
  if (!full.length) return size * 1.5
  const row = full[Math.floor(full.length / 2)]
  const inside = full.find((g) => g < row * 0.9)
  return inside ? (inside + row) / 2 : row * 1.5
}

/**
 * Headers are often centred over wider columns. Widen each column to the words that clearly overlap its
 * header, without reaching a neighbour's header, so short words further along (a description's second
 * line) find the right column.
 */
function widen(columns: Column[], lines: Line[]): Column[] {
  const out = columns.map((c) => ({ ...c }))
  for (const l of lines) for (const sp of l.spans) {
    const hits = columns.map((c, k) => [k, Math.min(sp.x + sp.width, c.x1) - Math.max(sp.x, c.x0)] as const).filter(([, o]) => o > 0)
    if (hits.length !== 1) continue
    const k = hits[0][0]
    const lo = k > 0 ? columns[k - 1].x1 : -Infinity
    const hi = k < columns.length - 1 ? columns[k + 1].x0 : Infinity
    out[k].x0 = Math.max(lo, Math.min(out[k].x0, sp.x))
    out[k].x1 = Math.min(hi, Math.max(out[k].x1, sp.x + sp.width))
  }
  return out
}

/** The column a word belongs to: the one it overlaps most, else the nearest. */
function columnOf(s: Span, columns: Column[]): number {
  let best = -1, bestOverlap = 0, nearest = 0, nearestGap = Infinity
  columns.forEach((c, k) => {
    const overlap = Math.min(s.x + s.width, c.x1) - Math.max(s.x, c.x0)
    if (overlap > bestOverlap) { bestOverlap = overlap; best = k }
    const gap = Math.max(c.x0 - (s.x + s.width), s.x - c.x1, 0)
    if (gap < nearestGap) { nearestGap = gap; nearest = k }
  })
  return best >= 0 ? best : nearest
}

interface Cells { y: number; size: number; page: number; byRole: Partial<Record<Role, string>>; centred?: boolean }

function cellsOf(line: Line, columns: Column[], page: number): Cells {
  const buckets = columns.map(() => [] as Span[])
  for (const s of line.spans) buckets[columnOf(s, columns)].push(s)
  const byRole: Partial<Record<Role, string>> = {}
  buckets.forEach((b, k) => { if (b.length) byRole[columns[k].role] = textOf(b) })
  return { y: line.y, size: line.size, page, byRole }
}

/** Find the transactions in a statement's pages. Returns null if no transaction table is found. */
export function parseStatement(pages: PageText[], opts: { dateOrder?: 'dmy' | 'mdy' } = {}): Statement | null {
  let columns: Column[] | null = null
  const rows: Cells[] = []
  // Rows are grouped per page by vertical gaps; `breaks` marks where a new group starts.
  const breaks = new Set<number>()
  let allText = ''
  for (const page of pages) {
    const lines = linesOf(page.spans)
    allText += ' ' + lines.map((l) => textOf(l.spans)).join(' ')
    let start = 0
    for (let i = 0; i < lines.length; i++) {
      const h = headerColumns(lines, i)
      if (h) { columns = h.columns; start = i + h.used; break }
    }
    if (!columns) continue
    const table = lines.slice(start)
    const split = rowBreak(table)
    const cols = widen(columns, table)
    // Cells centred vertically: a one-line cell sits half a line off a two-line neighbour.
    const centred = table.slice(1).some((l, k) => { const g = l.y - table[k].y; return g > l.size * 0.25 && g < l.size * 0.8 })
    table.forEach((l, k) => {
      if (k === 0 || l.y - table[k - 1].y > split) breaks.add(rows.length)
      rows.push({ ...cellsOf(l, cols, page.number), centred })
    })
  }
  if (!columns) return null
  const roles = columns.map((c) => c.role)

  const detected = detectDateOrder(rows.map((r) => (r.byRole.date ? dateToken(r.byRole.date) : null)).filter((t): t is string => !!t))
  // A chosen day/month order applies to numeric day-month dates; year-first dates stay year-first.
  const order = opts.dateOrder && detected !== 'ymd' ? opts.dateOrder : detected
  const isAnchor = (r: Cells) => !!(r.byRole.date && dateToken(r.byRole.date) && parseDate(dateToken(r.byRole.date)!, order))

  // Group rows, then turn each group's dated rows into transactions.
  interface Draft { anchor: Cells; before: Cells[]; after: Cells[] }
  const drafts: Draft[] = []
  let opening: number | null = null
  let closing: number | null = null
  const groups: Cells[][] = []
  rows.forEach((r, k) => { if (breaks.has(k) || !groups.length) groups.push([]); groups[groups.length - 1].push(r) })
  groups.forEach((g, gi) => {
    const joined = g.map((r) => Object.values(r.byRole).join(' ')).join(' ')
    // A row split by a page break: its last lines open the next page, before any dated row.
    const firstOnPage = gi > 0 && groups[gi - 1][0].page !== g[0].page
    const textOnly = g.every((r) => Object.keys(r.byRole).every((k) => k === 'description' || k === 'reference'))
    if (!g.some(isAnchor) && firstOnPage && textOnly && drafts.length && !OPENING.test(joined) && !CLOSING.test(joined)) {
      drafts[drafts.length - 1].after.push(...g)
      return
    }
    if (!g.some(isAnchor)) {
      const bal = g.map((r) => r.byRole.balance).find((b) => b && parseAmount(b))
      const amount = bal ? signed(parseAmount(bal)!) : null
      if (OPENING.test(joined) && amount !== null && opening === null) opening = amount
      else if (CLOSING.test(joined) && amount !== null) closing = amount
      return
    }
    let current: Draft | null = null
    const pending: Cells[] = []
    const anchors = g.filter(isAnchor)
    for (const r of g) {
      // Undated rows with an amount are balance or total rows, never part of a description.
      if (!isAnchor(r) && (['debit', 'credit', 'amount', 'balance'] as Role[]).some((k) => r.byRole[k] && parseAmount(r.byRole[k]!))) {
        const text = Object.values(r.byRole).join(' ')
        const bal = r.byRole.balance && parseAmount(r.byRole.balance)
        if (bal && OPENING.test(text) && opening === null) opening = signed(bal)
        else if (bal && CLOSING.test(text)) closing = signed(bal)
        continue
      }
      if (isAnchor(r)) {
        current = { anchor: r, before: pending.splice(0), after: [] }
        drafts.push(current)
      } else if (r.centred && current) {
        // Centred cells: a wrapped line belongs to the nearest dated row (its text runs above and below it).
        const next = anchors[anchors.indexOf(current.anchor) + 1]
        if (next && next.y - r.y < r.y - current.anchor.y) pending.push(r)
        else current.after.push(r)
      } else if (current) current.after.push(r)
      else pending.push(r)
    }
  })

  const transactions: Transaction[] = []
  for (const d of drafts) {
    const parts = [...d.before, d.anchor, ...d.after]
    const desc = parts.map((r) => r.byRole.description).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    if (TOTAL.test(desc)) continue
    const a = d.anchor.byRole
    const date = parseDate(dateToken(a.date!)!, order)!
    const vdTok = a.valueDate ? dateToken(a.valueDate) : null
    const ref = parts.map((r) => r.byRole.reference).filter(Boolean).join(' ').trim()
    const pick = (role: Role) => parts.map((r) => r.byRole[role]).find((v) => v && parseAmount(v))
    const debit = pick('debit'), credit = pick('credit'), amount = pick('amount'), balance = pick('balance')
    let dv: number | null = null, cv: number | null = null
    if (debit) dv = Math.abs(parseAmount(debit)!.value)
    if (credit) cv = Math.abs(parseAmount(credit)!.value)
    if (amount && dv === null && cv === null) {
      const p = parseAmount(amount)!
      // Unsigned amounts are settled below from the running balance; until then, money out.
      if (p.sign > 0) cv = p.value
      else if (p.sign < 0) dv = p.value
      else dv = p.value
    }
    const unsignedAmount = !!amount && !debit && !credit && parseAmount(amount)!.sign === 0
    transactions.push({
      date,
      ...(vdTok && parseDate(vdTok, order) ? { valueDate: parseDate(vdTok, order)! } : {}),
      description: desc,
      ...(ref ? { reference: ref } : {}),
      debit: dv,
      credit: cv,
      balance: balance ? signed(parseAmount(balance)!) : null,
      page: d.anchor.page,
      check: 'unchecked',
      ...(unsignedAmount ? { unsigned: true } : {}),
    } as Transaction)
  }
  if (!transactions.length) return null

  const newestFirst = transactions.length > 1 && transactions[0].date > transactions[transactions.length - 1].date
  const chrono = newestFirst ? [...transactions].reverse() : transactions
  settleUnsigned(chrono, opening)
  const { checked, mismatches } = checkBalances(chrono, opening)
  const last = chrono[chrono.length - 1].balance

  return {
    transactions,
    opening,
    closing,
    order: newestFirst ? 'newest-first' : 'oldest-first',
    dateOrder: order,
    currency: currencyOf(allText),
    account: (/\*{2,}\s?(\d{3,6})\b/.exec(allText) ?? /(?:account|a\/c|acct|حساب)[^\d]{0,30}(?:\d[\d\s-]{4,}?)?(\d{4})\b/i.exec(allText))?.[1] ?? null,
    columns: roles,
    rtl: isRtlText(allText.replace(/[\s\d.,/:\-*]+/g, '')),
    checked,
    mismatches,
    closingOk: closing === null || last === null ? null : Math.abs(closing - last) < 0.005,
  }
}

function signed(p: { value: number; sign: -1 | 0 | 1 }): number { return p.sign < 0 ? -p.value : p.value }

/** An unsigned single amount column: the change in balance says whether it was money in or out. */
function settleUnsigned(chrono: (Transaction & { unsigned?: boolean })[], opening: number | null) {
  let prev = opening
  for (const t of chrono) {
    if (t.unsigned) {
      const v = (t.debit ?? 0) + (t.credit ?? 0)
      if (prev !== null && t.balance !== null && Math.abs(prev + v - t.balance) < 0.005) { t.credit = v; t.debit = null }
      else { t.debit = v; t.credit = null }
      delete t.unsigned
    }
    prev = t.balance ?? (prev === null ? null : prev + (t.credit ?? 0) - (t.debit ?? 0))
  }
}

/** previous + credit − debit = balance, oldest first. The first row is checked only if there's an opening balance. */
export function checkBalances(chrono: Transaction[], opening: number | null): { checked: number; mismatches: number } {
  let prev = opening
  let checked = 0, mismatches = 0
  for (const t of chrono) {
    const net = (t.credit ?? 0) - (t.debit ?? 0)
    if (prev !== null && t.balance !== null) {
      const expected = Math.round((prev + net) * 100) / 100
      checked++
      if (Math.abs(expected - t.balance) < 0.005) { t.check = 'ok'; delete t.expected }
      else { t.check = 'mismatch'; t.expected = expected; mismatches++ }
    } else t.check = 'unchecked'
    prev = t.balance ?? (prev === null ? null : prev + net)
  }
  return { checked, mismatches }
}

function currencyOf(text: string): string | null {
  const code = /\b(SAR|AED|USD|EUR|GBP|KWD|QAR|BHD|OMR|EGP|JOD|INR|PKR)\b/.exec(text)
  if (code) return code[1]
  if (/ريال\s*سعودي|ر\.س/.test(text)) return 'SAR'
  if (/درهم\s*إماراتي|د\.إ/.test(text)) return 'AED'
  if (/دينار\s*كويتي/.test(text)) return 'KWD'
  if (/ريال\s*قطري/.test(text)) return 'QAR'
  if (/جنيه\s*مصري/.test(text)) return 'EGP'
  return null
}
