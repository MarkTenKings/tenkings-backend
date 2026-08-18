import base64
import asyncio
import inspect
import json
import logging
import os
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np
from fastapi import HTTPException

from app import DetectRequest, MeasureRequest, detect, health, lifespan, measure, ping
from card_geometry import (
    INSPECTION_HEIGHT,
    INSPECTION_MARGIN_PX,
    INSPECTION_WIDTH,
    detector_material_mask,
)
from defect_math import (
    CARD_HEIGHT_MM,
    CARD_WIDTH_MM,
    GRID_HEIGHT,
    GRID_WIDTH,
    material_mask,
    measure_defects,
)
from sam3_detector import (
    DETECTOR_VERSION,
    LOGGER,
    SAM3_CHECKPOINT_REVISION,
    SAM3_CHECKPOINT_SHA256,
    SAM3_REPOSITORY_COMMIT,
    Sam3ImageProcessor,
    _cap_memory_candidates_per_side,
    _smart_mark_prompt_inputs,
    _to_speedster_defects,
    _release_identity_inputs,
    _runtime_detector_identity,
    _verified_checkpoint_path,
    detect_views,
    feature_fingerprint,
    learning_adjustment,
    memory_proposal_candidates,
    measure_marks,
)
from sam_memory_v2 import (
    CAPACITY_PER_TYPE_POLARITY,
    FINGERPRINT_VERSION,
    prepare_bank_v2,
)
from trace_rle import encode_trace_rle
from trace_rle import decode_trace_rle


SAM_UNIT = [1 / np.sqrt(32)] * 32


def test_detector_identity():
    return {
        "version": "speedster-detector-identity-v1",
        "detectorVersion": DETECTOR_VERSION,
        "source": {
            "repository": "https://github.com/ten-kings/example",
            "commitSha": "a" * 40,
            "treeSha": "b" * 40,
        },
        "runtime": {
            "ociDigest": "sha256:" + "c" * 64,
            "ociDigestProvenance": "DEPLOYMENT_INJECTED",
            "ociImageReference": "ghcr.io/ten-kings/speedster:test",
            "buildId": "test-build",
            "buildIdentityProvenance": "OCI_IMAGE_ENV",
            "platform": "linux/amd64",
            "pythonVersion": "3.12.4",
            "frameworkVersion": f"sam3@{SAM3_REPOSITORY_COMMIT}",
            "torchVersion": "2.7.1",
            "cudaVersion": "12.8",
            "cudnnVersion": "91002",
            "accelerator": "NVIDIA-L4",
            "gpuName": "NVIDIA-L4",
            "gpuCapability": "8.9",
            "gpuCount": 1,
        },
        "model": {
            "name": "sam3-speedster",
            "repository": "facebook/sam3",
            "revision": "d" * 40,
            "checkpointSha256": "e" * 64,
            "sourceCommitSha": SAM3_REPOSITORY_COMMIT,
        },
        "policy": {
            "detectorVersion": DETECTOR_VERSION,
            "promptVersion": "sam3-box-and-smart-mark-point-v1",
            "fusionVersion": "speedster-side-wide-memory-cap-v2",
            "measurementVersion": "speedster-exact-canonical-mask-v1",
            "memoryVersion": "sam-memory-v2",
        },
        "determinism": {
            "deterministicAlgorithms": True,
            "cudnnDeterministic": True,
            "cudnnBenchmark": False,
            "allowTf32": False,
            "evalMode": True,
            "compile": False,
            "autocastDtype": "bfloat16",
        },
    }


def v2_exemplar(
    polarity,
    session_id,
    *,
    fingerprint=SAM_UNIT,
    provenance=None,
    defect_type="VISIBLE_WHITENING",
    source_view="ORIGINAL",
    completion_order=1,
    proposal_order=0,
    lesson_order=0,
):
    return {
        "defectType": defect_type,
        "polarity": polarity,
        "sessionId": session_id,
        "completedAt": "2026-08-02T12:00:00.000Z",
        "completionOrder": completion_order,
        "proposalOrder": proposal_order,
        "lessonOrder": lesson_order,
        "fingerprint": fingerprint,
        "provenance": provenance
        or (
            "DETECTOR_REMOVED"
            if polarity == "NEGATIVE"
            else "SMART_MARK_POSITIVE"
        ),
        "sourceViewId": source_view,
    }


def v2_bank(*exemplars):
    return {
        "version": 2,
        "fingerprintVersion": FINGERPRINT_VERSION,
        "capacityPerTypePolarity": CAPACITY_PER_TYPE_POLARITY,
        "calibration": {"status": "CALIBRATED", "tau": 0.9, "margin": 0.05},
        "exemplars": list(exemplars),
    }


INSPECTION_FRAME = {
    "width": INSPECTION_WIDTH,
    "height": INSPECTION_HEIGHT,
    "cardBounds": {
        "x": INSPECTION_MARGIN_PX,
        "y": INSPECTION_MARGIN_PX,
        "width": GRID_WIDTH,
        "height": GRID_HEIGHT,
    },
}


class FakeMaskProcessor:
    def __init__(self):
        self.calls = []

    def detector_identity(self):
        return test_detector_identity()

    def scan(
        self,
        image,
        candidates,
        learning_bank=None,
        allowed_mask=None,
        source_view_id=None,
        session_id=None,
        trace_id=None,
        candidate_evidence=None,
    ):
        self.calls.append((image.shape, candidates, learning_bank, allowed_mask))
        mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        mask[500:650, 450:600] = 1
        return [
            {
                "defectType": "VISIBLE_WHITENING",
                "confidence": 0.75 + len(self.calls) / 10,
                "mask": mask,
            }
        ]


class FakeTensor:
    def __init__(self, value):
        self.value = value
        self.float_calls = 0

    def detach(self):
        return self

    def cpu(self):
        return self

    def float(self):
        self.float_calls += 1
        return self

    def numpy(self):
        return self.value

    def __getitem__(self, index):
        return FakeTensor(self.value[index])


class FakeOfficialImageProcessor:
    def __init__(self):
        self.images = []
        self.prompts = []
        self.scores = FakeTensor(np.array([0.84], dtype=np.float16))

    def set_image(self, image):
        self.images.append(image)
        return {
            "backbone_out": {
                "backbone_fpn": [
                    FakeTensor(np.ones((1, 256, 6, 4), dtype=np.float32))
                ]
            }
        }

    def reset_all_prompts(self, state):
        state.pop("masks", None)

    def add_geometric_prompt(self, box, label, state):
        self.prompts.append((box, label, state))
        mask = np.ones((1, 1, 12, 8), dtype=bool)
        return {
            **state,
            "masks": FakeTensor(mask),
            "scores": self.scores,
        }


class FakeDenseMemoryImageProcessor(FakeOfficialImageProcessor):
    def set_image(self, image):
        self.images.append(image)
        compact = np.zeros((32, 72, 72), dtype=np.float32)
        compact[1, :, :] = 1.0
        compact[:, 30, 40] = 0.0
        compact[0, 30, 40] = 1.0
        return {
            "backbone_out": {
                "backbone_fpn": [FakeTensor(dense_feature_map(compact)[None, ...])]
            }
        }


class FakeInteractivePointPredictor:
    def __init__(self, mask):
        self.mask = mask

    def set_image(self, image):
        del image
        raise AttributeError("'NoneType' object has no attribute 'forward_image'")


class FakePointPromptModel:
    def __init__(self, interactive):
        self.inst_interactive_predictor = interactive
        self.calls = []

    def predict_inst(self, state, **kwargs):
        self.calls.append((state, kwargs))
        return (
            self.inst_interactive_predictor.mask[None, :, :],
            np.array([0.92], dtype=np.float32),
            np.zeros((1, 256, 256), dtype=np.float32),
        )


class FakePointPromptProcessor:
    def __init__(self, interactive):
        self.model = FakePointPromptModel(interactive)
        self.images = []

    def set_image(self, image):
        self.images.append(image)
        return {"original_height": image.height, "original_width": image.width}


def rectangle(x1_mm, y1_mm, x2_mm, y2_mm):
    return [
        {"x": x1_mm / 63.5, "y": y1_mm / 88.9},
        {"x": x2_mm / 63.5, "y": y1_mm / 88.9},
        {"x": x2_mm / 63.5, "y": y2_mm / 88.9},
        {"x": x1_mm / 63.5, "y": y2_mm / 88.9},
    ]


def exact_trace(contour):
    points = np.array(
        [[
            round(point["x"] * (GRID_WIDTH - 1)),
            round(point["y"] * (GRID_HEIGHT - 1)),
        ] for point in contour],
        dtype=np.int32,
    )
    mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
    cv2.fillPoly(mask, [points], 1)
    return encode_trace_rle(mask)


def trace_provenance(final_trace, source_view_id):
    side = source_view_id.split(":", 1)[0] if ":" in source_view_id else "FRONT"
    canonical_view_id = (
        source_view_id if ":" in source_view_id else f"{side}:{source_view_id}"
    )
    return {
        "version": "speedster-trace-provenance-v1",
        "sourceViewId": canonical_view_id,
        "cropTransform": {
            "version": "speedster-canonical-crop-affine-v1",
            "crop": {"x": 0, "y": 0, "width": 1269, "height": 1777},
        },
        "highlighterStrokes": [{
            "canonicalPoints": [{"x": 1, "y": 1}],
            "strokeWidthMm": 1.0,
        }],
        "finalTraceSha256": final_trace["sha256"],
    }


def dense_feature_map(compact: np.ndarray) -> np.ndarray:
    return np.repeat(np.asarray(compact, dtype=np.float32), 8, axis=0)


def memory_match(similarity, session_id, box=(100, 100, 20, 20)):
    return {
        "box": box,
        "coreBox": (box[0] + 5, box[1] + 5, 5, 5),
        "coreMask": np.ones((5, 5), dtype=bool),
        "canonicalMatchBox": tuple(
            value / scale
            for value, scale in zip(box, (GRID_WIDTH, GRID_HEIGHT, GRID_WIDTH, GRID_HEIGHT))
        ),
        "defectType": "VISIBLE_WHITENING",
        "origin": "MEMORY",
        "memoryProposal": {
            "lessonSessionId": session_id,
            "lessonCompletionOrder": 228,
            "lessonProposalOrder": 7,
            "lessonOrder": 0,
            "lessonSourceViewId": "ORIGINAL",
            "similarity": similarity,
        },
    }


class Sam3DetectorTests(unittest.TestCase):
    def test_stroke_prompt_projects_rounded_corner_points_to_physical_material(self):
        allowed = detector_material_mask(
            "ROUNDED_3_18_MM", INSPECTION_WIDTH, INSPECTION_HEIGHT
        )
        stroke = [
            {"x": 0.30 + index * 0.005, "y": 0.45}
            for index in range(17)
        ]
        # np.linspace(0, 16, 16, dtype=int) omits index 15. Projection must
        # nevertheless apply to the complete ordered stroke before sampling.
        stroke[0] = {"x": 0.0, "y": 0.0}
        stroke[15] = {"x": 0.0, "y": 0.0}

        points, labels, corridor = _smart_mark_prompt_inputs(
            stroke,
            1.0,
            allowed,
            np.zeros_like(allowed),
            np.zeros_like(allowed),
            INSPECTION_FRAME,
        )

        positive = np.rint(points[labels == 1]).astype(int)
        self.assertTrue(np.all(allowed[positive[:, 1], positive[:, 0]] > 0))
        self.assertFalse(
            np.array_equal(
                positive[0], [INSPECTION_MARGIN_PX, INSPECTION_MARGIN_PX]
            )
        )
        self.assertEqual(corridor[INSPECTION_MARGIN_PX, INSPECTION_MARGIN_PX], 0)
        self.assertEqual(np.count_nonzero(corridor & ~allowed), 0)

    def test_stroke_corridor_uses_complete_path_before_positive_sampling(self):
        allowed = detector_material_mask(
            "SQUARE", INSPECTION_WIDTH, INSPECTION_HEIGHT
        )
        stroke = [
            {"x": 0.30 + index * 0.002, "y": 0.40}
            for index in range(15)
        ]
        stroke.extend(
            [
                {"x": 0.80, "y": 0.70},
                {"x": 0.33, "y": 0.42},
            ]
        )

        points, labels, corridor = _smart_mark_prompt_inputs(
            stroke,
            1.0,
            allowed,
            np.zeros_like(allowed),
            np.zeros_like(allowed),
            INSPECTION_FRAME,
        )

        spike_x = INSPECTION_MARGIN_PX + round(0.80 * (GRID_WIDTH - 1))
        spike_y = INSPECTION_MARGIN_PX + round(0.70 * (GRID_HEIGHT - 1))
        positive = np.rint(points[labels == 1]).astype(int)
        negative = np.rint(points[labels == 0]).astype(int)
        self.assertEqual(len(positive), 16)
        self.assertFalse(np.any(np.all(positive == (spike_x, spike_y), axis=1)))
        self.assertTrue(corridor[spike_y, spike_x])
        self.assertTrue(np.all(corridor[negative[:, 1], negative[:, 0]] == 0))

    def test_stroke_prompt_uses_ordered_positives_and_only_geometry_clean_negatives(self):
        allowed = detector_material_mask(
            "ROUNDED_3_18_MM", INSPECTION_WIDTH, INSPECTION_HEIGHT
        )
        residual = np.zeros_like(allowed)
        residual[400:500, 500:600] = 1
        existing = np.zeros_like(allowed)
        existing[700:800, 700:800] = 1
        stroke = [
            {"x": 0.40, "y": 0.40},
            {"x": 0.42, "y": 0.42},
            {"x": 0.44, "y": 0.43},
        ]

        points, labels, corridor = _smart_mark_prompt_inputs(
            stroke,
            1.0,
            allowed,
            residual,
            existing,
            INSPECTION_FRAME,
        )

        positive = points[labels == 1]
        negative = points[labels == 0]
        self.assertGreater(len(positive), 1)
        self.assertGreater(len(negative), 0)
        self.assertTrue(np.all(labels[: len(positive)] == 1))
        self.assertTrue(np.all(labels[len(positive) :] == 0))
        negative_x = np.rint(negative[:, 0]).astype(int)
        negative_y = np.rint(negative[:, 1]).astype(int)
        self.assertTrue(np.all(allowed[negative_y, negative_x] > 0))
        self.assertTrue(np.all(corridor[negative_y, negative_x] == 0))
        self.assertTrue(np.all(residual[negative_y, negative_x] == 0))
        self.assertTrue(np.all(existing[negative_y, negative_x] == 0))
        self.assertTrue(
            np.all(
                cv2.distanceTransform(allowed, cv2.DIST_L2, 5)[
                    negative_y, negative_x
                ]
                > 7
            )
        )

        repeated = _smart_mark_prompt_inputs(
            stroke,
            1.0,
            allowed,
            residual,
            existing,
            INSPECTION_FRAME,
        )
        np.testing.assert_array_equal(repeated[0], points)
        np.testing.assert_array_equal(repeated[1], labels)
        np.testing.assert_array_equal(repeated[2], corridor)

    def test_same_pinned_sam_model_point_head_proposes_one_material_clipped_trace(self):
        image = np.zeros((INSPECTION_HEIGHT, INSPECTION_WIDTH, 3), dtype=np.uint8)
        allowed = detector_material_mask(
            "ROUNDED_3_18_MM", INSPECTION_WIDTH, INSPECTION_HEIGHT
        )
        raw = np.ones((INSPECTION_HEIGHT, INSPECTION_WIDTH), dtype=np.uint8)
        interactive = FakeInteractivePointPredictor(raw)
        live_shaped = FakePointPromptProcessor(interactive)
        processor = Sam3ImageProcessor()
        processor._processor = live_shaped

        with self.assertRaisesRegex(
            AttributeError,
            "NoneType.*forward_image",
        ):
            interactive.set_image(object())

        result = processor.propose_smart_mark_trace(
            image,
            [
                {"x": 0.40, "y": 0.40},
                {"x": 0.42, "y": 0.42},
                {"x": 0.44, "y": 0.43},
            ],
            1.0,
            allowed,
            np.zeros_like(allowed),
            np.zeros_like(allowed),
            INSPECTION_FRAME,
        )

        self.assertEqual(len(live_shaped.images), 1)
        self.assertEqual(len(live_shaped.model.calls), 1)
        state, prompt_call = live_shaped.model.calls[0]
        self.assertEqual(state["original_height"], INSPECTION_HEIGHT)
        self.assertEqual(state["original_width"], INSPECTION_WIDTH)
        self.assertNotIn("box", prompt_call)
        self.assertIs(prompt_call["normalize_coords"], False)
        self.assertGreater(float(np.max(prompt_call["point_coords"])), 1.0)
        self.assertEqual(set(prompt_call["point_labels"].tolist()), {0, 1})
        self.assertGreater(
            np.count_nonzero(prompt_call["point_labels"] == 0), 0
        )
        np.testing.assert_array_equal(result["mask"], allowed > 0)
        self.assertEqual(result["promptAttempts"], 1)

    def test_point_prompt_uses_the_optional_head_in_the_same_pinned_model(self):
        source = inspect.getsource(Sam3ImageProcessor.load)

        self.assertIn("enable_inst_interactivity=True", source)
        self.assertIn("checkpoint_path=checkpoint_path", source)
        module_source = inspect.getsource(inspect.getmodule(Sam3ImageProcessor))
        self.assertIn(
            f'SAM3_REPOSITORY_COMMIT = "{SAM3_REPOSITORY_COMMIT}"',
            module_source,
        )

    def test_checkpoint_download_requires_an_immutable_revision_and_verifies_bytes(self):
        payload = b"exact-speedster-checkpoint"
        with tempfile.NamedTemporaryFile() as checkpoint:
            checkpoint.write(payload)
            checkpoint.flush()
            download = Mock(return_value=checkpoint.name)
            with patch.dict(os.environ, {
                "SAM3_CHECKPOINT_REVISION": SAM3_CHECKPOINT_REVISION,
                "SAM3_CHECKPOINT_SHA256": SAM3_CHECKPOINT_SHA256,
            }, clear=False), patch(
                "sam3_detector._sha256_file", return_value=SAM3_CHECKPOINT_SHA256
            ):
                path, revision, actual_sha256 = _verified_checkpoint_path(
                    download
                )

        self.assertEqual(path, checkpoint.name)
        self.assertEqual(revision, SAM3_CHECKPOINT_REVISION)
        self.assertEqual(actual_sha256, SAM3_CHECKPOINT_SHA256)
        download.assert_called_once_with(
            repo_id="facebook/sam3",
            filename="sam3.pt",
            revision=SAM3_CHECKPOINT_REVISION,
            token=True,
        )

    def test_checkpoint_startup_fails_closed_for_mutable_revision_or_hash_mismatch(self):
        with patch.dict(os.environ, {
            "SAM3_CHECKPOINT_REVISION": "main",
            "SAM3_CHECKPOINT_SHA256": SAM3_CHECKPOINT_SHA256,
        }, clear=False):
            with self.assertRaisesRegex(RuntimeError, "approved immutable revision"):
                _verified_checkpoint_path(Mock())

        with tempfile.NamedTemporaryFile() as checkpoint:
            checkpoint.write(b"wrong-checkpoint")
            checkpoint.flush()
            with patch.dict(os.environ, {
                "SAM3_CHECKPOINT_REVISION": SAM3_CHECKPOINT_REVISION,
                "SAM3_CHECKPOINT_SHA256": SAM3_CHECKPOINT_SHA256,
            }, clear=False):
                with self.assertRaisesRegex(RuntimeError, "SHA-256 mismatch"):
                    _verified_checkpoint_path(Mock(return_value=checkpoint.name))

    def test_release_identity_requires_exact_build_and_oci_inputs(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "SPEEDSTER_SOURCE_COMMIT_SHA"):
                _release_identity_inputs()

        release_environment = {
            "SPEEDSTER_SOURCE_COMMIT_SHA": "a" * 40,
            "SPEEDSTER_SOURCE_TREE_SHA": "b" * 40,
            "SPEEDSTER_OCI_IMAGE_DIGEST": "sha256:" + "c" * 64,
            "SPEEDSTER_SOURCE_REPOSITORY": "https://github.com/ten-kings/example",
            "SPEEDSTER_BUILD_ID": "github-run-123-1",
            "SPEEDSTER_OCI_IMAGE_REFERENCE": "ghcr.io/ten-kings/speedster:test",
        }
        with patch.dict(os.environ, release_environment, clear=True):
            self.assertEqual(
                _release_identity_inputs()["ociDigest"],
                release_environment["SPEEDSTER_OCI_IMAGE_DIGEST"],
            )

    def test_runtime_identity_exposes_model_build_gpu_and_determinism_contract(self):
        fake_torch = SimpleNamespace(
            __version__="2.7.1+cu126",
            version=SimpleNamespace(cuda="12.6"),
            cuda=SimpleNamespace(
                is_available=lambda: True,
                current_device=lambda: 0,
                get_device_properties=lambda _device: SimpleNamespace(
                    name="NVIDIA L4"
                ),
                get_device_capability=lambda _device: (8, 9),
                device_count=lambda: 1,
            ),
            backends=SimpleNamespace(
                cudnn=SimpleNamespace(version=lambda: 91002)
            ),
        )
        determinism = test_detector_identity()["determinism"]
        release = {
            "sourceRepository": "https://github.com/ten-kings/example",
            "sourceCommit": "a" * 40,
            "sourceTree": "b" * 40,
            "ociDigest": "sha256:" + "c" * 64,
            "imageReference": "ghcr.io/ten-kings/speedster:test",
            "buildId": "github-run-123-1",
        }

        identity = _runtime_detector_identity(
            fake_torch,
            SAM3_CHECKPOINT_REVISION,
            SAM3_CHECKPOINT_SHA256,
            determinism,
            release,
        )

        self.assertEqual(identity["source"]["commitSha"], "a" * 40)
        self.assertEqual(identity["model"]["revision"], SAM3_CHECKPOINT_REVISION)
        self.assertEqual(identity["model"]["checkpointSha256"], SAM3_CHECKPOINT_SHA256)
        self.assertEqual(identity["runtime"]["torchVersion"], "2.7.1+cu126")
        self.assertEqual(identity["runtime"]["cudaVersion"], "12.6")
        self.assertEqual(identity["runtime"]["cudnnVersion"], "91002")
        self.assertEqual(identity["runtime"]["gpuCapability"], "8.9")
        self.assertEqual(identity["determinism"], determinism)

    def test_sam_memory_decision_logger_emits_info_diagnostics(self):
        self.assertEqual(LOGGER.level, logging.INFO)

    def test_service_startup_loads_the_one_detector_before_health(self):
        class FakeLoader:
            def __init__(self):
                self.calls = 0

            def load(self):
                self.calls += 1

            def detector_identity(self):
                return test_detector_identity()

        loader = FakeLoader()

        async def start_and_stop():
            with patch("app.get_processor", return_value=loader), patch(
                "app.get_detector_identity", side_effect=loader.detector_identity
            ):
                async with lifespan(None):
                    self.assertEqual(health()["detectorVersion"], DETECTOR_VERSION)
                    self.assertEqual(health()["detectorIdentity"], test_detector_identity())
                    self.assertEqual(ping(), health())

        asyncio.run(start_and_stop())
        self.assertEqual(loader.calls, 1)

    def test_detect_endpoint_loads_supplied_canonical_views(self):
        success, encoded = cv2.imencode(".png", np.zeros((12, 8, 3), dtype=np.uint8))
        self.assertTrue(success)
        request = DetectRequest(
            side="FRONT",
            cornerShape="SQUARE",
            learningBank={"version": 1, "types": {}},
            sessionId="session-123",
            requestTraceId="session-123:FRONT:detect",
            views=[
                {
                    "id": "ORIGINAL",
                    "imageBase64": base64.b64encode(encoded).decode(),
                }
            ],
        )
        expected = {"detectorVersion": DETECTOR_VERSION, "defects": []}

        with patch("app.detect_views", return_value=expected) as scan:
            result = detect(request)

        self.assertEqual(result["detectorVersion"], expected["detectorVersion"])
        self.assertEqual(result["defects"], expected["defects"])
        self.assertEqual(
            result["instrumentation"]["version"],
            "speedster-service-timing-v1",
        )
        self.assertEqual(result["instrumentation"]["side"], "FRONT")
        self.assertEqual(
            result["instrumentation"]["requestTraceId"],
            "session-123:FRONT:detect",
        )
        self.assertEqual(result["instrumentation"]["imageLoads"][0]["viewId"], "ORIGINAL")
        self.assertGreaterEqual(result["instrumentation"]["serviceTotalMs"], 0)

        views, side, corner_shape = scan.call_args.args
        self.assertEqual(side, "FRONT")
        self.assertEqual(corner_shape, "SQUARE")
        self.assertEqual(views[0][0], "ORIGINAL")
        self.assertEqual(views[0][1].shape, (12, 8, 3))
        self.assertEqual(
            scan.call_args.kwargs["learning_bank"],
            {"version": 1, "types": {}},
        )
        self.assertEqual(scan.call_args.kwargs["session_id"], "session-123")
        self.assertEqual(
            scan.call_args.kwargs["trace_id"], "session-123:FRONT:detect"
        )

    def test_detect_endpoint_returns_the_single_detector_error(self):
        success, encoded = cv2.imencode(".png", np.zeros((12, 8, 3), dtype=np.uint8))
        self.assertTrue(success)
        request = DetectRequest(
            side="FRONT",
            cornerShape="SQUARE",
            views=[
                {
                    "id": "ORIGINAL",
                    "imageBase64": base64.b64encode(encoded).decode(),
                }
            ],
        )

        with patch("app.detect_views", side_effect=RuntimeError("live mismatch")):
            with self.assertRaises(HTTPException) as raised:
                detect(request)

        self.assertEqual(raised.exception.status_code, 500)
        self.assertEqual(raised.exception.detail, "RuntimeError: live mismatch")

    def test_measure_endpoint_uses_the_same_zone_measurement_engine(self):
        result = measure(
            MeasureRequest(
                side="FRONT",
                cornerShape="SQUARE",
                marks=[
                    {
                        "id": "missed-2",
                        "defectType": "VISIBLE_WHITENING",
                        "sourceViewId": "ORIGINAL",
                        "finalTrace": exact_trace(rectangle(20, 20, 22, 22)),
                        "traceProvenance": trace_provenance(
                            exact_trace(rectangle(20, 20, 22, 22)),
                            "FRONT:ORIGINAL",
                        ),
                    }
                ],
            )
        )

        self.assertEqual(len(result["defects"]), 1)
        self.assertEqual(result["defects"][0]["id"], "missed-2")
        self.assertEqual(result["defects"][0]["reviewResult"], "SMART_MARKED")
        self.assertEqual(
            [region["zone"] for region in result["defects"][0]["measurementRegions"]],
            ["SURFACE"],
        )

    def test_full_and_partial_smart_mark_overlap_do_not_add_damage(self):
        existing = {
            "id": "FRONT:memory-1:SURFACE",
            "side": "FRONT",
            "zone": "SURFACE",
            "defectType": "LIFTING_DEFORMATION",
            "detectedDefectType": "VISIBLE_WHITENING",
            "origin": "MEMORY",
            "confidence": 0.91,
            "canonicalContour": rectangle(20, 20, 23, 22),
            "sourceViewId": "FRONT:ORIGINAL",
            "supportingViewIds": ["FRONT:MICRO_DEFECT"],
            "reviewResult": "TYPE_CORRECTED",
            "featureFingerprint": [1.0] + [0.0] * 31,
            "learningAdjustment": 0.0,
            "memoryProposal": {
                "lessonSessionId": "cubone-lesson",
                "lessonCompletionOrder": 228,
                "lessonProposalOrder": 7,
                "lessonOrder": 0,
                "lessonSourceViewId": "ORIGINAL",
                "similarity": 0.94,
            },
        }
        existing_smart = {
            "id": "FRONT:smart-existing:SURFACE",
            "side": "FRONT",
            "zone": "SURFACE",
            "defectType": "VISIBLE_WHITENING",
            "origin": "SMART_MARK",
            "confidence": 1.0,
            "canonicalContour": rectangle(30, 20, 32, 22),
            "sourceViewId": "FRONT:ORIGINAL",
            "supportingViewIds": [],
            "reviewResult": "SMART_MARKED",
            "featureFingerprint": [0.0, 1.0] + [0.0] * 30,
            "smartMarkLearning": {
                "fingerprintProvenance": "SAM_TRACE",
                "traceAttempts": 1,
                "proposalOverlapIouGt03": False,
                "proposalMaxIou": 0.0,
            },
        }
        findings = [existing, existing_smart]
        baseline = measure_marks([], "FRONT", "SQUARE", findings=findings)
        full = measure(
            MeasureRequest(
                side="FRONT",
                cornerShape="SQUARE",
                findings=findings,
                marks=[{
                    "id": "FRONT:smart-full",
                    "defectType": "FAINT_COLOR_VARIATION",
                    "sourceViewId": "FRONT:ORIGINAL",
                    "finalTrace": exact_trace(rectangle(20, 20, 23, 22)),
                    "traceProvenance": trace_provenance(
                        exact_trace(rectangle(20, 20, 23, 22)),
                        "FRONT:ORIGINAL",
                    ),
                }],
            )
        )
        partial = measure_marks(
            [{
                "id": "FRONT:smart-partial",
                "defectType": "FAINT_COLOR_VARIATION",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": exact_trace(rectangle(21, 20, 22, 22)),
                "traceProvenance": trace_provenance(
                    exact_trace(rectangle(21, 20, 22, 22)),
                    "FRONT:ORIGINAL",
                ),
            }],
            "FRONT",
            "SQUARE",
            findings=findings,
        )
        shadowed = measure_marks(
            [{
                "id": "FRONT:smart-winning",
                "defectType": "PEELING_HEAVY_DAMAGE",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": exact_trace(rectangle(20, 20, 32, 22)),
                "traceProvenance": trace_provenance(
                    exact_trace(rectangle(20, 20, 32, 22)),
                    "FRONT:ORIGINAL",
                ),
            }],
            "FRONT",
            "SQUARE",
            findings=findings,
        )

        baseline_damage = sum(
            defect["measurement"]["weightedAreaMm2"]
            for defect in baseline["defects"]
        )
        baseline_area = sum(
            defect["measurement"]["areaMm2"] for defect in baseline["defects"]
        )
        for measured in (full, partial):
            self.assertEqual(
                sum(
                    defect["measurement"]["weightedAreaMm2"]
                    for defect in measured["defects"]
                ),
                baseline_damage,
            )
            self.assertEqual(
                sum(
                    defect["measurement"]["areaMm2"]
                    for defect in measured["defects"]
                ),
                baseline_area,
            )
        self.assertNotIn(
            "FRONT:smart-full:SURFACE",
            {defect["id"] for defect in full["defects"]},
        )
        self.assertNotIn(
            "FRONT:smart-partial:SURFACE",
            {defect["id"] for defect in partial["defects"]},
        )

        provenance_keys = {
            "id",
            "side",
            "zone",
            "defectType",
            "detectedDefectType",
            "origin",
            "confidence",
            "sourceViewId",
            "supportingViewIds",
            "reviewResult",
            "featureFingerprint",
            "learningAdjustment",
            "smartMarkLearning",
            "memoryProposal",
        }
        for result in (full, shadowed):
            by_id = {defect["id"]: defect for defect in result["defects"]}
            for original in findings:
                expected = {
                    key: original[key] for key in provenance_keys if key in original
                }
                actual = {
                    key: by_id[original["id"]][key]
                    for key in provenance_keys
                    if key in by_id[original["id"]]
                }
                self.assertEqual(actual, expected)

        shadowed_by_id = {
            defect["id"]: defect for defect in shadowed["defects"]
        }
        for original in findings:
            self.assertEqual(
                shadowed_by_id[original["id"]]["measurement"],
                {
                    "widthMm": 0.0,
                    "heightMm": 0.0,
                    "areaMm2": 0.0,
                    "zonePercent": 0.0,
                    "multiplier": (
                        2.0
                        if original["defectType"] == "LIFTING_DEFORMATION"
                        else 1.0
                    ),
                    "weightedAreaMm2": 0.0,
                    "subgradeEffect": 0.0,
                },
            )

    def test_scans_each_view_and_returns_measured_speedster_defect(self):
        processor = FakeMaskProcessor()
        image = np.zeros((200, 100, 3), dtype=np.uint8)
        localized = [{
            "box": (430, 480, 190, 190),
            "coreBox": (450, 500, 150, 150),
            "coreMask": np.ones((150, 150), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
            "score": 1.0,
        }]
        with patch("sam3_detector.defect_candidates", return_value=localized):
            result = detect_views(
                [("ORIGINAL", image), ("NORMALIZED", image)],
                "FRONT",
                "SQUARE",
                processor,
            )

        self.assertEqual(result["detectorVersion"], DETECTOR_VERSION)
        self.assertEqual(result["detectorIdentity"], test_detector_identity())
        self.assertEqual(len(processor.calls), 2)
        self.assertTrue(
            all(shape == (GRID_HEIGHT, GRID_WIDTH, 3) for shape, _, _, _ in processor.calls)
        )
        self.assertTrue(all(candidates is localized for _, candidates, _, _ in processor.calls))
        self.assertEqual(len(result["defects"]), 1)
        defect = result["defects"][0]
        self.assertTrue(defect["id"].startswith("sam3-front-"))
        self.assertEqual(defect["sourceViewId"], "NORMALIZED")
        self.assertEqual(defect["supportingViewIds"], ["ORIGINAL"])
        self.assertEqual(defect["reviewResult"], "UNREVIEWED")
        self.assertEqual(defect["side"], "FRONT")
        self.assertEqual(defect["zone"], "SURFACE")
        self.assertGreater(defect["measurement"]["areaMm2"], 0)
        self.assertGreater(defect["measurement"]["zonePercent"], 0)
        self.assertEqual(defect["measurement"]["multiplier"], 1.0)
        self.assertNotIn("finalTrace", defect)

    def test_detector_measurement_receives_the_exact_trace_without_polygon_round_trip(self):
        processor = FakeMaskProcessor()
        image = np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8)
        with patch("sam3_detector.defect_candidates", return_value=[]):
            with patch("sam3_detector.measure_defects", return_value=[]) as measure:
                detect_views(
                    [("ORIGINAL", image)],
                    "FRONT",
                    "SQUARE",
                    processor,
                )

        proposals = measure.call_args.args[0]
        self.assertEqual(len(proposals), 1)
        self.assertIn("canonicalMask", proposals[0])
        self.assertNotIn("canonicalContour", proposals[0])
        expected = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        expected[500:650, 450:600] = 1
        np.testing.assert_array_equal(proposals[0]["canonicalMask"], expected)

    def test_sparse_detector_mask_serializes_as_a_valid_polygon_without_changing_area(self):
        mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        mask[100:108, 100] = 1
        proposal = {
            "canonicalMask": mask,
            "sourceViewId": "FRONT:ORIGINAL",
            "defectType": "VISIBLE_WHITENING",
            "confidence": 0.8,
            "origin": "MEMORY",
            "memoryProposal": {
                "lessonSessionId": "sparse-memory-lesson",
                "lessonCompletionOrder": 1,
                "lessonProposalOrder": 0,
                "lessonOrder": 0,
                "lessonSourceViewId": "ORIGINAL",
                "similarity": 0.75,
            },
        }

        defects = _to_speedster_defects(
            measure_defects([proposal], "ROUNDED_3_18_MM"),
            "FRONT",
            "UNREVIEWED",
        )

        self.assertEqual(len(defects), 1)
        self.assertGreaterEqual(len(defects[0]["canonicalContour"]), 3)
        self.assertEqual(defects[0]["measurement"]["areaMm2"], 0.02)
        self.assertEqual(defects[0]["measurement"]["pixelCount"], 8)
        np.testing.assert_array_equal(decode_trace_rle(defects[0]["detectorMask"]), mask)

    def test_disconnected_detector_components_keep_one_exact_measurement_and_filter_authority(self):
        mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        mask[500:510, 300:310] = 1
        mask[500:505, 900:905] = 1
        proposal = {
            "canonicalMask": mask,
            "sourceViewId": "FRONT:ORIGINAL",
            "defectType": "VISIBLE_WHITENING",
            "confidence": 0.8,
        }

        defects = _to_speedster_defects(
            measure_defects([proposal], "SQUARE"),
            "FRONT",
            "UNREVIEWED",
        )

        self.assertEqual(len(defects), 1)
        self.assertEqual(defects[0]["measurement"]["pixelCount"], 125)
        np.testing.assert_array_equal(
            decode_trace_rle(defects[0]["detectorMask"]), mask
        )

        replayed = measure_marks(
            [],
            "FRONT",
            "SQUARE",
            findings=defects,
        )["defects"]
        self.assertEqual(len(replayed), 1)
        self.assertEqual(replayed[0]["measurement"]["pixelCount"], 125)
        np.testing.assert_array_equal(
            decode_trace_rle(replayed[0]["detectorMask"]), mask
        )

    def test_smart_mark_crossing_zones_has_one_stable_source_with_disjoint_regions(self):
        source_mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        source_mask[:140, :150] = 1
        final_trace = encode_trace_rle(source_mask)
        result = measure_marks(
            [
                {
                    "id": "missed-1",
                    "defectType": "VISIBLE_WHITENING",
                    "sourceViewId": "ORIGINAL",
                    "finalTrace": final_trace,
                    "traceProvenance": trace_provenance(
                        final_trace, "BACK:ORIGINAL"
                    ),
                }
            ],
            "BACK",
            "ROUNDED_3_18_MM",
        )

        defects = result["defects"]
        self.assertEqual(len(defects), 1)
        source = defects[0]
        self.assertEqual(source["id"], "missed-1")
        self.assertEqual(source["finalTrace"], final_trace)
        self.assertEqual(
            source["traceProvenance"],
            trace_provenance(final_trace, "BACK:ORIGINAL"),
        )
        self.assertNotIn("zone", source)
        self.assertNotIn("canonicalContour", source)
        self.assertNotIn("measurement", source)
        regions = source["measurementRegions"]
        self.assertEqual(
            [region["zone"] for region in regions],
            ["CORNERS", "EDGES", "SURFACE"],
        )
        material_clipped_pixels = int(
            np.count_nonzero(source_mask & material_mask("ROUNDED_3_18_MM"))
        )
        pixel_area_mm2 = CARD_WIDTH_MM * CARD_HEIGHT_MM / (GRID_WIDTH * GRID_HEIGHT)
        self.assertEqual(
            sum(region["measurement"]["pixelCount"] for region in regions),
            material_clipped_pixels,
        )
        self.assertEqual(
            sum(region["measurement"]["areaMm2"] for region in regions),
            material_clipped_pixels * pixel_area_mm2,
        )
        self.assertTrue(all(region["canonicalContour"] for region in regions))
        self.assertEqual(source["confidence"], 1.0)
        self.assertEqual(source["reviewResult"], "SMART_MARKED")

    def test_saved_exact_trace_pools_existing_features_without_any_prompt(self):
        image = np.zeros((INSPECTION_HEIGHT, INSPECTION_WIDTH, 3), dtype=np.uint8)
        canonical = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        canonical[500:520, 600:630] = 1
        fake = FakeOfficialImageProcessor()
        processor = Sam3ImageProcessor()
        processor._processor = fake

        fingerprint = processor.fingerprint_saved_trace(
            image,
            canonical,
            detector_material_mask("SQUARE", INSPECTION_WIDTH, INSPECTION_HEIGHT),
            INSPECTION_FRAME,
        )

        self.assertEqual(len(fingerprint), 32)
        self.assertEqual(len(fake.images), 1)
        self.assertEqual(fake.prompts, [])

    def test_measure_endpoint_survives_evidence_image_load_failure(self):
        request = MeasureRequest(
            side="FRONT",
            cornerShape="SQUARE",
            evidenceView={
                "id": "FRONT:ORIGINAL",
                "imageUrl": "https://images.test/unavailable.webp",
                "inspectionFrame": INSPECTION_FRAME,
            },
            marks=[{
                "id": "smart-load-failure",
                "defectType": "VISIBLE_WHITENING",
                "sourceViewId": "FRONT:ORIGINAL",
                "finalTrace": exact_trace(rectangle(20, 20, 22, 22)),
                "traceProvenance": trace_provenance(
                    exact_trace(rectangle(20, 20, 22, 22)),
                    "FRONT:ORIGINAL",
                ),
            }],
        )
        with patch("app.load_image", side_effect=RuntimeError("storage unavailable")):
            result = measure(request)
        self.assertEqual(result["defects"][0]["reviewResult"], "SMART_MARKED")
        self.assertNotIn("featureFingerprint", result["defects"][0])
        self.assertNotIn("smartMarkLearning", result["defects"][0])

    def test_official_processor_reuses_one_image_embedding_for_local_boxes(self):
        fake = FakeOfficialImageProcessor()
        processor = Sam3ImageProcessor()
        processor._processor = fake
        localized = [
            {
                "box": (450, 500, 100, 100),
                "coreBox": (470, 520, 60, 60),
                "coreMask": np.ones((60, 60), dtype=bool),
                "defectType": "VISIBLE_WHITENING",
            },
            {
                "box": (700, 900, 80, 80),
                "coreBox": (710, 910, 60, 60),
                "coreMask": np.ones((60, 60), dtype=bool),
                "defectType": "LIGHT_SCRATCH_SCUFF",
            },
        ]

        candidates = processor.scan(
            np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
            localized,
            {
                "version": 1,
                "types": {
                    "VISIBLE_WHITENING": {
                        "positive": {
                            "count": 1,
                            "sum": [1 / np.sqrt(32)] * 32,
                        },
                    },
                },
            },
        )

        self.assertEqual(len(candidates), 2)
        self.assertIs(processor._processor, fake)
        self.assertEqual(len(fake.images), 1)
        self.assertEqual(len(fake.prompts), 2)
        self.assertTrue(
            all(state is fake.prompts[0][2] for _, _, state in fake.prompts)
        )
        self.assertTrue(
            all(candidate["mask"].shape == (GRID_HEIGHT, GRID_WIDTH) for candidate in candidates)
        )
        self.assertTrue(all(len(candidate["featureFingerprint"]) == 32 for candidate in candidates))
        self.assertAlmostEqual(candidates[0]["confidence"], 0.84, places=3)
        self.assertEqual(candidates[0]["learningAdjustment"], 0.06)
        self.assertAlmostEqual(candidates[0]["rankingConfidence"], 0.9, places=3)
        self.assertEqual(candidates[1]["learningAdjustment"], 0.0)
        self.assertEqual(fake.scores.float_calls, 2)

    def test_inspection_view_prompts_include_context_but_returns_canonical_masks(self):
        fake = FakeOfficialImageProcessor()
        processor = Sam3ImageProcessor()
        processor._processor = fake
        margin = INSPECTION_MARGIN_PX
        localized = [{
            "box": (margin - 8, margin, 28, 40),
            "coreBox": (margin, margin, 20, 32),
            "coreMask": np.ones((32, 20), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
        }]
        allowed = np.zeros((INSPECTION_HEIGHT, INSPECTION_WIDTH), dtype=np.uint8)
        allowed[margin : margin + GRID_HEIGHT, margin : margin + GRID_WIDTH] = 1

        candidates = processor.scan(
            np.zeros((INSPECTION_HEIGHT, INSPECTION_WIDTH, 3), dtype=np.uint8),
            localized,
            allowed_mask=allowed,
        )

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["mask"].shape, (GRID_HEIGHT, GRID_WIDTH))
        self.assertEqual(candidates[0]["mask"][:, -1].sum(), 0)
        prompt = fake.prompts[0][0]
        self.assertLess(prompt[0] - prompt[2] / 2, margin / INSPECTION_WIDTH)

    def test_existing_backbone_features_make_one_compact_normalized_fingerprint(self):
        features = np.arange(256 * 4 * 3, dtype=np.float32).reshape(256, 4, 3)
        mask = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8)
        mask[200:700, 300:900] = 1

        fingerprint = feature_fingerprint(features, mask)

        self.assertIsNotNone(fingerprint)
        self.assertEqual(len(fingerprint), 32)
        self.assertAlmostEqual(float(np.linalg.norm(fingerprint)), 1.0, places=5)

    def test_dense_memory_search_starts_at_point_nine_zero_and_keeps_provenance(self):
        axis = [1.0] + [0.0] * 31
        compact = np.zeros((32, 3, 4), dtype=np.float32)
        compact[1, :, :] = 1.0
        compact[:, 0, 0] = np.array(
            [0.899, np.sqrt(1 - 0.899**2)] + [0.0] * 30,
            dtype=np.float32,
        )
        compact[:, 2, 3] = np.array(
            [0.90, np.sqrt(1 - 0.90**2)] + [0.0] * 30,
            dtype=np.float32,
        )
        prepared = prepare_bank_v2(
            v2_bank(
                v2_exemplar(
                    "POSITIVE",
                    "cubone-smart-mark",
                    fingerprint=axis,
                    completion_order=228,
                    proposal_order=7,
                )
            )
        )

        matches = memory_proposal_candidates(
            dense_feature_map(compact),
            prepared,
            source_view_id="FRONT:ORIGINAL",
            image_width=400,
            image_height=300,
            allowed_mask=np.ones((300, 400), dtype=np.uint8),
        )

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["origin"], "MEMORY")
        self.assertEqual(
            matches[0]["memoryProposal"],
            {
                "lessonSessionId": "cubone-smart-mark",
                "lessonCompletionOrder": 228,
                "lessonProposalOrder": 7,
                "lessonOrder": 0,
                "lessonSourceViewId": "ORIGINAL",
                "similarity": 0.90,
            },
        )

    def test_existing_smart_mark_bank_surfaces_memory_with_exact_diagnostics(self):
        fake = FakeDenseMemoryImageProcessor()
        processor = Sam3ImageProcessor()
        processor._processor = fake

        with self.assertLogs("sam3_detector", level="INFO") as captured:
            candidates = processor.scan(
                np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
                [],
                v2_bank(
                    v2_exemplar(
                        "POSITIVE",
                        "cubone-smart-mark",
                        fingerprint=[1.0] + [0.0] * 31,
                        completion_order=228,
                        proposal_order=7,
                    )
                ),
                allowed_mask=np.ones((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8),
                source_view_id="FRONT:ORIGINAL",
                session_id="repeat-cubone",
                trace_id="repeat-cubone:FRONT:detect",
            )

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["origin"], "MEMORY")
        self.assertEqual(
            candidates[0]["memoryProposal"],
            {
                "lessonSessionId": "cubone-smart-mark",
                "lessonCompletionOrder": 228,
                "lessonProposalOrder": 7,
                "lessonOrder": 0,
                "lessonSourceViewId": "ORIGINAL",
                "similarity": 1.0,
            },
        )
        diagnostic = json.loads(captured.records[0].getMessage().split(" ", 1)[1])
        self.assertEqual(diagnostic["proposalOrigin"], "MEMORY")
        self.assertEqual(diagnostic["memoryProposal"], candidates[0]["memoryProposal"])

    def test_dense_memory_search_ignores_non_smart_mark_positives(self):
        compact = np.zeros((32, 2, 2), dtype=np.float32)
        compact[0, 0, 0] = 1.0
        prepared = prepare_bank_v2(
            v2_bank(
                v2_exemplar(
                    "POSITIVE",
                    "relabel",
                    fingerprint=[1.0] + [0.0] * 31,
                    provenance="DETECTOR_RELABELED_POSITIVE",
                ),
                v2_exemplar(
                    "POSITIVE",
                    "auto-accepted",
                    fingerprint=[1.0] + [0.0] * 31,
                    provenance="UNTOUCHED_ACCEPTED_POSITIVE",
                ),
            )
        )

        matches = memory_proposal_candidates(
            dense_feature_map(compact),
            prepared,
            source_view_id="ORIGINAL",
            image_width=40,
            image_height=40,
            allowed_mask=np.ones((40, 40), dtype=np.uint8),
        )

        self.assertEqual(matches, [])

    def test_side_scan_ranks_before_prompting_and_caps_three_across_views(self):
        fake = FakeOfficialImageProcessor()
        processor = Sam3ImageProcessor()
        processor._processor = fake
        prepared_views = [
            {
                "sourceViewId": view,
                "image": np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
                "candidates": [],
                "allowedMask": np.ones((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8),
            }
            for view in ("ORIGINAL", "NORMALIZED")
        ]
        per_view = [
            [
                memory_match(0.96, "best-duplicate", (100, 100, 20, 20)),
                memory_match(0.94, "second", (200, 200, 20, 20)),
            ],
            [
                memory_match(0.95, "lower-duplicate", (100, 100, 20, 20)),
                memory_match(0.93, "third", (300, 300, 20, 20)),
                memory_match(0.92, "fourth", (400, 400, 20, 20)),
            ],
        ]

        with patch("sam3_detector.memory_proposal_candidates", side_effect=per_view):
            with self.assertLogs("sam3_detector", level="INFO"):
                candidates = processor.scan_side(
                    prepared_views,
                    v2_bank(),
                    session_id="current-session",
                    trace_id="trace",
                )

        self.assertEqual(len(fake.images), 2)
        self.assertEqual(len(fake.prompts), 3)
        self.assertEqual(len(candidates), 3)
        self.assertEqual(
            {candidate["memoryProposal"]["lessonSessionId"] for candidate in candidates},
            {"best-duplicate", "second", "third"},
        )

    def test_negative_memory_veto_applies_to_memory_generated_proposal(self):
        fake = FakeOfficialImageProcessor()
        processor = Sam3ImageProcessor()
        processor._processor = fake
        positive = [0.8, 0.6] + [0.0] * 30
        negative = [1.0] + [0.0] * 31

        with patch(
            "sam3_detector.memory_proposal_candidates",
            return_value=[memory_match(0.90, "smart-mark")],
        ), patch("sam3_detector.feature_fingerprint", return_value=negative):
            with self.assertLogs("sam3_detector", level="INFO") as captured:
                candidates = processor.scan(
                    np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
                    [],
                    v2_bank(
                        v2_exemplar(
                            "POSITIVE",
                            "smart-mark",
                            fingerprint=positive,
                        ),
                        v2_exemplar(
                            "NEGATIVE",
                            "removed-lookalike",
                            fingerprint=negative,
                        ),
                    ),
                    allowed_mask=np.ones((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8),
                    source_view_id="ORIGINAL",
                )

        self.assertEqual(candidates, [])
        diagnostic = json.loads(captured.records[0].getMessage().split(" ", 1)[1])
        self.assertEqual(diagnostic["proposalOrigin"], "MEMORY")
        self.assertEqual(diagnostic["action"], "vetoed")
        self.assertEqual(
            diagnostic["memoryProposal"]["lessonSessionId"], "smart-mark"
        )

    def test_no_smart_mark_seed_leaves_detector_output_and_prompt_count_unchanged(self):
        localized = [{
            "box": (450, 500, 100, 100),
            "coreBox": (470, 520, 60, 60),
            "coreMask": np.ones((60, 60), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
        }]
        image = np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8)
        baseline_fake = FakeOfficialImageProcessor()
        baseline_processor = Sam3ImageProcessor()
        baseline_processor._processor = baseline_fake
        no_seed_fake = FakeOfficialImageProcessor()
        no_seed_processor = Sam3ImageProcessor()
        no_seed_processor._processor = no_seed_fake

        baseline = baseline_processor.scan(
            image,
            localized,
            v2_bank(),
            allowed_mask=np.ones((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8),
            source_view_id="ORIGINAL",
        )
        with self.assertLogs("sam3_detector", level="INFO"):
            no_seed = no_seed_processor.scan(
                image,
                localized,
                v2_bank(
                    v2_exemplar(
                        "POSITIVE",
                        "other-type-relabel",
                        defect_type="FRAYING",
                        provenance="DETECTOR_RELABELED_POSITIVE",
                    )
                ),
                allowed_mask=np.ones((GRID_HEIGHT, GRID_WIDTH), dtype=np.uint8),
                source_view_id="ORIGINAL",
            )

        self.assertEqual(len(no_seed), 1)
        self.assertEqual(
            {key: value for key, value in no_seed[0].items() if key != "mask"},
            {key: value for key, value in baseline[0].items() if key != "mask"},
        )
        np.testing.assert_array_equal(no_seed[0]["mask"], baseline[0]["mask"])
        self.assertEqual(len(baseline_fake.prompts), 1)
        self.assertEqual(len(no_seed_fake.prompts), 1)

    def test_cosine_learning_adds_only_the_tiny_matching_type_adjustment(self):
        fingerprint = [1.0] + [0.0] * 31
        positive = {
            "version": 1,
            "types": {
                "VISIBLE_WHITENING": {
                    "positive": {"count": 1, "sum": fingerprint},
                }
            },
        }
        negative = {
            "version": 1,
            "types": {
                "VISIBLE_WHITENING": {
                    "negative": {"count": 1, "sum": fingerprint},
                }
            },
        }

        self.assertEqual(
            learning_adjustment(fingerprint, "VISIBLE_WHITENING", positive), 0.06
        )
        self.assertEqual(
            learning_adjustment(fingerprint, "VISIBLE_WHITENING", negative), -0.06
        )
        self.assertEqual(
            learning_adjustment(fingerprint, "LIGHT_SCRATCH_SCUFF", positive), 0.0
        )

    def test_v2_strong_negative_veto_logs_one_compact_traceable_decision(self):
        fake = FakeOfficialImageProcessor()
        fake.scores = FakeTensor(np.array([0.96], dtype=np.float32))
        processor = Sam3ImageProcessor()
        processor._processor = fake
        localized = [{
            "box": (450, 500, 100, 100),
            "coreBox": (470, 520, 60, 60),
            "coreMask": np.ones((60, 60), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
        }]

        evidence = {
            "version": "speedster-detector-evidence-v1",
            "rawCandidates": [],
            "memoryDecisions": [],
        }
        with self.assertLogs("sam3_detector", level="INFO") as captured:
            candidates = processor.scan(
                np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
                localized,
                v2_bank(v2_exemplar("NEGATIVE", "removed-text")),
                source_view_id="FRONT:ORIGINAL",
                session_id="current-session",
                trace_id="request-trace",
                candidate_evidence=evidence,
            )

        self.assertEqual(candidates, [])
        self.assertEqual(len(captured.records), 1)
        diagnostic = json.loads(captured.records[0].getMessage().split(" ", 1)[1])
        self.assertEqual(diagnostic["action"], "vetoed")
        self.assertAlmostEqual(diagnostic["rawConfidence"], 0.96, places=6)
        self.assertEqual(diagnostic["sessionId"], "current-session")
        self.assertEqual(diagnostic["traceId"], "request-trace")
        self.assertEqual(diagnostic["sourceViewId"], "ORIGINAL")
        self.assertEqual(diagnostic["negativeMatchSessionId"], "removed-text")
        self.assertEqual(len(evidence["rawCandidates"]), 1)
        self.assertEqual(len(evidence["memoryDecisions"]), 1)
        self.assertEqual(evidence["rawCandidates"][0]["evidenceOrdinal"], 0)
        self.assertEqual(
            evidence["rawCandidates"][0]["candidateId"],
            evidence["memoryDecisions"][0]["candidateId"],
        )
        self.assertEqual(
            evidence["memoryDecisions"][0]["disposition"],
            "VETOED_BY_MEMORY",
        )

    def test_sub_threshold_adjustment_preserves_raw_candidate_and_separate_disposition(self):
        fake = FakeOfficialImageProcessor()
        fake.scores = FakeTensor(np.array([0.52], dtype=np.float32))
        processor = Sam3ImageProcessor()
        processor._processor = fake
        localized = [{
            "box": (450, 500, 100, 100),
            "coreBox": (470, 520, 60, 60),
            "coreMask": np.ones((60, 60), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
        }]
        evidence = {
            "version": "speedster-detector-evidence-v1",
            "rawCandidates": [],
            "memoryDecisions": [],
        }

        candidates = processor.scan(
            np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
            localized,
            {
                "version": 1,
                "types": {
                    "VISIBLE_WHITENING": {
                        "negative": {"count": 1, "sum": SAM_UNIT},
                    },
                },
            },
            source_view_id="FRONT:ORIGINAL",
            candidate_evidence=evidence,
        )

        self.assertEqual(candidates, [])
        self.assertEqual(len(evidence["rawCandidates"]), 1)
        decision = evidence["memoryDecisions"][0]
        self.assertEqual(decision["policy"], "LEGACY_MEMORY_V1")
        self.assertAlmostEqual(decision["adjustedConfidence"], 0.46, places=5)
        self.assertEqual(
            decision["disposition"],
            "SUPPRESSED_BELOW_COLLECTION_THRESHOLD",
        )

    def test_v2_positive_protection_keeps_surviving_measurements_identical(self):
        localized = [{
            "box": (450, 500, 100, 100),
            "coreBox": (470, 520, 60, 60),
            "coreMask": np.ones((60, 60), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
        }]
        baseline_processor = Sam3ImageProcessor()
        baseline_processor._processor = FakeOfficialImageProcessor()
        protected_processor = Sam3ImageProcessor()
        protected_processor._processor = FakeOfficialImageProcessor()
        image = np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8)

        with patch("sam3_detector.defect_candidates", return_value=localized):
            baseline = detect_views(
                [("FRONT:ORIGINAL", image)],
                "FRONT",
                "SQUARE",
                baseline_processor,
            )
            with self.assertLogs("sam3_detector", level="INFO") as captured:
                protected = detect_views(
                    [("FRONT:ORIGINAL", image)],
                    "FRONT",
                    "SQUARE",
                    protected_processor,
                    v2_bank(
                        v2_exemplar("NEGATIVE", "removed-text"),
                        v2_exemplar("POSITIVE", "real-damage"),
                    ),
                )

        self.assertEqual(len(baseline["defects"]), 1)
        self.assertEqual(len(protected["defects"]), 1)
        self.assertEqual(
            baseline["defects"][0]["canonicalContour"],
            protected["defects"][0]["canonicalContour"],
        )
        self.assertEqual(
            baseline["defects"][0]["measurement"],
            protected["defects"][0]["measurement"],
        )
        diagnostic = json.loads(captured.records[0].getMessage().split(" ", 1)[1])
        self.assertEqual(diagnostic["action"], "protected")

    def test_malformed_v2_is_inert_and_does_not_block_detection(self):
        fake = FakeOfficialImageProcessor()
        processor = Sam3ImageProcessor()
        processor._processor = fake
        malformed = v2_bank(v2_exemplar("NEGATIVE", "bad-bank"))
        malformed["exemplars"][0]["fingerprint"] = [1.0]
        localized = [{
            "box": (450, 500, 100, 100),
            "coreBox": (470, 520, 60, 60),
            "coreMask": np.ones((60, 60), dtype=bool),
            "defectType": "VISIBLE_WHITENING",
        }]

        with self.assertLogs("sam3_detector", level="INFO") as captured:
            candidates = processor.scan(
                np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
                localized,
                malformed,
                source_view_id="FRONT:ORIGINAL",
            )

        self.assertEqual(len(candidates), 1)
        self.assertAlmostEqual(candidates[0]["confidence"], 0.84, places=3)
        self.assertAlmostEqual(candidates[0]["rankingConfidence"], 0.84, places=3)
        self.assertEqual(candidates[0]["learningAdjustment"], 0.0)
        diagnostic = json.loads(captured.records[0].getMessage().split(" ", 1)[1])
        self.assertEqual(diagnostic["bankStatus"], "malformed")
        self.assertEqual(diagnostic["action"], "retained")

    def test_positive_evidence_cannot_change_the_pinned_sam_collection_threshold(self):
        source = inspect.getsource(Sam3ImageProcessor.load)

        self.assertIn("Sam3Processor(model, confidence_threshold=0.5)", source)
        self.assertNotIn("confidence_threshold=0.44", source)


if __name__ == "__main__":
    unittest.main()
