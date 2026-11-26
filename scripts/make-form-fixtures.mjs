// Test form for Fill & Sign. Re-run: node scripts/make-form-fixtures.mjs
// A synthetic bilingual application form with every common field type. All names and values invented.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const doc = await PDFDocument.create()
doc.registerFontkit(fontkit)
doc.setTitle('Example membership application')
const helv = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const plex = await doc.embedFont(readFileSync(join(root, 'node_modules/@expo-google-fonts/ibm-plex-sans-arabic/400Regular/IBMPlexSansArabic_400Regular.ttf')), { subset: false })
const page = doc.addPage([595.28, 841.89])
const form = doc.getForm()
const ink = rgb(0.1, 0.1, 0.12)
page.drawText('Example Club — Membership application', { x: 50, y: 790, size: 16, font: bold, color: ink })
// Arabic heading (pure Arabic: fontkit shapes it and lays it out right to left).
page.drawText('طلب عضوية', { x: 450, y: 790, size: 14, font: plex, color: ink })
const label = (t, y) => page.drawText(t, { x: 50, y: y + 6, size: 10, font: helv, color: ink })

label('Full name', 730)
const name = form.createTextField('applicant.full_name'); name.addToPage(page, { x: 160, y: 725, width: 300, height: 22 })
label('Name in Arabic', 690)
const nameAr = form.createTextField('applicant.name_ar'); nameAr.addToPage(page, { x: 160, y: 685, width: 300, height: 22 })
label('National ID (10 digits)', 650)
const id = form.createTextField('applicant.id_number'); id.setMaxLength(10); id.enableCombing(); id.addToPage(page, { x: 200, y: 645, width: 220, height: 22 })
label('City', 610)
const city = form.createDropdown('applicant.city'); city.addOptions(['Riyadh', 'Jeddah', 'الدمام']); city.addToPage(page, { x: 160, y: 605, width: 160, height: 22 })
label('Membership', 570)
const plan = form.createRadioGroup('membership.plan')
page.drawText('Monthly', { x: 185, y: 576, size: 10, font: helv }); plan.addOptionToPage('monthly', page, { x: 160, y: 572, width: 14, height: 14 })
page.drawText('Yearly', { x: 285, y: 576, size: 10, font: helv }); plan.addOptionToPage('yearly', page, { x: 260, y: 572, width: 14, height: 14 })
label('Notes', 530)
const notes = form.createTextField('applicant.notes'); notes.enableMultiline(); notes.addToPage(page, { x: 160, y: 470, width: 300, height: 66 })
const agree = form.createCheckBox('consent.agree'); agree.addToPage(page, { x: 50, y: 430, width: 14, height: 14 })
page.drawText('I agree to the club rules.', { x: 72, y: 433, size: 10, font: helv, color: ink })
page.drawText('Signature', { x: 50, y: 380, size: 10, font: helv, color: ink })
page.drawLine({ start: { x: 110, y: 378 }, end: { x: 330, y: 378 }, thickness: 0.6, color: ink })
page.drawText('Date', { x: 360, y: 380, size: 10, font: helv, color: ink })
page.drawLine({ start: { x: 390, y: 378 }, end: { x: 500, y: 378 }, thickness: 0.6, color: ink })
form.updateFieldAppearances(helv)
writeFileSync(join(root, 'tests/fixtures/forms/application.pdf'), await doc.save())
console.log('ok')
