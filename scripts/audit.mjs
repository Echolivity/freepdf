#!/usr/bin/env node
// `npm audit --audit-level=high`, with a short, dated list of accepted advisories.
//
// Fails on any high or critical advisory that isn't listed below, and on any listed advisory once its
// `until` date has passed, so an exception can't outlive its reason. Every entry needs a reason.
import { execFileSync } from 'node:child_process'

// Each entry: { id: 'GHSA-…', until: 'YYYY-MM-DD', reason: '…' }. Empty: every high/critical advisory fails.
// (GHSA-fc5q-39xc-vjpf, picomatch, was accepted from 2026-11-18 until npm stopped reporting it.)
const ACCEPTED = []

let raw
try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
} catch (e) {
  raw = e.stdout // npm audit exits non-zero when it finds anything
}
const report = JSON.parse(raw)
if (report.error) { console.error('npm audit failed:', report.error.summary ?? report.error); process.exit(1) }

const today = new Date().toISOString().slice(0, 10)
const accepted = new Map(ACCEPTED.map((a) => [a.id, a]))
const failures = []
const allowed = new Set()
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via !== 'object') continue // a package that depends on a vulnerable one; its root is listed too
    if (via.severity !== 'high' && via.severity !== 'critical') continue
    const id = via.url?.split('/').pop()
    const ok = accepted.get(id)
    if (ok && today <= ok.until) allowed.add(`${id} (${via.name}, accepted until ${ok.until})`)
    else failures.push(`${via.severity}: ${via.name} ${via.range} ${via.title} ${via.url}${ok ? ` (exception expired ${ok.until})` : ''}`)
  }
}
for (const a of allowed) console.log(`accepted: ${a}`)
if (failures.length) {
  console.error([...new Set(failures)].join('\n'))
  process.exit(1)
}
console.log('npm audit: no unaccepted high or critical advisories')
