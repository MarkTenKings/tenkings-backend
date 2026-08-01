import base64
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

import cv2
import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

TARGET_WIDTH = 1270
TARGET_HEIGHT = 1778


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


def order_corners(points: np.ndarray) -> np.ndarray:
    ordered = np.zeros((4, 2), dtype=np.float32)
    coordinate_sum = points.sum(axis=1)
    coordinate_difference = np.diff(points, axis=1).reshape(-1)
    ordered[0] = points[np.argmin(coordinate_sum)]
    ordered[1] = points[np.argmin(coordinate_difference)]
    ordered[2] = points[np.argmax(coordinate_sum)]
    ordered[3] = points[np.argmax(coordinate_difference)]
    return ordered


def find_card_corners(image: np.ndarray) -> Optional[np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 40, 130)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:12]:
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(polygon) == 4:
            return order_corners(polygon.reshape(4, 2).astype(np.float32))
    return None


def normalized_points(points: np.ndarray, width: int, height: int) -> List[Point]:
    return [Point(x=float(x / width), y=float(y / height)) for x, y in points]


def rectify(image: np.ndarray, corners: List[Point]):
    height, width = image.shape[:2]
    source = order_corners(
        np.array([[point.x * width, point.y * height] for point in corners], dtype=np.float32)
    )
    destination = np.array(
        [[0, 0], [TARGET_WIDTH - 1, 0], [TARGET_WIDTH - 1, TARGET_HEIGHT - 1], [0, TARGET_HEIGHT - 1]],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(source, destination)
    return cv2.warpPerspective(image, transform, (TARGET_WIDTH, TARGET_HEIGHT)), transform


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


def find_design_borders(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    height, width = gray.shape
    x_profile = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))[height // 20 : -height // 20].mean(axis=0)
    y_profile = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))[:, width // 20 : -width // 20].mean(axis=1)

    left_range = slice(max(1, width // 100), width * 35 // 100)
    right_range = slice(width * 65 // 100, width - max(1, width // 100))
    top_range = slice(max(1, height // 100), height * 35 // 100)
    bottom_range = slice(height * 65 // 100, height - max(1, height // 100))
    left = left_range.start + int(np.argmax(x_profile[left_range]))
    right = right_range.start + int(np.argmax(x_profile[right_range]))
    top = top_range.start + int(np.argmax(y_profile[top_range]))
    bottom = bottom_range.start + int(np.argmax(y_profile[bottom_range]))
    return np.array([[left, top], [right, top], [right, bottom], [left, bottom]], dtype=np.float32)


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
    return {"ok": True}


@app.post("/geometry", response_model=GeometryResponse)
def geometry(request: ImageInput):
    try:
        image = load_image(request.imageUrl, request.imageBase64)
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    height, width = image.shape[:2]
    corners = find_card_corners(image)
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
        borders = find_design_borders(rectified)
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
    }
