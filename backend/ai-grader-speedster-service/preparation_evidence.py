"""CPU preparation evidence; no detector/model/GPU admission is inferred here."""

import base64
import hashlib
import io
import os
import platform
import re

import cv2
import numpy as np
import requests
from PIL import Image

PREPARATION_DECODER = "original-single-frame-exif-oriented-raster-v1"
MAX_BYTES = 50 * 1024 * 1024
MAX_PIXELS = 64 * 1024 * 1024


def preparation_identity():
    def required(name, pattern):
        value = os.environ.get(name, "")
        if not re.fullmatch(pattern, value):
            raise ValueError("Preparation release identity is unavailable: " + name)
        return value

    return {
        "version": "speedster-preparation-identity-v1",
        "sourceCommitSha": required("SPEEDSTER_SOURCE_COMMIT_SHA", r"[a-f0-9]{40}"),
        "sourceTreeSha": required("SPEEDSTER_SOURCE_TREE_SHA", r"[a-f0-9]{40}"),
        "ociDigest": required("SPEEDSTER_OCI_IMAGE_DIGEST", r"sha256:[a-f0-9]{64}"),
        "buildId": required("SPEEDSTER_BUILD_ID", r"\d+-\d+"),
        "pythonVersion": platform.python_version(),
        "opencvVersion": cv2.__version__,
        "numpyVersion": np.__version__,
        "decoder": PREPARATION_DECODER,
        "rectification": "opencv-float32-source-width-height-card-1270x1778-context-40-v1",
        "reveals": "lab-clahe-2-8-morph-9-sobel-v1",
        "encoding": "opencv-webp-quality-92-v1",
    }


def load_preparation_bytes(image_url, image_base64, *, get=None):
    if image_base64:
        encoded = image_base64.split(",", 1)[-1]
        if len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
            raise ValueError("Preparation source exceeds the byte limit")
        data = base64.b64decode(encoded, validate=True)
    elif image_url:
        chunks = []
        received = 0
        with (get or requests.get)(image_url, timeout=(10, 20), stream=True) as response:
            response.raise_for_status()
            declared = response.headers.get("Content-Length")
            if declared and (not declared.isdigit() or int(declared) > MAX_BYTES):
                raise ValueError("Preparation source exceeds the byte limit")
            for chunk in response.iter_content(chunk_size=65536):
                received += len(chunk)
                if received > MAX_BYTES:
                    raise ValueError("Preparation source exceeds the byte limit")
                chunks.append(chunk)
            data = b"".join(chunks)
            if declared and len(data) != int(declared):
                raise ValueError("Preparation source length changed")
    else:
        raise ValueError("Preparation requires a frozen source read")
    if not 0 < len(data) <= MAX_BYTES:
        raise ValueError("Preparation source exceeds the byte limit")
    return data


def decode_preparation_source(data):
    # Validate the encoded frame before allocating OpenCV pixels. OpenCV's
    # IMREAD_COLOR applies EXIF orientation to match the browser's photo view.
    with Image.open(io.BytesIO(data)) as header:
        image_format = (header.format or "").lower()
        orientation = header.getexif().get(274, 1)
        width, height = header.size
        if (image_format not in ("jpeg", "png", "webp")
                or getattr(header, "n_frames", 1) != 1
                or not isinstance(orientation, int) or not 1 <= orientation <= 8
                or not 2 <= width <= 16384 or not 2 <= height <= 16384
                or width * height > MAX_PIXELS):
            raise ValueError("Preparation source frame is invalid")
        # OpenCV 4.10 ignores WebP EXIF, including mirror/180-degree tags that
        # preserve dimensions. Reject them on both server and worker before any
        # preparation uploads rather than rectifying different displayed pixels.
        if image_format == "webp" and orientation != 1:
            raise ValueError("Oriented WebP preparation is unsupported; use the original JPEG or PNG")
        header.verify()
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Preparation source pixels could not be decoded")
    oriented_width, oriented_height = (height, width) if orientation >= 5 else (width, height)
    if image.shape[:2] != (oriented_height, oriented_width):
        raise ValueError("Preparation decoder orientation contract differs")
    return image, {
        "sha256": hashlib.sha256(data).hexdigest(),
        "byteCount": len(data),
        "width": oriented_width,
        "height": oriented_height,
        "format": image_format,
        "orientation": orientation,
        "decoder": PREPARATION_DECODER,
    }
