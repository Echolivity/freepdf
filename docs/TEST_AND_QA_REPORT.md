# FreePDF 1.2.0: test and QA report (Phase 1)

Executed on 2026-11-11 in the release build environment: 2 vCPU Intel Xeon @ 2.1 GHz, 8 GB RAM, Linux,
Node 22.23.4, Chromium 153 (headless), WebKitGTK 2.52 (MiniBrowser under Xvfb). Nothing here is
simulated or hand-edited. What wasn't executed is listed as such. Earlier reports are in Git history.

## 1. Summary

| Suite | Command | Result |
|-------|---------|--------|
| TypeScript, lint | `npm run typecheck`, `oxlint src tests qa scripts` | ✅ 0 errors, 0 warnings |
| Unit / integration (`CI=1`) | `npm test` | ✅ **158 / 158** (15 files; 22 new) |
| Build | `npm run build` | ✅ homepage JS 103.0 KB gzipped; each tool UI 2.4–5.7 KB; `dist/` 8.1 MB, 283 files |
| Browser, Chromium, 5 profiles (`CI=1`) | `npm run test:e2e` | ✅ **209 passed, 1 skipped**: desktop 92 (+1 Cloudflare-only skip) · tablet-android 33 · android-midrange 33 · mobile 33 · narrow-320 18 |
| Browser inside Cloudflare's runtime | `npm run test:cloudflare` | ✅ **93 / 93** (includes the 301 redirects) |
| Real-world QA inside the Cloudflare runtime (strict) | `npm run qa:cloudflare` | ✅ **41 / 41** ([QA_REPORT.md](QA_REPORT.md)) |
| WebKit engine, Cloudflare runtime over HTTPS | `node qa/webkitgtk-smoke.mjs` | ✅ **14 / 14** |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities |
| Playwright Firefox / WebKit / iPad / iPhone SE | `ALL_BROWSERS=1 npm run test:e2e` | ⛔ **BLOCKED** here; runs in CI `cross-engine` |
| Safari, physical devices | manual | ⚪ **NOT TESTED** |

## 2. Phase 1: verification by tool

| Tool | Status | Evidence |
|------|--------|----------|
| Crop PDF | PASS | Unit tests: sizes; text still present (hidden, not removed); correct side on a `/Rotate 90` page; per-page crops; validation. Browser: mouse drag with undo, typed margins, preview, per-page crop, refusal of too-small crops, touch drag on every device profile. QA K1: 800 pages in 1.8 s. WebKitGTK: crop box exact. |
| Extract PDF pages | PASS | Browser: odd → pages 1/3/5/7; even as separate PDFs (ZIP names and contents); every page (8 files). QA E1: 400 odd pages of 800 in 0.7 s. |
| Delete PDF pages | PASS | Browser: undo and redo (buttons and Ctrl+Z / Ctrl+Shift+Z); typed ranges not rewritten mid-typing; preview count; download from the preview equals the final download. |
| Organize PDF | PASS | Unit tests: unchanged input comes back byte-identical; duplicates share content, links copied, form widget not; insert from another PDF keeps the main file's bookmarks and fields. Browser: grip drag (mouse and touch), duplicate, undo/redo, insert after the selection, bulk delete, preview, save, download selected. QA O1: 805 pages in 1.8 s with the form field and bookmarks kept. |
| Add page numbers | PASS | Unit tests: label rules (start, skip cover, selection, Roman, Arabic-Indic); centred placement; upright in the right corner of a rotated page; Arabic prefix and digits shaped, rendered and extractable; 800 pages; validation. Browser: live preview label, Roman + skip cover; Arabic UI with Arabic numerals. QA N1: "Page 800 of 800" in 2.5 s. WebKitGTK: Arabic prefix (the font is fetched by the worker). |
| Watermark PDF | PASS | Unit tests: vector text at 45°; opacity checked by pixel colour; tiling; selected pages; under an opaque scan invisible and over it visible (render-compared); PNG embedded once; Arabic text; errors. Browser: tiled/behind/selected pages; PNG image. QA W1: 153 MB scan +0.005% in 1.7 s; W2: Arabic UI, Arabic watermark and file name. |
| Home categories and filter | PASS | Browser: the Edit filter shows only Edit tools; All restores everything. Axe checks pass. |
| Old addresses | PASS | Browser: in-app redirect; on Cloudflare, a 301 from `_redirects`. |
| Privacy | PASS | The global guard runs on every browser test and the QA run. The only new request is the same-origin font GET, allowed by an exact pattern. |
| Accessibility | PASS (Chromium) | axe WCAG 2.1 AA on Crop, Page numbers, Watermark, Organize and Delete with a file loaded, in EN/AR and light/dark. |

## 3. Generated PDFs inspected

Samples were generated with the release code, checked with `qpdf --check` and `pypdf` strict (all
pass), rendered with Poppler, and viewed:
- **Page numbers:** "Page n of 4" in blue at the bottom right of every page, upright on the rotated
  page. Arabic "صفحة ١ من ٣" in bold Plex Sans, with joined letters, centred at the top.
- **Watermark:** tiled red "CONFIDENTIAL" at 30° and 25% opacity on page 1 only. The PNG sits at the
  bottom right of every page, with the page's own content unchanged.
- **Crop:** the CropBox shrinks by 40 pt on the left and 60 pt at the top, and on the rotated page the
  visual sides are honoured.
- **Organize:** Arabic page 1 is inserted first, followed by the original page 1, its duplicate rotated
  90° (form widget not duplicated), and page 3.

## 4. Screenshots

`qa/screenshots.mjs` captures Home, Crop, Page numbers, Watermark and Organize (plus Resize and
Compare), desktop and Pixel 7, in English and Arabic: 32 images, delivered with the release package.

## 5. Defects found during Phase 1

| Severity | Defect | Found by | Fix |
|----------|--------|----------|-----|
| Medium | Inserted pages could land at the end instead of after the selection: the insertion point was read inside a state updater that ran after it had been reset | Browser test | The position is read before queuing the update |
| Medium | pdf-lib's font subsetting dropped joined Arabic glyph forms, so Arabic rendered as blanks | Font spike | The font is embedded whole (≈100 KB per output that uses it) |
| Low | Mixed Arabic and digits would have been reversed ("صفحة 3 من 10") | Unit test | Directional runs in visual order |
| Low | The undo/redo sync could rewrite the range field while it was being typed | Browser test | The sync skips selections that came from typing |
| Low | The privacy guard (correctly) flagged the new font request | Browser test | Exact path pattern allowed; GET only |
| Test-only | Crop drags off-screen at a 720 px viewport; second file input index | Browser test | Scroll into view; use the last input |
