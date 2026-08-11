"""Lean deterministic geometry and localized defect proposals for Speedster."""

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
WORKING_LONG_SIDE_PX = 1000
PX_PER_MM = GRID_WIDTH / CARD_WIDTH_MM
INSPECTION_MARGIN_MM = 2.0
INSPECTION_MARGIN_PX = round(INSPECTION_MARGIN_MM * PX_PER_MM)
INSPECTION_WIDTH = GRID_WIDTH + 2 * INSPECTION_MARGIN_PX
INSPECTION_HEIGHT = GRID_HEIGHT + 2 * INSPECTION_MARGIN_PX
DEFAULT_BORDER_MM = 5.0
MAX_BORDER_SEARCH_MM = 12.0
MIN_COMPONENT_AREA_FRACTION = 0.30
MAX_COMPONENT_AREA_FRACTION = 0.97
MIN_RECTANGULAR_FILL = 0.72
MAX_ASPECT_ERROR = 0.06
MIN_DEFECT_AREA_MM2 = 0.02
MAX_CANDIDATE_AREA_MM2 = 8.0
MAX_CANDIDATE_BOX_AREA_MM2 = 20.0
MAX_CANDIDATE_DIMENSION_MM = 10.0
ANOMALY_KERNEL_SIZE = 15
EXPECTED_BOUNDARY_RESPONSE_PX = ANOMALY_KERNEL_SIZE // 2


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


def detect_card_quad(image: np.ndarray) -> Optional[np.ndarray]:
    """Return the physical card quad or None; never substitute the photo frame."""
    working, scale = _working_image(image)
    frame_area = working.shape[0] * working.shape[1]
    best = None
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
        if not (
            MIN_COMPONENT_AREA_FRACTION * frame_area
            < area
            < MAX_COMPONENT_AREA_FRACTION * frame_area
        ):
            continue
        rectangle = cv2.minAreaRect(contour)
        width, height = rectangle[1]
        if min(width, height) <= 0:
            continue
        aspect = min(width, height) / max(width, height)
        aspect_error = abs(aspect - EXPECTED_ASPECT)
        fill = area / (width * height)
        if aspect_error > MAX_ASPECT_ERROR or fill < MIN_RECTANGULAR_FILL:
            continue
        score = (
            area
            * (1.0 - aspect_error / MAX_ASPECT_ERROR)
            * min(1.0, fill / 0.93)
        )
        if best is None or score > best[0]:
            best = (score, contour, rectangle)
    if best is None:
        return None
    corners = _portraitize(_side_line_corners(best[1], best[2]))
    return corners / scale if scale < 1.0 else corners


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
    transform = cv2.getPerspectiveTransform(
        np.asarray(corners, dtype=np.float32), destination
    )
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
    transform = cv2.getPerspectiveTransform(
        np.asarray(corners, dtype=np.float32), destination
    )
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


def printed_border_quad(
    image: np.ndarray,
) -> tuple[np.ndarray, list[str], dict[str, Optional[float]]]:
    offsets = find_printed_border_offsets(image)
    resolved = {
        side: value if value is not None else DEFAULT_BORDER_MM
        for side, value in offsets.items()
    }
    left = resolved["left"] * PX_PER_MM
    right = GRID_WIDTH - 1 - resolved["right"] * PX_PER_MM
    top = resolved["top"] * PX_PER_MM
    bottom = GRID_HEIGHT - 1 - resolved["bottom"] * PX_PER_MM
    quad = np.array(
        [[left, top], [right, top], [right, bottom], [left, bottom]],
        dtype=np.float32,
    )
    detected = [side for side, value in offsets.items() if value is not None]
    return quad, detected, offsets


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


def _project_unit_points(points: list[dict], homography: np.ndarray) -> list[dict]:
    pixels = np.array(
        [[float(point["x"]) * (GRID_WIDTH - 1), float(point["y"]) * (GRID_HEIGHT - 1)] for point in points],
        dtype=np.float32,
    ).reshape(-1, 1, 2)
    projected = cv2.perspectiveTransform(pixels, homography).reshape(-1, 2)
    if not np.isfinite(projected).all():
        raise ValueError("Map registration projected non-finite design geometry")
    return [
        {
            "x": float(x / (GRID_WIDTH - 1)),
            "y": float(y / (GRID_HEIGHT - 1)),
        }
        for x, y in projected
    ]


def register_map_design(
    reference_image: np.ndarray,
    current_image: np.ndarray,
    anchors: list[dict],
    design_boundary: dict,
    zones: list[dict],
) -> dict:
    """Locate four human anchors and transform only the mapped printed design."""

    if len(anchors) != 4 or len({anchor.get("id") for anchor in anchors}) != 4:
        raise ValueError("Map registration requires four unique human anchors")
    reference = _canonical_registration_image(reference_image)
    current = _canonical_registration_image(current_image)
    reference_gray = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)
    current_gray = cv2.cvtColor(current, cv2.COLOR_BGR2GRAY)
    expected = _unit_points([anchor["point"] for anchor in anchors])
    located, status, error = cv2.calcOpticalFlowPyrLK(
        reference_gray,
        current_gray,
        expected.reshape(-1, 1, 2),
        None,
        winSize=(81, 81),
        maxLevel=4,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 0.001),
        flags=0,
        minEigThreshold=1e-6,
    )
    if located is None or status is None or error is None or not np.all(status.reshape(-1) == 1):
        raise ValueError("One or more human map anchors could not be located on the current copy")
    located = located.reshape(-1, 2)
    if not np.isfinite(located).all() or (located[:, 0] < 0).any() or (located[:, 1] < 0).any() or (located[:, 0] > GRID_WIDTH - 1).any() or (located[:, 1] > GRID_HEIGHT - 1).any():
        raise ValueError("Located map anchors fall outside the current physical card")
    homography = cv2.getPerspectiveTransform(expected.astype(np.float32), located.astype(np.float32))
    if not np.isfinite(homography).all() or abs(float(np.linalg.det(homography))) < 1e-12:
        raise ValueError("Human map anchors do not define a coherent design transform")

    kind = design_boundary.get("kind")
    if kind == "FULL_BLEED":
        projected_boundary = {"kind": "FULL_BLEED"}
    elif kind == "QUAD":
        projected_boundary = {
            "kind": "QUAD",
            "points": _project_unit_points(design_boundary.get("points", []), homography),
        }
    else:
        raise ValueError("Map design boundary is invalid")

    projected_zones = []
    for zone in zones:
        polygon = zone.get("polygon")
        if not isinstance(polygon, list) or len(polygon) < 3:
            raise ValueError("Map zone polygon is invalid")
        projected_zones.append(
            {
                "id": zone["id"],
                "label": zone["label"],
                "semanticType": zone["semanticType"],
                "polygon": _project_unit_points(polygon, homography),
            }
        )

    scale = np.array(
        [[GRID_WIDTH - 1, 0, 0], [0, GRID_HEIGHT - 1, 0], [0, 0, 1]],
        dtype=np.float64,
    )
    unit_homography = np.linalg.inv(scale) @ homography @ scale
    unit_homography /= unit_homography[2, 2]
    errors = error.reshape(-1)
    return {
        "homography": unit_homography.reshape(-1).tolist(),
        "anchors": [
            {
                "anchorId": anchor["id"],
                "expectedPoint": anchor["point"],
                "locatedPoint": {
                    "x": float(located[index][0] / (GRID_WIDTH - 1)),
                    "y": float(located[index][1] / (GRID_HEIGHT - 1)),
                },
                "score": float(1.0 / (1.0 + max(0.0, errors[index]))),
            }
            for index, anchor in enumerate(anchors)
        ],
        "projectedDesignBoundary": projected_boundary,
        "projectedZones": projected_zones,
    }


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
