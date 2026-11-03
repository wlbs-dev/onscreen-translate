#!/usr/bin/env python3
"""
translate_detections.py — Translate OCR detections into an Indian language via Sarvam AI

Two workflows:
  --ai    Use OpenAI to semantically group blocks before translating (better
          for infographic / keyword-style videos where words don't form sentences)
  (none)  Sarvam translates each on-screen block on its own — best when each
          box holds a complete phrase (titles, labels, captions)

Usage:
    # Original workflow
    python translate_detections.py --detections annotated/ocr_detections.json

    # AI-assisted workflow
    python translate_detections.py --detections annotated/ocr_detections.json --ai

    # Another target language (see languages.py)
    python translate_detections.py --detections annotated/ocr_detections.json --target-lang hi-IN
"""

import argparse
import hashlib
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from languages import DEFAULT_LANG, LANGUAGES, STYLE_NOTES, language_name


def setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%H:%M:%S")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(fmt)
    logging.basicConfig(level=level, handlers=[h])

logger = logging.getLogger(__name__)

# SARVAM_API_URL overrides the endpoint (self-hosted proxy, tests)
SARVAM_ENDPOINT   = os.environ.get("SARVAM_API_URL", "https://api.sarvam.ai/translate")
SARVAM_SRC_LANG   = "en-IN"
SARVAM_MODEL      = "mayura:v1"
OPENAI_MODEL      = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
BACKOFF_SECONDS   = [5, 15, 30, 60]
CACHE_FILE        = "cache/translation_cache.json"
OVERLAP_THRESHOLD = 0.3
IGNORE_WORDS      = {"danmusic", "dan-music"}

# Set from --target-lang in main()
TARGET_LANG       = DEFAULT_LANG


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Translate OCR detections into an Indian language")
    p.add_argument("--detections", required=True, help="Path to ocr_detections.json")
    p.add_argument("--output",     default=None)
    p.add_argument("--target-lang", default=DEFAULT_LANG, choices=sorted(LANGUAGES),
                   help=f"Sarvam target language code (default {DEFAULT_LANG})")
    p.add_argument("--ai",         action="store_true",
                   help="Use OpenAI to semantically group blocks before translating")
    p.add_argument("--verbose",    action="store_true")
    return p.parse_args()


# ── Sarvam translation ────────────────────────────────────────────────────────

def _cache_get(cache: dict, key: str):
    """Look up a language-scoped key; Marathi also checks pre-multi-language keys."""
    scoped = f"{TARGET_LANG}:{key}"
    if scoped in cache:
        return cache[scoped]
    if TARGET_LANG == "mr-IN" and key in cache:
        return cache[key]
    return None


def _cache_put(cache: dict, key: str, value) -> None:
    cache[f"{TARGET_LANG}:{key}"] = value


def sarvam_translate(text: str, cache: dict) -> str:
    cache_key = hashlib.md5(text.strip().lower().encode("utf-8")).hexdigest()
    hit = _cache_get(cache, cache_key)
    if hit is not None:
        logger.debug(f"  Cache hit: '{text[:40]}'")
        return hit

    api_key = os.environ.get("SARVAM_API_KEY", "")
    payload = json.dumps({
        "input":                text,
        "source_language_code": SARVAM_SRC_LANG,
        "target_language_code": TARGET_LANG,
        "model":                SARVAM_MODEL,
        "enable_preprocessing": True,
    }).encode("utf-8")

    req = urllib.request.Request(
        SARVAM_ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json", "api-subscription-key": api_key},
        method="POST",
    )

    for attempt in range(len(BACKOFF_SECONDS) + 1):
        if attempt > 0:
            wait = BACKOFF_SECONDS[min(attempt - 1, len(BACKOFF_SECONDS) - 1)]
            logger.warning(f"  Retry in {wait}s (attempt {attempt + 1})...")
            time.sleep(wait)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            translation = body.get("translated_text", text)
            _cache_put(cache, cache_key, translation)
            return translation
        except urllib.error.HTTPError as e:
            if e.code == 429:
                continue
            logger.error(f"  Sarvam HTTP {e.code}: {e.read().decode()[:200]}")
            return text
        except Exception as e:
            logger.warning(f"  Sarvam error: {e}")
            continue
    return text


# ── OpenAI grouping + translation ─────────────────────────────────────────────

def openai_group_and_translate(blocks: list[str], cache: dict) -> dict[int, str]:
    """
    Send unique block texts to OpenAI. It groups semantically related blocks
    and translates each group into the target language.
    Returns {block_index: translation}
    """
    if not blocks:
        return {}

    cache_key = f"ai:{OPENAI_MODEL}:" + hashlib.md5(json.dumps(blocks, ensure_ascii=False).encode()).hexdigest()
    hit = _cache_get(cache, cache_key)
    if hit is None and TARGET_LANG == "mr-IN":
        # Entries written before the model was part of the key
        hit = _cache_get(cache, "ai:" + cache_key.split(":", 2)[2])
    if hit is not None:
        logger.debug("  AI cache hit")
        # JSON round-trips dict keys as strings
        return {int(k): v for k, v in hit.items()}

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        logger.error("OPENAI_API_KEY not set — falling back to per-block Sarvam translation")
        return {}

    numbered = "\n".join(f"{i}. {text}" for i, text in enumerate(blocks))
    lang = language_name(TARGET_LANG)
    style = STYLE_NOTES.get(TARGET_LANG, "")
    prompt = f"""You are a {lang} translator for on-screen video text.

The blocks below together form one or more complete sentences, split across screen positions. Translate the full meaning naturally, then distribute the translation across exactly {len(blocks)} parts — one part per block.

Rules:
- Translate the full thought into natural, fluent {lang}, not word-by-word. {style}
- Then split the {lang} output across exactly {len(blocks)} parts, proportional to how much English each block contains
- Each part should be a meaningful chunk — not a single word unless the block itself is one word
- Technical/proper nouns stay in English
- Return ONLY valid JSON, no markdown

Blocks:
{numbered}

Output (must have exactly {len(blocks)} entries):
[
  {{"index": 0, "translation": "..."}},
  {{"index": 1, "translation": "..."}}
]"""

    payload = json.dumps({
        "model": OPENAI_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    for attempt in range(len(BACKOFF_SECONDS) + 1):
        if attempt > 0:
            wait = BACKOFF_SECONDS[min(attempt - 1, len(BACKOFF_SECONDS) - 1)]
            logger.warning(f"  OpenAI retry in {wait}s...")
            time.sleep(wait)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            raw = body["choices"][0]["message"]["content"].strip()

            # Strip markdown fences if model disobeys
            if raw.startswith("```"):
                raw = "\n".join(raw.split("\n")[1:])
            if raw.endswith("```"):
                raw = "\n".join(raw.split("\n")[:-1])

            groups = json.loads(raw)

            result: dict[int, str] = {}
            
            for item in groups:
                idx = item["index"]         
                if 0 <= idx < len(blocks):
                    result[idx] = item["translation"]

            for i in range(len(blocks)):
                if i not in result:
                    logger.warning(f"  AI missed block {i}: '{blocks[i]}' — will fallback")

            _cache_put(cache, cache_key, result)
            return result

        except urllib.error.HTTPError as e:
            if e.code == 429:
                continue
            logger.error(f"  OpenAI HTTP {e.code}: {e.read().decode()[:200]}")
            return {}
        except json.JSONDecodeError as e:
            logger.error(f"  OpenAI returned invalid JSON: {e}")
            return {}
        except Exception as e:
            logger.warning(f"  OpenAI error: {e}")
            continue

    return {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_clean_word(w: dict) -> bool:
    t = w["text"].strip()
    if len(t) <= 1:
        return False
    if t.replace(".", "").replace(",", "").isdigit():
        return False
    return sum(c.isalpha() for c in t) / max(len(t), 1) > 0.5


def get_word_set(frame: dict) -> set[str]:
    words = set()
    for block in frame["blocks"]:
        for w in block["words"]:
            if is_clean_word(w):
                word = w["text"].strip().lower()
                if word not in IGNORE_WORDS:
                    words.add(word)
    return words


def overlap_ratio(set_a: set, set_b: set) -> float:
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / max(len(set_a), len(set_b))


def load_cache() -> dict:
    Path("cache").mkdir(exist_ok=True)
    if os.path.isfile(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_cache(cache: dict) -> None:
    Path("cache").mkdir(exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


# ── Segmentation ──────────────────────────────────────────────────────────────

def segment_into_buckets(detections: list[dict]) -> list[list[dict]]:
    if not detections:
        return []

    buckets = []
    current_bucket = [detections[0]]
    prev_words = get_word_set(detections[0])

    for frame in detections[1:]:
        curr_words = get_word_set(frame)
        overlap = overlap_ratio(prev_words, curr_words)

        if overlap < OVERLAP_THRESHOLD:
            buckets.append(current_bucket)
            current_bucket = [frame]
        else:
            current_bucket.append(frame)

        prev_words = curr_words

    if current_bucket:
        buckets.append(current_bucket)

    logger.info(f"Segmented {len(detections)} frames into {len(buckets)} buckets")
    return buckets


def dedupe_blocks(bucket: list[dict]) -> list[str]:
    """
    Collect unique block texts across all frames in a bucket, preserving
    first-seen order.
    """
    seen = set()
    unique: list[str] = []
    for frame in bucket:
        for block in frame["blocks"]:
            t = block["text"].strip()
            key = t.lower()
            if key and key not in seen and key not in IGNORE_WORDS:
                seen.add(key)
                unique.append(t)
    return unique


def text_key(text: str) -> str:
    """Identity of an on-screen text across frames (OCR spacing varies)."""
    import re
    return re.sub(r"[\W_]+", "", text.lower())


# ── Workflow A: standard (Sarvam, per block) ──────────────────────────────────

def translate_bucket_standard(bucket: list[dict], cache: dict) -> dict[str, str]:
    """
    Translate each on-screen block of the bucket's last frame (when all text
    is visible) on its own with Sarvam. Returns {block_text_lower: translation}.

    This replaced joining every word into one sentence and handing translated
    words back to blocks by position: SOV languages (Hindi, Marathi, Tamil…)
    reorder words, so positional mapping put words in the wrong boxes.
    Use --ai when a sentence is split across several boxes.
    """
    last_frame = bucket[-1]
    text_to_translation: dict[str, str] = {}
    for block in last_frame["blocks"]:
        text = block["text"].strip()
        key = text_key(text)
        if not text or key in text_to_translation or key in IGNORE_WORDS:
            continue
        if not any(c.isalpha() for c in text):
            text_to_translation[key] = text  # numbers/symbols stay as-is
            continue
        text_to_translation[key] = sarvam_translate(text, cache)
        logger.info(f"  '{text}' -> '{text_to_translation[key]}'")
    return text_to_translation


# ── Workflow B: AI-assisted ───────────────────────────────────────────────────

def translate_bucket_ai(bucket: list[dict], cache: dict) -> dict[str, str]:
    """
    Translate using only the last frame (when all words are visible).
    Returns {block_text_lower: translation}.
    All blocks in the same semantic group share the same translation string.
    """
    last_frame = bucket[-1]
    last_frame_blocks = [b["text"].strip() for b in last_frame["blocks"] if b["text"].strip()]

    if not last_frame_blocks:
        return {}

    logger.info(f"  Translating from last frame: {last_frame_blocks}")

    ai_result = openai_group_and_translate(last_frame_blocks, cache)

    text_to_translation: dict[str, str] = {}
    for i, block_text in enumerate(last_frame_blocks):
        if i in ai_result:
            text_to_translation[text_key(block_text)] = ai_result[i]
            logger.info(f"  AI: '{block_text}' -> '{ai_result[i]}'")
        else:
            # Fallback: translate this block individually via Sarvam
            logger.info(f"  Fallback Sarvam for: '{block_text}'")
            translation = sarvam_translate(block_text, cache)
            text_to_translation[text_key(block_text)] = translation

    return text_to_translation


# OCR fields that must survive translation (the editor preview uses them)
PASSTHROUGH_FIELDS = ("autoBgColor", "autoTextColor")


def _passthrough(block: dict) -> dict:
    return {k: block[k] for k in PASSTHROUGH_FIELDS if k in block}


def apply_mapping(frame: dict, text_to_translation: dict) -> list[dict]:
    """
    Give each block the translation of the matching last-frame block. Blocks
    in earlier frames may be partial (text typing on), so fall back to any
    translated block sharing a word with it.
    """
    translated_blocks = []

    for block in frame["blocks"]:
        key = text_key(block["text"])
        translation = text_to_translation.get(key, "")

        if not translation:
            # Partial text (typing on): borrow from a block it is part of
            for full_key, full_translation in text_to_translation.items():
                if key and (key in full_key or full_key in key):
                    translation = full_translation
                    break

        translated_blocks.append({
            "text":        block["text"],
            "translation": translation,
            "bbox":        block["bbox"],
            "conf":        block["conf"],
            "words":       block.get("words", []),
            "merged":      False,
            **_passthrough(block),
        })

    return translated_blocks


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    global TARGET_LANG
    args = parse_args()
    setup_logging(args.verbose)
    TARGET_LANG = args.target_lang

    if not os.environ.get("SARVAM_API_KEY"):
        sys.exit("[ERROR] SARVAM_API_KEY not set in .env")

    if args.ai and not os.environ.get("OPENAI_API_KEY"):
        sys.exit("[ERROR] --ai requires OPENAI_API_KEY to be set in .env")

    detections_path = str(Path(args.detections).resolve())
    if not os.path.isfile(detections_path):
        sys.exit(f"[ERROR] File not found: {detections_path}")

    output_path = args.output or str(Path(detections_path).parent / "translated_detections.json")

    with open(detections_path, "r", encoding="utf-8") as f:
        detections = json.load(f)

    cache = load_cache()

    workflow = "AI-assisted (OpenAI grouping + Sarvam fallback)" if args.ai else "standard (Sarvam, per block)"
    logger.info(f"Workflow: {workflow}")
    logger.info(f"Target language: {language_name(TARGET_LANG)} ({TARGET_LANG})")

    buckets = segment_into_buckets(detections)

    translated = []
    for i, bucket in enumerate(buckets):
        logger.info(f"Bucket {i+1}/{len(buckets)} ({len(bucket)} frames)")
        print(f"PROGRESS:{i / max(len(buckets), 1):.3f}", flush=True)

        text_to_translation = (translate_bucket_ai(bucket, cache) if args.ai
                               else translate_bucket_standard(bucket, cache))
        for frame in bucket:
            translated.append({
                "frame_index": frame["frame_index"],
                "timestamp":   frame["timestamp"],
                "frame_path":  frame["frame_path"],
                "blocks":      apply_mapping(frame, text_to_translation),
            })

    save_cache(cache)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(translated, f, ensure_ascii=False, indent=2)

    logger.info(f"Saved to {output_path}")


if __name__ == "__main__":
    main()