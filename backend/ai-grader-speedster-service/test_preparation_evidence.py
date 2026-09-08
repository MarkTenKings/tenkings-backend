import base64
import io
import os
import unittest
from hashlib import sha256
from unittest.mock import patch

import cv2
import numpy as np
from fastapi import HTTPException
from PIL import Image, ImageOps

from app import PrepareRequest, prepare_image
from preparation_evidence import decode_preparation_source, load_preparation_bytes, preparation_identity


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


class PreparationEvidenceTest(unittest.TestCase):
    def test_all_jpeg_and_png_orientations_match_displayed_pixel_coordinates(self):
        for image_format, orientation in ((fmt, tag) for fmt in ("JPEG", "PNG") for tag in range(1, 9)):
            with self.subTest(image_format=image_format, orientation=orientation):
                data = source_bytes(orientation, image_format)
                actual, evidence = decode_preparation_source(data)
                displayed = np.array(ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB"))
                self.assertEqual(actual.shape, displayed.shape)
                self.assertLessEqual(np.abs(actual[:, :, ::-1].astype(int) - displayed.astype(int)).max(), 3)
                self.assertEqual(evidence["width"], 100 if orientation >= 5 else 80)
                self.assertEqual(evidence["height"], 80 if orientation >= 5 else 100)
                self.assertEqual(evidence["orientation"], orientation)
                self.assertEqual(evidence["sha256"], sha256(data).hexdigest())
                self.assertEqual(evidence["byteCount"], len(data))

    def test_oriented_webp_fails_even_when_dimensions_do_not_change(self):
        for orientation in range(2, 9):
            with self.subTest(orientation=orientation):
                with self.assertRaisesRegex(ValueError, "Oriented WebP preparation is unsupported"):
                    decode_preparation_source(source_bytes(orientation, "WEBP"))

    def test_unoriented_png_and_webp(self):
        for image_format in ("PNG", "WEBP"):
            data = source_bytes(image_format=image_format)
            decoded, evidence = decode_preparation_source(data)
            self.assertEqual(decoded.shape[:2], (100, 80))
            self.assertEqual(evidence["format"], image_format.lower())

    def test_invalid_and_animated_sources_fail(self):
        for data in (b"not a photo", source_bytes()[:30]):
            with self.assertRaises(Exception):
                decode_preparation_source(data)
        output = io.BytesIO()
        frames = [Image.new("RGB", (80, 100), color) for color in ("red", "blue")]
        frames[0].save(output, format="WEBP", save_all=True, append_images=frames[1:], duration=100, loop=0)
        with self.assertRaisesRegex(ValueError, "frame is invalid"):
            decode_preparation_source(output.getvalue())

    def test_base64_source_is_bounded_and_exact(self):
        data = source_bytes()
        self.assertEqual(load_preparation_bytes(None, base64.b64encode(data).decode()), data)
        with patch("preparation_evidence.MAX_BYTES", len(data) - 1):
            with self.assertRaisesRegex(ValueError, "byte limit"):
                load_preparation_bytes(None, base64.b64encode(data).decode())
        with self.assertRaises(Exception):
            load_preparation_bytes(None, "not base64!!")

    def test_preparation_identity_requires_real_release_inputs_without_model_load(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "release identity is unavailable"):
                preparation_identity()
        with patch.dict(os.environ, {"SPEEDSTER_SOURCE_COMMIT_SHA": "a" * 40, "SPEEDSTER_SOURCE_TREE_SHA": "b" * 40,
                                    "SPEEDSTER_OCI_IMAGE_DIGEST": "sha256:" + "c" * 64, "SPEEDSTER_BUILD_ID": "100-1"}, clear=True):
            identity = preparation_identity()
        self.assertEqual(identity["opencvVersion"], cv2.__version__)
        self.assertNotIn("gpu", identity)

    def test_bound_prepare_observes_exact_source_and_writes_all_five_roles(self):
        data = source_bytes(6)
        binding = {"attemptId": "12345678-1234-4234-8234-123456789012", "dispatchClaimId": "22345678-1234-4234-8234-123456789012",
                   "requestSha256": "a" * 64, "inputSha256": "b" * 64, "sourceSha256": sha256(data).hexdigest()}
        request = PrepareRequest(imageBase64=base64.b64encode(data).decode(), matColor="BLACK",
            corners=[{"x": 0.125, "y": 0.125}, {"x": 0.875, "y": 0.125}, {"x": 0.875, "y": 0.875}, {"x": 0.125, "y": 0.875}],
            outputUploads={"rectified": "fixture:rectified", "inspection": "fixture:inspection", "normalized": "fixture:normalized", "microDefect": "fixture:micro", "directional": "fixture:directional"},
            preparationBinding=binding)
        outputs = {}
        with patch("app.preparation_identity", return_value={"fixture": "CPU preparation identity"}), \
                patch("app.upload_webp", side_effect=lambda key, image: outputs.update({key: image.copy()})), \
                patch("app.get_processor", side_effect=AssertionError("must not load GPU")):
            result = prepare_image(request)
        self.assertEqual(len(outputs), 5)
        self.assertEqual(outputs["fixture:rectified"].shape[:2], (1778, 1270))
        self.assertEqual(outputs["fixture:inspection"].shape[:2], (1858, 1350))
        self.assertEqual(result["preparationEvidence"]["source"]["sha256"], binding["sourceSha256"])
        self.assertEqual(result["preparationEvidence"]["source"]["width"], 100)
        self.assertEqual(result["preparationEvidence"]["attemptId"], binding["attemptId"])
        request.preparationBinding = {**binding, "sourceSha256": "f" * 64}
        with patch("app.preparation_identity", return_value={"fixture": True}), patch("app.upload_webp") as upload:
            with self.assertRaises(HTTPException):
                prepare_image(request)
            upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
