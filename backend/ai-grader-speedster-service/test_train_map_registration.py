import unittest

import cv2
import numpy as np

from card_geometry import (
    MAP_REGISTRATION_MIN_FEATURES_PER_ANCHOR,
    MAP_REGISTRATION_MIN_INLIERS_PER_ANCHOR,
    MapRegistrationFailure,
    _AcceptanceGateFailure,
    _anchor_diagnostics,
    _unit_points,
    _validate_registration_result,
    _validate_transform_orientation,
    register_map_design,
)
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


def reference_image():
    image = np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8)
    image[:] = (25, 40, 55)
    for index, anchor in enumerate(ANCHORS):
        center = (
            round(anchor["point"]["x"] * (GRID_WIDTH - 1)),
            round(anchor["point"]["y"] * (GRID_HEIGHT - 1)),
        )
        cv2.circle(image, center, 32 + index * 2, (245, 245, 245), -1)
        cv2.line(image, (center[0] - 44, center[1]), (center[0] + 44, center[1]), (0, 80 + index * 35, 255), 8)
        cv2.line(image, (center[0], center[1] - 44), (center[0], center[1] + 44), (255, 100, 0), 8)
        cv2.putText(image, str(index + 1), (center[0] + 12, center[1] - 12), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 3)
    cv2.rectangle(image, (100, 140), (GRID_WIDTH - 120, GRID_HEIGHT - 160), (90, 190, 120), 8)
    return image


def project(point, homography):
    source = np.array(
        [[[point["x"] * (GRID_WIDTH - 1), point["y"] * (GRID_HEIGHT - 1)]]],
        dtype=np.float32,
    )
    x, y = cv2.perspectiveTransform(source, homography).reshape(2)
    return {"x": x / (GRID_WIDTH - 1), "y": y / (GRID_HEIGHT - 1)}


def centered_similarity(scale, angle_degrees):
    affine = cv2.getRotationMatrix2D(
        (GRID_WIDTH / 2, GRID_HEIGHT / 2),
        angle_degrees,
        scale,
    )
    return np.vstack([affine, [0, 0, 1]]).astype(np.float64)


class TrainMapRegistrationTests(unittest.TestCase):
    def test_region_support_failure_marks_directly_tracked_anchor_low_confidence(self):
        expected = _unit_points([anchor["point"] for anchor in ANCHORS])
        diagnostics = _anchor_diagnostics(
            ANCHORS,
            expected,
            expected.copy(),
            np.ones(4, dtype=bool),
            np.full(4, 0.95),
            [0.95, 0.95, 0.95, 0.95],
            [MAP_REGISTRATION_MIN_FEATURES_PER_ANCHOR - 1, 8, 8, 8],
            [MAP_REGISTRATION_MIN_INLIERS_PER_ANCHOR, 6, 6, 6],
            True,
        )
        self.assertEqual(diagnostics[0]["status"], "LOW_CONFIDENCE")
        self.assertTrue(all(item["status"] == "TRACKED" for item in diagnostics[1:]))

    def assert_point_close(self, actual, expected, tolerance=0.012):
        self.assertLessEqual(abs(actual["x"] - expected["x"]), tolerance)
        self.assertLessEqual(abs(actual["y"] - expected["y"]), tolerance)

    def test_orientation_guard_accepts_legitimate_translation_scale_rotation_and_projective_transforms(self):
        source_anchors = _unit_points([anchor["point"] for anchor in ANCHORS])
        cases = {
            "translation": np.array([[1, 0, 9], [0, 1, -6], [0, 0, 1]], dtype=np.float64),
            "scale": centered_similarity(0.985, 0),
            "rotation": centered_similarity(1.0, 1.5),
            "projective": cv2.getPerspectiveTransform(
                np.float32([
                    [0, 0],
                    [GRID_WIDTH - 1, 0],
                    [GRID_WIDTH - 1, GRID_HEIGHT - 1],
                    [0, GRID_HEIGHT - 1],
                ]),
                np.float32([
                    [8, 6],
                    [GRID_WIDTH - 11, 3],
                    [GRID_WIDTH - 5, GRID_HEIGHT - 9],
                    [4, GRID_HEIGHT - 4],
                ]),
            ).astype(np.float64),
        }
        for name, homography in cases.items():
            with self.subTest(name=name):
                projected = _validate_transform_orientation(homography, source_anchors)
                expected = cv2.perspectiveTransform(
                    source_anchors.reshape(-1, 1, 2), homography
                ).reshape(-1, 2)
                np.testing.assert_allclose(projected, expected, atol=1e-4)

    def test_shared_automatic_gate_rejects_reflected_registration(self):
        reflected = np.array(
            [[-1, 0, GRID_WIDTH - 1], [0, 1, 0], [0, 0, 1]],
            dtype=np.float64,
        )
        with self.assertRaisesRegex(_AcceptanceGateFailure, "orientation") as raised:
            _validate_registration_result(
                mode="AUTOMATIC_RANSAC",
                homography=reflected,
                feature_count=16,
                usable_count=16,
                inlier_count=16,
                inlier_fraction=1.0,
                per_anchor_feature_counts=[4, 4, 4, 4],
                per_anchor_inlier_counts=[4, 4, 4, 4],
                per_anchor_scores=[1.0, 1.0, 1.0, 1.0],
                median_reprojection_error=0.0,
                max_reprojection_error=0.0,
                registration_anchors=ANCHORS,
                design_boundary=BOUNDARY,
                zones=ZONES,
            )
        self.assertEqual(raised.exception.code, "PROJECTED_GEOMETRY_REJECTED")

    def test_orientation_guard_rejects_projective_pole_through_card(self):
        pole_through_card = np.array(
            [[1, 0, 0], [0, 1, 0], [-2 / (GRID_WIDTH - 1), 0, 1]],
            dtype=np.float64,
        )
        with self.assertRaisesRegex(ValueError, "projective pole"):
            _validate_transform_orientation(
                pole_through_card,
                _unit_points([anchor["point"] for anchor in ANCHORS]),
            )

    def test_current_copy_anchor_registration_handles_translation_scale_rotation_and_projective_change(self):
        reference = reference_image()
        cases = {
            "translation": np.array([[1, 0, 18], [0, 1, -14], [0, 0, 1]], dtype=np.float32),
            "scale_rotation": cv2.getRotationMatrix2D((GRID_WIDTH / 2, GRID_HEIGHT / 2), 1.3, 0.992),
            "projective": cv2.getPerspectiveTransform(
                np.float32([[0, 0], [GRID_WIDTH - 1, 0], [GRID_WIDTH - 1, GRID_HEIGHT - 1], [0, GRID_HEIGHT - 1]]),
                np.float32([[11, 8], [GRID_WIDTH - 17, 4], [GRID_WIDTH - 6, GRID_HEIGHT - 13], [7, GRID_HEIGHT - 3]]),
            ),
        }
        cases["scale_rotation"] = np.vstack([cases["scale_rotation"], [0, 0, 1]]).astype(np.float32)
        for name, homography in cases.items():
            with self.subTest(name=name):
                current = cv2.warpPerspective(reference, homography, (GRID_WIDTH, GRID_HEIGHT))
                registered = register_map_design(reference, current, ANCHORS, BOUNDARY, ZONES)
                self.assertGreater(registered["acceptance"]["featureCount"], 4)
                self.assertGreaterEqual(registered["acceptance"]["inlierCount"], 10)
                self.assertGreaterEqual(registered["acceptance"]["inlierFraction"], 0.65)
                self.assertLessEqual(registered["acceptance"]["medianReprojectionErrorPx"], 2.0)
                self.assertLessEqual(registered["acceptance"]["maxReprojectionErrorPx"], 5.0)
                self.assertEqual(registered["acceptance"]["mode"], "AUTOMATIC_RANSAC")
                for index, anchor in enumerate(ANCHORS):
                    self.assert_point_close(
                        registered["anchors"][index]["locatedPoint"],
                        project(anchor["point"], homography),
                    )
                for index, point in enumerate(BOUNDARY["points"]):
                    self.assert_point_close(
                        registered["projectedDesignBoundary"]["points"][index],
                        project(point, homography),
                    )

    def test_front_and_back_registration_are_isolated_and_never_reuse_training_copy_centering(self):
        reference = reference_image()
        front_transform = np.array([[1, 0, 13], [0, 1, 5], [0, 0, 1]], dtype=np.float32)
        back_transform = np.array([[1, 0, -16], [0, 1, 11], [0, 0, 1]], dtype=np.float32)
        front = register_map_design(
            reference,
            cv2.warpPerspective(reference, front_transform, (GRID_WIDTH, GRID_HEIGHT)),
            ANCHORS,
            BOUNDARY,
            ZONES,
        )
        back = register_map_design(
            reference,
            cv2.warpPerspective(reference, back_transform, (GRID_WIDTH, GRID_HEIGHT)),
            ANCHORS,
            BOUNDARY,
            ZONES,
        )
        self.assertNotEqual(front["projectedDesignBoundary"], BOUNDARY)
        self.assertNotEqual(back["projectedDesignBoundary"], BOUNDARY)
        self.assertNotEqual(front["projectedDesignBoundary"], back["projectedDesignBoundary"])

    def test_full_bleed_remains_explicit_without_fabricating_a_printed_border(self):
        image = reference_image()
        registered = register_map_design(image, image.copy(), ANCHORS, {"kind": "FULL_BLEED"}, ZONES)
        self.assertEqual(registered["projectedDesignBoundary"], {"kind": "FULL_BLEED"})

    def test_missing_or_invalid_human_anchors_fail_explicitly(self):
        image = reference_image()
        with self.assertRaisesRegex(ValueError, "four unique human anchors"):
            register_map_design(image, image, ANCHORS[:3], BOUNDARY, ZONES)
        malformed = [*ANCHORS[:3], {"id": "a3", "point": {"x": 0.5, "y": 0.5}}]
        with self.assertRaisesRegex(ValueError, "four unique human anchors"):
            register_map_design(image, image, malformed, BOUNDARY, ZONES)

    def test_featureless_copy_returns_bounded_anchor_diagnostics_without_an_applicable_transform(self):
        with self.assertRaises(MapRegistrationFailure) as raised:
            register_map_design(
                reference_image(),
                np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8),
                ANCHORS,
                BOUNDARY,
                ZONES,
            )
        diagnostics = raised.exception.diagnostics
        self.assertFalse(diagnostics["accepted"])
        self.assertEqual(diagnostics["candidateCount"], 1)
        self.assertEqual(diagnostics["candidateIds"], ["original-reference"])
        self.assertEqual(len(diagnostics["bestCandidate"]["anchors"]), 4)
        self.assertNotIn("homography", diagnostics)
        self.assertTrue(all(anchor["status"] in {
            "TRACKED", "LOW_CONFIDENCE", "FAILED", "OUT_OF_CARD"
        } for anchor in diagnostics["bestCandidate"]["anchors"]))

    def test_human_confirmation_uses_server_geometry_validation_and_rejects_out_of_card_points(self):
        current = np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8)
        corrected = [
            {"id": anchor["id"], "point": {"x": anchor["point"]["x"] + 0.01, "y": anchor["point"]["y"] - 0.005}}
            for anchor in ANCHORS
        ]
        registered = register_map_design(
            reference_image(), current, ANCHORS, BOUNDARY, ZONES,
            corrected_anchors=corrected,
        )
        self.assertEqual(registered["acceptance"]["mode"], "HUMAN_CONFIRMED")
        self.assertEqual(registered["candidateProvenance"]["source"], "HUMAN_CORRECTION")
        self.assertIn("automaticFailure", registered)
        invalid = [*corrected[:3], {"id": corrected[3]["id"], "point": {"x": -0.01, "y": 0.8}}]
        with self.assertRaisesRegex(ValueError, "normalized card grid"):
            register_map_design(
                reference_image(), current, ANCHORS, BOUNDARY, ZONES,
                corrected_anchors=invalid,
            )

    def test_human_confirmation_preserves_legitimate_orientation_across_transform_types(self):
        current = np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8)
        cases = {
            "translation": np.array([[1, 0, 6], [0, 1, -4], [0, 0, 1]], dtype=np.float64),
            "scale": centered_similarity(0.99, 0),
            "rotation": centered_similarity(1.0, 0.8),
            "projective": cv2.getPerspectiveTransform(
                np.float32([
                    [0, 0],
                    [GRID_WIDTH - 1, 0],
                    [GRID_WIDTH - 1, GRID_HEIGHT - 1],
                    [0, GRID_HEIGHT - 1],
                ]),
                np.float32([
                    [5, 5],
                    [GRID_WIDTH - 7, 3],
                    [GRID_WIDTH - 4, GRID_HEIGHT - 6],
                    [3, GRID_HEIGHT - 4],
                ]),
            ).astype(np.float64),
        }
        for name, homography in cases.items():
            with self.subTest(name=name):
                corrected = [
                    {"id": anchor["id"], "point": project(anchor["point"], homography)}
                    for anchor in ANCHORS
                ]
                registered = register_map_design(
                    reference_image(),
                    current,
                    ANCHORS,
                    BOUNDARY,
                    ZONES,
                    corrected_anchors=corrected,
                )
                self.assertEqual(registered["acceptance"]["mode"], "HUMAN_CONFIRMED")

    def test_human_confirmation_rejects_crossed_anchor_correspondences(self):
        current = np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8)
        crossed_points = [
            ANCHORS[0]["point"],
            ANCHORS[2]["point"],
            ANCHORS[1]["point"],
            ANCHORS[3]["point"],
        ]
        crossed = [
            {"id": anchor["id"], "point": crossed_points[index]}
            for index, anchor in enumerate(ANCHORS)
        ]
        with self.assertRaisesRegex(ValueError, "(orientation|projective pole)"):
            register_map_design(
                reference_image(),
                current,
                ANCHORS,
                BOUNDARY,
                ZONES,
                corrected_anchors=crossed,
            )

    def test_human_confirmation_rejects_degenerate_or_off_card_projected_map_geometry(self):
        current = np.zeros((GRID_HEIGHT, GRID_WIDTH, 3), dtype=np.uint8)
        shifted_inside_anchors = [
            {"id": anchor["id"], "point": {"x": anchor["point"]["x"] + 0.10, "y": anchor["point"]["y"]}}
            for anchor in ANCHORS
        ]
        with self.assertRaisesRegex(ValueError, "outside the current physical card"):
            register_map_design(
                reference_image(), current, ANCHORS, BOUNDARY, ZONES,
                corrected_anchors=shifted_inside_anchors,
            )
        collinear = [
            {"id": anchor["id"], "point": {"x": 0.2 + index * 0.15, "y": 0.5}}
            for index, anchor in enumerate(ANCHORS)
        ]
        with self.assertRaisesRegex(ValueError, "degenerate"):
            register_map_design(
                reference_image(), current, ANCHORS, BOUNDARY, ZONES,
                corrected_anchors=collinear,
            )

    def test_verified_lesson_image_is_an_independent_redundant_candidate(self):
        source = reference_image()
        source_to_lesson = np.array([[1, 0, 12], [0, 1, 8], [0, 0, 1]], dtype=np.float32)
        lesson_to_current = np.array([[1, 0, -7], [0, 1, 11], [0, 0, 1]], dtype=np.float32)
        lesson_image = cv2.warpPerspective(source, source_to_lesson, (GRID_WIDTH, GRID_HEIGHT))
        current = cv2.warpPerspective(lesson_image, lesson_to_current, (GRID_WIDTH, GRID_HEIGHT))
        scale = np.array([[GRID_WIDTH - 1, 0, 0], [0, GRID_HEIGHT - 1, 0], [0, 0, 1]], dtype=np.float64)
        source_to_lesson_unit = np.linalg.inv(scale) @ source_to_lesson @ scale
        lesson_anchors = [
            {"id": anchor["id"], "point": project(anchor["point"], source_to_lesson)}
            for anchor in ANCHORS
        ]
        registered = register_map_design(
            np.zeros_like(source),
            current,
            ANCHORS,
            BOUNDARY,
            ZONES,
            lesson_candidates=[{
                "candidateId": "lesson-1",
                "referenceImage": lesson_image,
                "anchors": lesson_anchors,
                "sourceHomography": source_to_lesson_unit.reshape(-1).tolist(),
            }],
        )
        self.assertEqual(registered["candidateProvenance"], {
            "candidateId": "lesson-1",
            "source": "REGISTRATION_LESSON",
            "lessonId": "lesson-1",
        })
        combined = lesson_to_current @ source_to_lesson
        for index, anchor in enumerate(ANCHORS):
            self.assert_point_close(registered["anchors"][index]["locatedPoint"], project(anchor["point"], combined))

    def test_lesson_candidate_rejects_reflected_source_transform_and_anchors(self):
        source = reference_image()
        reflected_unit = np.array(
            [[-1, 0, 1], [0, 1, 0], [0, 0, 1]],
            dtype=np.float64,
        )
        reflected_anchors = [
            {
                "id": anchor["id"],
                "point": {"x": 1 - anchor["point"]["x"], "y": anchor["point"]["y"]},
            }
            for anchor in ANCHORS
        ]
        with self.assertRaisesRegex(ValueError, "orientation"):
            register_map_design(
                np.zeros_like(source),
                source,
                ANCHORS,
                BOUNDARY,
                ZONES,
                lesson_candidates=[{
                    "candidateId": "reflected-lesson",
                    "referenceImage": cv2.flip(source, 1),
                    "anchors": reflected_anchors,
                    "sourceHomography": reflected_unit.reshape(-1).tolist(),
                }],
            )

if __name__ == "__main__":
    unittest.main()
