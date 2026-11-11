# PDF conversion: implementation plan

Status: **batches 1 and 2 implemented and tested** (unreleased; see the CHANGELOG). Decisions agreed 2026-11-11.

## Decisions

| Question | Decision |
|----------|----------|
| DOCX / XLSX / HTML → PDF | Basic in-browser conversion (batch 2). Text stays selectable; headings, paragraphs, lists, tables and images are kept; complex layout may differ. Limits are stated in the tool. |
| PPTX → PDF | **Not offered.** There is no open-source client-side slide renderer; the docs explain why. |
| PDF → DOCX / XLSX / PPTX | Editable with limits (batch 2): Word gets paragraphs and images, Excel gets tables detected from text positions, PowerPoint gets one slide image per page. |
| Delivery | Two batches. Batch 1 is the reliable formats; stop and report before batch 2. |
| Servers | None. No file is ever sent anywhere; nothing falls back to a server. |

## Batch 1

| Conversion | Tool | Engine |
|------------|------|--------|
| TIFF → PDF | New page `tiff-to-pdf`; TIFF is also accepted by JPG/PNG to PDF | [utif2](https://github.com/photopea/UTIF.js) 4.1.0 (MIT, Photopea). Decodes multi-page TIFF with no compression, CCITT Group 3/4 (fax), LZW, PackBits, Deflate and JPEG. Loaded lazily in the worker, only for TIFF files. Pages are re-encoded losslessly as PNG (or JPEG, if the user picks the smaller option), at the TIFF's own DPI. |
| TXT → PDF | New page `txt-to-pdf` | pdf-lib in the worker. Word wrapping by font metrics; Helvetica, Times or Courier, with IBM Plex Sans Arabic (already shipped) for text the standard fonts can't encode; right-to-left paragraphs use the existing bidi line drawing. UTF-8 / UTF-16 (BOM) / Windows-1252 / Windows-1256. |
| PDF → WebP | New page `pdf-to-webp`, same tool as PDF to JPG/PNG | PDF.js render + `canvas.toBlob('image/webp')`. Feature-detected: browsers that can't encode WebP (Safari) get an explanation and the option is disabled. |
| PDF → TXT | New page `pdf-to-text` | PDF.js `getTextContent` + a layout pass (lines by baseline, words by gaps, paragraphs by spacing, right-to-left lines ordered right to left). |
| PDF → HTML | New page `pdf-to-html` | Same layout pass. **Flowing text**: headings and paragraphs as semantic HTML. **Exact layout**: each page as an image with a selectable transparent text layer. One self-contained file, all text escaped, a strict CSP `<meta>` inside. |

Also: page ranges for PDF → images. All new tools support several files at once (ZIP), progress,
cancel, and per-file errors.

## Library survey (batch 1)

| Need | Considered | Chosen | Why |
|------|-----------|--------|-----|
| TIFF decoding | utif2, utif, tiff (image-js), geotiff, decode-tiff | utif2 | Only one with CCITT fax (most document scans) plus JPEG-in-TIFF; ~105 KB unpacked; its dependency (pako) is already ours. `tiff` lacks CCITT/JPEG; `geotiff` is 3.8 MB and geospatial; utif is the older release of utif2. |
| Text extraction | PDF.js (already shipped) | PDF.js | Already used by Compare. |
| WebP encoding | Canvas (built in) | Canvas | No dependency; unsupported browsers are detected. |

## Known limits (stated in the tools)

- PDF → TXT/HTML read the PDF's text layer. Scans without one produce no text (OCR is planned for v1.4).
- Reading order is reconstructed from positions: multi-column pages may interleave columns, and tables become lines of text.
- TXT → PDF uses one font family per document; characters missing from the fonts (for example Chinese) are reported.

## Batch 1: what was verified

- Unit tests (`tests/unit/convert.test.ts`, Node): TIFF sniffing and decoding of every fixture
  (LZW multi-page, CCITT G4, PackBits, JPEG-in-TIFF, Deflate with alpha, truncated), DPI-correct page
  size, text detection and decoding (UTF-8, UTF-16, Windows-1252/1256), wrapping, TXT → PDF layout
  checked with qpdf and re-read with PDF.js, TXT → PDF → TXT round trip (Arabic included), line/
  paragraph/heading rebuilding, presentation-form and visual-order Arabic, HTML escaping and CSP.
- Browser tests (`tests/e2e/convert.spec.ts`, Chromium, all under the global privacy guard): each
  conversion end to end, batch ZIPs, page ranges, WebP output signature, the no-WebP fallback, binary
  `.txt` rejection, truncated TIFF error, scan without text, the exported HTML opened on its own.
- WCAG AA (axe) on all five new pages, English and Arabic, light and dark.
- Fixtures: `scripts/make-conversion-fixtures.py` (Pillow).

Not verified here: Firefox and Safari (no browsers available in the build environment; CI runs
Firefox), physical devices, and very large TIFFs (the per-page 100-megapixel limit is unit-tested,
the memory behaviour of a 200-page fax is not).

### Known limits found while testing

- Text from PDFs is rebuilt from positions. Multi-column pages may interleave; tables become lines
  (cells separated by a tab in TXT, a space in HTML). In Arabic paragraphs, a table row's numbers can
  display in a different order in flowing HTML than in the original, because the cells are joined
  into one line.
- Arabic embedded in a run of Latin text *inside a single PDF text fragment* may stay in visual
  order; whole fragments and per-glyph fragments are put in reading order.

## Batch 2

| Conversion | Tool | Engine |
|------------|------|--------|
| DOCX → PDF | `word-to-pdf` | [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.4.1 (Apache-2.0) renders the document into an off-screen shadow root, one element per Word page (using Word's own last page breaks). `domToPdf` then draws it. |
| XLSX → PDF | `excel-to-pdf` | FreePDF's XLSX reader (`xlsx.ts`, JSZip + DOMParser) → one HTML table per sheet → `domToPdf`. |
| HTML → PDF | `html-to-pdf` | Allowlist sanitiser (`htmlInput.ts`) → shadow root → `domToPdf`. |
| PDF → DOCX | `pdf-to-word` | PDF.js text → lines/blocks (`pdfText.ts`); image placements from the operator list, pixels cropped from the rendered page; written by `ooxml.ts`. |
| PDF → XLSX | `pdf-to-excel` | PDF.js text → rows and column bands (`pdfTables.ts`), numbers parsed; written by `ooxml.ts`. |
| PDF → PPTX | `pdf-to-powerpoint` | Rendered pages as JPEG slides; written by `ooxml.ts`. |

### Library survey (batch 2)

| Need | Considered | Chosen | Why |
|------|-----------|--------|-----|
| DOCX layout | docx-preview, mammoth | docx-preview | Keeps styles, page size, margins, page breaks, headers/footers; depends only on JSZip. mammoth gives bare semantic HTML (no styles or pages). |
| XLSX reading | SheetJS, ExcelJS, read-excel-file, own reader | Own reader | SheetJS's npm release (0.18.5) has open advisories and its fixed builds are only on its CDN (unreachable here); ExcelJS is 21 MB unpacked with Node dependencies; read-excel-file reads values without formats or styles. |
| HTML/DOM → PDF | jsPDF `html()`, html2canvas, own engine | Own engine (`domToPdf.ts`) | html2canvas rasterises (no selectable text) and needs network access for resources; the browser's own layout plus measured drawing keeps text real and needs no dependency. |
| Writing DOCX/XLSX/PPTX | docx, exceljs, pptxgenjs, own writer | Own writer (`ooxml.ts`) | Only a small subset of each format is needed; `docx` is 20 MB unpacked, pptxgenjs pulls Node modules. JSZip is already a dependency. |

### What was verified (batch 2)

- Unit tests (`tests/unit/office.test.ts`): Excel number/date formats (including scientific, currency,
  thousands scaling, 1900/1904 systems), CSS counters and list styles, CSS sanitising, Office/HTML
  sniffing, pagination, table detection (left-to-right and right-to-left), number parsing, the
  lam-alef and bullet repairs, and the structure of generated DOCX/XLSX/PPTX packages.
- Browser tests (`tests/e2e/office.spec.ts`, Chromium, under the privacy guard): each conversion end to
  end with content checks on the output (text per page, page count and size, numbers and formats in the
  workbook XML, slides and media in the deck), Arabic documents and sheets, a rejected legacy `.doc`,
  a PDF without text, and that HTML input can't restyle the app.
- Compared visually against LibreOffice's rendering of the same fixtures (report, Arabic document,
  workbook); generated Office files opened with python-docx, openpyxl, python-pptx and converted by
  LibreOffice (local QA, not in CI).
- WCAG AA (axe) on all six new pages, English and Arabic, light and dark.
- Fixtures: `scripts/make-office-fixtures.py` (python-docx, openpyxl, LibreOffice).

Not verified: Microsoft Word, Excel or PowerPoint themselves (not available here), Firefox/Safari,
very large documents, and DOCX features beyond the fixtures (text boxes, columns, charts, equations).

### Known limits (batch 2)

- Word → PDF: fonts that aren't installed are substituted, so line breaks may differ from Word;
  Word's "contextual spacing" is applied only between items of the same list; headers and footers
  are the ones for the whole section (first-page/odd-even variants are as docx-preview renders them).
- Excel → PDF: charts, images, conditional formatting, comments, print areas and manual page breaks
  are not read; text overflowing into empty neighbouring cells is shown, but `####` for numbers that
  don't fit is not imitated.
- PDF → Word: tables become separate lines of text; fonts, colours and exact spacing are not carried.
- PDF → Excel: tables whose columns don't line up, cells spanning columns and wrapped cell text are
  not detected.
- PDF → PowerPoint: slides are pictures.
