// lib/editor/shortcuts.ts
// Helpers for the editor's global keyboard shortcuts.

const TEXT_INPUT_TYPES = new Set([
  "text", "search", "url", "tel", "email", "password", "number",
  "date", "datetime-local", "month", "time", "week",
])

/** True when the key event should go to a text field instead of the editor */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === "TEXTAREA" || tag === "SELECT") return true
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has((target as HTMLInputElement).type)
  return false
}

export const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

export interface ShortcutHelp { keys: string[]; label: string }

/** Listed in the "?" help dialog. "Mod" renders as ⌘ on macOS, Ctrl elsewhere. */
export const SHORTCUTS: { group: string; items: ShortcutHelp[] }[] = [
  {
    group: "Playback",
    items: [
      { keys: ["Space"], label: "Play / pause" },
      { keys: ["←", "→"], label: "Seek 0.1s" },
      { keys: ["Shift", "← / →"], label: "Seek 1s" },
    ],
  },
  {
    group: "Editing",
    items: [
      { keys: ["Mod", "Z"], label: "Undo" },
      { keys: ["Mod", "Shift", "Z"], label: "Redo (also Ctrl+Y)" },
      { keys: ["Alt", "← / →"], label: "Nudge selected clips 0.1s" },
      { keys: ["Alt", "Shift", "← / →"], label: "Nudge selected clips 1s" },
      { keys: ["Delete"], label: "Delete selected clips" },
      { keys: ["Mod", "S"], label: "Save" },
    ],
  },
  {
    group: "Selection & timeline",
    items: [
      { keys: ["Shift / Mod", "Click"], label: "Add / remove clip from selection" },
      { keys: ["Esc"], label: "Clear selection" },
      { keys: ["Alt", "Drag"], label: "Drag without snapping" },
      { keys: ["Mod", "Scroll"], label: "Zoom timeline" },
      { keys: ["?"], label: "Show this help" },
    ],
  },
]
