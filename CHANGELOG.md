# Changelog

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
