"""Cold-cache, side-effect-free real-GPU proof for the exact Speedster image."""

import hashlib
import json
import os
from pathlib import Path

import cv2

from sam3_detector import detect_views


FIXTURES = (
    (
        "FRONT",
        "test-fixtures/geometry/cubone-front.jpg",
        4_239_023,
        "d2136a44fb8504727a48325282b573cf10c73a79b890be0db1b69f744840cd56",
    ),
    (
        "BACK",
        "test-fixtures/geometry/cubone-back.jpg",
        3_524_550,
        "fa71097ee566bed76efab30543fbdacfc84e6d9c0a0ab3552b4e251b1cbe2338",
    ),
)
CORNER_SHAPE = "ROUNDED_3_18_MM"
EXPECTED_LOCALIZED_CANDIDATES_PER_SIDE = 8


def _canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _empty_cache_path(environment_name: str) -> Path:
    directory = os.environ.get(environment_name, "").strip()
    if not directory:
        raise RuntimeError(f"{environment_name} is required for cold-cache proof")
    path = Path(directory)
    if not path.is_dir() or any(path.iterdir()):
        raise RuntimeError(f"{environment_name} must exist and be empty")
    return path


def _cache_artifact_count(cache_paths: tuple[Path, ...]) -> int:
    return sum(
        1
        for cache_path in cache_paths
        for candidate in cache_path.rglob("*")
        if candidate.is_file()
    )


def run_probe(detect=detect_views, image_loader=cv2.imread) -> dict:
    cache_paths = (
        _empty_cache_path("TORCHINDUCTOR_CACHE_DIR"),
        _empty_cache_path("TRITON_CACHE_DIR"),
    )

    semantic_results = []
    fixture_identity = []
    detector_identity = None
    first_front_cache_artifact_count = None
    for side, relative_path, expected_bytes, expected_sha256 in FIXTURES:
        fixture_path = Path(__file__).parent / relative_path
        payload = fixture_path.read_bytes()
        actual_sha256 = hashlib.sha256(payload).hexdigest()
        if len(payload) != expected_bytes or actual_sha256 != expected_sha256:
            raise RuntimeError(f"Known-corpus fixture identity drifted: {relative_path}")
        image = image_loader(str(fixture_path))
        if image is None:
            raise RuntimeError(f"Known-corpus fixture cannot be read: {relative_path}")
        result = detect(
            [(f"known-corpus-{side.lower()}", image)],
            side,
            CORNER_SHAPE,
            learning_bank=None,
            session_id="synthetic-known-corpus-only",
            trace_id=f"synthetic-known-corpus:{side}:cold-cache",
        )
        identity = result.get("detectorIdentity")
        if not isinstance(identity, dict):
            raise RuntimeError("Detector identity is missing from known-corpus proof")
        if detector_identity is None:
            detector_identity = identity
        instrumentation = result["instrumentation"]
        if (
            instrumentation["localizedCandidateCount"]
            != EXPECTED_LOCALIZED_CANDIDATES_PER_SIDE
        ):
            raise RuntimeError(
                f"Known-corpus {side} did not exercise exactly "
                f"{EXPECTED_LOCALIZED_CANDIDATES_PER_SIDE} geometric prompts"
            )
        stable_instrumentation = {
            "views": [
                {
                    "viewId": view["viewId"],
                    "candidateCount": view["candidateCount"],
                }
                for view in instrumentation["views"]
            ],
            "localizedCandidateCount": instrumentation["localizedCandidateCount"],
            "scannedCandidateCount": instrumentation["scannedCandidateCount"],
            "cappedCandidateCount": instrumentation["cappedCandidateCount"],
            "measuredRegionCount": instrumentation["measuredRegionCount"],
            "rawCandidateEvidenceCount": instrumentation[
                "rawCandidateEvidenceCount"
            ],
            "memoryDecisionEvidenceCount": instrumentation[
                "memoryDecisionEvidenceCount"
            ],
        }
        semantic_results.append(
            {
                "side": side,
                "detectorVersion": result["detectorVersion"],
                "defects": result["defects"],
                "detectorEvidence": result["detectorEvidence"],
                "instrumentation": stable_instrumentation,
            }
        )
        fixture_identity.append(
            {
                "side": side,
                "path": relative_path,
                "bytes": expected_bytes,
                "sha256": expected_sha256,
            }
        )
        if side == "FRONT":
            first_front_cache_artifact_count = _cache_artifact_count(cache_paths)
            if first_front_cache_artifact_count < 1:
                raise RuntimeError(
                    "Cold Front prompt produced no TorchInductor/Triton cache artifact"
                )

    runtime = detector_identity["runtime"]
    return {
        "version": "speedster-known-corpus-gpu-proof-v1",
        "corpus": fixture_identity,
        "cornerShape": CORNER_SHAPE,
        "learningBank": "NONE",
        "syntheticSessionId": "synthetic-known-corpus-only",
        "tracePattern": "synthetic-known-corpus:<SIDE>:cold-cache",
        "cache": {
            "initiallyEmpty": True,
            "firstFrontArtifactCount": first_front_cache_artifact_count,
            "finalArtifactCount": _cache_artifact_count(cache_paths),
        },
        "semanticOutputSha256": _canonical_sha256(semantic_results),
        "sideOutputSha256": {
            result["side"]: _canonical_sha256(result) for result in semantic_results
        },
        "defectCounts": {
            result["side"]: len(result["defects"]) for result in semantic_results
        },
        "runtime": {
            "ociDigest": runtime["ociDigest"],
            "buildId": runtime["buildId"],
            "gpuName": runtime["gpuName"],
            "gpuCapability": runtime["gpuCapability"],
            "torchVersion": runtime["torchVersion"],
            "cudaVersion": runtime["cudaVersion"],
            "compiler": runtime["compiler"],
        },
        "determinism": detector_identity["determinism"],
        "model": detector_identity["model"],
    }


def main() -> None:
    proof = run_probe()
    print(json.dumps(proof, allow_nan=False, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
