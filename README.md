<div align="center">

<img src="public/favicon.svg" alt="FreePDF logo" width="72" height="72">

# FreePDF

**Your PDFs. Your device. Your privacy.**

PDF tools that run entirely in your browser. Merge, split, organize, compress, convert and compare
PDFs without your files ever leaving your device.

[![Version 1.2.0](https://img.shields.io/badge/version-1.2.0-1f3fcf)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-131418)](#license)
[![Languages: English and Arabic](https://img.shields.io/badge/languages-English%20%7C%20%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A%D8%A9-0d7454)](#languages)
[![Privacy: no uploads](https://img.shields.io/badge/privacy-no%20uploads-0d7454)](#privacy-and-security)

[Features](#features) · [Privacy](#privacy-and-security) · [Getting started](#getting-started) · [Testing](#testing) · [Deployment](#deployment) · [Docs](#documentation)

</div>

<br>

> [!NOTE]
> There is no public deployment yet. To try FreePDF, [run it locally](#getting-started) or
> [deploy your own copy](#deployment) to Cloudflare Pages.

## Why FreePDF

Most online PDF tools upload your documents to a server. FreePDF doesn't have one to upload to: the
site is plain static files, and all the work happens on your device.

- 🔒 **Local processing.** Files are read, processed and handed back in your browser tab.
- 🚫 **No uploads.** The Content Security Policy blocks connections to other sites, and the host has
  no endpoint that accepts files.
- 👤 **No account.** No sign-up, no login, no cookies.
- 🆓 **Free and open source.** No subscription, no daily quota, no watermark, no ads. Static hosting
  costs almost nothing, which is how it stays free.
- 🌍 **English and Arabic.** Including a full right-to-left interface.

## Features

**17 tools on 21 pages**, all available today.

### Organize PDFs

| Tool                  | What it does                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Merge PDF**         | Combine PDFs in the order you choose.                                                                                                 |
| **Split PDF**         | By custom ranges (`1-3, 5, 8-`, Arabic digits accepted), every page, or every N pages.                                                |
| **Extract PDF pages** | Pick pages from thumbnails, by range, or odd/even; get one PDF, or one PDF per page.                                                  |
| **Delete PDF pages**  | Remove pages by thumbnail, range or odd/even/invert, with undo/redo and a preview.                                                    |
| **Organize PDF**      | Reorder by dragging (mouse, touch or keyboard), rotate, duplicate, delete, and insert pages from other PDFs. Undo/redo and a preview. |

### Edit and modify

| Tool                 | What it does                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Rotate PDF**       | Rotate every page of one or more PDFs, losslessly.                                                          |
| **Crop PDF**         | Drag a crop box or type margins, for all pages, selected pages or each page separately.                     |
| **Add page numbers** | Header or footer, any alignment, prefix/suffix, 1-2-3, Roman or Arabic-Indic numerals, with a live preview. |
| **Watermark PDF**    | Text or a JPG/PNG image; 9 positions or tiled; rotation and opacity; over or behind the content.            |
| **Resize PDF**       | A4, Letter, A3, A5, Legal or a custom size: fit page, fit width, or change the paper without scaling.       |

### Optimize and compress

| Tool             | What it does                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Compress PDF** | **Lossless** repacking, or **Light / Balanced / Strong** re-encoding of photos and scans, with a per-file report. |

### Convert to PDF

| Tool                        | What it does                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **JPG / PNG / TIFF to PDF** | JPG, PNG, WebP and TIFF images (including multi-page TIFF scans and faxes) to one PDF, or one PDF per image.                             |
| **TXT to PDF**              | Plain-text files to PDF with word wrapping; sans, serif or monospace font; size, page size, orientation and margins; encoding detection. |

### Convert from PDF

| Tool                        | What it does                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **PDF to JPG / PNG / WebP** | One image per page at 72, 150 or 300 DPI, with a quality setting and an optional page range.                                  |
| **PDF to TXT**              | The PDF's text as a `.txt` file: line by line or as paragraphs, optional page markers, LF or CRLF line endings.               |
| **PDF to HTML**             | A self-contained web page: **flowing text** (headings and paragraphs) or **exact layout** (page images with selectable text). |

Word, Excel, PowerPoint and HTML input, and Word, Excel and PowerPoint output, are **not available
yet**: see the [roadmap](#roadmap).

### Compare

| Tool            | What it does                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Compare PDF** | Two versions side by side: word-level text changes, a pixel-difference overlay, a visual check of every page, and a PDF report. |

<details>
<summary><b>What each tool keeps, and what it doesn't</b></summary>

<br>

| Tool                               | Good to know                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge PDF                          | Keeps page content, links and annotations, plus the first file's title and author. Bookmarks, fillable form fields and attachments are **not** merged yet.                                                                                                                                                                                                                                                                                                  |
| Split PDF                          | Splits into 40 parts or fewer keep each part's bookmarks, fields and links. Larger splits keep page content only.                                                                                                                                                                                                                                                                                                                                           |
| Extract PDF pages (`/extract-pdf`) | Bookmarks and links pointing at pages you leave out are removed.                                                                                                                                                                                                                                                                                                                                                                                            |
| Delete PDF pages (`/delete-pages`) | Remaining fields, bookmarks, links, metadata and attachments are kept. Anything pointing at removed pages is cleaned up.                                                                                                                                                                                                                                                                                                                                    |
| Organize PDF                       | The main document is edited in place, so its structure is preserved. Duplicates share the page content; form-field widgets aren't duplicated. Inserted pages keep content and links, not their file's bookmarks or fields. You can also act on a selection and download selected pages.                                                                                                                                                                     |
| Rotate PDF                         | Adds to the existing rotation.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Crop PDF                           | Sets the CropBox: content outside is hidden, **not deleted** (the tool says so). Rotated pages are cropped as you see them.                                                                                                                                                                                                                                                                                                                                 |
| Add page numbers                   | Real text on a separate layer; pages aren't re-rendered. Font, size, colour, selected pages and skipping the cover are configurable. Arabic text uses an embedded Arabic+Latin font (about 100 KB).                                                                                                                                                                                                                                                         |
| Watermark PDF                      | A separate layer, so quality is unchanged and the image is stored once. Font, size and selected pages are configurable. A watermark is a visible mark, not protection.                                                                                                                                                                                                                                                                                      |
| Resize PDF                         | Content is scaled with a transformation, never rasterised: text stays selectable, and links, form fields and annotations move with it. Internal link targets may land slightly off the exact spot on resized pages. Works on all or selected pages.                                                                                                                                                                                                         |
| Compress PDF                       | The report lists what was re-encoded and what was skipped, and why. Transparent, CMYK and special-colour images are never re-encoded. Vector content is never rasterised. You get the original back if nothing can be saved.                                                                                                                                                                                                                                |
| Compare PDF                        | Both files are only read. Pages are paired by number. Scans (no text layer) get the visual comparison only.                                                                                                                                                                                                                                                                                                                                                 |
| JPG / PNG / TIFF to PDF            | JPGs are embedded byte-for-byte, PNG transparency is kept, and phone-photo orientation is honoured. TIFF: black-and-white, greyscale, colour and palette images compressed with CCITT fax (Group 3/4), LZW, PackBits, Deflate or JPEG; each page is placed at the size its resolution states. Pages are re-encoded losslessly (PNG), or colour pages as JPG if you pick "Smaller". BigTIFF isn't supported.                                                 |
| TXT to PDF                         | UTF-8, UTF-16 (with a byte-order mark), Windows-1252 and Windows-1256. Tabs and form feeds (page breaks) are honoured. Text the chosen font can't show (such as Arabic) uses an embedded Arabic + Latin font, and Arabic lines are right-aligned. Scripts that font doesn't cover (such as Chinese) show as boxes, and the result names the characters.                                                                                                     |
| PDF to JPG / PNG / WebP            | Password-protected PDFs can be opened here with their password. WebP needs the browser's own encoder (Chrome, Edge, Firefox); where it is missing (Safari) the option is hidden and the tool says why.                                                                                                                                                                                                                                                      |
| PDF to TXT / HTML                  | They read the PDF's text layer, so scans give no text (OCR is planned). Reading order is rebuilt from positions: multi-column pages may interleave and tables become lines of text. Arabic stored as presentation forms or in visual order is put back into reading order. HTML files have no scripts, carry a strict CSP and embed page images as `data:` URLs; flowing text leaves images out. Password-protected PDFs can be opened with their password. |

Tools that rewrite a PDF **warn before processing** when a file is digitally signed or certified,
because any change makes the signature invalid. They also warn when a file is password-protected and
they can't open it. Operations that change nothing return your original file untouched, so its
signature stays valid.

</details>

## Privacy and security

**Your documents never leave the browser tab.**

| Layer                     | How it works                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Processing**            | pdf-lib runs in a fresh Web Worker for each job, and the worker is terminated afterwards. PDF.js renders pages; Canvas/OffscreenCanvas handle images.                       |
| **Third-party origins**   | The CSP in [`public/_headers`](public/_headers) restricts connections to the site itself (`connect-src 'self'`) and forbids remote scripts, frames and plugins.             |
| **The site's own origin** | CSP can't block this, so instead the app never sends file data, and the static host has no endpoint that accepts uploads.                                                   |
| **Retention**             | Results are in-memory Blobs only. Previews are released immediately on "Start over"; download links 30 seconds after the download starts. Closing the tab frees everything. |
| **Enforcement**           | A global privacy guard wraps every browser test (see [Testing](#testing)).                                                                                                  |

**External services.** The app itself uses none at runtime: fonts, the PDF.js worker and the Arabic
font used for page numbers and watermarks are all served from the site's own origin. There is no
analytics, telemetry or advertising. (The badges at the top of this README come from shields.io and
appear on GitHub only, never in the app.)

**What is stored in the browser** (localStorage, on this device only, never sent anywhere):

| Key              | Value                                                                        | Written when                |
| ---------------- | ---------------------------------------------------------------------------- | --------------------------- |
| `freepdf:theme`  | `light` or `dark`                                                            | You use the theme button    |
| `freepdf:lang`   | `en` or `ar`                                                                 | You use the language button |
| `freepdf:recent` | JSON list of up to 6 **tool slugs** (e.g. `["merge-pdf"]`), never file names | You open a tool             |

Nothing else is stored: no cookies, sessionStorage, IndexedDB, Cache Storage or service worker. The
"How it works" page lists these keys and has a button that clears them, and the home page can clear
the recent list.

Full details: [Privacy policy](docs/PRIVACY.md) · [Security](docs/SECURITY.md)

## Device requirements

FreePDF needs **Web Workers, OffscreenCanvas and ES2022**: current Chrome, Edge and Firefox, and
Safari 16.4 or later. See [Testing](#testing) for which engines were actually tested.

Everything is processed in your browser's memory, and a PDF can briefly need several times its file
size. These **technical limits** stop a large job from crashing the tab (there are no usage quotas):

| Limit                        |   Computers    | Phones and low-memory devices\* |
| ---------------------------- | :------------: | :-----------------------------: |
| One file                     |     250 MB     |             100 MB              |
| One job (all files together) |     600 MB     |             200 MB              |
| Files per job                |      200       |               200               |
| Image size                   | 100 megapixels |         100 megapixels          |

\* A device counts as constrained when the browser reports 4 GB of memory or less, or, where the
browser doesn't report memory, when it has a touch-first (coarse) pointer. The limits are shown on
every upload screen and live in [`src/config.ts`](src/config.ts).

## Languages

|                                                          | English |              العربية (Arabic)               |
| -------------------------------------------------------- | :-----: | :-----------------------------------------: |
| Full interface, including error messages                 |   ✅    |                     ✅                      |
| Right-to-left layout with mirrored direction icons       |    —    |                     ✅                      |
| Self-hosted typeface                                     |   ✅    |                     ✅                      |
| Tool search keywords                                     |   ✅    |                     ✅                      |
| Arabic text written into PDFs (page numbers, watermarks) |    —    | ✅ shaped with fontkit and an embedded font |

Arabic-language browsers get the Arabic interface by default. Strings live in
[`src/i18n/en.ts`](src/i18n/en.ts) (the source of truth) and [`src/i18n/ar.ts`](src/i18n/ar.ts). The
build fails if a translation is missing, and a unit test checks that placeholders match. Numbers use
Western digits; page-range input also accepts Arabic-Indic digits.

## Getting started

**Prerequisites:** [Node.js](https://nodejs.org/) 22.13 or later, and npm.

```bash
git clone https://github.com/Echolivity/freepdf.git
cd freepdf
npm ci
npm run dev          # http://localhost:5173
```

| Command           | What it does                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run dev`     | Development server at `http://localhost:5173`                                                          |
| `npm run build`   | Production build into `dist/` (set `SITE_URL=https://your.domain` for canonical links and the sitemap) |
| `npm run preview` | Serves `dist/` with the production security headers                                                    |

**Stack:** React, TypeScript, Vite, Tailwind CSS, pdf-lib, PDF.js and JSZip.

## Testing

### Results for 1.2.0

| Suite                                                          | Tests | Result |
| -------------------------------------------------------------- | ----: | :----: |
| Unit and integration (Vitest)                                  |   158 |   ✅   |
| Browser tests on 5 Chromium device profiles (Playwright)\*     |   209 |   ✅   |
| Browser tests inside the Cloudflare runtime                    |    93 |   ✅   |
| Real-world QA scenarios                                        |    41 |   ✅   |
| WebKit-engine checks (WebKitGTK) inside the Cloudflare runtime |    14 |   ✅   |

\* Plus 1 Cloudflare-only test, which is skipped there.

These ran in the build environment. Playwright's Firefox and WebKit projects, real Safari and physical
devices were **not** executed there. In CI, the `cross-engine` job currently runs the **Firefox**
project only; the WebKit (Safari) projects are skipped for now and can be run locally with
`ALL_BROWSERS=1`.

> [!WARNING]
> **Known issue:** in CI, Firefox's page process crashes during 4 accessibility checks on the Split PDF
> page. It is still under investigation and has not been reproduced outside CI.

### Conversion batch 1 (unreleased)

| Suite                                                                        | Tests | Result |
| ---------------------------------------------------------------------------- | ----: | :----: |
| Unit and integration, including 29 new conversion tests                      |   187 |   ✅   |
| Browser tests on 5 Chromium device profiles, including 14 conversion tests\* |   223 |   ✅   |
| Browser tests inside the Cloudflare runtime                                  |   107 |   ✅   |

\* Plus the same 1 Cloudflare-only test, skipped there. The five new pages also pass the WCAG AA
audit in both languages and themes. Firefox, Safari and physical devices were not run for this batch.

Full results: [Test and QA report](docs/TEST_AND_QA_REPORT.md) · What CI runs, job by job: [Testing guide](docs/TESTING.md)

### How quality is checked

- 🛡️ **Privacy guard.** An automatic fixture ([`tests/e2e/fixtures.ts`](tests/e2e/fixtures.ts)) wraps
  **every** browser test. The test fails if any of these happens:
  - a request leaves the origin;
  - a non-GET request, or a request with a body;
  - an unexpected path or query string;
  - analytics hosts, CSP violations or uncaught page errors;
  - file names or document content in the console (pages and workers);
  - storage beyond the three documented keys.

  A unit test makes sure no spec can bypass the guard.

- 📄 **Real output checks.** Generated PDFs are checked with `qpdf --check` (mandatory in CI),
  re-rendered and pixel-compared, and compression uses a real JPEG encoder in Node.

### Run the tests

```bash
npm test                 # unit/integration (Vitest, Node): processing, compression, structure, i18n
npm run test:e2e         # browser (Playwright): every tool, Arabic, a11y, lifecycle, responsive, headers
npm run test:all         # typecheck + lint + unit + build + e2e
npm run test:cloudflare  # browser suite inside Cloudflare's Pages runtime (wrangler pages dev)
npm run qa               # real-world QA: >100 MB, 800 pages, protected, signed, Arabic, corrupted… → docs/QA_REPORT.md
npm run qa:cloudflare    # the same QA inside the Cloudflare runtime (needs python3 + Pillow, reportlab, pypdf, pyHanko, and qpdf)
ALL_BROWSERS=1 npm run test:e2e   # also Firefox + WebKit (needs: npx playwright install firefox webkit)
```

Details, and the list of what is _not_ covered, are in [docs/TESTING.md](docs/TESTING.md).

## Deployment

FreePDF is a **static site** built for **Cloudflare Pages on the free plan**. It uses no Workers code,
KV, D1 or R2. The largest file is about 1.3 MB, against a 25 MiB limit. Every route is emitted as its
own HTML file, so deep links work on Cloudflare Pages, Workers static assets / Cloudflare Drop and any
other static host.

| Option                  | How                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quickest**            | Go to <https://cloudflare.com/drop>, drop the contents of `dist/` (or a ZIP of them), then **Claim** the site into your account.                                                                                                                                                                                                                                                                            |
| **Pages dashboard**     | In **Workers & Pages**, create an application, choose to upload your own files, and upload `dist/`.                                                                                                                                                                                                                                                                                                         |
| **CI (GitHub Actions)** | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the test suite and `npm audit`. It deploys **only** when the repository variable `DEPLOY_ENABLED=true` is set, together with the secrets `CLOUDFLARE_API_TOKEN` (Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID`. Optional variables: `CF_PAGES_PROJECT` (default `freepdf`) and `SITE_URL` (the public address, for canonical links and the sitemap). |
| **Custom domain**       | In your Cloudflare project, go to **Custom domains** and add the domain. Once it serves HTTPS, the `Strict-Transport-Security` header from `_headers` takes effect.                                                                                                                                                                                                                                         |

> [!IMPORTANT]
> Keep Cloudflare Web Analytics **off**. It injects a third-party script that the CSP would block, and
> it would contradict the privacy policy.

Before releasing, follow the [release checklist](docs/RELEASE_CHECKLIST.md). Full guide:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Document                                            | Contents                                     |
| --------------------------------------------------- | -------------------------------------------- |
| [Release notes 1.2.0](docs/RELEASE_NOTES_v1.2.0.md) | What's new in this release                   |
| [Changelog](CHANGELOG.md)                           | Every release                                |
| [Architecture](docs/ARCHITECTURE.md)                | Design, tool-by-tool feasibility and roadmap |
| [Privacy](docs/PRIVACY.md)                          | The full privacy policy                      |
| [Security](docs/SECURITY.md)                        | Security model and headers                   |
| [Testing](docs/TESTING.md)                          | Test suites and CI jobs                      |
| [Test and QA report](docs/TEST_AND_QA_REPORT.md)    | Results for this release                     |
| [QA report](docs/QA_REPORT.md)                      | Real-world QA scenarios                      |
| [Deployment](docs/DEPLOYMENT.md)                    | Cloudflare deployment guide                  |
| [Release checklist](docs/RELEASE_CHECKLIST.md)      | Steps before a release                       |

## Roadmap

Everything under [Features](#features) is available now. The items below are **planned, not
available**, and are not shown in the app.

| Planned                        | Notes                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Word, Excel and HTML to PDF    | In the browser, with basic fidelity: headings, paragraphs, lists, tables, images and selectable text; complex layouts may differ. Next conversion batch.                |
| PDF to Word, Excel, PowerPoint | Editable with limits: Word gets paragraphs and images, Excel gets tables detected from text positions, PowerPoint gets one slide image per page. Next conversion batch. |
| Headers and footers            |                                                                                                                                                                         |
| Password protection and unlock | Via qpdf-wasm. Unlock requires the password; passwords are never cracked.                                                                                               |
| Metadata removal               |                                                                                                                                                                         |
| Redaction                      | True removal needs content-stream rewriting; some structures may get "can't guarantee" warnings.                                                                        |
| PDF editing and annotations    | Text, images, drawing, signatures, forms.                                                                                                                               |
| OCR                            | English first. Arabic OCR will be tested separately and isn't promised until measured.                                                                                  |

**Not planned:** PowerPoint to PDF (there is no open-source slide renderer that runs in the browser,
and files are never sent to a server), PDF/A conversion (proper validation needs veraPDF, which
doesn't run in the browser) and AI tools. See [docs/PLAN_conversion.md](docs/PLAN_conversion.md),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/PLAN_v1.2.0.md](docs/PLAN_v1.2.0.md) for details.

## License

**MIT** (as declared in [`package.json`](package.json)).

### Acknowledgements

FreePDF is built on these open-source projects:

| Project                                                      | License                   |
| ------------------------------------------------------------ | ------------------------- |
| [pdf-lib](https://github.com/Hopding/pdf-lib)                | MIT                       |
| [PDF.js](https://github.com/mozilla/pdf.js)                  | Apache-2.0                |
| [JSZip](https://github.com/Stuk/jszip)                       | MIT/GPLv3, used under MIT |
| [pako](https://github.com/nodeca/pako)                       | MIT and Zlib              |
| [fontkit (pdf-lib fork)](https://github.com/Hopding/fontkit) | MIT                       |
| [UTIF.js (utif2)](https://github.com/photopea/UTIF.js)       | MIT                       |
| [React](https://github.com/react/react)                      | MIT                       |

**Fonts** (all SIL Open Font License): Bricolage Grotesque, Atkinson Hyperlegible Next, Readex Pro,
IBM Plex Sans Arabic.
