from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

import cv2
import numpy as np


SCRIPT = Path(__file__).parents[1] / "analyze-mathematical-calibration-v1-1.py"
SPEC = importlib.util.spec_from_file_location("mathematical_calibration_v1_1", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def rendered_target() -> np.ndarray:
    cell = 45
    image = np.full((1200, 1000), 210, np.uint8)
    for row in range(17):
        for column in range(12):
            if (row + column) % 2 == 0:
                image[260 + row * cell:260 + (row + 1) * cell,
                      240 + column * cell:240 + (column + 1) * cell] = 0
    return image


class MathematicalCalibrationV1_1AnalyzerTest(unittest.TestCase):
    def test_classic_fallback_returns_176_finite_in_frame_corners(self):
        original = MODULE.cv2.findChessboardCornersSB
        MODULE.cv2.findChessboardCornersSB = lambda *args, **kwargs: (False, None)
        image = rendered_target()
        try:
            corners = MODULE.detect(image, 11, 16)
        finally:
            MODULE.cv2.findChessboardCornersSB = original
        self.assertEqual(corners.shape, (176, 1, 2))
        self.assertTrue(np.isfinite(corners).all())
        self.assertTrue(np.all(corners[:, 0, 0] >= 0))
        self.assertTrue(np.all(corners[:, 0, 0] < image.shape[1]))
        self.assertTrue(np.all(corners[:, 0, 1] >= 0))
        self.assertTrue(np.all(corners[:, 0, 1] < image.shape[0]))


if __name__ == "__main__":
    unittest.main()
