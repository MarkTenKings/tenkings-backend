"""Original CPU image preparation shared by the detector and preparation services.

The rectification, reveals, color geometry and WebP encoding are the original
implementations. The ports keep the legacy endpoint's patchable transport and
identity seams without importing its SAM startup or detector dependencies.
"""

import base64
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable, List, Optional

import cv2
import numpy as np
import requests
from fastapi import HTTPException
from pydantic import BaseModel

from card_geometry import (INSPECTION_HEIGHT, INSPECTION_MARGIN_PX,
                           INSPECTION_WIDTH, warp_to_card_map, warp_to_inspection_map)
from color_geometry import engine_error_result, propose_printed_frame, serialize_proposal
from defect_math import GRID_HEIGHT, GRID_WIDTH
from preparation_evidence import decode_preparation_source, load_preparation_bytes, preparation_identity

LOGGER = logging.getLogger(__name__)
TARGET_WIDTH = GRID_WIDTH
TARGET_HEIGHT = GRID_HEIGHT


class ImageInput(BaseModel):
    imageUrl: Optional[str] = None
    imageBase64: Optional[str] = None


class Point(BaseModel):
    x: float
    y: float


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
    matColor: str
    preparationBinding: Optional[dict] = None


class PrepareResponse(BaseModel):
    width: int
    height: int
    transform: List[float]
    borders: Optional[List[Point]]
    detectedBorders: List[str]
    inspectionFrame: dict
    colorGeometry: Optional[dict] = None
    preparationIdentity: Optional[dict] = None
    preparationEvidence: Optional[dict] = None


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
    if len(corners) != 4:
        raise ValueError("Physical card geometry requires exactly four perimeter points")
    normalized = np.array([[point.x, point.y] for point in corners], dtype=np.float64)
    if not np.all(np.isfinite(normalized)) or np.any(normalized < 0) or np.any(normalized > 1):
        raise ValueError("Physical card geometry must remain inside the exact source image")
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


def upload_webp(upload_url: str, image: np.ndarray, *, put=None):
    response = (put or requests.put)(
        upload_url,
        data=encode_webp(image),
        headers={"Content-Type": "image/webp"},
        timeout=30,
    )
    response.raise_for_status()


@dataclass(frozen=True)
class PreparationPorts:
    load_image: Callable = load_image
    rectify: Callable = rectify
    propose_printed_frame: Callable = propose_printed_frame
    upload_webp: Callable = upload_webp
    preparation_identity: Callable = preparation_identity
    load_preparation_bytes: Callable = load_preparation_bytes
    decode_preparation_source: Callable = decode_preparation_source


def prepare_image(request: PrepareRequest, ports: Optional[PreparationPorts] = None):
    ports = ports or PreparationPorts()
    if len(request.corners) != 4:
        raise HTTPException(status_code=400, detail="Exactly four corners are required")
    try:
        identity = None
        preparation_evidence = None
        if request.preparationBinding is not None:
            binding = request.preparationBinding
            uuid = r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"
            if (set(binding) != {"attemptId", "dispatchClaimId", "requestSha256", "inputSha256", "sourceSha256"}
                    or any(not isinstance(binding.get(key), str) or not re.fullmatch(uuid, binding[key]) for key in ("attemptId", "dispatchClaimId"))
                    or any(not isinstance(binding.get(key), str) or not re.fullmatch(r"[a-f0-9]{64}", binding[key]) for key in ("requestSha256", "inputSha256", "sourceSha256"))
                    or not request.outputUploads.inspection):
                raise ValueError("Preparation attempt binding is invalid")
            identity = ports.preparation_identity()
            data = ports.load_preparation_bytes(request.imageUrl, request.imageBase64)
            image, source = ports.decode_preparation_source(data)
            if source["sha256"] != binding["sourceSha256"]:
                raise ValueError("Preparation source bytes do not match the dispatched attempt")
            preparation_evidence = {**binding, "source": source}
        else:
            image = ports.load_image(request.imageUrl, request.imageBase64)
        rectified, transform = ports.rectify(image, request.corners)
        try:
            color_geometry = ports.propose_printed_frame(rectified, request.matColor)
        except Exception as error:
            LOGGER.warning(
                "color_geometry_failed mode=PRINTED_FRAME errorType=%s",
                type(error).__name__,
            )
            color_geometry = engine_error_result("PRINTED_FRAME", request.matColor)
        if color_geometry and color_geometry["outcome"] == "ACCEPTED":
            borders = color_geometry["proposal"]
            detected_borders = ["top", "right", "bottom", "left"]
        else:
            borders = None
            detected_borders = []
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
            list(executor.map(lambda item: ports.upload_webp(*item), uploads))
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return {
        "width": TARGET_WIDTH,
        "height": TARGET_HEIGHT,
        "transform": transform.reshape(-1).tolist(),
        "borders": (
            normalized_points(borders, TARGET_WIDTH, TARGET_HEIGHT)
            if borders is not None
            else None
        ),
        "detectedBorders": detected_borders,
        "inspectionFrame": frame,
        "colorGeometry": serialize_proposal(color_geometry, TARGET_WIDTH, TARGET_HEIGHT) if color_geometry else None,
        "preparationIdentity": identity,
        "preparationEvidence": preparation_evidence,
    }
