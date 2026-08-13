import base64
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

import cv2
import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from card_geometry import (
    INSPECTION_HEIGHT,
    INSPECTION_MARGIN_PX,
    INSPECTION_WIDTH,
    PX_PER_MM,
    boundary_subtracted_anomaly_mask,
    detect_card_quad,
    detector_material_mask,
    printed_border_quad,
    MapRegistrationFailure,
    MAP_REGISTRATION_ALGORITHM_VERSION,
    register_map_design,
    warp_to_card_map,
    warp_to_inspection_map,
)
from defect_math import GRID_HEIGHT, GRID_WIDTH
from sam3_detector import DETECTOR_VERSION, detect_views, get_processor, measure_marks
from trace_rle import decode_trace_rle, encode_trace_rle


LOGGER = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_processor().load()
    yield


app = FastAPI(lifespan=lifespan)

TARGET_WIDTH = GRID_WIDTH
TARGET_HEIGHT = GRID_HEIGHT


class ImageInput(BaseModel):
    imageUrl: Optional[str] = None
    imageBase64: Optional[str] = None


class Point(BaseModel):
    x: float
    y: float


class GeometryResponse(BaseModel):
    width: int
    height: int
    corners: Optional[List[Point]]


class RectifyRequest(ImageInput):
    corners: List[Point]


class PreparedUploads(BaseModel):
    rectified: str
    inspection: Optional[str] = None
    normalized: str
    microDefect: str
    directional: str


class PrepareRequest(RectifyRequest):
    outputUploads: PreparedUploads


class PrepareResponse(BaseModel):
    width: int
    height: int
    transform: List[float]
    borders: List[Point]
    detectedBorders: List[str]
    inspectionFrame: dict


class MapRegistrationAnchor(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    point: Point


class MapRegistrationLessonCandidate(BaseModel):
    candidateId: str = Field(min_length=1, max_length=80)
    referenceInspectionSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    referenceImage: ImageInput
    anchors: List[MapRegistrationAnchor]
    sourceHomography: List[float] = Field(min_length=9, max_length=9)


class MapRegistrationRequest(BaseModel):
    referenceImage: ImageInput
    currentImage: ImageInput
    mapId: str = Field(min_length=1, max_length=80)
    mapRevisionId: str = Field(min_length=1, max_length=80)
    side: str
    currentPhysicalQuadSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    currentInspectionSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    referenceInspectionSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    anchors: List[MapRegistrationAnchor]
    designBoundary: dict
    zones: List[dict]
    lessonCandidates: List[MapRegistrationLessonCandidate] = Field(default_factory=list, max_length=3)
    correctedAnchors: Optional[List[MapRegistrationAnchor]] = None
    automaticFailure: Optional[dict] = None


class CanonicalView(ImageInput):
    id: str


class DetectRequest(BaseModel):
    side: str
    cornerShape: str
    views: List[CanonicalView]
    learningBank: Optional[dict] = None
    sessionId: Optional[str] = None
    requestTraceId: Optional[str] = None


class SmartMark(BaseModel):
    id: str
    defectType: str
    sourceViewId: str
    finalTrace: Optional[dict] = None
    traceProvenance: Optional[dict] = None


class InspectionBounds(BaseModel):
    x: int
    y: int
    width: int
    height: int


class InspectionFrame(BaseModel):
    width: int
    height: int
    cardBounds: InspectionBounds


class SmartMarkEvidenceView(CanonicalView):
    inspectionFrame: InspectionFrame


class MeasureRequest(BaseModel):
    side: str
    cornerShape: str
    marks: List[SmartMark]
    findings: List[dict] = Field(default_factory=list)
    evidenceView: Optional[SmartMarkEvidenceView] = None


class CanonicalPixel(BaseModel):
    x: int = Field(ge=0, lt=GRID_WIDTH)
    y: int = Field(ge=0, lt=GRID_HEIGHT)


class TraceProposalStroke(BaseModel):
    canonicalPoints: List[CanonicalPixel]
    strokeWidthPixels: int = Field(gt=0)
    strokeWidthMm: float = Field(gt=0)
    cropTransformVersion: str


class TraceProposalRequest(BaseModel):
    side: str
    cornerShape: str
    evidenceView: SmartMarkEvidenceView
    findingId: Optional[str] = None
    sourceViewId: str
    stroke: TraceProposalStroke
    currentTrace: Optional[dict] = None
    findings: List[dict] = Field(default_factory=list)
    requestTraceId: Optional[str] = Field(default=None, max_length=100)


def _trace_proposal_error_detail(error: Exception, request_trace_id: Optional[str]):
    message = re.sub(
        r"https?://\S+",
        "[redacted-url]",
        f"{type(error).__name__}: {error}",
        flags=re.IGNORECASE,
    )
    message = re.sub(
        r"\b(?:Bearer\s+)?(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}\b",
        "[redacted-credential]",
        message,
        flags=re.IGNORECASE,
    )
    message = " ".join(message.split())[:300]
    detail = {"message": message}
    if request_trace_id:
        detail["requestId"] = request_trace_id
    return detail


def load_image(image_url: Optional[str], image_base64: Optional[str]) -> np.ndarray:
    if image_base64:
        encoded = image_base64.split(",", 1)[-1]
        data = base64.b64decode(encoded)
    elif image_url:
        response = requests.get(image_url, timeout=20)
        response.raise_for_status()
        data = response.content
    else:
        raise ValueError("imageUrl or imageBase64 is required")

    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Image could not be decoded")
    return image


def normalized_points(points: np.ndarray, width: int, height: int) -> List[Point]:
    return [Point(x=float(x / width), y=float(y / height)) for x, y in points]


def rectify(image: np.ndarray, corners: List[Point]):
    height, width = image.shape[:2]
    source = np.array(
        [[point.x * width, point.y * height] for point in corners],
        dtype=np.float32,
    )
    return warp_to_card_map(image, source)


def reveal_views(image: np.ndarray):
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    light, a_channel, b_channel = cv2.split(lab)
    normalized_light = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(light)
    normalized = cv2.cvtColor(cv2.merge((normalized_light, a_channel, b_channel)), cv2.COLOR_LAB2BGR)

    gray = cv2.cvtColor(normalized, cv2.COLOR_BGR2GRAY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    micro = cv2.max(
        cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel),
        cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel),
    )
    x_response = cv2.convertScaleAbs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    y_response = cv2.convertScaleAbs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
    directional = cv2.max(x_response, y_response)
    return normalized, micro, directional


def encode_webp(image: np.ndarray) -> bytes:
    success, encoded = cv2.imencode(".webp", image, [cv2.IMWRITE_WEBP_QUALITY, 92])
    if not success:
        raise ValueError("Image could not be encoded")
    return encoded.tobytes()


def upload_webp(upload_url: str, image: np.ndarray):
    response = requests.put(
        upload_url,
        data=encode_webp(image),
        headers={"Content-Type": "image/webp"},
        timeout=30,
    )
    response.raise_for_status()


@app.get("/health")
def health():
    return {"ok": True, "detectorVersion": DETECTOR_VERSION}


@app.get("/ping")
def ping():
    return health()


@app.post("/geometry", response_model=GeometryResponse)
def geometry(request: ImageInput):
    try:
        image = load_image(request.imageUrl, request.imageBase64)
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    height, width = image.shape[:2]
    corners = detect_card_quad(image)
    return {
        "width": width,
        "height": height,
        "corners": normalized_points(corners, width, height) if corners is not None else None,
    }


@app.post("/prepare", response_model=PrepareResponse)
def prepare_image(request: PrepareRequest):
    if len(request.corners) != 4:
        raise HTTPException(status_code=400, detail="Exactly four corners are required")
    try:
        image = load_image(request.imageUrl, request.imageBase64)
        rectified, transform = rectify(image, request.corners)
        borders, detected_borders, _ = printed_border_quad(rectified)
        if request.outputUploads.inspection:
            height, width = image.shape[:2]
            source = np.array(
                [[point.x * width, point.y * height] for point in request.corners],
                dtype=np.float32,
            )
            detector_image, _ = warp_to_inspection_map(image, source)
            frame = {
                "width": INSPECTION_WIDTH,
                "height": INSPECTION_HEIGHT,
                "cardBounds": {
                    "x": INSPECTION_MARGIN_PX,
                    "y": INSPECTION_MARGIN_PX,
                    "width": TARGET_WIDTH,
                    "height": TARGET_HEIGHT,
                },
            }
            inspection_upload = (
                (request.outputUploads.inspection, detector_image),
            )
        else:
            detector_image = rectified
            frame = {
                "width": TARGET_WIDTH,
                "height": TARGET_HEIGHT,
                "cardBounds": {
                    "x": 0,
                    "y": 0,
                    "width": TARGET_WIDTH,
                    "height": TARGET_HEIGHT,
                },
            }
            inspection_upload = ()
        normalized, micro, directional = reveal_views(detector_image)
        uploads = (
            (request.outputUploads.rectified, rectified),
            *inspection_upload,
            (request.outputUploads.normalized, normalized),
            (request.outputUploads.microDefect, micro),
            (request.outputUploads.directional, directional),
        )
        with ThreadPoolExecutor(max_workers=len(uploads)) as executor:
            list(executor.map(lambda item: upload_webp(*item), uploads))
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return {
        "width": TARGET_WIDTH,
        "height": TARGET_HEIGHT,
        "transform": transform.reshape(-1).tolist(),
        "borders": normalized_points(borders, TARGET_WIDTH, TARGET_HEIGHT),
        "detectedBorders": detected_borders,
        "inspectionFrame": frame,
    }


@app.post("/map-registration")
def map_registration(request: MapRegistrationRequest):
    if request.side not in ("FRONT", "BACK"):
        raise HTTPException(status_code=400, detail="Map registration side is invalid")
    binding = {
        "side": request.side,
        "mapRevisionId": request.mapRevisionId,
        "currentInspectionSha256": request.currentInspectionSha256,
        "currentPhysicalQuadSha256": request.currentPhysicalQuadSha256,
        "candidates": [
            {
                "candidateId": "original-reference",
                "referenceInspectionSha256": request.referenceInspectionSha256,
            },
            *[
                {
                    "candidateId": candidate.candidateId,
                    "referenceInspectionSha256": candidate.referenceInspectionSha256,
                }
                for candidate in request.lessonCandidates
            ],
        ],
    }
    try:
        reference = load_image(
            request.referenceImage.imageUrl,
            request.referenceImage.imageBase64,
        )
        current = load_image(
            request.currentImage.imageUrl,
            request.currentImage.imageBase64,
        )
        if request.correctedAnchors is not None and request.automaticFailure is None:
            raise ValueError("Map registration rescue requires the original automatic diagnostics")
        registered = register_map_design(
            reference,
            current,
            [anchor.model_dump() for anchor in request.anchors],
            request.designBoundary,
            request.zones,
            lesson_candidates=[
                {
                    "candidateId": candidate.candidateId,
                    "referenceImage": load_image(
                        candidate.referenceImage.imageUrl,
                        candidate.referenceImage.imageBase64,
                    ),
                    "anchors": [anchor.model_dump() for anchor in candidate.anchors],
                    "sourceHomography": candidate.sourceHomography,
                }
                for candidate in request.lessonCandidates
            ],
            corrected_anchors=(
                [anchor.model_dump() for anchor in request.correctedAnchors]
                if request.correctedAnchors is not None
                else None
            ),
        )
        if "automaticFailure" in registered:
            registered["automaticFailure"] = {
                **registered["automaticFailure"],
                "binding": binding,
            }
        if request.correctedAnchors is not None and registered.get("automaticFailure") != request.automaticFailure:
            raise ValueError("Map registration rescue diagnostics do not match the server recomputation")
        return {
            "version": MAP_REGISTRATION_ALGORITHM_VERSION,
            "side": request.side,
            "mapRevisionId": request.mapRevisionId,
            "currentPhysicalQuadSha256": request.currentPhysicalQuadSha256,
            "currentInspectionSha256": request.currentInspectionSha256,
            **registered,
        }
    except MapRegistrationFailure as error:
        raise HTTPException(
            status_code=422,
            detail={**error.diagnostics, "binding": binding},
        ) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"{type(error).__name__}: {error}",
        ) from error


@app.post("/detect")
def detect(request: DetectRequest):
    request_started = time.perf_counter()
    try:
        views = []
        image_loads = []
        for view in request.views:
            load_started = time.perf_counter()
            image = load_image(view.imageUrl, view.imageBase64)
            image_loads.append(
                {
                    "viewId": view.id,
                    "durationMs": round(
                        (time.perf_counter() - load_started) * 1000, 3
                    ),
                    "width": int(image.shape[1]),
                    "height": int(image.shape[0]),
                }
            )
            views.append((view.id, image))
        detection_started = time.perf_counter()
        result = detect_views(
            views,
            request.side,
            request.cornerShape,
            learning_bank=request.learningBank,
            session_id=request.sessionId,
            trace_id=request.requestTraceId,
        )
        detector_duration_ms = round(
            (time.perf_counter() - detection_started) * 1000, 3
        )
        instrumentation = {
            **result.get("instrumentation", {}),
            "version": "speedster-service-timing-v1",
            "side": request.side,
            "requestTraceId": request.requestTraceId,
            "imageLoads": image_loads,
            "imageLoadTotalMs": round(
                sum(item["durationMs"] for item in image_loads), 3
            ),
            "detectorDurationMs": detector_duration_ms,
            "serviceTotalMs": round(
                (time.perf_counter() - request_started) * 1000, 3
            ),
        }
        result["instrumentation"] = instrumentation
        LOGGER.info(
            "speedster_detect_timing %s",
            json.dumps(instrumentation, separators=(",", ":"), sort_keys=True),
        )
        return result
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        LOGGER.exception(
            "speedster_detect_timing_failed side=%s requestTraceId=%s durationMs=%.3f",
            request.side,
            request.requestTraceId,
            (time.perf_counter() - request_started) * 1000,
        )
        raise HTTPException(
            status_code=500,
            detail=f"{type(error).__name__}: {error}",
        ) from error


def _validated_card_bounds(
    image: np.ndarray, inspection_frame: dict
) -> tuple[int, int, int, int]:
    height, width = image.shape[:2]
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
        raise ValueError("Speedster inspection frame does not match the evidence image")
    return bounds["x"], bounds["y"], bounds["width"], bounds["height"]


def _canonical_trace_in_evidence(
    canonical_mask: np.ndarray,
    image_shape: tuple[int, int],
    bounds: tuple[int, int, int, int],
) -> np.ndarray:
    height, width = image_shape
    x, y, card_width, card_height = bounds
    if (card_width, card_height) != (GRID_WIDTH, GRID_HEIGHT):
        raise ValueError("Speedster trace bounds are not canonical")
    evidence_mask = np.zeros((height, width), dtype=np.uint8)
    evidence_mask[y : y + card_height, x : x + card_width] = canonical_mask
    return evidence_mask


def _boundary_subtracted_anomaly_residual(
    image: np.ndarray, corner_shape: str, source_view_id: str
) -> np.ndarray:
    del source_view_id
    return boundary_subtracted_anomaly_mask(image, corner_shape)


@app.post("/trace-proposal")
def trace_proposal(request: TraceProposalRequest):
    try:
        if request.sourceViewId != request.evidenceView.id:
            raise ValueError("Speedster trace source view does not match its evidence")
        if (
            request.stroke.cropTransformVersion
            != "speedster-canonical-crop-affine-v1"
        ):
            raise ValueError("Speedster trace crop transform is not approved")
        if not request.stroke.canonicalPoints:
            raise ValueError("Speedster trace proposal requires one stroke point")
        if not np.isclose(
            request.stroke.strokeWidthMm * PX_PER_MM,
            request.stroke.strokeWidthPixels,
            rtol=0,
            atol=1e-9,
        ):
            raise ValueError("Speedster trace stroke widths do not agree")

        image = load_image(
            request.evidenceView.imageUrl,
            request.evidenceView.imageBase64,
        )
        frame = request.evidenceView.inspectionFrame.model_dump()
        bounds = _validated_card_bounds(image, frame)
        allowed_mask = detector_material_mask(
            request.cornerShape, image.shape[1], image.shape[0]
        )
        residual = _boundary_subtracted_anomaly_residual(
            image, request.cornerShape, request.sourceViewId
        )
        existing = np.zeros(image.shape[:2], dtype=np.uint8)
        saved_traces = []
        if request.currentTrace is not None:
            saved_traces.append(request.currentTrace)
        saved_traces.extend(
            finding["finalTrace"]
            for finding in request.findings
            if finding.get("finalTrace") is not None
        )
        for saved_trace in saved_traces:
            existing |= _canonical_trace_in_evidence(
                decode_trace_rle(saved_trace), image.shape[:2], bounds
            )

        normalized_points = [
            {
                "x": point.x / (GRID_WIDTH - 1),
                "y": point.y / (GRID_HEIGHT - 1),
            }
            for point in request.stroke.canonicalPoints
        ]
        proposed = get_processor().propose_smart_mark_trace(
            image,
            normalized_points,
            request.stroke.strokeWidthMm,
            allowed_mask,
            residual,
            existing,
            frame,
        )
        proposed_mask = np.asarray(proposed.get("mask")) > 0
        if proposed_mask.shape != image.shape[:2]:
            raise ValueError("SAM 3 returned an invalid Speedster trace shape")
        proposed_mask &= allowed_mask > 0
        x, y, width, height = bounds
        canonical = proposed_mask[y : y + height, x : x + width].astype(np.uint8)
        return {"trace": encode_trace_rle(canonical)}
    except ValueError as error:
        detail = _trace_proposal_error_detail(error, request.requestTraceId)
        LOGGER.error(
            "trace_proposal_failed requestTraceId=%s error=%s",
            request.requestTraceId or "missing",
            detail["message"],
        )
        raise HTTPException(status_code=400, detail=detail) from error
    except Exception as error:
        detail = _trace_proposal_error_detail(error, request.requestTraceId)
        LOGGER.error(
            "trace_proposal_failed requestTraceId=%s error=%s",
            request.requestTraceId or "missing",
            detail["message"],
        )
        raise HTTPException(status_code=500, detail=detail) from error


@app.post("/measure")
def measure(request: MeasureRequest):
    evidence_image = None
    evidence_failed = False
    if request.evidenceView:
        try:
            evidence_image = load_image(
                request.evidenceView.imageUrl,
                request.evidenceView.imageBase64,
            )
        except Exception:
            # Smart-Mark measurement is authoritative and must survive optional
            # fingerprint evidence failures.
            evidence_failed = True
    try:
        result = measure_marks(
            [
                {
                    "id": mark.id,
                    "defectType": mark.defectType,
                    "sourceViewId": mark.sourceViewId,
                    **(
                        {"finalTrace": mark.finalTrace}
                        if (
                            mark.finalTrace is not None
                            or "finalTrace" in mark.model_fields_set
                        )
                        else {}
                    ),
                    **(
                        {"traceProvenance": mark.traceProvenance}
                        if mark.traceProvenance is not None
                        else {}
                    ),
                }
                for mark in request.marks
            ],
            request.side,
            request.cornerShape,
            findings=request.findings,
            evidence_image=evidence_image,
            evidence_view_id=request.evidenceView.id if request.evidenceView else None,
            inspection_frame=(
                request.evidenceView.inspectionFrame.model_dump()
                if request.evidenceView
                else None
            ),
            evidence_failed=evidence_failed,
        )
        if result.get("traceErrors"):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_EXISTING_SPEEDSTER_TRACE",
                    "findingIds": [
                        error.get("findingId")
                        for error in result["traceErrors"]
                    ],
                },
            )
        return result
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
