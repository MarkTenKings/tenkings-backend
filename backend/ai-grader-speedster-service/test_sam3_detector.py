import base64
import asyncio
import inspect
import json
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from fastapi import HTTPException

from app import DetectRequest, MeasureRequest, detect, health, lifespan, measure, ping
from card_geometry import INSPECTION_HEIGHT, INSPECTION_MARGIN_PX, INSPECTION_WIDTH
from defect_math import GRID_HEIGHT, GRID_WIDTH
from sam3_detector import (
    DETECTOR_VERSION,
    Sam3ImageProcessor,
    detect_views,
    feature_fingerprint,
    learning_adjustment,
    measure_marks,
)
from sam_memory_v2 import CAPACITY_PER_TYPE_POLARITY, FINGERPRINT_VERSION


SAM_UNIT = [1 / np.sqrt(32)] * 32


def v2_exemplar(polarity, session_id):
    return {
        "defectType": "VISIBLE_WHITENING",
        "polarity": polarity,
        "sessionId": session_id,
        "completedAt": "2026-08-02T12:00:00.000Z",
        "completionOrder": 1,
        "proposalOrder": 0,
        "lessonOrder": 0,
        "fingerprint": SAM_UNIT,
        "provenance": (
            "DETECTOR_REMOVED"
            if polarity == "NEGATIVE"
            else "SMART_MARK_POSITIVE"
        ),
        "sourceViewId": "ORIGINAL",
    }


def v2_bank(*exemplars):
    return {
        "version": 2,
        "fingerprintVersion": FINGERPRINT_VERSION,
        "capacityPerTypePolarity": CAPACITY_PER_TYPE_POLARITY,
        "calibration": {"status": "CALIBRATED", "tau": 0.9, "margin": 0.05},
        "exemplars": list(exemplars),
    }


class FakeMaskProcessor:
    def __init__(self):
        self.calls = []

    def scan(
        self,
        image,
        candidates,
        learning_bank=None,
        allowed_mask=None,
        source_view_id=None,
        session_id=None,
        trace_id=None,
    ):
        self.calls.append((image.shape, candidates, learning_bank, allowed_mask))
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
        self.float_calls = 0

    def detach(self):
        return self

    def cpu(self):
        return self

    def float(self):
        self.float_calls += 1
        return self

    def numpy(self):
        return self.value

    def __getitem__(self, index):
        return FakeTensor(self.value[index])


class FakeOfficialImageProcessor:
    def __init__(self):
        self.images = []
        self.prompts = []
        self.scores = FakeTensor(np.array([0.84], dtype=np.float16))

    def set_image(self, image):
        self.images.append(image)
        return {
            "backbone_out": {
                "backbone_fpn": [
                    FakeTensor(np.ones((1, 256, 6, 4), dtype=np.float32))
                ]
            }
        }

    def reset_all_prompts(self, state):
        state.pop("masks", None)

    def add_geometric_prompt(self, box, label, state):
        self.prompts.append((box, label, state))
        mask = np.ones((1, 1, 12, 8), dtype=bool)
        return {
            **state,
            "masks": FakeTensor(mask),
            "scores": self.scores,
        }


def rectangle(x1_mm, y1_mm, x2_mm, y2_mm):
    return [
        {"x": x1_mm / 63.5, "y": y1_mm / 88.9},
        {"x": x2_mm / 63.5, "y": y1_mm / 88.9},
        {"x": x2_mm / 63.5, "y": y2_mm / 88.9},
        {"x": x1_mm / 63.5, "y": y2_mm / 88.9},
    ]


class Sam3DetectorTests(unittest.TestCase):
    def test_service_startup_loads_the_one_detector_before_health(self):
        class FakeLoader:
            def __init__(self):
                self.calls = 0

            def load(self):
                self.calls += 1

        loader = FakeLoader()

        async def start_and_stop():
            with patch("app.get_processor", return_value=loader):
                async with lifespan(None):
                    self.assertEqual(health()["detectorVersion"], DETECTOR_VERSION)
                    self.assertEqual(ping(), health())

        asyncio.run(start_and_stop())
        self.assertEqual(loader.calls, 1)

    def test_detect_endpoint_loads_supplied_canonical_views(self):
        success, encoded = cv2.imencode(".png", np.zeros((12, 8, 3), dtype=np.uint8))
        self.assertTrue(success)
        request = DetectRequest(
            side="FRONT",
            cornerShape="SQUARE",
            learningBank={"version": 1, "types": {}},
            sessionId="session-123",
            requestTraceId="session-123:FRONT:detect",
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
        self.assertEqual(
            scan.call_args.kwargs["learning_bank"],
            {"version": 1, "types": {}},
        )
        self.assertEqual(scan.call_args.kwargs["session_id"], "session-123")
        self.assertEqual(
            scan.call_args.kwargs["trace_id"], "session-123:FRONT:detect"
        )

    def test_detect_endpoint_returns_the_single_detector_error(self):
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

        with patch("app.detect_views", side_effect=RuntimeError("live mismatch")):
            with self.assertRaises(HTTPException) as raised:
                detect(request)

        self.assertEqual(raised.exception.status_code, 500)
        self.assertEqual(raised.exception.detail, "RuntimeError: live mismatch")

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
        localized = [{
            "box": (430, 480, 190, 190),
            "coreBox": (450, 500, 150, 150),
            "coreMask": np.ones((150, 150), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
            "score": 1.0,
        }]
        with patch("sam3_detector.defect_candidates", return_value=localized):
            result = detect_views(
                [("ORIGINAL", image), ("NORMALIZED", image)],
                "FRONT",
                "SQUARE",
                processor,
            )

        self.assertEqual(result["detectorVersion"], DETECTOR_VERSION)
        self.assertEqual(len(processor.calls), 2)
        self.assertTrue(
            all(shape == (GRID_HEIGHT, GRID_WIDTH, 3) for shape, _, _, _ in processor.calls)
        )
        self.assertTrue(all(candidates is localized for _, candidates, _, _ in processor.calls))
        self.assertEqual(len(result["defects"]), 1)
        defect = result["defects"][0]
        self.assertTrue(defect["id"].startswith("sam3-front-"))
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

    def test_official_processor_reuses_one_image_embedding_for_local_boxes(self):
        fake = FakeOfficialImageProcessor()
        processor = Sam3ImageProcessor()
        processor._processor = fake
        localized = [
            {
                "box": (450, 500, 100, 100),
                "coreBox": (470, 520, 60, 60),
                "coreMask": np.ones((60, 60), dtype=bool),
                "defectType": "VISIBLE_WHITENING",
            },
            {
                "box": (700, 900, 80, 80),
                "coreBox": (710, 910, 60, 60),
                "coreMask": np.ones((60, 60), dtype=bool),
                "defectType": "LIGHT_SCRATCH_SCUFF",
            },
        ]

        candidates = processor.scan(
            np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
            localized,
            {
                "version": 1,
                "types": {
                    "VISIBLE_WHITENING": {
                        "positive": {
                            "count": 1,
                            "sum": [1 / np.sqrt(32)] * 32,
                        },
                    },
                },
            },
        )

        self.assertEqual(len(candidates), 2)
        self.assertIs(processor._processor, fake)
        self.assertEqual(len(fake.images), 1)
        self.assertEqual(len(fake.prompts), 2)
        self.assertTrue(
            all(state is fake.prompts[0][2] for _, _, state in fake.prompts)
        )
        self.assertTrue(
            all(candidate["mask"].shape == (GRID_HEIGHT, GRID_WIDTH) for candidate in candidates)
        )
        self.assertTrue(all(len(candidate["featureFingerprint"]) == 32 for candidate in candidates))
        self.assertAlmostEqual(candidates[0]["confidence"], 0.84, places=3)
        self.assertEqual(candidates[0]["learningAdjustment"], 0.06)
        self.assertAlmostEqual(candidates[0]["rankingConfidence"], 0.9, places=3)
        self.assertEqual(candidates[1]["learningAdjustment"], 0.0)
        self.assertEqual(fake.scores.float_calls, 2)

    def test_inspection_view_prompts_include_context_but_returns_canonical_masks(self):
        fake = FakeOfficialImageProcessor()
        processor = Sam3ImageProcessor()
        processor._processor = fake
        margin = INSPECTION_MARGIN_PX
        localized = [{
            "box": (margin - 8, margin, 28, 40),
            "coreBox": (margin, margin, 20, 32),
            "coreMask": np.ones((32, 20), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
        }]
        allowed = np.zeros((INSPECTION_HEIGHT, INSPECTION_WIDTH), dtype=np.uint8)
        allowed[margin : margin + GRID_HEIGHT, margin : margin + GRID_WIDTH] = 1

        candidates = processor.scan(
            np.zeros((INSPECTION_HEIGHT, INSPECTION_WIDTH, 3), dtype=np.uint8),
            localized,
            allowed_mask=allowed,
        )

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["mask"].shape, (GRID_HEIGHT, GRID_WIDTH))
        self.assertEqual(candidates[0]["mask"][:, -1].sum(), 0)
        prompt = fake.prompts[0][0]
        self.assertLess(prompt[0] - prompt[2] / 2, margin / INSPECTION_WIDTH)

    def test_existing_backbone_features_make_one_compact_normalized_fingerprint(self):
        features = np.arange(256 * 4 * 3, dtype=np.float32).reshape(256, 4, 3)
        mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        mask[200:700, 300:900] = 1

        fingerprint = feature_fingerprint(features, mask)

        self.assertIsNotNone(fingerprint)
        self.assertEqual(len(fingerprint), 32)
        self.assertAlmostEqual(float(np.linalg.norm(fingerprint)), 1.0, places=5)

    def test_cosine_learning_adds_only_the_tiny_matching_type_adjustment(self):
        fingerprint = [1.0] + [0.0] * 31
        positive = {
            "version": 1,
            "types": {
                "VISIBLE_WHITENING": {
                    "positive": {"count": 1, "sum": fingerprint},
                }
            },
        }
        negative = {
            "version": 1,
            "types": {
                "VISIBLE_WHITENING": {
                    "negative": {"count": 1, "sum": fingerprint},
                }
            },
        }

        self.assertEqual(
            learning_adjustment(fingerprint, "VISIBLE_WHITENING", positive), 0.06
        )
        self.assertEqual(
            learning_adjustment(fingerprint, "VISIBLE_WHITENING", negative), -0.06
        )
        self.assertEqual(
            learning_adjustment(fingerprint, "LIGHT_SCRATCH_SCUFF", positive), 0.0
        )

    def test_v2_strong_negative_veto_logs_one_compact_traceable_decision(self):
        fake = FakeOfficialImageProcessor()
        fake.scores = FakeTensor(np.array([0.96], dtype=np.float32))
        processor = Sam3ImageProcessor()
        processor._processor = fake
        localized = [{
            "box": (450, 500, 100, 100),
            "coreBox": (470, 520, 60, 60),
            "coreMask": np.ones((60, 60), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
        }]

        with self.assertLogs("sam3_detector", level="INFO") as captured:
            candidates = processor.scan(
                np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
                localized,
                v2_bank(v2_exemplar("NEGATIVE", "removed-text")),
                source_view_id="FRONT:ORIGINAL",
                session_id="current-session",
                trace_id="request-trace",
            )

        self.assertEqual(candidates, [])
        self.assertEqual(len(captured.records), 1)
        diagnostic = json.loads(captured.records[0].getMessage().split(" ", 1)[1])
        self.assertEqual(diagnostic["action"], "vetoed")
        self.assertAlmostEqual(diagnostic["rawConfidence"], 0.96, places=6)
        self.assertEqual(diagnostic["sessionId"], "current-session")
        self.assertEqual(diagnostic["traceId"], "request-trace")
        self.assertEqual(diagnostic["sourceViewId"], "ORIGINAL")
        self.assertEqual(diagnostic["negativeMatchSessionId"], "removed-text")

    def test_v2_positive_protection_keeps_surviving_measurements_identical(self):
        localized = [{
            "box": (450, 500, 100, 100),
            "coreBox": (470, 520, 60, 60),
            "coreMask": np.ones((60, 60), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
        }]
        baseline_processor = Sam3ImageProcessor()
        baseline_processor._processor = FakeOfficialImageProcessor()
        protected_processor = Sam3ImageProcessor()
        protected_processor._processor = FakeOfficialImageProcessor()
        image = np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8)

        with patch("sam3_detector.defect_candidates", return_value=localized):
            baseline = detect_views(
                [("FRONT:ORIGINAL", image)],
                "FRONT",
                "SQUARE",
                baseline_processor,
            )
            with self.assertLogs("sam3_detector", level="INFO") as captured:
                protected = detect_views(
                    [("FRONT:ORIGINAL", image)],
                    "FRONT",
                    "SQUARE",
                    protected_processor,
                    v2_bank(
                        v2_exemplar("NEGATIVE", "removed-text"),
                        v2_exemplar("POSITIVE", "real-damage"),
                    ),
                )

        self.assertEqual(len(baseline["defects"]), 1)
        self.assertEqual(len(protected["defects"]), 1)
        self.assertEqual(
            baseline["defects"][0]["canonicalContour"],
            protected["defects"][0]["canonicalContour"],
        )
        self.assertEqual(
            baseline["defects"][0]["measurement"],
            protected["defects"][0]["measurement"],
        )
        diagnostic = json.loads(captured.records[0].getMessage().split(" ", 1)[1])
        self.assertEqual(diagnostic["action"], "protected")

    def test_malformed_v2_is_inert_and_does_not_block_detection(self):
        fake = FakeOfficialImageProcessor()
        processor = Sam3ImageProcessor()
        processor._processor = fake
        malformed = v2_bank(v2_exemplar("NEGATIVE", "bad-bank"))
        malformed["exemplars"][0]["fingerprint"] = [1.0]
        localized = [{
            "box": (450, 500, 100, 100),
            "coreBox": (470, 520, 60, 60),
            "coreMask": np.ones((60, 60), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
        }]

        with self.assertLogs("sam3_detector", level="INFO") as captured:
            candidates = processor.scan(
                np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
                localized,
                malformed,
                source_view_id="FRONT:ORIGINAL",
            )

        self.assertEqual(len(candidates), 1)
        self.assertAlmostEqual(candidates[0]["confidence"], 0.84, places=3)
        self.assertAlmostEqual(candidates[0]["rankingConfidence"], 0.84, places=3)
        self.assertEqual(candidates[0]["learningAdjustment"], 0.0)
        diagnostic = json.loads(captured.records[0].getMessage().split(" ", 1)[1])
        self.assertEqual(diagnostic["bankStatus"], "malformed")
        self.assertEqual(diagnostic["action"], "retained")

    def test_positive_evidence_cannot_change_the_pinned_sam_collection_threshold(self):
        source = inspect.getsource(Sam3ImageProcessor.load)

        self.assertIn("Sam3Processor(model, confidence_threshold=0.5)", source)
        self.assertNotIn("confidence_threshold=0.44", source)


if __name__ == "__main__":
    unittest.main()
