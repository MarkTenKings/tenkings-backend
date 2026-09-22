"""Synthetic browser fixture only; no real cards, detector guesses or storage.

Uses the existing CPU warp to bind actual prepared PNGs to their source pixels.
Run with a Python environment containing the service's NumPy/OpenCV versions.
"""
import hashlib
import json
from pathlib import Path
import sys

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend/ai-grader-speedster-service"))
from card_geometry import warp_to_card_map, warp_to_inspection_map

output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
fixtures = {}
physical = np.array([[150, 140], [1050, 140], [1050, 1400], [150, 1400]], dtype=np.float32)
for side, color in [("FRONT", (154, 84, 41)), ("BACK", (87, 111, 66))]:
    image = np.full((1540, 1200, 3), 29, dtype=np.uint8)
    cv2.rectangle(image, (150, 140), (1050, 1400), (240, 242, 245), -1)
    cv2.rectangle(image, (200, 210), (1000, 1330), color, -1)
    cv2.putText(image, "SYNTHETIC", (270, 530), cv2.FONT_HERSHEY_SIMPLEX, 2, (245, 245, 245), 4)
    cv2.putText(image, side, (350, 650), cv2.FONT_HERSHEY_SIMPLEX, 2, (245, 245, 245), 4)
    for i in range(12):
        cv2.line(image, (280, 820 + 20*i), (900, 820 + 20*i), (210, 210, 210), 2)
    rectified, matrix = warp_to_card_map(image, physical)
    inspection, _ = warp_to_inspection_map(image, physical)
    frames = {}
    for kind, raster in [("original", image), ("rectified", rectified), ("inspection", inspection)]:
        ok, encoded = cv2.imencode(".png", raster)
        assert ok
        data = encoded.tobytes()
        filename = f"{side.lower()}-{kind}.png"
        (output / filename).write_bytes(data)
        frames[kind] = dict(url="/" + filename, sha256=hashlib.sha256(data).hexdigest(), width=raster.shape[1], height=raster.shape[0])
    printed_source = np.array([[[200, 210], [1000, 210], [1000, 1330], [200, 1330]]], dtype=np.float64)
    printed = cv2.perspectiveTransform(printed_source, matrix)[0] / np.array([1270, 1778])
    fixtures[side] = dict(frames=frames, physical=[dict(x=float(x/1200), y=float(y/1540)) for x,y in physical],
                          printed=[dict(x=float(x), y=float(y)) for x,y in printed], matrix=matrix.reshape(-1).tolist())
(output / "fixture.json").write_text(json.dumps(fixtures))
print(json.dumps({"synthetic": True, "directory": str(output), "frames": 6}))
