from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from unittest import mock

import cv2
import numpy as np


SCRIPT = Path(__file__).parents[1] / 'analyze-mathematical-calibration-v1.py'
SPEC = importlib.util.spec_from_file_location(
    'mathematical_calibration_v1_checkerboard', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def rendered_checkerboard() -> np.ndarray:
    cell = 36
    x, y = 230, 250
    image = np.full((1100, 900), 210, np.uint8)
    for row in range(17):
        for column in range(12):
            value = 0 if (row + column) % 2 == 0 else 255
            image[y + row * cell:y + (row + 1) * cell,
                  x + column * cell:x + (column + 1) * cell] = value
    return image


def local_points(width: int, height: int) -> np.ndarray:
    xs = np.linspace(12, width - 13, 11, dtype=np.float32)
    ys = np.linspace(14, height - 15, 16, dtype=np.float32)
    return np.array(
        [[[x, y]] for y in ys for x in xs], dtype=np.float32)


class MathematicalCalibrationCheckerboardDetectorTest(unittest.TestCase):
    def test_full_frame_sb_result_is_unchanged_and_skips_fallback(self):
        image = rendered_checkerboard()
        flags = (cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY |
                 cv2.CALIB_CB_NORMALIZE_IMAGE)
        found, corners = cv2.findChessboardCornersSB(
            image, (11, 16), flags=flags)
        self.assertTrue(found)
        self.assertIsNotNone(corners)
        with mock.patch.object(
                MODULE, 'find_checkerboard_sb_with_local_contrast',
                side_effect=AssertionError('fallback must not run')):
            observed = MODULE.detect_checkerboard(image, 11, 16)
        np.testing.assert_array_equal(
            observed, corners.reshape(-1, 2).astype(np.float32))

    def test_local_contrast_runs_only_after_full_frame_failure_and_remaps(self):
        image = np.full((600, 800), 220, np.uint8)
        image[80:520, 140:700] = 20
        calls: list[tuple[int, int]] = []

        def detector(candidate, pattern_size, flags):
            self.assertEqual(pattern_size, (11, 16))
            self.assertEqual(
                flags, cv2.CALIB_CB_EXHAUSTIVE |
                cv2.CALIB_CB_ACCURACY | cv2.CALIB_CB_NORMALIZE_IMAGE)
            calls.append((candidate.shape[1], candidate.shape[0]))
            if candidate.shape == image.shape:
                return False, None
            return True, local_points(candidate.shape[1], candidate.shape[0])

        with mock.patch.object(
                MODULE.cv2, 'findChessboardCornersSB', side_effect=detector):
            observed = MODULE.detect_checkerboard(image, 11, 16)
        self.assertEqual(calls[0], (800, 600))
        self.assertEqual(len(calls), 2)
        expected = local_points(560, 440).reshape(-1, 2)
        expected += np.array([140, 80], dtype=np.float32)
        np.testing.assert_array_equal(observed, expected)

    def test_local_contrast_output_is_deterministic(self):
        image = np.full((600, 800), 220, np.uint8)
        image[80:520, 140:700] = 20

        def run_once() -> np.ndarray:
            def detector(candidate, pattern_size, flags):
                if candidate.shape == image.shape:
                    return False, None
                return True, local_points(
                    candidate.shape[1], candidate.shape[0])

            with mock.patch.object(
                    MODULE.cv2, 'findChessboardCornersSB',
                    side_effect=detector):
                return MODULE.detect_checkerboard(image, 11, 16)

        np.testing.assert_array_equal(run_once(), run_once())

    def test_wrong_grid_and_no_board_reject_without_alternate_fallback(self):
        blank = np.full((600, 800), 210, np.uint8)
        with mock.patch.object(
                MODULE, 'find_checkerboard_sb_with_local_contrast',
                side_effect=AssertionError('wrong grid must not use fallback')):
            with self.assertRaisesRegex(ValueError, '10x16'):
                MODULE.detect_checkerboard(blank, 10, 16)
        with self.assertRaisesRegex(ValueError, '11x16'):
            MODULE.detect_checkerboard(blank, 11, 16)

    def test_cropped_board_rejects(self):
        cropped = rendered_checkerboard()[:, :520]
        with self.assertRaisesRegex(ValueError, '11x16'):
            MODULE.detect_checkerboard(cropped, 11, 16)

    def test_nonfinite_and_out_of_frame_results_reject(self):
        image = np.full((600, 800), 210, np.uint8)
        invalid_values = (
            np.array([np.nan, 20.0], dtype=np.float32),
            np.array([-1.0, 20.0], dtype=np.float32),
            np.array([800.0, 20.0], dtype=np.float32),
        )
        for invalid in invalid_values:
            with self.subTest(invalid=invalid.tolist()):
                corners = local_points(800, 600)
                corners[0, 0] = invalid
                with mock.patch.object(
                        MODULE.cv2, 'findChessboardCornersSB',
                        return_value=(True, corners)), mock.patch.object(
                            MODULE,
                            'find_checkerboard_sb_with_local_contrast',
                            return_value=None):
                    with self.assertRaisesRegex(ValueError, '11x16'):
                        MODULE.detect_checkerboard(image, 11, 16)


if __name__ == '__main__':
    unittest.main()
