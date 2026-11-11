/**
 * Page geometry as the reader sees it. PDF pages can have a /Rotate attribute and a CropBox that doesn't
 * start at (0, 0); tools that place things "at the bottom right" or crop "the top 2 cm" must work in
 * visual space and map back to the page's own (unrotated) coordinates. Pure functions, no pdf-lib.
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export const normRotation = (a: number) => ((Math.round(a / 90) * 90) % 360 + 360) % 360

/** Visible size of a page: the crop box, with width and height swapped for 90°/270°. */
export function visualSize(box: Box, rotation: number): { width: number; height: number } {
  return normRotation(rotation) % 180 ? { width: box.height, height: box.width } : { width: box.width, height: box.height }
}

/**
 * Map a point in visual coordinates (origin at the bottom-left of what the reader sees, y up) to the
 * page's user space. Also returns the text angle (degrees, counter-clockwise in user space) that makes
 * text drawn there read upright on screen.
 */
export function visualToUser(box: Box, rotation: number, vx: number, vy: number): { x: number; y: number; angle: number } {
  const { x: x0, y: y0, width: w, height: h } = box
  switch (normRotation(rotation)) {
    case 90:
      return { x: x0 + w - vy, y: y0 + vx, angle: 90 }
    case 180:
      return { x: x0 + w - vx, y: y0 + h - vy, angle: 180 }
    case 270:
      return { x: x0 + vy, y: y0 + h - vx, angle: 270 }
    default:
      return { x: x0 + vx, y: y0 + vy, angle: 0 }
  }
}

/**
 * Convert a rectangle given as visual insets (how much to cut from the top, right, bottom and left of
 * what the reader sees) into the new box in user space.
 */
export function insetVisual(box: Box, rotation: number, inset: { top: number; right: number; bottom: number; left: number }): Box {
  // Map the visual insets onto the unrotated sides of the box.
  let { top, right, bottom, left } = inset
  switch (normRotation(rotation)) {
    case 90: // visual top = user left side, visual right = user top, visual bottom = user right, visual left = user bottom
      ;[left, top, right, bottom] = [inset.top, inset.right, inset.bottom, inset.left]
      break
    case 180:
      ;[top, right, bottom, left] = [inset.bottom, inset.left, inset.top, inset.right]
      break
    case 270: // visual top = user right, visual right = user bottom, visual bottom = user left, visual left = user top
      ;[right, bottom, left, top] = [inset.top, inset.right, inset.bottom, inset.left]
      break
  }
  return { x: box.x + left, y: box.y + bottom, width: box.width - left - right, height: box.height - top - bottom }
}
