import { useId } from 'react'
import type { UserFacingError } from '../lib/validate'
import { useI18n } from '../i18n/context'

/** Optional page range for export tools: empty means every page. Same range for every file in a batch. */
export function PageRangeField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error: UserFacingError | null }) {
  const { t, tm } = useI18n()
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-2 block font-semibold">{t('conv.pages')}</label>
      <input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('conv.pagesAll')}
        aria-invalid={!!error}
        aria-describedby={`${id}-help`}
        data-testid="page-range"
        className={`h-11 w-full rounded-xl border bg-paper px-3 focus:outline-none focus:ring-4 focus:ring-accent/15 ${error ? 'border-danger' : 'border-line-strong focus:border-accent'}`}
      />
      <p id={`${id}-help`} className={`mt-1.5 text-sm ${error ? 'font-semibold text-danger' : 'text-muted'}`} role={error ? 'alert' : undefined}>
        {error ? tm(error.toMessage()) : t('conv.pagesHelp')}
      </p>
    </div>
  )
}
