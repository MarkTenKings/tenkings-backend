import base64
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

import cv2
import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from card_geometry import (
    detect_card_quad,
    printed_border_quad,
    warp_to_card_map,
)
from defect_math import GRID_HEIGHT, GRID_WIDTH
from sam3_detector import DETECTOR_VERSION, detect_views, get_processor, measure_marks


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


class CanonicalView(ImageInput):
    id: str


class DetectRequest(BaseModel):
    side: str
    cornerShape: str
    views: List[CanonicalView]
    learningBank: Optional[dict] = None


class SmartMark(BaseModel):
    id: str
    defectType: str
    canonicalContour: List[Point]
    sourceViewId: str


class MeasureRequest(BaseModel):
    side: str
    cornerShape: str
    marks: List[SmartMark]


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
        normalized, micro, directional = reveal_views(rectified)
        borders, detected_borders, _ = printed_border_quad(rectified)
        uploads = (
            (request.outputUploads.rectified, rectified),
            (request.outputUploads.normalized, normalized),
            (request.outputUploads.microDefect, micro),
            (request.outputUploads.directional, directional),
        )
        with ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(lambda item: upload_webp(*item), uploads))
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return {
        "width": TARGET_WIDTH,
        "height": TARGET_HEIGHT,
        "transform": transform.reshape(-1).tolist(),
        "borders": normalized_points(borders, TARGET_WIDTH, TARGET_HEIGHT),
        "detectedBorders": detected_borders,
    }


@app.post("/detect")
def detect(request: DetectRequest):
    try:
        views = [
            (view.id, load_image(view.imageUrl, view.imageBase64))
            for view in request.views
        ]
        return detect_views(
            views, request.side, request.cornerShape, learning_bank=request.learningBank
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"{type(error).__name__}: {error}",
        ) from error


@app.post("/measure")
def measure(request: MeasureRequest):
    try:
        return measure_marks(
            [
                {
                    "id": mark.id,
                    "defectType": mark.defectType,
                    "canonicalContour": [point.model_dump() for point in mark.canonicalContour],
                    "sourceViewId": mark.sourceViewId,
                }
                for mark in request.marks
            ],
            request.side,
            request.cornerShape,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
