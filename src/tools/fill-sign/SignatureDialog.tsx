import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button, Segmented } from '../../components/ui'
import { useI18n } from '../../i18n/context'

export interface Signature {
  /** PNG with a transparent background, cropped to the ink. */
  png: Uint8Array
  url: string
  width: number
  height: number
}

type Mode = 'draw' | 'type' | 'upload'
const INK = '#111827'

/** Crop a canvas to its non-transparent pixels (plus a small margin) and return it as a PNG signature. */
async function finish(src: HTMLCanvasElement): Promise<Signature | null> {
  const ctx = src.getContext('2d')!
  const { width, height } = src
  const data = ctx.getImageData(0, 0, width, height).data
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return null
  const m = 6
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(width - 1, x1 + m); y1 = Math.min(height - 1, y1 + m)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1
  out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'))
  if (!blob) return null
  return { png: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), width: out.width, height: out.height }
}

/**
 * Make a photo or scan of a signature usable: light paper becomes transparent (with a soft edge so
 * strokes stay smooth) and the ink keeps its colour.
 */
function removeBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const img = ctx.getImageData(0, 0, width, height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const a = lum >= 215 ? 0 : lum <= 165 ? 255 : Math.round(((215 - lum) / 50) * 255)
    d[i + 3] = Math.min(d[i + 3], a)
  }
  ctx.putImageData(img, 0, 0)
}

export function SignatureDialog({ onDone, onClose }: { onDone: (s: Signature) => void; onClose: () => void }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const pad = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<{ x: number; y: number } | null>(null)
  const [mode, setMode] = useState<Mode>('draw')
  const [drawn, setDrawn] = useState(false)
  const [typed, setTyped] = useState('')
  const [upload, setUpload] = useState<HTMLCanvasElement | null>(null)
  const [error, setError] = useState(false)
  const titleId = useId()
  const typedId = useId()

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    return () => d?.close()
  }, [])

  // The drawing pad works in device pixels so strokes stay crisp.
  useEffect(() => {
    const c = pad.current
    if (!c || mode !== 'draw') return
    const r = c.getBoundingClientRect()
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    c.width = Math.round(r.width * dpr)
    c.height = Math.round(r.height * dpr)
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.6
    ctx.strokeStyle = INK
    setDrawn(false)
  }, [mode])

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = point(e)
    const ctx = e.currentTarget.getContext('2d')!
    ctx.beginPath()
    ctx.arc(drawing.current.x, drawing.current.y, 1.2, 0, Math.PI * 2)
    ctx.fillStyle = INK
    ctx.fill()
    setDrawn(true)
  }
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const from = drawing.current
    if (!from) return
    const to = point(e)
    const ctx = e.currentTarget.getContext('2d')!
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.quadraticCurveTo(from.x, from.y, (from.x + to.x) / 2, (from.y + to.y) / 2)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    drawing.current = to
  }
  const up = () => { drawing.current = null }
  const clear = () => {
    const c = pad.current
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setDrawn(false)
  }

  const onFile = async (file: File | undefined) => {
    setError(false)
    if (!file) return
    try {
      const bmp = await createImageBitmap(file)
      const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(bmp.width * scale))
      c.height = Math.max(1, Math.round(bmp.height * scale))
      const ctx = c.getContext('2d')!
      ctx.drawImage(bmp, 0, 0, c.width, c.height)
      bmp.close()
      removeBackground(ctx, c.width, c.height)
      setUpload(c)
    } catch {
      setError(true)
    }
  }

  const use = async () => {
    let src: HTMLCanvasElement | null = null
    if (mode === 'draw' && drawn) src = pad.current
    else if (mode === 'upload') src = upload
    else if (mode === 'type' && typed.trim()) {
      src = document.createElement('canvas')
      const size = 96
      const ctx = src.getContext('2d')!
      const font = `italic 500 ${size}px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive, "IBM Plex Sans Arabic", serif`
      ctx.font = font
      src.width = Math.ceil(ctx.measureText(typed).width + size)
      src.height = Math.ceil(size * 1.6)
      const c2 = src.getContext('2d')!
      c2.font = font
      c2.fillStyle = INK
      c2.textBaseline = 'middle'
      c2.direction = 'inherit'
      c2.fillText(typed, size / 2, src.height / 2)
    }
    if (!src) return
    const s = await finish(src)
    if (s) onDone(s)
  }

  const ready = (mode === 'draw' && drawn) || (mode === 'type' && !!typed.trim()) || (mode === 'upload' && !!upload)
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby={titleId} className="m-auto w-[min(36rem,94vw)] rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-black/50" data-testid="signature-dialog">
      <div className="space-y-4 p-5">
        <h2 id={titleId} className="font-display text-xl font-bold">{t('fs.sigTitle')}</h2>
        <Segmented<Mode>
          label={t('fs.sigHow')}
          value={mode}
          onChange={setMode}
          options={[{ value: 'draw', label: t('fs.sigDraw') }, { value: 'type', label: t('fs.sigType') }, { value: 'upload', label: t('fs.sigUpload') }]}
        />
        {mode === 'draw' && (
          <div className="space-y-2">
            <canvas
              ref={pad}
              aria-label={t('fs.sigPad')}
              className="h-44 w-full touch-none rounded-xl border-2 border-dashed border-line-strong bg-white"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              data-testid="signature-pad"
            />
            <div className="flex items-center justify-between text-sm text-muted">
              <span>{t('fs.sigDrawHint')}</span>
              <button type="button" className="font-semibold text-accent underline" onClick={clear}>{t('fs.sigClear')}</button>
            </div>
          </div>
        )}
        {mode === 'type' && (
          <div className="space-y-2">
            <label htmlFor={typedId} className="block font-semibold">{t('fs.sigName')}</label>
            <input id={typedId} dir="auto" value={typed} onChange={(e) => setTyped(e.target.value)} className="h-11 w-full rounded-xl border border-line-strong bg-paper px-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15" data-testid="signature-typed" />
            {typed.trim() && <p dir="auto" className="rounded-xl bg-white px-4 py-3 text-4xl italic text-[#111827]" style={{ fontFamily: '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive' }}>{typed}</p>}
          </div>
        )}
        {mode === 'upload' && (
          <div className="space-y-2">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void onFile(e.target.files?.[0])} className="block w-full text-sm" aria-label={t('fs.sigUpload')} data-testid="signature-file" />
            <p className="text-sm text-muted">{t('fs.sigUploadHint')}</p>
            {upload && <img alt="" src={upload.toDataURL()} className="max-h-36 rounded-xl bg-white p-2" />}
            {error && <p className="text-sm font-semibold text-danger">{t('fs.sigUploadError')}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => ref.current?.close()}>{t('fs.cancel')}</Button>
          <Button variant="primary" disabled={!ready} onClick={() => void use()} data-testid="signature-use">{t('fs.sigUse')}</Button>
        </div>
      </div>
    </dialog>
  )
}
