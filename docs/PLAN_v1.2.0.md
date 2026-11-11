# v1.1.0 and Phase 1 (v1.2.0): technical implementation plan

Status: **plan only, nothing implemented yet.** Based on an inspection of the 1.0.0 codebase (commit `7d29d33`).

## 1. What already exists

| Area | Current state | Reuse for Phase 1 |
|------|---------------|-------------------|
| Tool registration | `src/tools/registry.ts`: one `ToolDef` per slug with lazy component, category and EN/AR keywords. The home page, search, per-route HTML (`vite.config.ts` → `staticRoutes`) and sitemap are all generated from it. | Add new tools here only. |
| Processing | One worker (`src/workers/pdf.worker.ts`), started fresh per job by `runInWorker`, with ops `merge`, `split`, `extract`, `remove`, `rotate`, `organize`, `compress`, `imagesToPdf`, `pageCount`. Transfers rather than copies its inputs. | New ops go into the same worker. No second engine. |
| Structure preservation | `src/lib/pdf/structure.ts` rebuilds the page tree **in place**, pruning fields, outlines, links and named destinations that point at removed pages. Operations that change nothing return the original bytes. | Crop, Delete, Extract and Organize sit on top of this. |
| Rendering | PDF.js 6.5 (`src/lib/render/pdfjs.ts`), with lazy thumbnails (`thumbs.tsx`, `PageGrid`). | Previews for every tool. |
| Page grid | `PageGrid` has a `select` mode (Extract, Remove) and an `organize` mode (HTML5 drag, rotate, delete). | Extend it rather than writing a second grid. |
| Job shell | `ToolFrame`, `useFiles`, `useJob` (progress, cancel, errors), `JobPanels` (downloads, ZIP), `validateFiles` (magic bytes, limits). | Consistent behaviour comes for free. |
| i18n | `en.ts` is the source of truth; `ar.ts` loads lazily; a unit test enforces key parity and plural forms. | Every new string goes into both. |
| Tests | Vitest with qpdf, PDF.js render-compare and a structure matrix. Playwright on 5 device profiles plus Firefox/WebKit in CI, under the global privacy guard. Real-world QA with qpdf, pypdf and pyHanko. | Every tool gets unit, browser and QA coverage. |

### Gaps the inspection found

- **Organize** has no duplicate, insert, extract-selected, undo/redo or final preview.
- **Reordering** uses HTML5 drag, which doesn't work on touchscreens, so phones fall back to buttons. The fix is pointer-event reordering.
- **Extract** has no odd/even selection and no "separate PDFs" or "every page" output (Split covers part of the latter).
- **Remove** has no undo or result preview.
- **Text on pages:** pdf-lib only has the 14 standard fonts, which are WinAnsi-encoded and can't draw Arabic or Arabic-Indic digits. Writing Arabic needs `@pdf-lib/fontkit` and an embedded font that covers both Arabic and Latin. The self-hosted Fontsource files are WOFF2 split by script, so one of these needs to be added.
- **Home page:** four categories (organize, optimize, convert-to, convert-from). The spec asks for seven. A filter is needed so the page doesn't show every tool at once.

## 2. Decisions (agreed 2026-11-11)

1. **v1.1.0 is built first.** Resize PDF and Compare PDF ship as v1.1.0, then this phase as v1.2.0.
   The original v1.1.0 specification is not in this repository; the proposed scope is below, pending
   confirmation.
2. **Upgrade in place, new URLs canonical.** Extract → `/extract-pdf`, Remove → `/delete-pages`
   (Organize keeps `/organize-pdf`). `/extract-pages` and `/remove-pages` 301-redirect via
   `public/_redirects`. Tests check the redirects on the Cloudflare runtime.

### v1.1.0 proposed scope (to confirm)

| Tool | Approach |
|------|----------|
| **Resize PDF** `/resize-pdf` | Target size (A3, A4, A5, Letter, Legal or custom, either orientation), all or selected pages. Modes: **scale to fit** (uniform scale, centred, optional margins), **fit width**, or **change the canvas without scaling** (pad or trim). Implemented in place: the MediaBox/CropBox change and a `cm` transform are prepended to each page's content, and annotation and link rectangles are transformed to match. Pages are never rasterised or re-embedded, so text, links, fields and annotations keep working. |
| **Compare PDF** `/compare-pdf` | Two PDFs, page by page. A **text comparison** of PDF.js-extracted words, with an Arabic-aware normaliser and insertions and deletions highlighted. A **visual comparison** renders both pages and shows a pixel-difference overlay with a tolerance setting. A summary lists the changed pages. Both files are read-only. The output is an on-screen report, with an optional PDF report of the changed pages. All of it is local. |

## 3. Shared work (done first)

| Item | Detail |
|------|--------|
| `PageGrid` | Pointer-event reordering, so it works on touch, mouse and keyboard. Multi-select with range and shift-select, plus "odd", "even" and "invert" selection. Undo/redo through a small `useHistory` hook that the grid tools share. |
| Page overlay layer | `lib/pdf/overlay.ts`: draws text or images onto chosen pages with position, alignment, rotation, opacity and tiling. It writes a **new content stream wrapped in `q … Q`**, so the original content stays untouched. Page numbers, Watermark and later Bates numbering all use it. |
| Text and fonts | `@pdf-lib/fontkit` (new dependency), loaded only in the worker and only when needed. Latin-only text uses the standard fonts, so nothing extra is embedded. Arabic text and Arabic-Indic digits embed a **subset** of a self-hosted OFL Arabic+Latin font. Spike: confirm that fontkit's Arabic shaping plus pdf-lib produces correctly joined, correctly ordered RTL text, checked with pypdf and pdftotext extraction. If it doesn't, add HarfBuzz (`harfbuzzjs`, WASM, lazy-loaded) for shaping. **Arabic text won't be rasterised.** |
| Page geometry | One helper that respects `/Rotate`, MediaBox and CropBox origins, so crop boxes, overlays and previews agree on rotated and offset pages. |
| Preview | A `PreviewPane` renders the *output* with PDF.js before download, with a page stepper. Crop, Delete, Organize, Page numbers and Watermark use it. |
| Home page | Seven categories (Organize, Edit, Convert, Security, Optimize, Advanced, AI). Only categories that have working tools are shown, plus category filter chips alongside the existing search. No placeholders. |

## 4. Tools

| Tool | Approach | Integrity guarantees |
|------|----------|---------------------|
| **Crop** `/crop-pdf` | A crop rectangle drawn on a PDF.js render, with drag handles and numeric fields (mm, inch, pt). Applies to all pages, selected pages, or per page. Writes `/CropBox`, plus `/TrimBox` where present, in-place. | Content isn't removed: the UI and the result both say "hidden, not deleted", and point to Redact (Phase 2) for confidential content. Text, links and fields are untouched. |
| **Extract** `/extract-pdf` | Upgrades Extract with odd/even/range/thumbnail selection. Output is one PDF, one PDF per selected page, or every page separately (ZIP). | Same pruning as today. Byte-identical original when the selection is everything. |
| **Delete** `/delete-pages` | Upgrades Remove with undo/redo of the selection, a result preview and range input. | Original order kept; the structure is pruned in place. |
| **Organize** `/organize-pdf` | Adds duplicate, insert pages from another PDF (copied with their resources), extract selected, undo/redo and a final preview. | Duplicates share resources rather than copying them. Inserted pages bring their own links and annotations; the inserted document's form fields and bookmarks are **not** merged, as with Merge today, and the tool says so. |
| **Page numbers** `/add-page-numbers` | Header or footer, left/centre/right, start number, prefix and suffix, font size and colour, page selection, skip cover, Roman numerals (I–MMMMCMXCIX), Western or Arabic-Indic digits. | Overlay only; original content streams aren't modified. Text stays selectable and extractable. Mirrored for RTL documents when chosen. |
| **Watermark** `/watermark-pdf` | Text (EN/AR) or an image (PNG/JPG, with transparency kept), position grid or custom, rotation, opacity via ExtGState, font and size, tiled mode, page selection. | Vector text, and the image is embedded once and reused. Pages aren't rasterised. The result is a removable visual layer, not tamper protection, and the tool says so. |

## 5. Testing (per tool, all executed before reporting)

- **Unit (Vitest, real fixtures):**
  - output validated with qpdf and pypdf strict;
  - page count and dimensions, including rotated, offset-MediaBox and mixed sizes;
  - text extraction before and after, with EN and AR overlay text extracted correctly;
  - images byte-identical, fonts still embedded;
  - annotations, forms and links preserved;
  - encrypted input rejected with a clear message;
  - malformed input handled;
  - an 800-page document;
  - render-compare showing the original content is unchanged under overlays.
- **Browser (Playwright, privacy guard on):**
  - every tool end to end in EN and AR;
  - mobile touch reorder and crop-handle dragging;
  - axe accessibility checks;
  - no overflow at 320 px;
  - Firefox/WebKit in CI.
- **QA harness:** new scenarios for each tool on large, Arabic, signed (with a warning), protected and corrupted inputs.
- **Network:** the existing guard already fails any request carrying document data. A dedicated test runs every Phase 1 tool and asserts that only static same-origin GETs happened during processing.
- **Screenshots:** desktop and mobile, EN and AR, for the completion report.

## 6. Order of work

0. **v1.1.0:** shared geometry helper, then Resize, then Compare, with the full regression and a v1.1.0 report. Then stop.
1. Shared foundation: geometry, PageGrid upgrades, history, preview, home-page categories.
2. Delete, then Extract, then Organize, the upgrades with the lowest risk.
3. Crop.
4. Overlay layer and the font spike, then Page numbers, then Watermark.
5. Full regression, the Cloudflare-runtime suites, QA, inspection of the generated PDFs, docs, the v1.2.0 completion report. Then stop.

## 7. Scope decisions for later phases (agreed 2026-11-11)

- **PDF to PDF/A (v1.4): dropped.** Proper validation needs veraPDF, which doesn't run in the browser.
- **AI tools (v2.0): dropped.** That covers Chat, Summarize, Translate, Table extraction and Document intelligence.
- **OCR (v1.4), kept in its original place (decided 2026-11-11):** English first. Arabic OCR is tested
  separately later, and isn't advertised until it has been measured. Intended approach:
  - Tesseract.js 7 (Apache-2.0) in a worker, self-hosted to satisfy the CSP, and loaded only on the
    OCR route: about 2.9 MB for the engine and 3 MB for English, gzipped; Arabic data about 1.7 MB.
  - An invisible text layer is added over the unchanged page images; a text-only extraction option is
    offered too.
  - The Arabic text layer depends on the font embedding built in Phase 1.
- **Redact (v1.3):** true removal needs content-stream rewriting. Expect "can't guarantee" warnings on some structures.
