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


def _valid_internal_corners(corners: np.ndarray, width: int, height: int) -> bool:
    return bool(
        corners.shape == (INTERNAL_ROWS * INTERNAL_COLUMNS, 1, 2)
        and np.isfinite(corners).all()
        and all(_finite_in_frame(point[0], width, height) for point in corners)
    )


def derive_outer_corners(grid: np.ndarray, width: int, height: int) -> list[dict[str, float]]:
    """Extrapolate one half-cell from each detected boundary corner.

    Preserve OpenCV's semantic grid order. The first two points are the two
    corners on the first detected grid row, followed by the corresponding
    corners on the last detected row. Reordering these points geometrically
    can silently rotate the pose by 90 degrees.
    """
    raw = [
        grid[0, 0] - 0.5 * (grid[0, 1] - grid[0, 0]) - 0.5 * (grid[1, 0] - grid[0, 0]),
        grid[0, -1] + 0.5 * (grid[0, -1] - grid[0, -2]) - 0.5 * (grid[1, -1] - grid[0, -1]),
        grid[-1, -1] + 0.5 * (grid[-1, -1] - grid[-1, -2]) + 0.5 * (grid[-1, -1] - grid[-2, -1]),
        grid[-1, 0] - 0.5 * (grid[-1, 1] - grid[-1, 0]) + 0.5 * (grid[-1, 0] - grid[-2, 0]),
    ]
    if not all(_finite_in_frame(point, width, height) for point in raw):
        raise RuntimeError("checkerboard outer contour is missing or out of frame")
    return [_point(point) for point in raw]


def _detect_internal_corners_sb(gray: np.ndarray) -> np.ndarray | None:
    flags = cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY | cv2.CALIB_CB_NORMALIZE_IMAGE
    found, detected = cv2.findChessboardCornersSB(gray, (INTERNAL_COLUMNS, INTERNAL_ROWS), flags)
    if not found or detected is None or not _valid_internal_corners(detected, gray.shape[1], gray.shape[0]):
        return None
    return detected.astype(np.float32)


def _detect_internal_corners_classic(gray: np.ndarray) -> np.ndarray | None:
    flags = cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE
    found, detected = cv2.findChessboardCorners(gray, (INTERNAL_COLUMNS, INTERNAL_ROWS), flags)
    if not found or detected is None or not _valid_internal_corners(detected, gray.shape[1], gray.shape[0]):
        return None
    return detected.astype(np.float32)


def _detect_internal_corners(gray: np.ndarray) -> tuple[np.ndarray, str] | None:
    detected = _detect_internal_corners_sb(gray)
    if detected is not None:
        return detected, "opencv_find_chessboard_corners_sb_v1"
    detected = _detect_internal_corners_classic(gray)
    if detected is not None:
        return detected, "opencv_find_chessboard_corners_classic_v1"
    return None


def _detect_with_local_contrast(gray: np.ndarray) -> tuple[np.ndarray, int, int, str] | None:
    """Retry SB on the high-contrast target ROI, preserving source coordinates.

    The live Basler frame can contain a large matte-card/background gradient and
    the target's rounded black border. SB is authoritative, but its frozen
    detector does not find this exact full-frame input until the border-defined
    target ROI is locally contrast-normalized. This does not use the
    Production/card detector and does not alter the detected geometry.
    """
    height, width = gray.shape[:2]
    for threshold in (40, 60, 80, 100, 120, 140):
        _, mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY_INV)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        x, y, roi_width, roi_height = cv2.boundingRect(contour)
        if roi_width * roi_height < width * height * 0.10:
            continue
        for inset_fraction in (0.0, 0.03, 0.04, 0.05):
            inset_x = round(roi_width * inset_fraction)
            inset_y = round(roi_height * inset_fraction)
            crop_x = x + inset_x
            crop_y = y + inset_y
            crop_width = roi_width - 2 * inset_x
            crop_height = roi_height - 2 * inset_y
            if crop_width <= 0 or crop_height <= 0:
                continue
            roi = cv2.equalizeHist(gray[crop_y:crop_y + crop_height, crop_x:crop_x + crop_width])
            detected = _detect_internal_corners(roi)
            if detected is not None:
                corners, method = detected
                corners[:, 0, 0] += crop_x
                corners[:, 0, 1] += crop_y
                return corners, crop_x, crop_y, method
    return None


def detect_outer_boundary(gray: np.ndarray, internal: np.ndarray) -> list[dict[str, float]]:
    """Return independently segmented target-boundary samples in sensor pixels."""
    height, width = gray.shape[:2]
    internal_polygon = cv2.convexHull(internal.reshape(-1, 2).astype(np.float32))
    internal_area = cv2.contourArea(internal_polygon)
    candidates: list[tuple[float, np.ndarray]] = []
    for threshold in range(24, 208, 8):
        _, mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY_INV)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if area <= internal_area * 1.05 or area >= width * height * 0.95:
                continue
            if all(cv2.pointPolygonTest(contour, tuple(map(float, point)), False) >= 0 for point in internal.reshape(-1, 2)[::11]):
                candidates.append((area, contour))
    if not candidates:
        raise RuntimeError("independent target outer-boundary segmentation failed closed")
    contour = min(candidates, key=lambda value: value[0])[1].reshape(-1, 2)
    if len(contour) < 8:
        raise RuntimeError("segmented target outer boundary has insufficient support")
    sample_count = min(256, len(contour))
    indices = np.linspace(0, len(contour) - 1, sample_count, dtype=np.int32)
    sampled = contour[indices].astype(np.float64)
    if not all(_finite_in_frame(point, width, height) for point in sampled):
        raise RuntimeError("segmented target outer boundary is non-finite or outside the sensor frame")
    return [_point(point) for point in sampled]


def detect_preview(encoded: bytes) -> dict:
    image = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None or image.size == 0:
        raise RuntimeError("calibration preview frame could not be decoded")
    height, width = image.shape[:2]
    detected_with_method = _detect_internal_corners(image)
    detector_method = None if detected_with_method is None else detected_with_method[1]
    detected = None if detected_with_method is None else detected_with_method[0]
    if detected is None:
        local = _detect_with_local_contrast(image)
        if local is None:
            raise RuntimeError("frozen 11x16 checkerboard detection failed closed")
        detected, _, _, detector_method = local
    if not _valid_internal_corners(detected, width, height):
        raise RuntimeError("checkerboard detector produced non-finite or out-of-frame internal corners")

    grid = detected.reshape(INTERNAL_ROWS, INTERNAL_COLUMNS, 2).astype(np.float64)
    outer = derive_outer_corners(grid, width, height)

    rotation = math.degrees(math.atan2(outer[1]["y"] - outer[0]["y"], outer[1]["x"] - outer[0]["x"]))
    if not math.isfinite(rotation):
        raise RuntimeError("checkerboard rotation is not finite")
    segmentation_boundary = detect_outer_boundary(image, detected)
    return {
        "imageWidth": width,
        "imageHeight": height,
        "internalCorners": [_point(point) for point in grid.reshape(-1, 2)],
        "outerCorners": outer,
        "segmentationBoundary": segmentation_boundary,
        "rotationDegrees": rotation,
        "detectorMethod": detector_method,
    }


def main() -> None:
    try:
        print(json.dumps(detect_preview(sys.stdin.buffer.read()), separators=(",", ":")))
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
