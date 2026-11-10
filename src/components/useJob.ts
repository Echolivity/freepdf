import { useCallback, useEffect, useRef, useState } from 'react'
import type { OutputFile } from '../lib/output'
import { CancelledError } from '../lib/workerClient'
import { UserFacingError } from '../lib/validate'
import type { Message } from '../i18n/core'

export type JobStatus = 'idle' | 'running' | 'done' | 'error'

export interface JobContext {
  signal: AbortSignal
  progress: (value: number, label?: Message) => void
}

export function useJob() {
  const [status, setStatus] = useState<JobStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [label, setLabel] = useState<Message>()
  const [error, setError] = useState<Message>()
  const [results, setResults] = useState<OutputFile[]>([])
  const [summary, setSummary] = useState<Message>()
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async (fn: (ctx: JobContext) => Promise<OutputFile[] | { files: OutputFile[]; summary?: Message }>) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setStatus('running')
    setProgress(0)
    setLabel(undefined)
    setError(undefined)
    setResults([])
    setSummary(undefined)
    try {
      const out = await fn({
        signal: ac.signal,
        progress: (v, l) => {
          if (ac.signal.aborted) return
          setProgress(Math.max(0, Math.min(1, v)))
          if (l) setLabel(l)
        },
      })
      if (ac.signal.aborted) return
      const files = Array.isArray(out) ? out : out.files
      setResults(files)
      setSummary(Array.isArray(out) ? undefined : out.summary)
      setProgress(1)
      setStatus('done')
    } catch (err) {
      if (err instanceof CancelledError || ac.signal.aborted) {
        setStatus('idle')
        return
      }
      console.error(err instanceof Error ? err.name : 'error') // never log document data
      setError(
        err instanceof UserFacingError
          ? err.toMessage()
          : err instanceof Error && /memory|allocation|Array buffer/i.test(err.message)
            ? { key: 'err.memory' }
            : { key: 'err.generic', params: { detail: err instanceof Error ? err.message : '' } },
      )
      setStatus('error')
    }
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setStatus('idle')
  }, [])

  /** Drop results (and the memory they hold). */
  const reset = useCallback(() => {
    abortRef.current?.abort()
    setResults([])
    setSummary(undefined)
    setError(undefined)
    setProgress(0)
    setStatus('idle')
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { status, progress, label, error, results, summary, run, cancel, reset }
}

export type Job = ReturnType<typeof useJob>
