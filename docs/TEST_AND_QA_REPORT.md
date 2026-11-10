# FreePDF 1.0.0: test and QA report

All results below were executed on 2026-11-11 in the release build environment: 2 vCPU Intel Xeon
@ 2.1 GHz, 8 GB RAM, Linux, Node 22.23.4, Chromium 153 (headless), WebKitGTK 2.52 (MiniBrowser under
Xvfb). Nothing here is simulated or hand-edited. What wasn't executed is listed as such.

## 1. Summary

| Suite | Command | Result |
|-------|---------|--------|
| Clean install | `npm ci` in a fresh `git clone` | ✅ lockfile in sync; install succeeds unchanged |
| TypeScript | `npm run typecheck` | ✅ pass |
| Lint | `oxlint src tests qa scripts` | ✅ 0 errors, 0 warnings |
| Unit / integration (Vitest, `CI=1`: qpdf mandatory) | `npm test` | ✅ **110 / 110** (12 files) |
| Production build | `npm run build` | ✅ pass; homepage JS 97.5 KB gzipped; `dist/` 6.8 MB, 264 files |
| Browser, Chromium, 5 profiles (`CI=1`: flaky = fail) | `npm run test:e2e` | ✅ **180 passed, 1 skipped**: desktop 72 (1 skip: the real-404 test, Cloudflare-only) · tablet-android 31 · android-midrange 31 · mobile 31 · narrow-320 16 |
| Browser, inside Cloudflare's Pages runtime | `npm run test:cloudflare` | ✅ **72 / 72** |
| Real-world QA, inside the Cloudflare runtime (strict validators) | `npm run qa:cloudflare` | ✅ **30 / 30** ([QA_REPORT.md](QA_REPORT.md)) |
| WebKit engine (WebKitGTK 2.52 via WebDriver) | `node qa/webkitgtk-smoke.mjs` | ✅ **10 / 10** on `vite preview`; ✅ **10 / 10** on the Cloudflare runtime over HTTPS with the full production CSP |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities |
| Playwright Firefox / WebKit / iPad / iPhone SE projects | `ALL_BROWSERS=1 npm run test:e2e` | ⛔ **BLOCKED**: downloads refused by the sandbox network policy. Runs in CI (`cross-engine`). |
| Firefox in any form | — | ⛔ **BLOCKED**: no package source reachable |
| Safari (macOS / iOS), physical devices | manual | ⚪ **NOT TESTED**: no hardware |
| Live production URL | manual | ⛔ **BLOCKED**: Cloudflare is not reachable from the build environment; nothing was deployed |

Device profiles are Chromium **emulations** (Galaxy Tab S4, Galaxy A55, Pixel 7, Galaxy S9+ at 320 px).
WebKitGTK is the WebKit engine on Linux, not Safari.

## 2. WebKit engine results (`qa/webkitgtk-smoke.mjs`, Cloudflare runtime, HTTPS)

| Check | Result |
|-------|--------|
| All 13 routes render (English) | ✅ |
| Arabic: `dir=rtl`, `lang=ar`, translated heading ("دمج PDF") | ✅ |
| Merge 2 PDFs | ✅ 12 pages, qpdf ok |
| Rotate 180° | ✅ 8 pages all at 180°, qpdf ok |
| Split (default ranges, ZIP) | ✅ 2 PDFs, all qpdf-valid |
| Compress (Balanced; JPEG re-encode in WebKit's canvas) | ✅ 2,126,343 → 352,235 bytes, qpdf ok |
| PDF → PNG (PDF.js rendering) | ✅ 8 PNGs |
| JPG → PDF incl. an EXIF-rotated photo | ✅ 2 pages, qpdf ok |
| Organize: thumbnails render; a PDF with an OpenAction script runs nothing (no dialog, no navigation) | ✅ |
| CSP blocks an outbound `fetch`; only documented storage keys | ✅ |

The same suite over **plain http** against the Cloudflare runtime fails to render in WebKit: the
production CSP's `upgrade-insecure-requests` makes WebKit upgrade `http://127.0.0.1` sub-resources to
https, while Chromium exempts loopback. This affects only local http testing; production is HTTPS-only.

## 3. What the automated suites check

See [TESTING.md](TESTING.md) for the full list. New in 1.0.0:

- **Embedded PDF JavaScript** (`security.spec.ts`): scripts in OpenAction, `/Names/JavaScript`, page
  `/AA` and a link action never run on Organize, Rotate or PDF→PNG: no dialog, no navigation, no
  request for a scripting engine, no external request. The QuickJS engine is absent from `dist`.
- **Console leaks**: the privacy guard fails any test whose page or worker console mentions a file name
  or carries PDF/base64 content (two new self-tests prove it catches both).
- **Route crawl** of all 13 pages in English and Arabic: no console errors, no 4xx/5xx.
- **Real 404** with `noindex` for unknown paths on the Cloudflare runtime.

## 4. Real-world QA

The 30 scenarios (153 MB file, 800 pages, password-protected, signed and certified, Arabic, corrupted
inputs, low memory, interruption, repeated runs) are in the generated [QA_REPORT.md](QA_REPORT.md).
Highlights, measured inside the Cloudflare runtime:

| Operation | Time |
|---|---|
| Compress (Balanced) 153 MB, 20 photo pages → 27.7 MB (−82%) | 5.9 s |
| Split 800 pages into 800 files | about 2 s |
| Open 800 page thumbnails | about 0.5 s |
| Render 800 pages to PNG | about 14 s |
| 20 repeated compressions, JS heap after GC | 4.3 → 4.8 MB (no leak) |

## 5. Defects found during 1.0.0 hardening

| Severity | Defect | Found by | Fix |
|----------|--------|----------|-----|
| Medium | `npm run qa` / `qa:cloudflare` exited 0 when scenarios failed | Audit (reading the script) | `qa/run.mjs` propagates failures; verified with an injected FAIL row → exit 1 |
| Medium | Validators silently skipped when qpdf/pyHanko were missing | Audit | Strict under `CI`; verified with qpdf removed from `PATH` → error |
| Medium | CI did not run the real-world QA (docs said it did) | Audit | CI `cloudflare` job runs it |
| Low | Flaky tests passed on retry in CI | Audit | `failOnFlakyTests` |
| Low | Lockfile version 0.3.0; obsolete `freepdf-phase1.zip` in the source | Audit | Synced; removed and `*.zip` ignored |
| Test-only | WebKit harness: `fetch(blob:)` is blocked by the app's own `connect-src` CSP | First WebKit run | Harness reads the Blob via `FileReader` instead (the CSP is correct) |
