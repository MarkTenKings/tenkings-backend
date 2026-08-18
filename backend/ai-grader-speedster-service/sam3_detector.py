"""Single-model SAM 3 defect detection on the Speedster canonical grid."""

import hashlib
import json
import logging
import os
import platform
import re
import time
from contextlib import nullcontext
from copy import deepcopy
from threading import Lock
from typing import Optional, Protocol

import cv2
import numpy as np
from PIL import Image

from card_geometry import (
    EXPECTED_BOUNDARY_RESPONSE_PX,
    INSPECTION_HEIGHT,
    INSPECTION_MARGIN_PX,
    INSPECTION_WIDTH,
    crop_detector_mask_to_card,
    defect_candidates,
    detector_material_mask,
    expected_material_boundary_response_mask,
    material_distance_from_cut,
)
from defect_math import (
    CARD_HEIGHT_MM,
    CARD_WIDTH_MM,
    DEFECT_MULTIPLIERS,
    GRID_HEIGHT,
    GRID_WIDTH,
    measure_defects,
)
from sam_memory_v2 import (
    MEMORY_PROPOSAL_MAX_PER_TYPE_SIDE,
    MEMORY_PROPOSAL_SIMILARITY_THRESHOLD,
    decide_candidate_v2,
    prepare_bank_v2,
    smart_mark_proposal_seeds_v2,
)
from trace_rle import decode_trace_rle, encode_trace_rle


SAM3_REPOSITORY_COMMIT = "96914d2425f90a64f45ca977c2b5165418099543"
SAM3_REPOSITORY = "facebook/sam3"
SAM3_CHECKPOINT = "sam3.pt"
SAM3_CHECKPOINT_REVISION = "3c879f39826c281e95690f02c7821c4de09afae7"
SAM3_CHECKPOINT_SHA256 = "9999e2341ceef5e136daa386eecb55cb414446a00ac2b55eb2dfd2f7c3cf8c9e"
DETECTOR_VERSION = f"sam3-local-box-inspection-2mm@{SAM3_REPOSITORY_COMMIT}"
DETECTOR_IDENTITY_VERSION = "speedster-detector-identity-v1"
DETECTOR_PROMPT_VERSION = "sam3-box-and-smart-mark-point-v1"
DETECTOR_FUSION_VERSION = "speedster-side-wide-memory-cap-v2"
DETECTOR_MEASUREMENT_VERSION = "speedster-exact-canonical-mask-v1"
DETECTOR_MEMORY_VERSION = "sam-memory-v2"
MIN_SAM_AREA_MM2 = 0.02
MAX_SAM_AREA_MM2 = 120.0
PX_PER_MM = GRID_WIDTH / 63.5
FINGERPRINT_SIZE = 32
LEARNING_SCALE = 0.06
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
SMART_MARK_PROMPT_MAX_POSITIVE_POINTS = 16
SMART_MARK_PROMPT_MAX_NEGATIVE_POINTS = 16
SMART_MARK_NEGATIVE_SPACING_MM = 2.0
SMART_MARK_MATERIAL_PROJECTION_MAX_PX = round(3.18 * PX_PER_MM) + 2
TRACE_PROVENANCE_VERSION = "speedster-trace-provenance-v1"
TRACE_CROP_TRANSFORM_VERSION = "speedster-canonical-crop-affine-v1"


class MaskProcessor(Protocol):
    def scan(
        self,
        image: np.ndarray,
        candidates: list[dict],
        learning_bank: Optional[dict] = None,
        allowed_mask: Optional[np.ndarray] = None,
        source_view_id: Optional[str] = None,
        session_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        candidate_evidence: Optional[dict] = None,
    ) -> list[dict]: ...


DETECTOR_EVIDENCE_VERSION = "speedster-detector-evidence-v1"
RAW_CANDIDATE_VERSION = "speedster-raw-detector-candidate-v1"
MEMORY_DECISION_EVIDENCE_VERSION = "speedster-memory-decision-evidence-v1"
COLLECTION_CONFIDENCE_THRESHOLD = 0.5

_GIT_SHA = re.compile(r"^[a-f0-9]{40}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_OCI_DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")


def _required_environment(name: str, pattern: re.Pattern[str]) -> str:
    value = os.environ.get(name, "").strip()
    if not pattern.fullmatch(value):
        raise RuntimeError(f"{name} is missing or is not an immutable identity")
    return value


def _required_text_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value or len(value) > 240:
        raise RuntimeError(f"{name} is missing or invalid")
    return value


def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as checkpoint:
        for chunk in iter(lambda: checkpoint.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verified_checkpoint_path(download) -> tuple[str, str, str]:
    """Resolve an immutable Hub revision and verify its exact checkpoint bytes."""

    revision = os.environ.get(
        "SAM3_CHECKPOINT_REVISION", SAM3_CHECKPOINT_REVISION
    ).strip()
    expected_sha256 = os.environ.get(
        "SAM3_CHECKPOINT_SHA256", SAM3_CHECKPOINT_SHA256
    ).strip()
    if revision != SAM3_CHECKPOINT_REVISION or not _GIT_SHA.fullmatch(revision):
        raise RuntimeError(
            "SAM3_CHECKPOINT_REVISION does not match the approved immutable revision"
        )
    if expected_sha256 != SAM3_CHECKPOINT_SHA256 or not _SHA256.fullmatch(
        expected_sha256
    ):
        raise RuntimeError(
            "SAM3_CHECKPOINT_SHA256 does not match the approved checkpoint digest"
        )
    checkpoint_path = download(
        repo_id=SAM3_REPOSITORY,
        filename=SAM3_CHECKPOINT,
        revision=revision,
        token=True,
    )
    actual_sha256 = _sha256_file(checkpoint_path)
    if actual_sha256 != expected_sha256:
        raise RuntimeError(
            "Pinned SAM 3 checkpoint SHA-256 mismatch: refusing to start"
        )
    return checkpoint_path, revision, actual_sha256


def _configure_determinism(torch) -> dict:
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    return {
        "deterministicAlgorithms": bool(
            torch.are_deterministic_algorithms_enabled()
        ),
        "cudnnDeterministic": bool(torch.backends.cudnn.deterministic),
        "cudnnBenchmark": bool(torch.backends.cudnn.benchmark),
        "allowTf32": bool(
            torch.backends.cuda.matmul.allow_tf32
            or torch.backends.cudnn.allow_tf32
        ),
        "evalMode": True,
        "compile": False,
        "autocastDtype": "bfloat16",
    }


def _release_identity_inputs() -> dict:
    return {
        "sourceCommit": _required_environment(
            "SPEEDSTER_SOURCE_COMMIT_SHA", _GIT_SHA
        ),
        "sourceTree": _required_environment("SPEEDSTER_SOURCE_TREE_SHA", _GIT_SHA),
        "ociDigest": _required_environment("SPEEDSTER_OCI_IMAGE_DIGEST", _OCI_DIGEST),
        "sourceRepository": _required_text_environment("SPEEDSTER_SOURCE_REPOSITORY"),
        "buildId": _required_text_environment("SPEEDSTER_BUILD_ID"),
        "imageReference": _required_text_environment("SPEEDSTER_OCI_IMAGE_REFERENCE"),
    }


def _runtime_detector_identity(
    torch,
    checkpoint_revision: str,
    checkpoint_sha256: str,
    determinism: dict,
    release: dict,
) -> dict:
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable; Speedster detector refuses to start")
    device = torch.cuda.current_device()
    device_properties = torch.cuda.get_device_properties(device)
    capability = torch.cuda.get_device_capability(device)
    cudnn_version = torch.backends.cudnn.version()
    return {
        "version": DETECTOR_IDENTITY_VERSION,
        "detectorVersion": DETECTOR_VERSION,
        "source": {
            "repository": release["sourceRepository"],
            "commitSha": release["sourceCommit"],
            "treeSha": release["sourceTree"],
        },
        "runtime": {
            "ociDigest": release["ociDigest"],
            "ociDigestProvenance": "DEPLOYMENT_INJECTED",
            "ociImageReference": release["imageReference"],
            "buildId": release["buildId"],
            "buildIdentityProvenance": "OCI_IMAGE_ENV",
            "platform": f"{platform.system().lower()}/{platform.machine().lower()}",
            "pythonVersion": platform.python_version(),
            "frameworkVersion": f"sam3@{SAM3_REPOSITORY_COMMIT}",
            "torchVersion": str(torch.__version__),
            "cudaVersion": str(torch.version.cuda or "none"),
            "cudnnVersion": str(cudnn_version if cudnn_version is not None else "none"),
            "accelerator": str(device_properties.name),
            "gpuName": str(device_properties.name),
            "gpuCapability": f"{capability[0]}.{capability[1]}",
            "gpuCount": int(torch.cuda.device_count()),
        },
        "model": {
            "name": "sam3-speedster",
            "repository": SAM3_REPOSITORY,
            "revision": checkpoint_revision,
            "checkpointSha256": checkpoint_sha256,
            "sourceCommitSha": SAM3_REPOSITORY_COMMIT,
        },
        "policy": {
            "detectorVersion": DETECTOR_VERSION,
            "promptVersion": DETECTOR_PROMPT_VERSION,
            "fusionVersion": DETECTOR_FUSION_VERSION,
            "measurementVersion": DETECTOR_MEASUREMENT_VERSION,
            "memoryVersion": DETECTOR_MEMORY_VERSION,
        },
        "determinism": determinism,
    }


def _project_prompt_points_to_material(
    points: np.ndarray, material: np.ndarray
) -> np.ndarray:
    """Snap rounded-corner intent to the nearest physical material pixel."""

    projected = []
    height, width = material.shape
    for x, y in points:
        pixel_x = int(round(float(x)))
        pixel_y = int(round(float(y)))
        if material[pixel_y, pixel_x]:
            candidate = (float(x), float(y))
        else:
            radius = SMART_MARK_MATERIAL_PROJECTION_MAX_PX
            minimum_x = max(0, pixel_x - radius)
            maximum_x = min(width - 1, pixel_x + radius)
            minimum_y = max(0, pixel_y - radius)
            maximum_y = min(height - 1, pixel_y + radius)
            local_y, local_x = np.nonzero(
                material[minimum_y : maximum_y + 1, minimum_x : maximum_x + 1]
            )
            if len(local_x) == 0:
                raise ValueError("Smart-Mark stroke cannot reach physical card material")
            candidate_x = local_x + minimum_x
            candidate_y = local_y + minimum_y
            distances = (candidate_x - x) ** 2 + (candidate_y - y) ** 2
            nearest = int(np.argmin(distances))
            candidate = (float(candidate_x[nearest]), float(candidate_y[nearest]))
        if not projected or candidate != projected[-1]:
            projected.append(candidate)
    return np.asarray(projected, dtype=np.float32)


def _smart_mark_prompt_inputs(
    stroke_points: list[dict],
    stroke_width_mm: float,
    allowed_mask: np.ndarray,
    anomaly_residual_mask: np.ndarray,
    existing_trace_mask: np.ndarray,
    inspection_frame: dict,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Map intent to deterministic positive and proven-clean negative points."""

    material = np.asarray(allowed_mask) > 0
    residual = np.asarray(anomaly_residual_mask) > 0
    existing = np.asarray(existing_trace_mask) > 0
    if material.ndim != 2:
        raise ValueError("Smart-Mark material mask must be two-dimensional")
    if residual.shape != material.shape or existing.shape != material.shape:
        raise ValueError("Smart-Mark prompt exclusion masks do not match material")
    if not np.isfinite(stroke_width_mm) or stroke_width_mm <= 0:
        raise ValueError("Smart-Mark stroke width must be positive")
    if not stroke_points:
        raise ValueError("Smart-Mark stroke requires at least one point")

    height, width = material.shape
    bounds = inspection_frame.get("cardBounds", {})
    if (width, height) == (INSPECTION_WIDTH, INSPECTION_HEIGHT):
        expected_origin = (INSPECTION_MARGIN_PX, INSPECTION_MARGIN_PX)
    elif (width, height) == (GRID_WIDTH, GRID_HEIGHT):
        expected_origin = (0, 0)
    else:
        expected_origin = None
    if (
        expected_origin is None
        or inspection_frame.get("width") != width
        or inspection_frame.get("height") != height
        or bounds.get("width") != GRID_WIDTH
        or bounds.get("height") != GRID_HEIGHT
        or (bounds.get("x"), bounds.get("y")) != expected_origin
    ):
        raise ValueError("Smart-Mark inspection frame does not match prompt masks")

    mapped = []
    for point in stroke_points:
        x = float(point["x"])
        y = float(point["y"])
        if not np.isfinite(x) or not np.isfinite(y) or not (0 <= x <= 1 and 0 <= y <= 1):
            raise ValueError("Smart-Mark stroke point is outside the canonical card")
        pixel = (
            float(bounds["x"] + x * (bounds["width"] - 1)),
            float(bounds["y"] + y * (bounds["height"] - 1)),
        )
        if not mapped or pixel != mapped[-1]:
            mapped.append(pixel)
    full_mapped_points = _project_prompt_points_to_material(
        np.asarray(mapped, dtype=np.float32), material
    )

    positive_points = full_mapped_points
    if len(positive_points) > SMART_MARK_PROMPT_MAX_POSITIVE_POINTS:
        indexes = np.linspace(
            0,
            len(positive_points) - 1,
            SMART_MARK_PROMPT_MAX_POSITIVE_POINTS,
            dtype=np.int32,
        )
        positive_points = positive_points[indexes]

    corridor = np.zeros((height, width), dtype=np.uint8)
    integer_points = np.rint(full_mapped_points).astype(np.int32)
    stroke_width_px = max(1, round(stroke_width_mm * PX_PER_MM))
    if len(integer_points) == 1:
        cv2.circle(
            corridor,
            tuple(integer_points[0]),
            max(1, stroke_width_px // 2),
            1,
            thickness=-1,
        )
    else:
        cv2.polylines(
            corridor,
            [integer_points],
            False,
            1,
            thickness=stroke_width_px,
        )
    corridor &= material.astype(np.uint8)

    boundary_response = expected_material_boundary_response_mask_from_material(
        material
    )
    clean = material & ~(corridor > 0) & ~residual & ~existing & ~boundary_response
    if not np.any(clean):
        raise ValueError("No geometry-proven clean material exists for negative points")

    clean_distance = cv2.distanceTransform(clean.astype(np.uint8), cv2.DIST_L2, 5)
    spacing = max(1, round(SMART_MARK_NEGATIVE_SPACING_MM * PX_PER_MM))
    offset = spacing // 2
    candidates = [
        (float(clean_distance[y, x]), y, x)
        for y in range(offset, height, spacing)
        for x in range(offset, width, spacing)
        if clean[y, x]
    ]
    candidates.sort(key=lambda candidate: (-candidate[0], candidate[1], candidate[2]))
    negatives = []
    for _, y, x in candidates:
        if any(
            (x - prior_x) ** 2 + (y - prior_y) ** 2 < spacing**2
            for prior_x, prior_y in negatives
        ):
            continue
        negatives.append((x, y))
        if len(negatives) == SMART_MARK_PROMPT_MAX_NEGATIVE_POINTS:
            break
    if not negatives:
        y, x = np.argwhere(clean)[0]
        negatives.append((int(x), int(y)))

    negative_points = np.asarray(negatives, dtype=np.float32)
    points = np.concatenate((positive_points, negative_points), axis=0)
    labels = np.concatenate(
        (
            np.ones(len(positive_points), dtype=np.int32),
            np.zeros(len(negative_points), dtype=np.int32),
        )
    )
    return points, labels, corridor > 0


def expected_material_boundary_response_mask_from_material(
    material_mask_value: np.ndarray,
) -> np.ndarray:
    """Derive the same expected cut-response band from an existing material mask."""

    material = (np.asarray(material_mask_value) > 0).astype(np.uint8)
    distance_from_cut = material_distance_from_cut(material)
    return (material > 0) & (distance_from_cut <= EXPECTED_BOUNDARY_RESPONSE_PX)


def _normalize(values: np.ndarray) -> Optional[list[float]]:
    vector = np.asarray(values, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vector))
    if not np.isfinite(norm) or norm <= 0:
        return None
    return [round(float(value), 6) for value in vector / norm]


def feature_fingerprint(feature_map: np.ndarray, mask: np.ndarray) -> Optional[list[float]]:
    """Pools the existing SAM image features under one mask; it never runs the model."""

    features = np.asarray(feature_map, dtype=np.float32)
    if features.ndim != 3:
        return None
    channels, height, width = features.shape
    if channels < FINGERPRINT_SIZE:
        return None
    weights = cv2.resize(
        (np.asarray(mask) > 0).astype(np.float32),
        (width, height),
        interpolation=cv2.INTER_AREA,
    )
    weight_sum = float(weights.sum())
    if not np.isfinite(weight_sum) or weight_sum <= 0:
        return None
    pooled = (features * weights[None, :, :]).sum(axis=(1, 2)) / weight_sum
    compact = np.array(
        [group.mean() for group in np.array_split(pooled, FINGERPRINT_SIZE)],
        dtype=np.float32,
    )
    return _normalize(compact)


def _compact_normalized_feature_map(feature_map: np.ndarray) -> Optional[np.ndarray]:
    """Return the same 32-channel fingerprint space at every existing FPN cell."""

    features = np.asarray(feature_map, dtype=np.float32)
    if features.ndim != 3 or features.shape[0] < FINGERPRINT_SIZE:
        return None
    compact = np.stack(
        [group.mean(axis=0) for group in np.array_split(features, FINGERPRINT_SIZE)],
        axis=0,
    )
    norms = np.linalg.norm(compact, axis=0)
    normalized = np.zeros_like(compact)
    valid = np.isfinite(norms) & (norms > 0)
    normalized[:, valid] = compact[:, valid] / norms[valid]
    return normalized


def _memory_component_candidate(
    component: np.ndarray,
    *,
    image_width: int,
    image_height: int,
) -> Optional[dict]:
    component_image = cv2.resize(
        component.astype(np.uint8),
        (image_width, image_height),
        interpolation=cv2.INTER_NEAREST,
    )
    core_x, core_y, core_width, core_height = cv2.boundingRect(component_image)
    if core_width <= 0 or core_height <= 0:
        return None
    feature_height, feature_width = component.shape
    context_x = max(1, int(np.ceil(image_width / feature_width)))
    context_y = max(1, int(np.ceil(image_height / feature_height)))
    left = max(0, core_x - context_x)
    top = max(0, core_y - context_y)
    right = min(image_width, core_x + core_width + context_x)
    bottom = min(image_height, core_y + core_height + context_y)
    return {
        "box": (left, top, right - left, bottom - top),
        "coreBox": (core_x, core_y, core_width, core_height),
        "coreMask": component_image[
            core_y : core_y + core_height,
            core_x : core_x + core_width,
        ].astype(bool),
    }


def memory_proposal_candidates(
    feature_map: np.ndarray,
    prepared_bank,
    *,
    source_view_id: object,
    image_width: int,
    image_height: int,
    allowed_mask: np.ndarray,
) -> list[dict]:
    """Find tight explicit-Smart-Mark matches without another model or embedding."""

    compact = _compact_normalized_feature_map(feature_map)
    if compact is None:
        return []
    feature_height, feature_width = compact.shape[1:]
    allowed_cells = cv2.resize(
        (np.asarray(allowed_mask) > 0).astype(np.uint8),
        (feature_width, feature_height),
        interpolation=cv2.INTER_AREA,
    ) > 0
    card_x, card_y, card_width, card_height = cv2.boundingRect(
        (np.asarray(allowed_mask) > 0).astype(np.uint8)
    )
    matches = []
    for defect_type, seed in smart_mark_proposal_seeds_v2(
        prepared_bank, source_view_id
    ):
        similarity = np.tensordot(
            np.asarray(seed.fingerprint, dtype=np.float32),
            compact,
            axes=(0, 0),
        )
        thresholded = (
            np.isfinite(similarity)
            & (similarity >= MEMORY_PROPOSAL_SIMILARITY_THRESHOLD)
            & allowed_cells
        ).astype(np.uint8)
        component_count, labels = cv2.connectedComponents(thresholded, connectivity=8)
        for label in range(1, component_count):
            component = labels == label
            geometry = _memory_component_candidate(
                component,
                image_width=image_width,
                image_height=image_height,
            )
            if geometry is None:
                continue
            core_x, core_y, core_width, core_height = geometry["coreBox"]
            component_similarity = float(np.max(similarity[component]))
            matches.append(
                {
                    **geometry,
                    "canonicalMatchBox": (
                        (core_x - card_x) / card_width,
                        (core_y - card_y) / card_height,
                        core_width / card_width,
                        core_height / card_height,
                    ),
                    "defectType": defect_type,
                    "origin": "MEMORY",
                    "memoryProposal": {
                        "lessonSessionId": seed.session_id,
                        "lessonCompletionOrder": seed.completion_order,
                        "lessonProposalOrder": seed.proposal_order,
                        "lessonOrder": seed.lesson_order,
                        "lessonSourceViewId": seed.source_view_id,
                        "similarity": round(component_similarity, 6),
                    },
                }
            )

    matches.sort(
        key=lambda candidate: (
            candidate["defectType"],
            -candidate["memoryProposal"]["similarity"],
            candidate["memoryProposal"]["lessonCompletionOrder"],
            candidate["memoryProposal"]["lessonProposalOrder"],
            candidate["memoryProposal"]["lessonOrder"],
            candidate["memoryProposal"]["lessonSessionId"],
            candidate["box"],
        )
    )
    per_type = {}
    admitted_by_type = {}
    admitted = []
    for candidate in matches:
        defect_type = candidate["defectType"]
        count = per_type.get(defect_type, 0)
        if count >= MEMORY_PROPOSAL_MAX_PER_TYPE_SIDE:
            continue
        if any(
            _box_iou(
                candidate["canonicalMatchBox"],
                existing["canonicalMatchBox"],
            )
            >= 0.80
            for existing in admitted_by_type.get(defect_type, ())
        ):
            continue
        per_type[defect_type] = count + 1
        admitted_by_type.setdefault(defect_type, []).append(candidate)
        admitted.append(candidate)
    return admitted


def _cap_memory_candidates_per_side(candidates: list[dict]) -> list[dict]:
    """Keep the best three memory matches per type across every side view."""

    memory_indices_by_type = {}
    for index, candidate in enumerate(candidates):
        if candidate.get("origin") == "MEMORY":
            memory_indices_by_type.setdefault(candidate["defectType"], []).append(index)
    admitted_indices = set()
    for indices in memory_indices_by_type.values():
        ranked = sorted(
            indices,
            key=lambda index: (
                -candidates[index]["memoryProposal"]["similarity"],
                index,
            ),
        )
        distinct = []
        for index in ranked:
            candidate = candidates[index]
            duplicate = False
            for admitted_index in distinct:
                admitted = candidates[admitted_index]
                candidate_box = candidate.get("canonicalMatchBox", candidate.get("box"))
                admitted_box = admitted.get("canonicalMatchBox", admitted.get("box"))
                if (
                    candidate_box is not None
                    and admitted_box is not None
                    and _box_iou(candidate_box, admitted_box) >= 0.80
                ):
                    duplicate = True
                    break
            if duplicate:
                continue
            distinct.append(index)
            if len(distinct) >= MEMORY_PROPOSAL_MAX_PER_TYPE_SIDE:
                break
        admitted_indices.update(distinct)
    return [
        candidate
        for index, candidate in enumerate(candidates)
        if candidate.get("origin") != "MEMORY" or index in admitted_indices
    ]


def learning_adjustment(
    fingerprint: Optional[list[float]], defect_type: str, learning_bank: Optional[dict]
) -> float:
    if fingerprint is None or not isinstance(learning_bank, dict):
        return 0.0
    types = learning_bank.get("types")
    entry = types.get(defect_type) if isinstance(types, dict) else None
    if not isinstance(entry, dict):
        return 0.0

    vector = np.asarray(fingerprint, dtype=np.float32)

    def similarity(key: str) -> float:
        prototype = entry.get(key)
        if not isinstance(prototype, dict) or not prototype.get("count"):
            return 0.0
        values = prototype.get("sum")
        if not isinstance(values, list) or len(values) != len(vector):
            return 0.0
        candidate = np.asarray(values, dtype=np.float32)
        norm = float(np.linalg.norm(candidate))
        if not np.isfinite(norm) or norm <= 0:
            return 0.0
        return max(0.0, float(np.dot(vector, candidate / norm)))

    return round(
        float(
            np.clip(
                LEARNING_SCALE
                * (similarity("positive") - similarity("negative")),
                -LEARNING_SCALE,
                LEARNING_SCALE,
            )
        ),
        6,
    )


class Sam3ImageProcessor:
    """Lazily loads one official SAM 3 model and reuses its image embedding."""

    def __init__(self):
        self._processor = None
        self._detector_identity = None
        self._autocast = nullcontext
        self._lock = Lock()

    def load(self):
        if self._processor is None:
            import torch
            from huggingface_hub import hf_hub_download
            from sam3.model_builder import build_sam3_image_model
            from sam3.model.sam3_image_processor import Sam3Processor

            release_identity = _release_identity_inputs()
            checkpoint_path, checkpoint_revision, checkpoint_sha256 = (
                _verified_checkpoint_path(hf_hub_download)
            )
            determinism = _configure_determinism(torch)
            model = build_sam3_image_model(
                checkpoint_path=checkpoint_path,
                load_from_HF=False,
                device="cuda",
                eval_mode=True,
                enable_segmentation=True,
                enable_inst_interactivity=True,
                compile=False,
            )
            self._processor = Sam3Processor(model, confidence_threshold=0.5)
            self._autocast = lambda: torch.autocast(
                device_type="cuda", dtype=torch.bfloat16
            )
            self._detector_identity = _runtime_detector_identity(
                torch,
                checkpoint_revision,
                checkpoint_sha256,
                determinism,
                release_identity,
            )
        return self._processor

    def detector_identity(self) -> dict:
        if self._processor is None or self._detector_identity is None:
            raise RuntimeError("Speedster detector identity is unavailable before startup")
        return deepcopy(self._detector_identity)

    def propose_smart_mark_trace(
        self,
        image: np.ndarray,
        stroke_points: list[dict],
        stroke_width_mm: float,
        allowed_mask: np.ndarray,
        anomaly_residual_mask: np.ndarray,
        existing_trace_mask: np.ndarray,
        inspection_frame: dict,
    ) -> dict:
        """Run the pinned model's point head once; returned pixels are transient."""

        image_height, image_width = image.shape[:2]
        if allowed_mask.shape != (image_height, image_width):
            raise ValueError("Smart-Mark material mask does not match the evidence image")
        points, labels, corridor = _smart_mark_prompt_inputs(
            stroke_points,
            stroke_width_mm,
            allowed_mask,
            anomaly_residual_mask,
            existing_trace_mask,
            inspection_frame,
        )
        rgb_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

        with self._lock:
            processor = self.load()
            model = getattr(processor, "model", None)
            interactive = getattr(model, "inst_interactive_predictor", None)
            if interactive is None:
                raise RuntimeError("Pinned SAM 3 point-prompt head is unavailable")
            with self._autocast():
                state = processor.set_image(rgb_image)
                masks, scores, _ = model.predict_inst(
                    state,
                    point_coords=points,
                    point_labels=labels,
                    multimask_output=True,
                    # The pinned predictor defaults to normalized points; these
                    # are inspection-image pixel coordinates.
                    normalize_coords=False,
                )

        masks = np.asarray(masks)
        scores = np.asarray(scores, dtype=np.float32).reshape(-1)
        if masks.ndim == 2:
            masks = masks[None, :, :]
        if masks.ndim != 3 or len(masks) != len(scores):
            raise ValueError("SAM 3 returned invalid point-prompt masks")
        candidates = []
        for mask, score in zip(masks, scores):
            binary = np.asarray(mask) > 0
            if binary.shape != (image_height, image_width):
                binary = cv2.resize(
                    binary.astype(np.uint8),
                    (image_width, image_height),
                    interpolation=cv2.INTER_NEAREST,
                ).astype(bool)
            clipped = binary & (np.asarray(allowed_mask) > 0)
            if np.any(clipped & corridor):
                candidates.append((float(score), clipped))
        if not candidates:
            raise ValueError("SAM 3 point prompt produced no material trace")
        score, trace = max(candidates, key=lambda candidate: candidate[0])
        return {
            "mask": trace,
            "score": score,
            "promptAttempts": 1,
            "positivePointCount": int(np.count_nonzero(labels == 1)),
            "negativePointCount": int(np.count_nonzero(labels == 0)),
        }

    def fingerprint_saved_trace(
        self,
        image: np.ndarray,
        canonical_mask: np.ndarray,
        allowed_mask: np.ndarray,
        inspection_frame: dict,
    ) -> Optional[list[float]]:
        """Pool one saved exact trace in the existing feature space without a prompt."""

        image_height, image_width = image.shape[:2]
        if allowed_mask.shape != (image_height, image_width):
            raise ValueError("Speedster material mask does not match the evidence image")
        canonical = np.asarray(canonical_mask) > 0
        if canonical.shape != (GRID_HEIGHT, GRID_WIDTH) or not np.any(canonical):
            raise ValueError("Speedster saved trace is not a non-empty canonical mask")
        bounds = inspection_frame.get("cardBounds", {})
        if (image_width, image_height) == (INSPECTION_WIDTH, INSPECTION_HEIGHT):
            expected_origin = (INSPECTION_MARGIN_PX, INSPECTION_MARGIN_PX)
        elif (image_width, image_height) == (GRID_WIDTH, GRID_HEIGHT):
            expected_origin = (0, 0)
        else:
            expected_origin = None
        if (
            expected_origin is None
            or inspection_frame.get("width") != image_width
            or inspection_frame.get("height") != image_height
            or bounds.get("width") != GRID_WIDTH
            or bounds.get("height") != GRID_HEIGHT
            or (bounds.get("x"), bounds.get("y")) != expected_origin
        ):
            raise ValueError("Speedster inspection frame does not match the evidence image")

        evidence_trace = np.zeros((image_height, image_width), dtype=np.uint8)
        x, y = bounds["x"], bounds["y"]
        evidence_trace[y : y + GRID_HEIGHT, x : x + GRID_WIDTH] = canonical
        evidence_trace &= (np.asarray(allowed_mask) > 0).astype(np.uint8)
        if not np.any(evidence_trace):
            raise ValueError("Speedster saved trace leaves physical card material")
        rgb_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        with self._lock:
            processor = self.load()
            with self._autocast():
                state = processor.set_image(rgb_image)
                feature_map = self._feature_map(state)
        return feature_fingerprint(feature_map, evidence_trace)

    @staticmethod
    def _feature_map(state: dict) -> np.ndarray:
        # At the pinned official commit, image-model scalp=1 makes this final
        # FPN tensor B x 256 x 72 x 72 for the 1008px model input.
        return (
            state["backbone_out"]["backbone_fpn"][-1][0]
            .detach()
            .float()
            .cpu()
            .numpy()
        )

    @staticmethod
    def _scan_prompt_candidates(
        processor,
        state: dict,
        feature_map: np.ndarray,
        *,
        image_width: int,
        image_height: int,
        candidates: list[dict],
        allowed_mask: np.ndarray,
        learning_bank: Optional[dict],
        prepared_v2,
        source_view_id: Optional[str],
        session_id: Optional[str],
        trace_id: Optional[str],
        candidate_evidence: Optional[dict] = None,
    ) -> list[dict]:
        results = []
        for prompt_index, candidate in enumerate(candidates):
            x, y, width, height = candidate["box"]
            processor.reset_all_prompts(state)
            output = processor.add_geometric_prompt(
                box=[
                    (x + width / 2) / image_width,
                    (y + height / 2) / image_height,
                    width / image_width,
                    height / image_height,
                ],
                label=True,
                state=state,
            )
            masks = output["masks"].detach().float().cpu().numpy()
            scores = output["scores"].detach().float().cpu().numpy().reshape(-1)
            if masks.ndim < 3:
                raise RuntimeError("SAM 3 returned an invalid mask result")
            masks = masks.reshape((-1, masks.shape[-2], masks.shape[-1]))
            if len(masks) != len(scores):
                raise RuntimeError("SAM 3 returned mismatched masks and scores")

            best = None
            best_decision_record = None
            for mask_index, (mask, score) in enumerate(zip(masks, scores)):
                binary = np.asarray(mask) > 0
                if binary.shape != (image_height, image_width):
                    binary = cv2.resize(
                        binary.astype(np.uint8),
                        (image_width, image_height),
                        interpolation=cv2.INTER_NEAREST,
                    ).astype(bool)
                clipped = np.zeros_like(binary)
                clipped[y : y + height, x : x + width] = binary[
                    y : y + height, x : x + width
                ]
                clipped &= allowed_mask > 0
                core_x, core_y, core_width, core_height = candidate["coreBox"]
                core = candidate["coreMask"]
                if not np.any(
                    clipped[
                        core_y : core_y + core_height,
                        core_x : core_x + core_width,
                    ]
                    & core
                ):
                    continue
                area_mm2 = float(clipped.sum() / (PX_PER_MM**2))
                if not (MIN_SAM_AREA_MM2 <= area_mm2 <= MAX_SAM_AREA_MM2):
                    continue
                fingerprint = feature_fingerprint(feature_map, clipped)
                raw_confidence = float(score)
                canonical_mask = crop_detector_mask_to_card(clipped)
                raw_mask = encode_trace_rle(canonical_mask)
                evidence_ordinal = (
                    len(candidate_evidence["rawCandidates"])
                    if candidate_evidence is not None
                    else 0
                )
                candidate_id_preimage = json.dumps(
                    {
                        "evidenceOrdinal": evidence_ordinal,
                        "sourceViewId": source_view_id,
                        "promptIndex": prompt_index,
                        "maskIndex": mask_index,
                        "defectType": candidate["defectType"],
                        "origin": candidate.get("origin", "DETECTOR"),
                        "maskSha256": raw_mask["sha256"],
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode("utf-8")
                raw_candidate_id = (
                    "raw-" + hashlib.sha256(candidate_id_preimage).hexdigest()[:24]
                )
                diagnostic = None
                if prepared_v2 is not None:
                    decision = decide_candidate_v2(
                        prepared_v2,
                        fingerprint=fingerprint,
                        defect_type=candidate["defectType"],
                        source_view_id=source_view_id,
                        raw_confidence=raw_confidence,
                        session_id=session_id,
                        trace_id=trace_id,
                    )
                    LOGGER.info(
                        "sam_memory_decision %s",
                        json.dumps(
                            {
                                **decision["diagnostic"],
                                "proposalOrigin": candidate.get(
                                    "origin", "DETECTOR"
                                ),
                                **(
                                    {"memoryProposal": candidate["memoryProposal"]}
                                    if candidate.get("origin") == "MEMORY"
                                    else {}
                                ),
                            },
                            separators=(",", ":"),
                            sort_keys=True,
                        ),
                    )
                    diagnostic = decision["diagnostic"]
                    adjustment = decision["adjustment"]
                    memory_action = diagnostic["action"]
                    memory_policy = "SAM_MEMORY_V2"
                else:
                    adjustment = learning_adjustment(
                        fingerprint, candidate["defectType"], learning_bank
                    )
                    memory_action = "retained"
                    memory_policy = (
                        "LEGACY_MEMORY_V1"
                        if isinstance(learning_bank, dict)
                        else "NONE"
                    )
                adjusted_confidence = float(
                    np.clip(raw_confidence + adjustment, 0, 1)
                )
                if prepared_v2 is not None and decision["veto"]:
                    disposition = "VETOED_BY_MEMORY"
                elif adjusted_confidence < COLLECTION_CONFIDENCE_THRESHOLD:
                    disposition = "SUPPRESSED_BELOW_COLLECTION_THRESHOLD"
                else:
                    disposition = "RETAINED_FOR_PROMPT_OUTPUT"

                decision_record = {
                    "version": MEMORY_DECISION_EVIDENCE_VERSION,
                    "candidateId": raw_candidate_id,
                    "policy": memory_policy,
                    "action": memory_action,
                    "adjustment": adjustment,
                    "adjustedConfidence": adjusted_confidence,
                    "collectionThreshold": COLLECTION_CONFIDENCE_THRESHOLD,
                    "disposition": disposition,
                    **({"diagnostic": diagnostic} if diagnostic is not None else {}),
                }
                if candidate_evidence is not None:
                    candidate_evidence["rawCandidates"].append(
                        {
                            "version": RAW_CANDIDATE_VERSION,
                            "candidateId": raw_candidate_id,
                            "evidenceOrdinal": evidence_ordinal,
                            "sourceViewId": source_view_id,
                            "promptIndex": prompt_index,
                            "maskIndex": mask_index,
                            "promptBox": [x, y, width, height],
                            "defectType": candidate["defectType"],
                            "origin": candidate.get("origin", "DETECTOR"),
                            "rawConfidence": raw_confidence,
                            "featureFingerprint": fingerprint,
                            "canonicalMask": raw_mask,
                            **(
                                {"memoryProposal": candidate["memoryProposal"]}
                                if candidate.get("origin") == "MEMORY"
                                else {}
                            ),
                        }
                    )
                    candidate_evidence["memoryDecisions"].append(decision_record)
                if disposition in {
                    "VETOED_BY_MEMORY",
                    "SUPPRESSED_BELOW_COLLECTION_THRESHOLD",
                }:
                    continue
                if best is None or adjusted_confidence > best["rankingConfidence"]:
                    if best_decision_record is not None:
                        best_decision_record["disposition"] = (
                            "NOT_SELECTED_LOWER_ADJUSTED_CONFIDENCE"
                        )
                    best = {
                        "defectType": candidate["defectType"],
                        "confidence": raw_confidence,
                        "rankingConfidence": adjusted_confidence,
                        "learningAdjustment": adjustment,
                        "featureFingerprint": fingerprint,
                        "mask": canonical_mask,
                        "rawCandidateId": raw_candidate_id,
                        **(
                            {
                                "origin": "MEMORY",
                                "memoryProposal": candidate["memoryProposal"],
                            }
                            if candidate.get("origin") == "MEMORY"
                            else {}
                        ),
                    }
                    best_decision_record = decision_record
                else:
                    decision_record["disposition"] = (
                        "NOT_SELECTED_LOWER_ADJUSTED_CONFIDENCE"
                    )
            if best is not None:
                results.append(best)
        return results

    def scan(
        self,
        image: np.ndarray,
        candidates: list[dict],
        learning_bank: Optional[dict] = None,
        allowed_mask: Optional[np.ndarray] = None,
        source_view_id: Optional[str] = None,
        session_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        candidate_evidence: Optional[dict] = None,
    ) -> list[dict]:
        image_height, image_width = image.shape[:2]
        if allowed_mask is None:
            allowed_mask = np.ones((image_height, image_width), dtype=np.uint8)
        if allowed_mask.shape != (image_height, image_width):
            raise ValueError("Detector material mask does not match the image")
        prepared_v2 = prepare_bank_v2(learning_bank)
        rgb_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        with self._lock:
            processor = self.load()
            with self._autocast():
                state = processor.set_image(rgb_image)
                feature_map = self._feature_map(state)
                scan_candidates = list(candidates)
                if prepared_v2 is not None:
                    scan_candidates.extend(
                        memory_proposal_candidates(
                            feature_map,
                            prepared_v2,
                            source_view_id=source_view_id,
                            image_width=image_width,
                            image_height=image_height,
                            allowed_mask=allowed_mask,
                        )
                    )
                return self._scan_prompt_candidates(
                    processor,
                    state,
                    feature_map,
                    image_width=image_width,
                    image_height=image_height,
                    candidates=scan_candidates,
                    allowed_mask=allowed_mask,
                    learning_bank=learning_bank,
                    prepared_v2=prepared_v2,
                    source_view_id=source_view_id,
                    session_id=session_id,
                    trace_id=trace_id,
                    candidate_evidence=candidate_evidence,
                )

    def scan_side(
        self,
        views: list[dict],
        learning_bank: Optional[dict] = None,
        session_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        candidate_evidence: Optional[dict] = None,
    ) -> list[dict]:
        """Rank side-wide memory matches before at most three prompts per type."""

        prepared_v2 = prepare_bank_v2(learning_bank)
        with self._lock:
            processor = self.load()
            with self._autocast():
                prepared_views = []
                all_memory_candidates = []
                results_by_view = [None] * len(views)
                for view_index, view in enumerate(views):
                    image = view["image"]
                    image_height, image_width = image.shape[:2]
                    allowed_mask = view["allowedMask"]
                    if allowed_mask.shape != (image_height, image_width):
                        raise ValueError("Detector material mask does not match the image")
                    state = processor.set_image(
                        Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
                    )
                    feature_map = self._feature_map(state)
                    memory_candidates = (
                        memory_proposal_candidates(
                            feature_map,
                            prepared_v2,
                            source_view_id=view["sourceViewId"],
                            image_width=image_width,
                            image_height=image_height,
                            allowed_mask=allowed_mask,
                        )
                        if prepared_v2 is not None
                        else []
                    )
                    for candidate in memory_candidates:
                        candidate["_viewIndex"] = view_index
                    all_memory_candidates.extend(memory_candidates)
                    if not memory_candidates:
                        results_by_view[view_index] = self._scan_prompt_candidates(
                            processor,
                            state,
                            feature_map,
                            image_width=image_width,
                            image_height=image_height,
                            candidates=list(view["candidates"]),
                            allowed_mask=allowed_mask,
                            learning_bank=learning_bank,
                            prepared_v2=prepared_v2,
                            source_view_id=view["sourceViewId"],
                            session_id=session_id,
                            trace_id=trace_id,
                            candidate_evidence=candidate_evidence,
                        )
                        continue
                    prepared_views.append(
                        {
                            **view,
                            "viewIndex": view_index,
                            "state": state,
                            "featureMap": feature_map,
                            "imageWidth": image_width,
                            "imageHeight": image_height,
                        }
                    )

                selected_memory = _cap_memory_candidates_per_side(
                    all_memory_candidates
                )
                for view in prepared_views:
                    view_index = view["viewIndex"]
                    prompt_candidates = list(view["candidates"])
                    prompt_candidates.extend(
                        candidate
                        for candidate in selected_memory
                        if candidate["_viewIndex"] == view_index
                    )
                    scanned = self._scan_prompt_candidates(
                        processor,
                        view["state"],
                        view["featureMap"],
                        image_width=view["imageWidth"],
                        image_height=view["imageHeight"],
                        candidates=prompt_candidates,
                        allowed_mask=view["allowedMask"],
                        learning_bank=learning_bank,
                        prepared_v2=prepared_v2,
                        source_view_id=view["sourceViewId"],
                        session_id=session_id,
                        trace_id=trace_id,
                        candidate_evidence=candidate_evidence,
                    )
                    results_by_view[view_index] = scanned
                return [
                    {**candidate, "sourceViewId": views[view_index]["sourceViewId"]}
                    for view_index, scanned in enumerate(results_by_view)
                    for candidate in (scanned or [])
                ]

_processor = Sam3ImageProcessor()


def get_processor() -> MaskProcessor:
    return _processor


def get_detector_identity() -> dict:
    return _processor.detector_identity()


def _mask_contours(mask: np.ndarray) -> list[list[dict[str, float]]]:
    binary = (np.asarray(mask) > 0).astype(np.uint8)
    if binary.shape != (GRID_HEIGHT, GRID_WIDTH):
        binary = cv2.resize(
            binary,
            (GRID_WIDTH, GRID_HEIGHT),
            interpolation=cv2.INTER_NEAREST,
        )
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
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
        if len(contour) >= 3
    ]


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


def detect_views(
    views: list[tuple[str, np.ndarray]],
    side: str,
    corner_shape: str,
    processor: Optional[MaskProcessor] = None,
    learning_bank: Optional[dict] = None,
    session_id: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> dict:
    detect_started = time.perf_counter()
    active_processor = processor or get_processor()
    candidate_evidence = {
        "version": DETECTOR_EVIDENCE_VERSION,
        "rawCandidates": [],
        "memoryDecisions": [],
    }
    prepared_views = []
    view_diagnostics = []
    for view_id, image in views:
        localization_started = time.perf_counter()
        if image.shape[:2] == (INSPECTION_HEIGHT, INSPECTION_WIDTH):
            detector_image = image
        else:
            detector_image = cv2.resize(image, (GRID_WIDTH, GRID_HEIGHT))
        detector_height, detector_width = detector_image.shape[:2]
        allowed_mask = detector_material_mask(
            corner_shape, detector_width, detector_height
        )
        localized_candidates = defect_candidates(
            detector_image, corner_shape, view_id
        )
        view_diagnostics.append(
            {
                "viewId": view_id,
                "candidateCount": len(localized_candidates),
                "localizationMs": round(
                    (time.perf_counter() - localization_started) * 1000, 3
                ),
            }
        )
        prepared_views.append(
            {
                "sourceViewId": view_id,
                "image": detector_image,
                "candidates": localized_candidates,
                "allowedMask": allowed_mask,
            }
        )

    scan_started = time.perf_counter()
    if hasattr(active_processor, "scan_side"):
        scanned_candidates = active_processor.scan_side(
            prepared_views,
            learning_bank,
            session_id=session_id,
            trace_id=trace_id,
            candidate_evidence=candidate_evidence,
        )
    else:
        scanned_candidates = []
        for view in prepared_views:
            for candidate in active_processor.scan(
                view["image"],
                view["candidates"],
                learning_bank,
                view["allowedMask"],
                source_view_id=view["sourceViewId"],
                session_id=session_id,
                trace_id=trace_id,
                candidate_evidence=candidate_evidence,
            ):
                scanned_candidates.append(
                    {**candidate, "sourceViewId": view["sourceViewId"]}
                )
    scan_duration_ms = round((time.perf_counter() - scan_started) * 1000, 3)

    proposals = []
    capped_candidates = _cap_memory_candidates_per_side(scanned_candidates)
    retained_raw_candidate_ids = {
        candidate["rawCandidateId"]
        for candidate in capped_candidates
        if candidate.get("rawCandidateId") is not None
    }
    for decision in candidate_evidence["memoryDecisions"]:
        if decision["disposition"] != "RETAINED_FOR_PROMPT_OUTPUT":
            continue
        decision["disposition"] = (
            "RETAINED_FOR_MEASUREMENT"
            if decision["candidateId"] in retained_raw_candidate_ids
            else "SUPPRESSED_BY_SIDE_MEMORY_CAP"
        )
    for proposal_index, candidate in enumerate(capped_candidates):
        proposals.append(
            {
                "instrumentationProposalId": f"{side}:{proposal_index}",
                "canonicalMask": np.asarray(candidate["mask"]).copy(),
                "sourceViewId": candidate["sourceViewId"],
                "defectType": candidate["defectType"],
                "confidence": candidate["confidence"],
                "rankingConfidence": candidate.get(
                    "rankingConfidence", candidate["confidence"]
                ),
                "learningAdjustment": candidate.get("learningAdjustment", 0.0),
                "featureFingerprint": candidate.get("featureFingerprint"),
                "rawCandidateId": candidate.get("rawCandidateId"),
                **(
                    {
                        "origin": "MEMORY",
                        "memoryProposal": candidate["memoryProposal"],
                    }
                    if candidate.get("origin") == "MEMORY"
                    else {}
                ),
            }
        )

    measurement_started = time.perf_counter()
    measured = measure_defects(proposals, corner_shape)
    measurement_duration_ms = round(
        (time.perf_counter() - measurement_started) * 1000, 3
    )
    identity_reader = getattr(active_processor, "detector_identity", None)
    try:
        detector_identity = identity_reader() if callable(identity_reader) else None
    except RuntimeError:
        if active_processor is _processor:
            raise
        detector_identity = None
    return {
        "detectorVersion": DETECTOR_VERSION,
        **(
            {"detectorIdentity": detector_identity}
            if detector_identity is not None
            else {}
        ),
        "defects": _to_speedster_defects(measured, side, "UNREVIEWED"),
        "detectorEvidence": candidate_evidence,
        "instrumentation": {
            "views": view_diagnostics,
            "localizedCandidateCount": sum(
                view["candidateCount"] for view in view_diagnostics
            ),
            "scannedCandidateCount": len(scanned_candidates),
            "cappedCandidateCount": len(capped_candidates),
            "measuredRegionCount": len(measured),
            "rawCandidateEvidenceCount": len(candidate_evidence["rawCandidates"]),
            "memoryDecisionEvidenceCount": len(
                candidate_evidence["memoryDecisions"]
            ),
            "samMemoryMs": scan_duration_ms,
            "measurementMs": measurement_duration_ms,
            "detectViewsTotalMs": round(
                (time.perf_counter() - detect_started) * 1000, 3
            ),
        },
    }


def _box_iou(first: tuple[int, int, int, int], second: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = first
    bx, by, bw, bh = second
    left, top = max(ax, bx), max(ay, by)
    right, bottom = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    intersection = max(0, right - left) * max(0, bottom - top)
    union = aw * ah + bw * bh - intersection
    return intersection / union if union > 0 else 0.0


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
    evidence_image: Optional[np.ndarray] = None,
    evidence_view_id: Optional[str] = None,
    inspection_frame: Optional[dict] = None,
    evidence_failed: bool = False,
    processor=None,
    findings: Optional[list[dict]] = None,
) -> dict:
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
    legacy_findings = []
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
            # Contour-era active findings remain dual-readable and participate
            # in the same overlap pass. Published history never calls /measure.
            legacy_findings.append(finding)

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
            not evidence_failed
            and allowed_mask is not None
            and normalized_evidence_view_id == normalized_mark_view_id
        ):
            try:
                fingerprint = (processor or get_processor()).fingerprint_saved_trace(
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
            **finding,
            "confidence": float(finding["confidence"]),
        }
        for finding in legacy_findings
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
    for finding in legacy_findings:
        if finding["id"] in measured_ids:
            continue
        defects.append(
            {
                **finding,
                "measurement": {
                    "widthMm": 0.0,
                    "heightMm": 0.0,
                    "areaMm2": 0.0,
                    "zonePercent": 0.0,
                    "multiplier": DEFECT_MULTIPLIERS[finding["defectType"]],
                    "weightedAreaMm2": 0.0,
                    "subgradeEffect": 0.0,
                },
            }
        )
    defects.extend(frozen_findings)
    return {
        "defects": defects,
        **({"traceErrors": trace_errors} if trace_errors else {}),
    }
