/**
 * Bank statement exports: Excel (typed dates and amounts, a Check column, a summary sheet), CSV and
 * OFX 1.0.2. Transactions are written oldest first, whatever order the statement printed them in.
 */
import JSZip from 'jszip'
import { APP, colName, core, finish, rootRels, XML, xmlText } from './ooxml'
import type { Statement, Transaction } from './statement'

export interface StatementLabels {
  sheet: string
  summary: string
  date: string
  valueDate: string
  description: string
  reference: string
  debit: string
  credit: string
  balance: string
  check: string
  ok: string
  /** "Expected {amount}" */
  expected: string
  /** Summary rows. */
  file: string
  account: string
  currency: string
  period: string
  opening: string
  closing: string
  totalDebit: string
  totalCredit: string
  count: string
  checked: string
  mismatches: string
}

export function chronological(s: Statement): Transaction[] {
  return s.order === 'newest-first' ? [...s.transactions].reverse() : s.transactions
}

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const round = (n: number) => Math.round(n * 100) / 100

export function totals(s: Statement): { debit: number; credit: number; from: string; to: string } {
  const t = chronological(s)
  return {
    debit: round(t.reduce((a, x) => a + (x.debit ?? 0), 0)),
    credit: round(t.reduce((a, x) => a + (x.credit ?? 0), 0)),
    from: t[0].date,
    to: t[t.length - 1].date,
  }
}

function hasValueDate(s: Statement) { return s.transactions.some((t) => t.valueDate) }
function hasReference(s: Statement) { return s.transactions.some((t) => t.reference) }

// ------------------------------------------------------------------------------------------- CSV

/** A CSV cell. Text that a spreadsheet would run as a formula (= + - @, tab, CR) gets a leading apostrophe. */
function csvCell(v: string | number | null): string {
  if (v === null) return ''
  let s = typeof v === 'number' ? v.toFixed(2) : v
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** UTF-8 with a byte-order mark (so Excel reads Arabic correctly), CRLF line ends, ISO dates, plain numbers. */
export function statementCsv(s: Statement, l: StatementLabels): Uint8Array {
  const vd = hasValueDate(s), ref = hasReference(s)
  const head = [l.date, ...(vd ? [l.valueDate] : []), l.description, ...(ref ? [l.reference] : []), l.debit, l.credit, l.balance, l.check]
  const lines = [head.map(csvCell).join(',')]
  for (const t of chronological(s)) {
    lines.push([t.date, ...(vd ? [t.valueDate ?? ''] : []), t.description, ...(ref ? [t.reference ?? ''] : []), t.debit, t.credit, t.balance, checkText(t, l)].map(csvCell).join(','))
  }
  const text = '﻿' + lines.join('\r\n') + '\r\n'
  return new TextEncoder().encode(text)
}

function checkText(t: Transaction, l: StatementLabels): string {
  if (t.check === 'ok') return l.ok
  if (t.check === 'mismatch') return l.expected.replace('{amount}', money(t.expected!))
  return ''
}

// ------------------------------------------------------------------------------------------ XLSX

/** Excel's day number for an ISO date (1900 date system). */
export function excelDate(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000)
}

// Styles: 0 default, 1 bold header, 2 date, 3 amount, 4 date (mismatch row), 5 amount (mismatch row), 6 text (mismatch row), 7 bold text.
const STYLES = `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE2E1"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/><xf numFmtId="165" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`

type XCell = { kind: 'text'; v: string; s?: number } | { kind: 'num'; v: number; s: number } | null
function row(r: number, cells: XCell[]): string {
  const out = cells
    .map((c, i) => {
      if (!c) return ''
      const ref = `${colName(i)}${r}`
      if (c.kind === 'num') return `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`
      return `<c r="${ref}"${c.s ? ` s="${c.s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlText(c.v)}</t></is></c>`
    })
    .join('')
  return `<row r="${r}">${out}</row>`
}

export async function statementXlsx(s: Statement, l: StatementLabels, o: { title: string; fileName: string }): Promise<Uint8Array> {
  const vd = hasValueDate(s), ref = hasReference(s)
  const head = [l.date, ...(vd ? [l.valueDate] : []), l.description, ...(ref ? [l.reference] : []), l.debit, l.credit, l.balance, l.check]
  const widths = [12, ...(vd ? [12] : []), 48, ...(ref ? [16] : []), 14, 14, 16, 22]
  const rows = [row(1, head.map((h) => ({ kind: 'text', v: h, s: 1 })))]
  chronological(s).forEach((t, i) => {
    const bad = t.check === 'mismatch'
    const date = (iso: string | undefined): XCell => (iso ? { kind: 'num', v: excelDate(iso), s: bad ? 4 : 2 } : null)
    const num = (n: number | null): XCell => (n === null ? (bad ? { kind: 'text', v: '', s: 6 } : null) : { kind: 'num', v: n, s: bad ? 5 : 3 })
    const text = (v: string | undefined): XCell => (v ? { kind: 'text', v, s: bad ? 6 : 0 } : bad ? { kind: 'text', v: '', s: 6 } : null)
    rows.push(row(i + 2, [date(t.date), ...(vd ? [date(t.valueDate)] : []), text(t.description), ...(ref ? [text(t.reference)] : []), num(t.debit), num(t.credit), num(t.balance), text(checkText(t, l))]))
  })
  const last = colName(head.length - 1)
  const n = s.transactions.length + 1
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  const view = (rtl: boolean, selected: boolean, freeze: boolean) =>
    `<sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}${selected ? ' tabSelected="1"' : ''}>${freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>`
  const sheet1 = `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${view(s.rtl, true, true)}<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A1:${last}${n}"/></worksheet>`

  const tt = totals(s)
  const sum: [string, XCell][] = [
    [l.file, { kind: 'text', v: o.fileName }],
    [l.account, s.account ? { kind: 'text', v: `…${s.account}` } : null],
    [l.currency, s.currency ? { kind: 'text', v: s.currency } : null],
    [l.period, { kind: 'text', v: `${tt.from} – ${tt.to}` }],
    [l.opening, s.opening === null ? null : { kind: 'num', v: s.opening, s: 3 }],
    [l.closing, s.closing === null ? null : { kind: 'num', v: s.closing, s: 3 }],
    [l.totalDebit, { kind: 'num', v: tt.debit, s: 3 }],
    [l.totalCredit, { kind: 'num', v: tt.credit, s: 3 }],
    [l.count, { kind: 'num', v: s.transactions.length, s: 0 }],
    [l.checked, { kind: 'num', v: s.checked, s: 0 }],
    [l.mismatches, { kind: 'num', v: s.mismatches, s: s.mismatches ? 5 : 0 }],
  ]
  const sheet2 = `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${view(s.rtl, false, false)}<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/></cols><sheetData>${sum.map(([k, v], i) => row(i + 1, [{ kind: 'text', v: k, s: 7 }, v])).join('')}</sheetData></worksheet>`

  const zip = new JSZip()
  const names = [l.sheet, l.summary].map((x) => x.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31))
  zip.file('xl/worksheets/sheet1.xml', sheet1)
  zip.file('xl/worksheets/sheet2.xml', sheet2)
  zip.file('xl/styles.xml', `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${STYLES}</styleSheet>`)
  zip.file('xl/workbook.xml', `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((x, i) => `<sheet name="${xmlText(x)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xmlText(names[0].replace(/'/g, "''"))}'!$A$1:$${last}$${n}</definedName></definedNames></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`)
  zip.file('_rels/.rels', rootRels('xl/workbook.xml'))
  zip.file('docProps/core.xml', core(o.title))
  zip.file('docProps/app.xml', APP)
  return finish(zip)
}

// ------------------------------------------------------------------------------------------- OFX

/** OFX 1.0.2 (SGML), the import format accounting apps share. Text is UTF-8; amounts are signed. */
export function statementOfx(s: Statement, o: { currency: string; now?: Date }): Uint8Array {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\r\n]+/g, ' ')
  const d8 = (iso: string) => iso.replace(/-/g, '')
  const now = (o.now ?? new Date()).toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const t = chronological(s)
  const tt = totals(s)
  const seen = new Map<string, number>()
  const trn = t.map((x) => {
    const amount = round((x.credit ?? 0) - (x.debit ?? 0))
    // Stable IDs (same statement → same IDs), so re-importing doesn't duplicate transactions.
    const base = `${d8(x.date)}-${amount.toFixed(2)}-${hash(x.description + (x.reference ?? '') + (x.balance ?? ''))}`
    const k = (seen.get(base) ?? 0) + 1
    seen.set(base, k)
    const name = (x.description || x.reference || (amount < 0 ? 'Debit' : 'Credit')).slice(0, 32)
    return `<STMTTRN>\n<TRNTYPE>${amount < 0 ? 'DEBIT' : 'CREDIT'}\n<DTPOSTED>${d8(x.date)}\n<TRNAMT>${amount.toFixed(2)}\n<FITID>${base}${k > 1 ? `-${k}` : ''}\n<NAME>${esc(name)}\n${x.description.length > 32 || x.reference ? `<MEMO>${esc([x.description, x.reference].filter(Boolean).join(' · ').slice(0, 255))}\n` : ''}</STMTTRN>`
  })
  const lastBal = [...t].reverse().find((x) => x.balance !== null)?.balance ?? s.closing
  const text = [
    'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:UNICODE', 'CHARSET:NONE', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    '<OFX>', '<SIGNONMSGSRSV1>', '<SONRS>', '<STATUS>', '<CODE>0', '<SEVERITY>INFO', '</STATUS>', `<DTSERVER>${now}`, '<LANGUAGE>ENG', '</SONRS>', '</SIGNONMSGSRSV1>',
    '<BANKMSGSRSV1>', '<STMTTRNRS>', '<TRNUID>1', '<STATUS>', '<CODE>0', '<SEVERITY>INFO', '</STATUS>', '<STMTRS>', `<CURDEF>${o.currency}`,
    '<BANKACCTFROM>', '<BANKID>000000000', `<ACCTID>${s.account ? `XXXX${s.account}` : 'STATEMENT'}`, '<ACCTTYPE>CHECKING', '</BANKACCTFROM>',
    '<BANKTRANLIST>', `<DTSTART>${d8(tt.from)}`, `<DTEND>${d8(tt.to)}`, ...trn, '</BANKTRANLIST>',
    ...(lastBal !== null && lastBal !== undefined ? ['<LEDGERBAL>', `<BALAMT>${lastBal.toFixed(2)}`, `<DTASOF>${d8(tt.to)}`, '</LEDGERBAL>'] : []),
    '</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>', '',
  ].join('\r\n')
  return new TextEncoder().encode(text)
}

/** Short, stable, non-cryptographic hash (FNV-1a, base 36). */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}
