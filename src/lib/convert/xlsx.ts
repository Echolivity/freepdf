/**
 * A focused XLSX reader: cell values (using the cached results of formulas), number formats, fonts,
 * fills, borders, alignment, merged cells, column widths, row heights, hidden rows/columns and
 * right-to-left sheets. Enough to print a sheet the way it looks; charts, images, conditional
 * formatting and comments are not read. Uses JSZip (already a dependency) and DOMParser.
 *
 * Why not a library: SheetJS's npm release is outdated with open advisories (its fixed builds are only
 * on its own CDN), and ExcelJS is large and Node-oriented.
 */
import JSZip from 'jszip'
import { UserFacingError } from '../validate'

export interface CellStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  size?: number
  color?: string
  font?: string
  fill?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  valign?: 'top' | 'middle' | 'bottom'
  wrap?: boolean
  indent?: number
  border?: { top?: string; right?: string; bottom?: string; left?: string }
}
export interface Cell { text: string; numeric: boolean; style: CellStyle; colspan?: number; rowspan?: number; covered?: boolean }
export interface Sheet {
  name: string
  rtl: boolean
  gridlines: boolean
  /** Column widths in CSS px, for the used range. */
  cols: number[]
  rows: { height: number; cells: Cell[] }[]
}

export const MAX_CELLS = 250_000

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function xml(text: string): Document {
  const d = new DOMParser().parseFromString(text, 'application/xml')
  if (d.getElementsByTagName('parsererror').length) throw new UserFacingError('err.officeBroken', { kind: 'XLSX' })
  return d
}
const kids = (el: Element | Document, name: string) => [...el.getElementsByTagNameNS(MAIN, name)]
const kid = (el: Element | Document, name: string) => el.getElementsByTagNameNS(MAIN, name)[0] as Element | undefined

/** "B12" → [row 11, col 1] (0-based). */
export function cellRef(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase())
  if (!m) return [-1, -1]
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return [Number(m[2]) - 1, col - 1]
}

const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333']
/**
 * Theme colours in the order cell styles index them: lt1, dk1, lt2, dk2, accent1–6, hlink, folHlink.
 * (Styles swap the first two pairs relative to the theme file, so theme="1" is the dark text colour.)
 * These are Office's defaults, used when the theme part can't be read.
 */
const THEME_DEFAULT = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72']

function colorOf(el: Element | undefined, theme: string[]): string | undefined {
  if (!el) return undefined
  let hex: string | undefined
  const rgb = el.getAttribute('rgb')
  if (rgb) hex = rgb.slice(-6)
  else if (el.hasAttribute('indexed')) hex = INDEXED[Number(el.getAttribute('indexed'))]
  else if (el.hasAttribute('theme')) hex = theme[Number(el.getAttribute('theme'))]
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined
  const tint = Number(el.getAttribute('tint') ?? 0)
  if (tint) {
    const c = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16)).map((v) => Math.round(tint < 0 ? v * (1 + tint) : v + (255 - v) * tint))
    hex = c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')
  }
  return `#${hex}`
}

const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Excel serial date → UTC Date (1900 system, with Excel's 29-Feb-1900; or the 1904 system). */
export function serialToDate(serial: number, date1904 = false): Date {
  // 1904 system: day 0 is 1 Jan 1904 (1,461 days after 31 Dec 1899; no fake leap day to skip).
  const days = date1904 ? serial + 1461 : serial < 60 ? serial : serial - 1
  return new Date(Date.UTC(1899, 11, 31) + Math.round(days * 86400000))
}

/** "General": up to 11 significant digits, like Excel's cells. */
export function formatGeneral(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e11) return String(v)
  const abs = Math.abs(v)
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) return v.toExponential(5).replace(/\.?0+e/, 'E').replace('E+', 'E+').replace(/E(-?)(\d)$/, 'E$10$2').toUpperCase()
  return String(Number(v.toPrecision(11)))
}

function isDateFormat(code: string): boolean {
  const stripped = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')
  return /[ymdhs]/i.test(stripped) && !/[0#?]/.test(stripped.replace(/[hs]+(:?[0.]+)/gi, ''))
}

function formatDate(v: number, code: string, date1904: boolean): string {
  const d = serialToDate(v, date1904)
  const ampm = /AM\/PM|A\/P/i.test(code)
  const tokens = code.replace(/\[[^\]]*\]/g, '').match(/"[^"]*"|\\.|AM\/PM|A\/P|y+|m+|d+|h+|s+(\.0+)?|[^ymdhs"\\]/gi) ?? []
  let out = ''
  const H = d.getUTCHours()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const lower = t.toLowerCase()
    // "m" means minutes right after an hour or right before a second.
    const prev = tokens.slice(0, i).reverse().find((x) => /^[ymdhs]/i.test(x))?.toLowerCase() ?? ''
    const next = tokens.slice(i + 1).find((x) => /^[ymdhs]/i.test(x))?.toLowerCase() ?? ''
    const isMinute = lower.startsWith('m') && lower.length <= 2 && (prev.startsWith('h') || next.startsWith('s'))
    if (t.startsWith('"')) out += t.slice(1, -1)
    else if (t.startsWith('\\')) out += t.slice(1)
    else if (/^am\/pm$/i.test(t)) out += H < 12 ? 'AM' : 'PM'
    else if (/^a\/p$/i.test(t)) out += H < 12 ? 'A' : 'P'
    else if (lower.startsWith('y')) out += lower.length <= 2 ? String(d.getUTCFullYear()).slice(-2) : String(d.getUTCFullYear())
    else if (isMinute) out += lower.length === 2 ? String(d.getUTCMinutes()).padStart(2, '0') : String(d.getUTCMinutes())
    else if (lower.startsWith('m')) {
      const m = d.getUTCMonth()
      out += lower.length === 1 ? String(m + 1) : lower.length === 2 ? String(m + 1).padStart(2, '0') : lower.length === 3 ? MONTHS[m].slice(0, 3) : lower.length === 5 ? MONTHS[m][0] : MONTHS[m]
    } else if (lower.startsWith('d')) {
      out += lower.length === 1 ? String(d.getUTCDate()) : lower.length === 2 ? String(d.getUTCDate()).padStart(2, '0') : lower.length === 3 ? DAYS[d.getUTCDay()].slice(0, 3) : DAYS[d.getUTCDay()]
    } else if (lower.startsWith('h')) {
      const h = ampm ? H % 12 || 12 : H
      out += lower.length >= 2 ? String(h).padStart(2, '0') : String(h)
    } else if (lower.startsWith('s')) out += String(d.getUTCSeconds()).padStart(lower.replace(/\..*/, '').length, '0')
    else out += t
  }
  return out
}

function formatNumberPart(v: number, code: string): string {
  // Literal text, currency in [$€-409] and escaped characters around the number pattern.
  let pattern = code.replace(/\[\$([^\]-]*)(-[^\]]*)?\]/g, '"$1"').replace(/\[[^\]]*\]/g, '').replace(/_./g, ' ').replace(/\*./g, '')
  const percent = (pattern.replace(/"[^"]*"/g, '').match(/%/g) ?? []).length
  let value = v * 100 ** percent
  const sciM = /([#0?.,]+)E([+-])([0#]+)/i.exec(pattern)
  if (sciM) {
    const decimals = (sciM[1].split('.')[1] ?? '').replace(/[^0#?]/g, '').length
    const exp = value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)))
    const mant = (Math.abs(value) / 10 ** exp).toFixed(decimals)
    const e = `E${exp < 0 ? '-' : sciM[2] === '+' ? '+' : ''}${String(Math.abs(exp)).padStart(sciM[3].length, '0')}`
    return (pattern.slice(0, sciM.index) + mant + e + pattern.slice(sciM.index + sciM[0].length)).replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1')
  }
  // Trailing commas scale by thousands ("#,##0," shows thousands).
  const m = /([#0?,.]*[#0?][#0?,.]*)(?=[^#0?,.]*$)/.exec(pattern.replace(/"[^"]*"/g, (s) => '\u0000'.repeat(s.length)))
  if (!m) return pattern.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1')
  const num = pattern.slice(m.index, m.index + m[0].length)
  const scale = /,+$/.exec(num)?.[0].length ?? 0
  value /= 1000 ** scale
  const core = num.replace(/,+$/, '')
  const dot = core.indexOf('.')
  const decimals = dot < 0 ? 0 : core.slice(dot + 1).replace(/[^0#?]/g, '').length
  const minDecimals = dot < 0 ? 0 : core.slice(dot + 1).replace(/[^0]/g, '').length
  const grouping = core.includes(',')
  const intZeros = (dot < 0 ? core : core.slice(0, dot)).replace(/[^0]/g, '').length
  let body: string
  {
    let s = Math.abs(value).toFixed(decimals)
    if (decimals > minDecimals) s = s.replace(/(\.\d*?)0+$/, (_, k: string) => (k.length - 1 >= minDecimals ? k : k + '0'.repeat(minDecimals - (k.length - 1)))).replace(/\.$/, minDecimals ? '.' : '')
    let [int, frac] = s.split('.')
    if (int === '0' && intZeros === 0) int = ''
    int = int.padStart(intZeros, '0')
    if (grouping) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    body = frac !== undefined ? `${int}.${frac}` : int
  }
  pattern = pattern.slice(0, m.index) + '\u0001' + pattern.slice(m.index + m[0].length)
  return pattern.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace('\u0001', body)
}

/** Format a number with an Excel format code (sections: positive;negative;zero;text). */
export function formatNumber(v: number, code: string, date1904 = false): string {
  if (!code || /^general$/i.test(code)) return formatGeneral(v)
  const sections = code.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)
  let sec = sections[0]
  let value = v
  if (v < 0 && sections.length > 1) { sec = sections[1]; value = -v }
  else if (v === 0 && sections.length > 2) sec = sections[2]
  if (/^general$/i.test(sec.trim())) return (v < 0 && sections.length > 1 ? '-' : '') + formatGeneral(value)
  if (sec.trim() === '@') return formatGeneral(v)
  if (isDateFormat(sec)) return formatDate(v, sec, date1904)
  const out = formatNumberPart(value, sec)
  return v < 0 && sections.length === 1 && value === v ? `-${out}` : out
}

interface Styles { xfs: { numFmt: string; style: CellStyle }[]; date1904: boolean }

async function readStyles(zip: JSZip, theme: string[]): Promise<Styles> {
  const text = await zip.file('xl/styles.xml')?.async('string')
  if (!text) return { xfs: [{ numFmt: 'General', style: {} }], date1904: false }
  const d = xml(text)
  const fmts = new Map<number, string>()
  for (const f of kids(d, 'numFmt')) fmts.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? 'General')
  const fonts = kids(kid(d, 'fonts') ?? d, 'font').map((f) => ({
    bold: !!kid(f, 'b') && kid(f, 'b')!.getAttribute('val') !== '0',
    italic: !!kid(f, 'i') && kid(f, 'i')!.getAttribute('val') !== '0',
    underline: !!kid(f, 'u') && kid(f, 'u')!.getAttribute('val') !== 'none',
    strike: !!kid(f, 'strike'),
    size: Number(kid(f, 'sz')?.getAttribute('val') ?? 11),
    color: colorOf(kid(f, 'color'), theme),
    font: kid(f, 'name')?.getAttribute('val') ?? undefined,
  }))
  const fills = kids(kid(d, 'fills') ?? d, 'fill').map((f) => {
    const p = kid(f, 'patternFill')
    return p && p.getAttribute('patternType') && p.getAttribute('patternType') !== 'none' ? colorOf(kid(p, 'fgColor'), theme) : undefined
  })
  const side = (b: Element, name: string) => {
    const s = kid(b, name)
    const st = s?.getAttribute('style')
    if (!s || !st || st === 'none') return undefined
    const w = /thick/.test(st) ? 2.5 : /medium/.test(st) ? 1.75 : 1
    return `${w}px ${/dash|dot/i.test(st) ? 'dashed' : st === 'double' ? 'double' : 'solid'} ${colorOf(kid(s, 'color'), theme) ?? '#000000'}`
  }
  const borders = kids(kid(d, 'borders') ?? d, 'border').map((b) => ({ top: side(b, 'top'), right: side(b, 'right'), bottom: side(b, 'bottom'), left: side(b, 'left') }))
  const xfs = kids(kid(d, 'cellXfs') ?? d, 'xf').map((x) => {
    const id = Number(x.getAttribute('numFmtId') ?? 0)
    const al = kid(x, 'alignment')
    const h = al?.getAttribute('horizontal')
    const v = al?.getAttribute('vertical')
    const style: CellStyle = {
      ...fonts[Number(x.getAttribute('fontId') ?? 0)],
      fill: fills[Number(x.getAttribute('fillId') ?? 0)],
      border: borders[Number(x.getAttribute('borderId') ?? 0)],
      align: h === 'center' || h === 'centerContinuous' ? 'center' : h === 'right' ? 'right' : h === 'left' ? 'left' : h === 'justify' ? 'justify' : undefined,
      valign: v === 'top' ? 'top' : v === 'center' ? 'middle' : undefined,
      wrap: al?.getAttribute('wrapText') === '1' || al?.getAttribute('wrapText') === 'true',
      indent: Number(al?.getAttribute('indent') ?? 0) || undefined,
    }
    return { numFmt: fmts.get(id) ?? BUILTIN_FORMATS[id] ?? 'General', style }
  })
  return { xfs: xfs.length ? xfs : [{ numFmt: 'General', style: {} }], date1904: false }
}

async function readTheme(zip: JSZip): Promise<string[]> {
  const text = await zip.file('xl/theme/theme1.xml')?.async('string')
  if (!text) return THEME_DEFAULT
  try {
    const d = new DOMParser().parseFromString(text, 'application/xml')
    const scheme = d.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'clrScheme')[0]
    if (!scheme) return THEME_DEFAULT
    const names = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
    return names.map((n, i) => {
      const el = scheme.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', n)[0]
      const c = el?.firstElementChild
      return c?.getAttribute('val')?.slice(-6) ?? c?.getAttribute('lastClr') ?? THEME_DEFAULT[i]
    })
  } catch {
    return THEME_DEFAULT
  }
}

/** Column width in characters → CSS px (Excel's formula for the default 11 pt Calibri). */
const colPx = (chars: number) => Math.max(0, Math.trunc(((256 * chars + Math.trunc(128 / 7)) / 256) * 7))

export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new UserFacingError('err.officeBroken', { kind: 'XLSX' })
  }
  const wbText = await zip.file('xl/workbook.xml')?.async('string')
  if (!wbText) throw new UserFacingError('err.officeBroken', { kind: 'XLSX' })
  const wb = xml(wbText)
  const theme = await readTheme(zip)
  const styles = await readStyles(zip, theme)
  styles.date1904 = ['1', 'true'].includes(kid(wb, 'workbookPr')?.getAttribute('date1904') ?? '')
  const shared = await (async () => {
    const t = await zip.file('xl/sharedStrings.xml')?.async('string')
    if (!t) return [] as string[]
    return kids(xml(t), 'si').map((si) => kids(si, 't').filter((t) => !t.closest('rPh')).map((t) => t.textContent ?? '').join(''))
  })()
  const rels = new Map<string, string>()
  const relText = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (relText) for (const r of new DOMParser().parseFromString(relText, 'application/xml').getElementsByTagName('Relationship')) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '')

  const sheets: Sheet[] = []
  let total = 0
  for (const s of kids(wb, 'sheet')) {
    if (s.getAttribute('state') === 'hidden' || s.getAttribute('state') === 'veryHidden') continue
    const target = rels.get(s.getAttributeNS(REL, 'id') ?? '') ?? ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const text = await zip.file(path)?.async('string')
    if (!text) continue // chart sheets and missing parts are skipped
    const d = xml(text)
    const view = kid(d, 'sheetView')
    const fmt = kid(d, 'sheetFormatPr')
    const defaultCol = fmt?.getAttribute('defaultColWidth') ? colPx(Number(fmt.getAttribute('defaultColWidth'))) : colPx(Number(fmt?.getAttribute('baseColWidth') ?? 8) + 0.7109375)
    const defaultRow = Number(fmt?.getAttribute('defaultRowHeight') ?? 15) * (4 / 3)

    const cells = new Map<string, { text: string; numeric: boolean; style: CellStyle }>()
    let maxR = -1
    let maxC = -1
    const rowHeight = new Map<number, number>()
    const hiddenRows = new Set<number>()
    for (const row of kids(d, 'row')) {
      const r = Number(row.getAttribute('r')) - 1
      if (row.getAttribute('hidden') === '1' || row.getAttribute('hidden') === 'true') hiddenRows.add(r)
      if (row.getAttribute('ht')) rowHeight.set(r, Number(row.getAttribute('ht')) * (4 / 3))
      for (const c of kids(row, 'c')) {
        const [cr, cc] = cellRef(c.getAttribute('r') ?? '')
        if (cr < 0) continue
        const xf = styles.xfs[Number(c.getAttribute('s') ?? 0)] ?? styles.xfs[0]
        const type = c.getAttribute('t') ?? 'n'
        const v = kid(c, 'v')?.textContent ?? ''
        let text = ''
        let numeric = false
        if (type === 's') text = shared[Number(v)] ?? ''
        else if (type === 'inlineStr') text = kids(c, 't').map((t) => t.textContent ?? '').join('')
        else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE'
        else if (type === 'e' || type === 'str') text = v
        else if (type === 'd') text = v
        else if (v !== '') {
          const n = Number(v)
          if (Number.isFinite(n)) { text = formatNumber(n, xf.numFmt, styles.date1904); numeric = true } else text = v
        }
        const hasStyle = !!(xf.style.fill || xf.style.border?.top || xf.style.border?.bottom || xf.style.border?.left || xf.style.border?.right)
        if (!text && !hasStyle) continue
        cells.set(`${cr}:${cc}`, { text, numeric, style: xf.style })
        if (text || hasStyle) { maxR = Math.max(maxR, cr); maxC = Math.max(maxC, cc) }
      }
    }
    const merges = kids(d, 'mergeCell').map((m) => (m.getAttribute('ref') ?? '').split(':').map(cellRef) as [[number, number], [number, number]])
    for (const [[r1, c1], [r2, c2]] of merges) { maxR = Math.max(maxR, r2); maxC = Math.max(maxC, c2); void r1; void c1 }
    if (maxR < 0) { sheets.push({ name: s.getAttribute('name') ?? '', rtl: view?.getAttribute('rightToLeft') === '1', gridlines: false, cols: [], rows: [] }); continue }
    total += (maxR + 1) * (maxC + 1)
    if (total > MAX_CELLS) throw new UserFacingError('err.sheetTooBig', { count: MAX_CELLS })

    const widths: number[] = Array.from({ length: maxC + 1 }, () => defaultCol)
    const hiddenCols = new Set<number>()
    for (const col of kids(d, 'col')) {
      const min = Number(col.getAttribute('min')) - 1
      const max = Math.min(Number(col.getAttribute('max')) - 1, maxC)
      for (let i = min; i <= max; i++) {
        if (col.getAttribute('hidden') === '1' || col.getAttribute('hidden') === 'true') hiddenCols.add(i)
        if (col.getAttribute('width')) widths[i] = colPx(Number(col.getAttribute('width')))
      }
    }
    const rows: Sheet['rows'] = []
    const covered = new Set<string>()
    const spans = new Map<string, [number, number]>()
    for (const [[r1, c1], [r2, c2]] of merges) {
      spans.set(`${r1}:${c1}`, [r2 - r1 + 1, c2 - c1 + 1])
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`)
    }
    const visibleCols = widths.map((_, i) => i).filter((i) => !hiddenCols.has(i))
    for (let r = 0; r <= maxR; r++) {
      if (hiddenRows.has(r)) continue
      const row: Cell[] = []
      for (const c of visibleCols) {
        const key = `${r}:${c}`
        const cell = cells.get(key)
        const span = spans.get(key)
        row.push({ text: cell?.text ?? '', numeric: cell?.numeric ?? false, style: cell?.style ?? {}, covered: covered.has(key), rowspan: span?.[0], colspan: span ? visibleCols.filter((x) => x >= c && x < c + span[1]).length : undefined })
      }
      rows.push({ height: rowHeight.get(r) ?? defaultRow, cells: row })
    }
    sheets.push({ name: s.getAttribute('name') ?? '', rtl: view?.getAttribute('rightToLeft') === '1' || view?.getAttribute('rightToLeft') === 'true', gridlines: view?.getAttribute('showGridLines') !== '0' && view?.getAttribute('showGridLines') !== 'false', cols: visibleCols.map((i) => widths[i]), rows })
  }
  return sheets
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A sheet as an HTML table with inline styles (all text escaped). */
export function sheetToHtml(sheet: Sheet, gridlines: boolean): string {
  const grid = '1px solid #d0d0d0'
  const cols = sheet.cols.map((w) => `<col style="width:${w}px">`).join('')
  const body = sheet.rows
    .map((row) => {
      const tds = row.cells
        .filter((c) => !c.covered)
        .map((c) => {
          const s = c.style
          const css: string[] = [`padding:1px 3px`, `vertical-align:${s.valign ?? 'bottom'}`]
          css.push(`text-align:${s.align ?? (c.numeric ? (sheet.rtl ? 'left' : 'right') : 'start')}`)
          css.push(s.wrap ? 'white-space:pre-wrap;overflow-wrap:anywhere' : 'white-space:pre')
          if (s.bold) css.push('font-weight:700')
          if (s.italic) css.push('font-style:italic')
          if (s.underline || s.strike) css.push(`text-decoration:${[s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ')}`)
          if (s.size) css.push(`font-size:${(s.size * 4) / 3}px`)
          if (s.color) css.push(`color:${s.color}`)
          if (s.fill) css.push(`background:${s.fill}`)
          if (s.indent) css.push(`padding-inline-start:${3 + s.indent * 9}px`)
          if (s.font) css.push(`font-family:"${s.font.replace(/["\\<>]/g, '')}",Calibri,Carlito,Arial,sans-serif`)
          for (const side of ['top', 'right', 'bottom', 'left'] as const) {
            const b = s.border?.[side]
            if (b) css.push(`border-${side}:${b}`)
            else if (gridlines) css.push(`border-${side}:${grid}`)
          }
          const span = `${c.colspan && c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan && c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}`
          return `<td${span} style="${css.join(';')}">${esc(c.text)}</td>`
        })
        .join('')
      return `<tr style="height:${row.height.toFixed(1)}px">${tds}</tr>`
    })
    .join('')
  return `<table dir="${sheet.rtl ? 'rtl' : 'ltr'}" style="border-collapse:collapse;table-layout:fixed;width:${sheet.cols.reduce((a, b) => a + b, 0)}px;font:14.67px Calibri,Carlito,Arial,sans-serif;color:#000"><colgroup>${cols}</colgroup>${body}</table>`
}
