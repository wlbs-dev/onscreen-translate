// lib/editor/indicFonts.ts
// The renderer (scripts/render_translations.py) draws overlays with every
// bundled Noto Sans Indic font in a fallback stack. Load the same fonts in the
// editor so the canvas preview matches it. Keep in sync with scripts/languages.py.

export const INDIC_FONT_FILES = [
  "NotoSansDevanagari-Regular.ttf",  // first: also carries Latin glyphs
  "NotoSansBengali-Regular.ttf",
  "NotoSansGujarati-Regular.ttf",
  "NotoSansGurmukhi-Regular.ttf",
  "NotoSansKannada-Regular.ttf",
  "NotoSansMalayalam-Regular.ttf",
  "NotoSansOriya-Regular.ttf",
  "NotoSansTamil-Regular.ttf",
  "NotoSansTelugu-Regular.ttf",
]

const family = (i: number) => `OTIndic${i}`

/** CSS font-family stack matching the renderer's */
export const INDIC_FONT_STACK =
  INDIC_FONT_FILES.map((_, i) => `"${family(i)}"`).join(", ") + ", sans-serif"

let loading: Promise<void> | null = null

/** Load all preview fonts once per page; resolves even if some fail. */
export function loadIndicFonts(): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve()
  loading ??= Promise.allSettled(
    INDIC_FONT_FILES.map(async (file, i) => {
      const face = new FontFace(family(i), `url(/api/fonts?file=${encodeURIComponent(file)})`)
      document.fonts.add(await face.load())
    })
  ).then(() => undefined)
  return loading
}
