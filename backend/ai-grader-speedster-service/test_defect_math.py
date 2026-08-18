import unittest

import cv2
import numpy as np

from defect_math import (
    CARD_HEIGHT_MM,
    CARD_WIDTH_MM,
    GRID_HEIGHT,
    GRID_WIDTH,
    material_mask,
    measure_defects,
)


def rectangle(x1_mm, y1_mm, x2_mm, y2_mm):
    return [
        {"x": x1_mm / 63.5, "y": y1_mm / 88.9},
        {"x": x2_mm / 63.5, "y": y1_mm / 88.9},
        {"x": x2_mm / 63.5, "y": y2_mm / 88.9},
        {"x": x1_mm / 63.5, "y": y2_mm / 88.9},
    ]


def proposal(contour, view, confidence=0.8, defect_type="VISIBLE_WHITENING"):
    return {
        "canonicalContour": contour,
        "sourceViewId": view,
        "defectType": defect_type,
        "confidence": confidence,
    }


def _rasterized_rectangle(x1_mm, y1_mm, x2_mm, y2_mm):
    mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
    points = np.array(
        [
            [
                round(point["x"] * (GRID_WIDTH - 1)),
                round(point["y"] * (GRID_HEIGHT - 1)),
            ]
            for point in rectangle(x1_mm, y1_mm, x2_mm, y2_mm)
        ],
        dtype=np.int32,
    )
    cv2.fillPoly(mask, [points], 1)
    return mask


class DefectMathTests(unittest.TestCase):
    def test_exact_in_memory_trace_is_clipped_to_material_without_a_contour_fallback(self):
        trace = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        trace[:80, GRID_WIDTH - 80 :] = 1
        trace[20:25, GRID_WIDTH - 25 : GRID_WIDTH - 20] = 0

        results = measure_defects(
            [
                {
                    "canonicalMask": trace,
                    "sourceViewId": "trace-editor",
                    "defectType": "VISIBLE_WHITENING",
                    "confidence": 1.0,
                }
            ],
            "ROUNDED_3_18_MM",
        )

        expected_pixels = np.count_nonzero(
            trace & material_mask("ROUNDED_3_18_MM")
        )
        expected_area = (
            expected_pixels
            * CARD_WIDTH_MM
            * CARD_HEIGHT_MM
            / (GRID_WIDTH * GRID_HEIGHT)
        )
        self.assertGreater(expected_pixels, 0)
        self.assertAlmostEqual(
            sum(result["areaMm2"] for result in results),
            expected_area,
            places=10,
        )
        self.assertEqual(
            sum(result["pixelCount"] for result in results),
            expected_pixels,
        )

        empty = measure_defects(
            [
                {
                    "canonicalMask": np.zeros_like(trace),
                    "sourceViewId": "trace-editor",
                    "defectType": "VISIBLE_WHITENING",
                    "confidence": 1.0,
                }
            ],
            "ROUNDED_3_18_MM",
        )
        self.assertEqual(empty, [])

    def test_fuses_shifted_evidence_across_views_without_confidence_voting(self):
        first = rectangle(20, 20, 20.2, 20.2)
        shifted = rectangle(20.25, 20, 20.45, 20.2)
        results = measure_defects(
            [
                proposal(first, "original", 0.72),
                proposal(shifted, "micro", 0.91, "FRAYING"),
            ],
            "ROUNDED_3_18_MM",
        )

        self.assertEqual(len(results), 2)
        by_type = {result["defectType"]: result for result in results}
        self.assertEqual(set(by_type), {"VISIBLE_WHITENING", "FRAYING"})
        self.assertEqual(by_type["VISIBLE_WHITENING"]["zone"], "SURFACE")
        self.assertEqual(by_type["VISIBLE_WHITENING"]["sourceViewId"], "original")
        self.assertEqual(by_type["VISIBLE_WHITENING"]["supportingViewIds"], [])
        self.assertEqual(by_type["VISIBLE_WHITENING"]["confidence"], 0.72)
        self.assertEqual(by_type["FRAYING"]["zone"], "SURFACE")
        self.assertEqual(by_type["FRAYING"]["sourceViewId"], "micro")
        self.assertEqual(by_type["FRAYING"]["supportingViewIds"], [])
        self.assertEqual(by_type["FRAYING"]["confidence"], 0.91)

    def test_identical_masks_are_not_counted_twice(self):
        contour = rectangle(20, 20, 22, 22)
        single = measure_defects([proposal(contour, "original")], "SQUARE")[0]
        fused = measure_defects(
            [proposal(contour, "original"), proposal(contour, "normalized")],
            "SQUARE",
        )[0]

        self.assertAlmostEqual(fused["areaMm2"], single["areaMm2"], places=10)
        self.assertAlmostEqual(fused["weightedAreaMm2"], single["weightedAreaMm2"], places=10)

    def test_rounded_corner_excludes_space_outside_card_material(self):
        contour = rectangle(0, 0, 3, 3)
        square = measure_defects([proposal(contour, "original")], "SQUARE")[0]
        rounded = measure_defects(
            [proposal(contour, "original")], "ROUNDED_3_18_MM"
        )[0]

        self.assertEqual(square["zone"], "CORNERS")
        self.assertEqual(rounded["zone"], "CORNERS")
        self.assertGreater(square["areaMm2"], rounded["areaMm2"])
        self.assertGreater(rounded["areaMm2"], 0)

    def test_cross_zone_defect_is_split_without_overlap(self):
        contour = rectangle(4, 0, 6, 6)
        whole = measure_defects([proposal(contour, "original")], "SQUARE")
        zones = {item["zone"] for item in whole}
        split_area = sum(item["areaMm2"] for item in whole)
        surface_only = measure_defects(
            [proposal(rectangle(20, 20, 22, 22), "original")], "SQUARE"
        )[0]

        self.assertEqual(zones, {"CORNERS", "EDGES", "SURFACE"})
        self.assertEqual(
            sum(item["pixelCount"] for item in whole),
            int(np.count_nonzero(_rasterized_rectangle(4, 0, 6, 6))),
        )
        self.assertAlmostEqual(split_area, 12.0, delta=0.5)
        self.assertEqual(surface_only["multiplier"], 1.0)
        self.assertAlmostEqual(
            surface_only["weightedAreaMm2"], surface_only["areaMm2"], places=10
        )

    def test_multiplier_is_applied_to_weighted_area(self):
        result = measure_defects(
            [
                proposal(
                    rectangle(20, 20, 22, 22),
                    "original",
                    defect_type="DENT_MATERIAL_DAMAGE",
                )
            ],
            "SQUARE",
        )[0]

        self.assertEqual(result["multiplier"], 1.5)
        self.assertAlmostEqual(result["weightedAreaMm2"], result["areaMm2"] * 1.5)

    def test_overlapping_classifications_use_the_highest_multiplier(self):
        contour = rectangle(20, 20, 22, 22)
        result = measure_defects(
            [
                proposal(contour, "original", 0.99, "VISIBLE_WHITENING"),
                proposal(contour, "micro", 0.70, "LIFTING_DEFORMATION"),
            ],
            "SQUARE",
        )[0]

        self.assertEqual(result["defectType"], "LIFTING_DEFORMATION")
        self.assertEqual(result["multiplier"], 2.0)

    def test_partial_overlap_applies_highest_multiplier_per_pixel(self):
        results = measure_defects(
            [
                proposal(
                    rectangle(20, 20, 23, 22),
                    "original",
                    0.99,
                    "VISIBLE_WHITENING",
                ),
                proposal(
                    rectangle(21, 20, 23, 22),
                    "micro",
                    0.70,
                    "LIFTING_DEFORMATION",
                ),
            ],
            "SQUARE",
        )

        by_type = {result["defectType"]: result for result in results}
        self.assertEqual(set(by_type), {"VISIBLE_WHITENING", "LIFTING_DEFORMATION"})
        self.assertEqual(by_type["VISIBLE_WHITENING"]["areaMm2"], 2.05)
        self.assertEqual(by_type["LIFTING_DEFORMATION"]["areaMm2"], 4.2025)
        self.assertAlmostEqual(
            sum(result["weightedAreaMm2"] for result in results),
            10.455,
            places=10,
        )

    def test_non_overlapping_measurements_remain_numerically_identical(self):
        whitening = measure_defects(
            [proposal(rectangle(20, 20, 22, 22), "original")],
            "SQUARE",
        )[0]
        lifting = measure_defects(
            [
                proposal(
                    rectangle(24, 20, 26, 22),
                    "micro",
                    defect_type="LIFTING_DEFORMATION",
                )
            ],
            "SQUARE",
        )[0]
        together = measure_defects(
            [
                proposal(rectangle(20, 20, 22, 22), "original"),
                proposal(
                    rectangle(24, 20, 26, 22),
                    "micro",
                    defect_type="LIFTING_DEFORMATION",
                ),
            ],
            "SQUARE",
        )

        self.assertEqual(
            [
                (result["areaMm2"], result["weightedAreaMm2"])
                for result in together
            ],
            [
                (whitening["areaMm2"], whitening["weightedAreaMm2"]),
                (lifting["areaMm2"], lifting["weightedAreaMm2"]),
            ],
        )

    def test_memory_provenance_survives_fusion_without_changing_measurement(self):
        contour = rectangle(20, 20, 22, 22)
        baseline = measure_defects([proposal(contour, "original")], "SQUARE")[0]
        diagnostic = {
            "lessonSessionId": "cubone-lesson",
            "lessonCompletionOrder": 228,
            "lessonProposalOrder": 7,
            "lessonOrder": 0,
            "lessonSourceViewId": "ORIGINAL",
            "similarity": 0.94,
        }
        memory = measure_defects(
            [
                {
                    **proposal(contour, "original"),
                    "instrumentationProposalId": "FRONT:0",
                    "origin": "MEMORY",
                    "memoryProposal": diagnostic,
                }
            ],
            "SQUARE",
        )[0]

        self.assertEqual(memory["origin"], "MEMORY")
        self.assertEqual(memory["memoryProposal"], diagnostic)
        self.assertEqual(
            memory["findingProvenance"]["contributors"],
            [
                {
                    "proposalId": "FRONT:0",
                    "origin": "MEMORY",
                    "sourceViewId": "original",
                    "defectType": "VISIBLE_WHITENING",
                    "confidence": 0.8,
                    "rankingConfidence": 0.8,
                    "memoryProposal": diagnostic,
                }
            ],
        )
        self.assertEqual(
            memory["findingProvenance"]["primaryProposalId"], "FRONT:0"
        )
        self.assertTrue(
            np.array_equal(memory["canonicalMask"], baseline["canonicalMask"])
        )
        self.assertEqual(
            {
                key: value
                for key, value in memory.items()
                if key
                not in {
                    "origin",
                    "memoryProposal",
                    "findingProvenance",
                    "canonicalMask",
                }
            },
            {
                key: value
                for key, value in baseline.items()
                if key not in {"findingProvenance", "canonicalMask"}
            },
        )

    def test_fusion_records_detector_and_memory_contributors_without_changing_winner(self):
        contour = rectangle(20, 20, 22, 22)
        diagnostic = {
            "lessonSessionId": "cubone-lesson",
            "lessonCompletionOrder": 228,
            "lessonProposalOrder": 7,
            "lessonOrder": 0,
            "lessonSourceViewId": "ORIGINAL",
            "similarity": 0.94,
        }
        measured = measure_defects(
            [
                {
                    **proposal(contour, "original"),
                    "instrumentationProposalId": "FRONT:0",
                },
                {
                    **proposal(contour, "memory"),
                    "instrumentationProposalId": "FRONT:1",
                    "origin": "MEMORY",
                    "memoryProposal": diagnostic,
                    "rankingConfidence": 0.81,
                },
            ],
            "SQUARE",
        )[0]

        self.assertEqual(measured["origin"], "MEMORY")
        self.assertEqual(
            [entry["origin"] for entry in measured["findingProvenance"]["contributors"]],
            ["DETECTOR", "MEMORY"],
        )
        self.assertEqual(
            [entry["proposalId"] for entry in measured["findingProvenance"]["contributors"]],
            ["FRONT:0", "FRONT:1"],
        )
        self.assertEqual(
            measured["findingProvenance"]["primaryProposalId"], "FRONT:1"
        )


if __name__ == "__main__":
    unittest.main()
