// lib/languages.ts
// Target languages for translation. Keep in sync with scripts/languages.py.
// Codes are Sarvam AI language codes.

export interface Language {
  code: string
  name: string
  native: string
}

export const LANGUAGES: Language[] = [
  { code: "hi-IN", name: "Hindi",     native: "हिन्दी" },
  { code: "mr-IN", name: "Marathi",   native: "मराठी" },
  { code: "bn-IN", name: "Bengali",   native: "বাংলা" },
  { code: "gu-IN", name: "Gujarati",  native: "ગુજરાતી" },
  { code: "pa-IN", name: "Punjabi",   native: "ਪੰਜਾਬੀ" },
  { code: "kn-IN", name: "Kannada",   native: "ಕನ್ನಡ" },
  { code: "ml-IN", name: "Malayalam", native: "മലയാളം" },
  { code: "od-IN", name: "Odia",      native: "ଓଡ଼ିଆ" },
  { code: "ta-IN", name: "Tamil",     native: "தமிழ்" },
  { code: "te-IN", name: "Telugu",    native: "తెలుగు" },
]

export const DEFAULT_LANG = "mr-IN"

export function isSupportedLang(code: unknown): code is string {
  return typeof code === "string" && LANGUAGES.some((l) => l.code === code)
}

export function languageName(code: string | undefined): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code ?? ""
}
