import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const here = dirname(fileURLToPath(import.meta.url))
export const fixture = (name: string) => new Uint8Array(readFileSync(join(here, '..', 'fixtures', name)))

/**
 * Build a PDF whose page N has width 200+N points, so page order can be verified from MediaBoxes alone.
 */
export async function numberedPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([200 + i, 300])
    p.drawText(`Page ${i}`, { x: 20, y: 150, size: 24, font })
  }
  return doc.save()
}

/** Page "numbers" (as encoded by numberedPdf) in order. */
export async function pageIds(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => Math.round(p.getMediaBox().width) - 200)
}

export async function rotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => p.getRotation().angle)
}

const hasQpdf = spawnSync('qpdf', ['--version']).status === 0

/**
 * Structural validation with qpdf. Skipped locally when qpdf isn't installed; in CI a missing qpdf is an
 * error, so the check can't silently disappear from the pipeline.
 */
export function qpdfCheck(bytes: Uint8Array): boolean {
  if (!hasQpdf) {
    if (process.env.CI) throw new Error('qpdf is required in CI (apt-get install qpdf)')
    return true
  }
  const dir = mkdtempSync(join(tmpdir(), 'freepdf-'))
  const f = join(dir, 'out.pdf')
  writeFileSync(f, bytes)
  const r = spawnSync('qpdf', ['--check', f], { encoding: 'utf8' })
  rmSync(dir, { recursive: true, force: true })
  // exit 0 = ok, 3 = warnings only
  if (r.status !== 0 && r.status !== 3) throw new Error(`qpdf --check failed:\n${r.stdout}\n${r.stderr}`)
  return true
}
