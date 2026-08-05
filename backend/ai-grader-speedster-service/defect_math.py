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


def material_mask(corner_shape: str) -> np.ndarray:
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
        has_mask = "canonicalMask" in proposal
        has_contour = "canonicalContour" in proposal
        if has_mask == has_contour:
            raise ValueError(
                "A defect proposal requires exactly one canonical mask or contour"
            )
        if has_mask:
            if not isinstance(proposal["canonicalMask"], np.ndarray):
                raise ValueError("An exact canonical mask must remain in-memory")
            mask = np.asarray(proposal["canonicalMask"])
            if mask.shape != (GRID_HEIGHT, GRID_WIDTH):
                raise ValueError("Exact canonical mask has unsupported dimensions")
            mask = (mask > 0).astype(np.uint8)
        else:
            mask = _rasterize(proposal["canonicalContour"])
        prepared.append({**proposal, "mask": mask})

    material = material_mask(corner_shape)
    zones = _zone_masks(material)
    pixel_area_mm2 = CARD_WIDTH_MM * CARD_HEIGHT_MM / (GRID_WIDTH * GRID_HEIGHT)
    results = []

    for group in _fused_groups(prepared):
        members = [prepared[index] for index in group]
        winning_type = np.full((GRID_HEIGHT, GRID_WIDTH), -1, dtype=np.int16)
        winning_member = np.full((GRID_HEIGHT, GRID_WIDTH), -1, dtype=np.int32)
        winning_multiplier = np.full((GRID_HEIGHT, GRID_WIDTH), -1.0, dtype=np.float32)
        winning_confidence = np.full((GRID_HEIGHT, GRID_WIDTH), -1.0, dtype=np.float64)
        defect_types = list(DEFECT_MULTIPLIERS)
        type_indexes = {defect_type: index for index, defect_type in enumerate(defect_types)}

        for prepared_index in group:
            member = prepared[prepared_index]
            member_mask = (member["mask"] & material) > 0
            multiplier = DEFECT_MULTIPLIERS[member["defectType"]]
            ranking_confidence = float(
                member.get("rankingConfidence", member["confidence"])
            )
            wins = member_mask & (
                (multiplier > winning_multiplier)
                | (
                    (multiplier == winning_multiplier)
                    & (ranking_confidence > winning_confidence)
                )
            )
            winning_type[wins] = type_indexes[member["defectType"]]
            winning_member[wins] = prepared_index
            winning_multiplier[wins] = multiplier
            winning_confidence[wins] = ranking_confidence

        winning_types = [
            defect_type
            for defect_type in dict.fromkeys(member["defectType"] for member in members)
            if np.any(winning_type == type_indexes[defect_type])
        ]
        for defect_type in winning_types:
            type_mask = (winning_type == type_indexes[defect_type]).astype(np.uint8)
            multiplier = DEFECT_MULTIPLIERS[defect_type]
            member_indexes = [
                prepared_index
                for prepared_index in group
                if prepared[prepared_index]["defectType"] == defect_type
                and np.any(prepared[prepared_index]["mask"] & type_mask)
            ]
            exact_indexes = [
                prepared_index
                for prepared_index in member_indexes
                if prepared[prepared_index].get("finalTrace") is not None
            ]
            non_exact_indexes = [
                prepared_index
                for prepared_index in member_indexes
                if prepared[prepared_index].get("finalTrace") is None
            ]
            measurement_sources = []
            for prepared_index in exact_indexes:
                owned_mask = (winning_member == prepared_index).astype(np.uint8)
                if np.any(owned_mask):
                    measurement_sources.append(
                        (owned_mask, prepared[prepared_index], [prepared[prepared_index]])
                    )
            if non_exact_indexes:
                non_exact_mask = (
                    (type_mask > 0) & np.isin(winning_member, non_exact_indexes)
                ).astype(np.uint8)
                if np.any(non_exact_mask):
                    non_exact_members = [prepared[index] for index in non_exact_indexes]
                    primary = max(
                        non_exact_members,
                        key=lambda proposal: proposal.get(
                            "rankingConfidence", proposal["confidence"]
                        ),
                    )
                    measurement_sources.append(
                        (non_exact_mask, primary, non_exact_members)
                    )

            for source_mask, primary, source_members in measurement_sources:
                view_ids = list(
                    dict.fromkeys(
                        view_id
                        for member in source_members
                        for view_id in [
                            member["sourceViewId"],
                            *member.get("supportingViewIds", []),
                        ]
                    )
                )
                supporting_views = [
                    view_id
                    for view_id in view_ids
                    if view_id != primary["sourceViewId"]
                ]
                for zone_name, zone_mask in zones.items():
                    measured = source_mask & zone_mask
                    pixel_count = int(np.count_nonzero(measured))
                    if not pixel_count:
                        continue
                    _, _, width_px, height_px = cv2.boundingRect(measured)
                    area_mm2 = pixel_count * pixel_area_mm2
                    eligible_area_mm2 = np.count_nonzero(zone_mask) * pixel_area_mm2
                    results.append(
                        {
                            "proposalId": primary.get("id"),
                            "zone": zone_name,
                            "canonicalContours": _normalized_contours(measured),
                            "sourceViewId": primary["sourceViewId"],
                            "supportingViewIds": supporting_views,
                            "defectType": defect_type,
                            "confidence": float(primary["confidence"]),
                            "featureFingerprint": primary.get("featureFingerprint"),
                            **(
                                {
                                    "learningAdjustment": float(
                                        primary["learningAdjustment"]
                                    )
                                }
                                if primary.get("learningAdjustment") is not None
                                else {}
                            ),
                            **(
                                {"origin": primary["origin"]}
                                if primary.get("origin") is not None
                                else {}
                            ),
                            **(
                                {"detectedDefectType": primary["detectedDefectType"]}
                                if primary.get("detectedDefectType") is not None
                                else {}
                            ),
                            **(
                                {"reviewResult": primary["reviewResult"]}
                                if primary.get("reviewResult") is not None
                                else {}
                            ),
                            **(
                                {"smartMarkLearning": primary["smartMarkLearning"]}
                                if primary.get("smartMarkLearning") is not None
                                else {}
                            ),
                            **(
                                {"memoryProposal": primary["memoryProposal"]}
                                if primary.get("memoryProposal") is not None
                                else {}
                            ),
                            **(
                                {"finalTrace": primary["finalTrace"]}
                                if primary.get("finalTrace") is not None
                                else {}
                            ),
                            **(
                                {"traceProvenance": primary["traceProvenance"]}
                                if primary.get("traceProvenance") is not None
                                else {}
                            ),
                            "widthMm": width_px * CARD_WIDTH_MM / GRID_WIDTH,
                            "heightMm": height_px * CARD_HEIGHT_MM / GRID_HEIGHT,
                            "pixelCount": pixel_count,
                            "areaMm2": area_mm2,
                            "eligibleZonePercent": area_mm2 / eligible_area_mm2 * 100,
                            "multiplier": multiplier,
                            "weightedAreaMm2": area_mm2 * multiplier,
                        }
                    )
    return results
