"""Detect the frozen Mathematical Calibration V1.1 checkerboard in one frame.

This is intentionally a small bridge-facing adapter around the authoritative
OpenCV detector used by the offline V1.1 analyzer. It reads encoded image bytes
from stdin and emits one JSON result; failures exit non-zero so callers fail
closed.
"""

from __future__ import annotations

import json
import math
import sys

import cv2
import numpy as np

INTERNAL_COLUMNS = 11
INTERNAL_ROWS = 16


def _point(value: np.ndarray) -> dict[str, float]:
    return {"x": float(value[0]), "y": float(value[1])}


def _finite_in_frame(point: np.ndarray, width: int, height: int) -> bool:
    return bool(
        np.isfinite(point).all()
        and 0.0 <= float(point[0]) <= float(width - 1)
        and 0.0 <= float(point[1]) <= float(height - 1)
    )


def derive_outer_corners(grid: np.ndarray, width: int, height: int) -> list[dict[str, float]]:
    """Extrapolate one half-cell from each detected boundary corner.

    OpenCV may return the checkerboard grid in either orientation. Sort the
    four extrapolated points around their centroid so the bridge always emits
    a consistent clockwise contour for pose assessment.
    """
    raw = [
        grid[0, 0] - 0.5 * (grid[0, 1] - grid[0, 0]) - 0.5 * (grid[1, 0] - grid[0, 0]),
        grid[0, -1] + 0.5 * (grid[0, -1] - grid[0, -2]) - 0.5 * (grid[1, -1] - grid[0, -1]),
        grid[-1, -1] + 0.5 * (grid[-1, -1] - grid[-1, -2]) + 0.5 * (grid[-1, -1] - grid[-2, -1]),
        grid[-1, 0] - 0.5 * (grid[-1, 1] - grid[-1, 0]) + 0.5 * (grid[-1, 0] - grid[-2, 0]),
    ]
    center = sum(raw) / len(raw)
    ordered = sorted(raw, key=lambda point: math.atan2(float(point[1] - center[1]), float(point[0] - center[0])))
    start = min(range(len(ordered)), key=lambda index: (float(ordered[index][1]), float(ordered[index][0])))
    ordered = ordered[start:] + ordered[:start]
    if not all(_finite_in_frame(point, width, height) for point in ordered):
        raise RuntimeError("checkerboard outer contour is missing or out of frame")
    return [_point(point) for point in ordered]


def detect_preview(encoded: bytes) -> dict:
    image = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None or image.size == 0:
        raise RuntimeError("calibration preview frame could not be decoded")
    height, width = image.shape[:2]
    flags = cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY | cv2.CALIB_CB_NORMALIZE_IMAGE
    found, detected = cv2.findChessboardCornersSB(image, (INTERNAL_COLUMNS, INTERNAL_ROWS), flags)
    if not found or detected is None or detected.shape[0] != INTERNAL_COLUMNS * INTERNAL_ROWS:
        raise RuntimeError("frozen 11x16 checkerboard detection failed closed")

    grid = detected.reshape(INTERNAL_ROWS, INTERNAL_COLUMNS, 2).astype(np.float64)
    outer = derive_outer_corners(grid, width, height)

    rotation = math.degrees(math.atan2(outer[1]["y"] - outer[0]["y"], outer[1]["x"] - outer[0]["x"]))
    if not math.isfinite(rotation):
        raise RuntimeError("checkerboard rotation is not finite")
    return {
        "imageWidth": width,
        "imageHeight": height,
        "internalCorners": [_point(point) for point in grid.reshape(-1, 2)],
        "outerCorners": outer,
        "rotationDegrees": rotation,
    }


def main() -> None:
    try:
        print(json.dumps(detect_preview(sys.stdin.buffer.read()), separators=(",", ":")))
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
