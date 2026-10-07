"""Standalone artifact tests. No model, credentials, provider or network calls."""

import base64
import copy
import io
import json
import os
import subprocess
import sys
import unittest
from hashlib import sha256
from unittest.mock import Mock, patch

import cv2
import numpy as np
from fastapi.testclient import TestClient
from PIL import Image, ImageOps

from card_geometry import warp_to_card_map, warp_to_inspection_map
from preparation_app import app
from preparation_core import encode_webp, reveal_views
from preparation_evidence import decode_preparation_source
from preparation_runtime import validate_runtime
from preparation_security import private_object_get, private_object_put


# Test-only identity values are never used to build, sign or admit a release.
FIXTURE_IDENTITY = {
    "SPEEDSTER_SOURCE_COMMIT_SHA": "a" * 40,
    "SPEEDSTER_SOURCE_TREE_SHA": "b" * 40,
    "SPEEDSTER_OCI_IMAGE_DIGEST": "sha256:" + "c" * 64,
    "SPEEDSTER_BUILD_ID": "100-1",
    "ATLAS_PREPARATION_API_KEY": "fictional-preparation-key-" + "1" * 32,
    "ATLAS_PREPARATION_OBJECT_ORIGIN": "https://uploads.example",
}


def source_bytes(orientation=1, image_format="JPEG"):
    pixels = np.zeros((100, 80, 3), dtype=np.uint8)
    pixels[:50, :40] = (210, 30, 40)
    pixels[:50, 40:] = (20, 220, 60)
    pixels[50:, :40] = (30, 40, 210)
    pixels[50:, 40:] = (210, 200, 40)
    source = Image.fromarray(pixels)
    exif = source.getexif()
    exif[274] = orientation
    output = io.BytesIO()
    source.save(output, format=image_format, exif=exif, quality=95)
    return output.getvalue()


def request_fixture(data=None):
    data = data or source_bytes(6)
    return {
        "imageBase64": base64.b64encode(data).decode(),
        "matColor": "BLACK",
        "corners": [{"x": .125, "y": .125}, {"x": .875, "y": .125},
                    {"x": .875, "y": .875}, {"x": .125, "y": .875}],
        "outputUploads": {key: "https://uploads.example/" + key for key in
                          ("rectified", "inspection", "normalized", "microDefect", "directional")},
        "preparationBinding": {
            "attemptId": "12345678-1234-4234-8234-123456789012",
            "dispatchClaimId": "22345678-1234-4234-8234-123456789012",
            "requestSha256": "d" * 64,
            "inputSha256": "e" * 64,
            "sourceSha256": sha256(data).hexdigest(),
        },
    }


class PreparationCpuTest(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, FIXTURE_IDENTITY, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = TestClient(app, headers={"Authorization": "Bearer " + FIXTURE_IDENTITY["ATLAS_PREPARATION_API_KEY"]})
        self.addCleanup(self.client.close)

    def test_fresh_process_starts_without_detector_or_tensor_imports(self):
        script = """
import importlib.abc, json, sys
forbidden = {'app', 'sam3_detector', 'sam_memory_v2', 'torch', 'torchvision', 'sam3'}
class RefuseModels(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in forbidden:
            raise AssertionError('Unexpected detector dependency: ' + fullname)
sys.meta_path.insert(0, RefuseModels())
from preparation_app import app
from fastapi.testclient import TestClient
with TestClient(app) as client:
    assert client.get('/health').status_code == 200
assert not forbidden.intersection(sys.modules)
print(json.dumps({'startup': 'CPU only', 'forbiddenModules': []}))
"""
        result = subprocess.run([sys.executable, "-c", script], capture_output=True,
                                text=True, timeout=30, check=True)
        self.assertEqual(json.loads(result.stdout)["forbiddenModules"], [])

    def test_health_states_preparation_only_and_requires_actual_identity(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["capabilities"], ["PREPARE_SIDE"])
        self.assertEqual(response.json()["preparationIdentity"]["pythonVersion"], sys.version.split()[0])
        self.assertEqual(self.client.get("/ping").json(), response.json())
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.client.get("/health").status_code, 503)
            with patch("preparation_evidence.requests.get") as read, patch("preparation_core.requests.put") as write:
                self.assertEqual(self.client.post("/prepare", json=request_fixture()).status_code, 503)
                read.assert_not_called()
                write.assert_not_called()

    def test_runtime_probes_exact_locked_packages_without_admitting_release(self):
        observed = validate_runtime()
        self.assertEqual(observed["runtime"]["packages"]["numpy"], "1.26.4")
        self.assertEqual(observed["preparationIdentity"]["opencvVersion"], "4.10.0")
        self.assertEqual(observed["capabilities"], ["PREPARE_SIDE"])
        with patch("preparation_runtime.version", return_value="different"):
            with self.assertRaisesRegex(ValueError, "package differs"):
                validate_runtime()
        with patch.dict(os.environ, {"SPEEDSTER_OCI_IMAGE_DIGEST": "UNSET"}):
            with self.assertRaisesRegex(ValueError, "identity is unavailable"):
                validate_runtime()

    def test_unscoped_model_and_geometry_routes_do_not_exist(self):
        for path in ("/detect", "/measure", "/trace-proposal", "/map-registration", "/geometry", "/color-geometry"):
            with self.subTest(path=path):
                self.assertEqual(self.client.post(path, json={}).status_code, 404)
        for path in ("/docs", "/openapi.json", "/redoc"):
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_bound_request_writes_exact_original_five_webp_artifacts(self):
        data = source_bytes(6)
        request = request_fixture(data)
        outputs = {}

        def put(url, *, data, headers, timeout, allow_redirects):
            self.assertEqual(headers, {"Content-Type": "image/webp"})
            self.assertEqual(timeout, 30)
            self.assertFalse(allow_redirects)
            self.assertNotIn(url, outputs, "One upload per artifact role")
            outputs[url] = data
            return Mock(status_code=200, raise_for_status=lambda: None)

        with patch("preparation_core.requests.put", side_effect=put):
            response = self.client.post("/prepare", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(set(outputs), set(request["outputUploads"].values()))
        image, source = decode_preparation_source(data)
        height, width = image.shape[:2]
        quad = np.array([[point["x"] * width, point["y"] * height] for point in request["corners"]], dtype=np.float32)
        rectified, transform = warp_to_card_map(image, quad)
        inspection, _ = warp_to_inspection_map(image, quad)
        normalized, micro, directional = reveal_views(inspection)
        expected = {"rectified": rectified, "inspection": inspection, "normalized": normalized,
                    "microDefect": micro, "directional": directional}
        for role, pixels in expected.items():
            actual = outputs[request["outputUploads"][role]]
            self.assertEqual(sha256(actual).hexdigest(), sha256(encode_webp(pixels)).hexdigest())
            decoded = cv2.imdecode(np.frombuffer(actual, np.uint8), cv2.IMREAD_UNCHANGED)
            self.assertEqual(decoded.shape[:2], (1778, 1270) if role == "rectified" else (1858, 1350))
        self.assertEqual(result["preparationEvidence"], {**request["preparationBinding"], "source": source})
        self.assertEqual(result["transform"], transform.reshape(-1).tolist())
        self.assertEqual(result["inspectionFrame"], {"width": 1350, "height": 1858,
                          "cardBounds": {"x": 40, "y": 40, "width": 1270, "height": 1778}})
        self.assertNotIn("https://uploads.example/", response.text)
        self.assertEqual(result["preparationIdentity"]["ociDigest"], FIXTURE_IDENTITY["SPEEDSTER_OCI_IMAGE_DIGEST"])

    def test_invalid_contract_never_reads_or_writes_and_redacts_signed_input(self):
        original = request_fixture()
        candidates = []
        for key in ("preparationBinding", "imageBase64"):
            value = copy.deepcopy(original)
            del value[key]
            candidates.append(value)
        value = copy.deepcopy(original)
        del value["outputUploads"]["inspection"]
        candidates.append(value)
        candidates += [{**original, "imageUrl": "https://source.example/?token=private-token"},
                       {**original, "matColor": "RED"}, {**original, "score": 10},
                       {**original, "corners": original["corners"][:3]},
                       {**original, "corners": [{"x": -1, "y": 0}] * 4}]
        for binding in ({}, {**original["preparationBinding"], "extra": "private-token"},
                        {**original["preparationBinding"], "attemptId": "not-a-request"}):
            candidates.append({**original, "preparationBinding": binding})
        for url in ("http://source.example/?token=private-token", "https://user:private-token@source.example/", "file:///tmp/source"):
            candidates.append({**original, "outputUploads": {**original["outputUploads"], "inspection": url}})
        candidates.append({**original, "outputUploads": {key: "https://uploads.example/one" for key in original["outputUploads"]}})
        with patch("preparation_evidence.requests.get") as read, patch("preparation_core.requests.put") as write:
            for candidate in candidates:
                with self.subTest(fields=list(candidate)):
                    response = self.client.post("/prepare", json=candidate)
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertNotIn("private-token", response.text)
                    self.assertNotIn(original["imageBase64"], response.text)
            read.assert_not_called()
            write.assert_not_called()

    def test_source_hash_orientation_or_geometry_failure_never_uploads(self):
        mismatch = request_fixture()
        mismatch["preparationBinding"]["sourceSha256"] = "f" * 64
        degenerate = request_fixture()
        degenerate["corners"] = [{"x": 0, "y": 0}] * 4
        bad_source = request_fixture(b"not an encoded photo")
        oriented_webp = request_fixture(source_bytes(3, "WEBP"))
        with patch("preparation_core.requests.put") as write:
            for request in (mismatch, degenerate, bad_source, oriented_webp):
                self.assertEqual(self.client.post("/prepare", json=request).status_code, 400)
            write.assert_not_called()

    def test_http_upload_error_does_not_echo_signed_capability(self):
        with patch("preparation_core.requests.put", side_effect=RuntimeError("https://object.example/?signature=private-token")):
            response = self.client.post("/prepare", json=request_fixture())
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("private-token", response.text)
        self.assertNotIn("https://", response.text)

    def test_jpeg_png_orientation_matches_original_display_and_webp_policy(self):
        for image_format in ("JPEG", "PNG"):
            for orientation in range(1, 9):
                with self.subTest(image_format=image_format, orientation=orientation):
                    data = source_bytes(orientation, image_format)
                    image, source = decode_preparation_source(data)
                    displayed = np.array(ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB"))
                    self.assertLessEqual(np.abs(image[:, :, ::-1].astype(int) - displayed.astype(int)).max(), 3)
                    self.assertEqual(source["orientation"], orientation)
        for orientation in range(2, 9):
            with self.assertRaisesRegex(ValueError, "Oriented WebP"):
                decode_preparation_source(source_bytes(orientation, "WEBP"))

    def test_private_authorization_precedes_body_validation_and_object_io(self):
        with patch("preparation_security.requests.get") as read, patch("preparation_security.requests.put") as write:
            with TestClient(app) as anonymous:
                self.assertEqual(anonymous.post("/prepare", content=b"not JSON").status_code, 401)
            self.assertEqual(self.client.post("/prepare", json=request_fixture(), headers={"Authorization": "Bearer wrong"}).status_code, 401)
            with patch.dict(os.environ, {"ATLAS_PREPARATION_API_KEY": ""}):
                self.assertEqual(self.client.post("/prepare", json=request_fixture()).status_code, 503)
            wrong = request_fixture()
            wrong["outputUploads"]["inspection"] = "https://other.example/private"
            self.assertEqual(self.client.post("/prepare", json=wrong).status_code, 422)
            read.assert_not_called()
            write.assert_not_called()

    def test_private_object_transport_refuses_cross_origin_and_redirects(self):
        for operation, verb in [(private_object_get, "get"), (private_object_put, "put")]:
            response = Mock(status_code=302)
            with patch("preparation_security.requests." + verb, return_value=response) as call:
                with self.assertRaises(ValueError):
                    operation("https://unrelated.example/object")
                call.assert_not_called()
                with self.assertRaises(ValueError):
                    operation("https://uploads.example/object")
                self.assertFalse(call.call_args.kwargs["allow_redirects"])
                response.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
