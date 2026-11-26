# FreePDF 1.3.0 (draft): conversion, OCR, Fill & Sign, Redact

> **Draft.** Not tagged or published. Test figures are from the local run and CI on `main`; see
> [RELEASE_CHECKLIST_v1.3.0.md](RELEASE_CHECKLIST_v1.3.0.md) for what is still open.

Sixteen new tools (32 in all), and tool pages that open faster. Everything still runs in your browser:
no uploads, no account, no quotas, no watermark of ours, no ads, in English and Arabic.

## New tools

**Convert to PDF**
- **Word to PDF** (`/word-to-pdf`), **Excel to PDF** (`/excel-to-pdf`), **HTML to PDF**
  (`/html-to-pdf`): real, selectable text; Word's page size, margins, headers and footers; Excel
  formats, merged cells and right-to-left sheets; HTML is sanitised and nothing external is loaded.
- **TIFF to PDF** (`/tiff-to-pdf`): multi-page TIFF with every common compression, lossless or smaller.
- **TXT to PDF** (`/txt-to-pdf`): wrapping, fonts, page set-up; UTF-8/16 and Windows Arabic encodings.

**Convert from PDF**
- **PDF to Word** (`/pdf-to-word`): headings, paragraphs, lists and real Word tables.
- **PDF to Excel** (`/pdf-to-excel`): tables rebuilt with real numbers.
- **PDF to PowerPoint** (`/pdf-to-powerpoint`): editable text boxes over the page, or exact pictures.
- **PDF to TXT**, **PDF to HTML**, **PDF to WebP**.
- **Bank statement to Excel** (`/bank-statement-to-excel`): every transaction as Excel, CSV or OFX,
  each row checked against the running balance. English and Arabic statements, scanned ones too.

**OCR: make scans searchable** (`/ocr-pdf`)
- Scanned PDFs and photos of pages become searchable PDFs (an invisible text layer over the unchanged
  scan) or text, in English, Arabic or both.
- PDF to Word, Excel and Text/HTML read scanned pages with OCR automatically.

**Fill PDF forms** (`/fill-pdf-form`) and **Sign PDF** (`/sign-pdf`)
- Fill a form's fields right on the page (text, Arabic, checkboxes, radio buttons, dropdowns), or
  type, date and tick anywhere on flat and scanned forms.
- Draw, type or upload a signature (the paper is made transparent); initials on every page in one
  click; copy any item to every page.
- Keep the form editable or lock the answers into the page.

**Redact PDF** (`/redact-pdf`), the first tool in the new Security category
- Black out areas by hand or whole pages, or find text and patterns: emails, phone numbers, IBANs,
  card numbers, Saudi ID and Iqama numbers (Arabic digits too).
- Real redaction: each redacted page is rebuilt from a picture of itself with the boxes burnt in, and
  the old page is deleted from the file. The rest of the page stays searchable. Metadata, bookmarks,
  attachments and scripts are removed too (optional).

## Faster pages

- **Tool pages** download about 45% less before you choose a file (205 KB instead of 377 KB, gzipped,
  for a typical tool): the PDF engine (PDF.js) now loads when the first file is opened.
- **English pages** no longer download the Arabic font (45 KB) just to show the "العربية" button; the
  system font draws that one word.

## Under the hood

- **New runtime dependencies**, each loaded only by the tools that need them: `docx-preview` 0.4.1
  (Word to PDF), `utif2` 4.1.0 (TIFF), `tesseract.js` 7.0.0 with English and Arabic models (OCR,
  self-hosted under `/ocr/7.0.0/`, about 6–8 MB on first use).
- **Shared pieces:** a lazily rendered page viewer (Fill & Sign, Redact), an invisible text-layer
  writer (OCR, Redact), Office file writers with no library.
- **Updated:** pako 3, Vite 8, Playwright 1.65, React Router 7.18 and others (see the changelog).
- **CI:** dated, reasoned exceptions for `npm audit` (none open); Firefox runs in CI and blocks deploys.

## Test results

| Suite | Result |
|-------|--------|
| Unit / integration | 245 / 245 |
| Browser, 5 Chromium device profiles | 254 passed, 1 skipped (Cloudflare-only) |
| Accessibility (axe WCAG 2.1 AA), every new screen, EN/AR, light/dark | Pass in Chromium and Firefox; in Firefox five rules are skipped on the screen right after a download, where they crash Playwright's Firefox |
| CI on `main` (checks, Chromium, Firefox, Cloudflare runtime) | Green |
| `npm audit` | 0 vulnerabilities |
| Safari, physical devices, Microsoft Office, Adobe Acrobat | **Not tested** |

All test documents are synthetic (invented names and numbers); no real bank statements, forms or
government documents were used.

## Known limitations

- **Conversions:** layouts are inferred from positions; multi-column pages, merged table cells and exact
  fonts aren't reproduced. PowerPoint to PDF isn't offered (no in-browser slide renderer).
- **OCR:** clear, straight printed scans read well; handwriting, faint print, photos at an angle and
  complex layouts read worse, and any OCR can misread. Pages aren't straightened automatically.
- **Bank statements:** tested on synthetic statements only; no real bank's layout is claimed.
- **Fill & Sign:** form scripts and calculations don't run; XFA-only forms can't be filled; a signature
  is a picture on the page, not a certificate-based digital signature.
- **Redact:** search covers the text layer only; scans, faces and handwriting must be marked by hand.
  Redacted pages become 200 dpi images and the file loses its accessibility tags.
