import base64
import unittest
from copy import deepcopy
from unittest.mock import patch

import cv2
import numpy as np
from fastapi import HTTPException

from app import (
    MeasureRequest,
    TraceProposalRequest,
    measure,
    trace_proposal,
)
from card_geometry import INSPECTION_HEIGHT, INSPECTION_MARGIN_PX, INSPECTION_WIDTH
from defect_math import (
    CARD_HEIGHT_MM,
    CARD_WIDTH_MM,
    GRID_HEIGHT,
    GRID_WIDTH,
    _rasterize,
)
from sam3_detector import measure_marks
from trace_rle import encode_trace_rle, trace_sha256


INSPECTION_FRAME = {
    "width": INSPECTION_WIDTH,
    "height": INSPECTION_HEIGHT,
    "cardBounds": {
        "x": INSPECTION_MARGIN_PX,
        "y": INSPECTION_MARGIN_PX,
        "width": GRID_WIDTH,
        "height": GRID_HEIGHT,
    },
}


def trace_rectangle(x1, y1, x2, y2):
    mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
    mask[y1:y2, x1:x2] = 1
    return mask


def trace_provenance(final_trace, source_view_id="FRONT:ORIGINAL", *, strokes=None):
    return {
        "version": "speedster-trace-provenance-v1",
        "sourceViewId": source_view_id,
        "cropTransform": {
            "version": "speedster-canonical-crop-affine-v1",
            "crop": {"x": 0, "y": 0, "width": 1269, "height": 1777},
        },
        "highlighterStrokes": (
            strokes
            if strokes is not None
            else [{
                "canonicalPoints": [{"x": 1, "y": 1}],
                "strokeWidthMm": 1.0,
            }]
        ),
        "finalTraceSha256": final_trace["sha256"],
    }


def contour_rectangle(x1, y1, x2, y2):
    return [
        {"x": x1 / (GRID_WIDTH - 1), "y": y1 / (GRID_HEIGHT - 1)},
        {"x": x2 / (GRID_WIDTH - 1), "y": y1 / (GRID_HEIGHT - 1)},
        {"x": x2 / (GRID_WIDTH - 1), "y": y2 / (GRID_HEIGHT - 1)},
        {"x": x1 / (GRID_WIDTH - 1), "y": y2 / (GRID_HEIGHT - 1)},
    ]


def image_base64():
    success, encoded = cv2.imencode(
        ".png", np.zeros((INSPECTION_HEIGHT, INSPECTION_WIDTH, 3), dtype=np.uint8)
    )
    assert success
    return base64.b64encode(encoded).decode("ascii")


class FixedTraceProcessor:
    def __init__(self, proposed_mask=None, fingerprint=None, error=None):
        self.proposed_mask = proposed_mask
        self.fingerprint = fingerprint
        self.error = error
        self.proposal_calls = []
        self.fingerprint_calls = []

    def propose_smart_mark_trace(self, *args):
        self.proposal_calls.append(args)
        if self.error:
            raise self.error
        return {"mask": self.proposed_mask, "score": 0.91, "promptAttempts": 1}

    def fingerprint_saved_trace(self, *args):
        self.fingerprint_calls.append(args)
        if self.error:
            raise self.error
        return self.fingerprint


class TraceProposalTests(unittest.TestCase):
    def test_one_direct_action_uses_residual_saved_traces_and_returns_exact_rle(self):
        current = trace_rectangle(150, 200, 155, 205)
        saved = trace_rectangle(300, 400, 305, 405)
        proposed_inspection = np.zeros((INSPECTION_HEIGHT, INSPECTION_WIDTH), dtype=np.uint8)
        proposed_inspection[
            INSPECTION_MARGIN_PX + 500 : INSPECTION_MARGIN_PX + 504,
            INSPECTION_MARGIN_PX + 600 : INSPECTION_MARGIN_PX + 607,
        ] = 1
        processor = FixedTraceProcessor(proposed_mask=proposed_inspection > 0)
        full_residual = np.zeros(
            (INSPECTION_HEIGHT, INSPECTION_WIDTH), dtype=np.uint8
        )
        full_residual[
            INSPECTION_MARGIN_PX + 30 : INSPECTION_MARGIN_PX + 33,
            INSPECTION_MARGIN_PX + 20 : INSPECTION_MARGIN_PX + 24,
        ] = 1
        request = TraceProposalRequest(
            side="FRONT",
            cornerShape="SQUARE",
            findingId="finding-1",
            sourceViewId="FRONT:ORIGINAL",
            evidenceView={
                "id": "FRONT:ORIGINAL",
                "imageBase64": image_base64(),
                "inspectionFrame": INSPECTION_FRAME,
            },
            stroke={
                "canonicalPoints": [{"x": 600, "y": 500}, {"x": 606, "y": 503}],
                "strokeWidthPixels": 30,
                "strokeWidthMm": 1.5,
                "cropTransformVersion": "speedster-canonical-crop-affine-v1",
            },
            currentTrace=encode_trace_rle(current),
            findings=[{"id": "saved", "finalTrace": encode_trace_rle(saved)}],
        )

        with patch("app.get_processor", return_value=processor), patch(
            "app.boundary_subtracted_anomaly_mask",
            return_value=full_residual,
            create=True,
        ):
            response = trace_proposal(request)

        expected = proposed_inspection[
            INSPECTION_MARGIN_PX : INSPECTION_MARGIN_PX + GRID_HEIGHT,
            INSPECTION_MARGIN_PX : INSPECTION_MARGIN_PX + GRID_WIDTH,
        ]
        np.testing.assert_array_equal(response["trace"] and response["trace"]["runs"], encode_trace_rle(expected)["runs"])
        self.assertEqual(len(processor.proposal_calls), 1)
        (
            _image,
            stroke_points,
            stroke_width_mm,
            allowed,
            residual,
            existing,
            frame,
        ) = processor.proposal_calls[0]
        self.assertEqual(
            stroke_points,
            [
                {"x": 600 / (GRID_WIDTH - 1), "y": 500 / (GRID_HEIGHT - 1)},
                {"x": 606 / (GRID_WIDTH - 1), "y": 503 / (GRID_HEIGHT - 1)},
            ],
        )
        self.assertEqual(stroke_width_mm, 1.5)
        self.assertEqual(frame, INSPECTION_FRAME)
        self.assertEqual(
            np.count_nonzero(allowed),
            GRID_WIDTH * GRID_HEIGHT,
        )
        self.assertTrue(
            np.all(
                residual[
                    INSPECTION_MARGIN_PX + 30 : INSPECTION_MARGIN_PX + 33,
                    INSPECTION_MARGIN_PX + 20 : INSPECTION_MARGIN_PX + 24,
                ]
            )
        )
        self.assertTrue(existing[INSPECTION_MARGIN_PX + 202, INSPECTION_MARGIN_PX + 152])
        self.assertTrue(existing[INSPECTION_MARGIN_PX + 402, INSPECTION_MARGIN_PX + 302])

    def test_invalid_saved_trace_is_controlled_and_never_calls_the_point_head(self):
        processor = FixedTraceProcessor(proposed_mask=np.ones((GRID_HEIGHT, GRID_WIDTH)))
        trace = encode_trace_rle(trace_rectangle(20, 20, 30, 30))
        trace["sha256"] = "0" * 64
        request = TraceProposalRequest(
            side="BACK",
            cornerShape="SQUARE",
            findingId=None,
            sourceViewId="BACK:ORIGINAL",
            evidenceView={
                "id": "BACK:ORIGINAL",
                "imageBase64": image_base64(),
                "inspectionFrame": INSPECTION_FRAME,
            },
            stroke={
                "canonicalPoints": [{"x": 20, "y": 20}],
                "strokeWidthPixels": 20,
                "strokeWidthMm": 1,
                "cropTransformVersion": "speedster-canonical-crop-affine-v1",
            },
            currentTrace=trace,
            findings=[],
        )

        with patch("app.get_processor", return_value=processor):
            with self.assertRaises(HTTPException) as raised:
                trace_proposal(request)

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(processor.proposal_calls, [])

    def test_point_head_failure_returns_sanitized_error_with_request_id(self):
        processor = FixedTraceProcessor(
            error=RuntimeError(
                "CUDA failed at https://signed.example/object?token=secret "
                "Bearer sk-secret12345678"
            )
        )
        request = TraceProposalRequest(
            side="FRONT",
            cornerShape="SQUARE",
            sourceViewId="FRONT:ORIGINAL",
            evidenceView={
                "id": "FRONT:ORIGINAL",
                "imageBase64": image_base64(),
                "inspectionFrame": INSPECTION_FRAME,
            },
            stroke={
                "canonicalPoints": [{"x": 600, "y": 500}],
                "strokeWidthPixels": 20,
                "strokeWidthMm": 1,
                "cropTransformVersion": "speedster-canonical-crop-affine-v1",
            },
            requestTraceId="sam-request-123",
        )

        with patch("app.get_processor", return_value=processor):
            with self.assertLogs("app", level="ERROR") as captured:
                with self.assertRaises(HTTPException) as raised:
                    trace_proposal(request)

        self.assertEqual(raised.exception.status_code, 500)
        self.assertEqual(raised.exception.detail, {
            "message": "RuntimeError: CUDA failed at [redacted-url] [redacted-credential]",
            "requestId": "sam-request-123",
        })
        self.assertIn("requestTraceId=sam-request-123", captured.output[0])
        self.assertNotIn("signed.example", captured.output[0])


class TraceMeasurementTests(unittest.TestCase):
    def test_partial_same_type_exact_overlap_preserves_sources_and_counts_union_once(self):
        first_mask = trace_rectangle(300, 500, 360, 560)
        second_mask = trace_rectangle(330, 530, 390, 590)
        first_trace = encode_trace_rle(first_mask)
        second_trace = encode_trace_rle(second_mask)

        def finding(finding_id, final_trace):
            return {
                "id": finding_id,
                "side": "FRONT",
                "defectType": "VISIBLE_WHITENING",
                "origin": "SMART_MARK",
                "confidence": 0.9,
                "sourceViewId": "FRONT:ORIGINAL",
                "supportingViewIds": [],
                "reviewResult": "SMART_MARKED",
                "finalTrace": final_trace,
                "traceProvenance": trace_provenance(final_trace),
            }

        measured = measure_marks(
            [],
            "FRONT",
            "SQUARE",
            findings=[finding("exact-first", first_trace), finding("exact-second", second_trace)],
        )

        by_id = {source["id"]: source for source in measured["defects"]}
        self.assertEqual(set(by_id), {"exact-first", "exact-second"})
        first_owned = sum(
            region["measurement"]["pixelCount"]
            for region in by_id["exact-first"]["measurementRegions"]
        )
        second_owned = sum(
            region["measurement"]["pixelCount"]
            for region in by_id["exact-second"]["measurementRegions"]
        )
        self.assertLessEqual(first_owned, int(np.count_nonzero(first_mask)))
        self.assertLessEqual(second_owned, int(np.count_nonzero(second_mask)))
        self.assertEqual(first_owned, int(np.count_nonzero(first_mask)))
        self.assertEqual(
            second_owned,
            int(np.count_nonzero(second_mask & ~first_mask)),
        )
        union_pixels = int(np.count_nonzero(first_mask | second_mask))
        self.assertEqual(first_owned + second_owned, union_pixels)
        owned_child_masks = []
        for source_id, stored_mask in (
            ("exact-first", first_mask),
            ("exact-second", second_mask),
        ):
            for region in by_id[source_id]["measurementRegions"]:
                child_mask = _rasterize(region["canonicalContour"])
                self.assertEqual(np.count_nonzero(child_mask & ~stored_mask), 0)
                self.assertEqual(
                    int(np.count_nonzero(child_mask)),
                    region["measurement"]["pixelCount"],
                )
                owned_child_masks.append(child_mask)
        self.assertEqual(
            int(np.count_nonzero(owned_child_masks[0] & owned_child_masks[1])),
            0,
        )
        self.assertEqual(
            int(np.count_nonzero(owned_child_masks[0] | owned_child_masks[1])),
            union_pixels,
        )
        pixel_area_mm2 = CARD_WIDTH_MM * CARD_HEIGHT_MM / (GRID_WIDTH * GRID_HEIGHT)
        self.assertAlmostEqual(
            sum(
                region["measurement"]["areaMm2"]
                for source in by_id.values()
                for region in source["measurementRegions"]
            ),
            union_pixels * pixel_area_mm2,
            places=10,
        )

    def test_legacy_cross_zone_ids_append_without_rewriting_existing_zone_suffix(self):
        existing = {
            "id": "legacy:CORNERS",
            "side": "FRONT",
            "zone": "CORNERS",
            "defectType": "VISIBLE_WHITENING",
            "origin": "DETECTOR",
            "confidence": 0.8,
            "canonicalContour": contour_rectangle(80, 0, 120, 140),
            "sourceViewId": "FRONT:ORIGINAL",
            "supportingViewIds": [],
            "reviewResult": "ACCEPTED",
        }

        measured = measure_marks([], "FRONT", "SQUARE", findings=[existing])

        self.assertEqual(
            [finding["id"] for finding in measured["defects"]],
            ["legacy:CORNERS", "legacy:CORNERS:EDGES", "legacy:CORNERS:SURFACE"],
        )

    def test_explicit_null_final_trace_without_provenance_is_legacy_contour(self):
        legacy = {
            "id": "nullable-legacy:SURFACE",
            "side": "BACK",
            "zone": "SURFACE",
            "defectType": "FRAYING",
            "confidence": 0.8,
            "canonicalContour": contour_rectangle(300, 500, 320, 520),
            "sourceViewId": "BACK:ORIGINAL",
            "supportingViewIds": [],
            "reviewResult": "ACCEPTED",
            "finalTrace": None,
        }

        measured = measure_marks([], "BACK", "SQUARE", findings=[legacy])

        self.assertNotIn("traceErrors", measured)
        self.assertEqual([finding["id"] for finding in measured["defects"]], [legacy["id"]])
        self.assertGreater(measured["defects"][0]["measurement"]["areaMm2"], 0)

    def test_exact_mark_overlapping_contour_finding_is_aggregated_once(self):
        existing = {
            "id": "memory-contour:SURFACE",
            "side": "FRONT",
            "zone": "SURFACE",
            "defectType": "LIFTING_DEFORMATION",
            "detectedDefectType": "VISIBLE_WHITENING",
            "origin": "MEMORY",
            "confidence": 0.91,
            "canonicalContour": contour_rectangle(300, 500, 360, 560),
            "sourceViewId": "FRONT:ORIGINAL",
            "supportingViewIds": [],
            "reviewResult": "TYPE_CORRECTED",
            "featureFingerprint": [1.0] + [0.0] * 31,
            "memoryProposal": {
                "lessonSessionId": "cubone-lesson",
                "lessonCompletionOrder": 228,
                "lessonProposalOrder": 7,
                "lessonOrder": 0,
                "lessonSourceViewId": "ORIGINAL",
                "similarity": 0.94,
            },
            "measurement": {
                "widthMm": 999.0,
                "heightMm": 999.0,
                "areaMm2": 999.0,
                "zonePercent": 999.0,
                "multiplier": 2.0,
                "weightedAreaMm2": 1998.0,
                "subgradeEffect": 9.0,
            },
        }
        baseline = measure_marks([], "FRONT", "SQUARE", findings=[existing])
        exact = encode_trace_rle(trace_rectangle(310, 510, 350, 550))

        measured = measure_marks(
            [{
                "id": "redundant-exact",
                "defectType": "FAINT_COLOR_VARIATION",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": exact,
                "traceProvenance": trace_provenance(exact),
            }],
            "FRONT",
            "SQUARE",
            findings=[existing],
        )

        self.assertEqual(
            sum(item["measurement"]["weightedAreaMm2"] for item in measured["defects"]),
            sum(item["measurement"]["weightedAreaMm2"] for item in baseline["defects"]),
        )
        self.assertNotIn(
            "redundant-exact:SURFACE",
            {item["id"] for item in measured["defects"]},
        )
        kept = next(item for item in measured["defects"] if item["id"] == existing["id"])
        for field in (
            "id",
            "defectType",
            "detectedDefectType",
            "origin",
            "reviewResult",
            "featureFingerprint",
            "memoryProposal",
        ):
            self.assertEqual(kept[field], existing[field])
        self.assertNotEqual(kept["measurement"], existing["measurement"])

    def test_contour_only_new_mark_is_inert_and_cannot_mutate_grade(self):
        existing = {
            "id": "detector:SURFACE",
            "side": "BACK",
            "zone": "SURFACE",
            "defectType": "VISIBLE_WHITENING",
            "origin": "DETECTOR",
            "confidence": 0.8,
            "canonicalContour": contour_rectangle(300, 500, 330, 530),
            "sourceViewId": "BACK:ORIGINAL",
            "supportingViewIds": [],
            "reviewResult": "ACCEPTED",
            "measurement": {
                "widthMm": 1.0,
                "heightMm": 1.0,
                "areaMm2": 1.0,
                "zonePercent": 0.1,
                "multiplier": 1.0,
                "weightedAreaMm2": 1.0,
                "subgradeEffect": 0.1,
            },
        }
        baseline = measure_marks([], "BACK", "SQUARE", findings=[existing])

        attempted = measure_marks(
            [{
                "id": "forbidden-contour-mark",
                "defectType": "PEELING_HEAVY_DAMAGE",
                "canonicalContour": contour_rectangle(0, 0, GRID_WIDTH - 1, GRID_HEIGHT - 1),
                "sourceViewId": "BACK:ORIGINAL",
            }],
            "BACK",
            "SQUARE",
            findings=[existing],
        )

        self.assertEqual(attempted, baseline)
        self.assertNotIn(
            "forbidden-contour-mark",
            " ".join(item["id"] for item in attempted["defects"]),
        )

    def test_existing_exact_trace_keeps_source_id_and_moves_measurement_into_regions(self):
        final_trace = encode_trace_rle(trace_rectangle(0, 0, 140, 150))
        finding = {
            "id": "exact-source:SURFACE",
            "side": "FRONT",
            "zone": "SURFACE",
            "defectType": "VISIBLE_WHITENING",
            "origin": "SMART_MARK",
            "confidence": 1.0,
            "canonicalContour": contour_rectangle(0, 0, 140, 150),
            "sourceViewId": "FRONT:ORIGINAL",
            "supportingViewIds": [],
            "reviewResult": "SMART_MARKED",
            "finalTrace": final_trace,
            "traceProvenance": trace_provenance(final_trace),
            "measurement": {
                "widthMm": 1.0,
                "heightMm": 1.0,
                "areaMm2": 1.0,
                "zonePercent": 0.1,
                "multiplier": 1.0,
                "weightedAreaMm2": 1.0,
                "subgradeEffect": 0.1,
            },
        }

        measured = measure_marks([], "FRONT", "SQUARE", findings=[finding])

        self.assertEqual(len(measured["defects"]), 1)
        source = measured["defects"][0]
        self.assertEqual(source["id"], "exact-source:SURFACE")
        self.assertEqual(
            [region["zone"] for region in source["measurementRegions"]],
            ["CORNERS", "EDGES", "SURFACE"],
        )
        self.assertNotIn("zone", source)
        self.assertNotIn("canonicalContour", source)
        self.assertNotIn("measurement", source)

    def test_final_trace_is_source_geometry_and_regions_do_not_duplicate_its_bytes(self):
        mask = trace_rectangle(0, 0, 140, 150)
        mask[20:40, 20:40] = 0
        final_trace = encode_trace_rle(mask)
        provenance = trace_provenance(final_trace, strokes=[{
                "canonicalPoints": [{"x": 1, "y": 2}, {"x": 3, "y": 4}],
                "strokeWidthMm": 1.5,
            }])
        processor = FixedTraceProcessor(fingerprint=[1.0] + [0.0] * 31)

        result = measure_marks(
            [{
                "id": "smart-exact",
                "defectType": "VISIBLE_WHITENING",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": final_trace,
                "traceProvenance": provenance,
            }],
            "FRONT",
            "SQUARE",
            evidence_image=np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
            evidence_view_id="FRONT:ORIGINAL",
            inspection_frame={
                "width": GRID_WIDTH,
                "height": GRID_HEIGHT,
                "cardBounds": {"x": 0, "y": 0, "width": GRID_WIDTH, "height": GRID_HEIGHT},
            },
            processor=processor,
        )

        self.assertEqual(len(result["defects"]), 1)
        self.assertEqual(len(processor.fingerprint_calls), 1)
        np.testing.assert_array_equal(processor.fingerprint_calls[0][1], mask)
        source = result["defects"][0]
        self.assertEqual(source["id"], "smart-exact")
        self.assertEqual(source["finalTrace"], final_trace)
        self.assertEqual(source["traceProvenance"], provenance)
        self.assertEqual(source["featureFingerprint"], [1.0] + [0.0] * 31)
        self.assertNotIn("smartMarkLearning", source)
        self.assertEqual(
            [region["zone"] for region in source["measurementRegions"]],
            ["CORNERS", "EDGES", "SURFACE"],
        )
        for region in source["measurementRegions"]:
            self.assertEqual(
                set(region), {"zone", "canonicalContour", "measurement"}
            )
            self.assertNotIn("finalTrace", region)
            self.assertNotIn("traceProvenance", region)

    def test_invalid_missing_bad_hash_and_empty_trace_create_no_new_finding(self):
        mask = trace_rectangle(20, 20, 30, 30)
        good = encode_trace_rle(mask)
        bad_hash = {**good, "sha256": "0" * 64}
        empty_runs = [GRID_WIDTH * GRID_HEIGHT]
        empty = {
            **good,
            "runs": empty_runs,
            "sha256": trace_sha256(empty_runs),
        }
        marks = [
            {
                "id": "missing",
                "defectType": "VISIBLE_WHITENING",
                "sourceViewId": "FRONT:ORIGINAL",
                "traceProvenance": trace_provenance(good),
            },
            {
                "id": "bad-hash",
                "defectType": "VISIBLE_WHITENING",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": bad_hash,
                "traceProvenance": trace_provenance(bad_hash),
            },
            {
                "id": "empty",
                "defectType": "VISIBLE_WHITENING",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": empty,
                "traceProvenance": trace_provenance(empty),
            },
        ]

        with patch("sam3_detector._rasterize", side_effect=AssertionError("fallback"), create=True):
            result = measure_marks(marks, "FRONT", "SQUARE")

        self.assertEqual(result, {"defects": []})
        explicit_null = measure(MeasureRequest(
            side="FRONT",
            cornerShape="SQUARE",
            marks=[{
                "id": "explicit-null",
                "defectType": "VISIBLE_WHITENING",
                "sourceViewId": "FRONT:ORIGINAL",
                "canonicalContour": contour_rectangle(20, 20, 30, 30),
                "finalTrace": None,
            }],
        ))
        self.assertEqual(explicit_null, {"defects": []})

    def test_active_contour_finding_with_measurement_is_recomputed_with_provenance(self):
        active = {
            "id": "contour-active:SURFACE",
            "side": "BACK",
            "zone": "SURFACE",
            "defectType": "FRAYING",
            "confidence": 0.81,
            "canonicalContour": contour_rectangle(300, 500, 340, 540),
            "sourceViewId": "BACK:ORIGINAL",
            "supportingViewIds": [],
            "reviewResult": "ACCEPTED",
            "measurement": {
                "widthMm": 2.0,
                "heightMm": 2.0,
                "areaMm2": 3.9,
                "zonePercent": 0.2,
                "multiplier": 1.25,
                "weightedAreaMm2": 4.875,
                "subgradeEffect": 0.1,
            },
        }
        original = deepcopy(active)

        result = measure_marks([], "BACK", "SQUARE", findings=[active])

        self.assertEqual(len(result["defects"]), 1)
        recomputed = result["defects"][0]
        self.assertEqual(recomputed["id"], active["id"])
        self.assertEqual(recomputed["reviewResult"], active["reviewResult"])
        self.assertNotEqual(recomputed["measurement"], active["measurement"])
        self.assertEqual(active, original)

    def test_valid_trace_measurement_survives_fingerprint_failure_without_failure_provenance(self):
        final_trace = encode_trace_rle(trace_rectangle(300, 500, 320, 520))
        processor = FixedTraceProcessor(error=RuntimeError("SAM unavailable"))
        request = MeasureRequest(
            side="FRONT",
            cornerShape="SQUARE",
            evidenceView={
                "id": "FRONT:ORIGINAL",
                "imageBase64": image_base64(),
                "inspectionFrame": INSPECTION_FRAME,
            },
            marks=[{
                "id": "smart-valid",
                "defectType": "VISIBLE_WHITENING",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": final_trace,
                "traceProvenance": trace_provenance(final_trace),
            }],
        )

        with patch("app.get_processor", return_value=processor):
            result = measure(request)

        self.assertTrue(result["defects"])
        self.assertEqual(result["defects"][0]["finalTrace"], final_trace)
        self.assertNotIn("featureFingerprint", result["defects"][0])
        self.assertNotIn("smartMarkLearning", result["defects"][0])

    def test_shadowed_saved_trace_keeps_ids_review_fingerprint_memory_and_source_bytes(self):
        existing_trace = encode_trace_rle(trace_rectangle(300, 500, 320, 520))
        winning_trace = encode_trace_rle(trace_rectangle(295, 495, 325, 525))
        memory = {
            "lessonSessionId": "cubone-lesson",
            "lessonCompletionOrder": 228,
            "lessonProposalOrder": 7,
            "lessonOrder": 0,
            "lessonSourceViewId": "ORIGINAL",
            "similarity": 0.94,
        }
        provenance = trace_provenance(existing_trace, strokes=[{
                "canonicalPoints": [{"x": 300, "y": 500}],
                "strokeWidthMm": 1.5,
            }])
        existing = {
            "id": "memory-source:SURFACE",
            "side": "FRONT",
            "zone": "SURFACE",
            "defectType": "LIFTING_DEFORMATION",
            "detectedDefectType": "VISIBLE_WHITENING",
            "origin": "MEMORY",
            "confidence": 0.91,
            "canonicalContour": contour_rectangle(300, 500, 320, 520),
            "sourceViewId": "FRONT:ORIGINAL",
            "supportingViewIds": ["FRONT:MICRO_DEFECT"],
            "reviewResult": "TYPE_CORRECTED",
            "featureFingerprint": [1.0] + [0.0] * 31,
            "learningAdjustment": 0.0,
            "memoryProposal": memory,
            "finalTrace": existing_trace,
            "traceProvenance": provenance,
            "measurement": {
                "widthMm": 1.0,
                "heightMm": 1.0,
                "areaMm2": 1.0,
                "zonePercent": 0.1,
                "multiplier": 2.0,
                "weightedAreaMm2": 2.0,
                "subgradeEffect": 0.1,
            },
        }

        result = measure_marks(
            [{
                "id": "smart-winner",
                "defectType": "PEELING_HEAVY_DAMAGE",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": winning_trace,
                "traceProvenance": trace_provenance(winning_trace),
            }],
            "FRONT",
            "SQUARE",
            findings=[existing],
        )

        by_id = {finding["id"]: finding for finding in result["defects"]}
        preserved = by_id[existing["id"]]
        for field in (
            "id",
            "side",
            "defectType",
            "detectedDefectType",
            "origin",
            "confidence",
            "sourceViewId",
            "supportingViewIds",
            "reviewResult",
            "featureFingerprint",
            "learningAdjustment",
            "memoryProposal",
            "finalTrace",
            "traceProvenance",
        ):
            self.assertEqual(preserved[field], existing[field])
        self.assertNotIn("zone", preserved)
        self.assertNotIn("canonicalContour", preserved)
        self.assertNotIn("measurement", preserved)
        self.assertEqual(preserved["measurementRegions"], [])
        winner = by_id["smart-winner"]
        self.assertEqual(winner["finalTrace"], winning_trace)
        self.assertEqual(winner["origin"], "SMART_MARK")
        self.assertEqual(
            [region["zone"] for region in winner["measurementRegions"]],
            ["SURFACE"],
        )

    def test_invalid_existing_trace_is_preserved_opaque_and_measure_endpoint_fails_closed(self):
        final_trace = encode_trace_rle(trace_rectangle(300, 500, 320, 520))
        final_trace["sha256"] = "0" * 64
        existing = {
            "id": "tampered:SURFACE",
            "side": "FRONT",
            "zone": "SURFACE",
            "defectType": "VISIBLE_WHITENING",
            "origin": "SMART_MARK",
            "confidence": 1.0,
            "canonicalContour": contour_rectangle(300, 500, 320, 520),
            "sourceViewId": "FRONT:ORIGINAL",
            "supportingViewIds": [],
            "reviewResult": "SMART_MARKED",
            "finalTrace": final_trace,
            "traceProvenance": trace_provenance(final_trace),
            "measurement": {
                "widthMm": 1.0,
                "heightMm": 1.0,
                "areaMm2": 1.0,
                "zonePercent": 0.1,
                "multiplier": 1.0,
                "weightedAreaMm2": 1.0,
                "subgradeEffect": 0.1,
            },
        }
        frozen = deepcopy(existing)

        direct = measure_marks([], "FRONT", "SQUARE", findings=[existing])

        self.assertEqual(direct["defects"], [frozen])
        self.assertEqual(
            direct["traceErrors"],
            [{
                "code": "INVALID_EXISTING_FINAL_TRACE",
                "findingId": existing["id"],
            }],
        )
        self.assertEqual(existing, frozen)
        with self.assertRaises(HTTPException) as raised:
            measure(MeasureRequest(
                side="FRONT",
                cornerShape="SQUARE",
                marks=[],
                findings=[existing],
            ))
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(
            raised.exception.detail,
            {
                "code": "INVALID_EXISTING_SPEEDSTER_TRACE",
                "findingIds": [existing["id"]],
            },
        )

    def test_invalid_existing_provenance_is_frozen_and_invalid_new_provenance_is_inert(self):
        final_trace = encode_trace_rle(trace_rectangle(300, 500, 320, 520))
        existing = {
            "id": "bad-provenance",
            "side": "FRONT",
            "defectType": "VISIBLE_WHITENING",
            "origin": "SMART_MARK",
            "confidence": 1.0,
            "sourceViewId": "FRONT:ORIGINAL",
            "supportingViewIds": [],
            "reviewResult": "SMART_MARKED",
            "finalTrace": final_trace,
            "traceProvenance": {
                **trace_provenance(final_trace),
                "finalTraceSha256": "0" * 64,
            },
            "measurementRegions": [{"opaque": "must-not-change"}],
        }
        frozen = deepcopy(existing)
        missing = {
            **existing,
            "id": "missing-provenance",
            "measurementRegions": [{"opaque": "also-must-not-change"}],
        }
        missing.pop("traceProvenance")
        frozen_missing = deepcopy(missing)

        direct = measure_marks([], "FRONT", "SQUARE", findings=[existing, missing])

        self.assertEqual(direct["defects"], [frozen, frozen_missing])
        self.assertEqual(
            direct["traceErrors"],
            [
                {
                    "code": "INVALID_EXISTING_TRACE_PROVENANCE",
                    "findingId": existing["id"],
                },
                {
                    "code": "INVALID_EXISTING_TRACE_PROVENANCE",
                    "findingId": missing["id"],
                },
            ],
        )
        self.assertEqual(existing, frozen)
        self.assertEqual(missing, frozen_missing)

        mismatched_source = {
            **trace_provenance(final_trace),
            "sourceViewId": "FRONT:DIRECTIONAL",
        }
        invalid_crop = deepcopy(trace_provenance(final_trace))
        invalid_crop["cropTransform"]["crop"]["width"] = float("nan")
        invalid_point = deepcopy(trace_provenance(final_trace))
        invalid_point["highlighterStrokes"][0]["canonicalPoints"][0]["x"] = 1.5
        invalid_width = deepcopy(trace_provenance(final_trace))
        invalid_width["highlighterStrokes"][0]["strokeWidthMm"] = 0
        for label, provenance in (
            ("source", mismatched_source),
            ("crop", invalid_crop),
            ("point", invalid_point),
            ("width", invalid_width),
        ):
            with self.subTest(label=label):
                invalid_new = measure_marks(
                    [{
                        "id": f"bad-new-{label}",
                        "defectType": "VISIBLE_WHITENING",
                        "sourceViewId": "FRONT:ORIGINAL",
                        "finalTrace": final_trace,
                        "traceProvenance": provenance,
                    }],
                    "FRONT",
                    "SQUARE",
                )
                self.assertEqual(invalid_new, {"defects": []})

    def test_new_fingerprint_requires_matching_normalized_source_view(self):
        final_trace = encode_trace_rle(trace_rectangle(300, 500, 320, 520))
        processor = FixedTraceProcessor(fingerprint=[1.0] + [0.0] * 31)
        mark = {
            "id": "view-bound",
            "defectType": "VISIBLE_WHITENING",
            "sourceViewId": "ORIGINAL",
            "finalTrace": final_trace,
            "traceProvenance": trace_provenance(final_trace, "FRONT:ORIGINAL"),
        }
        frame = {
            "width": GRID_WIDTH,
            "height": GRID_HEIGHT,
            "cardBounds": {"x": 0, "y": 0, "width": GRID_WIDTH, "height": GRID_HEIGHT},
        }

        mismatched = measure_marks(
            [mark],
            "FRONT",
            "SQUARE",
            evidence_image=np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
            evidence_view_id="FRONT:DIRECTIONAL",
            inspection_frame=frame,
            processor=processor,
        )

        self.assertEqual(processor.fingerprint_calls, [])
        self.assertNotIn("featureFingerprint", mismatched["defects"][0])
        self.assertTrue(mismatched["defects"][0]["measurementRegions"])

        matching = measure_marks(
            [mark],
            "FRONT",
            "SQUARE",
            evidence_image=np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
            evidence_view_id="FRONT:ORIGINAL",
            inspection_frame=frame,
            processor=processor,
        )
        self.assertEqual(len(processor.fingerprint_calls), 1)
        self.assertEqual(matching["defects"][0]["featureFingerprint"], [1.0] + [0.0] * 31)

    def test_human_trace_revision_replaces_existing_fingerprint_and_binds_it_to_final_trace(self):
        prior_trace = encode_trace_rle(trace_rectangle(300, 500, 320, 520))
        final_trace = encode_trace_rle(trace_rectangle(300, 500, 330, 530))
        provenance = trace_provenance(final_trace)
        prior_fingerprint = [1.0] + [0.0] * 31
        prior_memory = {
            "lessonSessionId": "immutable-lesson",
            "lessonCompletionOrder": 7,
            "lessonProposalOrder": 3,
            "lessonOrder": 1,
            "lessonSourceViewId": "ORIGINAL",
            "similarity": 0.93,
        }
        existing = {
            "id": "existing-exact",
            "side": "FRONT",
            "defectType": "VISIBLE_WHITENING",
            "origin": "MEMORY",
            "confidence": 0.91,
            "sourceViewId": "FRONT:ORIGINAL",
            "supportingViewIds": [],
            "reviewResult": "ACCEPTED",
            "featureFingerprint": prior_fingerprint,
            "memoryProposal": prior_memory,
            "finalTrace": prior_trace,
            "traceProvenance": trace_provenance(prior_trace),
        }
        processor = FixedTraceProcessor(fingerprint=[0.0, 1.0] + [0.0] * 30)

        measured = measure_marks(
            [{
                "id": existing["id"],
                "defectType": existing["defectType"],
                "sourceViewId": existing["sourceViewId"],
                "finalTrace": final_trace,
                "traceProvenance": provenance,
            }],
            "FRONT",
            "SQUARE",
            evidence_image=np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
            evidence_view_id="FRONT:ORIGINAL",
            inspection_frame={
                "width": GRID_WIDTH,
                "height": GRID_HEIGHT,
                "cardBounds": {
                    "x": 0,
                    "y": 0,
                    "width": GRID_WIDTH,
                    "height": GRID_HEIGHT,
                },
            },
            processor=processor,
            findings=[existing],
        )

        self.assertEqual(len(processor.fingerprint_calls), 1)
        source = measured["defects"][0]
        self.assertEqual(source["featureFingerprint"], [0.0, 1.0] + [0.0] * 30)
        self.assertEqual(source["featureFingerprintTraceSha256"], final_trace["sha256"])
        self.assertEqual(source["memoryProposal"], prior_memory)
        self.assertEqual(source["traceProvenance"], provenance)

    def test_sparse_exact_trace_emits_one_valid_child_contour_covering_all_components(self):
        source_mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        source_mask[500, 400] = 1
        source_mask[900, 800] = 1
        final_trace = encode_trace_rle(source_mask)

        measured = measure_marks(
            [{
                "id": "sparse-exact-source",
                "defectType": "VISIBLE_WHITENING",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": final_trace,
                "traceProvenance": trace_provenance(final_trace),
            }],
            "FRONT",
            "SQUARE",
        )

        self.assertEqual(len(measured["defects"]), 1)
        source = measured["defects"][0]
        self.assertEqual(source["finalTrace"], final_trace)
        self.assertEqual(len(source["measurementRegions"]), 1)
        region = source["measurementRegions"][0]
        self.assertEqual(region["zone"], "SURFACE")
        self.assertEqual(region["measurement"]["pixelCount"], 2)
        self.assertEqual(len(region["canonicalContour"]), 4)
        xs = [point["x"] for point in region["canonicalContour"]]
        ys = [point["y"] for point in region["canonicalContour"]]
        self.assertLessEqual(min(xs), 400 / (GRID_WIDTH - 1))
        self.assertGreaterEqual(max(xs), 800 / (GRID_WIDTH - 1))
        self.assertLessEqual(min(ys), 500 / (GRID_HEIGHT - 1))
        self.assertGreaterEqual(max(ys), 900 / (GRID_HEIGHT - 1))

        single_mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        single_mask[700, 600] = 1
        single_trace = encode_trace_rle(single_mask)
        single = measure_marks(
            [{
                "id": "one-pixel-exact-source",
                "defectType": "VISIBLE_WHITENING",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": single_trace,
                "traceProvenance": trace_provenance(single_trace),
            }],
            "FRONT",
            "SQUARE",
        )["defects"][0]["measurementRegions"][0]
        self.assertEqual(single["measurement"]["pixelCount"], 1)
        self.assertEqual(len(single["canonicalContour"]), 4)
        self.assertEqual(
            len({(point["x"], point["y"]) for point in single["canonicalContour"]}),
            4,
        )


if __name__ == "__main__":
    unittest.main()
