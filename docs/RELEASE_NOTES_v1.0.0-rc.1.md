# FreePDF 1.0.0-rc.1: production release candidate

**Status: release candidate.** It's ready for a public preview deployment. It becomes 1.0.0 once
Firefox and WebKit pass in CI and one real Android and one real iPhone have been checked (see
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)).

Still 100% client-side: no backend, no uploads, no tracking, no accounts, no subscription, no daily
quotas.

## New

- **Lossless compression level.** Repacks the file without touching a single image pixel. The lossy
  levels are now clearly labelled "Lossy", and every result lists what was re-encoded and what was left
  alone, and why.
- **Certified-document warning.** PDFs certified by their author (DocMDP) get their own warning. Empty
  signature fields no longer trigger a false "signed" warning.
- **No needless rewrites.** Operations that change nothing return your original file byte-for-byte:
  extracting every page in order, a whole-document "split", or an unchanged organize. Signatures stay
  valid in those cases.

## Fixed

- **Signatures:** a no-op operation rewrote the file and broke its signature (verified with pyHanko).
- **Detection:** signature detection could react to the word "/ByteRange" in page text. It now matches
  real signature structures only, and also detects encryption declared in cross-reference streams.
- **Memory:** large files were held in memory two or three times during a job. Inputs are now moved into
  the processing worker instead of copied.
- **Code quality:** 9 code-quality warnings, fixed properly (0 remaining).
- **Repository hygiene:** local tool state was accidentally committed during development and has been
  removed.

## Security and privacy

- The PDF.js sandbox for running JavaScript embedded in PDFs is **no longer shipped**: FreePDF never
  runs document scripts.
- The obsolete `interest-cohort` header value was removed. PDF.js data files now load from a versioned
  path and are cached as immutable.
- `npm audit`: 0 vulnerabilities. The bundle was scanned for external hosts: none are contacted.
- The full browser suite and the real-world QA now also run inside **Cloudflare's own Pages runtime**
  (`wrangler pages dev`), locally and in CI. This checks headers, routing, redirects, 404s, MIME types
  and caching.

  > **Correction (1.0.0 audit):** in rc.1, CI ran only the browser suite inside the Pages runtime; the
  > real-world QA was run locally, not in CI. CI runs both from 1.0.0 on.

## Performance

- Homepage JavaScript: about 108.9 → 99.7 KB gzipped. The Arabic dictionary now loads only for Arabic
  visitors.
- The processing worker is 37 KB smaller.
- PDF.js data files are cacheable for a year.
- Measured on the build machine (2 vCPU Xeon @ 2.1 GHz, 8 GB, headless Chromium 153):

  | Operation | Time |
  |---|---|
  | Compress (Balanced) a 153 MB, 20-page photo PDF to 27.7 MB (−82%) | about 6 s |
  | Split an 800-page PDF into 800 files | 1.4 s |
  | Open 800 page thumbnails | about 0.5 s |
  | Render 800 pages to PNG | about 14 s |
  | 20 repeated compressions: JS heap after garbage collection | 4.2 → 4.8 MB (no leak) |

## Testing in this release

| Suite | Result |
|-------|--------|
| Unit / integration (Vitest) | 109 / 109 |
| Browser: 5 Chromium device profiles (desktop, tablet, mid-range Android, Pixel 7, 320 px) | 172 / 172 |
| Browser: inside the Cloudflare Pages runtime | 63 / 63 |
| Real-world QA (large, 800-page, protected, signed, Arabic, corrupted, low-memory, interrupted, repeated), validated with qpdf, pypdf strict and pyHanko | 30 / 30 |
| Firefox, WebKit | **Not executed** (can't be installed in the build environment). They run in CI. |
| Physical devices | **Not executed.** |

Full report: [TEST_AND_QA_REPORT.md](TEST_AND_QA_REPORT.md).

## Known limitations

- **Merge** doesn't merge bookmarks, fillable form fields or attachments. **Splits into more than 40
  parts** keep page content only.
- **Signed PDFs:** any real change invalidates a digital signature. FreePDF warns before processing but
  can't re-sign.
- **Compression** shrinks photos and scans. Text-only, already-optimised, CMYK and transparent content
  barely changes (reported per file). Lossless savings are usually small.
- **Password-protected PDFs** open only in PDF → JPG/PNG. Unlock and protect tools are planned.
- **Memory:** the browser's memory is the real ceiling. On phones, files near the 100 MB limit may still
  be slow or fail; the app then shows an error and recovers.
- **Signature detection** doesn't see signature dictionaries inside compressed object streams (rare).
- **Dependency:** pdf-lib 1.17.1 is unmaintained (no known vulnerabilities).
