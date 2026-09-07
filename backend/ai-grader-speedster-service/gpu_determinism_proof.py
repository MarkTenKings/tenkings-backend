"""Run three independent cold-cache GPU probes and require exact equality."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


REPETITIONS = 3
PROBE = Path(__file__).with_name("gpu_determinism_probe.py")


def summarize_attempts(attempts: list[dict]) -> dict:
    if len(attempts) != REPETITIONS:
        raise RuntimeError(f"GPU proof requires exactly {REPETITIONS} repetitions")
    semantic_hashes = [attempt["semanticOutputSha256"] for attempt in attempts]
    side_hashes = [attempt["sideOutputSha256"] for attempt in attempts]
    if len(set(semantic_hashes)) != 1 or any(value != side_hashes[0] for value in side_hashes):
        raise RuntimeError("Independent cold-cache GPU outputs are not identical")

    first = attempts[0]
    for attempt in attempts[1:]:
        for key in ("runtime", "determinism", "model", "corpus", "cornerShape", "learningBank"):
            if attempt[key] != first[key]:
                raise RuntimeError(f"GPU proof identity drifted between repetitions: {key}")
    return {
        "version": "speedster-known-corpus-gpu-proof-set-v1",
        "repetitions": REPETITIONS,
        "independentColdCaches": True,
        "identical": True,
        "semanticOutputSha256": semantic_hashes[0],
        "sideOutputSha256": side_hashes[0],
        "runtime": first["runtime"],
        "determinism": first["determinism"],
        "model": first["model"],
        "corpus": first["corpus"],
        "cornerShape": first["cornerShape"],
        "learningBank": first["learningBank"],
        "attempts": [
            {
                "semanticOutputSha256": attempt["semanticOutputSha256"],
                "sideOutputSha256": attempt["sideOutputSha256"],
                "defectCounts": attempt["defectCounts"],
                "cache": attempt["cache"],
            }
            for attempt in attempts
        ],
    }


def main() -> None:
    attempts = []
    for repetition in range(1, REPETITIONS + 1):
        with tempfile.TemporaryDirectory(
            prefix=f"speedster-gpu-proof-{repetition}-"
        ) as proof_root:
            torch_cache = Path(proof_root) / "torchinductor"
            triton_cache = Path(proof_root) / "triton"
            torch_cache.mkdir(mode=0o700)
            triton_cache.mkdir(mode=0o700)
            environment = dict(os.environ)
            environment["TORCHINDUCTOR_CACHE_DIR"] = str(torch_cache)
            environment["TRITON_CACHE_DIR"] = str(triton_cache)
            completed = subprocess.run(
                [sys.executable, str(PROBE)],
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )
            if completed.returncode != 0:
                diagnostic = completed.stderr[-12_000:].strip()
                raise RuntimeError(
                    f"Cold-cache GPU proof repetition {repetition} failed: {diagnostic}"
                )
            attempts.append(json.loads(completed.stdout))

    result = summarize_attempts(attempts)
    print(json.dumps(result, allow_nan=False, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
