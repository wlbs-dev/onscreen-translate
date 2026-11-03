// lib/editor/colors.ts
// Mirrors scripts/colors.py so the preview shows what the renderer will draw.
// An empty bgColor / textColor means "auto": the renderer samples the
// background around the box and picks white or black text for contrast.

import type { OverlayEvent } from "./types"

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export const isHex = (v: string | undefined): v is string => !!v && HEX_RE.test(v)

/** Background the renderer will use: user choice, else OCR's sampled colour */
export function effectiveBg(ev: Pick<OverlayEvent, "bgColor" | "autoBgColor">): string {
  if (isHex(ev.bgColor)) return ev.bgColor
  if (isHex(ev.autoBgColor)) return ev.autoBgColor
  return "#000000"
}

/** White on dark backgrounds, black on light ones (Rec. 601 luma) */
export function autoTextColor(bgHex: string): string {
  const n = parseInt(bgHex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? "#ffffff" : "#000000"
}

export function effectiveText(ev: Pick<OverlayEvent, "bgColor" | "autoBgColor" | "textColor">): string {
  return isHex(ev.textColor) ? ev.textColor : autoTextColor(effectiveBg(ev))
}
