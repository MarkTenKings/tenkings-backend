#!/usr/bin/env python3
"""Link production C wrapper to synthetic PC/SC symbols; no framework/reader calls."""
import pathlib
import subprocess
import tempfile
root = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="atlas-mac-nfc-native-") as directory:
    executable = pathlib.Path(directory) / "native"
    subprocess.run(["/usr/bin/xcrun", "clang", "-std=c11", "-Wall", "-Wextra", "-Werror",
                    "-I", str(root / "Sources/CAtlasPCSC/include"),
                    str(root / "Sources/CAtlasPCSC/pcsc.c"),
                    str(root / "Tests/NativeFixture/main.c"), "-o", str(executable)], check=True)
    subprocess.run([str(executable)], check=True, timeout=3)
