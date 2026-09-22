"""Private CPU preparation worker for verified oriented rasters.

The Node adapter supplies owned paths and bounds; this process never fetches a
URL, uploads a file, loads SAM or changes a card record. Native work is killed
and reaped by the parent before its temporary directory is removed.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from card_geometry import warp_to_card_map, warp_to_inspection_map
from color_geometry import engine_error_result, propose_printed_frame, serialize_proposal
from atlas_photo_geometry import POLICY_VERSION, propose_physical_outer
from preparation_pixels import encode_webp, reveal_views


def require(ok, code="PREPARATION_INVALID"):
    if not ok:
        raise ValueError(code)


def checked_image(request):
    source, limits = request["source"], request["limits"]
    path = Path(request["inputPath"])
    require(0 < path.stat().st_size <= limits["maxInputBytes"], "PREPARATION_LIMIT")
    data = path.read_bytes()
    require(len(data) == source["byteCount"] and hashlib.sha256(data).hexdigest() == source["sha256"], "PREPARATION_SOURCE_MISMATCH")
    require(len(data) >= 33 and data[:8] == bytes.fromhex("89504e470d0a1a0a") and data[12:16] == b"IHDR")
    width, height = struct.unpack(">II", data[16:24])
    require(width == source["width"] and height == source["height"], "PREPARATION_SOURCE_MISMATCH")
    require(width >= 2 and height >= 2 and width * height <= limits["maxPixels"], "PREPARATION_LIMIT")
    # The retained engines operate on opaque RGB8. Never silently flatten alpha
    # or reduce native 16-bit evidence to make that engine contract fit.
    require(data[24] == 8 and data[25] == 2, "PREPARATION_RASTER_UNSUPPORTED")
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    require(image is not None and image.shape == (height, width, 3) and image.dtype == np.uint8)
    return image


def color_proposal(image, mat, mode):
    try:
        result = (propose_physical_outer if mode == "PHYSICAL_OUTER" else propose_printed_frame)(image, mat)
    except Exception:
        result = engine_error_result(mode, mat)
    return serialize_proposal(result, image.shape[1], image.shape[0])


def execute(request):
    require(request["mode"] in ("PHYSICAL", "PREPARE"))
    require(request["matColor"] in ("BLACK", "WHITE", "MAGENTA"))
    cv2.setNumThreads(1)
    image = checked_image(request)
    root = Path(__file__).resolve().parent
    identity = {
        "opencv": cv2.__version__, "numpy": np.__version__, "physicalProposalPolicy": POLICY_VERSION,
        "sources": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in
                    ("card_geometry.py", "color_geometry.py", "atlas_photo_geometry.py", "defect_math.py", "preparation_pixels.py")},
    }
    if request["mode"] == "PHYSICAL":
        return {"ok": True, "identity": identity, "proposal": color_proposal(image, request["matColor"], "PHYSICAL_OUTER")}
    points = request["quad"]
    require(isinstance(points, list) and len(points) == 4)
    quad = np.asarray([[p["x"], p["y"]] for p in points], dtype=np.float64)
    require(np.isfinite(quad).all() and (quad >= 0).all() and (quad <= 1).all())
    source = np.float32(quad * np.array([image.shape[1], image.shape[0]]))
    rectified, transform = warp_to_card_map(image, source)
    inspection, inspection_transform = warp_to_inspection_map(image, source)
    normalized, micro, directional = reveal_views(inspection)
    rasters = {"rectified": rectified, "inspection": inspection,
               "normalized": normalized, "microDefect": micro, "directional": directional}
    frames, output_bytes = {}, 0
    for name, raster in rasters.items():
        encoded = encode_webp(raster)
        output_bytes += len(encoded)
        require(output_bytes <= request["limits"]["maxOutputBytes"], "PREPARATION_LIMIT")
        decoded = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_UNCHANGED)
        require(decoded is not None and decoded.shape[:2] == raster.shape[:2], "PREPARATION_OUTPUT_INVALID")
        filename = f"{name}.webp"
        with (Path(request["outputDirectory"]) / filename).open("xb") as output:
            output.write(encoded)
        frames[name] = {"filename": filename, "sha256": hashlib.sha256(encoded).hexdigest(),
                        "byteCount": len(encoded), "mime": "image/webp", "width": raster.shape[1], "height": raster.shape[0],
                        "frameToDerivative": (transform if name == "rectified" else inspection_transform).reshape(-1).tolist()}
    return {"ok": True, "identity": identity, "frames": frames,
            "proposal": color_proposal(rectified, request["matColor"], "PRINTED_FRAME"),
            "encoderSettings": {"format": "webp", "quality": 92, "sourceBitDepth": 8}}


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(32769)
        require(len(raw) <= 32768)
        print(json.dumps(execute(json.loads(raw)), allow_nan=False))
    except Exception as error:
        code = str(error)
        known = {"PREPARATION_INVALID", "PREPARATION_LIMIT", "PREPARATION_SOURCE_MISMATCH", "PREPARATION_RASTER_UNSUPPORTED", "PREPARATION_OUTPUT_INVALID"}
        print(json.dumps({"ok": False, "code": code if code in known else "PREPARATION_INVALID"}))
