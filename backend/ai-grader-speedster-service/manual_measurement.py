"""CPU-only exact manual measurement, independent of detector/model startup.

Extraction baseline: sam3_detector.py at ae0339ad (see EXTRACTION_SOURCE_SHA256).
The production wrapper stays unchanged until separately accepted. This module
reuses the existing canonical grid, exact RLE decoder, fusion/material/zone math
and source reconciliation. It does not identify defects, approve inspection or
publish learning. No detector, SAM, Torch, application or transport import exists.

New action adapters should call ``measure_manual_side``: it rejects invalid or
unreconciled edits with a typed error. ``measure_marks`` retains the low-level
legacy contract for direct parity comparison and is not an action success gate.

Contract for ``measure_marks``:
* Supply one side's active marks/findings, with stable unique IDs, validated
  defect types/confidence and SQUARE or ROUNDED_3_18_MM material shape. The caller
  owns frame/action version binding, review state and removed-finding history.
* finalTrace and detectorMask are exact 1270 x 1778 canonical RLE. Trace crop
  provenance uses width-minus-one/height-minus-one coordinates; it is validated,
  never applied a second time to an already canonical mask. Inspection pixels
  used for optional enrichment keep their explicit inspectionFrame binding.
* Preserves baseline handling: invalid new traces are omitted; invalid existing
  traces are retained with traceErrors; corrupt detector masks and contour-only
  historical findings raise. Callers must reconcile requested IDs and reject
  traceErrors before adopting a successful edit or computing a current grade.
* Re-measure the complete active side after type changes/removal/undo because
  overlapping pixels can acquire a different owner. Inputs are not mutated.
* ``fingerprint_trace`` is an optional injected enrichment callable. Its absence
  or failure preserves exact measurement and removes stale edited fingerprints.
  Merely supplying evidence pixels never loads or invokes a model. The caller
  remains responsible for validating a supplied fingerprint's learning format.

The legacy helper spellings are retained so deterministic extraction drift is
reviewable. Pure dependencies remain canonical rather than copied here.
"""

import hashlib
from typing import Callable, Optional

import numpy as np

from card_geometry import (
    INSPECTION_HEIGHT,
    INSPECTION_WIDTH,
    crop_detector_mask_to_card,
    detector_material_mask,
)
from defect_math import (
    CARD_HEIGHT_MM, CARD_WIDTH_MM, DEFECT_MULTIPLIERS, GRID_HEIGHT, GRID_WIDTH,
    measure_defects,
)
from trace_rle import decode_trace_rle, encode_trace_rle

EXTRACTION_SOURCE_SHA256 = "e6e9747149ad7134d9c335c53f3a0b43b0c04fa66e78859f7cc9e7441ad93086"
TRACE_PROVENANCE_VERSION = "speedster-trace-provenance-v1"
TRACE_CROP_TRANSFORM_VERSION = "speedster-canonical-crop-affine-v1"
FingerprintTrace = Callable[
    [np.ndarray, np.ndarray, np.ndarray, dict], Optional[list[float]]
]


class ManualMeasurementError(ValueError):
    """An edit could not be measured/adopted; no partial success is implied."""

    def __init__(self, code: str, finding_ids: list[str]):
        self.code = code
        self.finding_ids = tuple(finding_ids)
        super().__init__(code)


def measure_manual_side(
    marks: list[dict],
    side: str,
    corner_shape: str,
    *,
    findings: Optional[list[dict]] = None,
    evidence_image: Optional[np.ndarray] = None,
    evidence_view_id: Optional[str] = None,
    inspection_frame: Optional[dict] = None,
    evidence_failed: bool = False,
    fingerprint_trace: Optional[FingerprintTrace] = None,
) -> dict:
    """Measure one active side or raise; never silently accept a missing mark.

    Frame/action ownership, human inspection and approval belong to the caller.
    An empty, valid input measures no damage; it is not proof of inspection.
    Validated edits retain the exact low-level baseline measurements, including
    source ordering and fully shadowed *existing* traces with empty regions.
    """
    if (
        not isinstance(side, str)
        or side not in {"FRONT", "BACK"}
        or not isinstance(corner_shape, str)
        or corner_shape not in {"SQUARE", "ROUNDED_3_18_MM"}
    ):
        raise ManualMeasurementError("INVALID_SIDE_OR_MATERIAL", [])
    if not isinstance(marks, list) or (
        findings is not None and not isinstance(findings, list)
    ):
        raise ManualMeasurementError("INVALID_FINDING_LIST", [])
    for sources, is_new in ((marks, True), (findings or [], False)):
        seen = set()
        for source in sources:
            if not isinstance(source, dict):
                raise ManualMeasurementError("INVALID_FINDING", [])
            identity = source.get("id")
            if not isinstance(identity, str) or not identity.strip():
                raise ManualMeasurementError("INVALID_FINDING_ID", [])
            if identity in seen:
                raise ManualMeasurementError("DUPLICATE_FINDING_ID", [identity])
            seen.add(identity)
            source_view = _canonical_source_view_id(side, source.get("sourceViewId"))
            confidence = source.get("confidence", 1.0 if is_new else None)
            ranking = source.get("rankingConfidence", confidence)
            defect_type = source.get("defectType")
            if (
                source.get("side", side) != side
                or source_view is None
                or not source_view.startswith(f"{side}:")
                or not isinstance(defect_type, str)
                or defect_type not in DEFECT_MULTIPLIERS
                or not _finite_number(confidence)
                or not _finite_number(ranking)
            ):
                raise ManualMeasurementError("INVALID_FINDING_METADATA", [identity])
            trace = source.get("finalTrace")
            authority = trace if trace is not None else source.get("detectorMask")
            if is_new and trace is None:
                raise ManualMeasurementError("INVALID_REQUESTED_TRACE", [identity])
            try:
                decode_trace_rle(authority)
            except ValueError as error:
                raise ManualMeasurementError("INVALID_EXACT_MASK", [identity]) from error
            if (trace is not None or source.get("traceProvenance") is not None) and (
                trace is None
                or not _valid_trace_provenance(
                    source.get("traceProvenance"), trace, source.get("sourceViewId"), side
                )
            ):
                raise ManualMeasurementError("INVALID_TRACE_PROVENANCE", [identity])
    result = measure_marks(
        marks, side, corner_shape, findings=findings,
        evidence_image=evidence_image, evidence_view_id=evidence_view_id,
        inspection_frame=inspection_frame, evidence_failed=evidence_failed,
        fingerprint_trace=fingerprint_trace,
    )
    if result.get("traceErrors"):
        raise ManualMeasurementError(
            "INVALID_EXISTING_TRACE", [error["findingId"] for error in result["traceErrors"]]
        )
    reconciled = {finding["id"] for finding in result["defects"]}
    missing = [mark["id"] for mark in marks if mark["id"] not in reconciled]
    if missing:
        raise ManualMeasurementError("REQUESTED_TRACE_NOT_RECONCILED", missing)
    return result



def canonical_trace_from_inspection(mask: np.ndarray) -> dict:
    """Encode the fixed 40px inspection crop, preserving holes and edge pixels.

    Accept only the existing 1350 x 1858 inspection grid. Other native crops
    require their own explicit transform; this boundary never resizes a mask or
    treats an already canonical mask as an inspection image. Empty material
    still raises the exact RLE encoder's non-empty-trace error.
    """
    if not isinstance(mask, np.ndarray) or mask.shape != (
        INSPECTION_HEIGHT, INSPECTION_WIDTH
    ):
        raise ValueError("Expected the exact Speedster inspection mask dimensions")
    if not np.all((mask == 0) | (mask == 1)):
        raise ValueError("An inspection mask must contain only binary pixels")
    canonical = crop_detector_mask_to_card(mask)
    return encode_trace_rle(canonical)


def _condition_score(weighted_percent: float) -> float:
    if weighted_percent <= 0.2:
        return 10
    if weighted_percent <= 1:
        return 9
    if weighted_percent <= 2:
        return 8
    if weighted_percent <= 3.5:
        return 7
    if weighted_percent < 5:
        return 6
    if weighted_percent < 6:
        return 5
    if weighted_percent < 7:
        return 4
    if weighted_percent < 8:
        return 3
    if weighted_percent < 10:
        return 2
    return 1


def _defect_id(side: str, result: dict, index: int) -> str:
    if result.get("proposalId"):
        proposal_id = result["proposalId"]
        return (
            proposal_id
            if proposal_id.endswith(f':{result["zone"]}')
            else f'{proposal_id}:{result["zone"]}'
        )
    identity = repr(
        (
            side,
            result["zone"],
            result["defectType"],
            result["sourceViewId"],
            result["canonicalContours"],
            index,
        )
    ).encode()
    return f"sam3-{side.lower()}-{hashlib.sha256(identity).hexdigest()[:16]}"


def _measurement_payload(
    result: dict, weighted_percent_by_zone: dict, side_weight: float, *, exact: bool
) -> dict:
    total_percent = weighted_percent_by_zone[result["zone"]]
    defect_percent = result["eligibleZonePercent"] * result["multiplier"]
    subgrade_effect = max(
        0.0,
        (
            _condition_score(total_percent - defect_percent)
            - _condition_score(total_percent)
        )
        * side_weight,
    )
    return {
        # New detector masks and human traces both own exact canonical pixels.
        # The optional parser field remains backward-compatible for contour-era
        # persisted findings.
        "pixelCount": result["pixelCount"],
        "widthMm": result["widthMm"],
        "heightMm": result["heightMm"],
        "areaMm2": result["areaMm2"],
        "zonePercent": result["eligibleZonePercent"],
        "multiplier": result["multiplier"],
        "weightedAreaMm2": result["weightedAreaMm2"],
        "subgradeEffect": subgrade_effect,
    }


def _measurement_region_contour(result: dict) -> list[dict]:
    contours = result["canonicalContours"]
    if not contours:
        raise ValueError("A measured Speedster region requires a derived contour")
    primary = max(contours, key=len)
    if len(primary) >= 3 and (
        result.get("finalTrace") is None or len(contours) == 1
    ):
        return primary

    points = [point for contour in contours for point in contour]
    if not points:
        raise ValueError("A measured Speedster region requires contour points")
    x_min = min(point["x"] for point in points)
    x_max = max(point["x"] for point in points)
    y_min = min(point["y"] for point in points)
    y_max = max(point["y"] for point in points)
    if x_min == x_max:
        if x_max < 1.0:
            x_max = min(1.0, x_max + 1.0 / (GRID_WIDTH - 1))
        else:
            x_min = max(0.0, x_min - 1.0 / (GRID_WIDTH - 1))
    if y_min == y_max:
        if y_max < 1.0:
            y_max = min(1.0, y_max + 1.0 / (GRID_HEIGHT - 1))
        else:
            y_min = max(0.0, y_min - 1.0 / (GRID_HEIGHT - 1))
    return [
        {"x": x_min, "y": y_min},
        {"x": x_max, "y": y_min},
        {"x": x_max, "y": y_max},
        {"x": x_min, "y": y_max},
    ]


def _trace_source_record(
    source: dict, result: Optional[dict], side: str, review_result: str
) -> dict:
    record = {
        key: value
        for key, value in source.items()
        if key
        not in {
            "canonicalContour",
            "canonicalContours",
            "canonicalMask",
            "detectorMask",
            "mask",
            "measurement",
            "measurementRegions",
            "zone",
        }
    }
    if result is not None:
        record.setdefault("id", result.get("proposalId"))
        record.setdefault("defectType", result["defectType"])
        record.setdefault("confidence", result["confidence"])
        record.setdefault("sourceViewId", result["sourceViewId"])
        record.setdefault("supportingViewIds", result["supportingViewIds"])
        record.setdefault("reviewResult", result.get("reviewResult", review_result))
        for key in (
            "featureFingerprint",
            "featureFingerprintTraceSha256",
            "learningAdjustment",
            "smartMarkLearning",
            "origin",
            "detectedDefectType",
            "memoryProposal",
            "findingProvenance",
            "finalTrace",
            "traceProvenance",
        ):
            if record.get(key) is None and result.get(key) is not None:
                record[key] = result[key]
    record.setdefault("side", side)
    record.setdefault("confidence", 1.0)
    record.setdefault("supportingViewIds", [])
    record.setdefault("origin", "SMART_MARK")
    record.setdefault("reviewResult", review_result)
    record["measurementRegions"] = []
    return record


def _to_speedster_defects(
    measured: list[dict],
    side: str,
    review_result: str,
    trace_sources: Optional[dict[str, dict]] = None,
) -> list[dict]:
    weighted_percent_by_zone = {}
    for result in measured:
        weighted_percent_by_zone[result["zone"]] = weighted_percent_by_zone.get(
            result["zone"], 0.0
        ) + result["eligibleZonePercent"] * result["multiplier"]

    side_weight = 0.7 if side == "FRONT" else 0.3
    defects = []
    trace_records = {}
    for index, result in enumerate(measured):
        contour = _measurement_region_contour(result)
        measurement = _measurement_payload(
            result,
            weighted_percent_by_zone,
            side_weight,
            exact=result.get("finalTrace") is not None,
        )
        if result.get("finalTrace") is not None:
            source_id = result.get("proposalId")
            if not source_id:
                raise ValueError("An exact trace measurement requires a stable source id")
            source_record = trace_records.get(source_id)
            if source_record is None:
                source_record = _trace_source_record(
                    (trace_sources or {}).get(source_id, {}),
                    result,
                    side,
                    review_result,
                )
                trace_records[source_id] = source_record
                defects.append(source_record)
            source_record["measurementRegions"].append(
                {
                    "zone": result["zone"],
                    "canonicalContour": contour,
                    "measurement": measurement,
                }
            )
            continue

        defects.append(
            {
                "id": _defect_id(side, result, index),
                "side": side,
                "zone": result["zone"],
                "defectType": result["defectType"],
                "confidence": result["confidence"],
                **(
                    {"featureFingerprint": result["featureFingerprint"]}
                    if result.get("featureFingerprint") is not None
                    else {}
                ),
                **(
                    {"learningAdjustment": result["learningAdjustment"]}
                    if result.get("learningAdjustment") is not None
                    else {}
                ),
                **(
                    {"smartMarkLearning": result["smartMarkLearning"]}
                    if result.get("smartMarkLearning") is not None
                    else {}
                ),
                **(
                    {
                        "origin": result["origin"],
                    }
                    if result.get("origin") is not None
                    else {}
                ),
                **(
                    {
                        "detectedDefectType": result["detectedDefectType"],
                    }
                    if result.get("detectedDefectType") is not None
                    else {}
                ),
                **(
                    {
                        "memoryProposal": result["memoryProposal"],
                    }
                    if result.get("memoryProposal") is not None
                    else {}
                ),
                **(
                    {
                        "findingProvenance": result["findingProvenance"],
                    }
                    if result.get("findingProvenance") is not None
                    else {}
                ),
                **(
                    {"detectorMask": encode_trace_rle(result["canonicalMask"])}
                    if result.get("canonicalMask") is not None
                    else {}
                ),
                "canonicalContour": contour,
                "sourceViewId": result["sourceViewId"],
                "supportingViewIds": result["supportingViewIds"],
                "reviewResult": result.get("reviewResult", review_result),
                "measurement": measurement,
            }
        )
    pixel_area_mm2 = CARD_WIDTH_MM * CARD_HEIGHT_MM / (GRID_WIDTH * GRID_HEIGHT)
    for source_record in trace_records.values():
        regions = source_record["measurementRegions"]
        if not regions:
            continue
        exact_total_area = (
            sum(region["measurement"]["pixelCount"] for region in regions)
            * pixel_area_mm2
        )
        prior_area = sum(
            region["measurement"]["areaMm2"] for region in regions[:-1]
        )
        last_measurement = regions[-1]["measurement"]
        last_measurement["areaMm2"] = exact_total_area - prior_area
        last_measurement["weightedAreaMm2"] = (
            last_measurement["areaMm2"] * last_measurement["multiplier"]
        )
    return defects


def _canonical_source_view_id(side: str, source_view_id: object) -> Optional[str]:
    if not isinstance(source_view_id, str) or not source_view_id.strip():
        return None
    source_view_id = source_view_id.strip()
    if source_view_id.startswith("FRONT:") or source_view_id.startswith("BACK:"):
        return source_view_id
    return f"{side}:{source_view_id}"


def _finite_number(value: object) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and np.isfinite(value)
    )


def _valid_trace_provenance(
    provenance: object,
    final_trace: dict,
    source_view_id: object,
    side: str,
) -> bool:
    if not isinstance(provenance, dict) or set(provenance) != {
        "version",
        "sourceViewId",
        "cropTransform",
        "highlighterStrokes",
        "finalTraceSha256",
    }:
        return False
    if provenance.get("version") != TRACE_PROVENANCE_VERSION:
        return False
    expected_view = _canonical_source_view_id(side, source_view_id)
    provenance_view = _canonical_source_view_id(side, provenance.get("sourceViewId"))
    if (
        expected_view is None
        or provenance_view != expected_view
        or not expected_view.startswith(f"{side}:")
    ):
        return False
    if provenance.get("finalTraceSha256") != final_trace.get("sha256"):
        return False

    crop_transform = provenance.get("cropTransform")
    if not isinstance(crop_transform, dict) or set(crop_transform) != {
        "version",
        "crop",
    }:
        return False
    if crop_transform.get("version") != TRACE_CROP_TRANSFORM_VERSION:
        return False
    crop = crop_transform.get("crop")
    if not isinstance(crop, dict) or set(crop) != {"x", "y", "width", "height"}:
        return False
    x, y, width, height = (
        crop.get("x"),
        crop.get("y"),
        crop.get("width"),
        crop.get("height"),
    )
    if (
        not all(_finite_number(value) for value in (x, y, width, height))
        or x < 0
        or y < 0
        or width <= 0
        or height <= 0
        or x + width > GRID_WIDTH - 1
        or y + height > GRID_HEIGHT - 1
    ):
        return False

    strokes = provenance.get("highlighterStrokes")
    if not isinstance(strokes, list):
        return False
    for stroke in strokes:
        if not isinstance(stroke, dict) or set(stroke) != {
            "canonicalPoints",
            "strokeWidthMm",
        }:
            return False
        if not _finite_number(stroke.get("strokeWidthMm")) or stroke["strokeWidthMm"] <= 0:
            return False
        points = stroke.get("canonicalPoints")
        if not isinstance(points, list) or not points:
            return False
        for point in points:
            if not isinstance(point, dict) or set(point) != {"x", "y"}:
                return False
            point_x, point_y = point.get("x"), point.get("y")
            if (
                isinstance(point_x, bool)
                or not isinstance(point_x, int)
                or isinstance(point_y, bool)
                or not isinstance(point_y, int)
                or not 0 <= point_x < GRID_WIDTH
                or not 0 <= point_y < GRID_HEIGHT
            ):
                return False
    return True


def measure_marks(
    marks: list[dict],
    side: str,
    corner_shape: str,
    *,
    evidence_image: Optional[np.ndarray] = None,
    evidence_view_id: Optional[str] = None,
    inspection_frame: Optional[dict] = None,
    evidence_failed: bool = False,
    fingerprint_trace: Optional[FingerprintTrace] = None,
    findings: Optional[list[dict]] = None,
) -> dict:
    """Return baseline-compatible side measurements; fingerprinting is opt-in."""
    exact_marks = []
    for mark in marks:
        if mark.get("finalTrace") is None or mark.get("traceProvenance") is None:
            continue
        try:
            mask = decode_trace_rle(mark.get("finalTrace"))
        except ValueError:
            # New Smart-Marks require one approved non-empty exact trace and
            # stroke provenance. A contour is never an active fallback.
            continue
        if not _valid_trace_provenance(
            mark.get("traceProvenance"),
            mark["finalTrace"],
            mark.get("sourceViewId"),
            side,
        ):
            continue
        exact_marks.append((mark, mask))

    trace_findings = []
    detector_mask_findings = []
    frozen_findings = []
    trace_errors = []
    for finding in findings or []:
        if finding.get("finalTrace") is not None:
            try:
                mask = decode_trace_rle(finding.get("finalTrace"))
            except ValueError:
                frozen_findings.append(finding)
                trace_errors.append(
                    {
                        "code": "INVALID_EXISTING_FINAL_TRACE",
                        "findingId": finding.get("id"),
                    }
                )
                continue
            if not _valid_trace_provenance(
                finding.get("traceProvenance"),
                finding["finalTrace"],
                finding.get("sourceViewId"),
                side,
            ):
                frozen_findings.append(finding)
                trace_errors.append(
                    {
                        "code": "INVALID_EXISTING_TRACE_PROVENANCE",
                        "findingId": finding.get("id"),
                    }
                )
                continue
            trace_findings.append((finding, mask))
        elif finding.get("detectorMask") is not None:
            try:
                mask = decode_trace_rle(finding.get("detectorMask"))
            except ValueError as error:
                raise ValueError(
                    "Existing detector mask authority is invalid"
                ) from error
            detector_mask_findings.append((finding, mask))
        elif finding.get("traceProvenance") is not None:
            frozen_findings.append(finding)
            trace_errors.append(
                {
                    "code": "MISSING_EXISTING_FINAL_TRACE",
                    "findingId": finding.get("id"),
                }
            )
        elif finding.get("canonicalContour") is not None:
            raise ValueError(
                "Contour-only historical findings cannot enter a current grade. Rerun the current detector to create exact mask evidence."
            )

    trace_sources = {finding["id"]: finding for finding, _mask in trace_findings}
    for mark, _mask in exact_marks:
        prior = trace_sources.get(mark["id"], {})
        trace_sources[mark["id"]] = {
            **prior,
            **mark,
            "side": prior.get("side", side),
            "confidence": prior.get("confidence", 1.0),
            "supportingViewIds": prior.get("supportingViewIds", []),
            "origin": prior.get("origin", "SMART_MARK"),
            "reviewResult": prior.get("reviewResult", "SMART_MARKED"),
        }
    exact_mark_ids = {mark["id"] for mark, _mask in exact_marks}

    evidence_by_id = {}
    if evidence_image is not None and inspection_frame is not None:
        try:
            allowed_mask = detector_material_mask(
                corner_shape, evidence_image.shape[1], evidence_image.shape[0]
            )
        except Exception:
            allowed_mask = None
            evidence_failed = True
    else:
        allowed_mask = None
        evidence_failed = True

    normalized_evidence_view_id = _canonical_source_view_id(side, evidence_view_id)
    for mark, exact_mask in exact_marks:
        fingerprint = None
        normalized_mark_view_id = _canonical_source_view_id(
            side, mark.get("sourceViewId")
        )
        if (
            fingerprint_trace is not None
            and not evidence_failed
            and allowed_mask is not None
            and normalized_evidence_view_id == normalized_mark_view_id
        ):
            try:
                fingerprint = fingerprint_trace(
                    evidence_image,
                    exact_mask,
                    allowed_mask,
                    inspection_frame,
                )
            except Exception:
                fingerprint = None
        evidence = (
            {
                "featureFingerprint": fingerprint,
                "featureFingerprintTraceSha256": mark["finalTrace"]["sha256"],
            }
            if fingerprint is not None
            else {}
        )
        evidence_by_id[mark["id"]] = evidence
        if fingerprint is None:
            trace_sources[mark["id"]].pop("featureFingerprint", None)
            trace_sources[mark["id"]].pop("featureFingerprintTraceSha256", None)
        else:
            trace_sources[mark["id"]].update(evidence)

    proposals = [
        {
            **{
                key: value
                for key, value in finding.items()
                if key not in {"canonicalContour", "canonicalMask", "measurement"}
            },
            "canonicalMask": mask,
            "confidence": float(finding["confidence"]),
        }
        for finding, mask in detector_mask_findings
    ] + [
        {
            **{
                key: value
                for key, value in finding.items()
                if key not in {"canonicalContour", "canonicalMask", "measurement"}
            },
            "canonicalMask": mask,
            "confidence": float(finding["confidence"]),
        }
        for finding, mask in trace_findings
        if finding["id"] not in exact_mark_ids
    ] + [
        {
            **{
                key: value
                for key, value in trace_sources[mark["id"]].items()
                if key
                not in {
                    "canonicalContour",
                    "canonicalMask",
                    "measurement",
                    "measurementRegions",
                    "zone",
                }
            },
            "canonicalMask": mask,
        }
        for mark, mask in exact_marks
    ]
    measured = measure_defects(proposals, corner_shape) if proposals else []
    for result in measured:
        evidence = evidence_by_id.get(result.get("proposalId"), {})
        result.update(evidence)
    defects = _to_speedster_defects(
        measured,
        side,
        "SMART_MARKED",
        trace_sources=trace_sources,
    )
    measured_ids = {defect["id"] for defect in defects}
    appended_trace_ids = set()
    for finding, _mask in trace_findings:
        if finding["id"] in measured_ids or finding["id"] in appended_trace_ids:
            continue
        defects.append(
            _trace_source_record(
                trace_sources[finding["id"]],
                None,
                side,
                finding.get("reviewResult", "SMART_MARKED"),
            )
        )
        appended_trace_ids.add(finding["id"])
    defects.extend(frozen_findings)
    return {
        "defects": defects,
        **({"traceErrors": trace_errors} if trace_errors else {}),
    }
