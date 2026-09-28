"""Real core/full output parity and fail-closed output selection."""
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
import manual_preparation_worker as worker


class ManualPreparationContractTest(unittest.TestCase):
    def test_core_preserves_full_core_bytes_transform_and_complete_proposal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = np.zeros((400, 300, 3), np.uint8)
            image[40:360, 40:260] = (215, 215, 215)
            image[70:330, 60:240] = (40, 100, 180)
            encoded = cv2.imencode(".png", image)[1].tobytes()
            (root / "source.png").write_bytes(encoded)
            request = {"mode": "PREPARE", "matColor": "BLACK", "inputPath": str(root / "source.png"),
                       "source": {"width": 300, "height": 400, "sha256": hashlib.sha256(encoded).hexdigest(), "byteCount": len(encoded)},
                       "quad": [{"x": 40/300, "y": .1}, {"x": 260/300, "y": .1}, {"x": 260/300, "y": .9}, {"x": 40/300, "y": .9}],
                       "limits": {"maxInputBytes": 1000000, "maxPixels": 1000000, "maxOutputBytes": 16000000, "timeoutMs": 10000}}
            full_dir = root / "full"; full_dir.mkdir()
            full = worker.execute({**request, "outputDirectory": str(full_dir)})
            self.assertEqual(full["outputContract"], worker.FULL_OUTPUT_CONTRACT)
            self.assertEqual(list(full["frames"]), ["rectified", "inspection", "normalized", "microDefect", "directional"])
            for mat in ["BLACK", "WHITE", "MAGENTA"]:
                # Compare the whole printed proposal, including refusal evidence.
                full_mat_dir = root / (mat + "-full"); full_mat_dir.mkdir()
                expected = worker.execute({**request, "matColor": mat, "outputDirectory": str(full_mat_dir)})
                core_dir = root / (mat + "-core"); core_dir.mkdir()
                with patch.object(worker, "reveal_views", side_effect=AssertionError("core must not compute optional pixels")):
                    core = worker.execute({**request, "matColor": mat, "outputDirectory": str(core_dir),
                                           "outputContract": worker.CORE_OUTPUT_CONTRACT})
                self.assertEqual(core["outputContract"], worker.CORE_OUTPUT_CONTRACT)
                self.assertEqual(list(core["frames"]), ["rectified", "inspection"])
                self.assertEqual(sorted(p.name for p in core_dir.iterdir()), ["inspection-preview.jpg", "inspection.webp", "rectified.webp"])
                self.assertEqual(core["inspectionPreview"], expected["inspectionPreview"])
                self.assertEqual(core["inspectionPreview"]["sourceSha256"], core["frames"]["inspection"]["sha256"])
                self.assertEqual(core["encoderSettings"], worker.LOSSLESS_SETTINGS)
                for name in core["frames"]:
                    self.assertEqual(core["frames"][name], expected["frames"][name])
                    self.assertEqual((core_dir / (name + ".webp")).read_bytes(), (full_mat_dir / (name + ".webp")).read_bytes())
                self.assertEqual(core["proposal"], expected["proposal"])
                self.assertEqual(core["identity"], expected["identity"])
                self.assertEqual(core["encoderSettings"], expected["encoderSettings"])

    def test_unknown_or_malformed_output_contract_is_rejected_before_native_input(self):
        for contract in [None, "core", "atlas-preparation-reveals-v1", [], {}, 1]:
            with self.subTest(contract=contract), patch.object(worker, "checked_image") as decode:
                with self.assertRaisesRegex(ValueError, "PREPARATION_INVALID"):
                    worker.execute({"mode": "PREPARE", "matColor": "BLACK", "outputContract": contract})
                decode.assert_not_called()


if __name__ == "__main__":
    unittest.main()
