"""One isolated CPU manual measurement over parent-owned exact JSON artifacts.

No pixel decoding, model, fingerprinting, network or application imports. Frame
hashes bind already-verified evidence; this worker measures the exact canonical
masks, not the image itself. The authenticated host establishes frame authority.
"""
import hashlib
import json
from pathlib import Path
import platform
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cv2
import numpy as np
from manual_measurement import measure_manual_side, ManualMeasurementError


def require(ok, code="MEASUREMENT_INVALID"):
    if not ok:
        raise ValueError(code)


def execute(request):
    root = Path(__file__).resolve().parent
    names = ("manual_measurement_worker.py", "manual_measurement.py", "card_geometry.py", "defect_math.py", "trace_rle.py")
    sources = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in names}
    require(sources == request["expectedSources"], "MEASUREMENT_SOURCE_MISMATCH")
    path = Path(request["inputPath"])
    require(0 < path.stat().st_size <= request["maxInputBytes"], "MEASUREMENT_LIMIT")
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    require(len(raw) == request["inputByteCount"] and digest == request["inputSha256"], "MEASUREMENT_SOURCE_MISMATCH")
    payload = json.loads(raw)
    require(set(payload) == {"side", "findings", "marks", "frame", "base", "cornerShape"})
    require(payload["base"]["side"] == payload["side"] and payload["base"]["frame"] == payload["frame"]
            and payload["base"]["cornerShape"] == payload["cornerShape"], "MEASUREMENT_SOURCE_MISMATCH")
    require(len(payload["findings"]) + len(payload["marks"]) <= request["maxFindings"], "MEASUREMENT_LIMIT")
    cv2.setNumThreads(1)
    try:
        result = measure_manual_side(payload["marks"], payload["side"], payload["cornerShape"], findings=payload["findings"])
    except ManualMeasurementError as error:
        raise ValueError("MEASUREMENT_EDIT_INVALID") from error
    encoded = json.dumps(result, allow_nan=False, separators=(",", ":")).encode()
    require(0 < len(encoded) <= request["maxOutputBytes"], "MEASUREMENT_LIMIT")
    with Path(request["outputPath"]).open("xb") as output:
        output.write(encoded)
    return {"ok": True, "inputSha256": digest,
            "output": {"filename": "result.json", "byteCount": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest()},
            "identity": {"python": platform.python_version(), "numpy": np.__version__, "opencv": cv2.__version__, "sources": sources}}


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(32769)
        require(len(raw) <= 32768)
        print(json.dumps(execute(json.loads(raw)), allow_nan=False))
    except Exception as error:
        code = str(error)
        known = {"MEASUREMENT_INVALID", "MEASUREMENT_LIMIT", "MEASUREMENT_SOURCE_MISMATCH", "MEASUREMENT_EDIT_INVALID"}
        print(json.dumps({"ok": False, "code": code if code in known else "MEASUREMENT_INVALID"}))
