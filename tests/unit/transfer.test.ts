import { describe, expect, it } from 'vitest'
import { transferablesOf } from '../../src/lib/transfer'

describe('worker transfer lists', () => {
  it('collects each input buffer once (duplicates would make postMessage throw)', () => {
    const a = new Uint8Array(8)
    const b = new Uint8Array(4)
    const list = transferablesOf({ files: [{ name: 'a', bytes: a }, { name: 'b', bytes: b }], again: a.subarray(2) })
    expect(list).toHaveLength(2)
    expect(list).toContain(a.buffer)
    expect(list).toContain(b.buffer)
  })
  it('transferring actually moves the bytes (no copy left behind)', () => {
    const bytes = new Uint8Array(1024)
    structuredClone({ bytes }, { transfer: transferablesOf({ bytes }) })
    expect(bytes.byteLength).toBe(0) // detached: the memory now belongs to the receiver
  })
})
