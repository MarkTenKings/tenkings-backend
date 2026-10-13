"""Versioned prepared-image encoding; legacy pixel engines remain untouched."""
import cv2
import numpy as np

LOSSLESS_SETTINGS = {"format": "webp", "lossless": True, "sourceBitDepth": 8,
                     "policyVersion": "atlas-prepared-lossless-webp-v1"}
LEGACY_SETTINGS = {"format": "webp", "quality": 92, "sourceBitDepth": 8}
PREVIEW_POLICY = "atlas-inspection-preview-v1"
PREVIEW_MAX_EDGE = 768
PREVIEW_MAX_BYTES = 1024 * 1024


def encode_lossless_webp(raster):
    if raster.dtype != np.uint8 or raster.ndim not in (2, 3) or (raster.ndim == 3 and raster.shape[2] not in (3, 4)):
        raise ValueError("PREPARATION_RASTER_UNSUPPORTED")
    # OpenCV explicitly selects lossless WebP at a quality greater than 100.
    success, encoded = cv2.imencode(".webp", raster, [cv2.IMWRITE_WEBP_QUALITY, 101])
    if not success:
        raise ValueError("PREPARATION_OUTPUT_INVALID")
    data = encoded.tobytes()
    decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    expected = cv2.cvtColor(raster, cv2.COLOR_GRAY2BGR) if raster.ndim == 2 else raster
    if expected.ndim == 3 and expected.shape[2] == 4:
        expected = expected.copy()
        expected[expected[:, :, 3] == 0, :3] = 0
        # WebP omits an entirely opaque alpha plane. Compare the same visible
        # RGBA samples; a nonopaque alpha plane must still survive exactly.
        if decoded is not None and decoded.ndim == 3 and decoded.shape[2] == 3 and np.all(expected[:, :, 3] == 255):
            decoded = cv2.cvtColor(decoded, cv2.COLOR_BGR2BGRA)
        # Lossless WebP may replace RGB beneath alpha=0 with neighboring color
        # values. Those samples are invisible, not part of the visible-lossless
        # contract. Normalize only the comparison, never the encoded output or
        # source. Alpha and every RGB sample with any opacity remain exact.
        if decoded is not None and decoded.shape == expected.shape:
            decoded = decoded.copy()
            decoded[expected[:, :, 3] == 0, :3] = 0
    if decoded is None or decoded.dtype != expected.dtype or decoded.shape != expected.shape or not np.array_equal(decoded, expected):
        raise ValueError("PREPARATION_OUTPUT_INVALID")
    return data


def encode_inspection_preview(inspection, transform):
    if inspection.ndim == 3 and inspection.shape[2] == 4:
        alpha = inspection[:, :, 3:4].astype(np.float32) / 255
        inspection = np.rint(inspection[:, :, :3] * alpha + 255 * (1 - alpha)).astype(np.uint8)
    height, width = inspection.shape[:2]
    scale = min(1, PREVIEW_MAX_EDGE / max(width, height))
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    preview = cv2.resize(inspection, size, interpolation=cv2.INTER_AREA)
    success, encoded = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 78])
    if not success or not 0 < encoded.nbytes <= PREVIEW_MAX_BYTES:
        raise ValueError("PREPARATION_OUTPUT_INVALID")
    data = encoded.tobytes()
    decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if decoded is None or decoded.shape != preview.shape or decoded.dtype != np.uint8:
        raise ValueError("PREPARATION_OUTPUT_INVALID")
    # OpenCV resize uses pixel-center coordinates, including the half-pixel offset.
    sx, sy = size[0] / width, size[1] / height
    resize = np.array([[sx, 0, (sx - 1) / 2], [0, sy, (sy - 1) / 2], [0, 0, 1]], dtype=np.float64)
    return data, size, (resize @ transform).reshape(-1).tolist()
