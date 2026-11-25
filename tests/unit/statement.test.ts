import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPageText, type DocLike, type PageText } from '../../src/lib/convert/pdfExport'
import JSZip from 'jszip'
import { asciiDigits, detectDateOrder, parseAmount, parseDate, parseStatement, roleOf, type Statement } from '../../src/lib/convert/statement'
import { excelDate, statementCsv, statementOfx, statementXlsx } from '../../src/lib/convert/statementExport'
import { openNode } from './render'

const dir = join(__dirname, '..', 'fixtures', 'statements')
interface Expected { opening: number; closing: number; currency: string; transactions: { date: string; description: string; reference?: string; debit: number | null; credit: number | null; balance: number }[] }

async function pages(name: string): Promise<PageText[]> {
  const { doc, close } = await openNode(new Uint8Array(readFileSync(join(dir, name))))
  try {
    const out: PageText[] = []
    for (let i = 1; i <= doc.numPages; i++) out.push(await readPageText(doc as unknown as DocLike, i))
    return out
  } finally { await close() }
}
const expected = (name: string): Expected => JSON.parse(readFileSync(join(dir, name.replace('.pdf', '.expected.json')), 'utf8'))

describe('statement fixtures', () => {
  for (const name of ['en-statement.pdf', 'ar-statement.pdf', 'signed-statement.pdf']) {
    it(`reads every transaction of ${name} and checks every balance`, async () => {
      const s = parseStatement(await pages(name))!
      const e = expected(name)
      const chrono = s.order === 'newest-first' ? [...s.transactions].reverse() : s.transactions
      expect(chrono.map((t) => [t.date, t.debit, t.credit, t.balance])).toEqual(e.transactions.map((t) => [t.date, t.debit, t.credit, t.balance]))
      expect(chrono.map((t) => t.description)).toEqual(e.transactions.map((t) => t.description))
      expect(s).toMatchObject({ opening: e.opening, currency: e.currency, mismatches: 0, checked: e.transactions.length })
    })
  }
})

describe('statement parsing helpers', () => {
  it('reads amounts in the formats statements use', () => {
    expect(parseAmount('1,234.56')).toEqual({ value: 1234.56, sign: 0 })
    expect(parseAmount('1.234,56')).toEqual({ value: 1234.56, sign: 0 })
    expect(parseAmount('(1,234.56)')).toEqual({ value: 1234.56, sign: -1 })
    expect(parseAmount('-45.00')).toEqual({ value: 45, sign: -1 })
    expect(parseAmount('45.00-')).toEqual({ value: 45, sign: -1 })
    expect(parseAmount('1,200.00 CR')).toEqual({ value: 1200, sign: 1 })
    expect(parseAmount('DR 12.50')).toEqual({ value: 12.5, sign: -1 })
    expect(parseAmount('SAR 99.10')).toEqual({ value: 99.1, sign: 0 })
    expect(parseAmount('٢٬٥٠٠٫٧٥')).toEqual({ value: 2500.75, sign: 0 })
    expect(parseAmount('12,000')).toEqual({ value: 12000, sign: 0 })
    expect(parseAmount('Opening balance')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
  it('reads dates, choosing day/month order from the whole statement', () => {
    expect(detectDateOrder(['02/09/2026', '17/09/2026'])).toBe('dmy')
    expect(detectDateOrder(['09/02/2026', '09/17/2026'])).toBe('mdy')
    expect(detectDateOrder(['2026-09-02'])).toBe('ymd')
    expect(detectDateOrder(['02/03/2026'])).toBe('dmy') // ambiguous: day first, as Gulf banks print
    expect(parseDate('17/09/2026', 'dmy')).toBe('2026-09-17')
    expect(parseDate('09/17/26', 'mdy')).toBe('2026-09-17')
    expect(parseDate('17 Sep 2026', 'dmy')).toBe('2026-09-17')
    expect(parseDate('17-SEPT-26', 'dmy')).toBe('2026-09-17')
    expect(parseDate('Sep 17, 2026', 'dmy')).toBe('2026-09-17')
    expect(parseDate('31/02/2026', 'dmy')).toBeNull()
    expect(asciiDigits('١٧/٠٩/٢٠٢٦')).toBe('17/09/2026')
  })
  it('recognises English and Arabic column names', () => {
    expect(['Date', 'Value Date', 'Narration', 'Ref No.', 'Withdrawals', 'Deposits', 'Running Balance'].map(roleOf)).toEqual(['date', 'valueDate', 'description', 'reference', 'debit', 'credit', 'balance'])
    expect(['التاريخ', 'البيان', 'مدين', 'دائن', 'الرصيد', 'المبلغ'].map(roleOf)).toEqual(['date', 'description', 'debit', 'credit', 'balance', 'amount'])
    expect(roleOf('Account statement')).toBeNull()
  })

  // A tight, top-aligned table built from words: Arabic-Indic digits, one unsigned amount column (money in
  // or out is read from the balance), a wrapped description, a wrong balance, and a page footer.
  const span = (str: string, x: number, y: number, width = str.length * 5): import('../../src/lib/convert/pdfExport').Span => ({ str, x, y, width, size: 10, angle: 0 })
  const page = (spans: ReturnType<typeof span>[]): PageText => ({ number: 1, width: 600, height: 800, lines: [], spans })
  it('reads a tight table, settles unsigned amounts from the balance and flags a wrong balance', () => {
    const s = parseStatement([page([
      span('Example Bank statement ****5521 USD', 20, 40, 200),
      span('Date', 20, 80, 22), span('Details', 120, 80, 35), span('Amount', 380, 80, 34), span('Balance', 480, 80, 38),
      span('Opening balance', 120, 92, 80), span('١٬٠٠٠٫٠٠', 480, 92, 40),
      span('01/03/2026', 20, 104, 50), span('Salary', 120, 104, 30), span('500.00', 380, 104, 30), span('1,500.00', 480, 104, 40),
      span('02/03/2026', 20, 116, 50), span('Card payment at a shop', 120, 116, 110), span('200.00', 380, 116, 30), span('1,300.00', 480, 116, 40),
      span('with a long name', 120, 128, 80),
      span('03/03/2026', 20, 140, 50), span('Transfer', 120, 140, 40), span('100.00', 380, 140, 30), span('1,250.00', 480, 140, 40),
      span('Page 1 of 1 · Example Bank is fictional', 20, 400, 200),
    ])])!
    expect(s.opening).toBe(1000)
    expect(s.currency).toBe('USD')
    expect(s.account).toBe('5521')
    expect(s.transactions.map((t) => [t.date, t.description, t.debit, t.credit, t.check])).toEqual([
      ['2026-03-01', 'Salary', null, 500, 'ok'],
      ['2026-03-02', 'Card payment at a shop with a long name', 200, null, 'ok'],
      ['2026-03-03', 'Transfer', 100, null, 'mismatch'],
    ])
    expect(s.transactions[2].expected).toBe(1200)
    expect(s).toMatchObject({ checked: 3, mismatches: 1 })
  })
  it('returns null for a PDF without a transaction table', () => {
    expect(parseStatement([page([span('Just a letter', 20, 40), span('Date of letter: 01/03/2026', 20, 60)])])).toBeNull()
  })
})

describe('statement exports', () => {
  const labels = { sheet: 'Transactions', summary: 'Summary', date: 'Date', valueDate: 'Value date', description: 'Description', reference: 'Reference', debit: 'Debit', credit: 'Credit', balance: 'Balance', check: 'Check', ok: 'OK', expected: 'Expected {amount}', noBalance: 'Balance not read', file: 'File', account: 'Account', currency: 'Currency', period: 'Period', opening: 'Opening balance', closing: 'Closing balance', totalDebit: 'Total debits', totalCredit: 'Total credits', count: 'Transactions', checked: 'Checked', mismatches: 'Mismatches' }
  const st = (): Statement => ({
    transactions: [
      { date: '2026-03-03', description: '=HYPERLINK("x")', reference: 'R3', debit: 100, credit: null, balance: 1250, page: 1, check: 'mismatch', expected: 1200 },
      { date: '2026-03-01', description: 'Salary, March "bonus" & <more>', debit: null, credit: 500, balance: 1500, page: 1, check: 'ok' },
      { date: '2026-03-01', description: 'Salary, March "bonus" & <more>', debit: null, credit: 500, balance: 2000, page: 1, check: 'ok' },
    ],
    opening: 1000, closing: 1250, order: 'newest-first', dateOrder: 'dmy', currency: 'SAR', account: '4821', columns: ['date', 'description', 'reference', 'debit', 'credit', 'balance'], rtl: false, checked: 3, mismatches: 1, missingBalances: 0, closingOk: true,
  })
  it('writes CSV oldest first, with a BOM, quoting and formula protection', () => {
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(statementCsv(st(), labels))
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text.slice(1).split('\r\n')).toEqual([
      'Date,Description,Reference,Debit,Credit,Balance,Check',
      '2026-03-01,"Salary, March ""bonus"" & <more>",,,500.00,2000.00,OK',
      '2026-03-01,"Salary, March ""bonus"" & <more>",,,500.00,1500.00,OK',
      `2026-03-03,"'=HYPERLINK(""x"")",R3,100.00,,1250.00,"Expected 1,200.00"`,
      '',
    ])
  })
  it('writes an Excel workbook with real dates and amounts, a highlighted mismatch and a summary', async () => {
    const zip = await JSZip.loadAsync(await statementXlsx(st(), labels, { title: 't', fileName: 'march.pdf' }))
    const s1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(s1).toContain(`<c r="A2" s="2"><v>${excelDate('2026-03-01')}</v></c>`)
    expect(excelDate('2026-03-01')).toBe(46082)
    expect(s1).toContain('<c r="E2" s="3"><v>500</v></c>')
    expect(s1).toContain('<c r="D4" s="5"><v>100</v></c>') // mismatch row: red fill
    expect(s1).toContain('<t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>') // text, never a formula
    expect(s1).toContain('<pane ySplit="1"')
    expect(s1).toContain('<autoFilter ref="A1:G4"/>')
    const s2 = await zip.file('xl/worksheets/sheet2.xml')!.async('string')
    expect(s2).toContain('march.pdf')
    expect(s2).toContain('…4821')
    expect(s2).toMatch(/Total debits<\/t><\/is><\/c><c r="B7" s="3"><v>100<\/v>/)
  })
  it('writes OFX with signed amounts, stable unique IDs and escaped text', () => {
    const text = new TextDecoder().decode(statementOfx(st(), { currency: 'SAR', now: new Date('2026-11-18T00:00:00Z') }))
    expect(text.startsWith('OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102')).toBe(true)
    expect(text).toContain('<CURDEF>SAR')
    expect(text).toContain('<ACCTID>XXXX4821')
    expect([...text.matchAll(/<TRNAMT>(.*)/g)].map((m) => m[1].trim())).toEqual(['500.00', '500.00', '-100.00'])
    const ids = [...text.matchAll(/<FITID>(.*)/g)].map((m) => m[1].trim())
    expect(new Set(ids).size).toBe(3)
    expect(text).toContain('<NAME>Salary, March "bonus" &amp; &lt;mor')
    expect(text).toContain('<DTSTART>20260301\r\n<DTEND>20260303')
    expect(text).toContain('<BALAMT>1250.00')
    expect(new TextDecoder().decode(statementOfx(st(), { currency: 'SAR', now: new Date('2026-11-18T00:00:00Z') }))).toBe(text)
  })
})
