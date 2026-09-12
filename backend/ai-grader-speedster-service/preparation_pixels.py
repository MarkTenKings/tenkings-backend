"""Unchanged CPU reveal/encoding engines; no service or network imports."""

import cv2
import numpy as np

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
