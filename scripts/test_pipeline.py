"""
Fast checks for the pipeline's pure-Python parts (no API keys, no video needed).

    cd scripts && .venv/bin/python -m unittest test_pipeline -v
"""
import os
import tempfile
import unittest

import numpy as np
from PIL import Image

import colors
import ocr_annotate
import render_translations as rt
import translate_detections as td


class ScriptRuns(unittest.TestCase):
    def test_single_script_with_latin_stays_one_run(self):
        # Devanagari font carries Latin, so mixed Marathi/English is one run
        self.assertEqual(rt.script_runs("मराठीत NEET 2026"),
                         [("NotoSansDevanagari-Regular.ttf", "मराठीत NEET 2026")])

    def test_latin_inside_tamil_uses_base_font(self):
        fonts = [f for f, _ in rt.script_runs("தமிழில் JEE பயிற்சி")]
        self.assertEqual(fonts, ["NotoSansTamil-Regular.ttf",
                                 "NotoSansDevanagari-Regular.ttf",
                                 "NotoSansTamil-Regular.ttf"])

    def test_joiners_and_danda_stick_to_their_run(self):
        runs = rt.script_runs("স্বাগতম। ঢাকা")
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0][0], "NotoSansBengali-Regular.ttf")
        self.assertEqual(len(rt.script_runs("र्‍य")), 1)

    def test_runs_round_trip_text(self):
        text = "ਪੰਜਾਬੀ · ગુજરાતી · ଓଡ଼ିଆ 100%"
        self.assertEqual("".join(t for _, t in rt.script_runs(text)), text)


class Overlay(unittest.TestCase):
    def test_raqm_available(self):
        from PIL import features
        self.assertTrue(features.check("raqm"), "Pillow needs raqm for Indic shaping")

    def test_draws_text_inside_patch(self):
        img = rt.draw_overlay("नमस्ते", 200, 50, 28, (0, 0, 0), (255, 255, 255))
        self.assertEqual(img.size, (200, 50))
        arr = np.asarray(img)
        self.assertGreater((arr > 128).any(axis=2).sum(), 50, "no text pixels drawn")
        self.assertTrue((arr[:, -5:] == 0).all(), "text should be left-aligned")

    def test_blank_text_is_plain_cover(self):
        img = rt.draw_overlay("  ", 40, 20, 14, (10, 20, 30), (255, 255, 255))
        self.assertEqual(set(img.getdata()), {(10, 20, 30)})


class Dedupe(unittest.TestCase):
    def _frames(self, images):
        d = tempfile.mkdtemp()
        out = []
        for i, im in enumerate(images):
            p = os.path.join(d, f"{i:06d}.jpg")
            im.save(p, quality=95)
            out.append((i * 0.5, p))
        return out

    def test_identical_frames_reuse_keyframe_and_new_word_triggers_ocr(self):
        blank = Image.new("RGB", (640, 360), (30, 60, 140))
        word = blank.copy()
        word.paste((255, 255, 255), (300, 160, 360, 180))  # a small new label
        frames = self._frames([blank, blank, blank, word, word])
        self.assertEqual(ocr_annotate.plan_ocr(frames, dedupe=True), [0, 0, 0, 3, 3])
        self.assertEqual(ocr_annotate.plan_ocr(frames, dedupe=False), [0, 1, 2, 3, 4])


class Colors(unittest.TestCase):
    def test_border_median_ignores_box_contents(self):
        img = np.zeros((100, 200, 3), np.uint8)
        img[:] = (138, 58, 30)                 # BGR background
        img[40:60, 50:150] = (255, 255, 255)   # white text block
        self.assertEqual(colors.border_median_rgb(img, [50, 40, 150, 60]), (30, 58, 138))

    def test_auto_text_contrasts(self):
        self.assertEqual(colors.auto_text_rgb((30, 58, 138)), (255, 255, 255))
        self.assertEqual(colors.auto_text_rgb((240, 240, 200)), (0, 0, 0))

    def test_renderer_treats_empty_colours_as_auto(self):
        tl = rt.build_timeline([{"timestamp": 0.25, "frame_index": 0, "frame_path": "",
                                 "blocks": [{"text": "Hi", "translation": "नमस्ते",
                                             "bbox": [0, 0, 10, 10], "autoBgColor": "#112233"}]}],
                               2.0, 100, 100)
        self.assertEqual((tl[0]["bg_color"], tl[0]["text_color"]), ("", ""))
        self.assertEqual(rt.sample_bg_color("", [0, 0, 10, 10], "", tl[0]["auto_bg"]), (0x11, 0x22, 0x33))
        self.assertEqual(rt.sample_bg_color("", [0, 0, 10, 10], "#ff0000", "#112233"), (255, 0, 0))


class CacheKeys(unittest.TestCase):
    def tearDown(self):
        td.TARGET_LANG = td.DEFAULT_LANG

    def test_keys_are_scoped_by_language(self):
        cache = {}
        td.TARGET_LANG = "ta-IN"
        td._cache_put(cache, "k", "tamil")
        td.TARGET_LANG = "hi-IN"
        self.assertIsNone(td._cache_get(cache, "k"))

    def test_legacy_unprefixed_keys_are_marathi(self):
        cache = {"k": "marathi"}
        td.TARGET_LANG = "mr-IN"
        self.assertEqual(td._cache_get(cache, "k"), "marathi")
        td.TARGET_LANG = "hi-IN"
        self.assertIsNone(td._cache_get(cache, "k"))


if __name__ == "__main__":
    unittest.main()
