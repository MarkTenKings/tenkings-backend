import unittest
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

from color_geometry import (
    AUTHORITY,
    PHYSICAL_AMBIGUOUS_RUNNER_UP_RATIO,
    POLICY_PROVENANCE,
    PRINTED_FRAME_AMBIGUOUS_RUNNER_UP_RATIO,
    _canonical_ambiguity,
    propose_physical_outer,
    propose_printed_frame,
    serialize_proposal,
)


GEOMETRY_FIXTURES = Path(__file__).with_name("test-fixtures") / "geometry"


class SpeedsterColorGeometryTest(unittest.TestCase):
    def test_physical_runner_ratio_rounding_remains_diagnostic_at_serialized_boundary(self):
        ratio, ambiguous = _canonical_ambiguity(
            0.91995,
            PHYSICAL_AMBIGUOUS_RUNNER_UP_RATIO,
        )
        self.assertEqual(ratio, 0.92)
        self.assertTrue(ambiguous)

    def test_printed_runner_ratio_rounding_abstains_at_serialized_boundary(self):
        ratio, ambiguous = _canonical_ambiguity(
            0.89995,
            PRINTED_FRAME_AMBIGUOUS_RUNNER_UP_RATIO,
        )
        self.assertEqual(ratio, 0.9)
        self.assertTrue(ambiguous)

    def test_physical_outer_shows_complete_outline_even_when_percentages_are_only_diagnostic(self):
        image = np.zeros((900, 700, 3), dtype=np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (220, 220, 220), -1)

        result = propose_physical_outer(image, "BLACK")

        self.assertEqual(result["outcome"], "ACCEPTED")
        self.assertEqual(result["authority"], AUTHORITY)
        self.assertEqual(result["policyProvenance"], POLICY_PROVENANCE)
        self.assertIsNotNone(result["proposal"])
        self.assertEqual(set(result["sideEvidence"]), {"top", "right", "bottom", "left"})
        self.assertTrue(all(evidence["sampleCount"] > 0 for evidence in result["sideEvidence"].values()))
        self.assertIsNone(result["diagnosticCandidate"])
        self.assertNotIn("AUTOMATIC_COLOR_FRAME", repr(result))

    def test_ranked_outline_is_not_silently_replaced_by_mat_heuristics(self):
        image = np.zeros((900, 700, 3), dtype=np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (220, 220, 220), -1)
        cv2.rectangle(image, (155, 170), (545, 730), (35, 120, 220), -1)
        outer = np.array(
            [[100, 100], [600, 100], [600, 800], [100, 800]], dtype=np.float32
        )
        inner = np.array(
            [[155, 170], [545, 170], [545, 730], [155, 730]], dtype=np.float32
        )

        with patch(
            "color_geometry.ranked_card_quads",
            return_value=[(200.0, inner), (100.0, outer)],
        ):
            result = propose_physical_outer(image, "BLACK")

        self.assertEqual(result["outcome"], "ACCEPTED")
        np.testing.assert_allclose(result["proposal"], inner)
        self.assertEqual(result["ambiguity"]["candidateCount"], 2)
        self.assertEqual(result["ambiguity"]["runnerUpScoreRatio"], 0.5)
        self.assertIsNone(result["diagnosticCandidate"])

    def test_dark_blue_card_on_black_mat_does_not_hide_ranked_outline(self):
        image = np.full((900, 700, 3), 20, dtype=np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (72, 45, 24), -1)
        cv2.rectangle(image, (155, 170), (545, 730), (210, 225, 235), -1)
        outer = np.array(
            [[100, 100], [600, 100], [600, 800], [100, 800]], dtype=np.float32
        )
        inner = np.array(
            [[155, 170], [545, 170], [545, 730], [155, 730]], dtype=np.float32
        )

        with patch(
            "color_geometry.ranked_card_quads",
            return_value=[(200.0, inner), (100.0, outer)],
        ):
            result = propose_physical_outer(image, "BLACK")

        self.assertEqual(result["outcome"], "ACCEPTED")
        np.testing.assert_allclose(result["proposal"], inner)
        self.assertIsNone(result["advisory"])
        self.assertEqual(result["ambiguity"]["candidateCount"], 2)

    def test_white_card_border_matching_white_mat_still_shows_complete_outline(self):
        image = np.full((900, 700, 3), (240, 240, 240), dtype=np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (245, 245, 245), -1)
        cv2.rectangle(image, (155, 170), (545, 730), (35, 120, 220), -1)

        result = propose_physical_outer(image, "WHITE")

        self.assertEqual(result["outcome"], "ACCEPTED")
        self.assertIsNotNone(result["proposal"])
        self.assertIsNone(result["advisory"])
        self.assertGreaterEqual(result["ambiguity"]["candidateCount"], 1)
        serialized = serialize_proposal(result, image.shape[1], image.shape[0])
        self.assertEqual(len(serialized["proposal"]), 4)
        self.assertTrue(all(
            0.0 <= point[axis] <= 1.0
            for point in serialized["proposal"]
            for axis in ("x", "y")
        ))

    def test_black_card_border_matching_black_mat_still_shows_complete_outline(self):
        image = np.full((900, 700, 3), (15, 15, 15), dtype=np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (18, 18, 18), -1)
        cv2.rectangle(image, (155, 170), (545, 730), (210, 225, 235), -1)

        result = propose_physical_outer(image, "BLACK")

        self.assertEqual(result["outcome"], "ACCEPTED")
        self.assertIsNotNone(result["proposal"])
        self.assertIsNone(result["advisory"])

    def test_selected_mat_mismatch_is_diagnostic_and_never_vetoes_outline(self):
        image = np.zeros((900, 700, 3), dtype=np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (220, 220, 220), -1)

        result = propose_physical_outer(image, "WHITE")

        self.assertEqual(result["outcome"], "ACCEPTED")
        self.assertIsNotNone(result["proposal"])
        self.assertIsNone(result["advisory"])
        self.assertIsNone(result["diagnosticCandidate"])

    def test_no_complete_outline_requests_manual_corners_without_mat_switching(self):
        image = np.full((900, 700, 3), (255, 0, 255), dtype=np.uint8)

        result = propose_physical_outer(image, "MAGENTA")

        self.assertEqual(result["outcome"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(result["advisory"]["code"], "NO_PHYSICAL_OUTLINE")
        self.assertIsNone(result["advisory"]["recommendedMat"])

    def test_preserved_dark_back_on_black_mat_shows_the_detected_outline(self):
        fixture = GEOMETRY_FIXTURES / "cubone-back.jpg"
        encoded = fixture.read_bytes()
        self.assertEqual(
            sha256(encoded).hexdigest(),
            "fa71097ee566bed76efab30543fbdacfc84e6d9c0a0ab3552b4e251b1cbe2338",
        )
        image = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)

        result = propose_physical_outer(image, "BLACK")

        self.assertEqual(result["outcome"], "ACCEPTED")
        self.assertIsNone(result["advisory"])
        self.assertIsNotNone(result["proposal"])
        self.assertTrue(all(
            "medianLightnessContrast" in evidence and "medianChromaContrast" in evidence
            for evidence in result["sideEvidence"].values()
        ))

    def test_printed_frame_requires_all_four_color_geometry_sides(self):
        rectified = np.full((1778, 1270, 3), 190, dtype=np.uint8)
        cv2.rectangle(rectified, (85, 85), (1184, 1692), (40, 120, 200), -1)

        result = propose_printed_frame(rectified, "BLACK")

        self.assertEqual(result["outcome"], "ACCEPTED")
        self.assertIsNotNone(result["proposal"])
        self.assertTrue(all(
            evidence["supportFraction"] >= result["minimumSideSupport"]
            and not evidence["ambiguous"]
            for evidence in result["sideEvidence"].values()
        ))

    def test_uniform_full_art_like_surface_is_not_applicable(self):
        rectified = np.full((1778, 1270, 3), 150, dtype=np.uint8)

        result = propose_printed_frame(rectified, "MAGENTA")

        self.assertEqual(result["outcome"], "NOT_APPLICABLE")
        self.assertEqual(result["advisory"]["code"], "NO_PRINTED_FRAME")
        self.assertIsNone(result["proposal"])


if __name__ == "__main__":
    unittest.main()
