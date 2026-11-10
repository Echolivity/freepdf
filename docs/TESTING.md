# Test suite (v0.3.0)

```bash
npm run test:all                 # typecheck + lint + unit/integration + build + browser tests
ALL_BROWSERS=1 npm run test:e2e  # adds Firefox, WebKit, iPad and iPhone SE projects (CI does this)
npm run fixtures                 # regenerate the compression matrix and Arabic fixtures
```

## Results for this release (run from a fresh clone with `npm ci`)

| Suite | Result | Notes |
|-------|--------|-------|
| TypeScript (`tsc -b`) | ✅ pass | |
| Lint (`oxlint`) | ✅ 0 errors | 7 warnings (`set-state-in-effect`, `only-export-components`), stylistic and reviewed |
| Unit and integration (Vitest) | ✅ **98 / 98** in 10 files | Generated PDFs are also validated with `qpdf --check` |
| Production build | ✅ | Homepage JS 108 KB gzipped. PDF libraries load only on tool pages. |
| Browser (Playwright, Chromium engine) | ✅ **171 / 171** | desktop 62 · tablet-android 31 · android-midrange 31 · mobile (Pixel 7) 31 · narrow-320 16 |
| `npm audit` | ✅ 0 vulnerabilities | Production tree has 53 packages |
| Firefox / WebKit | ⚠️ **not run locally** | Their browser binaries can't be downloaded in the build sandbox. CI installs and runs them (`ALL_BROWSERS=1`). |

The device projects are **emulations** (viewport, touch, pixel ratio and user agent) running on the
Chromium engine. **No physical phones or tablets were used.**

## Global privacy guard: `tests/e2e/fixtures.ts`

An automatic fixture wraps **every** browser test. It watches the whole browser context, including all
pages and their workers, from startup to teardown, and fails the test on any of the following:

- a request to another origin, or to a known analytics/tracking host;
- any non-GET request, or any request with a body, including same-origin ones (CSP allows those);
- a same-origin GET outside the app's static paths, or with a query string;
- a URL that looks like it carries document data;
- CSP violations and uncaught page errors;
- persistent storage beyond `freepdf:theme` (`light`/`dark`), `freepdf:lang` (`en`/`ar`) and
  `freepdf:recent` (up to 6 tool slugs);
- any sessionStorage, IndexedDB, Cache Storage, service worker or cookie.

`privacy-guard.spec.ts` checks the guard itself: five deliberately misbehaving tests are marked
`test.fail()`, so the suite goes red if the guard ever stops catching them. `guard-coverage.test.ts` fails
if any spec imports `test` directly from `@playwright/test` instead of from the fixture. No exceptions
are configured. A justified one would be added with `allowRequests()` and recorded in the report.

## Unit and integration (Vitest, Node)

| File | Covers |
|------|--------|
| `organize.test.ts` | Merge, split, extract, remove, rotate and organize. Encrypted (user and owner password), corrupted and truncated inputs. A 500-page split. |
| `structure.test.ts`, `structure-matrix.test.ts` | Form fields and their values, bookmarks, internal and **external** links, sticky-note annotations, **embedded files**, **mixed page sizes**, existing **rotations**, and **Arabic metadata** across every tool. Merge's documented limits. **Signed** and encrypted PDFs are detected, including markers that straddle the scan's chunk boundary. A rewrite does change the signed bytes. |
| `compress.test.ts`, `compress-matrix.test.ts` | Compression with a **real JPEG encoder** (Skia via `@napi-rs/canvas`). Covers image-heavy, vector-heavy, greyscale scans, transparency, mixed colour spaces (RGB, CMYK, grey, lossless, ICC), already-compressed files and CID-font PDFs. Checks that the levels differ (sizes, resolution caps, render error budgets), that the report adds up, that output is never larger than the input, and `qpdf --check`. |
| `visual.test.ts` | Render-and-compare with PDF.js: pages from Remove, Organize and Merge are pixel-identical to the source, and PNG alpha blends correctly. |
| `images.test.ts` | Images → PDF: EXIF orientation, sizes, byte-identical JPEG embedding, corrupt images. |
| `validate.test.ts` | Magic bytes, renamed files, decompression bombs (including a JPEG frame header hidden past 64 KB), page ranges, filenames (path traversal, bidi, reserved names, Arabic). |
| `arabic.test.ts` | Dictionary parity and completeness, plurals, bidi isolation, Arabic digits, normalised search, and fidelity of Arabic PDFs. |
| `guard-coverage.test.ts` | Every browser spec uses the guarded fixture. |

## Browser (Playwright)

| Spec | Covers |
|------|--------|
| `tools.spec.ts` | Every tool end to end, with outputs re-parsed. Covers the compression report (skipped transparency and CMYK), cancel, start over, a 400-page split while the UI stays responsive, and same-instant double drops. |
| `lifecycle.spec.ts` | **Signed and protected PDFs are flagged before processing.** Workers are terminated after success, cancel and repeated runs. Object URLs are released (previews immediately, downloads within 30 s). A worker crash (as in out-of-memory) is reported and the app recovers. Two tabs process at once. Closing a tab mid-job leaves other tabs working. |
| `arabic.spec.ts` | RTL by default, a persisted language toggle, a scan for untranslated text, Arabic engine errors, Arabic digits, and Arabic file names in downloads. |
| `a11y.spec.ts` | axe-core WCAG 2.1 AA (including contrast) on key screens in English and Arabic, light and dark. Keyboard-only flow (skip link, file picker), visible focus, results heading focused, real radio groups. |
| `responsive.spec.ts` | No horizontal overflow on any page in either language. Header controls reachable. Thumbnail controls fit. Low-memory devices get the lower limits, and oversized files are refused up front. |
| `mobile-flow.spec.ts` | A full job with mixed Arabic/English file names on every device profile. |
| `smoke.spec.ts` | Search, theme, every tool page, recent tools, 404, documented storage, the clear-settings button, limits messaging, tool info and FAQ, per-route HTML metadata, and **security headers**. |
| `privacy-guard.spec.ts` | The guard catches what it should (see above). |

## Not covered or not executed

- **Firefox and WebKit:** configured for CI, but not executed in this release's local run (see above).
- **Physical devices:** none. Real low-memory behaviour, such as an iOS Safari tab being killed, is
  only approximated by the simulated worker-crash test.
- **Signatures:** the test checks that output bytes differ from the signed bytes; signature validity
  itself isn't checked in CI. An external check with pyHanko during development confirmed that a
  rotated signed PDF reports `intact: False`.
- **Pixel-exact appearance in other viewers** (Acrobat, Preview) isn't automated; PDF.js is the
  reference renderer.
