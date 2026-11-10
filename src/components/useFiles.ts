import { useCallback, useRef, useState } from 'react'
import { validateFiles, type FileKind, type ValidatedFile } from '../lib/validate'
import { moveItem } from '../lib/output'
import type { Message } from '../i18n/core'

/** Selected-file state with validation and ordering. */
export function useFiles(accept: FileKind[], opts: { multiple: boolean }) {
  const [files, setFilesState] = useState<ValidatedFile[]>([])
  const [rejections, setRejections] = useState<Message[]>([])
  // The ref is the source of truth so rapid successive adds (two drops before React re-renders) validate
  // against the real current list; the queue makes each add see the previous one's result.
  const current = useRef<ValidatedFile[]>([])
  const queue = useRef<Promise<void>>(Promise.resolve())
  const setFiles = useCallback((next: ValidatedFile[] | ((fs: ValidatedFile[]) => ValidatedFile[])) => {
    current.current = typeof next === 'function' ? next(current.current) : next
    setFilesState(current.current)
  }, [])

  const add = useCallback(
    (incoming: File[]) => {
      const run = async () => {
        const base = opts.multiple ? current.current : []
        const pool = opts.multiple ? incoming : incoming.slice(0, 1)
        const { accepted, rejected } = await validateFiles(pool, accept, base.reduce((s, f) => s + f.size, 0), base.length)
        if (!opts.multiple && incoming.length > 1) rejected.push({ key: 'val.oneAtATime' })
        setRejections(rejected)
        if (accepted.length) setFiles(opts.multiple ? [...current.current, ...accepted] : accepted.slice(0, 1))
      }
      queue.current = queue.current.then(run, run)
      return queue.current
    },
    [accept, opts.multiple, setFiles],
  )

  const remove = useCallback((id: string) => setFiles((fs) => fs.filter((f) => f.id !== id)), [setFiles])
  const move = useCallback((from: number, to: number) => setFiles((fs) => moveItem(fs, from, to)), [setFiles])
  const clear = useCallback(() => {
    setFiles([])
    setRejections([])
  }, [setFiles])
  const sortByName = useCallback(
    () => setFiles((fs) => [...fs].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))),
    [setFiles],
  )

  return { files, rejections, setRejections, add, remove, move, clear, sortByName }
}

export async function readBytes(f: ValidatedFile): Promise<Uint8Array> {
  return new Uint8Array(await f.file.arrayBuffer())
}
