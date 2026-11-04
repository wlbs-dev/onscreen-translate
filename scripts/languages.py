"""
languages.py — Target languages supported by the pipeline.

Keep in sync with loomv2/lib/languages.ts (the UI picker).
Codes are Sarvam AI language codes (mayura:v1 supports all of these).
"""

# code -> (English name, native name, bundled font file under assets/)
LANGUAGES: dict[str, tuple[str, str, str]] = {
    "hi-IN": ("Hindi",     "हिन्दी",   "NotoSansDevanagari-Regular.ttf"),
    "mr-IN": ("Marathi",   "मराठी",    "NotoSansDevanagari-Regular.ttf"),
    "bn-IN": ("Bengali",   "বাংলা",    "NotoSansBengali-Regular.ttf"),
    "gu-IN": ("Gujarati",  "ગુજરાતી",  "NotoSansGujarati-Regular.ttf"),
    "pa-IN": ("Punjabi",   "ਪੰਜਾਬੀ",   "NotoSansGurmukhi-Regular.ttf"),
    "kn-IN": ("Kannada",   "ಕನ್ನಡ",    "NotoSansKannada-Regular.ttf"),
    "ml-IN": ("Malayalam", "മലയാളം",  "NotoSansMalayalam-Regular.ttf"),
    "od-IN": ("Odia",      "ଓଡ଼ିଆ",    "NotoSansOriya-Regular.ttf"),
    "ta-IN": ("Tamil",     "தமிழ்",    "NotoSansTamil-Regular.ttf"),
    "te-IN": ("Telugu",    "తెలుగు",   "NotoSansTelugu-Regular.ttf"),
}

DEFAULT_LANG = "mr-IN"

# Extra per-language guidance for the LLM translator
STYLE_NOTES: dict[str, str] = {
    "mr-IN": "Use natural Marathi (SOV word order) — not Hindi vocabulary or grammar.",
    "hi-IN": "Use everyday spoken Hindi, not heavily Sanskritised formal Hindi.",
    "pa-IN": "Write in Gurmukhi script.",
    "od-IN": "Write in Odia script.",
}


def language_name(code: str) -> str:
    return LANGUAGES[code][0]


BOLD_DIR = "bold"
# Bold Latin lives in its own font: the notofonts Indic bolds have no Latin
BOLD_LATIN = "NotoSans-Bold.ttf"


def bold_font_file(regular: str) -> str:
    """assets/-relative path of the bold counterpart of a regular font file."""
    return f"{BOLD_DIR}/{regular.replace('-Regular.ttf', '-Bold.ttf')}"


def bold_font_files() -> list[str]:
    return [bold_font_file(f) for f in all_font_files()] + [f"{BOLD_DIR}/{BOLD_LATIN}"]


def all_font_files() -> list[str]:
    """Unique font files, Devanagari first (it also carries Latin glyphs)."""
    seen: list[str] = []
    for _, _, font in LANGUAGES.values():
        if font not in seen:
            seen.append(font)
    return seen
