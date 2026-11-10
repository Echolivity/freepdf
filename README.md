# FreePDF

**Every PDF tool you need. Completely free.**

FreePDF is a PDF toolkit that runs entirely in your browser. Files are processed on your own device and
are never uploaded. It has no accounts, no paid tier, no daily limits, no watermarks and no ads. The site
is a set of static files on Cloudflare Pages, so it costs essentially nothing to run, which is why it can
stay free.

## Tools (Phase 1, all working)

| Tool | What it does |
|------|--------------|
| Merge PDF | Combine PDFs in any order (drag or arrow buttons). Bookmarks and fillable form fields are not merged yet: form contents stay visible but are no longer editable |
| Split PDF | Custom ranges (`1-3, 5, 8-`), every page, or every N pages; optionally into one file. Splits into 40 or fewer parts keep fields and bookmarks; larger splits keep page content only |
| Extract pages | Pick pages from thumbnails (shift-click for runs) or by range. Their fields and bookmarks come along |
| Remove pages | Delete pages. Remaining form fields, bookmarks and links are kept; those pointing at removed pages are cleaned up |
| Organize PDF | Thumbnail view: reorder, rotate and delete individual pages |
| Rotate PDF | Rotate every page of one or many PDFs by 90°, 180° or 270° |
| Compress PDF | Re-encodes embedded photos and scans, deflates uncompressed streams, drops orphaned objects. Returns the original if no saving is possible. |
| JPG / PNG to PDF | JPG, PNG and WebP to PDF. JPGs are embedded without re-encoding, EXIF orientation is honoured, A4/Letter/fit sizes |
| PDF to JPG / PNG | 72, 150 or 300 DPI. Password-protected PDFs can be unlocked locally with their password. |

Downloads come as single files or as a ZIP. The roadmap and an analysis of which of the 35 planned
tools can run in the browser are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Privacy model

- **Local processing:** pdf-lib runs in a Web Worker (a new worker per job, terminated afterwards).
  PDF.js handles rendering. Canvas and OffscreenCanvas handle images.
- **Third parties blocked by the browser:** `public/_headers` ships a strict CSP (`connect-src 'self'`).
  CSP doesn't restrict same-origin requests, so that case is covered differently. The app never sends
  file data, and the static host has no endpoint that accepts uploads. The E2E suite fails on any
  request outside the origin, any non-GET request, any request with a body, and any CSP violation.
- **No retention:** results exist only as in-memory Blobs until "Start over" or the tab closes.
  `localStorage` holds only the theme and recently used tool slugs, never file names. A test verifies
  this.
- **Input hardening:**
  - File types are detected from magic bytes; names and MIME types aren't trusted.
  - Image dimensions are read from headers before decoding, which blocks decompression bombs.
  - Size limits apply per file and per job (`src/config.ts`).
  - Filenames are sanitized, and ZIP entries are de-duplicated.
  - Encrypted and corrupted PDFs produce clear errors.

## Development

Requires Node 22.13+.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # → dist/
npm run preview      # serves dist/ with the production security headers
```

### Tests

```bash
npm test             # Vitest unit tests (Node) for all processing code
npm run test:e2e     # Playwright: every tool end-to-end in Chromium (desktop + mobile viewport)
npm run test:all     # typecheck + lint + unit + build + e2e (what CI runs)
```

If `qpdf` is installed, unit tests also run `qpdf --check` on every generated PDF (CI installs it).
For E2E against a system Chrome, set `CHROME_PATH=/path/to/chrome`. See
[`docs/TESTING.md`](docs/TESTING.md) for what is covered.

## Repository layout

```
src/
  app/          layout, home, tool page shell, privacy page, prefs (theme/recent)
  components/   drop zone, file list, page thumbnails grid, progress/result panels, UI kit
  tools/        one folder per tool page (each lazy-loaded)
  lib/pdf/      pure pdf-lib processing (merge, split, rotate, organize, images→PDF, compress)
  lib/render/   PDF.js wrapper (rendering, password handling)
  workers/      Web Worker entry + OffscreenCanvas image codec
tests/unit      Vitest
tests/e2e       Playwright
tests/fixtures  sample files incl. encrypted, truncated and fake PDFs
public/_headers Cloudflare Pages security headers (CSP etc.)
```

## Deployment (Cloudflare Pages, free plan)

The site is static. It uses no Workers, KV, D1 or R2, and fits comfortably in the free plan: the
largest file is about 1.3 MB, against a 25 MiB per-file limit.

### Automatic deploy via GitHub Actions

1. Push this repository to GitHub.
2. Set up Cloudflare:
   1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Direct Upload**.
   2. Create a project named `freepdf`. If you choose another name, set the repository variable
      `CF_PAGES_PROJECT` to it.
   3. Create an API token at **My Profile → API Tokens → Create token → Custom**, with permission
      *Account · Cloudflare Pages · Edit*.
3. In GitHub, go to **Settings → Secrets and variables → Actions** and add these secrets:
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (shown on the dashboard sidebar).
4. Push to `main` to deploy production. Pull requests get preview URLs. Every deploy runs the full
   test suite first (`.github/workflows/ci.yml`).

### Manual deploy

```bash
npm run build
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npx wrangler pages deploy dist --project-name=freepdf
```

### Custom domain

In the Pages project, open **Custom domains → Set up a custom domain** and enter e.g. `freepdf.example`.
If the domain's DNS is on Cloudflare, the record is created automatically. Otherwise, add the CNAME
`freepdf.example → freepdf.pages.dev` that the dashboard shows. HTTPS certificates are issued
automatically and are free.

SPA routing: deep links such as `/merge-pdf` work because Pages serves `index.html` for unknown
paths when the project has no `404.html`. Do not add one.

## Licence

MIT. Third-party: pdf-lib (MIT), PDF.js (Apache-2.0), JSZip (MIT/GPLv3, used under MIT), pako
(MIT), fonts Bricolage Grotesque and Atkinson Hyperlegible Next (SIL OFL).
