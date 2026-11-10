# Test suite

Run everything with `npm run test:all`. This is the same set of checks CI runs before every deploy.

## Unit (Vitest, Node) — `tests/unit/`

These tests exercise the processing code directly (`src/lib/**`). The output PDFs are re-parsed with
pdf-lib and, when `qpdf` is installed, validated with `qpdf --check`.

Page order is verified exactly: test PDFs give page *N* a width of `200+N` pt, so any reordering bug
shows up.

| Area | Normal | Corrupted | Encrypted | Large | Multiple |
|------|:-:|:-:|:-:|:-:|:-:|
| Merge | ✓ order + real-world files | ✓ garbage PDF named in error | ✓ user-password and owner-only (permissions) | | ✓ |
| Split / extract / remove | ✓ ranges, chunks, bounds | ✓ truncated: partial recovery; severe: clear error | via shared loader | ✓ 500 pages → 500 files | |
| Rotate / organize | ✓ cumulative rotation, selective pages, reorder+rotate+drop | | | | |
| Images → PDF | ✓ sizes, EXIF orientation, A4 auto-landscape, JPEG embedded byte-identical | ✓ broken JPEG named | n/a | | ✓ |
| Compress | ✓ image re-encode (ASCII85+DCT), lossless stream deflate + orphan removal, "no gain → original" | ✓ undecodable images skipped | ✓ clear error | | |
| Validation | ✓ magic bytes, renamed files, image header dimensions | ✓ empty files | | ✓ decompression-bomb PNG header rejected | |
| Ranges / filenames | ✓ parser edge cases, path traversal, control and bidi characters, reserved names, ZIP de-duplication | | | | |

### Added after the technical audit

- **Structure fidelity** (`structure.test.ts`, `structured.pdf`). Remove, Extract, Organize and Split
  are checked to keep the right form fields (and their values), bookmarks, internal links and
  metadata. Nothing may point at a removed page: there must be no orphan widgets and no stale
  bookmarks or links. Removed pages must actually leave the file, and inherited page attributes must
  survive.
- **Render and compare** (`visual.test.ts`, PDF.js plus `@napi-rs/canvas` in Node):
  - Pages from Remove, Organize and Merge are pixel-identical to their source pages.
  - Rotation changes the rendered geometry.
  - PNG transparency blends correctly over white.
- **Compressor safety.** Images with soft masks are never sent to the codec.
- **Validation.**
  - A JPEG whose frame header sits past 64 KB is measured correctly. If it is a decompression bomb,
    it is rejected.
  - A JPEG with no frame header is rejected.
  - Arabic filenames are preserved, and bidi override characters are still stripped.

## End-to-end (Playwright, Chromium) — `tests/e2e/`

These tests run against `vite preview`, which serves the production build with the **production
CSP**. Every test can call `guardPage()`, which fails on uncaught errors, CSP violations, or any
network request outside the origin.

- Every tool: upload a file, set options, process, download, then re-parse the downloaded output.
- Merge: a fake `.pdf` is rejected; reordering via the keyboard-accessible buttons; an encrypted
  input produces an error message.
- Split: produces a ZIP with the expected names; an invalid range disables the action.
- Extract: thumbnail clicks and shift-click range selection.
- Organize: delete, rotate and move single pages.
- Compress: the real OffscreenCanvas codec shrinks the scanned fixture by more than 40%; a text-only
  PDF is returned unchanged.
- PDF → PNG: a wrong password is rejected and the right one unlocks the file locally.
- JPG → PDF: EXIF-rotated JPG plus WebP plus PNG with transparency.
- Cancel and Start over.
- Large document: a 400-page split into 400 files, while checking that the UI stays responsive.
- Compress (visual): the compressed page renders within a mean error of 4/255 of the original.
- Race: two drops dispatched in the same instant must both end up in the list. This test fails on
  the pre-audit code.
- Network: any same-origin non-GET request, or any request with a body, fails the test.
- Retention: after a job, `localStorage` holds only the theme and recent-tool keys, and there is no
  sessionStorage, IndexedDB, Cache Storage or service worker.
- Smoke: home page search, theme toggle, every listed tool opens a working page, recent tools, 404.
  These also run on a Pixel 7 mobile viewport.

## Manual checks per release

- Safari (macOS/iOS) and Firefox: run one job per tool. CI covers Chromium only.
- A real phone with a 100 MB+ scanned PDF: check that compression completes and memory isn't exceeded.
