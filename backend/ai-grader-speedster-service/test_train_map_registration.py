import unittest

import cv2
import numpy as np

from card_geometry import register_map_design
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


class TrainMapRegistrationTests(unittest.TestCase):
    def assert_point_close(self, actual, expected, tolerance=0.012):
        self.assertLessEqual(abs(actual["x"] - expected["x"]), tolerance)
        self.assertLessEqual(abs(actual["y"] - expected["y"]), tolerance)

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

if __name__ == "__main__":
    unittest.main()
