import unittest

import cv2
import numpy as np

from app import Point, TARGET_HEIGHT, TARGET_WIDTH, find_card_corners, find_design_borders, rectify, reveal_views


class SpeedsterGeometryTest(unittest.TestCase):
    def test_proposes_and_rectifies_four_card_corners(self):
        image = np.zeros((1600, 1200, 3), dtype=np.uint8)
        expected = np.array(
            [[180, 120], [1010, 165], [970, 1480], [140, 1430]],
            dtype=np.int32,
        )
        cv2.fillConvexPoly(image, expected, (245, 245, 245))

        corners = find_card_corners(image)
        self.assertIsNotNone(corners)
        np.testing.assert_allclose(corners, expected, atol=1)

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

        borders = find_design_borders(image)
        np.testing.assert_allclose(borders, expected, atol=7)


if __name__ == "__main__":
    unittest.main()
