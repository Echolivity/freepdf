# Changelog

## 0.2.0 — 2026-11-10 (Phase 2, part 1: Arabic)

### Added
- **Full Arabic interface** with right-to-left layout.
  - Language switch in the header. The choice is remembered, and Arabic-language browsers get Arabic
    by default.
  - The language and direction are applied before the first paint, so there's no flash.
  - Every message is translated: interface, validation, page-range errors, and the errors and progress
    sent from the processing worker. Messages travel as keys and are translated on screen.
- **Arabic plurals:** all six forms (zero, one, two, few, many, other) via `Intl.PluralRules`.
- **Arabic typefaces:** Readex Pro for headings and IBM Plex Sans Arabic for body text. They're
  self-hosted and only the Arabic subset loads, and only when Arabic text is on screen. Letter-spacing
  is disabled for Arabic so the cursive joins stay intact.
- **Layout mirroring:** direction-aware CSS (logical properties) throughout. Direction icons are
  mirrored: back links, and "move earlier / later" on page thumbnails.
- **Mixed-direction text:** file names and sizes are isolated so mixed Arabic/Latin text displays in
  the correct order.
- **Arabic input:** page ranges accept Arabic-Indic and Persian digits, the Arabic comma and dash
  variants (`١-٢، ٥`).
- **Bilingual search:** every tool is found from either language, with Arabic normalisation (hamza
  forms, tāʾ marbūṭa, diacritics).

### Tests
- **Dictionary checks:** the Arabic dictionary has the same keys as English, no empty strings, and
  keeps every placeholder.
- **Arabic PDF fixture** (`arabic.pdf`, shaped by Chromium with an embedded Arabic font):
  - Remove, Extract, Organize and Merge outputs render pixel-identical to the source pages.
  - Arabic text remains extractable.
- **Arabic E2E on desktop and mobile:**
  - The page defaults to RTL for Arabic browsers, and the language toggle is persisted.
  - Arabic search works.
  - Engine errors arrive in Arabic.
  - Arabic digits work in Split.
  - Arabic file names survive into downloads.
  - Mirrored controls still move pages in reading order.
  - An untranslated-text scan covers whole pages.

## 0.1.1 — 2026-11-10 (audit fixes)

### Fixed
- **Remove, Extract, Organize, and Splits of 40 or fewer parts** now edit the original document's page tree
  instead of copying pages into a new file. Remaining form fields, bookmarks, links, metadata and
  attachments are kept. Fields, bookmarks, links and named destinations that pointed at removed pages
  are pruned, and removed pages are dropped from the file.
- **Compress** no longer re-encodes images with a soft mask (transparency) or CMYK JPEGs. Pixels are
  decoded without colour-space conversion, so ICC-based images keep their meaning.
- **Rapid successive file drops** can no longer lose an earlier batch.
- **JPEG size check:** dimensions are found even when metadata pushes the frame header past 64 KB.
  JPEGs without a readable size are rejected. Decoded images are re-checked before a canvas is created.

### Changed
- **Privacy wording** is now precise: CSP blocks third-party origins, and same-origin uploads are
  prevented by design and caught by tests, not by CSP.
- **Lower size limits** on phones and low-memory devices, and a warning before large jobs.
- **Merge, and Splits of more than 40 parts,** state that bookmarks and fillable fields are not
  carried over.
- **Compress** says plainly that image re-encoding is lossy at every level.
- **Upload screens** link to "How it works". HSTS header added.

### Tests
- **New:** structure-fidelity fixtures, render-and-compare visual tests (Node + PDF.js), compressed
  output visual check, same-instant double-drop race, hidden JPEG bomb, Arabic filenames, and soft-mask
  safety.
- **Network guard:** E2E now also fails on same-origin non-GET requests or requests with a body.

## 0.1.0 — 2026-11-10
- Phase 1: Merge, Split, Extract, Remove, Organize, Rotate, Compress, JPG/PNG→PDF, PDF→JPG/PNG.
