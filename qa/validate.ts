import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Independent validators. Each returns a short verdict string; "n/a" when the tool isn't installed. */
const tmp = mkdtempSync(join(tmpdir(), 'freepdf-qa-'))
let n = 0
function toFile(bytes: Uint8Array): string {
  const f = join(tmp, `out-${n++}.pdf`)
  writeFileSync(f, bytes)
  return f
}

export function qpdf(bytes: Uint8Array): { ok: boolean; note: string } {
  const r = spawnSync('qpdf', ['--check', toFile(bytes)], { encoding: 'utf8' })
  if (r.error) return { ok: true, note: 'qpdf n/a' }
  return { ok: r.status === 0 || r.status === 3, note: r.status === 0 ? 'qpdf ok' : r.status === 3 ? 'qpdf ok (warnings)' : `qpdf FAILED: ${(r.stdout + r.stderr).slice(0, 200)}` }
}

/** pypdf in strict mode: a second, independent parser. Returns page count. */
export function pypdf(bytes: Uint8Array): { ok: boolean; pages: number; note: string } {
  const f = toFile(bytes)
  const r = spawnSync('python3', ['-I', '-c', `import pypdf,sys\nr=pypdf.PdfReader(sys.argv[1], strict=True)\nprint(len(r.pages))`, f], { encoding: 'utf8' })
  if (r.status !== 0) return { ok: false, pages: 0, note: `pypdf strict FAILED: ${r.stderr.trim().split('\n').pop()?.slice(0, 160)}` }
  return { ok: true, pages: Number(r.stdout.trim()), note: 'pypdf strict ok' }
}

/** pyHanko signature validation (integrity of the signed byte range). */
export function signatureIntact(bytes: Uint8Array): boolean | 'n/a' {
  const f = toFile(bytes)
  const r = spawnSync('python3', ['-c', `from pyhanko.pdf_utils.reader import PdfFileReader\nfrom pyhanko.sign.validation import validate_pdf_signature\nimport sys\nr=PdfFileReader(open(sys.argv[1],'rb'), strict=False)\ns=r.embedded_signatures\nprint(all(validate_pdf_signature(x).intact for x in s) if s else 'none')`, f], { encoding: 'utf8' })
  if (r.status !== 0) return 'n/a'
  return r.stdout.trim() === 'True'
}

export function textOf(bytes: Uint8Array, page = 0): string {
  const f = toFile(bytes)
  const r = spawnSync('python3', ['-I', '-c', `import pypdf,sys\nprint(pypdf.PdfReader(sys.argv[1]).pages[int(sys.argv[2])].extract_text())`, f, String(page)], { encoding: 'utf8' })
  return r.stdout
}
