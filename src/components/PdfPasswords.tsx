import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'
import { Icon } from './Icon'
import { readBytes } from './useFiles'
import { closePdf, openPdf, PasswordRequiredError } from '../lib/render/pdfjs'
import type { ValidatedFile } from '../lib/validate'
import { useI18n } from '../i18n/context'

type LockState = { status: 'checking' } | { status: 'open' } | { status: 'locked'; wrong?: boolean } | { status: 'unlocked'; password: string }

/**
 * For tools that only *read* PDFs (export to images, text, HTML): files the pre-scan marked as
 * encrypted are probed with PDF.js. Permission-only protection opens without a password; a user
 * password has to be typed in, and stays in memory for this tab only.
 */
export function usePdfPasswords(files: ValidatedFile[]) {
  const { t } = useI18n()
  const [locks, setLocks] = useState<Record<string, LockState>>({})
  const [input, setInput] = useState<Record<string, string>>({})
  const probed = useRef(new Set<string>())

  useEffect(() => {
    for (const f of files) {
      if (!f.encrypted || probed.current.has(f.id)) continue
      probed.current.add(f.id)
      ;(async () => {
        let state: LockState = { status: 'open' }
        try {
          await closePdf(await openPdf(await readBytes(f), { name: f.name }))
        } catch (e) {
          if (e instanceof PasswordRequiredError) state = { status: 'locked' }
        }
        setLocks((l) => ({ ...l, [f.id]: state }))
      })()
    }
  }, [files])

  const lockOf = (f: ValidatedFile): LockState => locks[f.id] ?? (f.encrypted ? { status: 'checking' } : { status: 'open' })
  const passwordOf = (f: ValidatedFile) => {
    const l = lockOf(f)
    return l.status === 'unlocked' ? l.password : undefined
  }
  const unlock = async (id: string) => {
    const f = files.find((x) => x.id === id)
    const password = input[id] ?? ''
    if (!f || !password) return
    try {
      await closePdf(await openPdf(await readBytes(f), { name: f.name, password }))
      setLocks((l) => ({ ...l, [id]: { status: 'unlocked', password } }))
    } catch {
      setLocks((l) => ({ ...l, [id]: { status: 'locked', wrong: true } }))
    }
  }
  const reset = () => { setLocks({}); setInput({}); probed.current.clear() }

  const locked = files.filter((f) => lockOf(f).status === 'locked')
  const checking = files.some((f) => lockOf(f).status === 'checking')
  const extra = (f: ValidatedFile) => {
    const s = lockOf(f).status
    return s === 'locked' ? t('p2i.passwordNeeded') : s === 'unlocked' ? t('p2i.unlocked') : ''
  }

  const prompts = locked.map((f) => (
    <form key={f.id} onSubmit={(e) => { e.preventDefault(); unlock(f.id) }} className="fade-in rounded-xl border border-line bg-surface p-4 shadow-card">
      <label className="mb-2 flex items-center gap-2 font-semibold" htmlFor={`pw-${f.id}`}>
        <Icon name="lock" size={18} className="shrink-0 text-accent" /> <span dir="auto">{t('p2i.locked', { name: f.name })}</span>
      </label>
      <div className="flex gap-2">
        <input
          id={`pw-${f.id}`}
          type="password"
          autoComplete="off"
          value={input[f.id] ?? ''}
          onChange={(e) => setInput((p) => ({ ...p, [f.id]: e.target.value }))}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-paper px-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          placeholder={t('p2i.pwPlaceholder')}
        />
        <Button type="submit" variant="secondary">{t('p2i.unlock')}</Button>
      </div>
      {(lockOf(f) as { wrong?: boolean }).wrong && <p className="mt-2 text-sm font-semibold text-danger" role="alert">{t('p2i.wrongPw')}</p>}
      <p className="mt-2 text-sm text-muted">{t('p2i.pwNote')}</p>
    </form>
  ))

  return { locked, checking, passwordOf, extra, prompts, reset }
}
