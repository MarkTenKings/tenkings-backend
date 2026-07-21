"""Build a non-certified geometry-only camera model from preserved V1 evidence.

This recovery tool is deliberately separate from Mathematical Calibration V1/V1.1.
It never mutates a capture session, never creates a finalized calibration bundle,
and always emits ``isCalibrated: false``.  Its output may be used only for a
controlled, reversible comparison against the current Production normalizer.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np


SCHEMA_VERSION = "ten-kings-provisional-mathematical-geometry-v1"
EXPECTED_SESSION_ID = "math-cal-v1-20260720-01"
EXPECTED_SESSION_SHA256 = "0a240a2e0aa3a9f14c3b15365fc63141dae2f655e5597aa2226fa7c339b1970d"
EXPECTED_TARGET_SHA256 = "5cc1344fe02ea5346a77592540aa72882150278aa9a7705d6dcfe900893c81bd"
T_975_DF3 = 3.182446305284263


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rms(actual: np.ndarray, expected: np.ndarray) -> float:
    delta = actual.reshape(-1, 2) - expected.reshape(-1, 2)
    return float(np.sqrt(np.mean(np.sum(delta * delta, axis=1))))


def object_points(columns: int, rows: int, cell_mm: float) -> np.ndarray:
    points = np.zeros((columns * rows, 3), np.float32)
    points[:, :2] = np.mgrid[0:columns, 0:rows].T.reshape(-1, 2) * cell_mm
    return points


def fit_camera(items: list[dict], object_grid: np.ndarray) -> dict:
    image_size = items[0]["image"].shape[::-1]
    fit, camera, distortion, rotations, translations = cv2.calibrateCamera(
        [object_grid for _ in items],
        [item["corners"] for item in items],
        image_size,
        None,
        None,
        flags=cv2.CALIB_FIX_K3,
    )
    per_view = []
    for item, rotation, translation in zip(items, rotations, translations):
        projected, _ = cv2.projectPoints(object_grid, rotation, translation, camera, distortion)
        per_view.append(rms(projected, item["corners"]))
    return {
        "rms": float(fit),
        "camera": camera,
        "distortion": distortion,
        "perView": per_view,
        "imageSize": image_size,
    }


def evaluate_leave_one_out(items: list[dict], object_grid: np.ndarray) -> dict | None:
    holdout = []
    training = []
    for held_out in range(4):
        training_items = [item for index, item in enumerate(items) if index != held_out]
        fitted = fit_camera(training_items, object_grid)
        training.append(fitted["rms"])
        solved, rotation, translation = cv2.solvePnP(
            object_grid,
            items[held_out]["corners"],
            fitted["camera"],
            fitted["distortion"],
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not solved:
            return None
        projected, _ = cv2.projectPoints(
            object_grid,
            rotation,
            translation,
            fitted["camera"],
            fitted["distortion"],
        )
        holdout.append(rms(projected, items[held_out]["corners"]))
    mean = sum(holdout) / 4
    standard_deviation = math.sqrt(sum((value - mean) ** 2 for value in holdout) / 3)
    return {
        "holdoutRmsPx": holdout,
        "trainingRmsPx": training,
        "holdoutMeanPx": mean,
        "holdoutSampleStandardDeviationPx": standard_deviation,
        "holdoutU95Px": T_975_DF3 * standard_deviation,
        "maxHoldoutRmsPx": max(holdout),
    }


def planar_residual(points: np.ndarray, expected_xy: np.ndarray) -> float:
    transform, _ = cv2.findHomography(expected_xy, points.reshape(-1, 2), method=0)
    if transform is None:
        raise RuntimeError("Planar holdout homography could not be solved.")
    homogeneous = np.concatenate(
        [expected_xy.astype(np.float64), np.ones((expected_xy.shape[0], 1), np.float64)],
        axis=1,
    )
    projected = homogeneous @ transform.T
    projected = projected[:, :2] / projected[:, 2:3]
    return rms(projected.astype(np.float32), points)


def comparison(item: dict, fitted: dict, object_grid: np.ndarray) -> dict:
    expected_xy = object_grid[:, :2]
    raw = planar_residual(item["corners"], expected_xy)
    corrected = cv2.undistortPoints(
        item["corners"],
        fitted["camera"],
        fitted["distortion"],
        P=fitted["camera"],
    )
    corrected_residual = planar_residual(corrected.astype(np.float32), expected_xy)
    return {
        "evidenceId": item["evidenceId"],
        "rawPlanarResidualPx": raw,
        "correctedPlanarResidualPx": corrected_residual,
        "improvementPx": raw - corrected_residual,
        "improvementFraction": (raw - corrected_residual) / raw if raw > 0 else 0.0,
    }


def finite_list(values: np.ndarray) -> list[float]:
    flattened = [float(value) for value in values.reshape(-1)]
    if not all(math.isfinite(value) for value in flattened):
        raise RuntimeError("Provisional camera model contains a non-finite coefficient.")
    return flattened


def round_numbers(value):
    if isinstance(value, float):
        return round(value, 9)
    if isinstance(value, list):
        return [round_numbers(item) for item in value]
    if isinstance(value, dict):
        return {key: round_numbers(item) for key, item in value.items()}
    return value


def load_detected(session_dir: Path, state: dict) -> list[dict]:
    settings = state["protectedSettings"]
    columns = int(settings["checkerboard"]["internalColumns"])
    rows = int(settings["checkerboard"]["internalRows"])
    detected = []
    raw = [
        artifact
        for artifact in state["artifacts"]
        if artifact.get("artifactClass") == "raw_capture" and artifact.get("role") == "lens_geometry"
    ]
    if len(raw) != 6:
        raise RuntimeError(f"Expected six preserved lens captures, found {len(raw)}.")
    for artifact in raw:
        path = (session_dir / artifact["path"]).resolve()
        if session_dir not in path.parents:
            raise RuntimeError("Calibration evidence path escapes the preserved session.")
        if sha256(path) != artifact["sha256"]:
            raise RuntimeError(f"Calibration evidence hash mismatch: {artifact['evidenceId']}.")
        image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise RuntimeError(f"Cannot read preserved evidence {artifact['evidenceId']}.")
        found, corners = cv2.findChessboardCornersSB(image, (columns, rows), 0)
        if found and corners is not None and len(corners) == columns * rows:
            detected.append(
                {
                    "evidenceId": artifact["evidenceId"],
                    "path": artifact["path"],
                    "sha256": artifact["sha256"],
                    "image": image,
                    "corners": corners.astype(np.float32),
                    "pose": artifact["pose"],
                }
            )
    return detected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("session", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--operator-accepted-max-holdout-px", type=float, required=True)
    args = parser.parse_args()
    if not math.isfinite(args.operator_accepted_max_holdout_px) or args.operator_accepted_max_holdout_px <= 0:
        raise RuntimeError("Operator-accepted maximum holdout residual must be finite and positive.")

    session_dir = args.session.resolve()
    state_path = session_dir / "capture-session.json"
    state_bytes = state_path.read_bytes()
    state_sha256 = hashlib.sha256(state_bytes).hexdigest()
    state = json.loads(state_bytes)
    if state.get("sessionId") != EXPECTED_SESSION_ID or state.get("sealedAt"):
        raise RuntimeError(f"Recovery requires preserved unsealed session {EXPECTED_SESSION_ID}.")
    if state_sha256 != EXPECTED_SESSION_SHA256:
        raise RuntimeError("Preserved source-session hash does not match the reviewed recovery authority.")
    if state.get("subject", {}).get("targetSha256") != EXPECTED_TARGET_SHA256:
        raise RuntimeError("Preserved target hash does not match the reviewed recovery authority.")

    settings = state["protectedSettings"]
    columns = int(settings["checkerboard"]["internalColumns"])
    rows = int(settings["checkerboard"]["internalRows"])
    cell_mm = float(settings["checkerboard"]["cellMm"])
    grid = object_points(columns, rows, cell_mm)
    detected = load_detected(session_dir, state)
    if len(detected) < 5:
        raise RuntimeError(f"Expected at least five detected preserved views, found {len(detected)}.")

    candidates = []
    for selected in itertools.combinations(detected, 4):
        evaluation = evaluate_leave_one_out(list(selected), grid)
        if evaluation is not None:
            candidates.append((evaluation["holdoutU95Px"], evaluation["maxHoldoutRmsPx"], selected, evaluation))
    if not candidates:
        raise RuntimeError("No four-pose subset could produce deterministic provisional geometry evidence.")
    candidates.sort(key=lambda item: (item[0], item[1], tuple(entry["evidenceId"] for entry in item[2])))
    _, _, selected_tuple, leave_one_out = candidates[0]
    selected = list(selected_tuple)
    if leave_one_out["maxHoldoutRmsPx"] > args.operator_accepted_max_holdout_px:
        raise RuntimeError("Best preserved candidate exceeds the operator-accepted provisional holdout residual.")
    fitted = fit_camera(selected, grid)
    selected_ids = {item["evidenceId"] for item in selected}
    unused = [item for item in detected if item["evidenceId"] not in selected_ids]
    selected_comparisons = [comparison(item, fitted, grid) for item in selected]
    independent_comparisons = [comparison(item, fitted, grid) for item in unused]
    if not independent_comparisons:
        raise RuntimeError("Provisional geometry requires at least one preserved independent comparison view.")

    poses = [item["pose"] for item in selected]
    output = round_numbers(
        {
            "schemaVersion": SCHEMA_VERSION,
            "status": "provisional_geometry_only_operator_accepted_for_controlled_evaluation",
            "isCalibrated": False,
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "limitations": [
                "Not a finalized Mathematical Calibration V1 or V1.1 bundle.",
                "Geometry only; no photometric, color, segmentation, metrology, or repeatability calibration is claimed.",
                "May be used only in a reversible controlled Production comparison and must retain current normalization as rollback.",
            ],
            "operatorAcceptance": {
                "acceptedMaximumHoldoutResidualPx": args.operator_accepted_max_holdout_px,
                "certifiedV1MaximumHoldoutResidualPx": 0.5,
            },
            "source": {
                "sessionId": state["sessionId"],
                "sessionSha256": state_sha256,
                "targetVersion": state["subject"]["targetVersion"],
                "targetSha256": state["subject"]["targetSha256"],
                "rigId": settings["rigId"],
                "captureProfileVersion": settings["captureProfileVersion"],
                "camera": {
                    "serialNumber": "41934475",
                    "modelName": "a2A2448-23gmBAS",
                    "exposureUs": settings["exposureUs"],
                    "gain": settings["gain"],
                },
                "selectedEvidence": [
                    {"evidenceId": item["evidenceId"], "path": item["path"], "sha256": item["sha256"]}
                    for item in selected
                ],
            },
            "checkerboard": {"internalColumns": columns, "internalRows": rows, "cellMm": cell_mm},
            "image": {"widthPx": fitted["imageSize"][0], "heightPx": fitted["imageSize"][1]},
            "poseDiversity": {
                "xSpan": max(pose["centerXFraction"] for pose in poses) - min(pose["centerXFraction"] for pose in poses),
                "ySpan": max(pose["centerYFraction"] for pose in poses) - min(pose["centerYFraction"] for pose in poses),
                "rotationSpanDegrees": max(pose["rotationDegrees"] for pose in poses) - min(pose["rotationDegrees"] for pose in poses),
                "minimumCoverage": min(pose["coverageFraction"] for pose in poses),
            },
            "leaveOnePoseOut": leave_one_out,
            "model": {
                "kind": "opencv_pinhole_k1_k2_p1_p2_k3_fixed",
                "cameraMatrix": finite_list(fitted["camera"]),
                "distortionCoefficients": finite_list(fitted["distortion"]),
                "calibrationRmsPx": fitted["rms"],
                "perViewResidualPx": fitted["perView"],
            },
            "planarComparison": {
                "selectedViews": selected_comparisons,
                "independentPreservedViews": independent_comparisons,
                "allIndependentViewsImproved": all(item["improvementPx"] > 0 for item in independent_comparisons),
            },
        }
    )
    output_path = args.output.resolve()
    if output_path.exists():
        raise RuntimeError("Refusing to overwrite an existing provisional geometry artifact.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = (json.dumps(output, indent=2, sort_keys=True) + "\n").encode("utf-8")
    output_path.write_bytes(serialized)
    print(json.dumps({"output": str(output_path), "sha256": hashlib.sha256(serialized).hexdigest(), "result": output}, indent=2))


if __name__ == "__main__":
    main()
