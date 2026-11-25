# Changelog

## Unreleased — OCR

- **Added:** *OCR: make scans searchable* (`/ocr-pdf`). Scanned PDFs and photos of pages (JPG, PNG,
  WebP, TIFF) become searchable PDFs, with an invisible text layer laid over the unchanged scan, or
  text files. English, Arabic or both. Pages that already have text can be skipped. Recognition runs
  in the browser with tesseract.js 7 (Apache-2.0), self-hosted under `/ocr/<version>/` and loaded only
  when used (about 6–8 MB the first time).
- **Added:** PDF to Word, PDF to Excel and PDF to Text / HTML read scanned pages with OCR (on by default,
  English and Arabic; pages with text are read directly). Word leaves out the page-sized scan picture on
  recognised pages. PowerPoint keeps scans as picture slides.
- **Added:** *Bank statement to Excel* reads scanned statements with OCR. A misread figure breaks the
  running-balance check, so that row is highlighted; a balance OCR couldn't read is flagged too.
- **Fixed:** statement header cells split into separate words ("Value" / "Date") are recognised; an
  amount whose decimal point was read as a colon (`15,159:13`) is repaired.
- **Tests:** synthetic scans (`scripts/make-ocr-fixtures.py`), unit tests for the text layer (English,
  Arabic, rotated pages, renders identically) and OCR result conversion, browser tests for both tools.

## Unreleased — dependency updates

- **Updated:** pako 1 → 3 (Compress PDF's Flate encoder; now a named import), Vite 8.3.8,
  Playwright 1.65.1, Wrangler 4.162.0, @napi-rs/canvas 1.1.1. GitHub Actions: checkout, setup-node,
  setup-python and upload-artifact v7; cloudflare/wrangler-action v4 (installs Wrangler 4, which the
  project already uses).
- **Updated (later):** react-router-dom 7.18.6; @napi-rs/canvas 1.2.0, oxlint 1.94.0, vitest 5.1.1,
  Wrangler 4.166.0 (Wrangler now depends on Cloudflare's SDK; development tool only, not shipped).
- **Kept:** @types/node on the 24 line rather than 26, to match the Node versions the project runs on;
  Dependabot now skips major `@types/node` bumps.
- **CI:** the picomatch advisory exception is removed: npm no longer reports it.
- **Tests:** checks that pako's output is standard zlib data, as PDF FlateDecode streams need.

## Unreleased — Bank statement to Excel

- **Added:** *Bank statement to Excel* (`/bank-statement-to-excel`). Reads the transaction table of a
  text PDF statement in the browser (English or Arabic headers; separate debit/credit or one signed
  amount column; wrapped descriptions; tables across pages; newest-first statements) and saves Excel
  (real dates and amounts, a Check column, a summary sheet), CSV (UTF-8 with BOM, formula-safe) or
  OFX 1.0.2. Every row is checked against the running balance; rows that don't add up are highlighted
  with the expected balance.
- **Tests:** synthetic statements (`scripts/make-statement-fixtures.py`: English, Arabic, signed and
  newest-first), unit tests for parsing and exports, browser tests for all three formats. OFX output
  was read back with `ofxparse`; workbooks were opened in LibreOffice.

## Unreleased — PDF to Word tables, editable PowerPoint text

- **Added:** PDF to PowerPoint makes editable slides by default: one text box per paragraph or table
  cell (Arial, colour sampled from the page) over the page drawn without its text. **Pictures** keeps
  the exact page pictures. Pages with no visible text (scans, OCR layers) and rotated pages stay pictures.
- **Added:** PDF to Word rebuilds tables as real Word tables (header row, end-aligned numbers,
  right-to-left tables), with an option to turn it off. The result note counts the tables.
- **Fixed:** a header and values that don't overlap horizontally no longer split one column into two
  (PDF to Word and PDF to Excel).
- **CI:** `npm audit` runs through `scripts/audit.mjs`, which accepts only listed advisories with a
  reason and an expiry date. Accepted until 2026-12-31: GHSA-fc5q-39xc-vjpf (picomatch ReDoS; no fixed
  release exists; reached only through build tools, not shipped). Firefox blocks deploys again.
- **Tests:** fixed the Firefox CI crash in the accessibility sweep (five axe rules crash
  Playwright's Firefox partway through it; they're disabled in Firefox only and still run in Chromium). The sweep waits for
  visible thumbnails to finish rendering. The cancel test holds its job so it can't finish first.

## Unreleased — PDF conversion, batch 2

See [docs/PLAN_conversion.md](docs/PLAN_conversion.md).

- **Added:**
  - Word to PDF (`/word-to-pdf`): docx-preview lays the document out, FreePDF draws it into PDF as
    real text; Word's page size, margins, page breaks, headers and footers are used.
  - Excel to PDF (`/excel-to-pdf`): a new XLSX reader (number/date formats, fonts, fills, borders,
    alignment, merged cells, hidden rows/columns, right-to-left sheets); fit to width, gridlines.
  - HTML to PDF (`/html-to-pdf`): allowlist sanitiser; nothing external is ever loaded.
  - PDF to Word (`/pdf-to-word`), PDF to Excel (`/pdf-to-excel`), PDF to PowerPoint
    (`/pdf-to-powerpoint`): Office files written directly (no library).
- **Layout engine:** `domToPdf` turns a laid-out DOM into PDF pages: words at measured positions
  (squeezed to measured widths), backgrounds, borders, images; pages cut between lines; running headers
  and footers; list markers and CSS counters made real.
- **Text extraction:** Symbol-font bullets, swapped lam-alef ligatures, list items and table rows.
- **Validation:** `.docx`/`.xlsx`/`.html` recognised; old `.doc`/`.xls` and password-protected Office
  files refused with an explanation.
- **Dependency:** `docx-preview` 0.4.1 (Apache-2.0), loaded only by Word to PDF.

## Unreleased — PDF conversion, batch 1

See [docs/PLAN_conversion.md](docs/PLAN_conversion.md).

- **Added:**
  - TIFF to PDF (`/tiff-to-pdf`): single and multi-page TIFF, CCITT Group 3/4, LZW, PackBits,
    Deflate and JPEG compression, placed at the file's own resolution; lossless or smaller (JPG)
    colour pages. TIFF is also accepted by JPG to PDF and PNG to PDF.
  - TXT to PDF (`/txt-to-pdf`): word wrapping, sans/serif/monospace, size, page size, orientation,
    margins; UTF-8, UTF-16, Windows-1252 and Windows-1256; Arabic lines right-aligned with the
    embedded Arabic + Latin font; characters no font covers are reported.
  - PDF to WebP (`/pdf-to-webp`): feature-detected; browsers without a WebP encoder (Safari) get an
    explanation instead of a mislabelled PNG.
  - PDF to TXT (`/pdf-to-txt`): lines or paragraphs, page markers, LF/CRLF.
  - PDF to HTML (`/pdf-to-html`): flowing text or exact layout; one self-contained file with no
    scripts and a strict CSP.
- **Upgraded:** PDF to JPG/PNG: page ranges (one range for every file in a batch).
- **Text extraction:** lines rebuilt from positions; Arabic presentation forms and visually stored
  runs put back into reading order; numbers inside right-to-left lines kept left-to-right.
- **Shared code:** `usePdfPasswords` (password prompts for read-only PDF tools), `PageRangeField`,
  `batchPages`.
- **Dependency:** `utif2` 4.1.0 (MIT), loaded only when a TIFF is converted.
- **Not offered:** PowerPoint to PDF (no in-browser slide renderer).

## 1.2.0 — 2026-11-11 (Phase 1: core document utilities)

See [docs/RELEASE_NOTES_v1.2.0.md](docs/RELEASE_NOTES_v1.2.0.md).

- **Added:**
  - Crop PDF.
  - Add page numbers.
  - Watermark PDF (text or image, tiled, over or under the content).
- **Upgraded:**
  - Extract (`/extract-pdf`): odd/even/invert, separate PDFs, every page.
  - Delete (`/delete-pages`): undo/redo, result preview.
  - Organize: touch-friendly pointer drag, duplicate, insert from other PDFs, bulk actions, download
    selected, undo/redo, preview.
- **Addresses:** `/extract-pages` and `/remove-pages` (including their trailing-slash and `.html`
  forms) 301-redirect, plus an in-app redirect and recent-tools migration.
- **Home:** Organize / Edit / Convert / Optimize / Advanced categories with filter chips.
- **Shared code:**
  - visual-space page geometry;
  - `useHistory` (undo/redo with keyboard shortcuts);
  - result `PreviewDialog`;
  - WYSIWYG `LivePreview`;
  - text drawing with bidi runs;
  - embedded IBM Plex Sans Arabic (OFL), shaped with `@pdf-lib/fontkit`.
- **Organize engine:** `arrangePages` handles multiple sources and duplicates in place. Duplicates share
  content; widgets aren't duplicated.
- **Privacy guard:** now allows exactly the self-hosted font path (GET only).
- **Tests:**
  - unit: 22 new;
  - browser: 13 new, including touch drag on every device profile and axe checks on the new screens;
  - real-world QA: 6 new;
  - WebKitGTK: 2 new.
- **Fixed during development:**
  - inserted pages could be appended at the end instead of after the selection (state-updater race);
  - the range field could be rewritten while typing during undo/redo syncing.

## 1.1.0 — 2026-11-11 (Resize PDF, Compare PDF)

See [docs/RELEASE_NOTES_v1.1.0.md](docs/RELEASE_NOTES_v1.1.0.md).

- **Added: Resize PDF** (`/resize-pdf`).
  - Sizes: A4, Letter, A3, A5, Legal or a custom size.
  - Modes: fit page, fit width, or change the paper only.
  - Orientation: per page, or forced.
  - Scope: all pages or selected pages, with a live preview.
  - Implemented in place: a transformation matrix is applied, and annotations and page boxes are moved with it. Nothing is rasterised.
- **Added: Compare PDF** (`/compare-pdf`).
  - Word-level text diff: patience diff with an exact-LCS / Myers fallback, run in a worker, with Arabic-aware normalisation.
  - Highlighted side-by-side view.
  - Pixel-difference overlay with an adjustable tolerance.
  - Visual check of every page.
  - PDF report of changed pages.
- **Home page:** a new "Review" category.
- **Tests:**
  - Unit: 24 new tests for resize and compare, including a property test of the diff.
  - Browser: 8 new tests (EN/AR, mobile, accessibility).
  - Real-world QA: 5 new scenarios (153 MB and 800-page resize, signed warning, 800-page compare, visual check).
  - `qa/screenshots.mjs`.
- **Fixed (QA harness):** the corrupted-input scenarios could branch before asynchronous file validation finished, and then wait until the test timed out.

## 1.0.0 — 2026-11-11 (stable; release hardening)

See [docs/RELEASE_NOTES_v1.0.0.md](docs/RELEASE_NOTES_v1.0.0.md) and
[docs/TEST_AND_QA_REPORT.md](docs/TEST_AND_QA_REPORT.md). The app's behaviour is unchanged from rc.1.

- **Fixed (release pipeline):**
  - `npm run qa` / `qa:cloudflare` exited 0 when QA scenarios failed;
  - QA and unit-test validators (qpdf, pyHanko) were silently skipped when missing; now mandatory in CI;
  - CI didn't run the real-world QA (the rc.1 notes said it did; corrected);
  - CI accepted tests that only passed on retry;
  - `package-lock.json` version out of sync;
  - obsolete `freepdf-phase1.zip` in the source tree (removed; `*.zip` ignored).
- **CI:** split into `checks`, `chromium`, `cross-engine` and `cloudflare` jobs, each suite run once;
  deploy needs all of them.
- **Tests added:**
  - embedded PDF JavaScript never executes;
  - console leak detection in the privacy guard, with 2 new self-tests;
  - a route crawl in EN/AR;
  - a real 404 on Cloudflare;
  - a WebKitGTK WebDriver smoke suite.
- **Docs:** TESTING, SECURITY, PRIVACY, DEPLOYMENT, RELEASE_CHECKLIST and README brought in line with CI
  and with 1.0.0.

## 1.0.0-rc.1 — 2026-11-10 (production release candidate)

See [docs/RELEASE_NOTES_v1.0.0-rc.1.md](docs/RELEASE_NOTES_v1.0.0-rc.1.md),
[docs/TEST_AND_QA_REPORT.md](docs/TEST_AND_QA_REPORT.md) and [docs/SECURITY.md](docs/SECURITY.md).

- **Added:**
  - Lossless compression level;
  - certified-PDF (DocMDP) warning;
  - identity operations return the original bytes;
  - `npm run test:cloudflare` and `npm run qa:cloudflare` (Cloudflare Pages runtime);
  - real-world QA harness (`npm run qa`) with independent validators;
  - `docs/DEPLOYMENT.md` and `docs/SECURITY.md`.
- **Fixed:**
  - needless rewrites breaking signatures;
  - imprecise signature/encryption detection;
  - double/triple input copies in memory;
  - 9 lint warnings (now 0);
  - accidentally committed `.wrangler/` state.
- **Security:**
  - PDF.js QuickJS sandbox no longer shipped;
  - obsolete `interest-cohort` removed;
  - versioned, immutable PDF.js assets;
  - bundle scanned for external hosts;
  - CI runs the suite inside the Pages runtime.
- **Performance:** Arabic dictionary loaded on demand (homepage JS about 108.9 → 99.7 KB gzipped; worker −37 KB).

## 0.3.0 — 2026-11-10 (engineering hardening)

See [docs/RELEASE_NOTES_v0.3.0.md](docs/RELEASE_NOTES_v0.3.0.md) for the full notes and
[docs/AUDIT_v0.3.0.md](docs/AUDIT_v0.3.0.md) for the findings table.

- **Fixed:**
  - silent invalidation of signed PDFs (now flagged before processing);
  - lossless images with chained filters weren't compressed;
  - merge dropped document info;
  - the language button's accessible name;
  - misleading "No limits" copy;
  - undocumented `freepdf:lang` key.
- **Security:**
  - a global privacy guard on every browser test, self-tested;
  - a tighter CSP (no `blob:`/`data:` workers or connections) plus CORP;
  - a header regression test;
  - `npm audit` in CI;
  - Dependabot;
  - deploys gated by `DEPLOY_ENABLED`.
- **Reliability:**
  - a compression report with skip reasons;
  - real-encoder compression matrix tests;
  - structure matrix tests (annotations, external links, attachments, mixed sizes, metadata);
  - lifecycle, cancel, crash-recovery and concurrency tests.
- **Product:**
  - new landing message;
  - formats, limits, privacy and FAQ on each tool page;
  - limits table and storage table with a clear button on the privacy page;
  - per-route SEO metadata, canonical/sitemap when `SITE_URL` is set, and robots.txt.
- **Testing:**
  - 98 unit/integration tests;
  - 171 browser tests across 5 emulated device profiles;
  - axe-core WCAG AA checks in EN and AR, light and dark;
  - Firefox and WebKit projects for CI.

## 0.2.0 — 2026-11-10 (Phase 2, part 1: Arabic)

### Added
- **Full Arabic interface** with right-to-left layout.
  - Language switch in the header. The choice is remembered, and Arabic-language browsers get Arabic
    by default.
  - The language and direction are applied before the first paint, so there's no flash.
  - Every message is translated: interface, validation, page-range errors, and the errors and progress
    sent from the processing worker. Messages travel as keys and are translated on screen.
- **Arabic plurals:** all six forms (zero, one, two, few, many, other) via `Intl.PluralRules`.
- **Arabic typefaces:** Readex Pro for headings and IBM Plex Sans Arabic for body text. They're
  self-hosted and only the Arabic subset loads, and only when Arabic text is on screen. Letter-spacing
  is disabled for Arabic so the cursive joins stay intact.
- **Layout mirroring:** direction-aware CSS (logical properties) throughout. Direction icons are
  mirrored: back links, and "move earlier / later" on page thumbnails.
- **Mixed-direction text:** file names and sizes are isolated so mixed Arabic/Latin text displays in
  the correct order.
- **Arabic input:** page ranges accept Arabic-Indic and Persian digits, the Arabic comma and dash
  variants (`١-٢، ٥`).
- **Bilingual search:** every tool is found from either language, with Arabic normalisation (hamza
  forms, tāʾ marbūṭa, diacritics).

### Tests
- **Dictionary checks:** the Arabic dictionary has the same keys as English, no empty strings, and
  keeps every placeholder.
- **Arabic PDF fixture** (`arabic.pdf`, shaped by Chromium with an embedded Arabic font):
  - Remove, Extract, Organize and Merge outputs render pixel-identical to the source pages.
  - Arabic text remains extractable.
- **Arabic E2E on desktop and mobile:**
  - The page defaults to RTL for Arabic browsers, and the language toggle is persisted.
  - Arabic search works.
  - Engine errors arrive in Arabic.
  - Arabic digits work in Split.
  - Arabic file names survive into downloads.
  - Mirrored controls still move pages in reading order.
  - An untranslated-text scan covers whole pages.

## 0.1.1 — 2026-11-10 (audit fixes)

### Fixed
- **Remove, Extract, Organize, and Splits of 40 or fewer parts** now edit the original document's page tree
  instead of copying pages into a new file. Remaining form fields, bookmarks, links, metadata and
  attachments are kept. Fields, bookmarks, links and named destinations that pointed at removed pages
  are pruned, and removed pages are dropped from the file.
- **Compress** no longer re-encodes images with a soft mask (transparency) or CMYK JPEGs. Pixels are
  decoded without colour-space conversion, so ICC-based images keep their meaning.
- **Rapid successive file drops** can no longer lose an earlier batch.
- **JPEG size check:** dimensions are found even when metadata pushes the frame header past 64 KB.
  JPEGs without a readable size are rejected. Decoded images are re-checked before a canvas is created.

### Changed
- **Privacy wording** is now precise: CSP blocks third-party origins, and same-origin uploads are
  prevented by design and caught by tests, not by CSP.
- **Lower size limits** on phones and low-memory devices, and a warning before large jobs.
- **Merge, and Splits of more than 40 parts,** state that bookmarks and fillable fields are not
  carried over.
- **Compress** says plainly that image re-encoding is lossy at every level.
- **Upload screens** link to "How it works". HSTS header added.

### Tests
- **New:** structure-fidelity fixtures, render-and-compare visual tests (Node + PDF.js), compressed
  output visual check, same-instant double-drop race, hidden JPEG bomb, Arabic filenames, and soft-mask
  safety.
- **Network guard:** E2E now also fails on same-origin non-GET requests or requests with a body.

## 0.1.0 — 2026-11-10
- Phase 1: Merge, Split, Extract, Remove, Organize, Rotate, Compress, JPG/PNG→PDF, PDF→JPG/PNG.
