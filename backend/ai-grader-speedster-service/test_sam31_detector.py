import base64
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from app import DetectRequest, MeasureRequest, detect, measure
from defect_math import DEFECT_MULTIPLIERS, GRID_HEIGHT, GRID_WIDTH
from sam31_detector import (
    DEFECT_PROMPTS,
    DETECTOR_VERSION,
    Sam31Processor,
    detect_views,
    measure_marks,
)


class FakeMaskProcessor:
    def __init__(self):
        self.calls = []

    def scan(self, image, prompts):
        self.calls.append((image.shape, prompts))
        mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        mask[500:650, 450:600] = 1
        return [
            {
                "defectType": "VISIBLE_WHITENING",
                "confidence": 0.75 + len(self.calls) / 10,
                "mask": mask,
            }
        ]


class FakeTensor:
    def __init__(self, value):
        self.value = value

    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self.value


class FakeOfficialImageProcessor:
    def __init__(self):
        self.images = []
        self.prompts = []

    def set_image(self, image):
        self.images.append(image)
        return {"image_embedding": "shared"}

    def set_text_prompt(self, prompt, state):
        self.prompts.append((prompt, state))
        mask = np.zeros((1, 1, 12, 8), dtype=bool)
        mask[:, :, 3:6, 2:5] = True
        return {
            **state,
            "masks": FakeTensor(mask),
            "scores": FakeTensor(np.array([0.84], dtype=np.float32)),
        }


def rectangle(x1_mm, y1_mm, x2_mm, y2_mm):
    return [
        {"x": x1_mm / 63.5, "y": y1_mm / 88.9},
        {"x": x2_mm / 63.5, "y": y1_mm / 88.9},
        {"x": x2_mm / 63.5, "y": y2_mm / 88.9},
        {"x": x1_mm / 63.5, "y": y2_mm / 88.9},
    ]


class Sam31DetectorTests(unittest.TestCase):
    def test_detect_endpoint_loads_supplied_canonical_views(self):
        success, encoded = cv2.imencode(".png", np.zeros((12, 8, 3), dtype=np.uint8))
        self.assertTrue(success)
        request = DetectRequest(
            side="FRONT",
            cornerShape="SQUARE",
            views=[
                {
                    "id": "ORIGINAL",
                    "imageBase64": base64.b64encode(encoded).decode(),
                }
            ],
        )
        expected = {"detectorVersion": DETECTOR_VERSION, "defects": []}

        with patch("app.detect_views", return_value=expected) as scan:
            self.assertEqual(detect(request), expected)

        views, side, corner_shape = scan.call_args.args
        self.assertEqual(side, "FRONT")
        self.assertEqual(corner_shape, "SQUARE")
        self.assertEqual(views[0][0], "ORIGINAL")
        self.assertEqual(views[0][1].shape, (12, 8, 3))

    def test_measure_endpoint_uses_the_same_zone_measurement_engine(self):
        result = measure(
            MeasureRequest(
                side="FRONT",
                cornerShape="SQUARE",
                marks=[
                    {
                        "id": "missed-2",
                        "defectType": "VISIBLE_WHITENING",
                        "canonicalContour": rectangle(20, 20, 22, 22),
                        "sourceViewId": "ORIGINAL",
                    }
                ],
            )
        )

        self.assertEqual(len(result["defects"]), 1)
        self.assertEqual(result["defects"][0]["id"], "missed-2:SURFACE")
        self.assertEqual(result["defects"][0]["reviewResult"], "SMART_MARKED")

    def test_scans_each_view_and_returns_measured_speedster_defect(self):
        processor = FakeMaskProcessor()
        image = np.zeros((200, 100, 3), dtype=np.uint8)
        result = detect_views(
            [("ORIGINAL", image), ("NORMALIZED", image)],
            "FRONT",
            "SQUARE",
            processor,
        )

        self.assertEqual(result["detectorVersion"], DETECTOR_VERSION)
        self.assertEqual(len(processor.calls), 2)
        self.assertTrue(
            all(shape == (GRID_HEIGHT, GRID_WIDTH, 3) for shape, _ in processor.calls)
        )
        self.assertTrue(all(prompts is DEFECT_PROMPTS for _, prompts in processor.calls))
        self.assertEqual(len(result["defects"]), 1)
        defect = result["defects"][0]
        self.assertEqual(defect["sourceViewId"], "NORMALIZED")
        self.assertEqual(defect["supportingViewIds"], ["ORIGINAL"])
        self.assertEqual(defect["reviewResult"], "UNREVIEWED")
        self.assertEqual(defect["side"], "FRONT")
        self.assertEqual(defect["zone"], "SURFACE")
        self.assertGreater(defect["measurement"]["areaMm2"], 0)
        self.assertGreater(defect["measurement"]["zonePercent"], 0)
        self.assertEqual(defect["measurement"]["multiplier"], 1.0)

    def test_smart_mark_crossing_zones_has_unique_stable_zone_ids(self):
        result = measure_marks(
            [
                {
                    "id": "missed-1",
                    "defectType": "VISIBLE_WHITENING",
                    "canonicalContour": rectangle(4, 0, 6, 6),
                    "sourceViewId": "ORIGINAL",
                }
            ],
            "BACK",
            "SQUARE",
        )

        defects = result["defects"]
        self.assertEqual(len(defects), 3)
        self.assertEqual(
            {defect["id"] for defect in defects},
            {"missed-1:CORNERS", "missed-1:EDGES", "missed-1:SURFACE"},
        )
        self.assertTrue(all(defect["confidence"] == 1.0 for defect in defects))
        self.assertTrue(
            all(defect["reviewResult"] == "SMART_MARKED" for defect in defects)
        )

    def test_prompts_cover_every_published_defect_type_once(self):
        prompt_types = [defect_type for defect_type, _ in DEFECT_PROMPTS]
        self.assertEqual(len(prompt_types), len(set(prompt_types)))
        self.assertEqual(set(prompt_types), set(DEFECT_MULTIPLIERS))

    def test_official_processor_reuses_one_image_embedding_for_all_prompts(self):
        fake = FakeOfficialImageProcessor()
        processor = Sam31Processor()
        processor._processor = fake

        candidates = processor.scan(np.zeros((12, 8, 3), dtype=np.uint8))

        self.assertEqual(len(candidates), len(DEFECT_PROMPTS))
        self.assertIs(processor._processor, fake)
        self.assertEqual(len(fake.images), 1)
        self.assertEqual(len(fake.prompts), len(DEFECT_PROMPTS))
        self.assertTrue(
            all(state is fake.prompts[0][1] for _, state in fake.prompts)
        )
        self.assertTrue(
            all(candidate["mask"].shape == (12, 8) for candidate in candidates)
        )


if __name__ == "__main__":
    unittest.main()
