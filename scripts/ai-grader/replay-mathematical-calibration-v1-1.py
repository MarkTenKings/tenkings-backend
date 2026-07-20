"""Offline replay of the preserved failed V1.0.1 session.

The session is read-only validation input.  This script never writes to the
session and never creates/imports/finalizes a V1.1 session.
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

T_975_DF3 = 3.182446305284263


def rms(actual, expected):
    delta = actual.reshape(-1, 2) - expected.reshape(-1, 2)
    return float(np.sqrt(np.mean(np.sum(delta * delta, axis=1))))


def evaluate(items):
    object_points = np.zeros((11 * 16, 3), np.float32)
    object_points[:, :2] = np.mgrid[0:11, 0:16].T.reshape(-1, 2) * 5.0
    image_points = [item["corners"] for item in items]
    image_size = items[0]["image"].shape[::-1]
    values = []
    training = []
    for held_out in range(4):
        training_indices = [index for index in range(4) if index != held_out]
        fit, camera, distortion, _, _ = cv2.calibrateCamera(
            [object_points for _ in training_indices],
            [image_points[index] for index in training_indices],
            image_size,
            None,
            None,
            flags=cv2.CALIB_FIX_K3,
        )
        training.append(float(fit))
        solved, rotation, translation = cv2.solvePnP(
            object_points, image_points[held_out], camera, distortion, flags=cv2.SOLVEPNP_ITERATIVE
        )
        if not solved:
            return None
        projected, _ = cv2.projectPoints(object_points, rotation, translation, camera, distortion)
        values.append(rms(projected, image_points[held_out]))
    mean = sum(values) / 4
    sd = math.sqrt(sum((value - mean) ** 2 for value in values) / 3)
    return {
        "holdoutRmsPx": values,
        "trainingRmsPx": training,
        "holdoutMeanPx": mean,
        "holdoutSampleStandardDeviationPx": sd,
        "holdoutU95Px": T_975_DF3 * sd,
        "maxHoldoutRmsPx": max(values),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("session", type=Path)
    args = parser.parse_args()
    session_dir = args.session.resolve()
    state = json.loads((session_dir / "capture-session.json").read_text(encoding="utf-8"))
    if state.get("sealedAt") or state.get("sessionId") != "math-cal-v1-20260720-01":
        raise RuntimeError("Replay requires the preserved unsealed failed session math-cal-v1-20260720-01.")
    raw = [artifact for artifact in state["artifacts"] if artifact.get("artifactClass") == "raw_capture" and artifact.get("role") == "lens_geometry"]
    if len(raw) != 6:
        raise RuntimeError(f"Expected six preserved lens captures, found {len(raw)}.")
    detected = []
    for artifact in raw:
        image = cv2.imread(str(session_dir / artifact["path"]), cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise RuntimeError(f"Cannot read preserved evidence {artifact['evidenceId']}.")
        corners = None
        found, candidate = cv2.findChessboardCornersSB(image, (11, 16), 0)
        if found and candidate is not None:
            corners = candidate.astype(np.float32)
            detected.append({"evidenceId": artifact["evidenceId"], "image": image, "corners": corners, "pose": artifact.get("pose")})
    candidates = []
    for combo in itertools.combinations(detected, 4):
        fit = evaluate(combo)
        if fit:
            candidates.append((fit["holdoutU95Px"], fit["maxHoldoutRmsPx"], combo, fit))
    if not candidates:
        raise RuntimeError("No four-pose subset could produce deterministic LOO evidence.")
    candidates.sort(key=lambda item: (item[0], item[1], tuple(entry["evidenceId"] for entry in item[2])))
    _, _, best, fit = candidates[0]
    poses = [entry["pose"] for entry in best]
    result = {
        "sessionId": state["sessionId"],
        "sessionSha256": hashlib.sha256((session_dir / "capture-session.json").read_bytes()).hexdigest(),
        "validationOnly": True,
        "preservedLensCaptureCount": len(raw),
        "internalCheckerboardDetectionCount": len(detected),
        "testedFourPoseSubsetCount": len(candidates),
        "selectedEvidenceIds": [entry["evidenceId"] for entry in best],
        "poseDiversity": {
            "xSpan": max(pose["centerXFraction"] for pose in poses) - min(pose["centerXFraction"] for pose in poses),
            "ySpan": max(pose["centerYFraction"] for pose in poses) - min(pose["centerYFraction"] for pose in poses),
            "rotationSpan": max(pose["rotationDegrees"] for pose in poses) - min(pose["rotationDegrees"] for pose in poses),
            "minimumCoverage": min(pose["coverageFraction"] for pose in poses),
        },
        "leaveOnePoseOut": fit,
        "honestFourPoseSubsetMeetsDiversity": (
            max(pose["centerXFraction"] for pose in poses) - min(pose["centerXFraction"] for pose in poses) >= 0.07
            and max(pose["centerYFraction"] for pose in poses) - min(pose["centerYFraction"] for pose in poses) >= 0.08
            and max(pose["rotationDegrees"] for pose in poses) - min(pose["rotationDegrees"] for pose in poses) >= 2
            and min(pose["coverageFraction"] for pose in poses) >= 0.30
        ),
        "stableFitHoldoutU95Evidence": fit["holdoutU95Px"] < 0.5,
        "sourceWasImportedOrFinalized": False,
    }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
