"""Bounded, veto-only SAM Memory V2 candidate decisions."""

from dataclasses import dataclass
from datetime import datetime
from math import isfinite, sqrt
from typing import Optional


BANK_VERSION = 2
CAPACITY_PER_TYPE_POLARITY = 50
FINGERPRINT_SIZE = 32
FINGERPRINT_VERSION = (
    "sam3-fpn32-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543"
)
LEARNING_SCALE = 0.06
POLICY_TAU = 0.80
POLICY_MARGIN = 0.10
POLICY_TAU_MIN = 0.70
POLICY_TAU_MAX = 0.95
POLICY_MARGIN_MIN = 0.03
POLICY_MARGIN_MAX = 0.20
MEMORY_PROPOSAL_SIMILARITY_THRESHOLD = 0.90
MEMORY_PROPOSAL_MAX_PER_TYPE_SIDE = 3

DEFECT_TYPES = {
    "FAINT_COLOR_VARIATION",
    "VISIBLE_WHITENING",
    "FRAYING",
    "CHIPPING_EXPOSED_STOCK",
    "LIFTING_DEFORMATION",
    "LIGHT_SCRATCH_SCUFF",
    "VISIBLE_SCRATCH_PRINT_COATING_LOSS",
    "DENT_MATERIAL_DAMAGE",
    "PEELING_HEAVY_DAMAGE",
}
SOURCE_VIEWS = {"ORIGINAL", "NORMALIZED", "MICRO_DEFECT", "DIRECTIONAL"}
POLARITIES = {"POSITIVE", "NEGATIVE"}
PROVENANCE = {
    "DETECTOR_REMOVED",
    "DETECTOR_RELABELED_NEGATIVE",
    "DETECTOR_RELABELED_POSITIVE",
    "SMART_MARK_POSITIVE",
    "UNTOUCHED_ACCEPTED_POSITIVE",
}


@dataclass(frozen=True)
class PreparedExemplarV2:
    fingerprint: tuple[float, ...]
    session_id: str
    provenance: str
    completion_order: int
    proposal_order: int
    lesson_order: int
    source_view_id: str


@dataclass(frozen=True)
class PreparedBankV2:
    status: str
    fingerprint_version: Optional[str]
    tau: Optional[float]
    margin: Optional[float]
    exemplars: dict[tuple[str, str, str], tuple[PreparedExemplarV2, ...]]


def _integer(value: object, minimum: int) -> bool:
    return type(value) is int and value >= minimum


def _timestamp(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _number(value: object) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    converted = float(value)
    return converted if isfinite(converted) else None


def _unit_fingerprint(value: object) -> Optional[tuple[float, ...]]:
    if not isinstance(value, list) or len(value) != FINGERPRINT_SIZE:
        return None
    vector = []
    for part in value:
        number = _number(part)
        if number is None:
            return None
        vector.append(number)
    norm = sqrt(sum(part * part for part in vector))
    if not isfinite(norm) or norm <= 0 or abs(norm - 1.0) > 0.0001:
        return None
    return tuple(part / norm for part in vector)


def normalize_source_view(value: object) -> Optional[str]:
    if not isinstance(value, str):
        return None
    if value.startswith("FRONT:"):
        value = value[len("FRONT:") :]
    elif value.startswith("BACK:"):
        value = value[len("BACK:") :]
    return value if value in SOURCE_VIEWS else None


def _inactive(status: str, fingerprint_version: object = None) -> PreparedBankV2:
    return PreparedBankV2(
        status=status,
        fingerprint_version=(
            fingerprint_version if isinstance(fingerprint_version, str) else None
        ),
        tau=None,
        margin=None,
        exemplars={},
    )


def prepare_bank_v2(value: object) -> Optional[PreparedBankV2]:
    """Read one V2 bank once. V1/non-V2 input returns None; unsafe V2 is inert."""

    if not isinstance(value, dict) or value.get("version") != BANK_VERSION:
        return None
    fingerprint_version = value.get("fingerprintVersion")
    if type(value.get("version")) is not int:
        return _inactive("malformed", fingerprint_version)
    if fingerprint_version != FINGERPRINT_VERSION:
        return _inactive("incompatible", fingerprint_version)
    if not _integer(value.get("capacityPerTypePolarity"), CAPACITY_PER_TYPE_POLARITY):
        return _inactive("malformed", fingerprint_version)
    if value.get("capacityPerTypePolarity") != CAPACITY_PER_TYPE_POLARITY:
        return _inactive("malformed", fingerprint_version)

    calibration = value.get("calibration")
    if not isinstance(calibration, dict):
        return _inactive("malformed", fingerprint_version)
    if calibration.get("status") == "UNCALIBRATED":
        if calibration.get("tau") is None and calibration.get("margin") is None:
            return _inactive("uncalibrated", fingerprint_version)
        return _inactive("malformed", fingerprint_version)
    if calibration.get("status") != "CALIBRATED":
        return _inactive("malformed", fingerprint_version)
    tau = _number(calibration.get("tau"))
    margin = _number(calibration.get("margin"))
    if (
        tau is None
        or margin is None
        or not (POLICY_TAU_MIN <= tau <= POLICY_TAU_MAX)
        or not (POLICY_MARGIN_MIN <= margin <= POLICY_MARGIN_MAX)
    ):
        return _inactive("malformed", fingerprint_version)

    raw_exemplars = value.get("exemplars")
    if not isinstance(raw_exemplars, list) or len(raw_exemplars) > (
        len(DEFECT_TYPES) * len(POLARITIES) * CAPACITY_PER_TYPE_POLARITY
    ):
        return _inactive("malformed", fingerprint_version)

    grouped: dict[tuple[str, str, str], list[PreparedExemplarV2]] = {}
    counts: dict[tuple[str, str], int] = {}
    for exemplar in raw_exemplars:
        if not isinstance(exemplar, dict):
            return _inactive("malformed", fingerprint_version)
        defect_type = exemplar.get("defectType")
        polarity = exemplar.get("polarity")
        source_view = exemplar.get("sourceViewId")
        session_id = exemplar.get("sessionId")
        fingerprint = _unit_fingerprint(exemplar.get("fingerprint"))
        if (
            defect_type not in DEFECT_TYPES
            or polarity not in POLARITIES
            or source_view not in SOURCE_VIEWS
            or exemplar.get("provenance") not in PROVENANCE
            or not isinstance(session_id, str)
            or not session_id.strip()
            or not _timestamp(exemplar.get("completedAt"))
            or not _integer(exemplar.get("completionOrder"), 1)
            or not _integer(exemplar.get("proposalOrder"), 0)
            or not _integer(exemplar.get("lessonOrder"), 0)
            or fingerprint is None
        ):
            return _inactive("malformed", fingerprint_version)
        count_key = (defect_type, polarity)
        counts[count_key] = counts.get(count_key, 0) + 1
        if counts[count_key] > CAPACITY_PER_TYPE_POLARITY:
            return _inactive("malformed", fingerprint_version)
        grouped.setdefault((defect_type, polarity, source_view), []).append(
            PreparedExemplarV2(
                fingerprint=fingerprint,
                session_id=session_id.strip(),
                provenance=exemplar.get("provenance"),
                completion_order=exemplar.get("completionOrder"),
                proposal_order=exemplar.get("proposalOrder"),
                lesson_order=exemplar.get("lessonOrder"),
                source_view_id=source_view,
            )
        )

    return PreparedBankV2(
        status="calibrated",
        fingerprint_version=FINGERPRINT_VERSION,
        tau=tau,
        margin=margin,
        exemplars={key: tuple(entries) for key, entries in grouped.items()},
    )


def _maximum_similarity(
    fingerprint: tuple[float, ...],
    exemplars: tuple[PreparedExemplarV2, ...],
) -> tuple[Optional[float], Optional[str]]:
    best_similarity = None
    best_session_id = None
    for exemplar in exemplars:
        similarity = max(
            0.0,
            sum(a * b for a, b in zip(fingerprint, exemplar.fingerprint)),
        )
        if best_similarity is None or similarity > best_similarity:
            best_similarity = similarity
            best_session_id = exemplar.session_id
    return best_similarity, best_session_id


def smart_mark_proposal_seeds_v2(
    prepared: PreparedBankV2,
    source_view_id: object,
) -> tuple[tuple[str, PreparedExemplarV2], ...]:
    """Return only explicit human Smart-Marks that may originate proposals."""

    source_view = normalize_source_view(source_view_id)
    if prepared.status != "calibrated" or source_view is None:
        return ()
    seeds = []
    for defect_type in sorted(DEFECT_TYPES):
        for exemplar in prepared.exemplars.get(
            (defect_type, "POSITIVE", source_view), ()
        ):
            if exemplar.provenance == "SMART_MARK_POSITIVE":
                seeds.append((defect_type, exemplar))
    return tuple(seeds)


def decide_candidate_v2(
    prepared: PreparedBankV2,
    *,
    fingerprint: object,
    defect_type: object,
    source_view_id: object,
    raw_confidence: float,
    session_id: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> dict:
    """Return one inert or calibrated V2 decision without changing raw confidence."""

    source_view = normalize_source_view(source_view_id)
    candidate_fingerprint = _unit_fingerprint(fingerprint)
    positive_max = gentle_positive_max = negative_max = None
    positive_session_id = gentle_positive_session_id = negative_session_id = None
    adjustment = 0.0
    action = "retained"

    if (
        prepared.status == "calibrated"
        and isinstance(defect_type, str)
        and defect_type in DEFECT_TYPES
        and source_view is not None
        and candidate_fingerprint is not None
    ):
        positive_exemplars = prepared.exemplars.get(
            (defect_type, "POSITIVE", source_view), ()
        )
        gentle_positive_max, gentle_positive_session_id = _maximum_similarity(
            candidate_fingerprint,
            positive_exemplars,
        )
        positive_max, positive_session_id = _maximum_similarity(
            candidate_fingerprint,
            tuple(
                exemplar
                for exemplar in positive_exemplars
                if exemplar.provenance != "UNTOUCHED_ACCEPTED_POSITIVE"
            ),
        )
        negative_max, negative_session_id = _maximum_similarity(
            candidate_fingerprint,
            prepared.exemplars.get((defect_type, "NEGATIVE", source_view), ()),
        )
        positive_value = positive_max or 0.0
        gentle_positive_value = gentle_positive_max or 0.0
        negative_value = negative_max or 0.0
        adjustment = round(
            max(
                -LEARNING_SCALE,
                min(
                    LEARNING_SCALE,
                    LEARNING_SCALE * (gentle_positive_value - negative_value),
                ),
            ),
            6,
        )
        strong_negative = negative_max is not None and negative_max >= prepared.tau
        if strong_negative and negative_max - positive_value >= prepared.margin:
            action = "vetoed"
        elif strong_negative:
            action = "protected"

    diagnostic = {
        "traceId": trace_id,
        "sessionId": session_id,
        "proposedType": defect_type,
        "sourceViewId": source_view if source_view is not None else source_view_id,
        "rawConfidence": raw_confidence,
        "positiveMax": positive_max,
        "positiveMatchSessionId": positive_session_id,
        "gentlePositiveMax": gentle_positive_max,
        "gentlePositiveMatchSessionId": gentle_positive_session_id,
        "negativeMax": negative_max,
        "negativeMatchSessionId": negative_session_id,
        "tau": prepared.tau,
        "margin": prepared.margin,
        "gentleAdjustment": adjustment,
        "action": action,
        "bankStatus": prepared.status,
        "bankVersion": BANK_VERSION,
        "fingerprintVersion": prepared.fingerprint_version,
    }
    return {
        "veto": action == "vetoed",
        "adjustment": adjustment,
        "diagnostic": diagnostic,
    }
