# FreePDF — Architecture

## 1. Guiding principle

**The browser is the server.** Every tool that can run on the user's own device does so. Files are
read into memory, processed by JavaScript/WebAssembly in a Web Worker, and handed back as a download.
Nothing is uploaded, so there is nothing to retain, log, sell or leak — and nothing for us to pay for,
which is what makes "free, no limits" sustainable.

```
┌──────────────────────────── User's browser ─────────────────────────────┐
│                                                                          │
│  React UI (Vite, code-split per tool)                                    │
│    │  File (drag/drop, picker) ──► validate (size, magic bytes, dims)   │
│    │                                                                     │
│    ├──► pdf-ops Web Worker  (pdf-lib, JSZip, OffscreenCanvas)            │
│    │       merge · split · rotate · reorder · images→PDF · compress     │
│    │                                                                     │
│    └──► PDF.js (own worker)  render thumbnails / PDF→image / text        │
│                                                                          │
│  Output Blob ──► object URL ──► download / ZIP ──► revoked on reset     │
└──────────────────────────────────────────────────────────────────────────┘
          ▲  static assets only (HTML/JS/WASM/fonts)
┌─────────┴──────────┐
│ Cloudflare Pages   │   no Worker, no database, no analytics in Phase 1
└────────────────────┘
```

The Content-Security-Policy shipped in `public/_headers` sets `connect-src 'self'`, so the browser refuses
connections to any *other* origin. Note what this does not cover: same-origin requests are still
allowed. That gap is closed by design rather than by CSP: the app never issues requests carrying file
data, the static host has no endpoint that accepts uploads, and the E2E suite fails on any non-GET
request or any request with a body.

### Why not Cloudflare Workers for processing?

Workers on the free plan get ~10 ms of CPU per request and 128 MB of memory. That is too little for
any non-trivial PDF, and LibreOffice / Ghostscript / qpdf binaries cannot run there at all. Uploading
would also break the privacy promise. Workers are reserved for things that genuinely need a server
(see §3), and none are needed for Phases 1–2.

## 2. Tool-by-tool feasibility

Legend: **B** = fully in-browser · **B-wasm** = in-browser using a WebAssembly build of a native tool
(downloaded on demand, cached) · **S** = needs a self-hosted conversion service.

| # | Tool | Where | Technology | Notes / honest limits |
|---|------|-------|-----------|-----------------------|
| 1 | Merge | B | pdf-lib `copyPages` | ✅ Phase 1 |
| 2 | Split | B | pdf-lib | ✅ Phase 1 — ranges, every page, fixed chunks |
| 3 | Extract pages | B | pdf-lib | ✅ Phase 1 |
| 4 | Remove pages | B | pdf-lib | ✅ Phase 1 |
| 5 | Reorder pages | B | pdf-lib + PDF.js thumbnails | ✅ Phase 1 (Organize) |
| 6 | Rotate | B | pdf-lib `setRotation` | ✅ Phase 1 |
| 7 | Organize visually | B | PDF.js thumbnails | ✅ Phase 1 (reorder / rotate / delete in one view) |
| 8 | Compress | B | pdf-lib + OffscreenCanvas JPEG re-encode | ✅ Phase 1 — recompresses embedded JPEG images, rebuilds the file with object streams, drops unreferenced objects. Optional "maximum" mode rasterises pages (loses selectable text, clearly labelled). A Ghostscript-wasm mode (AGPL, ~15 MB) can be added later for vector-heavy files. |
| 9 | Repair | B-wasm | qpdf-wasm (Apache-2.0) | Rebuilds broken xref tables. Cannot recover truly missing data. |
| 10 | Flatten | B | pdf-lib `form.flatten()`; PDF.js raster for annotations | |
| 11 | Optimize for web (linearize) | B-wasm | qpdf-wasm `--linearize` | pdf-lib cannot linearize. |
| 12–13 | JPG / PNG → PDF | B | pdf-lib embed, canvas for WebP/EXIF | ✅ Phase 1 |
| 14–16 | Word / Excel / PowerPoint → PDF | **S** | LibreOffice headless (Gotenberg container) | Faithful layout needs a real office engine. LibreOffice-in-WASM exists but is ~50 MB+ and immature. Tool is **hidden unless** `VITE_CONVERTER_URL` is configured, and the UI states that the file leaves the device. |
| 17 | HTML → PDF | B (file) / S (URL) | Sandboxed iframe + browser print engine; Chromium service for URLs | Uploaded `.html` can be printed client-side. Fetching arbitrary URLs needs a server (CORS). |
| 18–19 | PDF → JPG / PNG | B | PDF.js render → canvas | ✅ Phase 1 |
| 20 | PDF → Word | B | PDF.js text + positions → `docx` | Reconstructs paragraphs/fonts; complex layouts are approximate. Labelled as such. |
| 21 | PDF → Excel | B | PDF.js text positions → column detection → SheetJS CE / ExcelJS | Works for real (non-scanned) tables. |
| 22 | PDF → PowerPoint | B | PDF.js render + `pptxgenjs` | One slide per page; image background + editable text boxes. |
| 23 | PDF → text | B | PDF.js `getTextContent` | Scanned PDFs need OCR (Phase 3: tesseract.js, self-hosted language data). |
| 24–31 | Add text / images / page numbers / watermark / header-footer / draw / sign / fill forms | B | pdf-lib (+ PDF.js for the editing canvas) | |
| 32 | Protect with password | B-wasm | qpdf-wasm (AES-256) | pdf-lib cannot encrypt. |
| 33 | Unlock | B-wasm / B | qpdf-wasm `--decrypt`; PDF.js for preview | Requires the password. We will not crack passwords. |
| 34 | Redact permanently | B | PDF.js raster of affected pages + pdf-lib rebuild | Guaranteed removal: redacted pages become images (text on those pages is no longer selectable). True object-level redaction needs MuPDF (AGPL) — possible later. |
| 35 | Remove metadata | B | pdf-lib: clear Info dict, delete XMP `/Metadata`, PieceInfo | |

**Summary:** 32 of 35 tools run entirely in the browser (29 with plain JS, 3 using qpdf-wasm). Only
Office→PDF (and HTML→PDF *from a URL*) need a server, because no browser-native engine renders
DOCX/XLSX/PPTX faithfully.

## 3. Optional conversion service (Phase 3)

- **Gotenberg** (MIT, LibreOffice + Chromium in Docker) on a small VM the operator controls
  (e.g. Oracle Cloud free tier, Fly.io, a home server behind Cloudflare Tunnel — the tunnel is free).
- Fronted by a Cloudflare Worker that only does: CORS, request-size limit, rate limiting per IP
  (to protect the box, not a paywall), and streaming the body through. Nothing is written to disk;
  Gotenberg runs with a tmpfs and deletes inputs per request.
- If no service is configured the Office tools do not appear. No dead buttons.

## 4. Front-end structure

```
src/
  app/            routing, layout, theme, recent-tools store
  components/     Dropzone, FileList, PageGrid (lazy thumbnails), ProgressBar, ResultPanel …
  tools/          one folder per tool page (lazy-loaded route chunks)
  lib/
    pdf/          pure processing functions (pdf-lib) — unit-tested in Node
    render/       PDF.js wrappers (browser only)
    validate.ts   size limits, magic bytes, image dimension sniffing
    ranges.ts     "1-3, 5, 8-" page-range parser
    files.ts      filename sanitising, download, ZIP
  workers/
    pdf.worker.ts runs lib/pdf/* off the main thread; cancellable (worker is terminated)
tests/
  unit/           Vitest — every lib/pdf function against generated fixtures
  e2e/            Playwright — every tool end-to-end in Chromium
```

Libraries are code-split: the homepage ships React + the directory only. `pdf-lib`, `pdfjs-dist` and
`jszip` load when a tool page is opened.

## 5. Safeguards

| Risk | Mitigation |
|------|-----------|
| Huge files exhausting memory | Per-file limit 250 MB, per-job total 600 MB (configurable in `src/config.ts`) |
| Wrong/malicious file types | Magic-byte check (`%PDF-`, JPEG `FFD8FF`, PNG signature, `RIFF…WEBP`) — extension and MIME are not trusted |
| Image decompression bombs | Image dimensions read from the header *before* decoding; > 100 MP rejected |
| PDF bombs / pathological files | Parsing runs in a Worker; UI stays responsive; user can cancel (worker terminated); rendered canvases capped at 16 384 px per side / 60 MP |
| Encrypted PDFs | Detected and reported clearly; PDF→image prompts for the password (PDF.js decrypts locally) |
| Filenames with path/control chars | Sanitised before use in downloads and ZIP entries |
| Data retention | Only in-memory Blobs; object URLs revoked on "Start over" / navigation; no IndexedDB, no service-worker cache of user files; `localStorage` holds only theme + recent tool slugs |
| Exfiltration | CSP `connect-src 'self'` blocks third-party origins; no third-party scripts; fonts self-hosted; static host with no upload endpoint; E2E fails on any request with a body |

## 6. Roadmap

### Phase 2 (next)
1. **Arabic and right-to-left support (first item).**
   - The interface: Arabic/English switcher (only the chosen language is saved), `dir="rtl"`,
     logical CSS properties, mirrored direction icons, a self-hosted Arabic typeface, full
     translation including error messages, and Arabic search keywords.
   - In PDFs: Arabic fixtures in the test suite, and HarfBuzz (WASM) shaping plus an embedded Arabic
     font for every tool that writes text onto pages.
2. Watermarks.
3. Page numbers.
4. Headers and footers.
5. Password protection and unlock (qpdf-wasm).
6. Metadata removal.
7. PDF editing and annotations: text, images, drawing, signatures, forms.
