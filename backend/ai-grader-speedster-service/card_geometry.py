"""Lean deterministic geometry and localized defect proposals for Speedster."""

from dataclasses import dataclass
from itertools import combinations
from typing import Optional

import cv2
import numpy as np

from defect_math import (
    CARD_HEIGHT_MM,
    CARD_WIDTH_MM,
    GRID_HEIGHT,
    GRID_WIDTH,
    material_mask,
)


EXPECTED_ASPECT = CARD_WIDTH_MM / CARD_HEIGHT_MM
ASPECT_RANK_SCALE = 0.08
FILL_RANK_TARGET = 0.93
WORKING_LONG_SIDE_PX = 1000
PX_PER_MM = GRID_WIDTH / CARD_WIDTH_MM
INSPECTION_MARGIN_MM = 2.0
INSPECTION_MARGIN_PX = round(INSPECTION_MARGIN_MM * PX_PER_MM)
INSPECTION_WIDTH = GRID_WIDTH + 2 * INSPECTION_MARGIN_PX
INSPECTION_HEIGHT = GRID_HEIGHT + 2 * INSPECTION_MARGIN_PX
MAX_BORDER_SEARCH_MM = 12.0
MIN_DEFECT_AREA_MM2 = 0.02
MAX_CANDIDATE_AREA_MM2 = 8.0
MAX_CANDIDATE_BOX_AREA_MM2 = 20.0
MAX_CANDIDATE_DIMENSION_MM = 10.0
ANOMALY_KERNEL_SIZE = 15
EXPECTED_BOUNDARY_RESPONSE_PX = ANOMALY_KERNEL_SIZE // 2

MAP_REGISTRATION_ALGORITHM_VERSION = "opencv-redundant-ransac-registration-v2"
MAP_REGISTRATION_POLICY_VERSION = "speedster-map-registration-acceptance-v2"
MAP_REGISTRATION_PATCH_RADIUS_PX = 52
MAP_REGISTRATION_MAX_FEATURES_PER_ANCHOR = 18
MAP_REGISTRATION_MIN_FEATURES_PER_ANCHOR = 3
MAP_REGISTRATION_MIN_INLIERS_PER_ANCHOR = 2
MAP_REGISTRATION_MIN_FEATURE_SCORE = 0.20
MAP_REGISTRATION_MIN_ANCHOR_SCORE = 0.25
MAP_REGISTRATION_MIN_INLIERS = 10
MAP_REGISTRATION_MIN_INLIER_FRACTION = 0.65
MAP_REGISTRATION_MAX_MEDIAN_REPROJECTION_ERROR_PX = 2.0
MAP_REGISTRATION_MAX_REPROJECTION_ERROR_PX = 5.0
MAP_REGISTRATION_RANSAC_THRESHOLD_PX = 3.0
MAP_REGISTRATION_MAX_CANDIDATES = 4
MAP_REGISTRATION_MAX_DIAGNOSTIC_FEATURES = 72
MAP_REGISTRATION_GEOMETRY_EPSILON = 1e-6


class MapRegistrationFailure(ValueError):
    """Bounded, operator-safe registration failure with no applicable transform."""

    def __init__(self, message: str, diagnostics: dict):
        super().__init__(message)
        self.diagnostics = diagnostics


class _AcceptanceGateFailure(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class _RegistrationCandidate:
    candidate_id: str
    provenance: str
    reference: np.ndarray
    anchors: list[dict]
    source_homography: np.ndarray


def order_corners(points: np.ndarray) -> np.ndarray:
    """Order four visual points TL, TR, BR, BL."""
    points = np.asarray(points, dtype=np.float32)
    coordinate_sum = points.sum(axis=1)
    coordinate_difference = np.diff(points, axis=1).reshape(-1)
    return np.array(
        [
            points[np.argmin(coordinate_sum)],
            points[np.argmin(coordinate_difference)],
            points[np.argmax(coordinate_sum)],
            points[np.argmax(coordinate_difference)],
        ],
        dtype=np.float32,
    )


def _working_image(image: np.ndarray) -> tuple[np.ndarray, float]:
    scale = min(1.0, WORKING_LONG_SIDE_PX / max(image.shape[:2]))
    if scale == 1.0:
        return image, scale
    return cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), scale


def _material_boundary(image: np.ndarray) -> np.ndarray:
    """Return the card/background ownership boundary from frame-border color."""
    height, width = image.shape[:2]
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    band = max(3, round(min(height, width) * 0.025))
    samples = np.concatenate(
        (
            lab[:band].reshape(-1, 3),
            lab[-band:].reshape(-1, 3),
            lab[:, :band].reshape(-1, 3),
            lab[:, -band:].reshape(-1, 3),
        )
    )
    background = np.median(samples, axis=0)
    difference = np.linalg.norm(lab - background, axis=2)
    difference_u8 = np.uint8(np.clip(difference, 0, 255))
    otsu, _ = cv2.threshold(
        difference_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )
    material = np.uint8(difference > max(12.0, float(otsu))) * 255
    kernel_size = max(5, round(min(height, width) * 0.012))
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)
    )
    material = cv2.morphologyEx(material, cv2.MORPH_CLOSE, kernel, iterations=2)
    material = cv2.morphologyEx(
        material,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
    )
    return cv2.morphologyEx(
        material, cv2.MORPH_GRADIENT, np.ones((3, 3), dtype=np.uint8)
    )


def _candidate_contours(image: np.ndarray) -> list[np.ndarray]:
    gray = cv2.GaussianBlur(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    median = float(np.median(gray))
    low = max(12, int(0.66 * median))
    high = max(low + 20, min(255, int(1.33 * median)))
    visual_edges = cv2.Canny(gray, low, high)
    contours = []
    for boundary in (visual_edges, _material_boundary(image)):
        boundary = cv2.dilate(boundary, np.ones((3, 3), dtype=np.uint8))
        found, _ = cv2.findContours(
            boundary, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE
        )
        contours.extend(found)
    return contours


def _side_line_corners(contour: np.ndarray, rectangle) -> np.ndarray:
    """Fit the straight middle of every side, then intersect virtual corners."""
    box = order_corners(cv2.boxPoints(rectangle))
    points = contour.reshape(-1, 2).astype(np.float32)
    lines = []
    for index in range(4):
        first, second = box[index], box[(index + 1) % 4]
        side = second - first
        length = float(np.linalg.norm(side))
        if length <= 0:
            return box
        unit = side / length
        normal = np.array([-unit[1], unit[0]], dtype=np.float32)
        relative = points - first
        along = relative @ unit
        distance = np.abs(relative @ normal)
        selected = points[
            (along > 0.15 * length)
            & (along < 0.85 * length)
            & (distance < 0.03 * length + 5.0)
        ]
        if len(selected) < 10:
            selected = points[
                (along > 0) & (along < length) & (distance < 0.05 * length + 8.0)
            ]
        if len(selected) < 2:
            return box
        vx, vy, x0, y0 = cv2.fitLine(
            selected, cv2.DIST_HUBER, 0, 0.01, 0.01
        ).flatten()
        lines.append((float(x0), float(y0), float(vx), float(vy)))

    corners = []
    for index in range(4):
        x1, y1, vx1, vy1 = lines[(index - 1) % 4]
        x2, y2, vx2, vy2 = lines[index]
        matrix = np.array([[vx1, -vx2], [vy1, -vy2]], dtype=np.float32)
        if abs(float(np.linalg.det(matrix))) < 1e-5:
            return box
        offset = np.array([x2 - x1, y2 - y1], dtype=np.float32)
        distance = np.linalg.solve(matrix, offset)[0]
        corners.append((x1 + distance * vx1, y1 + distance * vy1))
    return order_corners(np.array(corners, dtype=np.float32))


def _portraitize(corners: np.ndarray) -> np.ndarray:
    if np.linalg.norm(corners[1] - corners[0]) > np.linalg.norm(
        corners[3] - corners[0]
    ):
        return np.roll(corners, -1, axis=0)
    return corners


def ranked_card_quads(image: np.ndarray, limit: int = 4) -> list[tuple[float, np.ndarray]]:
    """Return distinct four-corner candidates in deterministic score order.

    Area, aspect, and rectangular fill rank proposals; they never discard a
    complete outline. The operator remains the authority for the displayed
    best candidate.
    """
    working, scale = _working_image(image)
    candidates: list[tuple[float, np.ndarray]] = []
    for contour in _candidate_contours(working):
        x, y, width, height = cv2.boundingRect(contour)
        if (
            x <= 0
            or y <= 0
            or x + width >= working.shape[1]
            or y + height >= working.shape[0]
        ):
            continue
        area = float(cv2.contourArea(contour))
        if area <= 1.0:
            continue
        rectangle = cv2.minAreaRect(contour)
        width, height = rectangle[1]
        if min(width, height) <= 0:
            continue
        aspect = min(width, height) / max(width, height)
        aspect_error = abs(aspect - EXPECTED_ASPECT)
        fill = area / (width * height)
        # These values order complete candidates only. They never veto one.
        # Keeping the established score shape preserves stable selection among
        # near-duplicate contours while low-quality outlines remain available
        # when they are the only complete result.
        aspect_quality = max(0.01, 1.0 - aspect_error / ASPECT_RANK_SCALE)
        fill_quality = max(0.01, min(1.0, fill / FILL_RANK_TARGET))
        score = (
            area
            * aspect_quality
            * fill_quality
        )
        corners = _portraitize(_side_line_corners(contour, rectangle))
        corners = corners / scale if scale < 1.0 else corners
        diagonal = float(np.linalg.norm(corners[2] - corners[0]))
        if diagonal <= 0:
            continue
        candidates.append((float(score), corners))
    candidates.sort(key=lambda item: item[0], reverse=True)
    distinct: list[tuple[float, np.ndarray]] = []
    for score, corners in candidates:
        diagonal = float(np.linalg.norm(corners[2] - corners[0]))
        duplicate = any(
            float(np.mean(np.linalg.norm(corners - existing, axis=1))) / diagonal < 0.012
            for _, existing in distinct
        )
        if not duplicate:
            distinct.append((score, corners))
        if len(distinct) >= max(1, limit):
            break
    return distinct


def validated_card_quad(corners: np.ndarray) -> np.ndarray:
    """Reject malformed perimeter evidence instead of asking OpenCV to guess a transform."""
    quad = np.asarray(corners, dtype=np.float32)
    if quad.shape != (4, 2) or not np.all(np.isfinite(quad)):
        raise ValueError("Physical card geometry must contain four finite perimeter points")
    top_left, top_right, bottom_right, bottom_left = quad
    signed_double_area = float(
        np.dot(quad[:, 0], np.roll(quad[:, 1], -1))
        - np.dot(quad[:, 1], np.roll(quad[:, 0], -1))
    )
    if (
        not (top_left[1] < bottom_left[1] and top_right[1] < bottom_right[1])
        or not (top_left[0] < top_right[0] and bottom_left[0] < bottom_right[0])
        or signed_double_area <= 1.0
        or not cv2.isContourConvex(quad)
    ):
        raise ValueError(
            "Physical card geometry must be a non-collapsed convex perimeter in top-left, top-right, bottom-right, bottom-left order"
        )
    return quad


def warp_to_card_map(
    image: np.ndarray, corners: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    destination = np.array(
        [
            [0, 0],
            [GRID_WIDTH - 1, 0],
            [GRID_WIDTH - 1, GRID_HEIGHT - 1],
            [0, GRID_HEIGHT - 1],
        ],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(validated_card_quad(corners), destination)
    rectified = cv2.warpPerspective(image, transform, (GRID_WIDTH, GRID_HEIGHT))
    return rectified, transform


def warp_to_inspection_map(
    image: np.ndarray, corners: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Keep the physical card map exact while retaining 2 mm of photo context."""
    margin = INSPECTION_MARGIN_PX
    destination = np.array(
        [
            [margin, margin],
            [margin + GRID_WIDTH - 1, margin],
            [margin + GRID_WIDTH - 1, margin + GRID_HEIGHT - 1],
            [margin, margin + GRID_HEIGHT - 1],
        ],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(validated_card_quad(corners), destination)
    inspection = cv2.warpPerspective(
        image, transform, (INSPECTION_WIDTH, INSPECTION_HEIGHT)
    )
    return inspection, transform


def detector_material_mask(corner_shape: str, width: int, height: int) -> np.ndarray:
    canonical = material_mask(corner_shape)
    if (width, height) == (GRID_WIDTH, GRID_HEIGHT):
        return canonical
    if (width, height) != (INSPECTION_WIDTH, INSPECTION_HEIGHT):
        raise ValueError("Detector view has unsupported dimensions")
    allowed = np.zeros((height, width), dtype=np.uint8)
    margin = INSPECTION_MARGIN_PX
    allowed[margin : margin + GRID_HEIGHT, margin : margin + GRID_WIDTH] = canonical
    return allowed


def expected_material_boundary_response_mask(
    corner_shape: str, width: int, height: int
) -> np.ndarray:
    """Return only the expected inner cut response, including a 3.18 mm arc."""

    physical_material = detector_material_mask(corner_shape, width, height)
    distance_from_cut = material_distance_from_cut(physical_material)
    return np.uint8(
        (physical_material > 0)
        & (distance_from_cut <= EXPECTED_BOUNDARY_RESPONSE_PX)
    )


def material_distance_from_cut(physical_material: np.ndarray) -> np.ndarray:
    """Measure inward from every physical cut, including the image-frame edge."""

    material = (np.asarray(physical_material) > 0).astype(np.uint8)
    padded = cv2.copyMakeBorder(
        material, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0
    )
    return cv2.distanceTransform(padded, cv2.DIST_L2, 5)[1:-1, 1:-1]


def _boundary_aligned_response_mask(
    gray: np.ndarray, corner_shape: str
) -> np.ndarray:
    """Select cut-normal image response, preserving normal-crossing damage."""

    height, width = gray.shape
    material = detector_material_mask(corner_shape, width, height)
    distance_from_cut = material_distance_from_cut(material)
    normal_x = cv2.Sobel(distance_from_cut, cv2.CV_32F, 1, 0, ksize=3)
    normal_y = cv2.Sobel(distance_from_cut, cv2.CV_32F, 0, 1, ksize=3)
    response_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    response_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    normal_energy = np.abs(response_x * normal_x + response_y * normal_y)
    tangent_energy = np.abs(response_x * -normal_y + response_y * normal_x)
    has_geometry_normal = (np.abs(normal_x) + np.abs(normal_y)) > 0
    has_image_response = (np.abs(response_x) + np.abs(response_y)) > 0
    return (
        (material > 0)
        & (distance_from_cut <= EXPECTED_BOUNDARY_RESPONSE_PX)
        & has_geometry_normal
        & has_image_response
        & (normal_energy > tangent_energy)
    )


def detector_card_origin(width: int, height: int) -> tuple[int, int]:
    if (width, height) == (INSPECTION_WIDTH, INSPECTION_HEIGHT):
        return INSPECTION_MARGIN_PX, INSPECTION_MARGIN_PX
    if (width, height) == (GRID_WIDTH, GRID_HEIGHT):
        return 0, 0
    raise ValueError("Detector view has unsupported dimensions")


def crop_detector_mask_to_card(mask: np.ndarray) -> np.ndarray:
    binary = np.asarray(mask)
    if binary.shape == (GRID_HEIGHT, GRID_WIDTH):
        return binary
    if binary.shape != (INSPECTION_HEIGHT, INSPECTION_WIDTH):
        raise ValueError("Detector mask has unsupported dimensions")
    margin = INSPECTION_MARGIN_PX
    return binary[margin : margin + GRID_HEIGHT, margin : margin + GRID_WIDTH]


def _top_border_offset(
    gray: np.ndarray,
    search_mm: float = MAX_BORDER_SEARCH_MM,
    minimum_coverage: float = 0.50,
) -> Optional[float]:
    search_pixels = min(gray.shape[0], round(search_mm * PX_PER_MM))
    side_margin = max(1, round(gray.shape[1] * 0.04))
    band = gray[:search_pixels, side_margin:-side_margin].astype(np.float32)
    gradient = np.abs(cv2.Sobel(band, cv2.CV_32F, 0, 1, ksize=3))
    threshold = max(20.0, 0.5 * float(np.percentile(gradient, 90)))
    coverage = (gradient > threshold).mean(axis=1)
    score = gradient.mean(axis=1) * coverage
    score[coverage < minimum_coverage] = 0.0
    score[: max(1, round(1.0 * PX_PER_MM))] = 0.0
    index = int(np.argmax(score))
    return float(index / PX_PER_MM) if score[index] > 0 else None


def find_printed_border_offsets(image: np.ndarray) -> dict[str, Optional[float]]:
    """Use one continuous-line projection, rotated once for every side."""
    gray = cv2.GaussianBlur(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    offsets = {}
    for side in ("top", "right", "bottom", "left"):
        offsets[side] = _top_border_offset(gray)
        gray = np.ascontiguousarray(np.rot90(gray))
    return offsets


def _canonical_registration_image(image: np.ndarray) -> np.ndarray:
    """Return only the physical card grid from a canonical or inspection image."""

    height, width = image.shape[:2]
    if (width, height) == (GRID_WIDTH, GRID_HEIGHT):
        return image
    if (width, height) == (INSPECTION_WIDTH, INSPECTION_HEIGHT):
        margin = INSPECTION_MARGIN_PX
        return image[margin : margin + GRID_HEIGHT, margin : margin + GRID_WIDTH]
    raise ValueError("Map registration image is not a canonical Speedster card view")


def _unit_points(points: list[dict]) -> np.ndarray:
    parsed = np.array(
        [
            [float(point["x"]) * (GRID_WIDTH - 1), float(point["y"]) * (GRID_HEIGHT - 1)]
            for point in points
        ],
        dtype=np.float32,
    )
    if parsed.shape != (4, 2) or not np.isfinite(parsed).all():
        raise ValueError("Map registration requires exactly four finite human anchors")
    if (parsed < 0).any() or (parsed[:, 0] > GRID_WIDTH - 1).any() or (parsed[:, 1] > GRID_HEIGHT - 1).any():
        raise ValueError("Map registration anchors must use the normalized card grid")
    return parsed


def _project_unit_points(
    points: list[dict], homography: np.ndarray, *, require_in_card: bool = True
) -> list[dict]:
    pixels = np.array(
        [[float(point["x"]) * (GRID_WIDTH - 1), float(point["y"]) * (GRID_HEIGHT - 1)] for point in points],
        dtype=np.float32,
    ).reshape(-1, 1, 2)
    projected = cv2.perspectiveTransform(pixels, homography).reshape(-1, 2)
    if not np.isfinite(projected).all():
        raise ValueError("Map registration projected non-finite design geometry")
    if require_in_card and (
        (projected[:, 0] < -MAP_REGISTRATION_GEOMETRY_EPSILON).any()
        or (projected[:, 1] < -MAP_REGISTRATION_GEOMETRY_EPSILON).any()
        or (projected[:, 0] > GRID_WIDTH - 1 + MAP_REGISTRATION_GEOMETRY_EPSILON).any()
        or (projected[:, 1] > GRID_HEIGHT - 1 + MAP_REGISTRATION_GEOMETRY_EPSILON).any()
    ):
        raise ValueError("Map registration projected design geometry outside the current physical card")
    return [
        {
            "x": float(x / (GRID_WIDTH - 1)),
            "y": float(y / (GRID_HEIGHT - 1)),
        }
        for x, y in projected
    ]


def _normalized_diagnostic_point(point: np.ndarray) -> Optional[dict]:
    if point.shape != (2,) or not np.isfinite(point).all():
        return None
    return {
        "x": float(point[0] / (GRID_WIDTH - 1)),
        "y": float(point[1] / (GRID_HEIGHT - 1)),
    }


def _polygon_area(points: list[dict]) -> float:
    return abs(
        sum(
            points[index]["x"] * points[(index + 1) % len(points)]["y"]
            - points[(index + 1) % len(points)]["x"] * points[index]["y"]
            for index in range(len(points))
        )
    ) / 2.0


def _validate_projected_polygon(original: list[dict], projected: list[dict], label: str):
    if len(original) != len(projected) or len(projected) < 3:
        raise ValueError(f"{label} is malformed")
    original_area = _polygon_area(original)
    projected_area = _polygon_area(projected)
    if original_area <= MAP_REGISTRATION_GEOMETRY_EPSILON or projected_area <= MAP_REGISTRATION_GEOMETRY_EPSILON:
        raise ValueError(f"{label} is degenerate")
    area_ratio = projected_area / original_area
    if not 0.50 <= area_ratio <= 1.50:
        raise ValueError(f"{label} changes area incoherently")


def _project_design_geometry(
    design_boundary: dict, zones: list[dict], homography: np.ndarray
) -> tuple[dict, list[dict]]:
    kind = design_boundary.get("kind")
    if kind == "FULL_BLEED":
        projected_boundary = {"kind": "FULL_BLEED"}
    elif kind == "QUAD":
        boundary_points = design_boundary.get("points", [])
        projected_points = _project_unit_points(boundary_points, homography)
        _validate_projected_polygon(boundary_points, projected_points, "Projected design boundary")
        projected_boundary = {"kind": "QUAD", "points": projected_points}
    else:
        raise ValueError("Map design boundary is invalid")

    projected_zones = []
    for zone in zones:
        polygon = zone.get("polygon")
        if not isinstance(polygon, list) or len(polygon) < 3:
            raise ValueError("Map zone polygon is invalid")
        projected_polygon = _project_unit_points(polygon, homography)
        _validate_projected_polygon(polygon, projected_polygon, f"Projected map zone {zone.get('id', '')}")
        projected_zones.append(
            {
                "id": zone["id"],
                "label": zone["label"],
                "semanticType": zone["semanticType"],
                "polygon": projected_polygon,
            }
        )
    return projected_boundary, projected_zones


def _unit_homography(homography: np.ndarray) -> list[float]:
    scale = np.array(
        [[GRID_WIDTH - 1, 0, 0], [0, GRID_HEIGHT - 1, 0], [0, 0, 1]],
        dtype=np.float64,
    )
    unit = np.linalg.inv(scale) @ homography @ scale
    if not np.isfinite(unit).all() or abs(float(unit[2, 2])) < 1e-12:
        raise ValueError("Map registration transform is non-finite or singular")
    unit /= unit[2, 2]
    return unit.reshape(-1).tolist()


def _transform_is_coherent(homography: np.ndarray):
    if homography.shape != (3, 3) or not np.isfinite(homography).all():
        raise ValueError("Map registration transform is non-finite")
    normalized = homography / homography[2, 2] if abs(float(homography[2, 2])) >= 1e-12 else homography
    determinant = abs(float(np.linalg.det(normalized)))
    condition = float(np.linalg.cond(normalized))
    if determinant < 1e-8 or not np.isfinite(condition) or condition > 1e7:
        raise ValueError("Map registration transform is degenerate")


def _signed_triangle_area_twice(points: np.ndarray, indexes: tuple[int, int, int]) -> float:
    first, second, third = (points[index] for index in indexes)
    first_edge = second - first
    second_edge = third - first
    return float(first_edge[0] * second_edge[1] - first_edge[1] * second_edge[0])


def _require_matching_triangle_orientations(
    source: np.ndarray,
    projected: np.ndarray,
    *,
    label: str,
):
    if source.shape != projected.shape or source.ndim != 2 or source.shape[1] != 2:
        raise ValueError(f"Map registration {label} geometry is malformed")
    if len(source) < 3 or not np.isfinite(source).all() or not np.isfinite(projected).all():
        raise ValueError(f"Map registration {label} geometry is non-finite")

    source_span = np.ptp(source, axis=0)
    projected_span = np.ptp(projected, axis=0)
    source_epsilon = max(
        MAP_REGISTRATION_GEOMETRY_EPSILON,
        MAP_REGISTRATION_GEOMETRY_EPSILON * float(source_span[0] * source_span[1]),
    )
    projected_epsilon = max(
        MAP_REGISTRATION_GEOMETRY_EPSILON,
        MAP_REGISTRATION_GEOMETRY_EPSILON * float(projected_span[0] * projected_span[1]),
    )
    for indexes in combinations(range(len(source)), 3):
        source_orientation = _signed_triangle_area_twice(source, indexes)
        projected_orientation = _signed_triangle_area_twice(projected, indexes)
        if abs(source_orientation) <= source_epsilon:
            raise ValueError(f"Map registration source {label} triple is degenerate")
        if abs(projected_orientation) <= projected_epsilon:
            raise ValueError(f"Map registration projected {label} triple is degenerate")
        if np.signbit(source_orientation) != np.signbit(projected_orientation):
            raise ValueError(f"Map registration reverses {label} orientation")


def _project_without_card_bounds(points: np.ndarray, homography: np.ndarray) -> np.ndarray:
    homogeneous = np.column_stack((points, np.ones(len(points), dtype=np.float64)))
    transformed = (homography @ homogeneous.T).T
    denominators = transformed[:, 2]
    if not np.isfinite(transformed).all():
        raise ValueError("Map registration projected non-finite physical-card geometry")
    denominator_epsilon = max(
        1e-12,
        1e-10 * float(np.max(np.abs(denominators))),
    )
    if np.any(np.abs(denominators) <= denominator_epsilon):
        raise ValueError("Map registration projective pole touches the physical card")
    if not (np.all(denominators > 0) or np.all(denominators < 0)):
        raise ValueError("Map registration projective pole crosses the physical card")
    projected = transformed[:, :2] / denominators[:, np.newaxis]
    if not np.isfinite(projected).all():
        raise ValueError("Map registration projected non-finite physical-card geometry")
    return projected


def _validate_transform_orientation(
    homography: np.ndarray,
    source_anchor_points: np.ndarray,
) -> np.ndarray:
    """Reject reflections, crossed anchors, and projective folds over the card."""

    _transform_is_coherent(homography)
    card_corners = np.array(
        [
            [0.0, 0.0],
            [GRID_WIDTH - 1.0, 0.0],
            [GRID_WIDTH - 1.0, GRID_HEIGHT - 1.0],
            [0.0, GRID_HEIGHT - 1.0],
        ],
        dtype=np.float64,
    )
    projected_corners = _project_without_card_bounds(card_corners, homography)
    _require_matching_triangle_orientations(
        card_corners,
        projected_corners,
        label="physical-card corner",
    )
    projected_anchors = _project_without_card_bounds(
        np.asarray(source_anchor_points, dtype=np.float64),
        homography,
    )
    _require_matching_triangle_orientations(
        np.asarray(source_anchor_points, dtype=np.float64),
        projected_anchors,
        label="anchor",
    )
    return projected_anchors


def _validate_registration_result(
    *,
    mode: str,
    homography: np.ndarray,
    feature_count: int,
    usable_count: int,
    inlier_count: int,
    inlier_fraction: float,
    per_anchor_feature_counts: list[int],
    per_anchor_inlier_counts: list[int],
    per_anchor_scores: list[float],
    median_reprojection_error: float,
    max_reprojection_error: float,
    registration_anchors: list[dict],
    design_boundary: dict,
    zones: list[dict],
) -> tuple[dict, list[dict], dict]:
    """One server-owned acceptance validator for automatic, lesson, and human paths."""

    if mode == "AUTOMATIC_RANSAC":
        if any(count < MAP_REGISTRATION_MIN_FEATURES_PER_ANCHOR for count in per_anchor_feature_counts):
            raise _AcceptanceGateFailure("INSUFFICIENT_REDUNDANT_CORRESPONDENCES", "One or more anchors lack enough independently tracked image features.")
        if inlier_count < MAP_REGISTRATION_MIN_INLIERS:
            raise _AcceptanceGateFailure("INSUFFICIENT_RANSAC_INLIERS", "Registration did not retain enough RANSAC inliers.")
        if inlier_fraction < MAP_REGISTRATION_MIN_INLIER_FRACTION:
            raise _AcceptanceGateFailure("LOW_RANSAC_INLIER_FRACTION", "Registration inlier fraction is below policy.")
        if any(count < MAP_REGISTRATION_MIN_INLIERS_PER_ANCHOR for count in per_anchor_inlier_counts):
            raise _AcceptanceGateFailure("ANCHOR_REGION_NOT_SUPPORTED", "One or more anchor regions lack independent inlier support.")
        if any(score < MAP_REGISTRATION_MIN_ANCHOR_SCORE for score in per_anchor_scores):
            raise _AcceptanceGateFailure("LOW_ANCHOR_CONFIDENCE", "One or more anchor regions are below the registration confidence policy.")
    elif mode == "HUMAN_CONFIRMED":
        if feature_count != 4 or usable_count != 4 or inlier_count != 4 or per_anchor_inlier_counts != [1, 1, 1, 1]:
            raise _AcceptanceGateFailure("HUMAN_ANCHOR_SET_INVALID", "Human rescue requires four independently confirmed anchors.")
    else:
        raise _AcceptanceGateFailure("ACCEPTANCE_MODE_INVALID", "Registration acceptance mode is invalid.")
    if (
        not np.isfinite(inlier_fraction)
        or not np.isfinite(median_reprojection_error)
        or not np.isfinite(max_reprojection_error)
        or median_reprojection_error < 0
        or max_reprojection_error < median_reprojection_error
        or median_reprojection_error > MAP_REGISTRATION_MAX_MEDIAN_REPROJECTION_ERROR_PX
        or max_reprojection_error > MAP_REGISTRATION_MAX_REPROJECTION_ERROR_PX
    ):
        raise _AcceptanceGateFailure("REPROJECTION_ERROR_EXCEEDED", "Registration reprojection error exceeds policy.")
    try:
        source_anchor_points = _unit_points(
            [anchor["point"] for anchor in registration_anchors]
        )
        _validate_transform_orientation(homography, source_anchor_points)
        _project_unit_points(
            [anchor["point"] for anchor in registration_anchors],
            homography,
        )
        projected_boundary, projected_zones = _project_design_geometry(design_boundary, zones, homography)
    except ValueError as error:
        raise _AcceptanceGateFailure("PROJECTED_GEOMETRY_REJECTED", str(error)) from error
    return projected_boundary, projected_zones, {
        "policyVersion": MAP_REGISTRATION_POLICY_VERSION,
        "mode": mode,
        "featureCount": feature_count,
        "usableFeatureCount": usable_count,
        "inlierCount": inlier_count,
        "inlierFraction": inlier_fraction,
        "perAnchorFeatureCounts": per_anchor_feature_counts,
        "perAnchorInlierCounts": per_anchor_inlier_counts,
        "medianReprojectionErrorPx": median_reprojection_error,
        "maxReprojectionErrorPx": max_reprojection_error,
    }


def _track_points(reference_gray: np.ndarray, current_gray: np.ndarray, points: np.ndarray):
    located, forward_status, forward_error = cv2.calcOpticalFlowPyrLK(
        reference_gray,
        current_gray,
        points.reshape(-1, 1, 2).astype(np.float32),
        None,
        winSize=(81, 81),
        maxLevel=4,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 0.001),
        flags=0,
        minEigThreshold=1e-6,
    )
    if located is None or forward_status is None or forward_error is None:
        count = len(points)
        return np.zeros((count, 2), dtype=np.float32), np.zeros(count, dtype=bool), np.full(count, np.inf), np.full(count, np.inf), np.zeros(count)
    located = located.reshape(-1, 2)
    backtracked, backward_status, _ = cv2.calcOpticalFlowPyrLK(
        current_gray,
        reference_gray,
        located.reshape(-1, 1, 2).astype(np.float32),
        None,
        winSize=(81, 81),
        maxLevel=4,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 0.001),
        flags=0,
        minEigThreshold=1e-6,
    )
    if backtracked is None or backward_status is None:
        backtracked = np.full_like(located, np.nan)
        backward_status = np.zeros((len(points), 1), dtype=np.uint8)
    backtracked = backtracked.reshape(-1, 2)
    forward_error = np.maximum(0.0, forward_error.reshape(-1).astype(np.float64))
    backward_error = np.linalg.norm(backtracked - points, axis=1)
    finite = np.isfinite(located).all(axis=1) & np.isfinite(backtracked).all(axis=1)
    in_card = (
        (located[:, 0] >= 0)
        & (located[:, 1] >= 0)
        & (located[:, 0] <= GRID_WIDTH - 1)
        & (located[:, 1] <= GRID_HEIGHT - 1)
    )
    tracked = (
        (forward_status.reshape(-1) == 1)
        & (backward_status.reshape(-1) == 1)
        & finite
        & in_card
    )
    scores = np.exp(-forward_error / 25.0) * np.exp(-backward_error / 2.0)
    scores[~np.isfinite(scores)] = 0.0
    scores[~tracked] = 0.0
    return located, tracked, forward_error, backward_error, scores


def _anchor_features(gray: np.ndarray, anchors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    points: list[np.ndarray] = []
    groups: list[int] = []
    for anchor_index, anchor in enumerate(anchors):
        mask = np.zeros(gray.shape, dtype=np.uint8)
        cv2.circle(
            mask,
            (int(round(anchor[0])), int(round(anchor[1]))),
            MAP_REGISTRATION_PATCH_RADIUS_PX,
            255,
            -1,
        )
        features = cv2.goodFeaturesToTrack(
            gray,
            maxCorners=MAP_REGISTRATION_MAX_FEATURES_PER_ANCHOR,
            qualityLevel=0.01,
            minDistance=7,
            mask=mask,
            blockSize=5,
            useHarrisDetector=False,
        )
        if features is None:
            continue
        for feature in features.reshape(-1, 2):
            if any(float(np.linalg.norm(feature - existing)) < 3.0 for existing in points):
                continue
            points.append(feature.astype(np.float32))
            groups.append(anchor_index)
    return (
        np.array(points, dtype=np.float32).reshape(-1, 2),
        np.array(groups, dtype=np.int32),
    )


def _anchor_diagnostics(
    anchors: list[dict],
    expected: np.ndarray,
    direct_located: np.ndarray,
    direct_tracked: np.ndarray,
    direct_scores: np.ndarray,
    per_anchor_scores: list[float],
    per_anchor_feature_counts: list[int],
    per_anchor_inlier_counts: list[int],
    ransac_completed: bool,
    accepted_homography: Optional[np.ndarray] = None,
) -> list[dict]:
    located_from_transform = None
    if accepted_homography is not None:
        located_from_transform = cv2.perspectiveTransform(
            expected.reshape(-1, 1, 2).astype(np.float32), accepted_homography
        ).reshape(-1, 2)
    output = []
    for index, anchor in enumerate(anchors):
        tracked_point = direct_located[index] if index < len(direct_located) else np.array([np.nan, np.nan])
        score = per_anchor_scores[index] if index < len(per_anchor_scores) else float(direct_scores[index])
        in_card = (
            np.isfinite(tracked_point).all()
            and 0 <= tracked_point[0] <= GRID_WIDTH - 1
            and 0 <= tracked_point[1] <= GRID_HEIGHT - 1
        )
        status = "TRACKED"
        if not bool(direct_tracked[index]):
            status = "OUT_OF_CARD" if np.isfinite(tracked_point).all() and not in_card else "FAILED"
        elif (
            score < MAP_REGISTRATION_MIN_ANCHOR_SCORE
            or per_anchor_feature_counts[index] < MAP_REGISTRATION_MIN_FEATURES_PER_ANCHOR
            or (ransac_completed and per_anchor_inlier_counts[index] < MAP_REGISTRATION_MIN_INLIERS_PER_ANCHOR)
        ):
            status = "LOW_CONFIDENCE"
        located_point = (
            _normalized_diagnostic_point(located_from_transform[index])
            if located_from_transform is not None
            else _normalized_diagnostic_point(tracked_point)
        )
        output.append({
            "anchorId": anchor["id"],
            "expectedPoint": anchor["point"],
            "trackedPoint": _normalized_diagnostic_point(tracked_point),
            "locatedPoint": located_point,
            "score": float(np.clip(score, 0.0, 1.0)),
            "status": status,
        })
    return output


def _automatic_registration_candidate(
    candidate: _RegistrationCandidate,
    current: np.ndarray,
    original_anchors: list[dict],
    design_boundary: dict,
    zones: list[dict],
) -> tuple[Optional[dict], dict]:
    reference_gray = cv2.cvtColor(candidate.reference, cv2.COLOR_BGR2GRAY)
    current_gray = cv2.cvtColor(current, cv2.COLOR_BGR2GRAY)
    candidate_expected = _unit_points([anchor["point"] for anchor in candidate.anchors])
    original_expected = _unit_points([anchor["point"] for anchor in original_anchors])
    direct_located, direct_tracked, _, _, direct_scores = _track_points(
        reference_gray, current_gray, candidate_expected
    )
    feature_points, feature_groups = _anchor_features(reference_gray, candidate_expected)
    feature_count = len(feature_points)
    if feature_count:
        feature_located, feature_tracked, forward_error, backward_error, feature_scores = _track_points(
            reference_gray, current_gray, feature_points
        )
    else:
        feature_located = np.empty((0, 2), dtype=np.float32)
        feature_tracked = np.empty(0, dtype=bool)
        forward_error = np.empty(0)
        backward_error = np.empty(0)
        feature_scores = np.empty(0)
    usable = feature_tracked & (feature_scores >= MAP_REGISTRATION_MIN_FEATURE_SCORE)
    per_anchor_usable = [int(np.sum(usable & (feature_groups == index))) for index in range(4)]
    failure_code = None
    failure_message = None
    if feature_count > MAP_REGISTRATION_MAX_DIAGNOSTIC_FEATURES:
        failure_code = "FEATURE_LIMIT_EXCEEDED"
        failure_message = "Registration generated too many feature correspondences."
    elif any(count < MAP_REGISTRATION_MIN_FEATURES_PER_ANCHOR for count in per_anchor_usable):
        failure_code = "INSUFFICIENT_REDUNDANT_CORRESPONDENCES"
        failure_message = "One or more anchors lack enough independently tracked image features."

    homography = None
    ransac_completed = False
    inlier_mask = np.zeros(feature_count, dtype=bool)
    reprojection_errors = np.empty(0)
    if failure_code is None:
        usable_indexes = np.flatnonzero(usable)
        cv2.setRNGSeed(0)
        homography, raw_mask = cv2.findHomography(
            feature_points[usable_indexes],
            feature_located[usable_indexes],
            method=cv2.RANSAC,
            ransacReprojThreshold=MAP_REGISTRATION_RANSAC_THRESHOLD_PX,
            maxIters=2000,
            confidence=0.995,
        )
        if homography is None or raw_mask is None:
            failure_code = "RANSAC_TRANSFORM_UNAVAILABLE"
            failure_message = "Redundant correspondences did not define a transform."
        else:
            ransac_completed = True
            inlier_mask[usable_indexes] = raw_mask.reshape(-1).astype(bool)
            projected_features = cv2.perspectiveTransform(
                feature_points.reshape(-1, 1, 2), homography
            ).reshape(-1, 2)
            reprojection_errors = np.linalg.norm(projected_features[inlier_mask] - feature_located[inlier_mask], axis=1)

    inlier_count = int(np.sum(inlier_mask))
    usable_count = int(np.sum(usable))
    inlier_fraction = float(inlier_count / usable_count) if usable_count else 0.0
    per_anchor_inliers = [int(np.sum(inlier_mask & (feature_groups == index))) for index in range(4)]
    per_anchor_scores = [
        float(np.median(feature_scores[inlier_mask & (feature_groups == index)]))
        if np.any(inlier_mask & (feature_groups == index))
        else float(direct_scores[index])
        for index in range(4)
    ]
    median_reprojection = float(np.median(reprojection_errors)) if len(reprojection_errors) else None
    max_reprojection = float(np.max(reprojection_errors)) if len(reprojection_errors) else None
    composed = None
    projected_boundary = None
    projected_zones = None
    acceptance = None
    if failure_code is None and homography is not None:
        try:
            _transform_is_coherent(homography)
            composed = homography @ candidate.source_homography
            projected_boundary, projected_zones, acceptance = _validate_registration_result(
                mode="AUTOMATIC_RANSAC",
                homography=composed,
                feature_count=feature_count,
                usable_count=usable_count,
                inlier_count=inlier_count,
                inlier_fraction=inlier_fraction,
                per_anchor_feature_counts=per_anchor_usable,
                per_anchor_inlier_counts=per_anchor_inliers,
                per_anchor_scores=per_anchor_scores,
                median_reprojection_error=median_reprojection if median_reprojection is not None else np.inf,
                max_reprojection_error=max_reprojection if max_reprojection is not None else np.inf,
                registration_anchors=original_anchors,
                design_boundary=design_boundary,
                zones=zones,
            )
        except _AcceptanceGateFailure as error:
            failure_code = error.code
            failure_message = str(error)

    anchor_diagnostics = _anchor_diagnostics(
        original_anchors,
        original_expected,
        direct_located,
        direct_tracked,
        direct_scores,
        per_anchor_scores,
        per_anchor_usable,
        per_anchor_inliers,
        ransac_completed,
        composed if failure_code is None else None,
    )
    diagnostic = {
        "candidateId": candidate.candidate_id,
        "provenance": candidate.provenance,
        "accepted": failure_code is None,
        "failureCode": failure_code,
        "message": failure_message,
        "anchors": anchor_diagnostics,
        "featureCount": feature_count,
        "usableFeatureCount": usable_count,
        "inlierCount": inlier_count,
        "inlierFraction": inlier_fraction,
        "perAnchorFeatureCounts": per_anchor_usable,
        "perAnchorInlierCounts": per_anchor_inliers,
        "medianReprojectionErrorPx": median_reprojection,
        "maxReprojectionErrorPx": max_reprojection,
    }
    if failure_code is not None or composed is None or projected_boundary is None or projected_zones is None or acceptance is None:
        return None, diagnostic
    return {
        "homography": _unit_homography(composed),
        "anchors": [
            {
                "anchorId": anchor["anchorId"],
                "expectedPoint": anchor["expectedPoint"],
                "locatedPoint": anchor["locatedPoint"],
                "score": anchor["score"],
            }
            for anchor in anchor_diagnostics
        ],
        "projectedDesignBoundary": projected_boundary,
        "projectedZones": projected_zones,
        "candidateProvenance": {
            "candidateId": candidate.candidate_id,
            "source": candidate.provenance,
            **({"lessonId": candidate.candidate_id} if candidate.provenance == "REGISTRATION_LESSON" else {}),
        },
        "acceptance": acceptance,
    }, diagnostic


def _human_registration(
    original_anchors: list[dict],
    corrected_anchors: list[dict],
    design_boundary: dict,
    zones: list[dict],
) -> dict:
    if len(corrected_anchors) != 4:
        raise ValueError("Human rescue requires exactly four corrected anchors")
    expected_ids = [anchor["id"] for anchor in original_anchors]
    corrected_by_id = {anchor.get("id"): anchor for anchor in corrected_anchors}
    if len(corrected_by_id) != 4 or set(corrected_by_id) != set(expected_ids):
        raise ValueError("Human rescue anchor identities do not match the immutable map")
    expected = _unit_points([anchor["point"] for anchor in original_anchors])
    corrected = _unit_points([corrected_by_id[anchor_id]["point"] for anchor_id in expected_ids])
    homography = cv2.getPerspectiveTransform(expected.astype(np.float32), corrected.astype(np.float32))
    projected_expected = cv2.perspectiveTransform(expected.reshape(-1, 1, 2), homography).reshape(-1, 2)
    residuals = np.linalg.norm(projected_expected - corrected, axis=1)
    projected_boundary, projected_zones, acceptance = _validate_registration_result(
        mode="HUMAN_CONFIRMED",
        homography=homography,
        feature_count=4,
        usable_count=4,
        inlier_count=4,
        inlier_fraction=1.0,
        per_anchor_feature_counts=[1, 1, 1, 1],
        per_anchor_inlier_counts=[1, 1, 1, 1],
        per_anchor_scores=[1.0, 1.0, 1.0, 1.0],
        median_reprojection_error=float(np.median(residuals)),
        max_reprojection_error=float(np.max(residuals)),
        registration_anchors=original_anchors,
        design_boundary=design_boundary,
        zones=zones,
    )
    return {
        "homography": _unit_homography(homography),
        "anchors": [
            {
                "anchorId": anchor["id"],
                "expectedPoint": anchor["point"],
                "locatedPoint": corrected_by_id[anchor["id"]]["point"],
                "score": 1.0,
            }
            for anchor in original_anchors
        ],
        "projectedDesignBoundary": projected_boundary,
        "projectedZones": projected_zones,
        "candidateProvenance": {"candidateId": "human-confirmed", "source": "HUMAN_CORRECTION"},
        "acceptance": acceptance,
    }


def register_map_design(
    reference_image: np.ndarray,
    current_image: np.ndarray,
    anchors: list[dict],
    design_boundary: dict,
    zones: list[dict],
    *,
    lesson_candidates: Optional[list[dict]] = None,
    corrected_anchors: Optional[list[dict]] = None,
) -> dict:
    """Register a map from redundant image features or validate human rescue."""

    if len(anchors) != 4 or len({anchor.get("id") for anchor in anchors}) != 4:
        raise ValueError("Map registration requires four unique human anchors")
    _unit_points([anchor["point"] for anchor in anchors])
    current = _canonical_registration_image(current_image)
    candidates = [
        _RegistrationCandidate(
            candidate_id="original-reference",
            provenance="ORIGINAL_REFERENCE",
            reference=_canonical_registration_image(reference_image),
            anchors=anchors,
            source_homography=np.eye(3, dtype=np.float64),
        )
    ]
    candidate_ids = {"original-reference"}
    for raw in lesson_candidates or []:
        if len(candidates) >= MAP_REGISTRATION_MAX_CANDIDATES:
            break
        candidate_id = str(raw.get("candidateId", ""))[:80]
        if not candidate_id or candidate_id in candidate_ids:
            raise ValueError("Registration lesson candidate identity is invalid or duplicated")
        source_unit_homography = np.asarray(raw.get("sourceHomography"), dtype=np.float64).reshape(3, 3)
        _transform_is_coherent(source_unit_homography)
        scale = np.array(
            [[GRID_WIDTH - 1, 0, 0], [0, GRID_HEIGHT - 1, 0], [0, 0, 1]],
            dtype=np.float64,
        )
        source_homography = scale @ source_unit_homography @ np.linalg.inv(scale)
        candidate_anchors = raw.get("anchors")
        if not isinstance(candidate_anchors, list) or len(candidate_anchors) != 4:
            raise ValueError("Registration lesson candidate anchors are malformed")
        if [anchor.get("id") for anchor in candidate_anchors] != [anchor.get("id") for anchor in anchors]:
            raise ValueError("Registration lesson candidate anchors do not match the immutable map")
        source_anchor_pixels = _unit_points([anchor["point"] for anchor in anchors])
        candidate_anchor_pixels = _unit_points([anchor["point"] for anchor in candidate_anchors])
        projected_source_anchors = _validate_transform_orientation(
            source_homography,
            source_anchor_pixels,
        )
        if (
            not np.isfinite(projected_source_anchors).all()
            or float(np.max(np.linalg.norm(projected_source_anchors - candidate_anchor_pixels, axis=1))) > 1e-3
        ):
            raise ValueError("Registration lesson candidate transform is incoherent with its anchors")
        candidate_ids.add(candidate_id)
        candidates.append(_RegistrationCandidate(
            candidate_id=candidate_id,
            provenance="REGISTRATION_LESSON",
            reference=_canonical_registration_image(raw["referenceImage"]),
            anchors=candidate_anchors,
            source_homography=source_homography,
        ))

    accepted: list[tuple[dict, dict, int]] = []
    diagnostics = []
    for index, candidate in enumerate(candidates):
        registration, diagnostic = _automatic_registration_candidate(
            candidate, current, anchors, design_boundary, zones
        )
        diagnostics.append(diagnostic)
        if registration is not None:
            accepted.append((registration, diagnostic, index))
    if accepted:
        selected = sorted(
            accepted,
            key=lambda item: (
                -item[1]["inlierCount"],
                item[1]["medianReprojectionErrorPx"],
                item[2],
            ),
        )[0]
        return selected[0]

    best_diagnostic = sorted(
        enumerate(diagnostics),
        key=lambda item: (-item[1]["inlierCount"], -item[1]["usableFeatureCount"], item[0]),
    )[0][1]
    failure = {
        "algorithmVersion": MAP_REGISTRATION_ALGORITHM_VERSION,
        "policyVersion": MAP_REGISTRATION_POLICY_VERSION,
        "accepted": False,
        "failureCode": best_diagnostic["failureCode"] or "REGISTRATION_REJECTED",
        "message": best_diagnostic["message"] or "Registration did not pass acceptance policy.",
        "candidateCount": len(candidates),
        "candidateIds": [candidate.candidate_id for candidate in candidates],
        "bestCandidate": best_diagnostic,
    }
    if corrected_anchors is None:
        raise MapRegistrationFailure(failure["message"], failure)
    rescued = _human_registration(anchors, corrected_anchors, design_boundary, zones)
    rescued["automaticFailure"] = failure
    return rescued


def _candidate_type(
    view_id: str,
    box: tuple[int, int, int, int],
    bright_strength: float,
    dark_strength: float,
    card_origin: tuple[int, int],
) -> str:
    x, y, width, height = box
    origin_x, origin_y = card_origin
    center_x_mm = (x + width / 2 - origin_x) / PX_PER_MM
    center_y_mm = (y + height / 2 - origin_y) / PX_PER_MM
    outer_x = min(center_x_mm, CARD_WIDTH_MM - center_x_mm)
    outer_y = min(center_y_mm, CARD_HEIGHT_MM - center_y_mm)
    edge_or_corner = (outer_x < 5 and outer_y < 5) or min(outer_x, outer_y) < 2
    if edge_or_corner:
        return "VISIBLE_WHITENING" if bright_strength >= dark_strength else "FRAYING"
    if view_id.endswith("DIRECTIONAL") or max(width / height, height / width) >= 2.5:
        return "LIGHT_SCRATCH_SCUFF"
    return "FAINT_COLOR_VARIATION"


def _box_iou(first: tuple[int, int, int, int], second: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = first
    bx, by, bw, bh = second
    left, top = max(ax, bx), max(ay, by)
    right, bottom = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    overlap = max(0, right - left) * max(0, bottom - top)
    if overlap == 0:
        return 0.0
    return overlap / float(aw * ah + bw * bh - overlap)


def _boundary_subtracted_anomaly_response(
    image: np.ndarray, corner_shape: str
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return the full anomaly response before proposal filtering or selection."""

    height_px, width_px = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (ANOMALY_KERNEL_SIZE, ANOMALY_KERNEL_SIZE)
    )
    bright = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
    dark = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    heat = cv2.max(bright, dark)
    otsu, _ = cv2.threshold(heat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    percentile = float(np.percentile(heat, 97.0))
    threshold = max(12.0, float(otsu), percentile)
    binary = np.uint8(heat >= threshold)
    binary &= detector_material_mask(corner_shape, width_px, height_px)
    binary &= ~_boundary_aligned_response_mask(gray, corner_shape)
    return binary, bright, dark, heat


def boundary_subtracted_anomaly_mask(
    image: np.ndarray, corner_shape: str
) -> np.ndarray:
    """Expose every material anomaly pixel before component proposal filters."""

    binary, _, _, _ = _boundary_subtracted_anomaly_response(image, corner_shape)
    return binary


def defect_candidates(
    image: np.ndarray,
    corner_shape: str,
    view_id: str,
    maximum: int = 8,
) -> list[dict]:
    """Return only small, localized anomaly boxes for geometric SAM prompts."""
    height_px, width_px = image.shape[:2]
    card_origin = detector_card_origin(width_px, height_px)
    binary, bright, dark, heat = _boundary_subtracted_anomaly_response(
        image, corner_shape
    )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary)
    proposals = []
    padding = max(2, round(0.4 * PX_PER_MM))
    for label in range(1, count):
        x, y, width, height, area = (int(value) for value in stats[label])
        area_mm2 = area / (PX_PER_MM**2)
        width_mm, height_mm = width / PX_PER_MM, height / PX_PER_MM
        box_area_mm2 = width_mm * height_mm
        if not (MIN_DEFECT_AREA_MM2 <= area_mm2 <= MAX_CANDIDATE_AREA_MM2):
            continue
        if (
            max(width_mm, height_mm) > MAX_CANDIDATE_DIMENSION_MM
            or box_area_mm2 > MAX_CANDIDATE_BOX_AREA_MM2
        ):
            continue
        left, top = max(0, x - padding), max(0, y - padding)
        right = min(width_px, x + width + padding)
        bottom = min(height_px, y + height + padding)
        box = (left, top, right - left, bottom - top)
        component = labels[y : y + height, x : x + width] == label
        bright_strength = float(bright[y : y + height, x : x + width][component].mean())
        dark_strength = float(dark[y : y + height, x : x + width][component].mean())
        proposals.append(
            {
                "box": box,
                "coreBox": (x, y, width, height),
                "coreMask": component,
                "defectType": _candidate_type(
                    view_id, box, bright_strength, dark_strength, card_origin
                ),
                "score": float(
                    heat[y : y + height, x : x + width][component].mean()
                    * np.sqrt(area)
                ),
            }
        )

    proposals.sort(key=lambda candidate: candidate["score"], reverse=True)
    selected = []
    for proposal in proposals:
        if any(_box_iou(proposal["box"], item["box"]) >= 0.20 for item in selected):
            continue
        selected.append(proposal)
        if len(selected) == maximum:
            break
    return selected
