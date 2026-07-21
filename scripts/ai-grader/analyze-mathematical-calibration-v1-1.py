"""Deterministic, hardware-free Mathematical Calibration V1.1 analyzer.

This consumes only a sealed V1.1 manifest/package.  It never copies evidence
into a session and never mutates the source package.  Four unique checkerboard
captures are used for geometry, holdout, segmentation-boundary, and repeated
placement derivations by reference only.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
from pathlib import Path

import cv2
import numpy as np

V1_1_MANIFEST_SCHEMA = "ten-kings-mathematical-calibration-capture-manifest-v1.1"
V1_1_PACKAGE_SCHEMA = "ten-kings-mathematical-calibration-capture-package-v1.1"
THRESHOLD_SET_ID = "ten-kings-mathematical-grading-v1.1.0"
THRESHOLD_SET_HASH = "d6e3e6772436544d4a434fc0a6f1e93150fb17507020097c8e9ec10af66dc989"
LOO_ALGORITHM = "fixed-rig-mathematical-calibration-v1.1-geometry-loo-u95"
T_975_DF3 = 3.182446305284263


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def rms(actual: np.ndarray, expected: np.ndarray) -> float:
    delta = actual.reshape(-1, 2) - expected.reshape(-1, 2)
    return float(np.sqrt(np.mean(np.sum(delta * delta, axis=1))))


def detect(gray: np.ndarray, columns: int, rows: int) -> np.ndarray:
    flags = cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY | cv2.CALIB_CB_NORMALIZE_IMAGE
    found, corners = cv2.findChessboardCornersSB(gray, (columns, rows), flags)
    if not found or corners is None:
        found, corners = cv2.findChessboardCorners(
            gray, (columns, rows),
            cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE,
        )
    if not found or corners is None or len(corners) != columns * rows:
        raise RuntimeError("V1.1 checkerboard detection failed closed for one immutable placement.")
    points = corners.astype(np.float32)
    height, width = gray.shape[:2]
    if not np.isfinite(points).all() or np.any(points[:, 0, 0] < 0) or np.any(points[:, 0, 0] >= width) or np.any(points[:, 0, 1] < 0) or np.any(points[:, 0, 1] >= height):
        raise RuntimeError("V1.1 checkerboard detector produced non-finite or out-of-frame corners.")
    return points


def leave_one_pose_out(images, object_points):
    image_points = [item["corners"] for item in images]
    image_size = images[0]["gray"].shape[::-1]
    holdout = []
    training_rms = []
    for held_out in range(4):
        training_indices = [index for index in range(4) if index != held_out]
        rms_fit, camera, distortion, rotations, translations = cv2.calibrateCamera(
            [object_points for _ in training_indices],
            [image_points[index] for index in training_indices],
            image_size,
            None,
            None,
            flags=cv2.CALIB_FIX_K3,
        )
        training_rms.append(float(rms_fit))
        solved, rotation, translation = cv2.solvePnP(
            object_points,
            image_points[held_out],
            camera,
            distortion,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not solved:
            raise RuntimeError("V1.1 leave-one-pose-out solvePnP failed closed.")
        projected, _ = cv2.projectPoints(object_points, rotation, translation, camera, distortion)
        holdout.append(rms(projected, image_points[held_out]))
    mean = sum(holdout) / 4
    sample_sd = math.sqrt(sum((value - mean) ** 2 for value in holdout) / 3)
    return {
        "holdoutRmsPx": holdout,
        "trainingRmsPx": training_rms,
        "holdoutMeanPx": mean,
        "holdoutSampleStandardDeviationPx": sample_sd,
        "holdoutU95Px": T_975_DF3 * sample_sd,
        "maxHoldoutRmsPx": max(holdout),
    }


def analyze(manifest_path: Path):
    manifest = read_json(manifest_path)
    if manifest.get("schemaVersion") != V1_1_MANIFEST_SCHEMA:
        raise RuntimeError("The analyzer accepts only the V1.1 capture-manifest schema.")
    package_ref = manifest.get("sourceCapturePackage") or {}
    package_path = (manifest_path.parent / package_ref["path"]).resolve()
    package_bytes = package_path.read_bytes()
    if package_ref.get("sha256") != sha256_bytes(package_bytes):
        raise RuntimeError("Source capture package SHA-256 does not match the sealed manifest.")
    package = json.loads(package_bytes.decode("utf-8"))
    if package.get("schemaVersion") != V1_1_PACKAGE_SCHEMA:
        raise RuntimeError("The source package is not the exact V1.1 package schema.")
    if package.get("thresholdSetId") != THRESHOLD_SET_ID or package.get("thresholdSetHash") != THRESHOLD_SET_HASH:
        raise RuntimeError("V1.1 threshold identity/hash mismatch.")
    artifacts = {entry["evidenceId"]: entry for entry in package.get("artifacts", [])}
    pose_ids = [entry["evidenceId"] for entry in manifest.get("geometryViews", [])]
    if len(pose_ids) != 4 or len(set(pose_ids)) != 4:
        raise RuntimeError("V1.1 requires exactly four unique geometry evidence references.")
    for field in ("normalizationViews", "normalizationHoldoutViews", "segmentationBoundaryViews", "repeatedPlacementDerivations", "placementViews"):
        ids = [entry["evidenceId"] for entry in manifest.get(field, [])]
        if ids != pose_ids:
            raise RuntimeError(f"{field} must reference the exact four immutable placement captures without duplication.")
    if manifest.get("blankReverseFlip", {}).get("count") != 1:
        raise RuntimeError("V1.1 requires exactly one blank-reverse flip.")
    for channel in manifest.get("flatFieldChannels", []):
        if not all(len(channel.get(field, [])) == 3 for field in ("frames", "darkFrames", "illuminationPatternFrames")):
            raise RuntimeError("Each of eight channels requires exactly 3 flat, 3 dark, and 3 pattern frames.")

    poses = [artifacts[evidence_id].get("pose") for evidence_id in pose_ids]
    if any(pose is None for pose in poses):
        raise RuntimeError("Every V1.1 placement must carry immutable pose provenance.")
    spans = {
        "x": max(pose["centerXFraction"] for pose in poses) - min(pose["centerXFraction"] for pose in poses),
        "y": max(pose["centerYFraction"] for pose in poses) - min(pose["centerYFraction"] for pose in poses),
        "rotation": max(pose["rotationDegrees"] for pose in poses) - min(pose["rotationDegrees"] for pose in poses),
    }
    coverage = [pose["coverageFraction"] for pose in poses]
    reasons = []
    if spans["x"] < 0.07 or spans["y"] < 0.08 or spans["rotation"] < 2:
        reasons.append("four-pose diversity is below the frozen V1.0.1 minima")
    if min(coverage) < 0.30:
        reasons.append("placement coverage is below 0.30")

    images = []
    for evidence_id in pose_ids:
        artifact = artifacts[evidence_id]
        image_path = (manifest_path.parent / artifact["path"]).resolve()
        raw = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
        if raw is None:
            raise RuntimeError(f"Unable to read immutable placement evidence {evidence_id}.")
        images.append({"gray": raw, "corners": detect(raw, 11, 16)})
    object_points = np.zeros((11 * 16, 3), np.float32)
    object_points[:, :2] = np.mgrid[0:11, 0:16].T.reshape(-1, 2) * 5.0
    loo = leave_one_pose_out(images, object_points)
    if loo["maxHoldoutRmsPx"] > 0.5 or loo["holdoutU95Px"] > 0.5:
        reasons.append("leave-one-pose-out residual/U95 exceeds the retained 0.5 px lens limit")
    return {
        "schemaVersion": "ten-kings-mathematical-calibration-analysis-v1.1",
        "contractVersion": "1.1.0",
        "algorithmVersion": LOO_ALGORITHM,
        "thresholdSetId": THRESHOLD_SET_ID,
        "thresholdSetHash": THRESHOLD_SET_HASH,
        "sourceCaptureManifest": {"path": str(manifest_path), "sha256": sha256_bytes(manifest_path.read_bytes())},
        "captureCounts": {"checkerboardPlacements": 4, "flatField": 24, "darkControl": 24, "illuminationPattern": 24, "totalImageCaptures": 76},
        "poseDiversity": {"spans": spans, "minimumCoverageFraction": min(coverage)},
        "leaveOnePoseOut": loo,
        "acceptance": {"accepted": not reasons, "reasons": reasons},
        "validationOnly": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    result = analyze(args.manifest.resolve())
    encoded = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.resolve().write_text(encoded, encoding="utf-8", newline="\n")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
