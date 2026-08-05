import unittest
from unittest.mock import patch

import cv2
import numpy as np

from app import PreparedUploads, Point, TARGET_HEIGHT, TARGET_WIDTH, rectify, reveal_views
from card_geometry import (
    INSPECTION_HEIGHT,
    INSPECTION_MARGIN_PX,
    INSPECTION_WIDTH,
    _candidate_contours,
    detect_card_quad,
    printed_border_quad,
    warp_to_card_map,
    warp_to_inspection_map,
)


class SpeedsterGeometryTest(unittest.TestCase):
    def test_prepare_upload_contract_keeps_backend_first_rollout_compatible(self):
        legacy = PreparedUploads(
            rectified="rectified",
            normalized="normalized",
            microDefect="micro",
            directional="directional",
        )
        self.assertIsNone(legacy.inspection)
        expanded = PreparedUploads(
            rectified="rectified",
            inspection="inspection",
            normalized="normalized",
            microDefect="micro",
            directional="directional",
        )
        self.assertEqual(expanded.inspection, "inspection")

    def test_proposes_and_rectifies_four_card_corners(self):
        image = np.zeros((1600, 1200, 3), dtype=np.uint8)
        expected = np.array(
            [[140, 120], [1050, 140], [1030, 1415], [120, 1390]],
            dtype=np.int32,
        )
        cv2.fillConvexPoly(image, expected, (245, 245, 245))

        corners = detect_card_quad(image)
        self.assertIsNotNone(corners)
        np.testing.assert_allclose(corners, expected, atol=5)

        normalized = [Point(x=float(x / 1200), y=float(y / 1600)) for x, y in corners]
        rectified, transform = rectify(image, normalized)
        self.assertEqual(rectified.shape, (TARGET_HEIGHT, TARGET_WIDTH, 3))
        self.assertEqual(transform.shape, (3, 3))

        views = reveal_views(rectified)
        self.assertEqual(len(views), 3)
        self.assertTrue(all(view.shape[:2] == (TARGET_HEIGHT, TARGET_WIDTH) for view in views))

    def test_proposes_design_border_geometry(self):
        image = np.full((TARGET_HEIGHT, TARGET_WIDTH, 3), 225, dtype=np.uint8)
        expected = np.array([[115, 145], [1154, 145], [1154, 1632], [115, 1632]])
        cv2.rectangle(image, (115, 145), (1154, 1632), (15, 15, 15), 10)

        borders, detected, offsets = printed_border_quad(image)
        np.testing.assert_allclose(borders, expected, atol=7)
        self.assertEqual(detected, ["top", "right", "bottom", "left"])
        self.assertTrue(all(offsets[side] is not None for side in detected))

    def test_inspection_map_keeps_the_canonical_card_and_two_mm_context(self):
        image = np.full((1900, 1500, 3), (20, 80, 140), dtype=np.uint8)
        corners = np.array(
            [[100, 60], [1369, 60], [1369, 1837], [100, 1837]], dtype=np.float32
        )
        cv2.fillConvexPoly(image, corners.astype(np.int32), (235, 235, 235))

        rectified, _ = warp_to_card_map(image, corners)
        inspection, _ = warp_to_inspection_map(image, corners)

        self.assertEqual(inspection.shape, (INSPECTION_HEIGHT, INSPECTION_WIDTH, 3))
        card = inspection[
            INSPECTION_MARGIN_PX : INSPECTION_MARGIN_PX + TARGET_HEIGHT,
            INSPECTION_MARGIN_PX : INSPECTION_MARGIN_PX + TARGET_WIDTH,
        ]
        np.testing.assert_allclose(card, rectified, atol=1)
        self.assertGreater(float(card.mean()), 220)
        self.assertLess(float(inspection[:INSPECTION_MARGIN_PX].mean()), 120)

    def test_returns_none_instead_of_calling_the_photo_frame_a_card(self):
        image = np.full((900, 700, 3), 120, dtype=np.uint8)
        self.assertIsNone(detect_card_quad(image))

    def test_searches_visual_and_material_contours_separately_with_retr_list(self):
        image = np.full((900, 700, 3), 120, dtype=np.uint8)
        visual = np.array([[[10, 10]], [[20, 10]], [[20, 20]], [[10, 20]]])
        material = np.array([[[30, 30]], [[40, 30]], [[40, 40]], [[30, 40]]])

        with patch(
            "card_geometry.cv2.findContours",
            side_effect=[([visual], None), ([material], None)],
        ) as find:
            contours = _candidate_contours(image)

        self.assertEqual(len(find.call_args_list), 2)
        self.assertTrue(
            all(call.args[1] == cv2.RETR_LIST for call in find.call_args_list)
        )
        self.assertIs(contours[0], visual)
        self.assertIs(contours[1], material)

    def test_rejects_a_valid_scoring_contour_when_it_touches_the_photo_frame(self):
        image = np.full((900, 700, 3), 120, dtype=np.uint8)
        frame_touching = np.array(
            [[[0, 50]], [[500, 50]], [[500, 750]], [[0, 750]]], dtype=np.int32
        )

        with patch("card_geometry._candidate_contours", return_value=[frame_touching]):
            self.assertIsNone(detect_card_quad(image))

    def test_returns_none_for_a_clipped_card_at_the_photo_boundary(self):
        image = np.zeros((1600, 1200, 3), dtype=np.uint8)
        clipped = np.array(
            [[150, 0], [1060, 20], [1040, 1295], [130, 1270]], dtype=np.int32
        )
        cv2.fillConvexPoly(image, clipped, (245, 245, 245))

        self.assertIsNone(detect_card_quad(image))


if __name__ == "__main__":
    unittest.main()
