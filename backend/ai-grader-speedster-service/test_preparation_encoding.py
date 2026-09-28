"""Actual codec equality and fail-closed lossless preparation checks."""
import unittest
from unittest.mock import patch
import cv2
import numpy as np
import preparation_encoding as encoding


class PreparationEncodingTest(unittest.TestCase):
    def test_rgb_and_gray_samples_survive_actual_webp_codec_exactly(self):
        rng = np.random.default_rng(317)
        for shape in [(73, 91, 3), (73, 91)]:
            raster = rng.integers(0, 256, shape, np.uint8)
            encoded = encoding.encode_lossless_webp(raster)
            decoded = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_UNCHANGED)
            expected = cv2.cvtColor(raster, cv2.COLOR_GRAY2BGR) if raster.ndim == 2 else raster
            np.testing.assert_array_equal(decoded, expected)

    def test_lossy_or_wrong_shape_decode_and_encode_failure_are_refused(self):
        raster = np.random.default_rng(817).integers(0, 256, (100, 120, 3), np.uint8)
        lossy = cv2.imencode('.webp', raster, [cv2.IMWRITE_WEBP_QUALITY, 92])[1]
        with patch.object(encoding.cv2, 'imencode', return_value=(True, lossy)):
            with self.assertRaisesRegex(ValueError, 'PREPARATION_OUTPUT_INVALID'):
                encoding.encode_lossless_webp(raster)
        for decoded in [None, np.zeros_like(raster), raster[:1], raster.astype(np.uint16)]:
            with patch.object(encoding.cv2, 'imdecode', return_value=decoded):
                with self.assertRaisesRegex(ValueError, 'PREPARATION_OUTPUT_INVALID'):
                    encoding.encode_lossless_webp(raster)
        with patch.object(encoding.cv2, 'imencode', return_value=(False, None)):
            with self.assertRaisesRegex(ValueError, 'PREPARATION_OUTPUT_INVALID'):
                encoding.encode_lossless_webp(raster)

    def test_unsupported_rasters_are_not_flattened_or_reduced(self):
        for raster in [np.zeros((3, 4, 4), np.uint8), np.zeros((3, 4, 3), np.uint16), np.zeros((3, 4, 1), np.uint8)]:
            with self.assertRaisesRegex(ValueError, 'PREPARATION_RASTER_UNSUPPORTED'):
                encoding.encode_lossless_webp(raster)

    def test_context_preview_is_bounded_and_has_actual_scaled_transform(self):
        raster = np.random.default_rng(13).integers(0, 256, (1858, 1350, 3), np.uint8)
        transform = np.array([[2, 0, 40], [0, 3, 40], [0, 0, 1]], np.float64)
        data, size, matrix = encoding.encode_inspection_preview(raster, transform)
        self.assertEqual(size, (558, 768))
        self.assertLessEqual(len(data), 1024 * 1024)
        decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
        self.assertEqual(decoded.shape, (768, 558, 3))
        sx, sy = 558/1350, 768/1858
        np.testing.assert_allclose(matrix, (np.array([[sx, 0, (sx-1)/2], [0, sy, (sy-1)/2], [0, 0, 1]]) @ transform).reshape(-1))


if __name__ == '__main__':
    unittest.main()
