"""Exact Lab and stride parity; no provider or service imports."""
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
import color_geometry as color


def legacy_lab(image):
    raw = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    raw[:, :, 0] *= 100.0 / 255.0
    raw[:, :, 1:] -= 128.0
    return raw


class GeometryOptimizationTest(unittest.TestCase):
    def test_every_encoded_byte_in_every_lab_channel_is_bit_identical(self):
        encoded = np.repeat(np.arange(256, dtype=np.uint8)[:, None, None], 3, axis=2)
        with patch.object(color.cv2, "cvtColor", return_value=encoded):
            before = legacy_lab(encoded)
            after = color._cie_lab(encoded)
        self.assertEqual(before.dtype, after.dtype)
        self.assertEqual(before.tobytes(), after.tobytes())

    def test_rgb_and_float_noncontiguous_inputs_retain_exact_normalization(self):
        rng = np.random.default_rng(713)
        base = rng.integers(0, 256, (57, 43, 3), dtype=np.uint8)
        for image in [base, base[::-1], base[:, ::-1], base[::2, ::3],
                      np.rot90(base), base.transpose(1, 0, 2), base.astype(np.float32) / 255.0]:
            with self.subTest(shape=image.shape, strides=image.strides, dtype=image.dtype):
                self.assertEqual(legacy_lab(image).tobytes(), color._cie_lab(image).tobytes())

    def test_complete_proposals_and_quality_refusals_match_legacy_copies(self):
        fixtures = Path(__file__).with_name("test-fixtures") / "geometry"
        images = [cv2.imread(str(fixtures / name)) for name in ["cubone-front.jpg", "cubone-back.jpg"]]
        images.extend([np.zeros((600, 420, 3), np.uint8), np.full((600, 420, 3), 220, np.uint8)])
        rotate = np.rot90
        for source in images:
            self.assertIsNotNone(source)
            for image in [source, source[:, ::-1]]:
                for mat in ["BLACK", "WHITE", "MAGENTA"]:
                    for fn in [color.propose_physical_outer, color.propose_printed_frame]:
                        def serialized():
                            return color.serialize_proposal(fn(image, mat), image.shape[1], image.shape[0])
                        before = None
                        with patch.object(color, "_cie_lab", side_effect=legacy_lab), \
                                patch.object(color.np, "rot90", side_effect=lambda value: np.ascontiguousarray(rotate(value))):
                            before = serialized()
                        self.assertEqual(before, serialized())


if __name__ == "__main__":
    unittest.main()
