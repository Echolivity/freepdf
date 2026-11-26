// Test letter for Redact PDF. Re-run: node scripts/make-redact-fixtures.mjs
// A synthetic two-page bilingual letter full of personal details. All names and numbers are invented;
// the IBAN and card number are the standard published test values.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const doc = await PDFDocument.create()
doc.registerFontkit(fontkit)
doc.setTitle('Account letter for Sara Example')
doc.setAuthor('Example Bank')
const helv = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const plex = await doc.embedFont(readFileSync(join(root, 'node_modules/@expo-google-fonts/ibm-plex-sans-arabic/400Regular/IBMPlexSansArabic_400Regular.ttf')), { subset: false })
const ink = rgb(0.1, 0.1, 0.12)

const p1 = doc.addPage([595.28, 841.89])
const line = (page, t, y, font = helv, size = 12) => page.drawText(t, { x: 60, y, size, font, color: ink })
line(p1, 'Example Bank — Account confirmation', 780, bold, 16)
line(p1, 'Customer: Sara Example', 730)
line(p1, 'Email: sara.example@example.com', 705)
line(p1, 'Mobile: +966 50 123 4567', 680)
line(p1, 'IBAN: SA03 8000 0000 6080 1016 7519', 655)
line(p1, 'National ID: 1012345678', 630)
line(p1, 'Card: 4111 1111 1111 1111', 605)
line(p1, 'This letter confirms that the account above is active.', 560)
// Arabic lines (pure Arabic runs: fontkit shapes them right to left), right-aligned.
const ar = (t, y) => p1.drawText(t, { x: 535 - plex.widthOfTextAtSize(t, 13), y, size: 13, font: plex, color: ink })
ar('اسم العميلة سارة المثال', 500)
ar('رقم الجوال', 475)
// fontkit reverses Arabic-Indic digit runs, so they're placed one at a time, left to right.
let dx = 535 - plex.widthOfTextAtSize('رقم الجوال', 13) - 8 - plex.widthOfTextAtSize('٠٥٠١٢٣٤٥٦٧', 13)
for (const d of '٠٥٠١٢٣٤٥٦٧') { p1.drawText(d, { x: dx, y: 475, size: 13, font: plex, color: ink }); dx += plex.widthOfTextAtSize(d, 13) }

const p2 = doc.addPage([595.28, 841.89])
line(p2, 'Page two: terms and conditions apply.', 780)
line(p2, 'Reference code ZX-99-ALPHA for internal use.', 755)

mkdirSync(join(root, 'tests/fixtures/redact'), { recursive: true })
writeFileSync(join(root, 'tests/fixtures/redact/letter.pdf'), await doc.save())
console.log('wrote tests/fixtures/redact/letter.pdf')
