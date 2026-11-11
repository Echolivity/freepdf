# Security and privacy controls (1.2.0)

## Threat model in one paragraph

Users drop sensitive documents: contracts, IDs, medical and financial records. The main risk is that
those bytes, their file names or their metadata leave the device or persist on it. Secondary risks:
- hostile files that crash or exhaust the tab (decompression bombs, malformed PDFs);
- silently damaging a document: broken signatures, lost structure, degraded quality without notice;
- supply-chain code adding tracking.

There is no server-side attack surface: the deployment is static files only.

## Controls

| Risk | Control | Evidence |
|------|---------|----------|
| Document bytes sent anywhere | All processing happens in the tab (Web Workers, PDF.js, Canvas). There's no upload code and the host has no upload endpoint. | The global privacy guard on every browser test and on the QA run fails on any external, non-GET, body-carrying, query-string or unexpected-path request. 7 deliberate-violation self-tests. |
| Third-party / tracking code | CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. Fonts are self-hosted, and there's no CDN. | Header test in the suite. A scan of the built bundle finds no fetched external URL (only XML namespaces, licence text and library error-documentation strings). |
| Leaks through URLs | The app never puts data in URLs: no query strings, and routes are tool names. Downloads use `blob:` URLs. | The guard fails on any same-origin request with a query string or data-like path. |
| Leaks through storage | Exactly 3 localStorage keys (`freepdf:theme`, `freepdf:lang`, `freepdf:recent` holding tool slugs only). No cookies, sessionStorage, IndexedDB, Cache Storage or service worker. | The guard validates keys **and values** after every test. A self-test proves that a file name written into `recent` is caught. |
| Leaks through logs | No `console.log` in the app. On a failed job, the only thing logged is the error *class name* (`useJob.ts`). | The privacy guard fails any browser test whose page **or worker** console mentions a file name (`.pdf`/`.jpg`/`.png`) or carries PDF/base64 content, across the whole suite and the QA run (self-tests included). |
| Leftover temporary data | A fresh worker per job, terminated afterwards. Preview object URLs are revoked on unmount or Start over; download URLs 30 s after the click. | `lifecycle.spec.ts` instruments `Worker` and `URL.createObjectURL`. QA M4: 20 repeated runs, heap flat (4.2 MB → 4.8 MB). |
| Inputs that aren't what they claim | Magic-byte detection (`%PDF-`, JPEG, PNG, WebP). Names and MIME types are ignored. | Unit tests + QA (PNG renamed to `.pdf` is rejected). |
| Decompression bombs | Image dimensions are read from headers, including a full JPEG marker walk, and rejected above 100 MP before decoding. They're re-checked after decoding. | Unit tests (forged PNG, JPEG frame header hidden past 64 KB). |
| Memory exhaustion | Device-aware size limits, shown before processing. Inputs are moved (not copied) to the worker. Canvases are capped at 16k px per side and 60 MP (24 MP on constrained devices). | QA: a 153 MB file is processed on desktop and refused up front on a 2 GB device. |
| Malformed PDFs | Parsing runs in a worker. Errors become user-facing messages naming the file, and recoverable damage (lost xref) is rebuilt. | QA corrupted-input matrix. |
| Executing document scripts | PDF.js scripting is not enabled, and its QuickJS sandbox **is not shipped at all**. XFA is disabled. | `security.spec.ts`: a PDF with JavaScript in OpenAction, `/Names/JavaScript`, a page `/AA` and a link action is rendered and processed on Organize, Rotate and PDF→PNG in Chromium, and on Organize in WebKitGTK: no dialog, navigation, scripting-engine request or external request. The test also asserts no `quickjs`/`sandbox` file exists in `dist`. |
| Breaking digital signatures | Signed and certified files are detected before processing and warned about. No-op operations return the original bytes. | QA G1–G4 with pyHanko validation. |
| Silent quality loss | The Lossless level never touches pixels. Lossy levels are labelled "Lossy", and a per-file report lists what was re-encoded and what was skipped. | Compression matrix tests, QA L1/L2. |
| Clickjacking / embedding | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, COOP and CORP `same-origin`. | Header test. |
| Supply chain | Lockfile with `npm ci`. `npm audit --audit-level=high` in CI. Dependabot. | `npm audit`: 0 vulnerabilities (all dependencies, including dev). 40 production packages. |
| Unauthorised or untested deploys | CI deploys only when the `DEPLOY_ENABLED=true` variable is set **and** secrets exist, and only after the checks, Chromium, cross-engine and Cloudflare-runtime jobs all pass. | `ci.yml`. |

## Unreleased: conversion batch 2

| Area | Control |
|------|---------|
| Network | No new requests. Office and HTML files are laid out in an off-screen element in the page; the CSP (`connect-src`/`img-src`/`font-src`/`frame-src`) still applies to anything in them. |
| HTML input | Parsed with `DOMParser` (nothing runs), then rebuilt from an allowlist of elements and attributes. Dropped: scripts, frames, objects, forms, links, `<base>`, `<meta>`, media, SVG/MathML, every `on*` handler and `href`. Only `data:` images are kept; `url()` in CSS (other than `data:` images), `@import`, `expression()`, `behavior`, `-moz-binding` are removed, and fixed positioning is neutralised. The result is placed in a **shadow root**, so its CSS can't restyle or overlay the app. |
| Word input | docx-preview builds DOM nodes itself (no HTML strings from the document). Embedded HTML ("altChunk"), which it would put in an iframe, is disabled; comments and tracked changes are not rendered. Pictures are `data:` URLs. Unreadable archives become a clear error. |
| Excel input | Parsed with JSZip and `DOMParser` as XML; cell text is HTML-escaped when the table is built. A workbook with more than 250,000 cells to print is refused. |
| Office output | Written by FreePDF: every piece of text is XML-escaped and characters XML can't carry are dropped; no macros, external relationships or embedded objects are ever written. Verified with python-docx, openpyxl, python-pptx and LibreOffice (local QA). |
| Dependency | `docx-preview` 0.4.1 (Apache-2.0; its only dependency, JSZip, is already used). `npm audit`: 0 vulnerabilities. |

## Unreleased: conversion batch 1

| Area | Control |
|------|---------|
| Network | No new requests. The TIFF decoder and TXT layout code are same-origin script chunks loaded on demand. The CSP is unchanged. |
| TIFF input | Decoded in the worker with utif2, one page at a time. Each page's size is checked against the 100-megapixel limit from its header **before** its pixels are decoded. Malformed files and decoder exceptions become a clear error. TIFF and text files are never put into an `<img>` (the file list shows a type tile instead). |
| Text input | Recognised by name *and* content (no NUL bytes, almost no control characters, or a UTF-16 byte-order mark); binary data named `.txt` is rejected before processing. Control characters are dropped, and output is capped at 20,000 pages. |
| HTML export | Every piece of PDF text is HTML-escaped. The file contains no script and carries its own `Content-Security-Policy` (`default-src 'none'; img-src data:; style-src 'unsafe-inline'`), so it can't load anything from the network when opened. Page images are embedded as `data:` URLs. |
| WebP export | The encoded blob's type is checked: a browser that silently falls back to PNG raises an error instead of producing a mislabelled `.webp`. |
| Dependency | `utif2` 4.1.0 (MIT; its dependency pako is already used). `npm audit`: 0 vulnerabilities. |

## 1.2.0 additions

| Area | Control |
|------|---------|
| New network request | The worker fetches `/pdfjs/fonts/<version>/IBMPlexSansArabic-*.ttf`, a same-origin GET with no document data, only when text outside the standard fonts is drawn. The privacy guard allows exactly this path pattern, and nothing else changed. The CSP is unchanged (`connect-src 'self'`). |
| Crop | Only the CropBox changes. The UI and the FAQ state that hidden content is not removed, and point to redaction. Minimum page size is enforced. |
| Page numbers, watermark | Drawn as new self-contained content streams. The original streams aren't parsed or rewritten. Image watermarks go through pdf-lib's PNG/JPEG embedders, and decoding errors become a clear error. Text sizes, opacity and page indices are validated in the worker. |
| Organize | Inserted PDFs go through the same validation and limits as any input. They're copied page by page, and their catalogs (scripts, forms, bookmarks) aren't merged. Duplicated pages share content but not widgets or pop-ups. |
| Dependency | `@pdf-lib/fontkit` 1.1.1 (MIT), loaded only in the worker. `npm audit`: 0 vulnerabilities. |

## 1.1.0 additions

| Area | Control |
|------|---------|
| Resize PDF | Pure geometry on the existing content: a `cm` matrix and a clip are wrapped around the original content streams, and annotation rectangles and page boxes are transformed. No content is decoded, rasterised or re-encoded, so untrusted content isn't interpreted beyond what pdf-lib already parses. Page sizes are bounded (1 inch to 200 inches); margins that leave no room are rejected. Runs in the per-job worker. |
| Compare PDF | Read-only. PDF.js extracts text and renders pages (no scripting, as everywhere). Word ids, not text, are sent to a per-job worker for the diff. Its memory is bounded: exact LCS only up to 4 M cells per gap, and Myers up to 2,000 edits, otherwise the gap is reported as replaced. Canvases are released after use. The report is built from JPEG page images through the existing image-to-PDF path. |
| Tests | Both tools run under the global privacy guard (no request may leave the origin or carry document data) in every browser test and in the QA run. |

## Findings of the 1.0.0 release audit

| Severity | Finding | Status |
|----------|---------|--------|
| Medium | The real-world QA scripts (`npm run qa`, `qa:cloudflare`) exited 0 even when scenarios failed (`playwright …; node report`), so a QA failure could not fail CI. | **Fixed:** `qa/run.mjs` returns Playwright's exit code and fails if any recorded scenario isn't PASS. Verified with an injected failing row (exit 1). |
| Medium | Validators silently degraded to "n/a" (QA: qpdf, pyHanko; unit tests: qpdf) when a tool was missing, so a misconfigured runner would pass with weaker checks. | **Fixed:** strict under `CI`/`QA_STRICT=1`. Verified: with qpdf removed from `PATH`, the validator throws. |
| Medium | CI never ran the real-world QA, while the rc.1 release notes said it did. | **Fixed:** CI's `cloudflare` job runs it with all validators; the rc.1 notes carry a correction. |
| Low | A test that failed once and passed on retry counted as green in CI. | **Fixed:** `failOnFlakyTests` in CI. |
| Low | `package-lock.json` still said 0.3.0. | **Fixed:** synced (version fields only, no dependency changes). |
| Low | The rc.1 source archive contained an obsolete nested archive (`freepdf-phase1.zip`, 2.7 MB of Phase 1 source). It held no secrets or personal data. | **Fixed:** removed from the repository; `*.zip` is git-ignored; release archives are inspected. |
| Info | Console output and embedded PDF JavaScript were protected by design but not tested. | **Added tests** (see the table above). |

## Findings of the 1.0.0-rc.1 audit (all fixed in rc.1)

| Severity | Finding | Status |
|----------|---------|--------|
| Medium | Extracting all pages, a no-change organize, or a whole-document "split" rewrote the file, invalidating signatures for no reason. | **Fixed:** identity operations return the original bytes (QA G3, pyHanko intact). |
| Medium | Signature detection matched the bare word `/ByteRange` (false positives on text; no certification awareness). | **Fixed:** structural patterns, a separate certified (DocMDP) warning, empty signature fields not flagged, encryption declared in xref streams detected. |
| Medium | No way to compress without quality loss. "Light" was still lossy. | **Fixed:** new **Lossless** level; lossy levels labelled. |
| Medium | Each job held two or three copies of its input in memory (read, clone into worker, PDF.js copy). | **Fixed:** buffers are transferred, not cloned. |
| Medium | Local runtime state (`.wrangler/`) was accidentally committed during this work. | **Fixed before release:** removed and git-ignored. Release archives are checked. |
| Low | The PDF.js QuickJS sandbox (for document JavaScript) was shipped although never used. | **Fixed:** not shipped. |
| Low | PDF.js data files couldn't be cached long-term (unversioned path). | **Fixed:** versioned path, immutable caching. |
| Low | Obsolete `interest-cohort` in `Permissions-Policy` (causes console warnings). | **Fixed.** |
| Low | The Arabic dictionary was in every visitor's bundle and in the worker. | **Fixed:** loaded on demand. Homepage JS went from about 108.9 to 99.7 KB gzipped; the worker is 37 KB smaller. |
| Low | 9 lint warnings (state set inside effects; mixed component/hook modules; an unused import). | **Fixed:** 0 warnings, by refactoring rather than suppression. |

## Open items (1.2.0)

| Severity | Item | Status |
|----------|------|--------|
| High (coverage) | Firefox has not been executed for 1.2.0, and Playwright's WebKit build was not runnable in the release sandbox. The WebKit **engine** passed 14/14 via WebKitGTK (on Cloudflare's runtime, full CSP). | **Gate:** CI's `cross-engine` job must be green before tagging. |
| Medium (coverage) | No physical-device or real Safari testing. | Manual checklist in `RELEASE_CHECKLIST.md`. |
| Low | pdf-lib 1.17.1 is unmaintained (no known vulnerabilities). | Accepted risk; monitor. |
| Low | Signature dictionaries inside compressed object streams wouldn't be detected (signing tools practically never do this). | Documented. |
| Info | Output can keep the input's embedded JavaScript actions where the document catalog is preserved (e.g. Rotate; Merge drops them). FreePDF never runs them; whichever viewer opens the output decides. | Documented; unchanged from the input. |

No critical or high-severity security vulnerabilities are known. The open High item is test coverage,
not a known vulnerability.

## Reporting a security issue

Open a private security advisory on the GitHub repository (Security → Advisories). Please don't include
real personal documents; describe the file structure instead.
