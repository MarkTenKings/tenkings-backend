import base64
import io
import os
from typing import Optional, Tuple, List

import cv2
import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

TARGET_W = int(os.getenv("VARIANT_CORNER_TARGET_W", "800"))
TARGET_H = int(os.getenv("VARIANT_CORNER_TARGET_H", "1100"))

class NormalizeRequest(BaseModel):
    imageUrl: Optional[str] = None
    imageBase64: Optional[str] = None

class NormalizeResponse(BaseModel):
    normalizedBase64: str
    width: int
    height: int
    method: str
    corners: Optional[List[Tuple[int, int]]] = None


def fetch_image(req: NormalizeRequest) -> np.ndarray:
    if req.imageBase64:
        data = base64.b64decode(req.imageBase64)
        return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if req.imageUrl:
        resp = requests.get(req.imageUrl, timeout=10)
        resp.raise_for_status()
        return cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)
    raise ValueError("Missing imageUrl or imageBase64")


def order_points(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def find_card_corners(image: np.ndarray) -> Optional[np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    for cnt in contours[:5]:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) == 4:
            return approx.reshape(4, 2)
    return None


def warp_perspective(image: np.ndarray, pts: np.ndarray) -> np.ndarray:
    rect = order_points(pts)
    dst = np.array([[0, 0], [TARGET_W - 1, 0], [TARGET_W - 1, TARGET_H - 1], [0, TARGET_H - 1]], dtype="float32")
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, M, (TARGET_W, TARGET_H))
    return warped


def fallback_bbox(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)
    coords = cv2.findNonZero(thresh)
    if coords is None:
        return cv2.resize(image, (TARGET_W, TARGET_H))
    x, y, w, h = cv2.boundingRect(coords)
    crop = image[y : y + h, x : x + w]
    return cv2.resize(crop, (TARGET_W, TARGET_H))


def encode_image(image: np.ndarray) -> str:
    _, buf = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    return base64.b64encode(buf).decode("utf-8")


@app.post("/normalize", response_model=NormalizeResponse)
def normalize(req: NormalizeRequest):
    try:
        image = fetch_image(req)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if image is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    corners = find_card_corners(image)
    if corners is not None:
        warped = warp_perspective(image, corners)
        return {
            "normalizedBase64": encode_image(warped),
            "width": TARGET_W,
            "height": TARGET_H,
            "method": "perspective",
            "corners": [(int(x), int(y)) for x, y in corners],
        }

    warped = fallback_bbox(image)
    return {
        "normalizedBase64": encode_image(warped),
        "width": TARGET_W,
        "height": TARGET_H,
        "method": "bbox",
        "corners": None,
    }
