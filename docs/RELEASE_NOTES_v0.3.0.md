# FreePDF 0.3.0: engineering hardening

**Release type:** reliability, privacy and security hardening, with no new tools. Still 100% client-side,
with no backend, no tracking, no subscription and no quotas.

## Fixed

- **Signed PDFs:** they were invalidated silently. Tools that rewrite a PDF now detect digital
  signatures **before processing** and warn that the result won't carry a valid signature.
  Password-protected files are flagged up front too, instead of failing after you press the button.
- **Compression:** lossless images stored with chained filters (e.g. `ASCII85 + Flate`, which
  ReportLab writes) were never compressed. They now are, at the Balanced and Strong levels.
- **Merge:** it dropped document info. It now keeps the first file's title, author, subject and
  keywords, in any script, including Arabic.
- **Accessibility:** the language switch's accessible name didn't match its visible text (WCAG 2.5.3).
- **Wording:** "No limits" was misleading. It now says "no subscription, no daily quotas", and the
  technical size limits are stated clearly.
- **Documentation:** it omitted the `freepdf:lang` storage key. All stored keys are now documented
  exactly.

## Security and privacy

- **Global privacy guard on every browser test.** A test fails if any of these happens:
  - a request goes to another origin;
  - a non-GET request, or any request with a body;
  - an unexpected path or a query string;
  - document-like data appears in a URL;
  - a tracking host is contacted;
  - a CSP violation or an uncaught error occurs;
  - storage beyond the three documented keys is used.

  The guard is self-tested, and it can't be bypassed.
- **Tighter Content-Security-Policy:** `worker-src 'self'` and `connect-src 'self'`, with no `blob:` or
  `data:` connections. `Cross-Origin-Resource-Policy: same-origin` is added. A test locks the headers in.
- **Privacy page:** lists every stored key and has a **Clear these settings** button. The recent-tools
  list is checked to contain tool names only, never file names.
- **CI:** runs `npm audit --audit-level=high` and Firefox + WebKit. Dependabot is configured.
  Deployment now needs an explicit `DEPLOY_ENABLED=true` repository variable.

## Reliability and performance

- **Compression report:** each file shows its original and output size, the reduction, how many images
  were re-encoded, and which were left unchanged and why (transparency, CMYK or special colours, kept
  lossless, no saving possible…).
- **Compression tests now use a real JPEG encoder.** They confirm that:
  - the three levels produce different, ordered results (Strong < Balanced < Light);
  - resolution caps are respected and quality loss stays within set limits;
  - vector content is never rasterised;
  - transparency and CMYK are left byte-identical;
  - ICC profiles are kept;
  - already-compressed files never grow;
  - every output passes `qpdf --check`.
- **Structure tests across all tools:** form fields, bookmarks, internal and external links,
  annotations, embedded files, mixed page sizes, rotations and Arabic metadata.
- **Lifecycle tests:** workers are terminated after success, cancel and repeated runs. Temporary URLs
  are released. A crashed worker (e.g. out of memory) shows a clear error and the app recovers. Two
  tabs can process at once, and closing a tab mid-job is safe.
- **Device profiles:** tablet (Galaxy Tab S4), mid-range Android (Galaxy A55), Pixel 7 and a 320 px
  phone, all emulated, in English and Arabic.

## New

- **Landing message:** "Private PDF tools. Your files stay on your device."
- **Every tool page** now shows what it accepts, what you get, the limits on your device, the privacy
  explanation and a short FAQ, in English and Arabic.
- **SEO:** every route has its own static title, description and Open Graph tags. Canonical links and a
  sitemap are added when `SITE_URL` is set at build time. There's a robots.txt, and the 404 page is
  marked `noindex`.

## Known limitations

- **Merge** doesn't merge bookmarks, fillable form fields or attachments; form contents stay visible.
  **Splits into more than 40 parts** keep page content only.
- **Compression** is lossy for images at every level. It can't shrink text-only, already-optimised,
  CMYK or transparent content, and those are reported. Vector-heavy files barely change.
- **Signed PDFs:** any change invalidates a digital signature. FreePDF warns about this but can't keep
  signatures valid.
- **Password-protected PDFs** can only be opened in PDF → JPG/PNG. Unlocking and protecting are planned
  (qpdf-wasm).
- **Browser memory** is the real ceiling: very large or unusual PDFs can still be slow or fail on phones.
  The app then shows an error and recovers.
- **Testing:**
  - Firefox and WebKit run in CI but were **not run in this release's local verification**.
  - No physical devices were tested; the device results come from emulation.
- **Dependency:** pdf-lib 1.17.1 is unmaintained (no known vulnerabilities). It's a long-term risk.
