#!/usr/bin/env python3
"""Synthetic PC/SC faults, real isolated journal I/O, and no-hardware CLI plan.

Never invokes the diagnostic execute command or links native fixtures to PCSC.
"""
import json
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="atlas-mac-nfc-diagnostic-") as directory:
    native = pathlib.Path(directory) / "native"
    subprocess.run(["/usr/bin/xcrun", "clang", "-std=c11", "-Wall", "-Wextra", "-Werror",
                    "-I", str(root / "Sources/CAtlasPCSC/include"),
                    "-I", str(root / "Sources/CAtlasNFCDiagnostic/include"),
                    str(root / "Sources/CAtlasPCSC/pcsc.c"),
                    str(root / "Sources/CAtlasNFCDiagnostic/diagnostic.c"),
                    str(root / "Tests/DiagnosticFixture/main.c"), "-o", str(native)], check=True)
    subprocess.run([str(native)], check=True, timeout=3)
    journal = pathlib.Path(directory) / "journal"
    subprocess.run(["/usr/bin/swiftc", str(root / "Sources/AtlasMacNFCDiagnostic/Journal.swift"),
                    str(root / "Tests/DiagnosticJournal/main.swift"), "-o", str(journal)], check=True)
    subprocess.run([str(journal)], check=True, timeout=8)

binary = root / ".build/debug/atlas-mac-nfc-diagnostic"
plan = json.loads(subprocess.check_output([str(binary), "plan"], timeout=3))
assert plan["tagWriteAttempted"] is False and plan["tagLockAttempted"] is False
assert plan["qualification"] == "not_established" and plan["productionReady"] is False
encoded = bytes.fromhex(plan["ndefTLVHex"])
assert encoded[0] == 3 and encoded[1] < 255
ndef = encoded[2:2 + encoded[1]]
assert ndef[:2] == bytes.fromhex("D1 01") and ndef[3:5] == bytes.fromhex("55 04")
assert len(ndef) == 4 + ndef[2]
assert "https://" + ndef[5:].decode("ascii") == plan["uri"]
assert encoded[2 + len(ndef)] == 0xFE and not any(encoded[3 + len(ndef):])
assert len(encoded) == plan["paddedNDEFBytes"] and len(encoded) % 4 == 0
assert plan["writePagesInOrder"] == list(range(5, 4 + len(encoded) // 4)) + [4]
assert min(plan["writePagesInOrder"]) == 4 and max(plan["writePagesInOrder"]) <= 19
invalid_arguments = [[], ["--url", "https://example.com"], ["execute"], ["execute", "--journal"],
                     ["execute", "--journal", "/unused", "--lock"], ["lock"]]
for arguments in invalid_arguments:
    result = subprocess.run([str(binary), *arguments], capture_output=True, timeout=3)
    assert result.returncode == 64 and not result.stderr
    output = json.loads(result.stdout)
    assert output["status"] == "invalid_arguments" and output["tagWriteAttempted"] is False
print(json.dumps({"test": "diagnostic_plan_and_cli_denials", "ok": True, "scenarios": 1 + len(invalid_arguments)}))
