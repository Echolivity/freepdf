import type { FontFamily } from '../lib/pdf/fonts'
import { useI18n } from '../i18n/context'

export const field = 'h-11 w-full rounded-xl border border-line-strong bg-paper px-3 tabular-nums focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15'

/** Font, weight, size and colour controls shared by Page numbers and Watermark. */
export function FontPicker({ font, onFont, bold, onBold, size, onSize, color, onColor }: {
  font: FontFamily; onFont: (f: FontFamily) => void
  bold: boolean; onBold: (b: boolean) => void
  size: string; onSize: (s: string) => void
  color: string; onColor: (c: string) => void
}) {
  const { t } = useI18n()
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-semibold">{t('stamp.text')}</legend>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="block"><span className="sr-only">{t('stamp.font')}</span>
          <select value={font} onChange={(e) => onFont(e.target.value as FontFamily)} className={field} aria-label={t('stamp.font')} data-testid="font">
            <option value="helvetica">Helvetica</option>
            <option value="times">Times</option>
            <option value="courier">Courier</option>
            <option value="plex">{t('stamp.font.plex')}</option>
          </select></label>
        <label className="flex h-11 items-center gap-2 rounded-xl border border-line-strong bg-paper px-3 text-sm font-semibold">
          <input type="checkbox" checked={bold} onChange={(e) => onBold(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
          {t('stamp.bold')}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('stamp.size')}</span>
          <input value={size} onChange={(e) => onSize(e.target.value)} inputMode="decimal" dir="ltr" className={field} data-testid="font-size" /></label>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">{t('stamp.color')}</span>
          <input type="color" value={color} onChange={(e) => onColor(e.target.value)} className="h-11 w-full cursor-pointer rounded-xl border border-line-strong bg-paper p-1" data-testid="color" /></label>
      </div>
      <p className="text-xs text-muted">{t('stamp.fontNote')}</p>
    </fieldset>
  )
}
