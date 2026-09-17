"""Exact CPU extraction parity; no service startup, model or network calls.

Run with pinned numpy/OpenCV/Pillow from the existing worker requirements:
    python -B -m unittest test_manual_measurement test_defect_math test_trace_rle
Pillow is used only by the unchanged legacy module used as the parity oracle.
"""

import ast
from copy import deepcopy
import hashlib
import inspect
from pathlib import Path
import subprocess
import sys
import textwrap
import unittest
from unittest.mock import patch

import cv2
import numpy as np

import manual_measurement as cpu
import sam3_detector as legacy
from card_geometry import INSPECTION_HEIGHT, INSPECTION_WIDTH, detector_material_mask
from defect_math import (
    GRID_HEIGHT, GRID_WIDTH, CARD_WIDTH_MM, CARD_HEIGHT_MM,
    _fused_groups, _should_fuse, _zone_masks, material_mask, measure_defects,
)
from trace_rle import decode_trace_rle, encode_trace_rle


FRAME = {
    "width": INSPECTION_WIDTH, "height": INSPECTION_HEIGHT,
    "cardBounds": {"x": 40, "y": 40, "width": GRID_WIDTH, "height": GRID_HEIGHT},
}
PIXEL_AREA = CARD_WIDTH_MM * CARD_HEIGHT_MM / (GRID_WIDTH * GRID_HEIGHT)


def rectangle(x, y, width, height):
    mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
    mask[y:y + height, x:x + width] = 1
    return mask


def exact_finding(identity, mask, *, side="FRONT", defect_type="VISIBLE_WHITENING",
                  view="ORIGINAL", confidence=0.9):
    trace = encode_trace_rle(mask)
    return {
        "id": identity, "side": side, "defectType": defect_type,
        "sourceViewId": f"{side}:{view}", "supportingViewIds": [],
        "confidence": confidence, "origin": "SMART_MARK", "reviewResult": "SMART_MARKED",
        "finalTrace": trace,
        "traceProvenance": {
            "version": cpu.TRACE_PROVENANCE_VERSION,
            "sourceViewId": f"{side}:{view}",
            "cropTransform": {
                "version": cpu.TRACE_CROP_TRANSFORM_VERSION,
                "crop": {"x": 0, "y": 0, "width": 1269, "height": 1777},
            },
            "highlighterStrokes": [], "finalTraceSha256": trace["sha256"],
        },
    }


def detector_finding(identity, mask, **kwargs):
    finding = exact_finding(identity, mask, **kwargs)
    finding["detectorMask"] = finding.pop("finalTrace")
    finding.pop("traceProvenance")
    finding.update(origin="DETECTOR", reviewResult="ACCEPTED")
    return finding


def freeze(value):
    """Compare every raw field; exact array bytes are authority, not contours."""
    if isinstance(value, np.ndarray):
        return (str(value.dtype), value.shape, value.tobytes())
    if isinstance(value, dict):
        return {key: freeze(item) for key, item in value.items()}
    if isinstance(value, list):
        return [freeze(item) for item in value]
    return value


def region_pixels(finding):
    if "measurementRegions" in finding:
        return sum(region["measurement"]["pixelCount"] for region in finding["measurementRegions"])
    return finding["measurement"]["pixelCount"]


class CpuMeasurementParityTests(unittest.TestCase):
    def parity(self, marks, findings, *, side="FRONT", shape="SQUARE", **evidence):
        originals = deepcopy((marks, findings))
        raw_by_module = []
        outputs = []
        for module in (legacy, cpu):
            raw = []

            def measure(proposals, corner_shape):
                result = measure_defects(proposals, corner_shape)
                raw.extend(deepcopy(result))
                return result

            with patch.object(module, "measure_defects", side_effect=measure), patch.object(
                legacy, "get_processor", side_effect=AssertionError("A model must never load")
            ) as no_model:
                outputs.append(module.measure_marks(
                    marks, side, shape, findings=findings, **evidence
                ))
                no_model.assert_not_called()
            raw_by_module.append(raw)
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(freeze(raw_by_module[0]), freeze(raw_by_module[1]))
        self.assertEqual(
            cpu.measure_manual_side(marks, side, shape, findings=findings, **evidence),
            outputs[1],
        )
        self.assertEqual((marks, findings), originals)
        return outputs[1], raw_by_module[1]

    def test_copied_cpu_helpers_remain_exact_and_baseline_hash_is_recorded(self):
        self.assertEqual(
            hashlib.sha256(Path(legacy.__file__).read_bytes()).hexdigest(),
            cpu.EXTRACTION_SOURCE_SHA256,
        )
        for name in (
            "_condition_score", "_defect_id", "_measurement_payload",
            "_measurement_region_contour", "_trace_source_record", "_to_speedster_defects",
            "_canonical_source_view_id", "_finite_number", "_valid_trace_provenance",
        ):
            with self.subTest(helper=name):
                self.assertEqual(
                    ast.dump(ast.parse(textwrap.dedent(inspect.getsource(getattr(cpu, name))))),
                    ast.dump(ast.parse(textwrap.dedent(inspect.getsource(getattr(legacy, name))))),
                )

    def test_import_and_direct_brush_measurement_need_no_detector_or_model_packages(self):
        script = '''
import importlib.abc
import sys
class DenyOptional(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {
            'sam3_detector', 'sam_memory_v2', 'torch', 'torchvision', 'sam3',
            'PIL', 'app', 'fastapi', 'requests', 'httpx',
        }:
            raise AssertionError('CPU path imported ' + fullname)
sys.meta_path.insert(0, DenyOptional())
import manual_measurement as cpu
import numpy as np
from trace_rle import encode_trace_rle
mask = np.zeros((1778, 1270), dtype=np.uint8)
mask[600:603, 600:604] = 1
trace = encode_trace_rle(mask)
provenance = {'version': cpu.TRACE_PROVENANCE_VERSION, 'sourceViewId': 'FRONT:ORIGINAL',
    'cropTransform': {'version': cpu.TRACE_CROP_TRANSFORM_VERSION,
        'crop': {'x': 0, 'y': 0, 'width': 1269, 'height': 1777}},
    'highlighterStrokes': [], 'finalTraceSha256': trace['sha256']}
result = cpu.measure_marks([{'id': 'manual', 'defectType': 'VISIBLE_WHITENING',
    'sourceViewId': 'FRONT:ORIGINAL', 'finalTrace': trace, 'traceProvenance': provenance}],
    'FRONT', 'SQUARE', evidence_image=np.zeros((1858, 1350, 3), dtype=np.uint8),
    evidence_view_id='FRONT:ORIGINAL', inspection_frame={'width': 1350, 'height': 1858})
assert result['defects'][0]['measurementRegions'][0]['measurement']['pixelCount'] == 12
print('CPU import and manual measurement passed without optional packages')
'''
        result = subprocess.run(
            [sys.executable, "-B", "-c", script], cwd=Path(__file__).parent,
            capture_output=True, text=True, timeout=30, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_holes_disconnected_components_extremes_and_material_zones_are_exact(self):
        mask = rectangle(0, 0, 150, 150)
        mask[30:80, 30:80] = 0
        mask[0, GRID_WIDTH - 1] = 1
        mask[GRID_HEIGHT - 1, 0] = 1
        mask[GRID_HEIGHT - 1, GRID_WIDTH - 1] = 1
        mask[700, 900] = 1
        for shape in ("SQUARE", "ROUNDED_3_18_MM"):
            for side in ("FRONT", "BACK"):
                with self.subTest(shape=shape, side=side):
                    mark = exact_finding("brush", mask, side=side)
                    output, raw = self.parity([mark], [], side=side, shape=shape)
                    allowed = material_mask(shape)
                    expected = mask & allowed
                    owned = np.zeros_like(mask)
                    zones = _zone_masks(allowed)
                    for result in raw:
                        np.testing.assert_array_equal(result["canonicalMask"], expected & zones[result["zone"]])
                        self.assertFalse(np.any(owned & result["canonicalMask"]))
                        owned |= result["canonicalMask"]
                        expected_percent = (
                            np.count_nonzero(result["canonicalMask"])
                            / np.count_nonzero(zones[result["zone"]]) * 100
                        )
                        self.assertAlmostEqual(result["eligibleZonePercent"], expected_percent, places=12)
                    np.testing.assert_array_equal(owned, expected)
                    self.assertEqual(region_pixels(output["defects"][0]), np.count_nonzero(expected))
                    self.assertEqual(output["defects"][0]["finalTrace"], mark["finalTrace"])
                    self.assertEqual(mask[50, 50], 0)

    def test_existing_detector_and_manual_masks_share_pixel_ownership_and_provenance(self):
        detector_mask = rectangle(20, 80, 120, 70)
        detector_mask[100:110, 70:90] = 0
        trace_mask = rectangle(75, 95, 120, 90)
        existing = detector_finding("detector:CORNERS", detector_mask, defect_type="FRAYING")
        existing.update(
            origin="MEMORY", reviewResult="TYPE_CORRECTED", detectedDefectType="VISIBLE_WHITENING",
            memoryProposal={"lessonKey": "example"}, featureFingerprint=[1.0] + [0.0] * 31,
            measurement={"areaMm2": 999, "pixelCount": 999},
        )
        mark = exact_finding("manual", trace_mask, defect_type="LIFTING_DEFORMATION")
        output, raw = self.parity([mark], [existing])
        union = detector_mask | trace_mask
        self.assertEqual(sum(region_pixels(item) for item in output["defects"]), np.count_nonzero(union))
        for result in raw:
            if result["proposalId"] == "manual":
                self.assertEqual(np.count_nonzero(result["canonicalMask"] & ~trace_mask), 0)
            else:
                self.assertFalse(np.any(result["canonicalMask"] & trace_mask))
        for item in output["defects"]:
            if "detectorMask" in item:
                self.assertEqual(np.count_nonzero(decode_trace_rle(item["detectorMask"])), item["measurement"]["pixelCount"])
                for key in ("origin", "reviewResult", "detectedDefectType", "memoryProposal", "featureFingerprint"):
                    self.assertEqual(item[key], existing[key])

    def test_remove_type_change_and_undo_reassign_pixels_with_exact_tie_order(self):
        first_mask = rectangle(300, 500, 100, 90)
        second_mask = rectangle(350, 545, 100, 90)
        first = exact_finding("first", first_mask)
        second = exact_finding("second", second_mask)
        initial, _ = self.parity([], [first, second])
        initial_by_id = {item["id"]: item for item in initial["defects"]}
        self.assertEqual(region_pixels(initial_by_id["first"]), np.count_nonzero(first_mask))
        self.assertEqual(region_pixels(initial_by_id["second"]), np.count_nonzero(second_mask & ~first_mask))
        corrected = {**second, "defectType": "LIFTING_DEFORMATION", "reviewResult": "TYPE_CORRECTED"}
        changed, _ = self.parity([], [first, corrected])
        changed_by_id = {item["id"]: item for item in changed["defects"]}
        self.assertEqual(region_pixels(changed_by_id["first"]), np.count_nonzero(first_mask & ~second_mask))
        self.assertEqual(region_pixels(changed_by_id["second"]), np.count_nonzero(second_mask))
        removed, _ = self.parity([], [first])
        self.assertEqual(region_pixels(removed["defects"][0]), np.count_nonzero(first_mask))
        undo, _ = self.parity([], [first, second])
        self.assertEqual(undo, initial)
        ranked = {**second, "rankingConfidence": 0.91}
        ranked_output, _ = self.parity([], [first, ranked])
        ranked_by_id = {item["id"]: item for item in ranked_output["defects"]}
        self.assertEqual(region_pixels(ranked_by_id["second"]), np.count_nonzero(second_mask))

    def test_shadowed_saved_trace_retains_opaque_source_and_empty_regions(self):
        mask = rectangle(300, 500, 30, 30)
        low = exact_finding("saved", mask, defect_type="FAINT_COLOR_VARIATION")
        low.update(origin="MEMORY", reviewResult="TYPE_CORRECTED", featureFingerprint=[0.5],
                   featureFingerprintTraceSha256=low["finalTrace"]["sha256"], memoryProposal={"lessonKey": "retained"})
        high = detector_finding("higher", mask, defect_type="LIFTING_DEFORMATION")
        output, _ = self.parity([], [high, low])
        saved = next(item for item in output["defects"] if item["id"] == "saved")
        self.assertEqual(saved["measurementRegions"], [])
        for key, value in low.items():
            self.assertEqual(saved[key], value)

    def test_trace_revision_keeps_existing_source_identity_and_discards_stale_fingerprint(self):
        old_mask = rectangle(300, 500, 40, 40)
        new_mask = rectangle(315, 520, 17, 11)
        saved = exact_finding("same-source:SURFACE", old_mask, confidence=0.72)
        saved.update(origin="MEMORY", reviewResult="TYPE_CORRECTED",
                     featureFingerprint=[0.5], featureFingerprintTraceSha256=saved["finalTrace"]["sha256"],
                     memoryProposal={"lessonKey": "kept"}, detectedDefectType="FRAYING")
        edited = exact_finding("same-source:SURFACE", new_mask)
        for key in ("origin", "reviewResult", "confidence", "supportingViewIds"):
            edited.pop(key)
        output, raw = self.parity([edited], [saved])
        self.assertEqual(len(output["defects"]), 1)
        result = output["defects"][0]
        for key in ("id", "origin", "reviewResult", "confidence", "memoryProposal", "detectedDefectType"):
            self.assertEqual(result[key], saved[key])
        self.assertEqual(result["finalTrace"], edited["finalTrace"])
        self.assertNotIn("featureFingerprint", result)
        self.assertNotIn("featureFingerprintTraceSha256", result)
        self.assertEqual(region_pixels(result), 17 * 11)
        np.testing.assert_array_equal(raw[0]["canonicalMask"], new_mask)

    def test_fractional_crop_is_provenance_and_does_not_transform_canonical_pixels_twice(self):
        mark = exact_finding("fractional", rectangle(700, 900, 7, 3))
        mark["traceProvenance"]["cropTransform"]["crop"] = {
            "x": 10.25, "y": 31.75, "width": 899.5, "height": 1000.125,
        }
        mark["traceProvenance"]["highlighterStrokes"] = [{
            "canonicalPoints": [{"x": 700, "y": 900}, {"x": 706, "y": 902}],
            "strokeWidthMm": 0.05,
        }]
        output, raw = self.parity([mark], [])
        np.testing.assert_array_equal(raw[0]["canonicalMask"], decode_trace_rle(mark["finalTrace"]))
        self.assertEqual(region_pixels(output["defects"][0]), 21)
        self.assertEqual(output["defects"][0]["traceProvenance"], mark["traceProvenance"])

    def test_invalid_trace_provenance_preserves_legacy_fail_closed_signals(self):
        valid = exact_finding("valid", rectangle(600, 700, 5, 4))
        cases = []
        for bad in (True, -1, float("nan"), float("inf"), 1270):
            item = deepcopy(valid)
            item["traceProvenance"]["cropTransform"]["crop"]["x"] = bad
            cases.append(item)
        wrong_side = deepcopy(valid)
        wrong_side["traceProvenance"]["sourceViewId"] = "BACK:ORIGINAL"
        cases.append(wrong_side)
        bad_stroke = deepcopy(valid)
        bad_stroke["traceProvenance"]["highlighterStrokes"] = [{
            "canonicalPoints": [{"x": True, "y": 900}], "strokeWidthMm": 1.0,
        }]
        cases.append(bad_stroke)
        wrong_hash = deepcopy(valid)
        wrong_hash["finalTrace"]["sha256"] = "0" * 64
        cases.append(wrong_hash)
        missing = deepcopy(valid)
        missing.pop("finalTrace")
        cases.append(missing)
        for index, invalid in enumerate(cases):
            with self.subTest(case=index):
                # NaN itself is not equal; compare the untouched object identity below.
                output = cpu.measure_marks([invalid], "FRONT", "SQUARE")
                self.assertEqual(output, {"defects": []})
                old = legacy.measure_marks([], "FRONT", "SQUARE", findings=[invalid])
                new = cpu.measure_marks([], "FRONT", "SQUARE", findings=[invalid])
                self.assertEqual(new["traceErrors"], old["traceErrors"])
                self.assertIs(new["defects"][0], invalid)
        corrupt = detector_finding("bad-mask", rectangle(600, 700, 5, 4))
        corrupt["detectorMask"]["sha256"] = "0" * 64
        contour_only = {"id": "old", "canonicalContour": []}
        for item, message in ((corrupt, "mask authority is invalid"), (contour_only, "Contour-only historical")):
            for module in (legacy, cpu):
                with self.assertRaisesRegex(ValueError, message):
                    module.measure_marks([], "FRONT", "SQUARE", findings=[item])

    def test_optional_fingerprint_success_failure_source_binding_and_stale_removal(self):
        mask = rectangle(300, 400, 20, 30)
        mark = exact_finding("edited", mask)
        mark.update(featureFingerprint=[0.5], featureFingerprintTraceSha256="old")
        pixels = np.zeros((INSPECTION_HEIGHT, INSPECTION_WIDTH, 3), dtype=np.uint8)
        evidence = dict(evidence_image=pixels, evidence_view_id="ORIGINAL", inspection_frame=FRAME)
        for result, raises, view in (([1.0] + [0.0] * 31, False, "ORIGINAL"), (None, False, "ORIGINAL"),
                                     (None, True, "ORIGINAL"), ([1.0], False, "BACK:ORIGINAL")):
            with self.subTest(raises=raises, result=result, view=view):
                calls = []
                def fingerprint(image, trace_mask, allowed, frame):
                    self.assertIs(image, pixels)
                    np.testing.assert_array_equal(trace_mask, mask)
                    np.testing.assert_array_equal(allowed, detector_material_mask("SQUARE", INSPECTION_WIDTH, INSPECTION_HEIGHT))
                    self.assertIs(frame, FRAME)
                    calls.append(True)
                    if raises:
                        raise RuntimeError("injected optional failure")
                    return result
                class FakeProcessor:
                    fingerprint_saved_trace = staticmethod(fingerprint)
                kwargs = {**evidence, "evidence_view_id": view}
                before = deepcopy(mark)
                old = legacy.measure_marks([mark], "FRONT", "SQUARE", processor=FakeProcessor(), **kwargs)
                new = cpu.measure_marks([mark], "FRONT", "SQUARE", fingerprint_trace=fingerprint, **kwargs)
                self.assertEqual(new, old)
                self.assertEqual(mark, before)
                self.assertEqual(len(calls), 0 if view.startswith("BACK:") else 2)
                saved = new["defects"][0]
                if raises or result is None or view.startswith("BACK:"):
                    self.assertNotIn("featureFingerprint", saved)
                    self.assertNotIn("featureFingerprintTraceSha256", saved)
                else:
                    self.assertEqual(saved["featureFingerprintTraceSha256"], mark["finalTrace"]["sha256"])
        without = cpu.measure_marks([mark], "FRONT", "SQUARE", **evidence)
        self.assertNotIn("featureFingerprint", without["defects"][0])
        self.assertEqual(region_pixels(without["defects"][0]), 600)

    def test_inspection_crop_preserves_exact_asymmetric_edges_holes_and_disconnected_pixels(self):
        canonical = rectangle(9, 7, 20, 30)
        canonical[12:25, 13:20] = 0
        for x, y in ((0, 0), (1269, 0), (0, 1777), (1269, 1777), (830, 703)):
            canonical[y, x] = 1
        inspection = np.ones((INSPECTION_HEIGHT, INSPECTION_WIDTH), dtype=np.uint8)
        inspection[40:1818, 40:1310] = canonical
        before = inspection.copy()
        encoded = cpu.canonical_trace_from_inspection(inspection)
        self.assertEqual(encoded, encode_trace_rle(canonical))
        np.testing.assert_array_equal(decode_trace_rle(encoded), canonical)
        np.testing.assert_array_equal(inspection, before)
        self.assertNotEqual(np.count_nonzero(cv2.resize(inspection, (GRID_WIDTH, GRID_HEIGHT))), np.count_nonzero(canonical))
        for invalid in (canonical, inspection[:, :-1], inspection[:, :, None], np.full_like(inspection, 2)):
            with self.assertRaises(ValueError):
                cpu.canonical_trace_from_inspection(invalid)

    def test_checked_entry_rejects_invalid_inputs_before_optional_enrichment(self):
        valid = exact_finding("requested", rectangle(500, 700, 7, 5))
        invalid_cases = []
        missing_trace = deepcopy(valid)
        missing_trace.pop("finalTrace")
        invalid_cases.append((missing_trace, "INVALID_REQUESTED_TRACE"))
        bad_hash = deepcopy(valid)
        bad_hash["finalTrace"]["sha256"] = "0" * 64
        invalid_cases.append((bad_hash, "INVALID_EXACT_MASK"))
        wrong_provenance = deepcopy(valid)
        wrong_provenance["traceProvenance"]["cropTransform"]["crop"]["width"] = 1270
        invalid_cases.append((wrong_provenance, "INVALID_TRACE_PROVENANCE"))
        invalid_cases.append(({**valid, "sourceViewId": "BACK:ORIGINAL"}, "INVALID_FINDING_METADATA"))
        invalid_cases.append(({**valid, "side": "BACK"}, "INVALID_FINDING_METADATA"))
        invalid_cases.append(({**valid, "defectType": "INVENTED"}, "INVALID_FINDING_METADATA"))
        invalid_cases.append(({**valid, "rankingConfidence": float("nan")}, "INVALID_FINDING_METADATA"))
        for invalid, code in invalid_cases:
            with self.subTest(code=code), patch.object(cpu, "measure_marks") as low_level:
                with self.assertRaises(cpu.ManualMeasurementError) as failure:
                    cpu.measure_manual_side([invalid], "FRONT", "SQUARE", fingerprint_trace=lambda *_: self.fail("Unexpected fingerprint work"))
                self.assertEqual(failure.exception.code, code)
                self.assertEqual(failure.exception.finding_ids, ("requested",))
                low_level.assert_not_called()
        with self.assertRaises(cpu.ManualMeasurementError) as failure:
            cpu.measure_manual_side([valid, valid], "FRONT", "SQUARE")
        self.assertEqual(failure.exception.code, "DUPLICATE_FINDING_ID")
        for side, shape in (("LEFT", "SQUARE"), ([], "SQUARE"), ("FRONT", "OTHER")):
            with self.assertRaises(cpu.ManualMeasurementError) as failure:
                cpu.measure_manual_side([], side, shape)
            self.assertEqual(failure.exception.code, "INVALID_SIDE_OR_MATERIAL")
        invalid_existing = deepcopy(valid)
        invalid_existing["traceProvenance"]["finalTraceSha256"] = "0" * 64
        with self.assertRaises(cpu.ManualMeasurementError):
            cpu.measure_manual_side([], "FRONT", "SQUARE", findings=[invalid_existing])

    def test_checked_entry_rejects_unreconciled_requested_mark_instead_of_empty_success(self):
        mask = rectangle(500, 700, 7, 5)
        requested = exact_finding("requested", mask, defect_type="FAINT_COLOR_VARIATION")
        covering = detector_finding("covering", mask, defect_type="LIFTING_DEFORMATION")
        low_level = cpu.measure_marks([requested], "FRONT", "SQUARE", findings=[covering])
        self.assertNotIn("requested", [item["id"] for item in low_level["defects"]])
        with self.assertRaises(cpu.ManualMeasurementError) as failure:
            cpu.measure_manual_side([requested], "FRONT", "SQUARE", findings=[covering])
        self.assertEqual(failure.exception.code, "REQUESTED_TRACE_NOT_RECONCILED")
        self.assertEqual(failure.exception.finding_ids, ("requested",))
        # Square-corner pixels outside rounded material likewise cannot become
        # a successful save with a silently missing source record.
        clipped = exact_finding("outside-material", rectangle(0, 0, 1, 1))
        with self.assertRaises(cpu.ManualMeasurementError) as failure:
            cpu.measure_manual_side([clipped], "FRONT", "ROUNDED_3_18_MM")
        self.assertEqual(failure.exception.finding_ids, ("outside-material",))
        self.assertEqual(cpu.measure_manual_side([], "FRONT", "SQUARE"), {"defects": []})

    def test_four_pixel_fusion_threshold_transitivity_and_source_view_rule(self):
        def member(mask, view="FRONT:ORIGINAL"):
            return {"mask": mask, "sourceViewId": view}
        a = rectangle(300, 500, 1, 1)
        b = rectangle(304, 500, 1, 1)
        c = rectangle(308, 500, 1, 1)
        self.assertFalse(_should_fuse(member(a), member(b)))
        self.assertTrue(_should_fuse(member(a), member(a)))
        self.assertTrue(_should_fuse(member(a), member(b, "FRONT:REVEAL")))
        self.assertFalse(_should_fuse(member(a), member(rectangle(305, 500, 1, 1), "FRONT:REVEAL")))
        self.assertTrue(_should_fuse(member(a), member(rectangle(303, 502, 1, 1), "FRONT:REVEAL")))
        self.assertFalse(_should_fuse(member(a), member(rectangle(304, 504, 1, 1), "FRONT:REVEAL")))
        self.assertEqual(_fused_groups([member(a), member(b, "FRONT:REVEAL"), member(c)]), [[0, 1, 2]])
        # Equal-size masks: exactly 1 of 2 smaller pixels is within the ellipse.
        first = a | rectangle(700, 900, 1, 1)
        half = b | rectangle(900, 1200, 1, 1)
        below = half | rectangle(1000, 1200, 1, 1)
        bigger_first = first | rectangle(1100, 1400, 1, 1)
        self.assertTrue(_should_fuse(member(first), member(half, "FRONT:REVEAL")))
        self.assertTrue(_should_fuse(member(a), member(half, "FRONT:REVEAL")))
        self.assertFalse(_should_fuse(member(bigger_first), member(below, "FRONT:REVEAL")))
        # These remain exact source pixels; dilation is grouping evidence only.
        findings = [detector_finding("a", a), detector_finding("b", b, view="REVEAL"), detector_finding("c", c)]
        output, raw = self.parity([], findings)
        self.assertEqual(sum(region_pixels(item) for item in output["defects"]), 3)
        owned = np.zeros_like(a)
        for result in raw:
            owned |= result["canonicalMask"]
        np.testing.assert_array_equal(owned, a | b | c)


if __name__ == "__main__":
    unittest.main()
