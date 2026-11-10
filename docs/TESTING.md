# Testing (1.0.0)

```bash
npm run test:all                 # typecheck + lint + unit/integration + build + Chromium browser tests
ALL_BROWSERS=1 npm run test:e2e  # adds Firefox, WebKit, iPad and iPhone SE projects
npm run test:cloudflare          # desktop browser suite inside Cloudflare's Pages runtime (wrangler pages dev)
npm run qa:cloudflare            # 30-scenario real-world QA in the Pages runtime → docs/QA_REPORT.md
npm run qa                       # the same QA against `vite preview`
npm run fixtures                 # regenerate the compression-matrix and Arabic fixtures
node qa/webkitgtk-smoke.mjs      # WebKit engine via WebDriver, where Playwright's WebKit can't be installed
```

`npm run qa` / `qa:cloudflare` exit non-zero if Playwright fails **or** any recorded scenario is not
PASS (they used to report and exit 0). With `CI` set (or `QA_STRICT=1`), a missing validator (qpdf,
pyHanko) is an error rather than a silent "n/a"; the unit tests' `qpdf --check` is strict under `CI` too.

## What CI runs (`.github/workflows/ci.yml`)

Every suite runs exactly once. Any failure fails the workflow, and so does a test that only passes on
its retry (`failOnFlakyTests` in CI). Deploy runs only after all four test jobs pass and only when the
repository variable `DEPLOY_ENABLED` is `true`.

| Job | Runs | Server |
|-----|------|--------|
| `checks` | `npm ci`, `npm audit --audit-level=high`, typecheck, lint, unit/integration (with qpdf), production build | — |
| `chromium` | Playwright device projects: `tablet-android`, `android-midrange`, `mobile`, `narrow-320` (109 tests) | `vite preview` |
| `cross-engine` | Playwright `firefox`, `webkit`, `ipad-webkit`, `iphone-se-webkit` (175 tests) | `vite preview` |
| `cloudflare` | Playwright `desktop` project (72 tests) **and** the real-world QA (30 scenarios) with qpdf, pypdf strict and pyHanko validators | `wrangler pages dev` (workerd) |
| `deploy` | `wrangler pages deploy dist` | needs all of the above |

`vite preview` serves the production headers from `public/_headers`, except `upgrade-insecure-requests`
(it would break plain-http loopback testing). Cloudflare's runtime serves them unmodified.

## Results for 1.0.0 (sandbox run, 2026-11-11)

| Suite | Result |
|-------|--------|
| `npm ci` from a clean clone | ✅ lockfile in sync, installs without changes |
| TypeScript, oxlint (`src tests qa scripts`) | ✅ 0 errors, 0 warnings |
| Unit and integration (Vitest, `CI=1`) | ✅ **110 / 110** in 12 files |
| Playwright Chromium, all projects (`CI=1`, preview) | ✅ **180 passed, 1 skipped** (desktop 72 · tablet-android 31 · android-midrange 31 · mobile 31 · narrow-320 16); the skip is the real-404 test, which only applies to the Cloudflare runtime |
| `test:cloudflare` (`CI=1`) | ✅ **72 / 72** |
| `qa:cloudflare` (`CI=1`, strict validators) | ✅ **30 / 30** ([QA_REPORT.md](QA_REPORT.md)) |
| WebKitGTK 2.52 via WebDriver (`qa/webkitgtk-smoke.mjs`) | ✅ **10 / 10** on `vite preview` and ✅ **10 / 10** on Cloudflare's runtime over HTTPS (full production CSP) |
| Playwright Firefox / WebKit projects | ⛔ **BLOCKED here**: the browser downloads are refused by the sandbox's network policy. They run in CI's `cross-engine` job. |
| Firefox (any form) | ⛔ **BLOCKED here**: no Firefox package or download source is reachable. |
| `npm audit` | ✅ 0 vulnerabilities (40 production packages) |

Device projects are **emulations** (viewport, touch, pixel ratio, user agent) on the Chromium engine.
WebKitGTK is the WebKit engine on Linux, **not Safari and not iOS**. **No physical devices were used.**

## Global privacy guard: `tests/e2e/fixtures.ts`

An automatic fixture wraps **every** browser test, watches the whole browser context (pages and their
workers) from startup to teardown, and fails the test on:

- a request to another origin, or to a known analytics/tracking host;
- any non-GET request, or any request with a body, even same-origin;
- a same-origin GET outside the app's static paths, or with a query string;
- a URL that looks like it carries document data;
- CSP violations and uncaught page errors;
- **console output from pages or workers that mentions a file name (`.pdf`/`.jpg`/`.png`) or carries
  PDF/base64 content** (new in 1.0.0);
- persistent storage beyond `freepdf:theme`, `freepdf:lang` and `freepdf:recent` (tool slugs only), and
  any sessionStorage, IndexedDB, Cache Storage, service worker or cookie.

`privacy-guard.spec.ts` holds seven deliberately misbehaving tests marked `test.fail()`, so the suite
goes red if the guard stops catching any of them. `guard-coverage.test.ts` fails if a spec imports `test`
directly from `@playwright/test`. No exceptions are configured.

## Unit and integration (Vitest, Node)

| File | Covers |
|------|--------|
| `organize.test.ts` | Merge, split, extract, remove, rotate, organize; encrypted, corrupted and truncated inputs; a 500-page split |
| `structure.test.ts`, `structure-matrix.test.ts` | Form fields, bookmarks, internal/external links, annotations, embedded files, mixed page sizes, existing rotations and Arabic metadata across every tool |
| `integrity.test.ts` | Signature, certification and encryption detection (with false-positive cases); no-op operations return the original bytes; the Lossless level |
| `compress.test.ts`, `compress-matrix.test.ts` | Compression with a real JPEG encoder; level differences, report totals, never-larger output, `qpdf --check` |
| `visual.test.ts` | Render-and-compare with PDF.js |
| `images.test.ts` | Images → PDF: EXIF orientation, sizes, byte-identical JPEG embedding, corrupt images |
| `validate.test.ts` | Magic bytes, renamed files, decompression bombs, ranges, filenames (traversal, bidi, reserved, Arabic) |
| `arabic.test.ts` | Dictionary parity, plurals, bidi isolation, Arabic digits, Arabic PDF fidelity |
| `transfer.test.ts` | Worker transfer lists |
| `guard-coverage.test.ts` | Every browser spec uses the guarded fixture |

## Browser (Playwright)

| Spec | Covers |
|------|--------|
| `tools.spec.ts` | Every tool end to end with outputs re-parsed; compression report; cancel; start over; 400-page split; same-instant drops |
| `lifecycle.spec.ts` | Signed/protected PDFs flagged before processing; worker termination; object-URL release; worker crash recovery; two tabs |
| `security.spec.ts` (new) | **Embedded PDF JavaScript never runs** (OpenAction, `/Names/JavaScript`, page `/AA`, link action) on Organize, Rotate and PDF→PNG: no dialog, no navigation, no scripting-engine request, no external request; the QuickJS engine is absent from `dist`; route crawl of all 13 pages in English and Arabic with no console errors or 4xx/5xx; real 404 + `noindex` on Cloudflare |
| `arabic.spec.ts` | RTL, language toggle, untranslated-text scan, Arabic errors/digits/file names |
| `a11y.spec.ts` | axe-core WCAG 2.1 AA in both languages and themes; keyboard-only flow; focus |
| `responsive.spec.ts` | No horizontal overflow; header controls; thumbnails; low-memory limits |
| `mobile-flow.spec.ts` | A full job with mixed Arabic/English names on every device profile |
| `smoke.spec.ts` | Search, theme, every tool page, recent tools, 404 page, storage docs, clear settings, limits, per-route metadata, security headers |
| `privacy-guard.spec.ts` | The guard's own self-tests |

## Not covered or not executed

- **Firefox:** not executed anywhere yet for 1.0.0 (configured in CI).
- **Safari (macOS/iOS):** not executed. WebKitGTK and Playwright's WebKit share the engine but not
  Safari's media, memory or file-picker behaviour.
- **Physical devices:** none. Tab-killing under memory pressure is only approximated by the simulated
  worker-crash test.
- **The live production URL:** not verified from this environment (see [DEPLOYMENT.md](DEPLOYMENT.md)).
- **Appearance in other viewers** (Acrobat, Preview) isn't automated; PDF.js is the reference renderer.
