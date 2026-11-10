import type { ReactNode } from 'react'
import type { Job } from './useJob'
import { JobStatus } from './JobPanels'
import { Rejections } from './ui'
import type { Message } from '../i18n/core'

/**
 * Shared page flow for every tool:
 *   empty → drop zone · files chosen → workspace (options + action) · running → progress · done → downloads.
 */
export function ToolFrame({
  job,
  hasInput,
  rejections,
  onDismissRejections,
  dropzone,
  workspace,
  onStartOver,
  zipName,
  intro,
}: {
  job: Job
  hasInput: boolean
  rejections: Message[]
  onDismissRejections: () => void
  dropzone: ReactNode
  workspace: ReactNode
  onStartOver: () => void
  zipName?: string
  intro?: ReactNode
}) {
  const busy = job.status === 'running' || job.status === 'done'
  return (
    <div className="space-y-5">
      {!busy && <Rejections items={rejections} onDismiss={onDismissRejections} />}
      {job.status === 'error' && <JobStatus job={job} onStartOver={onStartOver} />}
      {busy ? (
        <JobStatus job={job} onStartOver={onStartOver} zipName={zipName} />
      ) : hasInput ? (
        workspace
      ) : (
        <>
          {intro}
          {dropzone}
        </>
      )}
    </div>
  )
}
