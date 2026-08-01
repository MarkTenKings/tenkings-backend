import unittest

from defect_math import measure_defects


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


class DefectMathTests(unittest.TestCase):
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

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["zone"], "SURFACE")
        self.assertEqual(results[0]["sourceViewId"], "micro")
        self.assertEqual(results[0]["supportingViewIds"], ["original"])
        self.assertEqual(results[0]["defectType"], "FRAYING")
        self.assertEqual(results[0]["confidence"], 0.91)

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


if __name__ == "__main__":
    unittest.main()
