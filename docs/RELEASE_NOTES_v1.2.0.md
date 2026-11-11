# FreePDF 1.2.0: core document utilities (Phase 1)

Three new tools, Extract, Delete and Organize upgraded, and a reorganised home page. Everything still
runs in your browser: no uploads, no account, no quotas, no watermark of ours, no ads. All of it is in
English and Arabic (right-to-left).

## New tools

**Crop PDF (`/crop-pdf`)**
- **Setting the crop:** drag the edges, corners or the whole crop box (mouse, touch or keyboard), or
  type margins in millimetres.
- **Scope:** all pages, selected pages, or a different crop for each page. Undo and redo, and a preview
  of the result before downloading.
- **Rotated pages** are cropped as you see them.
- **What cropping does:** it sets the page's CropBox. Content outside the box is **hidden, not
  deleted**, and the tool says so on screen. Redaction is a separate, later tool.

**Add page numbers (`/add-page-numbers`)**
- **Placement:** header or footer; left, centre or right; distance from the edge.
- **Numbering:** start number, prefix and suffix (e.g. "Page 3 of 10"), and 1-2-3, I-II-III, i-ii-iii
  or Arabic-Indic (١-٢-٣) numerals.
- **Style:** font (Helvetica, Times, Courier or Plex Sans), bold, size and colour.
- **Scope:** selected pages; skip the cover.
- **Live preview:** made by the same code that produces the download.
- **Output:** numbers are real, searchable text on a separate layer. Pages aren't re-rendered, and on
  rotated pages the numbers stay upright in the corner you chose.

**Watermark PDF (`/watermark-pdf`)**
- **Content:** text, or a JPG/PNG image (PNG transparency is kept).
- **Layout:** one of 9 positions or tiled across the page.
- **Appearance:** rotation, opacity, font and size.
- **Layer:** over or behind the content.
- **Scope:** selected pages, with a live preview.
- **Output:** the image is embedded once for all pages, and the original content isn't touched: a tiled
  text watermark on a 153 MB scan added 0.005% to the file.
- The tool states plainly that a watermark is a visible mark, not protection.

## Upgraded tools

- **Extract PDF pages (`/extract-pdf`, was `/extract-pages`):**
  - Selection: odd, even and invert.
  - Output: one PDF, one PDF per selected page (ZIP), or every page as its own PDF.
  - Undo and redo of the selection.
- **Delete PDF pages (`/delete-pages`, was `/remove-pages`):** odd, even and invert; undo and redo; and
  a preview of the resulting document, which can be downloaded straight from the preview.
- **Organize PDF:**
  - Drag pages by a grip, which now **works on touch screens**. The arrow keys work on the grip too.
  - Duplicate pages.
  - **Insert pages from other PDFs**, after the selected page or at the end.
  - Act on several selected pages at once (rotate, duplicate, delete), or download just the selected
    pages.
  - Undo and redo (including Ctrl/Cmd+Z), and a preview of the final document.
  - The main file is still edited in place. Duplicates share the page's content, so nothing is
    duplicated in the file.
- **Old addresses keep working:** `/extract-pages` and `/remove-pages` redirect permanently (Cloudflare
  `_redirects`, plus an in-app redirect). Recent-tool lists are updated automatically.

## Home page

Tools are grouped into Organize, Edit, Convert, Optimize and Advanced tools, with category filter
chips alongside search. Categories without working tools (Security, AI) aren't shown.

## Under the hood

- **One processing engine:** all new operations run in the existing per-job worker, with the same
  validation, progress, cancel, errors and downloads.
- **Arabic text in PDFs:** Arabic, and anything outside the standard fonts, uses IBM Plex Sans Arabic
  (SIL OFL 1.1).
  - The font is self-hosted under `/pdfjs/fonts/<version>/` and fetched by the worker only when
    needed.
  - It's shaped with `@pdf-lib/fontkit` (MIT), and lines that mix Arabic and numbers are put in visual
    order with a small bidi implementation. Arabic text is never rasterised.
- **Dependencies:**
  - Runtime: `@pdf-lib/fontkit` 1.1.1. It's loaded only inside the worker, only for such text: a
    320 KB gzipped chunk, not part of any page load.
  - Dev only: `@expo-google-fonts/ibm-plex-sans-arabic` 0.4.2, the font source.
- **Shared pieces:** page geometry for rotated and offset pages, an undo/redo hook, a result-preview
  dialog, a live single-page preview, and pointer-based reordering.

## Test results

| Suite | Result |
|-------|--------|
| Unit / integration (`CI=1`) | 158 / 158; 22 new Phase 1 tests |
| Browser, 5 Chromium device profiles (`CI=1`) | 209 passed, 1 skipped (a Cloudflare-only test); 13 new, including touch-pointer dragging on every device profile |
| Browser, inside Cloudflare's Pages runtime | 93 / 93 |
| Real-world QA, inside the Cloudflare runtime (strict validators) | 41 / 41; 6 new |
| WebKit engine (WebKitGTK 2.52) inside the Cloudflare runtime over HTTPS | 14 / 14, including Page numbers (Arabic, embedded font) and Crop |
| `npm audit` | 0 vulnerabilities |
| Playwright Firefox / WebKit projects | **Not executed here**; run in CI's `cross-engine` job |
| Safari, physical devices | **Not tested** |

## Performance (inside the Cloudflare runtime, 2 vCPU build machine)

| Operation | Time |
|---|---|
| "Page n of 800" on an 800-page document | 2.5 s |
| Tiled text watermark on a 153 MB, 20-page photo PDF | 1.7 s |
| Crop 800 pages | 1.8 s |
| Extract the 400 odd pages of 800 | 0.7 s |
| Organize: duplicate a page, insert 800 pages, save (805 pages) | 1.8 s |

## Known limitations

- **Crop:** only hides content outside the box; it doesn't remove it. Crops can't leave less than
  12.7 mm on a side.
- **Arabic text you add:**
  - The first use downloads the embedded font (≈220 KB) and the shaping code (≈320 KB gzipped),
    cached afterwards.
  - Each output that uses it grows by about 100 KB, because the font is embedded whole: pdf-lib's
    subsetting breaks joined Arabic letter forms.
  - Where the font overlaps two letters, some text extractors may report them out of order. The
    rendering is correct.
- **Watermarks** can be removed by editing software.
- **Organize:**
  - Duplicated pages don't copy form-field widgets.
  - Pages inserted from other PDFs don't bring their file's bookmarks or form fields.
- **Page numbers and watermarks** are drawn on the visible page area (CropBox). Mixed-direction text
  uses a simplified bidi algorithm: it's correct for Arabic with numbers and Latin words, but not
  guaranteed for complex nesting.
