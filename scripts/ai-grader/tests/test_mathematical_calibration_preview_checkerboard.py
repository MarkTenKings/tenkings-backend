from __future__ import annotations

import importlib.util
import unittest

import cv2
import numpy as np


SCRIPT = (__import__("pathlib").Path(__file__).parents[1]
          / "detect-mathematical-calibration-preview-checkerboard.py")
SPEC = importlib.util.spec_from_file_location("calibration_preview_checkerboard", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def rendered_target(x: int = 240, y: int = 260) -> np.ndarray:
    cell = 45
    image = np.full((1200, 1000), 210, np.uint8)
    for row in range(17):
        for column in range(12):
            if (row + column) % 2 == 0:
                image[y + row * cell:y + (row + 1) * cell,
                      x + column * cell:x + (column + 1) * cell] = 0
            else:
                image[y + row * cell:y + (row + 1) * cell,
                      x + column * cell:x + (column + 1) * cell] = 255
    return image


def encode(image: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("focused checkerboard fixture could not be encoded")
    return encoded.tobytes()


class CalibrationPreviewCheckerboardTest(unittest.TestCase):
    def test_rendered_12_by_17_target_has_11_by_16_corners_and_finite_outer_contour(self):
        result = MODULE.detect_preview(encode(rendered_target()))
        self.assertEqual(len(result["internalCorners"]), 11 * 16)
        self.assertEqual(len(result["outerCorners"]), 4)
        for point in result["outerCorners"]:
            self.assertTrue(np.isfinite([point["x"], point["y"]]).all())
            self.assertGreaterEqual(point["x"], 0)
            self.assertLess(point["x"], result["imageWidth"])
            self.assertGreaterEqual(point["y"], 0)
            self.assertLess(point["y"], result["imageHeight"])

    def test_missing_checkerboard_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "checkerboard"):
            MODULE.detect_preview(encode(np.full((1200, 1000), 210, np.uint8)))

    def test_out_of_frame_outer_geometry_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "out of frame"):
            grid = np.array([
                [[10 + column * 45, 100 + row * 45] for column in range(11)]
                for row in range(16)
            ], dtype=np.float64)
            MODULE.derive_outer_corners(grid, 1000, 1200)


if __name__ == "__main__":
    unittest.main()
