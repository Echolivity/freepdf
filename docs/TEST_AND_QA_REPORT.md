# FreePDF 1.1.0: test and QA report

Executed on 2026-11-11 in the release build environment: 2 vCPU Intel Xeon @ 2.1 GHz, 8 GB RAM, Linux,
Node 22.23.4, Chromium 153 (headless), WebKitGTK 2.52 (MiniBrowser under Xvfb). Nothing here is
simulated or hand-edited. What wasn't executed is listed as such. The 1.0.0 report is in Git history.

## 1. Summary

| Suite | Command | Result |
|-------|---------|--------|
| TypeScript, lint | `npm run typecheck`, `oxlint src tests qa scripts` | ✅ 0 errors, 0 warnings |
| Unit / integration (`CI=1`, qpdf mandatory) | `npm test` | ✅ **135 / 135** (14 files) |
| Production build | `npm run build` | ✅ homepage JS 99.6 KB gzipped; Resize UI 2.8 KB, Compare UI 5.7 KB; `dist/` 7.3 MB, 269 files |
| Browser, Chromium, 5 profiles (`CI=1`, flaky = fail) | `npm run test:e2e` | ✅ **192 passed, 1 skipped**: desktop 80 (1 Cloudflare-only skip) · tablet-android 32 · android-midrange 32 · mobile 32 · narrow-320 17 |
| Browser inside Cloudflare's Pages runtime | `npm run test:cloudflare` | ✅ **80 / 80** |
| Real-world QA inside the Cloudflare runtime (strict) | `npm run qa:cloudflare` | ✅ **35 / 35** ([QA_REPORT.md](QA_REPORT.md)) |
| WebKit engine, Cloudflare runtime over HTTPS | `node qa/webkitgtk-smoke.mjs` | ✅ **12 / 12**, Resize and Compare included |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities; no new dependencies |
| Playwright Firefox / WebKit / iPad / iPhone SE | `ALL_BROWSERS=1 npm run test:e2e` | ⛔ **BLOCKED** here (downloads refused); runs in CI `cross-engine` |
| Safari, physical devices | manual | ⚪ **NOT TESTED** |

## 2. New tools: what was verified

**Resize PDF**
- **Geometry:** fit, fit width and canvas modes, including rotated pages and offset boxes.
- **Content kept:** a document with mixed sizes and orientations keeps its text (compared page by
  page), form fields, bookmarks and annotation counts.
- **Annotations:** rectangles move by exactly the applied transformation.
- **Not rasterised:** a page rendered after resizing matches the original rendered at the matching
  zoom (mean difference < 3/255).
- **Scope and edge cases:** selected pages only; Arabic text unchanged; encrypted and broken files
  rejected clearly; 800 pages; output byte-identical when nothing needs to change.
- **QA (Cloudflare runtime):**
  - R1: 153 MB photo PDF to Letter in 0.94 s, size unchanged (images untouched).
  - R2: 800 pages to A5 in 1.4 s, with the text of page 400 verified.
  - R3: signature warning before processing.

**Compare PDF**
- **Diff correctness:** a 300-case property test through both diff paths proves the changes always
  rebuild the second document exactly.
- **Long input:** 200,000 words with three edits are diffed in well under 5 s, with no more than 6
  words reported.
- **Arabic:** presentation forms, tatweel and direction marks are ignored.
- **In the browser:** changed words get highlight boxes on the right lines; page-count and page-size
  differences are flagged; image-only PDFs fall back to the visual comparison. The overlay, the visual
  check of every page and the PDF report were all exercised; the report passes `qpdf --check` and has
  one page per changed page.
- **QA:**
  - C1: an 800-page document against a copy with 2 added words reports only page 500, in 4.5 s.
  - C2: a 153 MB file compared with itself, plus a visual check of all 20 pages, reports no
    differences in 9.8 s.

**Both tools**
- EN and AR (RTL), including Arabic file names.
- axe WCAG 2.1 AA on the Resize workspace and the Compare results, in both languages and themes.
- No horizontal overflow at 320 px; full flows on every device profile.
- The global privacy guard on every test: no external request, no document data in requests or in
  the console.

## 3. Generated PDFs inspected

- **Resize:** `rich.pdf` (A4, rotated, Letter and A5 pages, with a form field, link and note) was
  resized to Letter with a 12.7 mm margin, rendered with Poppler, and viewed.
  - All pages are Letter.
  - The rotated page keeps `/Rotate 90`.
  - The form field and note icon sit on the scaled content.
  - qpdf reports no errors.
- **Canvas mode:** the Arabic contract at A5 renders centred, clipped at the edges as expected for
  "No scaling".

## 4. Screenshots

`qa/screenshots.mjs` captures Resize, Compare (side by side) and Compare (overlay) on desktop
(1360 px) and mobile (Pixel 7) in English and Arabic. They're delivered with the release package.

## 5. Defects found during this release

| Severity | Defect | Found by | Fix |
|----------|--------|----------|-----|
| Medium | The Resize UI chunk pulled in all of pdf-lib (173 KB gzipped) on the main thread | Bundle measurement | Planner split into a pdf-lib-free module (now 2.8 KB) |
| Low | Change-list colours failed WCAG contrast | axe | Neutral text on soft red/green backgrounds |
| Low | A visual-change threshold of 0.05% missed a two-digit text change at scan resolution | Browser test | Threshold set to about 7 pixels (identical pages render identically) |
| Low | English had no "zero" form ("0 pages look different.") | QA C2 | An explicit `zero` form is used for 0 in every language |
| Low | "Already A4" files stored as 595 × 842 pt were rewritten | Unit test | Pages within 1 pt of the target are left untouched |
| Test-only | The QA corrupted-input scenarios could branch before asynchronous validation finished, and hang | QA run | Wait for a rejection or an accepted file first |
