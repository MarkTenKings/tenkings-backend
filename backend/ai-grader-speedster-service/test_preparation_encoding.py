"""Actual codec equality and fail-closed lossless preparation checks."""
import unittest
from unittest.mock import patch
import cv2
import numpy as np
import preparation_encoding as encoding


class PreparationEncodingTest(unittest.TestCase):
    def test_transparent_structured_image_preserves_every_visible_sample_and_alpha(self):
        y, x = np.indices((73, 91))
        raster = np.stack([(3*x+y) % 256, (x+2*y) % 256, (2*x+3*y) % 256,
                           np.where((x > 4) & (x < 87) & (y > 2) & (y < 71), 255, 0)], axis=2).astype(np.uint8)
        raster[3, 5, 3] = 1
        before = raster.copy()
        encoded = encoding.encode_lossless_webp(raster)
        decoded = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_UNCHANGED)
        np.testing.assert_array_equal(raster, before)
        np.testing.assert_array_equal(decoded[:, :, 3], raster[:, :, 3])
        visible = raster[:, :, 3] > 0
        np.testing.assert_array_equal(decoded[visible, :3], raster[visible, :3])
        # Real WebP uses nonzero hidden RGB on structured transparent borders.
        self.assertTrue(np.any(decoded[~visible, :3] != 0))
        # Even one changed alpha or a color bit at alpha=1 must be refused.
        for point, channel in [((0, 0), 3), ((3, 5), 0), ((20, 20), 1)]:
            altered = decoded.copy()
            altered[point[0], point[1], channel] ^= 1
            with patch.object(encoding.cv2, 'imdecode', return_value=altered):
                with self.assertRaisesRegex(ValueError, 'PREPARATION_OUTPUT_INVALID'):
                    encoding.encode_lossless_webp(raster)

    def test_opaque_generated_rgba_may_omit_only_the_redundant_alpha_plane(self):
        raster = np.random.default_rng(18).integers(0, 256, (73, 91, 4), np.uint8)
        raster[:, :, 3] = 255
        encoded = encoding.encode_lossless_webp(raster)
        decoded = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_UNCHANGED)
        np.testing.assert_array_equal(decoded, raster[:, :, :3])
        raster[0, 0, 3] = 254
        with patch.object(encoding.cv2, 'imdecode', return_value=decoded):
            with self.assertRaisesRegex(ValueError, 'PREPARATION_OUTPUT_INVALID'):
                encoding.encode_lossless_webp(raster)

    def test_rgb_and_gray_samples_survive_actual_webp_codec_exactly(self):
        rng = np.random.default_rng(317)
        for shape in [(73, 91, 3), (73, 91), (73, 91, 4)]:
            raster = rng.integers(0, 256, shape, np.uint8)
            encoded = encoding.encode_lossless_webp(raster)
            decoded = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_UNCHANGED)
            expected = cv2.cvtColor(raster, cv2.COLOR_GRAY2BGR) if raster.ndim == 2 else raster
            if expected.ndim == 3 and expected.shape[2] == 4:
                expected[expected[:, :, 3] == 0, :3] = 0
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
        for raster in [np.zeros((3, 4, 3), np.uint16), np.zeros((3, 4, 1), np.uint8)]:
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
