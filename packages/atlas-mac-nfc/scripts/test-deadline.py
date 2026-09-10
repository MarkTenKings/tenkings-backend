#!/usr/bin/env python3
"""Compile native watchdog fixture in owned temp directory; never opens PC/SC."""
import json
import os
import fcntl
import pathlib
import subprocess
import tempfile
import time

root = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="atlas-mac-nfc-deadline-") as directory:
    executable = pathlib.Path(directory) / "deadline"
    subprocess.run(["/usr/bin/xcrun", "clang", "-std=c11", "-Wall", "-Wextra", "-Werror",
                    "-I", str(root / "Sources/CAtlasPCSC/include"),
                    str(root / "Sources/CAtlasPCSC/deadline.c"),
                    str(root / "Tests/DeadlineFixture/main.c"), "-o", str(executable)], check=True)
    start = time.monotonic()
    result = subprocess.run([str(executable)], capture_output=True, timeout=3)
    elapsed = time.monotonic() - start
    assert result.returncode == 124, result.returncode
    assert result.stderr == b""
    assert result.stdout == b""
    assert 0.08 <= elapsed < 2, elapsed
    print(json.dumps({"test": "blocked_native_work_deadline", "ok": True, "exit": result.returncode, "elapsedSeconds": round(elapsed, 3)}))

    # Fill stdout completely, then make it blocking. A timeout must still exit,
    # and must not alter the inherited descriptor's flags to do so.
    read_fd, write_fd = os.pipe()
    try:
        original = fcntl.fcntl(write_fd, fcntl.F_GETFL)
        fcntl.fcntl(write_fd, fcntl.F_SETFL, original | os.O_NONBLOCK)
        try:
            while True:
                os.write(write_fd, b"x" * 4096)
        except BlockingIOError:
            pass
        fcntl.fcntl(write_fd, fcntl.F_SETFL, original)
        before_child = fcntl.fcntl(write_fd, fcntl.F_GETFL)
        assert not (before_child & os.O_NONBLOCK)
        start = time.monotonic()
        blocked = subprocess.run([str(executable), "blocked-output"], stdout=write_fd, stderr=subprocess.PIPE, timeout=3)
        elapsed = time.monotonic() - start
        assert blocked.returncode == 124 and elapsed < 2
        assert fcntl.fcntl(write_fd, fcntl.F_GETFL) == before_child
        print(json.dumps({"test": "blocked_stdout_deadline", "ok": True, "exit": blocked.returncode, "elapsedSeconds": round(elapsed, 3)}))
    finally:
        os.close(read_fd)
        os.close(write_fd)
