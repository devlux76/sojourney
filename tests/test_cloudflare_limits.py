"""Exercise deployment boundaries with real files, including non-pack WASM."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "check_cloudflare", Path(__file__).parents[1] / "tools/check_cloudflare.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class DeploymentLimits(unittest.TestCase):
    def test_exact_file_size_passes_and_one_byte_over_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wasm = root / "application.wasm"
            with wasm.open("wb") as output:
                output.truncate(checker.MAX_FILE_BYTES)
            self.assertTrue(checker.audit(root)["ok"])
            with wasm.open("r+b") as output:
                output.truncate(checker.MAX_FILE_BYTES + 1)
            report = checker.audit(root)
            self.assertFalse(report["ok"])
            self.assertEqual(report["oversized"], [
                {"path": "application.wasm", "bytes": checker.MAX_FILE_BYTES + 1}])

    def test_file_count_includes_nested_application_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "assets").mkdir()
            (root / "index.html").touch()
            (root / "assets/application.js").touch()
            self.assertTrue(checker.audit(root, max_files=2)["ok"])
            (root / "assets/decoder.wasm").touch()
            self.assertFalse(checker.audit(root, max_files=2)["ok"])

    def test_missing_output_is_not_a_successful_empty_deployment(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                checker.audit(Path(directory) / "missing")


if __name__ == "__main__":
    unittest.main()
