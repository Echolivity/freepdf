# FreePDF 1.1.0: Resize PDF and Compare PDF

Two new tools. As before, everything runs in your browser: no uploads, no account, no quotas, no
watermark, no ads. Both tools are available in English and Arabic (right-to-left).

## Resize PDF (`/resize-pdf`)

- **Page sizes:** A4, Letter, A3, A5, Legal, or a custom size in mm or inches (1–200 inches per side).
- **How content fits:**
  - **Fit page:** scaled uniformly, centred, nothing cut.
  - **Fit width:** fills the width; tall pages may be cut.
  - **No scaling:** only the paper changes; content keeps its size and is centred.
- **Margins:** optional, in mm, for the fit modes.
- **Orientation:** match each page, or force portrait or landscape. Pages with `/Rotate` are handled correctly.
- **Pages:** all pages, or selected pages when you resize a single file. Several files come back as a ZIP.
- **Preview:** page 1 is shown on the new paper, with the resulting scale.
- **How it works:**
  - Content is never rasterised or re-embedded. A transformation matrix and a clip wrap the original
    content, so text stays selectable and images keep their exact bytes (a 153 MB photo PDF comes out
    at 153 MB).
  - Links, notes, highlights and form-field widgets move and scale with the content.
  - Bookmarks, form fields and metadata are kept.
  - Pages already at the target size (within 1 pt) are left untouched. If nothing changes, you get the
    original file back byte for byte.

## Compare PDF (`/compare-pdf`)

- Add two PDFs: the original first, then the changed version. Drag them to swap roles.
- **Text comparison:**
  - Word by word, with removed words highlighted in red on the original and added words in green on
    the changed version.
  - A list of the changes for each page.
  - Arabic-aware normalisation: presentation forms, tatweel and invisible direction marks don't count
    as changes.
- **Difference overlay:** a pixel comparison of the page with an adjustable tolerance. Red marks
  content only in the original, green content only in the changed version, amber a changed colour.
- **Check every page visually:** finds pages that differ in images or drawings even when the text is
  identical.
- **Report:** a PDF with the changed pages side by side, with highlights.
- **Read-only:** neither file is modified, and nothing is uploaded or stored.

## Also in this release

- **Home page:** a new "Review" category (Compare). Resize sits under Organize.
- **Plural forms:** an explicit "zero" message is now used for 0 in every language, for example "No
  visual differences found." instead of "0 pages look different."
- **QA harness fix:** the corrupted-input scenarios could check for a rejection before the
  asynchronous file validation had finished.

## Test results

| Suite | Result |
|-------|--------|
| Unit / integration (Vitest, `CI=1`) | 135 / 135, including 24 new resize/compare tests and a 300-case property test of the diff |
| Browser, 5 Chromium device profiles (`CI=1`) | 192 passed, 1 skipped (a Cloudflare-only test) |
| Browser, inside Cloudflare's Pages runtime | 80 / 80 |
| Real-world QA inside the Cloudflare runtime (strict validators) | 35 / 35, including 5 new: R1–R3 and C1–C2 |
| WebKit engine (WebKitGTK 2.52) inside the Cloudflare runtime over HTTPS | 12 / 12, including Resize and Compare |
| `npm audit` | 0 vulnerabilities |
| Playwright Firefox / WebKit projects | **Not executed here**; they run in CI's `cross-engine` job |
| Safari, physical devices | **Not tested** |

## Performance (build machine: 2 vCPU Xeon 2.1 GHz, headless Chromium 153, Cloudflare runtime)

| Operation | Time |
|---|---|
| Resize a 153 MB, 20-page photo PDF to Letter | 0.94 s |
| Resize 800 pages to A5 | 1.4 s |
| Compare two 800-page documents (about 435,000 words each) | 4.5 s |
| Compare two 153 MB PDFs and visually check all 20 pages | 9.8 s |

The Resize UI chunk is 2.8 KB gzipped and Compare is 5.7 KB. The homepage stays at about 99.6 KB.

## Known limitations

- **Resize:**
  - Internal link and bookmark targets that use exact page coordinates (`/XYZ`) aren't moved, so a
    jump may land slightly off the exact spot on a resized page.
  - Form-field font sizes scale with the field's appearance.
  - "Fit width" can cut the bottom of tall pages. The preview shows this before you run it.
- **Compare:**
  - Pages are paired by number, so a page inserted near the start makes the following pages show as
    changed.
  - Highlight positions are approximate within a line.
  - Text inside images (scans) isn't compared. Use the visual check.
  - Very repetitive text with more than 2,000 changes in one region is reported as one replaced block.
- **Encrypted PDFs** can't be resized or compared yet. Unlock is planned for a later release.
