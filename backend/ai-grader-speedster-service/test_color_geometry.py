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
    def test_physical_runner_ratio_rounding_abstains_at_serialized_boundary(self):
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

    def test_physical_outer_accepts_only_a_four_side_supported_proposer_draft(self):
        image = np.zeros((900, 700, 3), dtype=np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (220, 220, 220), -1)

        result = propose_physical_outer(image, "BLACK")

        self.assertEqual(result["outcome"], "ACCEPTED")
        self.assertEqual(result["authority"], AUTHORITY)
        self.assertEqual(result["policyProvenance"], POLICY_PROVENANCE)
        self.assertIsNotNone(result["proposal"])
        self.assertEqual(set(result["sideEvidence"]), {"top", "right", "bottom", "left"})
        self.assertTrue(all(
            evidence["supportFraction"] >= result["minimumSideSupport"]
            and evidence["outsideMatSupportFraction"] >= result["minimumSideSupport"]
            and evidence["insideNonMatSupportFraction"] >= result["minimumSideSupport"]
            for evidence in result["sideEvidence"].values()
        ))
        self.assertIsNone(result["diagnosticCandidate"])
        self.assertNotIn("AUTOMATIC_COLOR_FRAME", repr(result))

    def test_inner_printed_boundary_cannot_outrank_mat_owned_physical_outer(self):
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
        np.testing.assert_allclose(result["proposal"], outer)
        self.assertEqual(result["ambiguity"]["candidateCount"], 1)
        self.assertIsNone(result["ambiguity"]["runnerUpScoreRatio"])
        self.assertIsNone(result["diagnosticCandidate"])
        self.assertTrue(all(
            evidence["outsideMatSupportFraction"] >= result["minimumSideSupport"]
            and evidence["insideNonMatSupportFraction"] >= result["minimumSideSupport"]
            for evidence in result["sideEvidence"].values()
        ))

    def test_dark_blue_card_on_black_mat_never_accepts_light_inner_art_boundary(self):
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

        self.assertEqual(result["outcome"], "ABSTAIN")
        self.assertIsNone(result["proposal"])
        self.assertIn(
            result["advisory"]["code"],
            {"DARK_EDGE_ON_BLACK", "PHYSICAL_BOUNDARY_NOT_ON_SELECTED_MAT"},
        )
        self.assertEqual(result["ambiguity"]["candidateCount"], 1)
        self.assertIsNone(result["ambiguity"]["runnerUpScoreRatio"])

    def test_white_card_border_matching_white_mat_abstains_on_inner_rectangle(self):
        image = np.full((900, 700, 3), (240, 240, 240), dtype=np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (245, 245, 245), -1)
        cv2.rectangle(image, (155, 170), (545, 730), (35, 120, 220), -1)

        result = propose_physical_outer(image, "WHITE")

        self.assertEqual(result["outcome"], "ABSTAIN")
        self.assertIsNone(result["proposal"])
        self.assertEqual(
            result["advisory"]["code"],
            "PHYSICAL_BOUNDARY_SCALE_AMBIGUOUS",
        )
        self.assertIsNone(result["advisory"]["recommendedMat"])
        self.assertEqual(result["ambiguity"]["candidateCount"], 1)
        self.assertIsNone(result["ambiguity"]["runnerUpScoreRatio"])
        diagnostic = result["diagnosticCandidate"]
        self.assertEqual(diagnostic["authority"], "HUMAN_DRAFT_ONLY")
        self.assertEqual(diagnostic["rank"], 1)
        self.assertTrue(any(
            gate["code"] == "FRAME_COVERAGE_BELOW_FLOOR"
            and gate["comparison"] == "GTE"
            and gate["threshold"] == 0.5
            for gate in diagnostic["rejectedGates"]
        ))
        serialized = serialize_proposal(result, image.shape[1], image.shape[0])
        self.assertEqual(len(serialized["diagnosticCandidate"]["quad"]), 4)
        self.assertTrue(all(
            0.0 <= point[axis] <= 1.0
            for point in serialized["diagnosticCandidate"]["quad"]
            for axis in ("x", "y")
        ))

    def test_black_card_border_matching_black_mat_abstains_on_inner_rectangle(self):
        image = np.full((900, 700, 3), (15, 15, 15), dtype=np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (18, 18, 18), -1)
        cv2.rectangle(image, (155, 170), (545, 730), (210, 225, 235), -1)

        result = propose_physical_outer(image, "BLACK")

        self.assertEqual(result["outcome"], "ABSTAIN")
        self.assertIsNone(result["proposal"])
        self.assertEqual(
            result["advisory"]["code"],
            "PHYSICAL_BOUNDARY_SCALE_AMBIGUOUS",
        )
        self.assertIsNone(result["advisory"]["recommendedMat"])
        self.assertEqual(result["ambiguity"]["candidateCount"], 1)
        self.assertIsNone(result["ambiguity"]["runnerUpScoreRatio"])

    def test_selected_mat_mismatch_abstains_instead_of_guessing(self):
        image = np.zeros((900, 700, 3), dtype=np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (220, 220, 220), -1)

        result = propose_physical_outer(image, "WHITE")

        self.assertEqual(result["outcome"], "ABSTAIN")
        self.assertEqual(result["advisory"]["code"], "VERIFY_SELECTED_MAT")
        self.assertIsNone(result["proposal"])
        self.assertIsNone(result["diagnosticCandidate"])

    def test_switch_mat_advisory_never_recommends_the_selected_magenta_mat(self):
        image = np.full((900, 700, 3), (255, 0, 255), dtype=np.uint8)

        result = propose_physical_outer(image, "MAGENTA")

        self.assertEqual(result["outcome"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(result["advisory"]["code"], "SWITCH_MAT")
        self.assertEqual(result["advisory"]["recommendedMat"], "WHITE")
        self.assertNotEqual(result["advisory"]["recommendedMat"], result["matColor"])

    def test_preserved_dark_back_on_black_mat_abstains_and_says_switch_white(self):
        fixture = GEOMETRY_FIXTURES / "cubone-back.jpg"
        encoded = fixture.read_bytes()
        self.assertEqual(
            sha256(encoded).hexdigest(),
            "fa71097ee566bed76efab30543fbdacfc84e6d9c0a0ab3552b4e251b1cbe2338",
        )
        image = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)

        result = propose_physical_outer(image, "BLACK")

        self.assertEqual(result["outcome"], "ABSTAIN")
        self.assertEqual(result["advisory"]["code"], "DARK_EDGE_ON_BLACK")
        self.assertEqual(result["advisory"]["recommendedMat"], "WHITE")
        self.assertIsNone(result["proposal"])
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
