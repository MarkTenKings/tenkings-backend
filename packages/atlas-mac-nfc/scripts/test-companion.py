#!/usr/bin/env python3
"""Hardware-free companion tests. Never probes readers or invokes Keychain."""
from pathlib import Path
import os
import subprocess
import tempfile

package = Path(__file__).resolve().parent.parent
repo = package.parent.parent

def run(*args):
    subprocess.run([str(value) for value in args], cwd=repo, check=True, timeout=60)

with tempfile.TemporaryDirectory(prefix="atlas-companion-native-fixture-") as temporary:
    output = Path(temporary)
    common = ["xcrun", "clang", "-std=c11", "-Wall", "-Wextra", "-Werror",
              "-I", package / "Sources/CAtlasPCSC/include", "-I", package / "Sources/CAtlasNFCCompanion/include"]
    run(*common, package / "Sources/CAtlasPCSC/pcsc.c", package / "Sources/CAtlasNFCCompanion/session.c",
        package / "Sources/CAtlasNFCCompanion/lock_profile.c", package / "Sources/CAtlasNFCCompanion/profiles.c",
        package / "Tests/CompanionFixture/main.c", "-o", output / "pcsc-fixture")
    run(output / "pcsc-fixture")
    # Deliberately excludes shipping profiles.c. The synthetic registry exists
    # only in this standalone fake-PC/SC executable, never in a Swift target.
    run(*common, "-I", package / "Sources/CAtlasNFCCompanion",
        "-fsanitize=address,undefined", "-fno-omit-frame-pointer",
        package / "Sources/CAtlasPCSC/pcsc.c", package / "Sources/CAtlasNFCCompanion/session.c",
        package / "Sources/CAtlasNFCCompanion/lock_profile.c",
        package / "Tests/CompanionFixture/lock.c", "-o", output / "lock-fixture")
    run(output / "lock-fixture")
    run(*common, package / "Sources/CAtlasNFCCompanion/platform.c", package / "Tests/CompanionFixture/platform.c",
        "-o", output / "platform-fixture")
    run(output / "platform-fixture")
    run("swift", "build", "--package-path", package, "--product", "atlas-mac-nfc-companion-tests")
    run(package / ".build/debug/atlas-mac-nfc-companion-tests")
    run("swift", "build", "--package-path", package, "--product", "atlas-mac-nfc-companion")
    node = os.environ.get("ATLAS_TEST_NODE", "/opt/homebrew/opt/node@20/bin/node")
    run(node, package / "scripts/test-companion-interop.mjs")
