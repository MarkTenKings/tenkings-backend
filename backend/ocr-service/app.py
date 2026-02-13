import base64
import io
import os
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from PIL import Image
import requests
from paddleocr import PaddleOCR

OCR_TOKEN = os.getenv("OCR_SERVICE_TOKEN", "")
OCR_LANG = os.getenv("OCR_LANG", "en")
OCR_MAX_WIDTH = int(os.getenv("OCR_MAX_WIDTH", "1024"))
OCR_USE_GPU = os.getenv("OCR_USE_GPU", "false").lower() in ("1", "true", "yes")

ocr_engine = PaddleOCR(use_angle_cls=True, lang=OCR_LANG, use_gpu=OCR_USE_GPU)

app = FastAPI()


class OcrImage(BaseModel):
    id: Optional[str] = None
    url: Optional[str] = None
    base64: Optional[str] = None


class OcrRequest(BaseModel):
    images: List[OcrImage]


class OcrResult(BaseModel):
    id: Optional[str]
    text: str
    confidence: float


class OcrResponse(BaseModel):
    results: List[OcrResult]
    combined_text: str


def _check_auth(auth_header: Optional[str]):
    if not OCR_TOKEN:
        return
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth")
    token = auth_header.replace("Bearer ", "", 1)
    if token != OCR_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid auth")


def _load_image(item: OcrImage) -> Image.Image:
    if item.base64:
        data = base64.b64decode(item.base64)
        return Image.open(io.BytesIO(data)).convert("RGB")
    if item.url:
        resp = requests.get(item.url, timeout=10)
        resp.raise_for_status()
        return Image.open(io.BytesIO(resp.content)).convert("RGB")
    raise HTTPException(status_code=400, detail="Image must include url or base64")


def _resize_image(image: Image.Image) -> Image.Image:
    width, height = image.size
    if width <= OCR_MAX_WIDTH:
        return image
    ratio = OCR_MAX_WIDTH / float(width)
    new_height = int(height * ratio)
    return image.resize((OCR_MAX_WIDTH, new_height), Image.BILINEAR)


def _run_ocr(image: Image.Image):
    image = _resize_image(image)
    array = np.array(image)
    result = ocr_engine.ocr(array, cls=True)
    lines = []
    confidences = []
    for entry in result:
        if not entry:
            continue
        for line in entry:
            text = line[1][0]
            conf = float(line[1][1])
            if text:
                lines.append(text)
                confidences.append(conf)
    text = "\n".join(lines).strip()
    confidence = float(np.mean(confidences)) if confidences else 0.0
    return text, confidence


@app.post("/ocr", response_model=OcrResponse)
async def ocr_endpoint(payload: OcrRequest, authorization: Optional[str] = Header(default=None)):
    _check_auth(authorization)
    results: List[OcrResult] = []
    combined_parts = []

    for item in payload.images:
        image = _load_image(item)
        text, confidence = _run_ocr(image)
        results.append(OcrResult(id=item.id, text=text, confidence=confidence))
        if text:
            if item.id:
                combined_parts.append(f"[{item.id}]\n{text}")
            else:
                combined_parts.append(text)

    combined_text = "\n\n".join(combined_parts).strip()
    return OcrResponse(results=results, combined_text=combined_text)
