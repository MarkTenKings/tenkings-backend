"""Single-model SAM 3 defect detection on the Speedster canonical grid."""

import hashlib
import json
import logging
from contextlib import nullcontext
from threading import Lock
from typing import Optional, Protocol

import cv2
import numpy as np
from PIL import Image

from card_geometry import (
    INSPECTION_HEIGHT,
    INSPECTION_MARGIN_PX,
    INSPECTION_WIDTH,
    crop_detector_mask_to_card,
    defect_candidates,
    detector_material_mask,
)
from defect_math import DEFECT_MULTIPLIERS, GRID_HEIGHT, GRID_WIDTH, measure_defects
from sam_memory_v2 import (
    MEMORY_PROPOSAL_MAX_PER_TYPE_SIDE,
    MEMORY_PROPOSAL_SIMILARITY_THRESHOLD,
    decide_candidate_v2,
    prepare_bank_v2,
    smart_mark_proposal_seeds_v2,
)


SAM3_REPOSITORY_COMMIT = "96914d2425f90a64f45ca977c2b5165418099543"
SAM3_CHECKPOINT = "sam3.pt"
DETECTOR_VERSION = f"sam3-local-box-inspection-2mm@{SAM3_REPOSITORY_COMMIT}"
MIN_SAM_AREA_MM2 = 0.02
MAX_SAM_AREA_MM2 = 120.0
PX_PER_MM = GRID_WIDTH / 63.5
FINGERPRINT_SIZE = 32
LEARNING_SCALE = 0.06
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
SMART_MARK_TRACE_MIN_INSIDE = 0.80
SMART_MARK_TRACE_MIN_BOX_AREA = 0.10
SMART_MARK_TRACE_MAX_BOX_AREA = 1.00
SMART_MARK_PROPOSAL_IOU_THRESHOLD = 0.30


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
    ) -> list[dict]: ...


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
        self._autocast = nullcontext
        self._lock = Lock()

    def load(self):
        if self._processor is None:
            import torch
            from huggingface_hub import hf_hub_download
            from sam3.model_builder import build_sam3_image_model
            from sam3.model.sam3_image_processor import Sam3Processor

            checkpoint_path = hf_hub_download(
                repo_id="facebook/sam3",
                filename=SAM3_CHECKPOINT,
                token=True,
            )
            model = build_sam3_image_model(
                checkpoint_path=checkpoint_path,
                load_from_HF=False,
                device="cuda",
                eval_mode=True,
                enable_segmentation=True,
                enable_inst_interactivity=False,
                compile=False,
            )
            self._processor = Sam3Processor(model, confidence_threshold=0.5)
            self._autocast = lambda: torch.autocast(
                device_type="cuda", dtype=torch.bfloat16
            )
        return self._processor

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
    ) -> list[dict]:
        results = []
        for candidate in candidates:
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
            for mask, score in zip(masks, scores):
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
                    if decision["veto"]:
                        continue
                    adjustment = decision["adjustment"]
                else:
                    adjustment = learning_adjustment(
                        fingerprint, candidate["defectType"], learning_bank
                    )
                adjusted_confidence = float(
                    np.clip(raw_confidence + adjustment, 0, 1)
                )
                if adjusted_confidence < 0.5:
                    continue
                if best is None or adjusted_confidence > best["rankingConfidence"]:
                    best = {
                        "defectType": candidate["defectType"],
                        "confidence": raw_confidence,
                        "rankingConfidence": adjusted_confidence,
                        "learningAdjustment": adjustment,
                        "featureFingerprint": fingerprint,
                        "mask": crop_detector_mask_to_card(clipped),
                        **(
                            {
                                "origin": "MEMORY",
                                "memoryProposal": candidate["memoryProposal"],
                            }
                            if candidate.get("origin") == "MEMORY"
                            else {}
                        ),
                    }
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
                )

    def scan_side(
        self,
        views: list[dict],
        learning_bank: Optional[dict] = None,
        session_id: Optional[str] = None,
        trace_id: Optional[str] = None,
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
                    )
                    results_by_view[view_index] = scanned
                return [
                    {**candidate, "sourceViewId": views[view_index]["sourceViewId"]}
                    for view_index, scanned in enumerate(results_by_view)
                    for candidate in (scanned or [])
                ]

    def fingerprint_smart_mark(
        self,
        image: np.ndarray,
        human_box_mask: np.ndarray,
        allowed_mask: np.ndarray,
    ) -> dict:
        """Fingerprint one human mark without changing its authoritative geometry."""

        image_height, image_width = image.shape[:2]
        if human_box_mask.shape != (image_height, image_width):
            raise ValueError("Smart-Mark box mask does not match the evidence image")
        if allowed_mask.shape != (image_height, image_width):
            raise ValueError("Smart-Mark material mask does not match the evidence image")
        human_box = np.asarray(human_box_mask) > 0
        on_card_box = human_box & (np.asarray(allowed_mask) > 0)
        if not np.any(on_card_box):
            raise ValueError("Smart-Mark does not intersect physical card material")
        x, y, width, height = cv2.boundingRect(human_box.astype(np.uint8))
        rgb_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

        with self._lock:
            processor = self.load()
            with self._autocast():
                state = processor.set_image(rgb_image)
                feature_map = (
                    state["backbone_out"]["backbone_fpn"][-1][0]
                    .detach()
                    .float()
                    .cpu()
                    .numpy()
                )
                output = None
                trace_attempts = 0
                for attempt in range(2):
                    trace_attempts = attempt + 1
                    try:
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
                        break
                    except Exception:
                        if attempt == 1:
                            output = None

                valid_trace = None
                if output is not None:
                    try:
                        masks = output["masks"].detach().float().cpu().numpy()
                        scores = output["scores"].detach().float().cpu().numpy().reshape(-1)
                        masks = masks.reshape((-1, masks.shape[-2], masks.shape[-1]))
                        if len(masks) != len(scores):
                            raise ValueError("SAM 3 returned mismatched Smart-Mark masks and scores")
                        candidates = []
                        on_card_box_area = int(np.count_nonzero(on_card_box))
                        for mask, score in zip(masks, scores):
                            binary = np.asarray(mask) > 0
                            if binary.shape != (image_height, image_width):
                                binary = cv2.resize(
                                    binary.astype(np.uint8),
                                    (image_width, image_height),
                                    interpolation=cv2.INTER_NEAREST,
                                ).astype(bool)
                            on_card_trace = binary & (np.asarray(allowed_mask) > 0)
                            trace_area = int(np.count_nonzero(on_card_trace))
                            inside = on_card_trace & human_box
                            inside_area = int(np.count_nonzero(inside))
                            inside_fraction = inside_area / trace_area if trace_area else 0.0
                            area_ratio = trace_area / on_card_box_area
                            if (
                                inside_fraction >= SMART_MARK_TRACE_MIN_INSIDE
                                and SMART_MARK_TRACE_MIN_BOX_AREA
                                <= area_ratio
                                <= SMART_MARK_TRACE_MAX_BOX_AREA
                            ):
                                candidates.append((float(score), inside))
                        if candidates:
                            valid_trace = max(candidates, key=lambda entry: entry[0])[1]
                    except Exception:
                        valid_trace = None

                if valid_trace is not None:
                    fingerprint = feature_fingerprint(feature_map, valid_trace)
                    if fingerprint is not None:
                        return {
                            "featureFingerprint": fingerprint,
                            "fingerprintProvenance": "SAM_TRACE",
                            "traceAttempts": trace_attempts,
                        }

                fingerprint = feature_fingerprint(feature_map, on_card_box)
                if fingerprint is not None:
                    return {
                        "featureFingerprint": fingerprint,
                        "fingerprintProvenance": "HUMAN_BOX_POOL",
                        "traceAttempts": trace_attempts,
                    }
                return {
                    "featureFingerprint": None,
                    "fingerprintProvenance": "HARD_FAILURE",
                    "traceAttempts": trace_attempts,
                }


_processor = Sam3ImageProcessor()


def get_processor() -> MaskProcessor:
    return _processor


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


def _to_speedster_defects(
    measured: list[dict], side: str, review_result: str
) -> list[dict]:
    weighted_percent_by_zone = {}
    for result in measured:
        weighted_percent_by_zone[result["zone"]] = weighted_percent_by_zone.get(
            result["zone"], 0.0
        ) + result["eligibleZonePercent"] * result["multiplier"]

    side_weight = 0.7 if side == "FRONT" else 0.3
    defects = []
    for index, result in enumerate(measured):
        contour = max(result["canonicalContours"], key=len)
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
                "canonicalContour": contour,
                "sourceViewId": result["sourceViewId"],
                "supportingViewIds": result["supportingViewIds"],
                "reviewResult": result.get("reviewResult", review_result),
                "measurement": {
                    "widthMm": result["widthMm"],
                    "heightMm": result["heightMm"],
                    "areaMm2": result["areaMm2"],
                    "zonePercent": result["eligibleZonePercent"],
                    "multiplier": result["multiplier"],
                    "weightedAreaMm2": result["weightedAreaMm2"],
                    "subgradeEffect": subgrade_effect,
                },
            }
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
    active_processor = processor or get_processor()
    prepared_views = []
    for view_id, image in views:
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
        prepared_views.append(
            {
                "sourceViewId": view_id,
                "image": detector_image,
                "candidates": localized_candidates,
                "allowedMask": allowed_mask,
            }
        )

    if hasattr(active_processor, "scan_side"):
        scanned_candidates = active_processor.scan_side(
            prepared_views,
            learning_bank,
            session_id=session_id,
            trace_id=trace_id,
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
            ):
                scanned_candidates.append(
                    {**candidate, "sourceViewId": view["sourceViewId"]}
                )

    proposals = []
    for candidate in _cap_memory_candidates_per_side(scanned_candidates):
        for contour in _mask_contours(candidate["mask"]):
            proposals.append(
                {
                    "canonicalContour": contour,
                    "sourceViewId": candidate["sourceViewId"],
                    "defectType": candidate["defectType"],
                    "confidence": candidate["confidence"],
                    "rankingConfidence": candidate.get(
                        "rankingConfidence", candidate["confidence"]
                    ),
                    "learningAdjustment": candidate.get("learningAdjustment", 0.0),
                    "featureFingerprint": candidate.get("featureFingerprint"),
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

    measured = measure_defects(proposals, corner_shape)
    return {
        "detectorVersion": DETECTOR_VERSION,
        "defects": _to_speedster_defects(measured, side, "UNREVIEWED"),
    }


def _smart_mark_mask(
    contour: list[dict], image_shape: tuple[int, int], inspection_frame: dict
) -> np.ndarray:
    height, width = image_shape
    bounds = inspection_frame["cardBounds"]
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
        raise ValueError("Smart-Mark inspection frame does not match the evidence image")
    points = np.array(
        [
            [
                round(bounds["x"] + float(point["x"]) * (bounds["width"] - 1)),
                round(bounds["y"] + float(point["y"]) * (bounds["height"] - 1)),
            ]
            for point in contour
        ],
        dtype=np.int32,
    )
    mask = np.zeros((height, width), dtype=np.uint8)
    if len(points) >= 3:
        cv2.fillPoly(mask, [points], 1)
    return mask


def _box_iou(first: tuple[int, int, int, int], second: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = first
    bx, by, bw, bh = second
    left, top = max(ax, bx), max(ay, by)
    right, bottom = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    intersection = max(0, right - left) * max(0, bottom - top)
    union = aw * ah + bw * bh - intersection
    return intersection / union if union > 0 else 0.0


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
    evidence_by_id = {}
    if evidence_image is not None and inspection_frame is not None:
        try:
            allowed_mask = detector_material_mask(
                corner_shape, evidence_image.shape[1], evidence_image.shape[0]
            )
        except Exception:
            allowed_mask = None
            evidence_failed = True
        try:
            candidates = defect_candidates(
                evidence_image, corner_shape, evidence_view_id or "ORIGINAL"
            )
        except Exception:
            candidates = []
    else:
        allowed_mask = None
        candidates = []
        evidence_failed = True

    for mark in marks:
        fingerprint = None
        provenance = "HARD_FAILURE"
        attempts = 0
        max_iou = 0.0
        try:
            human_mask = _smart_mark_mask(
                mark["canonicalContour"], evidence_image.shape[:2], inspection_frame
            )
            human_box = cv2.boundingRect(human_mask)
            max_iou = max(
                (
                    _box_iou(human_box, candidate.get("coreBox", candidate["box"]))
                    for candidate in candidates
                ),
                default=0.0,
            )
            if not evidence_failed and allowed_mask is not None:
                result = (processor or get_processor()).fingerprint_smart_mark(
                    evidence_image, human_mask, allowed_mask
                )
                fingerprint = result.get("featureFingerprint")
                provenance = result.get("fingerprintProvenance", "HARD_FAILURE")
                attempts = int(result.get("traceAttempts", 0))
        except Exception:
            fingerprint = None
            provenance = "HARD_FAILURE"
        evidence_by_id[mark["id"]] = {
            "featureFingerprint": fingerprint,
            "smartMarkLearning": {
                "fingerprintProvenance": provenance,
                "traceAttempts": attempts,
                "proposalOverlapIouGt03": max_iou > SMART_MARK_PROPOSAL_IOU_THRESHOLD,
                "proposalMaxIou": round(float(max_iou), 6),
            },
        }

    proposals = [
        {
            **finding,
            "confidence": float(finding["confidence"]),
        }
        for finding in (findings or [])
    ] + [
        {
            "id": mark["id"],
            "canonicalContour": mark["canonicalContour"],
            "sourceViewId": mark["sourceViewId"],
            "defectType": mark["defectType"],
            "confidence": 1.0,
            "origin": "SMART_MARK",
            "reviewResult": "SMART_MARKED",
        }
        for mark in marks
    ]
    measured = measure_defects(proposals, corner_shape)
    for result in measured:
        evidence = evidence_by_id.get(result.get("proposalId"), {})
        result.update(evidence)
    defects = _to_speedster_defects(measured, side, "SMART_MARKED")
    measured_ids = {defect["id"] for defect in defects}
    for finding in findings or []:
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
    return {"defects": defects}
