"""Apply a reviewed provisional geometry model to one immutable image copy."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np


SCHEMA_VERSION = "ten-kings-provisional-mathematical-geometry-v1"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--artifact-sha256", required=True)
    args = parser.parse_args()

    artifact_path = args.artifact.resolve()
    source_path = args.source.resolve()
    output_path = args.output.resolve()
    expected_artifact_sha256 = args.artifact_sha256.lower()
    if len(expected_artifact_sha256) != 64 or any(character not in "0123456789abcdef" for character in expected_artifact_sha256):
        raise RuntimeError("Expected artifact SHA-256 is invalid.")
    actual_artifact_sha256 = sha256(artifact_path)
    if actual_artifact_sha256 != expected_artifact_sha256:
        raise RuntimeError("Provisional geometry artifact SHA-256 mismatch.")
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    if artifact.get("schemaVersion") != SCHEMA_VERSION or artifact.get("isCalibrated") is not False:
        raise RuntimeError("Input is not an explicitly non-certified provisional geometry artifact.")
    if artifact.get("planarComparison", {}).get("allIndependentViewsImproved") is not True:
        raise RuntimeError("Provisional geometry artifact lacks an improving independent comparison.")

    model = artifact.get("model", {})
    camera_values = model.get("cameraMatrix")
    distortion_values = model.get("distortionCoefficients")
    if not isinstance(camera_values, list) or len(camera_values) != 9:
        raise RuntimeError("Provisional camera matrix is invalid.")
    if not isinstance(distortion_values, list) or not 4 <= len(distortion_values) <= 14:
        raise RuntimeError("Provisional distortion coefficients are invalid.")
    values = [float(value) for value in [*camera_values, *distortion_values]]
    if not all(math.isfinite(value) for value in values):
        raise RuntimeError("Provisional geometry coefficients must be finite.")

    image = cv2.imread(str(source_path), cv2.IMREAD_UNCHANGED)
    if image is None or image.size == 0:
        raise RuntimeError("Source image could not be decoded.")
    expected_width = int(artifact["image"]["widthPx"])
    expected_height = int(artifact["image"]["heightPx"])
    if image.shape[1] != expected_width or image.shape[0] != expected_height:
        raise RuntimeError("Source dimensions do not match the provisional geometry model.")
    if output_path.exists():
        raise RuntimeError("Refusing to overwrite an existing provisional derivative.")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    camera = np.asarray(camera_values, dtype=np.float64).reshape(3, 3)
    distortion = np.asarray(distortion_values, dtype=np.float64)
    corrected = cv2.undistort(image, camera, distortion, None, camera)
    if not cv2.imwrite(str(output_path), corrected, [cv2.IMWRITE_PNG_COMPRESSION, 6]):
        raise RuntimeError("Provisional derivative could not be written.")
    print(
        json.dumps(
            {
                "schemaVersion": "ten-kings-provisional-geometry-derivative-v1",
                "isCalibrated": False,
                "artifactSha256": actual_artifact_sha256,
                "sourcePath": str(source_path),
                "sourceSha256": sha256(source_path),
                "outputPath": str(output_path),
                "outputSha256": sha256(output_path),
                "widthPx": corrected.shape[1],
                "heightPx": corrected.shape[0],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
