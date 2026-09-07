import base64
import copy
import json
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from fastapi.testclient import TestClient

import app as app_module
from defect_math import GRID_HEIGHT, GRID_WIDTH


ANCHORS = [
    {"id": "a1", "point": {"x": 0.22, "y": 0.24}},
    {"id": "a2", "point": {"x": 0.78, "y": 0.27}},
    {"id": "a3", "point": {"x": 0.74, "y": 0.76}},
    {"id": "a4", "point": {"x": 0.26, "y": 0.72}},
]
BOUNDARY = {
    "kind": "QUAD",
    "points": [
        {"x": 0.08, "y": 0.10},
        {"x": 0.92, "y": 0.11},
        {"x": 0.90, "y": 0.91},
        {"x": 0.10, "y": 0.89},
    ],
}
ZONES = [
    {
        "id": "front-text",
        "label": "Printed name",
        "semanticType": "PRINT_TEXT",
        "polygon": [
            {"x": 0.20, "y": 0.70},
            {"x": 0.80, "y": 0.70},
            {"x": 0.80, "y": 0.80},
            {"x": 0.20, "y": 0.80},
        ],
    }
]


def encoded_featureless_image():
    image = np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8)
    success, encoded = cv2.imencode(".png", image)
    if not success:
        raise RuntimeError("Test image could not be encoded")
    return base64.b64encode(encoded.tobytes()).decode("ascii")


class MapRegistrationApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app_module.app)
        image = encoded_featureless_image()
        cls.request = {
            "referenceImage": {"imageBase64": image},
            "currentImage": {"imageBase64": image},
            "mapId": "map-1",
            "mapRevisionId": "map-revision-1",
            "side": "FRONT",
            "currentPhysicalQuadSha256": "c" * 64,
            "currentInspectionSha256": "b" * 64,
            "referenceInspectionSha256": "a" * 64,
            "anchors": ANCHORS,
            "designBoundary": BOUNDARY,
            "zones": ZONES,
            "lessonCandidates": [],
        }

    def automatic_failure(self):
        response = self.client.post("/map-registration", json=self.request)
        self.assertEqual(response.status_code, 422, response.text)
        failure = response.json()["detail"]
        self.assertEqual(failure["failureCode"], "INSUFFICIENT_REDUNDANT_CORRESPONDENCES")
        return json.loads(json.dumps(failure))

    def rescue_request(self, automatic_failure):
        return {
            **self.request,
            "correctedAnchors": ANCHORS,
            "automaticFailure": automatic_failure,
        }

    def test_422_json_roundtrip_rescue_tolerates_epsilon_drift_and_echoes_original_diagnostics(self):
        submitted_failure = self.automatic_failure()
        real_register = app_module.register_map_design

        def recompute_with_epsilon_drift(*args, **kwargs):
            registered = real_register(*args, **kwargs)
            automatic_failure = registered["automaticFailure"]
            automatic_failure["bestCandidate"]["inlierFraction"] += (
                app_module.MAP_REGISTRATION_RESCUE_UNIT_TOLERANCE * 0.9
            )
            score = automatic_failure["bestCandidate"]["anchors"][0]["score"]
            score_drift = app_module.MAP_REGISTRATION_RESCUE_UNIT_TOLERANCE * 0.9
            automatic_failure["bestCandidate"]["anchors"][0]["score"] = (
                score + score_drift if score <= 1.0 - score_drift else score - score_drift
            )
            return registered

        with patch.object(
            app_module,
            "register_map_design",
            side_effect=recompute_with_epsilon_drift,
        ):
            response = self.client.post(
                "/map-registration",
                json=self.rescue_request(submitted_failure),
            )

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["acceptance"]["mode"], "HUMAN_CONFIRMED")
        self.assertEqual(result["candidateProvenance"]["source"], "HUMAN_CORRECTION")
        self.assertEqual(result["automaticFailure"], submitted_failure)

    def test_rescue_rejects_binding_candidate_hash_and_bounded_numeric_tampering(self):
        original = self.automatic_failure()
        cases = {}

        changed_revision = copy.deepcopy(original)
        changed_revision["binding"]["mapRevisionId"] = "tampered-revision"
        cases["map revision"] = changed_revision

        changed_inspection = copy.deepcopy(original)
        changed_inspection["binding"]["currentInspectionSha256"] = "d" * 64
        cases["inspection hash"] = changed_inspection

        changed_quad = copy.deepcopy(original)
        changed_quad["binding"]["currentPhysicalQuadSha256"] = "e" * 64
        cases["physical quad hash"] = changed_quad

        changed_reference = copy.deepcopy(original)
        changed_reference["binding"]["candidates"][0]["referenceInspectionSha256"] = "f" * 64
        cases["reference hash"] = changed_reference

        changed_candidate = copy.deepcopy(original)
        changed_candidate["candidateIds"][0] = "tampered-reference"
        changed_candidate["binding"]["candidates"][0]["candidateId"] = "tampered-reference"
        changed_candidate["bestCandidate"]["candidateId"] = "tampered-reference"
        cases["candidate identity"] = changed_candidate

        changed_numeric = copy.deepcopy(original)
        changed_numeric["bestCandidate"]["inlierFraction"] += (
            app_module.MAP_REGISTRATION_RESCUE_UNIT_TOLERANCE * 1.01
        )
        cases["out-of-bound numeric drift"] = changed_numeric

        for name, failure in cases.items():
            with self.subTest(name=name):
                response = self.client.post(
                    "/map-registration",
                    json=self.rescue_request(failure),
                )
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(
                    response.json()["detail"],
                    "Map registration rescue diagnostics do not match the server recomputation",
                )

    def test_rescue_drift_tolerances_have_explicit_inside_and_outside_bounds(self):
        submitted = self.automatic_failure()
        baseline = copy.deepcopy(submitted)
        baseline_best = baseline["bestCandidate"]
        baseline_best["anchors"][0]["trackedPoint"] = {"x": 0.5, "y": 0.5}
        baseline_best["anchors"][0]["locatedPoint"] = {"x": 0.5, "y": 0.5}
        baseline_best["anchors"][0]["score"] = 0.5
        baseline_best["inlierFraction"] = 0.5
        baseline_best["medianReprojectionErrorPx"] = 1.0
        baseline_best["maxReprojectionErrorPx"] = 2.0

        recomputed = copy.deepcopy(baseline)
        recomputed_best = recomputed["bestCandidate"]
        recomputed_best["anchors"][0]["trackedPoint"]["x"] += (
            app_module.MAP_REGISTRATION_RESCUE_POINT_TOLERANCE * 0.99
        )
        recomputed_best["anchors"][0]["score"] += (
            app_module.MAP_REGISTRATION_RESCUE_UNIT_TOLERANCE * 0.99
        )
        recomputed_best["inlierFraction"] += (
            app_module.MAP_REGISTRATION_RESCUE_UNIT_TOLERANCE * 0.99
        )
        recomputed_best["maxReprojectionErrorPx"] += (
            app_module.MAP_REGISTRATION_RESCUE_PIXEL_TOLERANCE * 0.99
        )
        self.assertTrue(
            app_module._registration_rescue_diagnostics_match(baseline, recomputed)
        )

        outside_mutations = {
            "point": lambda failure: failure["bestCandidate"]["anchors"][0][
                "trackedPoint"
            ].__setitem__(
                "x",
                0.5 + app_module.MAP_REGISTRATION_RESCUE_POINT_TOLERANCE * 1.01,
            ),
            "score": lambda failure: failure["bestCandidate"]["anchors"][0].__setitem__(
                "score",
                baseline_best["anchors"][0]["score"]
                + app_module.MAP_REGISTRATION_RESCUE_UNIT_TOLERANCE * 1.01,
            ),
            "inlier fraction": lambda failure: failure["bestCandidate"].__setitem__(
                "inlierFraction",
                baseline_best["inlierFraction"]
                + app_module.MAP_REGISTRATION_RESCUE_UNIT_TOLERANCE * 1.01,
            ),
            "reprojection": lambda failure: failure["bestCandidate"].__setitem__(
                "maxReprojectionErrorPx",
                2.0 + app_module.MAP_REGISTRATION_RESCUE_PIXEL_TOLERANCE * 1.01,
            ),
        }
        for name, mutate in outside_mutations.items():
            with self.subTest(name=name):
                outside = copy.deepcopy(baseline)
                mutate(outside)
                self.assertFalse(
                    app_module._registration_rescue_diagnostics_match(baseline, outside)
                )


if __name__ == "__main__":
    unittest.main()
