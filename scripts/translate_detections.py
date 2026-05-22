#!/usr/bin/env python3
"""
translate_detections.py — Translate OCR detections via Sarvam AI

Two workflows:
  --ai    Use OpenAI to semantically group blocks before translating (better
          for infographic / keyword-style videos where words don't form sentences)
  (none)  Original word-mapping approach via Sarvam — works well when full
          sentences appear on screen

Supported models: sarvam, openai-gpt4o, openai-gpt4o-mini, anthropic-claude

Usage:
    # Original workflow
    python translate_detections.py --detections annotated/ocr_detections.json

    # AI-assisted workflow with specific model
    python translate_detections.py --detections annotated/ocr_detections.json --ai --model openai-gpt4o-mini
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


def setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%H:%M:%S")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(fmt)
    logging.basicConfig(level=level, handlers=[h])

logger = logging.getLogger(__name__)

SARVAM_ENDPOINT   = "https://api.sarvam.ai/translate"
SARVAM_SRC_LANG   = "en-IN"
SARVAM_TGT_LANG   = "mr-IN"
SARVAM_MODEL      = "mayura:v1"
BACKOFF_SECONDS   = [5, 15, 30, 60]
CACHE_FILE        = "cache/translation_cache.json"
OVERLAP_THRESHOLD = 0.3
IGNORE_WORDS      = {"danmusic", "dan-music"}

# Model info: name -> (api_endpoint_key, pricing_per_1k_tokens_cents)
MODEL_INFO = {
    "sarvam": {
        "provider": "sarvam",
        "endpoint": "https://api.sarvam.ai/translate",
        "cost_per_1k_tokens": 0.5,  # cents
        "model_name": "mayura:v1"
    },
    "openai-gpt4o": {
        "provider": "openai",
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "cost_per_1k_tokens": 3.0,  # approx cents
        "model_name": "gpt-4o"
    },
    "openai-gpt4o-mini": {
        "provider": "openai",
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "cost_per_1k_tokens": 0.15,  # cents
        "model_name": "gpt-4o-mini"
    },
    "anthropic-claude": {
        "provider": "anthropic",
        "endpoint": "https://api.anthropic.com/v1/messages",
        "cost_per_1k_tokens": 3.0,  # approx cents
        "model_name": "claude-3-5-sonnet-20241022"
    }
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Translate OCR detections to Marathi")
    p.add_argument("--detections", required=True, help="Path to ocr_detections.json")
    p.add_argument("--output",     default=None)
    p.add_argument("--ai",         action="store_true",
                   help="Use AI to semantically group blocks before translating")
    p.add_argument("--model",      default="openai-gpt4o-mini",
                   choices=list(MODEL_INFO.keys()),
                   help="Translation model to use")
    p.add_argument("--verbose",    action="store_true")
    return p.parse_args()


# ── Token estimation ─────────────────────────────────────────────────────────

def estimate_tokens(text: str, model: str = "openai-gpt4o-mini") -> int:
    """
    Rough token estimation: ~1 token per 4 characters for English,
    ~1 token per 2 characters for Marathi.
    """
    # Simple heuristic: 1 token ≈ 4 chars for English content
    return max(1, len(text) // 4)


def estimate_total_tokens(detections: list[dict], model: str) -> int:
    """Estimate total tokens needed to translate all detections."""
    total = 0
    for frame in detections:
        for block in frame.get("blocks", []):
            text = block.get("text", "")
            if text.strip():
                total += estimate_tokens(text, model)
    return total


# ── Sarvam translation ────────────────────────────────────────────────────────

def sarvam_translate(text: str, cache: dict) -> str:
    cache_key = hashlib.md5(text.strip().lower().encode("utf-8")).hexdigest()
    if cache_key in cache:
        logger.debug(f"  Cache hit: '{text[:40]}'")
        return cache[cache_key]

    api_key = os.environ.get("SARVAM_API_KEY", "")
    payload = json.dumps({
        "input":                text,
        "source_language_code": SARVAM_SRC_LANG,
        "target_language_code": SARVAM_TGT_LANG,
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
            cache[cache_key] = translation
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
    and translates each group into Marathi.
    Returns {block_index: marathi_translation}
    """
    if not blocks:
        return {}

    cache_key = "ai:" + hashlib.md5(json.dumps(blocks, ensure_ascii=False).encode()).hexdigest()
    if cache_key in cache:
        logger.debug("  AI cache hit")
        return cache[cache_key]

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        logger.error("OPENAI_API_KEY not set — falling back to per-block Sarvam translation")
        return {}

    # Get model from environment (set by the API)
    translation_model = os.environ.get("TRANSLATION_MODEL", "openai-gpt4o-mini")
    model_name = MODEL_INFO.get(translation_model, {}).get("model_name", "gpt-4o-mini")

    numbered = "\n".join(f"{i}. {text}" for i, text in enumerate(blocks))
    prompt = f"""You are a Marathi translator for video subtitles.

The blocks below together form one or more complete sentences, split across screen positions. Translate the full meaning naturally, then distribute the translation across exactly {len(blocks)} parts — one part per block.

Rules:
- Translate the full thought for natural fluent Marathi (SOV word order, not Hindi)
- Then split the Marathi output across exactly {len(blocks)} parts, proportional to how much English each block contains
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
        "model": model_name,
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

            cache[cache_key] = result
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


# ── Workflow A: original (no AI) ──────────────────────────────────────────────

def translate_bucket_original(bucket: list[dict], cache: dict) -> dict[str, str]:
    """
    Collect unique clean words from the last frame, translate as one sentence,
    map Marathi words back one-by-one.
    Returns {english_word_lower: marathi_word}
    """
    last_frame = bucket[-1]

    seen = set()
    ordered_words = []
    for block in last_frame["blocks"]:
        for w in block["words"]:
            if not is_clean_word(w):
                continue
            for token in w["text"].strip().split():
                if token.lower() not in seen:
                    seen.add(token.lower())
                    ordered_words.append(token)

    if not ordered_words:
        return {}

    full_sentence = " ".join(w.capitalize() for w in ordered_words)
    logger.info(f"  Sentence: '{full_sentence}'")

    full_translation = sarvam_translate(full_sentence, cache)
    logger.info(f"  Translation: '{full_translation}'")

    mr_words = full_translation.split()
    word_to_marathi: dict[str, str] = {}
    for i, en_word in enumerate(ordered_words):
        word_to_marathi[en_word.lower()] = mr_words[i] if i < len(mr_words) else ""
        logger.debug(f"    '{en_word}' -> '{word_to_marathi[en_word.lower()]}'")

    return word_to_marathi


def apply_mapping_original(frame: dict, word_to_marathi: dict) -> list[dict]:
    translated_blocks = []
    for block in frame["blocks"]:
        clean_words = [w for w in block["words"] if is_clean_word(w)]

        if not clean_words:
            translated_blocks.append({
                "text":        block["text"],
                "translation": "",
                "bbox":        block["bbox"],
                "conf":        block["conf"],
                "words":       block["words"],
            })
            continue

        marathi_parts = []
        for w in clean_words:
            tokens = w["text"].strip().lower().split()
            for token in tokens:
                mr = word_to_marathi.get(token, "")
                if mr:
                    marathi_parts.append(mr)

        translated_blocks.append({
            "text":        " ".join(w["text"] for w in clean_words),
            "translation": " ".join(marathi_parts),
            "bbox":        block["bbox"],
            "conf":        block["conf"],
            "words":       clean_words,
        })

    return translated_blocks


# ── Workflow B: AI-assisted ───────────────────────────────────────────────────

def translate_bucket_ai(bucket: list[dict], cache: dict) -> dict[str, str]:
    """
    Translate using only the last frame (when all words are visible).
    Returns {block_text_lower: marathi_translation}.
    All blocks in the same semantic group share the same translation string;
    apply_mapping_ai will only emit it once (topmost block).
    """
    last_frame = bucket[-1]
    last_frame_blocks = [b["text"].strip() for b in last_frame["blocks"] if b["text"].strip()]

    if not last_frame_blocks:
        return {}

    logger.info(f"  Translating from last frame: {last_frame_blocks}")

    ai_result = openai_group_and_translate(last_frame_blocks, cache)

    text_to_marathi: dict[str, str] = {}
    for i, block_text in enumerate(last_frame_blocks):
        if i in ai_result:
            text_to_marathi[block_text.lower()] = ai_result[i]
            logger.info(f"  AI: '{block_text}' -> '{ai_result[i]}'")
        else:
            # Fallback: translate this block individually via Sarvam
            logger.info(f"  Fallback Sarvam for: '{block_text}'")
            translation = sarvam_translate(block_text, cache)
            text_to_marathi[block_text.lower()] = translation

    return text_to_marathi


def apply_mapping_ai(frame: dict, text_to_marathi: dict) -> list[dict]:
    translated_blocks = []

    for block in frame["blocks"]:
        key = block["text"].strip().lower()
        translation = text_to_marathi.get(key, "")

        if not translation:
            key_words = set(key.split())
            for full_text, full_translation in text_to_marathi.items():
                if key_words & set(full_text.split()):
                    translation = full_translation
                    break

        translated_blocks.append({
            "text":        block["text"],
            "translation": translation,
            "bbox":        block["bbox"],
            "conf":        block["conf"],
            "words":       block.get("words", []),
            "merged":      False,
        })

    return translated_blocks


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()
    setup_logging(args.verbose)

    # Validate model selection
    model = args.model
    if model not in MODEL_INFO:
        sys.exit(f"[ERROR] Unknown model: {model}")

    model_info = MODEL_INFO[model]

    # Validate API keys based on model
    sarvam_key = os.environ.get("SARVAM_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")

    if model.startswith("openai") and not openai_key:
        sys.exit(f"[ERROR] Model '{model}' requires OPENAI_API_KEY to be set in .env")

    if model == "anthropic-claude" and not anthropic_key:
        sys.exit(f"[ERROR] Model '{model}' requires ANTHROPIC_API_KEY to be set in .env")

    if args.ai and not openai_key and model != "anthropic-claude":
        sys.exit(f"[ERROR] --ai mode requires OpenAI API key")

    if model == "sarvam" and not sarvam_key:
        sys.exit("[ERROR] Sarvam model requires SARVAM_API_KEY to be set in .env")

    detections_path = str(Path(args.detections).resolve())
    if not os.path.isfile(detections_path):
        sys.exit(f"[ERROR] File not found: {detections_path}")

    output_path = args.output or str(Path(detections_path).parent / "translated_detections.json")

    with open(detections_path, "r", encoding="utf-8") as f:
        detections = json.load(f)

    cache = load_cache()

    # Estimate tokens
    estimated_tokens = estimate_total_tokens(detections, model)
    estimated_cost = (estimated_tokens * model_info["cost_per_1k_tokens"]) / 1000
    logger.info(f"Model: {model_info['model_name']}")
    logger.info(f"Estimated tokens: ~{estimated_tokens}")
    logger.info(f"Estimated cost: ${estimated_cost:.4f}")

    workflow = f"AI-assisted ({model})" if args.ai else f"original ({model})"
    logger.info(f"Workflow: {workflow}")

    buckets = segment_into_buckets(detections)

    translated = []
    for i, bucket in enumerate(buckets):
        logger.info(f"Bucket {i+1}/{len(buckets)} ({len(bucket)} frames)")

        if args.ai:
            text_to_marathi = translate_bucket_ai(bucket, cache)
            for frame in bucket:
                translated_blocks = apply_mapping_ai(frame, text_to_marathi)
                translated.append({
                    "frame_index": frame["frame_index"],
                    "timestamp":   frame["timestamp"],
                    "frame_path":  frame["frame_path"],
                    "blocks":      translated_blocks,
                })
        else:
            word_to_marathi = translate_bucket_original(bucket, cache)
            for frame in bucket:
                translated_blocks = apply_mapping_original(frame, word_to_marathi)
                translated.append({
                    "frame_index": frame["frame_index"],
                    "timestamp":   frame["timestamp"],
                    "frame_path":  frame["frame_path"],
                    "blocks":      translated_blocks,
                })

    save_cache(cache)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(translated, f, ensure_ascii=False, indent=2)

    logger.info(f"Saved to {output_path}")


if __name__ == "__main__":
    main()