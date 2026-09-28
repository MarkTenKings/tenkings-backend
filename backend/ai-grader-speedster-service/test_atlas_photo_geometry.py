"""Pixel-only regression tests for ATLAS physical candidate ranking."""
import unittest
from unittest.mock import patch

import cv2
import numpy as np

import atlas_photo_geometry as atlas
import color_geometry as legacy


def weak_edge_photo(top=80, body=(140, 75, 30)):
    image = np.zeros((900, 700, 3), np.uint8)
    image[:] = np.linspace(105, 25, 700).astype(np.uint8)[None, :, None]
    cv2.rectangle(image, (80, top), (620, 800), body, -1)
    cv2.rectangle(image, (130, 160), (570, 430), (230, 230, 230), -1)
    return image


def divided_edge_photo(stripe=(100, 55, 35)):
    image = np.full((1000, 750, 3), 45, np.uint8)
    cv2.rectangle(image, (80, 80), (670, 900), (230, 230, 230), -1)
    cv2.rectangle(image, (80, 80), (130, 550), stripe, -1)
    cv2.rectangle(image, (620, 500), (670, 900), stripe, -1)
    return image


class AtlasPhotoGeometryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cv2.setNumThreads(1)

    def assert_outer(self, image, expected, tolerance=4):
        result = atlas.propose_physical_outer(image, "BLACK")
        self.assertEqual(result["outcome"], "ACCEPTED", result)
        self.assertEqual(result["engineVersion"], atlas.ENGINE_VERSION)
        self.assertEqual(result["authority"], "PROPOSER_ONLY")
        self.assertEqual(result["policyProvenance"], atlas.POLICY_PROVENANCE)
        np.testing.assert_allclose(result["proposal"], expected, atol=tolerance)
        self.assertTrue(all(side["supportFraction"] >= .7 for side in result["sideEvidence"].values()))
        return result

    def test_weak_color_perimeter_beats_competing_landscape_art_without_mocks(self):
        for body in ((140, 75, 30), (115, 65, 45)):
            with self.subTest(body=body):
                self.assert_outer(weak_edge_photo(body=body), [[80, 80], [620, 80], [620, 800], [80, 800]])

    def test_adoptable_printed_border_cannot_bypass_outer_material_evidence(self):
        image = np.full((1000, 800, 3), 65, np.uint8)
        cv2.rectangle(image, (80, 90), (720, 900), (140, 75, 30), -1)
        cv2.rectangle(image, (150, 160), (650, 860), (235, 235, 235), -1)
        prior = legacy.propose_physical_outer(image, "BLACK")
        self.assertTrue(atlas._adoptable(prior["proposal"], 800, 1000))
        self.assertGreater(prior["proposal"][0, 0], 130)
        self.assert_outer(image, [[80, 90], [720, 90], [720, 900], [80, 900]])

    def test_lighting_gradient_and_distant_mat_seam_use_observed_outward_paths(self):
        image = np.zeros((1000, 800, 3), np.uint8)
        image[:] = np.linspace(175, 30, 1000).astype(np.uint8)[:, None, None]
        image[:45] = 45
        cv2.rectangle(image, (170, 240), (630, 870), (140, 75, 30), -1)
        result = self.assert_outer(image, [[170, 240], [630, 240], [630, 870], [170, 870]])
        self.assertGreaterEqual(result["sideEvidence"]["top"]["outsideRayContinuityFraction"], .7)

    def test_faint_visible_card_requires_signal_above_actual_mat_noise(self):
        image = np.full((900, 700, 3), 60, np.uint8)
        cv2.rectangle(image, (120, 120), (580, 765), (85, 64, 80), -1)
        cv2.rectangle(image, (210, 290), (490, 590), (230, 230, 230), -1)
        self.assert_outer(image, [[120, 120], [580, 120], [580, 765], [120, 765]], tolerance=5)

    def test_projective_card_is_fitted_from_observed_sides(self):
        image = np.full((1000, 800, 3), 40, np.uint8)
        outer = np.array([[170, 130], [640, 155], [610, 870], [130, 830]], np.int32)
        cv2.fillConvexPoly(image, outer, (130, 75, 30))
        cv2.rectangle(image, (260, 290), (490, 650), (235, 235, 235), -1)
        self.assert_outer(image, outer, tolerance=5)

    def test_textured_mat_keeps_outer_card_instead_of_central_text_field(self):
        rng = np.random.default_rng(612)
        mat = np.linspace(120, 30, 1000)[:, None] + rng.normal(0, 10, (1000, 800))
        image = np.repeat(np.uint8(np.clip(mat, 0, 255))[..., None], 3, axis=2)
        cv2.rectangle(image, (170, 210), (640, 870), (110, 68, 55), -1)
        cv2.fillConvexPoly(image, np.array([[290, 370], [520, 370], [570, 540],
                                         [520, 690], [290, 690], [240, 540]], np.int32), (235, 235, 235))
        self.assert_outer(image, [[170, 210], [640, 210], [640, 870], [170, 870]], tolerance=5)

    def test_textured_mat_without_card_cannot_borrow_random_edge_contrast(self):
        rng = np.random.default_rng(412)
        mat = np.linspace(130, 25, 900)[:, None] + rng.normal(0, 12, (900, 700))
        image = np.repeat(np.uint8(np.clip(mat, 0, 255))[..., None], 3, axis=2)
        self.assertIsNone(atlas.propose_physical_outer(image, "BLACK")["proposal"])

    def test_quad_contract_rejects_bounds_order_area_and_nonconvexity(self):
        good = np.array([[100, 100], [600, 100], [600, 800], [100, 800]], np.float32)
        self.assertTrue(atlas._adoptable(good, 700, 900))
        for bad in (None, np.roll(good, -1, axis=0), good * 3, good * .01,
                    [[100, 100], [600, 100], [200, 200], [100, 800]],
                    [[float("nan"), 100], *good[1:].tolist()]):
            self.assertFalse(atlas._adoptable(bad, 700, 900))

    def test_truncated_card_cannot_use_its_interior_art(self):
        result = atlas.propose_physical_outer(weak_edge_photo(top=0), "BLACK")
        self.assertNotEqual(result["outcome"], "ACCEPTED")
        self.assertIsNone(result["proposal"])

    def test_printed_rectangle_on_card_material_fails_external_mat_evidence(self):
        image = weak_edge_photo()
        interior = np.array([[130, 160], [570, 160], [570, 430], [130, 430]], np.float32)
        sides = atlas._perimeter_evidence(legacy._cie_lab(image), interior)
        self.assertTrue(any(side["supportFraction"] < .7 for side in sides.values()))
        with patch.object(atlas, "_color_candidates", return_value=[(100, interior)]):
            self.assertIsNone(atlas.propose_physical_outer(image, "BLACK")["proposal"])

    def test_wide_neutral_card_margin_is_not_mistaken_for_mat(self):
        image = np.full((1000, 800, 3), 25, np.uint8)
        cv2.rectangle(image, (90, 70), (710, 930), (170, 170, 170), -1)
        cv2.rectangle(image, (230, 250), (570, 730), (240, 240, 240), -1)
        interior = np.array([[230, 250], [570, 250], [570, 730], [230, 730]], np.float32)
        sides = atlas._perimeter_evidence(legacy._cie_lab(image), interior)
        self.assertTrue(all(side["outsidePerimeterSupportFraction"] == 0 for side in sides.values()))
        self.assert_outer(image, [[90, 70], [710, 70], [710, 930], [90, 930]])

    def test_without_visible_selected_mat_does_not_claim_card_authority(self):
        image = np.full((900, 700, 3), (140, 75, 30), np.uint8)
        cv2.rectangle(image, (100, 100), (600, 800), (220, 220, 220), -1)
        with patch.object(atlas, "_color_candidates") as candidates:
            result = atlas.propose_physical_outer(image, "BLACK")
        self.assertEqual(result["outcome"], "ABSTAIN")
        self.assertIsNone(result["proposal"])
        candidates.assert_not_called()

    def test_blank_mat_does_not_invent_a_card(self):
        for value in (30, 70):
            result = atlas.propose_physical_outer(np.full((900, 700, 3), value, np.uint8), "BLACK")
            self.assertEqual(result["outcome"], "INSUFFICIENT_EVIDENCE")
            self.assertIsNone(result["proposal"])

    def test_side_fitter_does_not_fill_in_missing_perimeter_from_a_box(self):
        contour = np.array([[[x, 100]] for x in range(100, 600)] + [[[100, y]] for y in range(100, 800)], np.int32)
        self.assertIsNone(atlas._fitted_perimeter(contour, cv2.minAreaRect(contour)))

    def test_two_equally_supported_cards_abstain_without_silent_choice(self):
        image = np.full((1000, 1600, 3), 35, np.uint8)
        for x in (150, 900):
            cv2.rectangle(image, (x, 180), (x + 460, 825), (150, 80, 30), -1)
        result = atlas.propose_physical_outer(image, "BLACK")
        self.assertEqual(result["outcome"], "ABSTAIN", result)
        self.assertIsNone(result["proposal"])
        self.assertTrue(result["ambiguity"]["ambiguous"])

    def test_chroma_and_continuity_must_share_one_real_path(self):
        # A vivid sheet fills the photo around an internal white rectangle.
        # No route reaches matching selected-mat material outside the sheet.
        image = np.full((900, 700, 3), 20, np.uint8)
        cv2.rectangle(image, (40, 40), (660, 860), (180, 60, 20), -1)
        cv2.rectangle(image, (180, 200), (520, 700), (235, 235, 235), -1)
        inner = np.array([[180, 200], [520, 200], [520, 700], [180, 700]], np.float32)
        with patch.object(atlas, "_color_candidates", return_value=[(100, inner)]):
            self.assertIsNone(atlas.propose_physical_outer(image, "BLACK")["proposal"])

    def test_print_touching_cut_edges_can_join_observed_contour_fragments(self):
        image = divided_edge_photo()
        lab = legacy._cie_lab(cv2.GaussianBlur(image, (5, 5), 0))
        # No single connected contour supplies the physical candidate, although
        # all four real cut edges are evidenced by different observed fragments.
        for _, quad in atlas._color_candidates(image):
            self.assertTrue(any(side["supportFraction"] < .7
                                for side in atlas._perimeter_evidence(lab, quad).values()))
        self.assert_outer(image, [[80, 80], [670, 80], [670, 900], [80, 900]])

    def test_fragment_fitting_cannot_replace_missing_cut_edge_contrast(self):
        result = atlas.propose_physical_outer(divided_edge_photo(stripe=(55, 50, 45)), "BLACK")
        self.assertEqual(result["outcome"], "INSUFFICIENT_EVIDENCE")
        self.assertIsNone(result["proposal"])

    def test_supported_original_outline_does_not_enter_fragment_search(self):
        with patch.object(atlas, "_color_candidates", wraps=atlas._color_candidates) as candidates:
            self.assert_outer(weak_edge_photo(), [[80, 80], [620, 80], [620, 800], [80, 800]])
        self.assertEqual(candidates.call_count, 1)
        self.assertEqual(candidates.call_args.kwargs, {})


if __name__ == "__main__":
    unittest.main()
