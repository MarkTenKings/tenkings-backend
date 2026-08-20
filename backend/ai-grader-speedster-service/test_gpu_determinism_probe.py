import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from gpu_determinism_probe import FIXTURES, run_probe
from gpu_determinism_proof import REPETITIONS, summarize_attempts


def fake_identity():
    return {
        "runtime": {
            "ociDigest": "sha256:" + "a" * 64,
            "buildId": "test-build",
            "gpuName": "NVIDIA Test GPU",
            "gpuCapability": "8.9",
            "torchVersion": "2.7.1+cu126",
            "cudaVersion": "12.6",
            "compiler": {"contractVersion": "speedster-host-compiler-v1"},
        },
        "determinism": {"deterministicAlgorithms": True},
        "model": {"revision": "b" * 40},
    }


def fake_result(view_id: str, *, candidates: int = 8):
    return {
        "detectorVersion": "test-detector",
        "detectorIdentity": fake_identity(),
        "defects": [],
        "detectorEvidence": {"rawCandidates": [], "memoryDecisions": []},
        "instrumentation": {
            "views": [{"viewId": view_id, "candidateCount": candidates, "localizationMs": 1.0}],
            "localizedCandidateCount": candidates,
            "scannedCandidateCount": 0,
            "cappedCandidateCount": 0,
            "measuredRegionCount": 0,
            "rawCandidateEvidenceCount": 0,
            "memoryDecisionEvidenceCount": 0,
            "samMemoryMs": 2.0,
            "measurementMs": 3.0,
            "detectViewsTotalMs": 4.0,
        },
    }


class GpuDeterminismProbeTests(unittest.TestCase):
    def test_probe_rejects_missing_or_dirty_caches(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "TORCHINDUCTOR_CACHE_DIR"):
                run_probe()
        with tempfile.TemporaryDirectory() as torch_cache, tempfile.TemporaryDirectory() as triton_cache:
            Path(torch_cache, "stale").write_text("stale")
            with patch.dict(
                os.environ,
                {
                    "TORCHINDUCTOR_CACHE_DIR": torch_cache,
                    "TRITON_CACHE_DIR": triton_cache,
                },
                clear=True,
            ):
                with self.assertRaisesRegex(RuntimeError, "must exist and be empty"):
                    run_probe()

    def test_probe_requires_eight_prompts_and_a_cold_compile_artifact(self):
        with tempfile.TemporaryDirectory() as torch_cache, tempfile.TemporaryDirectory() as triton_cache:
            environment = {
                "TORCHINDUCTOR_CACHE_DIR": torch_cache,
                "TRITON_CACHE_DIR": triton_cache,
            }
            with patch.dict(os.environ, environment, clear=True):
                with self.assertRaisesRegex(RuntimeError, "exactly 8 geometric prompts"):
                    run_probe(
                        detect=lambda views, *_args, **_kwargs: fake_result(
                            views[0][0], candidates=0
                        ),
                        image_loader=lambda _path: np.zeros((2, 2, 3), dtype=np.uint8),
                    )
            with patch.dict(os.environ, environment, clear=True):
                with self.assertRaisesRegex(RuntimeError, "no TorchInductor/Triton cache"):
                    run_probe(
                        detect=lambda views, *_args, **_kwargs: fake_result(views[0][0]),
                        image_loader=lambda _path: np.zeros((2, 2, 3), dtype=np.uint8),
                    )

    def test_probe_binds_fixture_bytes_counts_and_stable_semantics(self):
        with tempfile.TemporaryDirectory() as torch_cache, tempfile.TemporaryDirectory() as triton_cache:
            def detect(views, *_args, **_kwargs):
                Path(torch_cache, "compiled.so").write_bytes(b"compiled")
                return fake_result(views[0][0])

            with patch.dict(
                os.environ,
                {
                    "TORCHINDUCTOR_CACHE_DIR": torch_cache,
                    "TRITON_CACHE_DIR": triton_cache,
                },
                clear=True,
            ):
                proof = run_probe(
                    detect=detect,
                    image_loader=lambda _path: np.zeros((2, 2, 3), dtype=np.uint8),
                )

        self.assertEqual(proof["learningBank"], "NONE")
        self.assertEqual(proof["cornerShape"], "ROUNDED_3_18_MM")
        self.assertEqual(proof["cache"]["firstFrontArtifactCount"], 1)
        self.assertEqual(
            [(item["bytes"], item["sha256"]) for item in proof["corpus"]],
            [(item[2], item[3]) for item in FIXTURES],
        )
        self.assertEqual(set(proof["sideOutputSha256"]), {"FRONT", "BACK"})

    def test_proof_set_requires_three_identical_cold_attempts(self):
        base = {
            "semanticOutputSha256": "a" * 64,
            "sideOutputSha256": {"FRONT": "b" * 64, "BACK": "c" * 64},
            "defectCounts": {"FRONT": 0, "BACK": 0},
            "cache": {"initiallyEmpty": True, "firstFrontArtifactCount": 1},
            "runtime": fake_identity()["runtime"],
            "determinism": fake_identity()["determinism"],
            "model": fake_identity()["model"],
            "corpus": [],
            "cornerShape": "ROUNDED_3_18_MM",
            "learningBank": "NONE",
        }
        result = summarize_attempts([dict(base) for _ in range(REPETITIONS)])
        self.assertTrue(result["identical"])
        mismatch = [dict(base) for _ in range(REPETITIONS)]
        mismatch[-1] = {**base, "semanticOutputSha256": "d" * 64}
        with self.assertRaisesRegex(RuntimeError, "not identical"):
            summarize_attempts(mismatch)


if __name__ == "__main__":
    unittest.main()
