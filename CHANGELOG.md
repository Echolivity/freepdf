# Changelog

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
- **Not offered:** PowerPoint to PDF (no in-browser slide renderer). Word/Excel/HTML to PDF and PDF to
  Word/Excel/PowerPoint are batch 2.

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
