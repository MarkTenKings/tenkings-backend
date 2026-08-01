import unittest

import cv2
import numpy as np

from app import Point, TARGET_HEIGHT, TARGET_WIDTH, rectify, reveal_views
from card_geometry import detect_card_quad, printed_border_quad


class SpeedsterGeometryTest(unittest.TestCase):
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

    def test_returns_none_instead_of_calling_the_photo_frame_a_card(self):
        image = np.full((900, 700, 3), 120, dtype=np.uint8)
        self.assertIsNone(detect_card_quad(image))


if __name__ == "__main__":
    unittest.main()
