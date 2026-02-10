import base64
import io
import os
from typing import List, Optional

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
import torch
from torchvision import transforms

app = FastAPI()

MODEL_NAME = os.getenv("VARIANT_DINOV2_MODEL", "dinov2_vits14")
DEVICE = os.getenv("VARIANT_EMBEDDING_DEVICE", "cpu")

_model = None


def load_model():
    global _model
    if _model is None:
        _model = torch.hub.load("facebookresearch/dinov2", MODEL_NAME)
        _model.eval()
        _model.to(DEVICE)
    return _model


def fetch_image(image_url: str) -> Image.Image:
    resp = requests.get(image_url, timeout=10)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert("RGB")


def image_from_base64(b64: str) -> Image.Image:
    data = base64.b64decode(b64)
    return Image.open(io.BytesIO(data)).convert("RGB")


class EmbedRequest(BaseModel):
    imageUrl: Optional[str] = None
    imageBase64: Optional[str] = None
    mode: Optional[str] = None
    referenceId: Optional[str] = None


class EmbedResponse(BaseModel):
  cropUrls: List[str]
  embeddings: List[dict]


class BatchEmbedRequest(BaseModel):
    imageUrls: List[str]


class BatchEmbedResponse(BaseModel):
    results: List[EmbedResponse]


@app.get("/health")
def health():
    return { "ok": True, "model": MODEL_NAME, "device": DEVICE }


def build_crops(img: Image.Image):
    w, h = img.size
    strip_h = max(40, int(h * 0.12))
    strip_w = max(40, int(w * 0.12))
    center_w = max(80, int(w * 0.4))
    center_h = max(80, int(h * 0.4))

    crops = [
        ("top", (0, 0, w, strip_h)),
        ("bottom", (0, h - strip_h, w, h)),
        ("left", (0, 0, strip_w, h)),
        ("right", (w - strip_w, 0, w, h)),
        ("center", (int(w * 0.3), int(h * 0.3), int(w * 0.3) + center_w, int(h * 0.3) + center_h)),
        (
            "stamp",
            (
                int(w * 0.6),
                int(h * 0.6),
                int(w * 0.6) + max(60, int(w * 0.3)),
                int(h * 0.6) + max(60, int(h * 0.3)),
            ),
        ),
        ("holo", (int(w * 0.2), int(h * 0.2), int(w * 0.2) + int(w * 0.5), int(h * 0.2) + int(h * 0.5))),
    ]
    return [(label, img.crop(box)) for label, box in crops]


def embed_image(img: Image.Image):
    model = load_model()
    preprocess = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
        ]
    )
    tensor = preprocess(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        vec = model(tensor)
    if isinstance(vec, (list, tuple)):
        vec = vec[0]
    vec = vec.squeeze(0).cpu().numpy().tolist()
    return vec


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    try:
        if req.imageBase64:
            img = image_from_base64(req.imageBase64)
        elif req.imageUrl:
            img = fetch_image(req.imageUrl)
        else:
            raise HTTPException(status_code=400, detail="imageUrl or imageBase64 required")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    embeddings = []
    for label, crop in build_crops(img):
        vec = embed_image(crop)
        embeddings.append({"cropUrl": f"crop:{label}", "vector": vec})

    return {
        "cropUrls": [],
        "embeddings": embeddings,
    }


@app.post("/embed/batch", response_model=BatchEmbedResponse)
def embed_batch(req: BatchEmbedRequest):
    results: List[EmbedResponse] = []
    for image_url in req.imageUrls:
        try:
            img = fetch_image(image_url)
            embeddings = []
            for label, crop in build_crops(img):
                vec = embed_image(crop)
                embeddings.append({ "cropUrl": f"crop:{label}", "vector": vec })
            results.append({ "cropUrls": [], "embeddings": embeddings })
        except Exception:
            results.append({ "cropUrls": [], "embeddings": [] })
    return { "results": results }
