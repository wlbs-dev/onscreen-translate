// lib/editor/fontSize.ts
// Mirrors the auto font-size rule in scripts/render_translations.py so the
// editor preview matches the render:
//   font_size = max(FONT_SIZE_MIN, min(FONT_SIZE_MAX, int(bh * FONT_SIZE_RATIO)))
// The renderer uses an explicit size only when it is > 0; anything else
// (missing, 0) means auto.

import type { OverlayEvent } from "./types"

export const FONT_SIZE_MIN   = 14
export const FONT_SIZE_MAX   = 72
export const FONT_SIZE_RATIO = 0.55

/** Auto size for a box, in video pixels (Python int() truncates → Math.floor) */
export function autoFontSize(bbox: OverlayEvent["bbox"]): number {
  const bh = Math.max(1, Math.round(bbox[3]) - Math.round(bbox[1]))
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.floor(bh * FONT_SIZE_RATIO)))
}

export function isAutoFontSize(ev: Pick<OverlayEvent, "fontSize">): boolean {
  return !(ev.fontSize && ev.fontSize > 0)
}

/** Font size the preview should draw with, in video pixels */
export function effectiveFontSize(ev: Pick<OverlayEvent, "fontSize" | "bbox">): number {
  return isAutoFontSize(ev) ? autoFontSize(ev.bbox) : (ev.fontSize as number)
}
