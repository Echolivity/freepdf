# v0.3.0 engineering audit: findings and resolutions

Baseline before changes (v0.2.0, commit `b448b06`): 67 unit tests and 42 browser tests passing,
`npm audit` 0 vulnerabilities, build OK.

Each finding was checked against the source before it was fixed.

| # | Finding | Verified? | Resolution | Files |
|---|---------|-----------|------------|-------|
| 1 | Network/privacy checks were opt-in per test | **Verified.** `guardPage()` was called in only 12 of the 30 browser tests (18 had no network or storage checks). | Added an automatic Playwright fixture covering every test: external origins, non-GET, bodies, unexpected paths and query strings, data in URLs, trackers, CSP violations, page errors, storage. It is self-tested with `test.fail()`, and a unit test prevents bypass. | `tests/e2e/fixtures.ts`, `tests/e2e/privacy-guard.spec.ts`, `tests/unit/guard-coverage.test.ts`, all specs |
| 2 | Storage documentation inconsistent | **Verified.** README, ARCHITECTURE and TESTING said only "theme + recent", but `freepdf:lang` is also written. The in-app page was correct. | All docs list the 3 keys exactly. The privacy page shows a key table and a "Clear these settings" button. The guard validates keys **and values**: recent may hold slugs only, never file names. | `README.md`, `docs/PRIVACY.md`, `docs/ARCHITECTURE.md`, `src/app/Privacy.tsx`, `src/app/prefs.ts` |
| 3 | Misleading "no limits" wording | **Verified.** The footer said "No limits" and ARCHITECTURE said "free, no limits". | Wording now distinguishes "no subscription / no daily quotas" from technical limits. The full limits table (both profiles) is on the privacy page and in the README. Upload screens show the per-file **and** per-job limits before processing. Tool pages state the limits for this device. | `src/i18n/*.ts`, `src/app/Privacy.tsx`, `src/components/Dropzone.tsx`, `src/app/ToolAbout.tsx` |
| 4 | Compression must report skipped content honestly | **Verified gap.** Only "images recompressed" was counted, and skip reasons were invisible. | `CompressReport` now records images found, re-encoded, skipped by reason (transparency, colour space, kept lossless, small, encoding, no gain, decode failure), streams deflated and objects removed. The report is shown per file. | `src/lib/pdf/compress.ts`, `src/tools/compress/CompressTool.tsx` |
| 5 | Lossless images inside filter chains were never compressed | **Found during this audit** (fixture analysis). `[/ASCII85Decode /FlateDecode]` images, as written by ReportLab, were skipped. | A general lossless decoder now handles any transport chain, with per-filter `DecodeParms`. | `src/lib/pdf/compress.ts` |
| 6 | Compression tests used a stand-in encoder | **Verified.** | Added a real Skia JPEG encoder for Node, and a fixture matrix of 7 document types with size, resolution, render-error and structure assertions. | `tests/unit/node-codec.ts`, `tests/unit/compress-matrix.test.ts`, `scripts/make-compress-fixtures.py` |
| 7 | Digital signatures could be invalidated silently | **Verified.** Any rewrite invalidates a signature, and there was no warning. Confirmed with pyHanko: after Rotate, `intact: False`. | A streaming pre-check flags signed and encrypted PDFs **before processing**. Tools that rewrite PDFs show a clear warning; the read-only PDF→image tool doesn't. | `src/lib/inspect.ts`, `src/lib/validate.ts`, `src/components/FileList.tsx` |
| 8 | Structural features under-tested | **Verified.** Annotations, external links, attachments, mixed sizes and metadata had no tests. | Added the `rich.pdf` and `signed.pdf` fixtures and a structure matrix across all tools. Merge now carries the first file's title, author, subject and keywords (before, it dropped them). | `tests/unit/structure-matrix.test.ts`, `scripts/make-structure-fixtures.py`, `src/lib/pdf/core.ts`, `src/lib/pdf/organize.ts` |
| 9 | Worker and object-URL lifecycle untested | **Verified.** | Instrumented tests cover worker termination (success, cancel, repeat), URL release, crash recovery, concurrent tabs, and tab closure mid-job. | `tests/e2e/lifecycle.spec.ts` |
| 10 | Cross-browser and device coverage | **Partly verified.** Only desktop Chromium and a Pixel 7 profile were tested. | Added tablet, mid-range Android and 320 px profiles. Firefox, WebKit, iPad and iPhone SE projects run in CI. They **couldn't run locally**: the browsers can't be downloaded in the sandbox. | `playwright.config.ts`, `.github/workflows/ci.yml` |
| 11 | Accessibility | **Real issue found by axe.** The language button's accessible name didn't contain its visible text (WCAG 2.5.3). | Fixed, and axe now runs in both languages and both themes on key screens, alongside keyboard and focus tests. | `src/app/Layout.tsx`, `tests/e2e/a11y.spec.ts` |
| 12 | CSP broader than needed | **Verified.** `worker-src blob:` and `connect-src blob: data:` were unused. | Removed; the full suite passes with the tighter policy. Added `Cross-Origin-Resource-Policy`. A header test locks the policy in. | `public/_headers`, `tests/e2e/smoke.spec.ts` |
| 13 | Landing and tool pages lacked context and SEO | **Verified.** | New identity copy. Each tool page now has accepted formats, output, limits, privacy and a FAQ, in both languages. Every route gets static per-route title, description and Open Graph tags; canonical links and the sitemap are added when `SITE_URL` is set; robots.txt always; `noindex` on 404. | `src/app/ToolAbout.tsx`, `src/app/seo.ts`, `vite.config.ts`, `index.html` |
| 14 | CI could deploy without explicit approval | **Verified.** It deployed on every push to `main`. | Deployment now also requires the repository variable `DEPLOY_ENABLED=true`. CI runs `npm audit --audit-level=high`. Dependabot is configured. | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| 15 | An empty Arabic plural form | **Found by the dictionary test** during this release (a regression introduced while adding the report). | Fixed. | `src/i18n/ar.ts` |

## Reviewed and left as they are (with reasons)

- **`style-src 'unsafe-inline'`:** needed for React `style` attributes, such as per-category colours and
  thumbnail rotation. It allows inline styles only, not scripts.
- **`script-src 'wasm-unsafe-eval'`:** PDF.js runs its WebAssembly decoders (JPEG 2000, colour
  management) with it. It doesn't permit JavaScript `eval`.
- **Size limits:** unchanged (250/600 MB, or 100/200 MB on constrained devices; 200 files; 100 MP).
  Testing found no reason to change them.
- **pdf-lib 1.17.1:** the latest release, unmaintained since 2021. It works and has no known
  vulnerabilities. Replacing it would be a large rewrite with no immediate benefit, so it is noted as a
  long-term risk.
