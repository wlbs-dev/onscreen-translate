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

/** Bold counterparts (scripts/assets/bold/). They have no Latin glyphs. */
export const INDIC_BOLD_FILES = INDIC_FONT_FILES.map((f) => `bold/${f.replace("-Regular.ttf", "-Bold.ttf")}`)
/** Bold Latin, used by the renderer for Latin runs in bold text */
export const LATIN_BOLD_FILE = "bold/NotoSans-Bold.ttf"

/** Every font file /api/fonts may serve */
export const SERVABLE_FONT_FILES = [...INDIC_FONT_FILES, ...INDIC_BOLD_FILES, LATIN_BOLD_FILE]

const family = (i: number) => `OTIndic${i}`
const LATIN_FAMILY = "OTLatin"

/**
 * CSS font-family stack matching the renderer's. Each OTIndic family has a
 * 400 and a 700 face. OTLatin only has a 700 face: in regular text the
 * Devanagari font already covers Latin, in bold text it doesn't, so the
 * browser falls through to OTLatin — the same split the renderer makes.
 */
export const INDIC_FONT_STACK =
  [`"${family(0)}"`, `"${LATIN_FAMILY}"`, ...INDIC_FONT_FILES.slice(1).map((_, i) => `"${family(i + 1)}"`)]
    .join(", ") + ", sans-serif"

let loading: Promise<void> | null = null

const url = (file: string) => `url(/api/fonts?file=${encodeURIComponent(file)})`

/** Load all preview fonts once per page; resolves even if some fail. */
export function loadIndicFonts(): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve()
  const faces = [
    ...INDIC_FONT_FILES.map((file, i) => new FontFace(family(i), url(file), { weight: "400" })),
    ...INDIC_BOLD_FILES.map((file, i) => new FontFace(family(i), url(file), { weight: "700" })),
    new FontFace(LATIN_FAMILY, url(LATIN_BOLD_FILE), { weight: "700" }),
  ]
  loading ??= Promise.allSettled(
    faces.map(async (face) => { document.fonts.add(await face.load()) })
  ).then(() => undefined)
  return loading
}
