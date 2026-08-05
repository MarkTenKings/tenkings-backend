"""Exact persisted binary trace codec for the Speedster canonical card grid."""

import hashlib
import hmac

import numpy as np

from defect_math import GRID_HEIGHT, GRID_WIDTH


TRACE_FORMAT = "TK_SPEEDSTER_TRACE_RLE_V1"
TRACE_ORIGIN = "TOP_LEFT"
TRACE_ORDER = "ROW_MAJOR_Y_X"
TRACE_INITIAL_VALUE = 0
TRACE_PIXEL_COUNT = GRID_WIDTH * GRID_HEIGHT
TRACE_FIELDS = {
    "format",
    "width",
    "height",
    "origin",
    "order",
    "runs",
    "sha256",
}


def _canonical_runs(runs: object, *, require_nonempty: bool = True) -> list[int]:
    if not isinstance(runs, list) or not runs:
        raise ValueError("Speedster trace runs must be a non-empty integer array")
    if any(isinstance(run, bool) or not isinstance(run, int) for run in runs):
        raise ValueError("Speedster trace runs must contain only integers")
    if runs[0] < 0 or any(run <= 0 for run in runs[1:]):
        raise ValueError("Speedster trace runs are not canonical")
    if sum(runs) != TRACE_PIXEL_COUNT:
        raise ValueError(
            f"Speedster trace runs must total exactly {TRACE_PIXEL_COUNT} pixels"
        )
    if require_nonempty and sum(runs[1::2]) <= 0:
        raise ValueError("A saved Speedster trace must be non-empty")
    return runs


def trace_sha256(runs: object, *, return_preimage: bool = False) -> object:
    """Hash only the approved line-oriented canonical preimage, never JSON."""

    canonical = _canonical_runs(runs, require_nonempty=False)
    preimage = (
        f"{TRACE_FORMAT}\n"
        f"{GRID_WIDTH}\n"
        f"{GRID_HEIGHT}\n"
        f"{TRACE_ORIGIN}\n"
        f"{TRACE_ORDER}\n"
        f"{TRACE_INITIAL_VALUE}\n"
        f"{','.join(str(run) for run in canonical)}\n"
    ).encode("ascii")
    digest = hashlib.sha256(preimage).hexdigest()
    return (digest, preimage) if return_preimage else digest


def encode_trace_rle(mask: np.ndarray) -> dict:
    binary = np.asarray(mask)
    if binary.shape != (GRID_HEIGHT, GRID_WIDTH):
        raise ValueError("Speedster trace has unsupported dimensions")
    try:
        contains_only_binary_values = np.all((binary == 0) | (binary == 1))
    except (TypeError, ValueError):
        contains_only_binary_values = False
    if not contains_only_binary_values:
        raise ValueError("Speedster trace mask may contain only bool, 0, or 1")
    flat = binary.astype(np.uint8, copy=False).reshape(-1)
    if not np.any(flat):
        raise ValueError("A saved Speedster trace must be non-empty")

    changes = np.flatnonzero(flat[1:] != flat[:-1]) + 1
    boundaries = np.concatenate(
        (np.array([0], dtype=np.int64), changes, np.array([TRACE_PIXEL_COUNT]))
    )
    runs = [int(value) for value in np.diff(boundaries)]
    if flat[0] == 1:
        runs.insert(0, 0)
    digest = trace_sha256(runs)
    return {
        "format": TRACE_FORMAT,
        "width": GRID_WIDTH,
        "height": GRID_HEIGHT,
        "origin": TRACE_ORIGIN,
        "order": TRACE_ORDER,
        "runs": runs,
        "sha256": digest,
    }


def decode_trace_rle(value: object) -> np.ndarray:
    if not isinstance(value, dict) or set(value) != TRACE_FIELDS:
        raise ValueError("Speedster trace fields do not match the approved format")
    if value.get("format") != TRACE_FORMAT:
        raise ValueError("Speedster trace format is not approved")
    if (
        isinstance(value.get("width"), bool)
        or not isinstance(value.get("width"), int)
        or value.get("width") != GRID_WIDTH
        or isinstance(value.get("height"), bool)
        or not isinstance(value.get("height"), int)
        or value.get("height") != GRID_HEIGHT
    ):
        raise ValueError("Speedster trace dimensions are not canonical")
    if value.get("origin") != TRACE_ORIGIN or value.get("order") != TRACE_ORDER:
        raise ValueError("Speedster trace coordinate order is not canonical")
    runs = _canonical_runs(value.get("runs"))
    supplied_digest = value.get("sha256")
    if (
        not isinstance(supplied_digest, str)
        or len(supplied_digest) != 64
        or supplied_digest.lower() != supplied_digest
        or any(character not in "0123456789abcdef" for character in supplied_digest)
        or not hmac.compare_digest(supplied_digest, trace_sha256(runs))
    ):
        raise ValueError("Speedster trace SHA-256 does not match its canonical bytes")

    flat = np.zeros(TRACE_PIXEL_COUNT, dtype=np.uint8)
    offset = runs[0]
    for index in range(1, len(runs), 2):
        run = runs[index]
        flat[offset : offset + run] = 1
        offset += run
        if index + 1 < len(runs):
            offset += runs[index + 1]
    return flat.reshape((GRID_HEIGHT, GRID_WIDTH))
