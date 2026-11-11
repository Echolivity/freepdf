/**
 * Pixel comparison of two rendered pages. Both images are laid on a common white canvas (top-left
 * aligned), so pages of different sizes still compare. A pixel counts as changed when any channel
 * differs by more than `tolerance` (0–255). Changed pixels are coloured by direction: content only in
 * A (removed) red, only in B (added) green, otherwise amber; unchanged content is shown faintly.
 */
export interface PixelDiff {
  width: number
  height: number
  /** RGBA overlay, ready for putImageData. */
  data: Uint8ClampedArray
  changed: number
  /** Share of pixels that differ, 0–1. */
  ratio: number
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

export function diffPixels(
  a: { width: number; height: number; data: Uint8ClampedArray },
  b: { width: number; height: number; data: Uint8ClampedArray },
  tolerance: number,
): PixelDiff {
  const width = Math.max(a.width, b.width)
  const height = Math.max(a.height, b.height)
  const out = new Uint8ClampedArray(width * height * 4)
  let changed = 0
  const px = (img: typeof a, x: number, y: number, o: number[]) => {
    if (x < img.width && y < img.height) {
      const i = (y * img.width + x) * 4
      // Composite over white (rendered pages are opaque, but be safe).
      const al = img.data[i + 3] / 255
      o[0] = img.data[i] * al + 255 * (1 - al)
      o[1] = img.data[i + 1] * al + 255 * (1 - al)
      o[2] = img.data[i + 2] * al + 255 * (1 - al)
    } else o[0] = o[1] = o[2] = 255
  }
  const pa = [0, 0, 0]
  const pb = [0, 0, 0]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      px(a, x, y, pa)
      px(b, x, y, pb)
      const o = (y * width + x) * 4
      const d = Math.max(Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1]), Math.abs(pa[2] - pb[2]))
      if (d > tolerance) {
        changed++
        const la = lum(pa[0], pa[1], pa[2])
        const lb = lum(pb[0], pb[1], pb[2])
        if (la + 24 < lb) { out[o] = 220; out[o + 1] = 38; out[o + 2] = 38 } // ink only in A: removed
        else if (lb + 24 < la) { out[o] = 22; out[o + 1] = 163; out[o + 2] = 74 } // ink only in B: added
        else { out[o] = 217; out[o + 1] = 119; out[o + 2] = 6 } // changed colour
        out[o + 3] = 255
      } else {
        // Unchanged: faint grey version of the page for context.
        const v = 255 - (255 - lum(pb[0], pb[1], pb[2])) * 0.25
        out[o] = out[o + 1] = out[o + 2] = v
        out[o + 3] = 255
      }
    }
  }
  return { width, height, data: out, changed, ratio: changed / (width * height) }
}
