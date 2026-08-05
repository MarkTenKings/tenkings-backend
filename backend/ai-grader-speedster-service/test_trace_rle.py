import unittest

import numpy as np

from defect_math import GRID_HEIGHT, GRID_WIDTH
from trace_rle import (
    TRACE_FORMAT,
    TRACE_ORDER,
    TRACE_ORIGIN,
    decode_trace_rle,
    encode_trace_rle,
    trace_sha256,
)


GOLDEN_CENTER_RUNS = [1129665, 1, 1128394]
GOLDEN_CENTER_SHA256 = (
    "928e33389ba8eb03acf1325532e93cfb615cf1527099bd53dbecd7e769cc6ed0"
)


class TraceRleTests(unittest.TestCase):
    def test_cross_language_center_pixel_golden_vector(self):
        mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        mask.reshape(-1)[1129665] = 1

        encoded = encode_trace_rle(mask)

        self.assertEqual(
            encoded,
            {
                "format": TRACE_FORMAT,
                "width": 1270,
                "height": 1778,
                "origin": TRACE_ORIGIN,
                "order": TRACE_ORDER,
                "runs": GOLDEN_CENTER_RUNS,
                "sha256": GOLDEN_CENTER_SHA256,
            },
        )
        self.assertEqual(
            trace_sha256(GOLDEN_CENTER_RUNS),
            GOLDEN_CENTER_SHA256,
        )
        np.testing.assert_array_equal(decode_trace_rle(encoded), mask)

    def test_hashes_only_the_frozen_lf_preimage(self):
        expected = (
            "TK_SPEEDSTER_TRACE_RLE_V1\n"
            "1270\n"
            "1778\n"
            "TOP_LEFT\n"
            "ROW_MAJOR_Y_X\n"
            "0\n"
            "1129665,1,1128394\n"
        ).encode("ascii")

        self.assertEqual(
            trace_sha256(GOLDEN_CENTER_RUNS, return_preimage=True),
            (GOLDEN_CENTER_SHA256, expected),
        )

    def test_round_trip_keeps_disconnected_pixels_and_holes_exactly(self):
        mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        mask[0, 0] = 1
        mask[30:36, 40:49] = 1
        mask[32:34, 43:46] = 0
        mask[-1, -1] = 1

        encoded = encode_trace_rle(mask)

        self.assertEqual(encoded["runs"][0], 0)
        self.assertTrue(all(run > 0 for run in encoded["runs"][1:]))
        self.assertEqual(sum(encoded["runs"]), GRID_WIDTH * GRID_HEIGHT)
        np.testing.assert_array_equal(decode_trace_rle(encoded), mask)

    def test_empty_and_noncanonical_or_tampered_traces_are_rejected(self):
        center = {
            "format": TRACE_FORMAT,
            "width": GRID_WIDTH,
            "height": GRID_HEIGHT,
            "origin": TRACE_ORIGIN,
            "order": TRACE_ORDER,
            "runs": GOLDEN_CENTER_RUNS,
            "sha256": GOLDEN_CENTER_SHA256,
        }
        invalid = [
            {**center, "format": "other"},
            {**center, "width": GRID_WIDTH - 1},
            {**center, "height": GRID_HEIGHT - 1},
            {**center, "origin": "BOTTOM_LEFT"},
            {**center, "order": "COLUMN_MAJOR_X_Y"},
            {**center, "runs": [1129665, 0, 1, 1128394]},
            {**center, "runs": [1129665, True, 1128394]},
            {**center, "runs": [1129665, 1, 1128393]},
            {**center, "sha256": "0" * 64},
        ]
        empty_runs = [GRID_WIDTH * GRID_HEIGHT]
        invalid.append(
            {
                **center,
                "runs": empty_runs,
                "sha256": trace_sha256(empty_runs),
            }
        )

        with self.assertRaises(ValueError):
            encode_trace_rle(np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8))
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    decode_trace_rle(value)

    def test_encode_rejects_non_binary_mask_values(self):
        invalid_values = [-1, 2, 0.5, np.nan, np.inf]
        for invalid_value in invalid_values:
            with self.subTest(invalid_value=invalid_value):
                mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.float64)
                mask[100, 200] = 1
                mask[300, 400] = invalid_value
                with self.assertRaisesRegex(ValueError, "only bool, 0, or 1"):
                    encode_trace_rle(mask)


if __name__ == "__main__":
    unittest.main()
