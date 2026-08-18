"""Deterministic, proposer-only color geometry for Speedster capture.

This module never accepts geometry on behalf of an operator. It supplies the
best complete four-corner draft the current engine found, or an honest
non-accepted outcome when no complete outline exists.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_CEILING
from typing import Literal, Optional

import cv2
import numpy as np

from card_geometry import GRID_HEIGHT, GRID_WIDTH, PX_PER_MM, ranked_card_quads


ENGINE_VERSION = "speedster-color-geometry-v2"
POLICY_PROVENANCE = "OWNER_APPROVED_VISIBLE_OUTLINE_V2"
AUTHORITY = "PROPOSER_ONLY"
MODES = ("PHYSICAL_OUTER", "PRINTED_FRAME")
OUTCOMES = ("ACCEPTED", "INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "ABSTAIN")
MAT_COLORS = ("BLACK", "WHITE", "MAGENTA")
SIDE_NAMES = ("top", "right", "bottom", "left")

PHYSICAL_CONTRAST_FLOOR_DELTA_E = 18.0
PHYSICAL_MINIMUM_SIDE_SUPPORT = 0.70
PHYSICAL_AMBIGUOUS_RUNNER_UP_RATIO = 0.92
PHYSICAL_SAMPLE_MAT_FRACTION = 0.60
PHYSICAL_MAT_REFERENCE_MIN_DELTA_E = 8.0
PHYSICAL_MAT_REFERENCE_MAX_DELTA_E = 18.0
PRINTED_FRAME_CONTRAST_FLOOR_DELTA_E = 12.0
PRINTED_FRAME_MINIMUM_SIDE_SUPPORT = 0.55
PRINTED_FRAME_AMBIGUOUS_RUNNER_UP_RATIO = 0.90


def _canonical_ambiguity(raw_ratio: float, threshold: float) -> tuple[float, bool]:
    serialized = float(
        Decimal(str(raw_ratio)).quantize(Decimal("0.0001"), rounding=ROUND_CEILING)
    )
    return serialized, serialized >= threshold


def _cie_lab(image: np.ndarray) -> np.ndarray:
    raw = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    raw[:, :, 0] *= 100.0 / 255.0
    raw[:, :, 1:] -= 128.0
    return raw


def _empty_side() -> dict:
    return {
        "medianContrastDeltaE": 0.0,
        "supportFraction": 0.0,
        "sampleCount": 0,
        "candidateCount": 0,
        "ambiguous": False,
    }


def _advisory(code: str, recommended_mat: Optional[str], message: str) -> dict:
    return {"code": code, "recommendedMat": recommended_mat, "message": message}


def _result(
    mode: str,
    mat_color: str,
    outcome: str,
    *,
    proposal: Optional[np.ndarray] = None,
    sides: Optional[dict] = None,
    candidate_count: int = 0,
    runner_up_ratio: Optional[float] = None,
    ambiguous: bool = False,
    advisory: Optional[dict] = None,
    diagnostic_candidate: Optional[dict] = None,
) -> dict:
    if mode not in MODES or outcome not in OUTCOMES or mat_color not in MAT_COLORS:
        raise ValueError("Color geometry result contains an unsupported enum value")
    return {
        "version": "speedster-color-geometry-proposal-v1",
        "engineVersion": ENGINE_VERSION,
        "authority": AUTHORITY,
        "policyProvenance": POLICY_PROVENANCE,
        "mode": mode,
        "outcome": outcome,
        "matColor": mat_color,
        "proposal": proposal,
        "contrastFloorDeltaE": (
            PHYSICAL_CONTRAST_FLOOR_DELTA_E
            if mode == "PHYSICAL_OUTER"
            else PRINTED_FRAME_CONTRAST_FLOOR_DELTA_E
        ),
        "minimumSideSupport": (
            PHYSICAL_MINIMUM_SIDE_SUPPORT
            if mode == "PHYSICAL_OUTER"
            else PRINTED_FRAME_MINIMUM_SIDE_SUPPORT
        ),
        "sideEvidence": sides or {name: _empty_side() for name in SIDE_NAMES},
        "ambiguity": {
            "candidateCount": candidate_count,
            "runnerUpScoreRatio": runner_up_ratio,
            "ambiguous": ambiguous,
        },
        "advisory": advisory,
        "diagnosticCandidate": diagnostic_candidate,
    }


def engine_error_result(mode: str, mat_color: str) -> dict:
    """Return deterministic, non-authoritative evidence after an engine fault."""
    message = (
        "Color geometry could not evaluate this image. Place the physical-card handles manually."
        if mode == "PHYSICAL_OUTER"
        else "Color geometry could not evaluate this image. Place the four printed-frame corners manually."
    )
    return _result(
        mode,
        mat_color,
        "ABSTAIN",
        advisory=_advisory(
            "COLOR_ENGINE_ERROR",
            None,
            message,
        ),
    )


def _mat_pixel_mask(pixels: np.ndarray, mat_color: str) -> np.ndarray:
    pixels = np.asarray(pixels, dtype=np.uint8).reshape(-1, 1, 3)
    hsv = cv2.cvtColor(pixels, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    hue, saturation, value = hsv[:, 0], hsv[:, 1], hsv[:, 2]
    if mat_color == "BLACK":
        return value <= 95
    if mat_color == "WHITE":
        return (value >= 155) & (saturation <= 90)
    return (hue >= 135) & (hue <= 175) & (saturation >= 95) & (value >= 65)


def _photo_perimeter_mask(height: int, width: int) -> np.ndarray:
    band = max(3, round(min(height, width) * 0.025))
    perimeter = np.zeros((height, width), dtype=bool)
    perimeter[:band] = True
    perimeter[-band:] = True
    perimeter[:, :band] = True
    perimeter[:, -band:] = True
    return perimeter


def _mat_ownership_mask(image: np.ndarray, mat_color: str) -> tuple[np.ndarray, float]:
    """Bind selected-mat pixels to this photo's actual perimeter appearance."""
    height, width = image.shape[:2]
    perimeter = _photo_perimeter_mask(height, width)
    broad_class = _mat_pixel_mask(image, mat_color).reshape(height, width)
    lab = _cie_lab(image)
    reference_pixels = lab[perimeter & broad_class]
    broad_support = float(np.mean(broad_class[perimeter]))
    if broad_support < 0.55 or not len(reference_pixels):
        return np.zeros((height, width), dtype=bool), broad_support

    reference = np.median(reference_pixels, axis=0)
    perimeter_distances = np.linalg.norm(reference_pixels - reference, axis=1)
    tolerance = float(np.clip(
        np.percentile(perimeter_distances, 95) + 3.0,
        PHYSICAL_MAT_REFERENCE_MIN_DELTA_E,
        PHYSICAL_MAT_REFERENCE_MAX_DELTA_E,
    ))
    distances = np.linalg.norm(lab - reference, axis=2)
    owned = broad_class & (distances <= tolerance)
    return owned, float(np.mean(owned[perimeter]))


def _sample_patch(lab: np.ndarray, point: np.ndarray, radius: int = 2) -> np.ndarray:
    height, width = lab.shape[:2]
    x = int(np.clip(round(float(point[0])), radius, width - radius - 1))
    y = int(np.clip(round(float(point[1])), radius, height - radius - 1))
    return np.median(lab[y - radius : y + radius + 1, x - radius : x + radius + 1], axis=(0, 1))


def _patch_mask_fraction(
    mask: np.ndarray,
    point: np.ndarray,
    radius: int = 2,
) -> float:
    height, width = mask.shape[:2]
    x = int(np.clip(round(float(point[0])), radius, width - radius - 1))
    y = int(np.clip(round(float(point[1])), radius, height - radius - 1))
    patch = mask[y - radius : y + radius + 1, x - radius : x + radius + 1]
    return float(np.mean(patch))


def _quad_side_evidence(
    image: np.ndarray,
    quad: np.ndarray,
    mat_ownership: np.ndarray,
    lab: np.ndarray,
) -> dict:
    centroid = np.mean(quad, axis=0)
    distance = max(5.0, min(image.shape[:2]) * 0.009)
    evidence = {}
    for side_name, index in zip(SIDE_NAMES, range(4)):
        start, end = quad[index], quad[(index + 1) % 4]
        midpoint = (start + end) * 0.5
        inward = centroid - midpoint
        norm = float(np.linalg.norm(inward))
        if norm <= 0:
            evidence[side_name] = _empty_side()
            continue
        inward /= norm
        values = []
        for along in np.linspace(0.12, 0.88, 33):
            edge = start + along * (end - start)
            inside_point = edge + inward * distance
            outside_point = edge - inward * distance
            inside = _sample_patch(lab, inside_point)
            outside = _sample_patch(lab, outside_point)
            difference = inside - outside
            values.append((
                float(np.linalg.norm(difference)),
                float(abs(difference[0])),
                float(np.linalg.norm(difference[1:])),
                _patch_mask_fraction(mat_ownership, outside_point),
                _patch_mask_fraction(mat_ownership, inside_point),
            ))
        contrasts = np.asarray(values, dtype=np.float32)
        contrast_supported = contrasts[:, 0] >= PHYSICAL_CONTRAST_FLOOR_DELTA_E
        outside_is_mat = contrasts[:, 3] >= PHYSICAL_SAMPLE_MAT_FRACTION
        inside_is_not_mat = contrasts[:, 4] <= 1.0 - PHYSICAL_SAMPLE_MAT_FRACTION
        evidence[side_name] = {
            "medianContrastDeltaE": round(float(np.median(contrasts[:, 0])), 3),
            "medianLightnessContrast": round(float(np.median(contrasts[:, 1])), 3),
            "medianChromaContrast": round(float(np.median(contrasts[:, 2])), 3),
            # The v1 support fraction now means physical ownership support, not
            # merely a strong color transition.  An inner printed/art boundary
            # can have excellent contrast but cannot pass unless its outside is
            # the operator-selected mat and its inside is card material.
            "supportFraction": round(float(np.mean(
                contrast_supported & outside_is_mat & inside_is_not_mat
            )), 4),
            "contrastSupportFraction": round(float(np.mean(contrast_supported)), 4),
            "outsideMatSupportFraction": round(float(np.mean(outside_is_mat)), 4),
            "insideNonMatSupportFraction": round(float(np.mean(inside_is_not_mat)), 4),
            "sampleCount": int(len(contrasts)),
            "candidateCount": 1,
            "ambiguous": False,
        }
    return evidence


def propose_physical_outer(image: np.ndarray, mat_color: str) -> dict:
    if mat_color not in MAT_COLORS:
        raise ValueError("matColor must be BLACK, WHITE, or MAGENTA")
    candidates = ranked_card_quads(image, limit=4)
    if not candidates:
        return _result(
            "PHYSICAL_OUTER",
            mat_color,
            "INSUFFICIENT_EVIDENCE",
            advisory=_advisory(
                "NO_PHYSICAL_OUTLINE",
                None,
                "The current outline detector found no complete four-corner outline. Place the four corners manually.",
            ),
        )

    mat_ownership, _mat_support = _mat_ownership_mask(image, mat_color)
    contrast_lab = _cie_lab(cv2.GaussianBlur(image, (5, 5), 0))
    evaluated = [
        (
            score,
            quad,
            _quad_side_evidence(image, quad, mat_ownership, contrast_lab),
        )
        for score, quad in candidates
    ]
    best_score, best_quad, sides = evaluated[0]

    runner_ratio = None
    ambiguous = False
    if len(evaluated) > 1 and best_score > 0:
        runner_ratio, ambiguous = _canonical_ambiguity(
            float(evaluated[1][0] / best_score),
            PHYSICAL_AMBIGUOUS_RUNNER_UP_RATIO,
        )
    for side in sides.values():
        side["candidateCount"] = len(evaluated)
        side["ambiguous"] = ambiguous
    return _result(
        "PHYSICAL_OUTER",
        mat_color,
        "ACCEPTED",
        proposal=best_quad,
        sides=sides,
        candidate_count=len(evaluated),
        runner_up_ratio=runner_ratio,
        ambiguous=ambiguous,
    )


def _top_transition_evidence(lab: np.ndarray) -> tuple[Optional[float], dict]:
    height, width = lab.shape[:2]
    start = max(2, round(1.0 * PX_PER_MM))
    # PRINTED_FRAME means the outer print-field transition, not an artwork/text
    # box deeper inside the card. The preserved Squirtle/Bulbasaur research pair
    # places that transition inside this fixed 1-6 mm band on all four sides.
    stop = min(height - 3, round(6.0 * PX_PER_MM))
    margin = max(3, round(width * 0.08))
    offset = max(3, round(0.30 * PX_PER_MM))
    stride = max(1, round(width / 260))
    along = np.arange(margin, width - margin, stride)
    candidates = []
    for row in range(start, stop):
        outer = lab[max(0, row - offset - 1) : max(1, row - offset + 2), along]
        inner = lab[min(height - 1, row + offset - 1) : min(height, row + offset + 2), along]
        if outer.shape[0] == 0 or inner.shape[0] == 0:
            continue
        differences = np.linalg.norm(np.median(inner, axis=0) - np.median(outer, axis=0), axis=1)
        median = float(np.median(differences))
        support = float(np.mean(differences >= PRINTED_FRAME_CONTRAST_FLOOR_DELTA_E))
        candidates.append((median * support, row, median, support, len(differences)))
    if not candidates:
        return None, _empty_side()
    candidates.sort(key=lambda item: item[1])
    plausible_rows = [
        item for item in candidates
        if item[2] >= PRINTED_FRAME_CONTRAST_FLOOR_DELTA_E and item[3] >= 0.25
    ]
    clusters = []
    for item in plausible_rows:
        if not clusters or item[1] > clusters[-1][-1][1] + 1:
            clusters.append([item])
        else:
            clusters[-1].append(item)
    leaders = [max(cluster, key=lambda item: (item[0], -abs(item[1] - np.mean([member[1] for member in cluster])))) for cluster in clusters]
    if leaders:
        leaders.sort(reverse=True)
        best = leaders[0]
        runner = leaders[1] if len(leaders) > 1 else None
    else:
        best = max(candidates, key=lambda item: item[0])
        runner = None
    ratio = None
    ambiguous = False
    if runner is not None and best[0] > 0:
        ratio, ambiguous = _canonical_ambiguity(
            float(runner[0] / best[0]),
            PRINTED_FRAME_AMBIGUOUS_RUNNER_UP_RATIO,
        )
    evidence = {
        "medianContrastDeltaE": round(best[2], 3),
        "supportFraction": round(best[3], 4),
        "sampleCount": best[4],
        "candidateCount": len(clusters),
        "ambiguous": ambiguous,
        "runnerUpScoreRatio": ratio,
    }
    return float(best[1]), evidence


def propose_printed_frame(rectified: np.ndarray, mat_color: str) -> dict:
    if mat_color not in MAT_COLORS:
        raise ValueError("matColor must be BLACK, WHITE, or MAGENTA")
    lab = _cie_lab(cv2.GaussianBlur(rectified, (5, 5), 0))
    rotated = lab
    offsets = {}
    sides = {}
    for side in SIDE_NAMES:
        offset, evidence = _top_transition_evidence(rotated)
        offsets[side] = offset
        sides[side] = evidence
        rotated = np.ascontiguousarray(np.rot90(rotated))

    ambiguous_sides = [side for side, evidence in sides.items() if evidence["ambiguous"]]
    candidate_count = max((evidence["candidateCount"] for evidence in sides.values()), default=0)
    ratios = [
        evidence.get("runnerUpScoreRatio")
        for evidence in sides.values()
        if evidence.get("runnerUpScoreRatio") is not None
    ]
    runner_ratio = max(ratios) if ratios else None
    supported_sides = [
        side
        for side, evidence in sides.items()
        if evidence["medianContrastDeltaE"] >= PRINTED_FRAME_CONTRAST_FLOOR_DELTA_E
        and evidence["supportFraction"] >= PRINTED_FRAME_MINIMUM_SIDE_SUPPORT
    ]
    plausible_sides = [
        side
        for side, evidence in sides.items()
        if evidence["medianContrastDeltaE"] >= PRINTED_FRAME_CONTRAST_FLOOR_DELTA_E
        and evidence["supportFraction"] >= 0.25
    ]

    if ambiguous_sides:
        return _result(
            "PRINTED_FRAME",
            mat_color,
            "ABSTAIN",
            sides=sides,
            candidate_count=candidate_count,
            runner_up_ratio=runner_ratio,
            ambiguous=True,
            advisory=_advisory(
                "AMBIGUOUS_PRINTED_FRAME",
                None,
                "Multiple printed-frame transitions are similarly plausible. Confirm the current manual draft.",
            ),
        )
    if len(supported_sides) == 4:
        top = offsets["top"]
        right = offsets["right"]
        bottom = offsets["bottom"]
        left = offsets["left"]
        quad = np.array(
            [
                [left, top],
                [GRID_WIDTH - 1 - right, top],
                [GRID_WIDTH - 1 - right, GRID_HEIGHT - 1 - bottom],
                [left, GRID_HEIGHT - 1 - bottom],
            ],
            dtype=np.float32,
        )
        return _result(
            "PRINTED_FRAME",
            mat_color,
            "ACCEPTED",
            proposal=quad,
            sides=sides,
            candidate_count=candidate_count,
            runner_up_ratio=runner_ratio,
        )
    if len(plausible_sides) < 2:
        return _result(
            "PRINTED_FRAME",
            mat_color,
            "NOT_APPLICABLE",
            sides=sides,
            candidate_count=candidate_count,
            runner_up_ratio=runner_ratio,
            advisory=_advisory(
                "NO_PRINTED_FRAME",
                None,
                "No four-sided printed frame is evidenced. Keep the normal manual centering workflow.",
            ),
        )
    return _result(
        "PRINTED_FRAME",
        mat_color,
        "INSUFFICIENT_EVIDENCE",
        sides=sides,
        candidate_count=candidate_count,
        runner_up_ratio=runner_ratio,
        advisory=_advisory(
            "INCOMPLETE_PRINTED_FRAME",
            None,
            "The printed frame does not have support on all four sides. Keep the normal manual centering workflow.",
        ),
    )


def serialize_proposal(result: dict, width: int, height: int) -> dict:
    serialized = {**result}
    proposal = result.get("proposal")
    serialized["proposal"] = (
        [
            {"x": float(point[0] / width), "y": float(point[1] / height)}
            for point in np.asarray(proposal)
        ]
        if proposal is not None
        else None
    )
    diagnostic_candidate = result.get("diagnosticCandidate")
    if diagnostic_candidate is not None:
        serialized["diagnosticCandidate"] = {
            **diagnostic_candidate,
            "quad": [
                {"x": float(point[0] / width), "y": float(point[1] / height)}
                for point in np.asarray(diagnostic_candidate["quad"])
            ],
        }
    return serialized
