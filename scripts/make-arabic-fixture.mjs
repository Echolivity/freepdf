// Generates tests/fixtures/arabic.pdf: a 3-page Arabic document (shaped by Chromium, embedded font),
// with mixed Arabic/Latin text and digits. Run: node scripts/make-arabic-fixture.mjs
import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const font = pathToFileURL(join(root, 'node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2')).href
const page = (n, body) => `<section style="page-break-after:always"><h1>الصفحة ${n}: ${body.title}</h1>${body.html}</section>`
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:Plex;src:url(${font}) format('woff2')}
body{font-family:Plex,sans-serif;font-size:18px;line-height:1.8;margin:48px}
h1{font-size:30px} table{border-collapse:collapse;width:100%} td,th{border:1px solid #444;padding:6px}
</style></head><body>
${page(1, { title: 'عقد إيجار', html: '<p>يتفق الطرفان على أن تكون مدة العقد اثني عشر شهرًا تبدأ من تاريخ ١٤٤٨/٠٥/٠١ هـ، وقيمة الإيجار السنوي 24,000 ريال سعودي.</p><p>Contract reference: FP-2026-001 — مرجع العقد.</p>' })}
${page(2, { title: 'جدول الدفعات', html: '<table><tr><th>الدفعة</th><th>المبلغ</th><th>التاريخ</th></tr><tr><td>الأولى</td><td>12,000</td><td>2026-11-10</td></tr><tr><td>الثانية</td><td>12,000</td><td>2027-05-10</td></tr></table>' })}
${page(3, { title: 'التوقيعات', html: '<p>الطرف الأول: محمد عبدالله</p><p>الطرف الثاني: شركة المثال المحدودة</p>' })}
</body></html>`

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const p = await browser.newPage()
await p.setContent(html, { waitUntil: 'networkidle' })
await p.evaluate(() => document.fonts.ready)
await p.pdf({ path: join(root, 'tests/fixtures/arabic.pdf'), format: 'A4', printBackground: true })
await browser.close()
console.log('wrote tests/fixtures/arabic.pdf')
