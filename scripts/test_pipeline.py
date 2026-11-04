"""
Fast checks for the pipeline's pure-Python parts (no API keys, no video needed).

    cd scripts && .venv/bin/python -m unittest test_pipeline -v
"""
import os
import tempfile
import unittest

import numpy as np
from PIL import Image

import cv2

import colors
import erase
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


def _gradient(w=400, h=120):
    x = np.linspace(0, 1, w)[None, :, None]
    a, b = np.array([145, 61, 11]), np.array([95, 126, 255])   # BGR
    return np.repeat((a + (b - a) * x), h, axis=0).astype(np.uint8)


class Erase(unittest.TestCase):
    def setUp(self):
        self.bg = _gradient()
        self.img = self.bg.copy()
        cv2.putText(self.img, "Photosynthesis", (20, 75), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 255, 255), 3)
        self.rect = (0, 0, 400, 120)

    def test_mask_covers_text_not_background(self):
        mask = erase.text_mask(self.img, 60) > 0
        text_px = np.abs(self.img.astype(int) - self.bg.astype(int)).max(axis=2) > 40
        self.assertGreater(mask[text_px].mean(), 0.98, "text pixels missed")
        self.assertLess(mask.mean(), 0.35, "mask spills over the background")

    def test_inpaint_restores_gradient(self):
        mask, moving, _ = erase.analyse_span([self.img], self.rect, 60)
        self.assertFalse(moving)
        plate = erase.clean_plate(self.img, self.rect, mask)
        err = np.abs(plate.astype(int) - self.bg.astype(int)).max(axis=2)
        self.assertLess(np.percentile(err, 99), 30)

    def test_text_colour_is_the_fill(self):
        r, g, b = erase.text_color(self.img, 60)
        self.assertGreater(min(r, g), 200)   # yellow (BGR 0,255,255)
        self.assertLess(b, 80)

    def test_motion_detection(self):
        core = (15, 35, 330, 85)  # the text box within the crop
        static = erase.analyse_span([self.img, self.img.copy()], self.rect, 60, core)[1]
        moved = self.img.copy()
        cv2.line(moved, (0, 112), (400, 100), (255, 255, 255), 2)  # thin line passing by
        self.assertFalse(static)
        self.assertTrue(erase.analyse_span([self.img, moved], self.rect, 60, core)[1])
        self.assertTrue(erase.analyse_span([moved, self.img], self.rect, 60, core)[1])

    def test_type_on_text_is_not_motion(self):
        core = (15, 35, 330, 85)
        partial = self.bg.copy()
        cv2.putText(partial, "Photo", (20, 75), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 255, 255), 3)
        mask, moving, base = erase.analyse_span([partial, self.img], self.rect, 60, core)
        self.assertFalse(moving)
        self.assertEqual(base, 1)


class TextKeys(unittest.TestCase):
    def test_ocr_spacing_variants_match(self):
        self.assertEqual(rt.text_key("Limitedoffer 50% off"), rt.text_key("Limited offer 50% off"))
        self.assertEqual(td.text_key("Limitedoffer 50% off"), rt.text_key("Limited offer 50%off"))

    def test_standard_mode_translates_each_block(self):
        calls = []
        orig = td.sarvam_translate
        td.sarvam_translate = lambda text, cache: (calls.append(text), f"<{text}>")[1]
        try:
            bucket = [{"blocks": [{"text": "Photosynthesis"}, {"text": "Plants make food"}, {"text": "2026"}]}]
            out = td.translate_bucket_standard(bucket, {})
        finally:
            td.sarvam_translate = orig
        self.assertEqual(calls, ["Photosynthesis", "Plants make food"])
        frame = {"blocks": [{"text": "Plants  make food", "bbox": [0, 0, 1, 1], "conf": 1}]}
        self.assertEqual(td.apply_mapping(frame, out)[0]["translation"], "<Plants make food>")


class ProviderFailures(unittest.TestCase):
    """A bad key or dead endpoint must fail the job, not 'translate' to English."""

    def _server(self, code):
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(code)
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *a):
                pass
        srv = HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        return f"http://127.0.0.1:{srv.server_port}/translate"

    def setUp(self):
        self._endpoint = td.SARVAM_ENDPOINT
        td.SARVAM_STATS.update(ok=0, failed=0, last_error="")

    def tearDown(self):
        td.SARVAM_ENDPOINT = self._endpoint

    def test_rejected_key_raises(self):
        td.SARVAM_ENDPOINT = self._server(403)
        with self.assertRaises(td.ProviderAuthError):
            td.sarvam_translate("Hello", {})

    def test_server_error_is_counted(self):
        td.SARVAM_ENDPOINT = self._server(500)
        self.assertEqual(td.sarvam_translate("Hello", {}), "Hello")
        self.assertEqual(td.SARVAM_STATS["failed"], 1)


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
