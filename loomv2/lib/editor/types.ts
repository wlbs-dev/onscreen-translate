// lib/editor/types.ts
// Shared editor types. VideoPlayer re-exports OverlayEvent for existing imports.

export interface OverlayEvent {
  id: string; blockText: string; translation: string
  bbox: [number, number, number, number]
  /** User-chosen colours. Empty/unset → auto (see colors.ts); only these are overrides */
  bgColor?: string; textColor?: string
  /** Background sampled by OCR around the original box, for the preview */
  autoBgColor?: string
  /** Fill colour of the original text (OCR); erase mode reuses it */
  autoTextColor?: string
  /**
   * How the original text is covered. "erase" (default) removes it and
   * rebuilds the background; "box" draws a flat patch. Unset + an explicit
   * bgColor means box, matching render_translations.py.
   */
  cover?: "erase" | "box"
  /** Explicit weight choice; unset → autoBold (OCR's stroke-width guess) */
  bold?: boolean
  autoBold?: boolean
  /** Explicit font size in video pixels. Unset (or 0) → auto-fit to box height, see fontSize.ts */
  fontSize?: number
  startTime: number; endTime: number; frameIndex: number
}

export type EventPatches = Record<string, Partial<OverlayEvent>>

function sameValue(a: unknown, b: unknown) {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => v === b[i])
  return a === b
}

/**
 * Apply per-id patches immutably. Returns `prev` itself when nothing actually
 * changes, so history can skip no-op entries (e.g. a click without a drag).
 */
export function applyPatches(prev: OverlayEvent[], patches: EventPatches): OverlayEvent[] {
  let changed = false
  const next = prev.map((ev) => {
    const patch = patches[ev.id]
    if (!patch) return ev
    const keys = Object.keys(patch) as (keyof OverlayEvent)[]
    if (keys.every((k) => sameValue(ev[k], patch[k]))) return ev
    changed = true
    return { ...ev, ...patch }
  })
  return changed ? next : prev
}
