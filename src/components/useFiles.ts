import { useCallback, useState } from 'react'
import { validateFiles, type FileKind, type ValidatedFile } from '../lib/validate'
import { moveItem } from '../lib/output'

/** Selected-file state with validation and ordering. */
export function useFiles(accept: FileKind[], opts: { multiple: boolean }) {
  const [files, setFiles] = useState<ValidatedFile[]>([])
  const [rejections, setRejections] = useState<string[]>([])

  const add = useCallback(
    async (incoming: File[]) => {
      const current = opts.multiple ? files : []
      const pool = opts.multiple ? incoming : incoming.slice(0, 1)
      const { accepted, rejected } = await validateFiles(pool, accept, current.reduce((s, f) => s + f.size, 0), current.length)
      if (!opts.multiple && incoming.length > 1) rejected.push('This tool works on one file at a time; only the first file was added.')
      setRejections(rejected)
      if (accepted.length) setFiles(opts.multiple ? [...current, ...accepted] : accepted.slice(0, 1))
    },
    [accept, files, opts.multiple],
  )

  const remove = useCallback((id: string) => setFiles((fs) => fs.filter((f) => f.id !== id)), [])
  const move = useCallback((from: number, to: number) => setFiles((fs) => moveItem(fs, from, to)), [])
  const clear = useCallback(() => {
    setFiles([])
    setRejections([])
  }, [])
  const sortByName = useCallback(
    () => setFiles((fs) => [...fs].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))),
    [],
  )

  return { files, rejections, setRejections, add, remove, move, clear, sortByName }
}

export async function readBytes(f: ValidatedFile): Promise<Uint8Array> {
  return new Uint8Array(await f.file.arrayBuffer())
}
