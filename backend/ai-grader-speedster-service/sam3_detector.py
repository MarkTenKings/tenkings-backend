"""Single-model SAM 3 defect detection on the Speedster canonical grid."""

import hashlib
from contextlib import nullcontext
from threading import Lock
from typing import Optional, Protocol

import cv2
import numpy as np
from PIL import Image

from card_geometry import defect_candidates
from defect_math import GRID_HEIGHT, GRID_WIDTH, measure_defects


SAM3_REPOSITORY_COMMIT = "96914d2425f90a64f45ca977c2b5165418099543"
SAM3_CHECKPOINT = "sam3.pt"
DETECTOR_VERSION = f"sam3-local-box@{SAM3_REPOSITORY_COMMIT}"
MIN_SAM_AREA_MM2 = 0.02
MAX_SAM_AREA_MM2 = 120.0
PX_PER_MM = GRID_WIDTH / 63.5
FINGERPRINT_SIZE = 32
LEARNING_SCALE = 0.06


class MaskProcessor(Protocol):
    def scan(
        self,
        image: np.ndarray,
        candidates: list[dict],
        learning_bank: Optional[dict] = None,
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

    def scan(
        self,
        image: np.ndarray,
        candidates: list[dict],
        learning_bank: Optional[dict] = None,
    ) -> list[dict]:
        rgb_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        with self._lock:
            processor = self.load()
            with self._autocast():
                state = processor.set_image(rgb_image)
                # At the pinned official commit, image-model scalp=1 makes this
                # final FPN tensor B x 256 x 72 x 72 for the 1008px model input.
                feature_map = (
                    state["backbone_out"]["backbone_fpn"][-1][0]
                    .detach()
                    .float()
                    .cpu()
                    .numpy()
                )
                results = []
                for candidate in candidates:
                    x, y, width, height = candidate["box"]
                    processor.reset_all_prompts(state)
                    output = processor.add_geometric_prompt(
                        box=[
                            (x + width / 2) / GRID_WIDTH,
                            (y + height / 2) / GRID_HEIGHT,
                            width / GRID_WIDTH,
                            height / GRID_HEIGHT,
                        ],
                        label=True,
                        state=state,
                    )
                    masks = output["masks"].detach().float().cpu().numpy()
                    scores = (
                        output["scores"].detach().float().cpu().numpy().reshape(-1)
                    )
                    if masks.ndim < 3:
                        raise RuntimeError("SAM 3 returned an invalid mask result")
                    masks = masks.reshape((-1, masks.shape[-2], masks.shape[-1]))
                    if len(masks) != len(scores):
                        raise RuntimeError("SAM 3 returned mismatched masks and scores")

                    best = None
                    for mask, score in zip(masks, scores):
                        binary = np.asarray(mask) > 0
                        if binary.shape != (GRID_HEIGHT, GRID_WIDTH):
                            binary = cv2.resize(
                                binary.astype(np.uint8),
                                (GRID_WIDTH, GRID_HEIGHT),
                                interpolation=cv2.INTER_NEAREST,
                            ).astype(bool)
                        clipped = np.zeros_like(binary)
                        clipped[y : y + height, x : x + width] = binary[
                            y : y + height, x : x + width
                        ]
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
                        adjustment = learning_adjustment(
                            fingerprint, candidate["defectType"], learning_bank
                        )
                        adjusted_confidence = float(
                            np.clip(float(score) + adjustment, 0, 1)
                        )
                        if adjusted_confidence < 0.5:
                            continue
                        if best is None or adjusted_confidence > best["rankingConfidence"]:
                            best = {
                                "defectType": candidate["defectType"],
                                "confidence": float(score),
                                "rankingConfidence": adjusted_confidence,
                                "learningAdjustment": adjustment,
                                "featureFingerprint": fingerprint,
                                "mask": clipped,
                            }
                    if best is not None:
                        results.append(best)
        return results


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
        return f'{result["proposalId"]}:{result["zone"]}'
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
                    if result.get("learningAdjustment")
                    else {}
                ),
                "canonicalContour": contour,
                "sourceViewId": result["sourceViewId"],
                "supportingViewIds": result["supportingViewIds"],
                "reviewResult": review_result,
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
) -> dict:
    active_processor = processor or get_processor()
    proposals = []
    for view_id, image in views:
        canonical_image = cv2.resize(image, (GRID_WIDTH, GRID_HEIGHT))
        localized_candidates = defect_candidates(
            canonical_image, corner_shape, view_id
        )
        for candidate in active_processor.scan(
            canonical_image, localized_candidates, learning_bank
        ):
            for contour in _mask_contours(candidate["mask"]):
                proposals.append(
                    {
                        "canonicalContour": contour,
                        "sourceViewId": view_id,
                        "defectType": candidate["defectType"],
                        "confidence": candidate["confidence"],
                        "rankingConfidence": candidate.get(
                            "rankingConfidence", candidate["confidence"]
                        ),
                        "learningAdjustment": candidate.get("learningAdjustment", 0.0),
                        "featureFingerprint": candidate.get("featureFingerprint"),
                    }
                )

    measured = measure_defects(proposals, corner_shape)
    return {
        "detectorVersion": DETECTOR_VERSION,
        "defects": _to_speedster_defects(measured, side, "UNREVIEWED"),
    }


def measure_marks(marks: list[dict], side: str, corner_shape: str) -> dict:
    proposals = [
        {
            "id": mark["id"],
            "canonicalContour": mark["canonicalContour"],
            "sourceViewId": mark["sourceViewId"],
            "defectType": mark["defectType"],
            "confidence": 1.0,
        }
        for mark in marks
    ]
    measured = measure_defects(proposals, corner_shape)
    return {"defects": _to_speedster_defects(measured, side, "SMART_MARKED")}
