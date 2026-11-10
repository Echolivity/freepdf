# FreePDF

**Private PDF tools. Your files stay on your device.**

FreePDF is a set of PDF tools that runs entirely in your browser. Files are read, processed and handed
back to you on your own device, and they are never uploaded. There's no account, no subscription, no
daily quota, no watermark and no advertising. The site is plain static files, so it costs almost nothing
to host, which is how it can stay free.

Version **1.0.0-rc.1** (release candidate). Further reading:

- [Release notes](docs/RELEASE_NOTES_v1.0.0-rc.1.md)
- [Test and QA report](docs/TEST_AND_QA_REPORT.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Security](docs/SECURITY.md)
- [Privacy](docs/PRIVACY.md)
- [Changelog](CHANGELOG.md)

## Tools available today

| Tool | What it does | Good to know |
|------|--------------|--------------|
| Merge PDF | Combine PDFs in the order you choose | Keeps page content, links and annotations, plus the first file's title and author. Bookmarks, fillable form fields and attachments are **not** merged yet. |
| Split PDF | Custom ranges (`1-3, 5, 8-`, Arabic digits accepted), every page, or every N pages | Splits into 40 parts or fewer keep each part's bookmarks, fields and links. Larger splits keep page content only. |
| Extract pages | Pick pages from thumbnails or by range | Bookmarks and links pointing at pages you leave out are removed. |
| Remove pages | Delete pages | Remaining fields, bookmarks, links, metadata and attachments are kept. Anything pointing at removed pages is cleaned up. |
| Organize PDF | Reorder, rotate and delete individual pages | The document is edited in place, so its structure is preserved. |
| Rotate PDF | Rotate every page of one or more PDFs | Adds to the existing rotation. Lossless. |
| Compress PDF | **Lossless**: repacks without touching images. **Light / Balanced / Strong** (lossy): re-encode photos and scans. | A per-file report lists what was re-encoded and what was skipped, and why. Transparent, CMYK and special-colour images are never re-encoded. Vector content is never rasterised. You get the original back if nothing can be saved. |
| JPG / PNG to PDF | JPG, PNG or WebP to one PDF, or one PDF per image | JPGs are embedded byte-for-byte, PNG transparency is kept, and phone-photo orientation is honoured. |
| PDF to JPG / PNG | One image per page at 72, 150 or 300 DPI | Password-protected PDFs can be opened here with their password. |

Tools that rewrite a PDF **warn before processing** when a file is digitally signed or certified, because
any change makes the signature invalid. They also warn when a file is password-protected and they can't
open it. Operations that change nothing return your original file untouched, so its signature stays
valid.

Planned tools (watermarks, page numbers, password protection and more) are listed in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). They are **not** available yet and aren't shown in the app.

## Free, with technical safety limits

There's no payment, no subscription and no daily or monthly quota. There **are** technical limits.
Everything is processed in your browser's memory, and a PDF can briefly need several times its file
size, so these limits stop a large job from crashing the tab. They are shown on every upload screen
and on the "How it works" page.

| Limit | Computers | Phones / low-memory devices* |
|-------|-----------|------------------------------|
| One file | 250 MB | 100 MB |
| One job (all files together) | 600 MB | 200 MB |
| Files per job | 200 | 200 |
| Image size | 100 megapixels | 100 megapixels |

\* A device counts as constrained when the browser reports 4 GB of memory or less, or, where the
browser doesn't report memory, when it has a touch-first (coarse) pointer. The limits live in
`src/config.ts`.

## Privacy

**Your documents never leave the browser tab.** In detail:

- **Processing:** pdf-lib runs in a fresh Web Worker for each job, and the worker is terminated
  afterwards. PDF.js renders pages, and Canvas/OffscreenCanvas handle images.
- **Network:**
  - **Third-party origins:** the CSP in `public/_headers` restricts connections to the site itself
    (`connect-src 'self'`) and forbids remote scripts, frames and plugins.
  - **The site's own origin:** CSP can't block this. Instead, the app never sends file data, and the
    static host has no endpoint that accepts uploads.
  - **Enforcement:** a global test guard enforces all of this on every browser test (see Testing).
- **Retention:** results are in-memory Blobs only. Previews are released immediately on "Start over".
  Download links are released 30 seconds after the download starts. Closing the tab frees everything.

**What is stored in the browser** (localStorage, on this device only, never sent anywhere):

| Key | Value | Written when |
|-----|-------|--------------|
| `freepdf:theme` | `light` or `dark` | You use the theme button |
| `freepdf:lang` | `en` or `ar` | You use the language button |
| `freepdf:recent` | JSON list of up to 6 **tool slugs** (e.g. `["merge-pdf"]`), never file names | You open a tool |

Nothing else is stored: no cookies, sessionStorage, IndexedDB, Cache Storage or service worker. The
"How it works" page lists these keys and has a button that clears them, and the home page can clear
the recent list. The full policy is in [docs/PRIVACY.md](docs/PRIVACY.md).

## Languages

English and Arabic. The Arabic interface is fully right-to-left, and Arabic-language browsers get it by
default. Strings live in `src/i18n/en.ts` (the source of truth) and `src/i18n/ar.ts`. The build fails if
a translation is missing, and a unit test checks that placeholders match. Numbers use Western digits;
page-range input also accepts Arabic-Indic digits.

## Browser support

The app needs Web Workers, OffscreenCanvas and ES2022, which means current versions of Chrome, Edge,
Firefox and Safari (Safari 16.4 or later). See [Testing](#testing) for which engines were actually
tested in this release.

## Development

Requires Node 22.13+.

```bash
npm ci
npm run dev          # http://localhost:5173
npm run build        # → dist/   (set SITE_URL=https://your.domain for canonical links + sitemap)
npm run preview      # serves dist/ with the production security headers
```

## Testing

```bash
npm test                 # unit/integration (Vitest, Node): processing, compression, structure, i18n
npm run test:e2e         # browser (Playwright): every tool, Arabic, a11y, lifecycle, responsive, headers
npm run test:all         # typecheck + lint + unit + build + e2e
npm run test:cloudflare  # browser suite inside Cloudflare's Pages runtime (wrangler pages dev)
npm run qa               # real-world QA: >100 MB, 800 pages, protected, signed, Arabic, corrupted… → docs/QA_REPORT.md
npm run qa:cloudflare    # the same QA inside the Cloudflare runtime
ALL_BROWSERS=1 npm run test:e2e   # also Firefox + WebKit (needs: npx playwright install firefox webkit)
```

Results for this release are in [docs/TEST_AND_QA_REPORT.md](docs/TEST_AND_QA_REPORT.md):
- 109 unit tests;
- 172 browser tests on 5 device profiles;
- 63 inside the Cloudflare runtime;
- 30 real-world QA scenarios.

All passed. Firefox, WebKit and physical devices were **not** executed in the build environment.

- **Privacy guard:** an automatic fixture (`tests/e2e/fixtures.ts`) wraps **every** browser test. The
  test fails if any of these happens:
  - a request leaves the origin;
  - a non-GET request, or a request with a body;
  - an unexpected path or query string;
  - analytics hosts, CSP violations or uncaught page errors;
  - storage beyond the three documented keys.

  A unit test makes sure no spec can bypass the guard.
- **Real output checks:** generated PDFs are checked with `qpdf --check` (when installed),
  re-rendered and pixel-compared, and compression uses a real JPEG encoder in Node.
- Details and the list of what is *not* covered are in [docs/TESTING.md](docs/TESTING.md).

## Deployment (Cloudflare, free plan)

The full guide is [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short:

The site is static. It uses no Workers code, KV, D1 or R2. The largest file is about 1.3 MB, against a
25 MiB limit. Every route is emitted as its own HTML file, so deep links work on Cloudflare Pages,
Workers static assets / Cloudflare Drop and any other static host.

- **Quickest:** go to <https://cloudflare.com/drop>, drop the contents of `dist/` (or a ZIP of them),
  then **Claim** the site into your account.
- **Pages dashboard:** in **Workers & Pages**, create an application, choose to upload your own files,
  and upload `dist/`.
- **CI (GitHub Actions):** `.github/workflows/ci.yml` runs the full test suite (Chromium, Firefox,
  WebKit) and `npm audit`. It deploys **only** when the repository variable `DEPLOY_ENABLED=true` is set,
  together with the secrets `CLOUDFLARE_API_TOKEN` (Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID`.
  Optional variables:
  - `CF_PAGES_PROJECT` (default `freepdf`)
  - `SITE_URL`, the public address, for canonical links and the sitemap
- **Custom domain:** in your Cloudflare project, go to **Custom domains** and add the domain. Once it
  serves HTTPS, the `Strict-Transport-Security` header from `_headers` takes effect.

Before releasing, follow [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). Keep Cloudflare Web
Analytics **off**: it injects a third-party script that the CSP would block, and it would contradict the
privacy policy.

## Licence

MIT. Third-party code:
- pdf-lib (MIT)
- PDF.js (Apache-2.0)
- JSZip (MIT/GPLv3, used under MIT)
- pako (MIT)
- React (MIT)

Fonts (all SIL OFL): Bricolage Grotesque, Atkinson Hyperlegible Next, Readex Pro, IBM Plex Sans Arabic.
