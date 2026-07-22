from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / 'analyze-mathematical-calibration-v1.py'
SPEC = importlib.util.spec_from_file_location(
    'mathematical_calibration_v1_timestamp', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class MathematicalCalibrationTimestampContractTest(unittest.TestCase):
    def test_exact_utc_timestamp_preserves_every_accepted_form(self):
        valid = (
            '2026-07-22T09:47:40Z',
            '2026-07-22T09:47:40.475Z',
            '2026-07-22T09:47:40.475849Z',
            '2026-07-22T09:47:40.4758494Z',
        )
        for value in valid:
            with self.subTest(value=value):
                observed = MODULE.exact_utc_timestamp(value, 'capturedAt')
                self.assertIs(observed, value)
                self.assertEqual(observed, value)

    def test_exact_utc_timestamp_rejects_every_unapproved_form(self):
        invalid = (
            '2026-07-22T09:47:40.4Z',
            '2026-07-22T09:47:40.47Z',
            '2026-07-22T09:47:40.47584940Z',
            '2026-07-22T09:47:40.475849400Z',
            '2026-07-22T09:47:40.4758494+00:00',
            '2026-07-22T09:47:40.4758494-04:00',
            '2026-07-22T09:47:40.4758494z',
            ' 2026-07-22T09:47:40.4758494Z',
            '2026-07-22T09:47:40.4758494Z ',
            '2026/07/22T09:47:40.4758494Z',
            '2026-07-22 09:47:40.4758494Z',
            '',
            None,
            20260722,
            b'2026-07-22T09:47:40.4758494Z',
        )
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaisesRegex(
                        ValueError,
                        'capturedAt must be an exact UTC timestamp'):
                    MODULE.exact_utc_timestamp(value, 'capturedAt')


if __name__ == '__main__':
    unittest.main()
