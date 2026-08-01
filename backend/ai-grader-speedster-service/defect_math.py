"""Fuse detector evidence and measure defects on the canonical card grid."""

from typing import Dict, List

import cv2
import numpy as np


GRID_WIDTH = 1270
GRID_HEIGHT = 1778
CARD_WIDTH_MM = 63.5
CARD_HEIGHT_MM = 88.9
CORNER_ZONE_MM = 5.0
EDGE_ZONE_MM = 2.0
ROUNDED_CORNER_RADIUS_MM = 3.18
FUSION_TOLERANCE_PX = 4

DEFECT_MULTIPLIERS = {
    "FAINT_COLOR_VARIATION": 0.5,
    "VISIBLE_WHITENING": 1.0,
    "FRAYING": 1.25,
    "CHIPPING_EXPOSED_STOCK": 1.5,
    "LIFTING_DEFORMATION": 2.0,
    "LIGHT_SCRATCH_SCUFF": 1.0,
    "VISIBLE_SCRATCH_PRINT_COATING_LOSS": 1.25,
    "DENT_MATERIAL_DAMAGE": 1.5,
    "PEELING_HEAVY_DAMAGE": 2.0,
}


def _rasterize(contour: List[Dict[str, float]]) -> np.ndarray:
    points = np.array(
        [
            [
                round(point["x"] * (GRID_WIDTH - 1)),
                round(point["y"] * (GRID_HEIGHT - 1)),
            ]
            for point in contour
        ],
        dtype=np.int32,
    )
    mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
    if len(points) >= 3:
        cv2.fillPoly(mask, [points], 1)
    return mask


def _material_mask(corner_shape: str) -> np.ndarray:
    if corner_shape == "SQUARE":
        return np.ones((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
    if corner_shape != "ROUNDED_3_18_MM":
        raise ValueError("corner_shape must be 'ROUNDED_3_18_MM' or 'SQUARE'")

    x_mm = (np.arange(GRID_WIDTH, dtype=np.float32) + 0.5) * CARD_WIDTH_MM / GRID_WIDTH
    y_mm = (np.arange(GRID_HEIGHT, dtype=np.float32) + 0.5) * CARD_HEIGHT_MM / GRID_HEIGHT
    x_distance = np.minimum(x_mm, CARD_WIDTH_MM - x_mm)[None, :]
    y_distance = np.minimum(y_mm, CARD_HEIGHT_MM - y_mm)[:, None]
    radius = ROUNDED_CORNER_RADIUS_MM
    inside_corner_circle = (
        (x_distance - radius) ** 2 + (y_distance - radius) ** 2 <= radius**2
    )
    return ((x_distance >= radius) | (y_distance >= radius) | inside_corner_circle).astype(
        np.uint8
    )


def _zone_masks(material: np.ndarray) -> Dict[str, np.ndarray]:
    x_mm = (np.arange(GRID_WIDTH, dtype=np.float32) + 0.5) * CARD_WIDTH_MM / GRID_WIDTH
    y_mm = (np.arange(GRID_HEIGHT, dtype=np.float32) + 0.5) * CARD_HEIGHT_MM / GRID_HEIGHT
    x_outer = np.minimum(x_mm, CARD_WIDTH_MM - x_mm)[None, :]
    y_outer = np.minimum(y_mm, CARD_HEIGHT_MM - y_mm)[:, None]

    corners = (
        (x_outer < CORNER_ZONE_MM) & (y_outer < CORNER_ZONE_MM) & (material > 0)
    )
    edges = (
        ((x_outer < EDGE_ZONE_MM) | (y_outer < EDGE_ZONE_MM))
        & ~corners
        & (material > 0)
    )
    surface = (material > 0) & ~corners & ~edges
    return {
        "CORNERS": corners.astype(np.uint8),
        "EDGES": edges.astype(np.uint8),
        "SURFACE": surface.astype(np.uint8),
    }


def _should_fuse(first: dict, second: dict) -> bool:
    overlap = np.count_nonzero(first["mask"] & second["mask"])
    if overlap:
        return True
    if first["sourceViewId"] == second["sourceViewId"]:
        return False

    kernel_size = FUSION_TOLERANCE_PX * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    near_overlap = np.count_nonzero(cv2.dilate(first["mask"], kernel) & second["mask"])
    smaller_area = min(np.count_nonzero(first["mask"]), np.count_nonzero(second["mask"]))
    return smaller_area > 0 and near_overlap / smaller_area >= 0.5


def _fused_groups(proposals: List[dict]) -> List[List[int]]:
    parents = list(range(len(proposals)))

    def root(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for first in range(len(proposals)):
        for second in range(first + 1, len(proposals)):
            if _should_fuse(proposals[first], proposals[second]):
                first_root, second_root = root(first), root(second)
                parents[second_root] = first_root

    groups: Dict[int, List[int]] = {}
    for index in range(len(proposals)):
        groups.setdefault(root(index), []).append(index)
    return list(groups.values())


def _normalized_contours(mask: np.ndarray) -> List[List[Dict[str, float]]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=lambda contour: cv2.boundingRect(contour)[:2])
    return [
        [
            {
                "x": float(point[0][0] / (GRID_WIDTH - 1)),
                "y": float(point[0][1] / (GRID_HEIGHT - 1)),
            }
            for point in contour
        ]
        for contour in contours
    ]


def measure_defects(proposals: List[dict], corner_shape: str) -> List[dict]:
    """Fuse canonical detector proposals and return one measurement per occupied zone."""

    prepared = []
    for proposal in proposals:
        defect_type = proposal["defectType"]
        if defect_type not in DEFECT_MULTIPLIERS:
            raise ValueError(f"Unknown defect type: {defect_type}")
        prepared.append({**proposal, "mask": _rasterize(proposal["canonicalContour"])})

    material = _material_mask(corner_shape)
    zones = _zone_masks(material)
    pixel_area_mm2 = CARD_WIDTH_MM * CARD_HEIGHT_MM / (GRID_WIDTH * GRID_HEIGHT)
    results = []

    for group in _fused_groups(prepared):
        members = [prepared[index] for index in group]
        primary = max(
            members,
            key=lambda proposal: (
                DEFECT_MULTIPLIERS[proposal["defectType"]],
                proposal["confidence"],
            ),
        )
        fused = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        for member in members:
            fused |= member["mask"]
        fused &= material

        view_ids = list(dict.fromkeys(member["sourceViewId"] for member in members))
        supporting_views = [view_id for view_id in view_ids if view_id != primary["sourceViewId"]]
        multiplier = DEFECT_MULTIPLIERS[primary["defectType"]]

        for zone_name, zone_mask in zones.items():
            measured = fused & zone_mask
            pixel_count = int(np.count_nonzero(measured))
            if not pixel_count:
                continue
            _, _, width_px, height_px = cv2.boundingRect(measured)
            area_mm2 = pixel_count * pixel_area_mm2
            eligible_area_mm2 = np.count_nonzero(zone_mask) * pixel_area_mm2
            results.append(
                {
                    "zone": zone_name,
                    "canonicalContours": _normalized_contours(measured),
                    "sourceViewId": primary["sourceViewId"],
                    "supportingViewIds": supporting_views,
                    "defectType": primary["defectType"],
                    "confidence": float(primary["confidence"]),
                    "widthMm": width_px * CARD_WIDTH_MM / GRID_WIDTH,
                    "heightMm": height_px * CARD_HEIGHT_MM / GRID_HEIGHT,
                    "areaMm2": area_mm2,
                    "eligibleZonePercent": area_mm2 / eligible_area_mm2 * 100,
                    "multiplier": multiplier,
                    "weightedAreaMm2": area_mm2 * multiplier,
                }
            )
    return results
