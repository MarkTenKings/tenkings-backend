import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

from triton.runtime.build import _build


class RuntimeCompilerContractTest(unittest.TestCase):
    def test_pinned_cc_builds_and_loads_the_exact_triton_style_shared_object(self):
        self.assertEqual(os.environ.get("CC"), "/usr/bin/gcc-14")
        source = Path("/usr/local/share/speedster/compiler_probe.c")
        self.assertTrue(source.is_file())
        with tempfile.TemporaryDirectory(prefix="speedster-triton-build-") as build_dir:
            shared_object = _build(
                "speedster_compiler_probe",
                str(source),
                build_dir,
                library_dirs=[],
                include_dirs=[],
                libraries=[],
            )
            self.assertTrue(Path(shared_object).is_file())
            spec = importlib.util.spec_from_file_location(
                "speedster_compiler_probe", shared_object
            )
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.assertEqual(module.__name__, "speedster_compiler_probe")


if __name__ == "__main__":
    unittest.main()
