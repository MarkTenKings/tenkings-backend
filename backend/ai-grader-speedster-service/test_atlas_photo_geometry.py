"""Focused ATLAS recovery tests: generated pixels only, no original photos."""
import unittest
from unittest.mock import patch

import cv2
import numpy as np

import atlas_photo_geometry as atlas
import color_geometry as legacy


def weak_edge_photo(top=80, body=(140, 75, 30)):
    # The mat's left-to-right lighting gradient defeats a global background
    # reference; card blue is nearly equal in luminance to the central mat.
    image = np.zeros((900, 700, 3), np.uint8)
    image[:] = np.linspace(105, 25, 700).astype(np.uint8)[None, :, None]
    cv2.rectangle(image, (80, top), (620, 800), body, -1)
    cv2.rectangle(image, (130, 160), (570, 430), (230, 230, 230), -1)
    return image


def invalid_art_result():
    return legacy._result("PHYSICAL_OUTER", "BLACK", "ACCEPTED", proposal=np.array(
        [[570, 160], [570, 430], [130, 430], [130, 160]], np.float32))


class AtlasPhotoGeometryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cv2.setNumThreads(1)

    def test_weak_color_perimeter_beats_competing_landscape_art_without_mocks(self):
        for body in ((140, 75, 30), (115, 65, 45)):
            with self.subTest(body=body):
                image = weak_edge_photo(body=body)
                old = legacy.propose_physical_outer(image, "BLACK")
                self.assertFalse(atlas._adoptable(old["proposal"], 700, 900))
                result = atlas.propose_physical_outer(image, "BLACK")
                self.assertEqual(result["engineVersion"], atlas.ENGINE_VERSION)
                self.assertEqual(result["authority"], "PROPOSER_ONLY")
                self.assertEqual(result["policyProvenance"], atlas.POLICY_PROVENANCE)
                np.testing.assert_allclose(result["proposal"], [[80, 80], [620, 80], [620, 800], [80, 800]], atol=3)
                self.assertTrue(all(side["supportFraction"] >= .7 for side in result["sideEvidence"].values()))

    def test_adoptable_legacy_proposal_is_preserved_even_with_weak_side_diagnostics(self):
        image = weak_edge_photo(body=(230, 230, 230))
        prior = legacy.propose_physical_outer(image, "BLACK")
        self.assertTrue(atlas._adoptable(prior["proposal"], 700, 900))
        prior["sideEvidence"]["left"]["supportFraction"] = 0
        with patch.object(legacy, "propose_physical_outer", return_value=prior), patch.object(atlas, "_color_candidates") as fallback:
            self.assertIs(atlas.propose_physical_outer(image, "BLACK"), prior)
            fallback.assert_not_called()

    def test_nonaccepted_legacy_result_is_not_reinterpreted(self):
        image = np.zeros((900, 700, 3), np.uint8)
        for outcome in ("ABSTAIN", "INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE"):
            prior = legacy._result("PHYSICAL_OUTER", "BLACK", outcome)
            with patch.object(legacy, "propose_physical_outer", return_value=prior), patch.object(atlas, "_color_candidates") as fallback:
                self.assertIs(atlas.propose_physical_outer(image, "BLACK"), prior)
                fallback.assert_not_called()

    def test_quad_contract_rejects_bounds_order_area_and_nonconvexity(self):
        good = np.array([[100, 100], [600, 100], [600, 800], [100, 800]], np.float32)
        self.assertTrue(atlas._adoptable(good, 700, 900))
        for bad in (None, np.roll(good, -1, axis=0), good * 3, good * .01,
                    [[100, 100], [600, 100], [200, 200], [100, 800]],
                    [[float("nan"), 100], *good[1:].tolist()]):
            self.assertFalse(atlas._adoptable(bad, 700, 900))

    def test_truncated_card_cannot_recover_from_its_interior_art(self):
        image = weak_edge_photo(top=0)
        prior = invalid_art_result()
        with patch.object(legacy, "propose_physical_outer", return_value=prior):
            self.assertIs(atlas.propose_physical_outer(image, "BLACK"), prior)

    def test_printed_rectangle_on_card_material_fails_external_mat_evidence(self):
        image = weak_edge_photo()
        interior = np.array([[130, 160], [570, 160], [570, 430], [130, 430]], np.float32)
        sides = atlas._perimeter_evidence(legacy._cie_lab(image), interior)
        self.assertTrue(any(side["supportFraction"] < .7 for side in sides.values()))
        with patch.object(legacy, "propose_physical_outer", return_value=invalid_art_result()), patch.object(atlas, "_color_candidates", return_value=[(100, interior)]):
            self.assertEqual(atlas.propose_physical_outer(image, "BLACK")["engineVersion"], legacy.ENGINE_VERSION)

    def test_unrelated_small_shape_cannot_replace_failed_card_region(self):
        image = weak_edge_photo()
        small = np.array([[5, 500], [60, 500], [60, 650], [5, 650]], np.float32)
        cv2.rectangle(image, (5, 500), (60, 650), (250, 250, 250), -1)
        prior = invalid_art_result()
        with patch.object(legacy, "propose_physical_outer", return_value=prior), patch.object(atlas, "_color_candidates", return_value=[(100, small)]), patch.object(atlas, "_perimeter_evidence") as evidence:
            self.assertIs(atlas.propose_physical_outer(image, "BLACK"), prior)
            evidence.assert_not_called()

    def test_without_visible_selected_mat_recovery_does_not_claim_card_authority(self):
        image = np.full((900, 700, 3), (140, 75, 30), np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (220, 220, 220), -1)
        prior = invalid_art_result()
        with patch.object(legacy, "propose_physical_outer", return_value=prior), patch.object(atlas, "_color_candidates") as fallback:
            self.assertIs(atlas.propose_physical_outer(image, "BLACK"), prior)
            fallback.assert_not_called()

    def test_side_fitter_does_not_fill_in_missing_perimeter_from_a_box(self):
        contour = np.array([[[x, 100]] for x in range(100, 600)] + [[[100, y]] for y in range(100, 800)], np.int32)
        self.assertIsNone(atlas._fitted_perimeter(contour, cv2.minAreaRect(contour)))

    def test_equally_supported_distinct_enclosing_candidates_do_not_force_recovery(self):
        image = weak_edge_photo()
        outer = np.array([[80, 80], [620, 80], [620, 800], [80, 800]], np.float32)
        other = np.array([[60, 60], [640, 60], [640, 820], [60, 820]], np.float32)
        evidence = {name: {"supportFraction": 1, "candidateCount": 1} for name in legacy.SIDE_NAMES}
        prior = invalid_art_result()
        with patch.object(legacy, "propose_physical_outer", return_value=prior), patch.object(atlas, "_color_candidates", return_value=[(100, outer), (99, other)]), patch.object(atlas, "_perimeter_evidence", return_value=evidence):
            self.assertIs(atlas.propose_physical_outer(image, "BLACK"), prior)


if __name__ == "__main__":
    unittest.main()
