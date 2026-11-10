# Security and privacy controls (1.0.0-rc.1)

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
| Document bytes sent anywhere | All processing happens in the tab (Web Workers, PDF.js, Canvas). There's no upload code and the host has no upload endpoint. | The global privacy guard on every browser test and on the QA run fails on any external, non-GET, body-carrying, query-string or unexpected-path request. 5 deliberate-violation self-tests. |
| Third-party / tracking code | CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. Fonts are self-hosted, and there's no CDN. | Header test in the suite. A scan of the built bundle finds no fetched external URL (only XML namespaces, licence text and library error-documentation strings). |
| Leaks through URLs | The app never puts data in URLs: no query strings, and routes are tool names. Downloads use `blob:` URLs. | The guard fails on any same-origin request with a query string or data-like path. |
| Leaks through storage | Exactly 3 localStorage keys (`freepdf:theme`, `freepdf:lang`, `freepdf:recent` holding tool slugs only). No cookies, sessionStorage, IndexedDB, Cache Storage or service worker. | The guard validates keys **and values** after every test. A self-test proves that a file name written into `recent` is caught. |
| Leaks through logs | No `console.log` in the app. On a failed job, the only thing logged is the error *class name* (`useJob.ts`). | Static scan. |
| Leftover temporary data | A fresh worker per job, terminated afterwards. Preview object URLs are revoked on unmount or Start over; download URLs 30 s after the click. | `lifecycle.spec.ts` instruments `Worker` and `URL.createObjectURL`. QA M4: 20 repeated runs, heap flat (4.2 MB → 4.8 MB). |
| Inputs that aren't what they claim | Magic-byte detection (`%PDF-`, JPEG, PNG, WebP). Names and MIME types are ignored. | Unit tests + QA (PNG renamed to `.pdf` is rejected). |
| Decompression bombs | Image dimensions are read from headers, including a full JPEG marker walk, and rejected above 100 MP before decoding. They're re-checked after decoding. | Unit tests (forged PNG, JPEG frame header hidden past 64 KB). |
| Memory exhaustion | Device-aware size limits, shown before processing. Inputs are moved (not copied) to the worker. Canvases are capped at 16k px per side and 60 MP (24 MP on constrained devices). | QA: a 153 MB file is processed on desktop and refused up front on a 2 GB device. |
| Malformed PDFs | Parsing runs in a worker. Errors become user-facing messages naming the file, and recoverable damage (lost xref) is rebuilt. | QA corrupted-input matrix. |
| Executing document scripts | PDF.js scripting is not enabled, and its QuickJS sandbox **is not shipped at all**. XFA is disabled. | `scripts/copy-pdfjs-assets.mjs` excludes `quickjs-*`. |
| Breaking digital signatures | Signed and certified files are detected before processing and warned about. No-op operations return the original bytes. | QA G1–G4 with pyHanko validation. |
| Silent quality loss | The Lossless level never touches pixels. Lossy levels are labelled "Lossy", and a per-file report lists what was re-encoded and what was skipped. | Compression matrix tests, QA L1/L2. |
| Clickjacking / embedding | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, COOP and CORP `same-origin`. | Header test. |
| Supply chain | Lockfile with `npm ci`. `npm audit --audit-level=high` in CI. Dependabot. | `npm audit`: 0 vulnerabilities (all dependencies, including dev). 56 production packages. |
| Unauthorised deploys | CI deploys only when the `DEPLOY_ENABLED=true` variable is set **and** secrets exist. | `ci.yml`. |

## Findings of the 1.0.0-rc.1 audit

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
| High (open) | Firefox and WebKit have not been executed (their binaries can't be downloaded in the build environment). | **Open.** CI runs them; required before the final release. |
| Medium (open) | No physical-device testing. | **Open.** Manual checklist provided. |
| Low (open) | pdf-lib 1.17.1 is unmaintained (no known vulnerabilities). | Accepted risk. Monitor it, and consider a maintained fork. |
| Low (open) | Signature dictionaries stored inside compressed object streams wouldn't be detected (signing tools practically never do this). | Documented. |

No critical or high-severity security vulnerabilities are open. The open High item is about test
coverage (unverified browser engines), not a known vulnerability.

## Reporting a security issue

Open a private security advisory on the GitHub repository (Security → Advisories). Please don't include
real personal documents; describe the file structure instead.
