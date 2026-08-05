import unittest
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

from app import PreparedUploads, Point, TARGET_HEIGHT, TARGET_WIDTH, rectify, reveal_views
from card_geometry import (
    INSPECTION_HEIGHT,
    INSPECTION_MARGIN_PX,
    INSPECTION_WIDTH,
    PX_PER_MM,
    _candidate_contours,
    boundary_subtracted_anomaly_mask,
    defect_candidates,
    detector_material_mask,
    detect_card_quad,
    find_printed_border_offsets,
    material_distance_from_cut,
    printed_border_quad,
    warp_to_card_map,
    warp_to_inspection_map,
)


GEOMETRY_FIXTURES = Path(__file__).with_name("test-fixtures") / "geometry"
# Frozen once with `sips -s format jpeg -s formatOptions 95`; these are the
# original photos encoded so the old detector reproduces the production failure.
# Sources: IMG_9073.heic (Front, SHA-256
# 85ebd7389cb0f07d02d565e5cdca94637a793ca0c18eccf8b722f9db5b4dd47a)
# and IMG_9074.heic (Back, SHA-256
# 38827c30879da6e80079d1cd498a9cf829da77e415f8d3b7b3d0461ab9b49338).
CUBONE_FIXTURES = {
    "front": {
        "path": GEOMETRY_FIXTURES / "cubone-front.jpg",
        "sha256": "d2136a44fb8504727a48325282b573cf10c73a79b890be0db1b69f744840cd56",
        "expected": np.array(
            [
                [360.4451, 256.0918],
                [2727.0352, 270.9390],
                [2761.9783, 3653.6440],
                [289.4054, 3633.1233],
            ],
            dtype=np.float32,
        ),
    },
    "back": {
        "path": GEOMETRY_FIXTURES / "cubone-back.jpg",
        "sha256": "fa71097ee566bed76efab30543fbdacfc84e6d9c0a0ab3552b4e251b1cbe2338",
        "expected": np.array(
            [
                [371.4259, 398.2110],
                [2602.8545, 398.7044],
                [2627.9880, 3567.2173],
                [326.6972, 3548.3083],
            ],
            dtype=np.float32,
        ),
        "topRightRimRegion": {
            "version": "CUBONE_BACK_TOP_RIGHT_GEOMETRY_RIM_V1",
            "cornerZoneMm": 5.0,
            "maximumDistanceFromCutMm": 3.18,
            "maximumCoreFraction": 0.30,
        },
    },
}

# Derived only from the two immutable Cubone fixtures. The worst reconstructed
# source-corner error is 23.6475 px (ceil = 24); the worst canonical edge-normal
# residual is 9.9347 px and centering offset drift is 0.4000 mm (8 canonical px).
CUBONE_CORNER_ERROR_TOLERANCE_PX = 24


class SpeedsterGeometryTest(unittest.TestCase):
    def test_raw_anomaly_mask_keeps_component_filtered_from_detector_candidates(self):
        image = np.full(
            (INSPECTION_HEIGHT, INSPECTION_WIDTH, 3), 128, dtype=np.uint8
        )
        anomaly_x = INSPECTION_MARGIN_PX + TARGET_WIDTH // 2
        anomaly_y = INSPECTION_MARGIN_PX + TARGET_HEIGHT // 2
        image[anomaly_y, anomaly_x] = 255

        residual = boundary_subtracted_anomaly_mask(image, "SQUARE")
        candidates = defect_candidates(
            image,
            "SQUARE",
            "FRONT:ORIGINAL",
            maximum=1000,
        )

        self.assertTrue(residual[anomaly_y, anomaly_x])
        self.assertFalse(
            any(
                x <= anomaly_x < x + width and y <= anomaly_y < y + height
                for x, y, width, height in (
                    candidate["coreBox"] for candidate in candidates
                )
            )
        )

    def test_non_boundary_aligned_chip_at_the_rim_survives_subtraction(self):
        image = np.full(
            (INSPECTION_HEIGHT, INSPECTION_WIDTH, 3), 25, dtype=np.uint8
        )
        material = detector_material_mask(
            "SQUARE", INSPECTION_WIDTH, INSPECTION_HEIGHT
        )
        image[material > 0] = 200
        chip_x = INSPECTION_MARGIN_PX + 560
        cv2.line(
            image,
            (chip_x, INSPECTION_MARGIN_PX),
            (chip_x, INSPECTION_MARGIN_PX + 6),
            (20, 20, 20),
            thickness=3,
        )

        candidates = defect_candidates(
            image,
            "SQUARE",
            "BACK:ORIGINAL",
            maximum=1000,
        )

        self.assertTrue(
            any(
                x <= chip_x < x + width
                and y <= INSPECTION_MARGIN_PX + 3 < y + height
                for x, y, width, height in (
                    candidate["coreBox"] for candidate in candidates
                )
            )
        )

    def test_cubone_back_corner_residual_is_rim_scale_after_boundary_subtraction(self):
        fixture = CUBONE_FIXTURES["back"]
        rim_definition = fixture["topRightRimRegion"]
        self.assertEqual(
            rim_definition["version"],
            "CUBONE_BACK_TOP_RIGHT_GEOMETRY_RIM_V1",
        )
        encoded = fixture["path"].read_bytes()
        self.assertEqual(sha256(encoded).hexdigest(), fixture["sha256"])
        image = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)
        self.assertIsNotNone(image)
        inspection, _ = warp_to_inspection_map(image, fixture["expected"])

        candidates = defect_candidates(
            inspection,
            "ROUNDED_3_18_MM",
            "BACK:ORIGINAL",
            maximum=1000,
        )
        material = detector_material_mask(
            "ROUNDED_3_18_MM", INSPECTION_WIDTH, INSPECTION_HEIGHT
        )
        distance_from_cut = material_distance_from_cut(material)
        y, x = np.indices(material.shape)
        corner_zone = (
            (
                x
                >= INSPECTION_MARGIN_PX
                + TARGET_WIDTH
                - round(rim_definition["cornerZoneMm"] * PX_PER_MM)
            )
            & (
                y
                < INSPECTION_MARGIN_PX
                + round(rim_definition["cornerZoneMm"] * PX_PER_MM)
            )
            & (material > 0)
        )
        rim_region = corner_zone & (
            distance_from_cut
            <= round(rim_definition["maximumDistanceFromCutMm"] * PX_PER_MM)
        )
        core_area_bound = round(
            rim_definition["maximumCoreFraction"]
            * np.count_nonzero(corner_zone)
        )

        corner_candidates = []
        for candidate in candidates:
            core_x, core_y, core_width, core_height = candidate["coreBox"]
            core = np.zeros_like(material, dtype=bool)
            core[
                core_y : core_y + core_height,
                core_x : core_x + core_width,
            ] = candidate["coreMask"]
            if np.any(core & corner_zone):
                corner_candidates.append((candidate, core))

        self.assertTrue(corner_candidates)
        strongest, strongest_core = max(
            corner_candidates, key=lambda entry: entry[0]["score"]
        )
        _, _, core_width, core_height = strongest["coreBox"]
        self.assertLessEqual(core_width * core_height, core_area_bound)
        self.assertTrue(np.any(strongest_core & rim_region))

    def test_prepare_upload_contract_keeps_backend_first_rollout_compatible(self):
        legacy = PreparedUploads(
            rectified="rectified",
            normalized="normalized",
            microDefect="micro",
            directional="directional",
        )
        self.assertIsNone(legacy.inspection)
        expanded = PreparedUploads(
            rectified="rectified",
            inspection="inspection",
            normalized="normalized",
            microDefect="micro",
            directional="directional",
        )
        self.assertEqual(expanded.inspection, "inspection")

    def test_proposes_and_rectifies_four_card_corners(self):
        image = np.zeros((1600, 1200, 3), dtype=np.uint8)
        expected = np.array(
            [[140, 120], [1050, 140], [1030, 1415], [120, 1390]],
            dtype=np.int32,
        )
        cv2.fillConvexPoly(image, expected, (245, 245, 245))

        corners = detect_card_quad(image)
        self.assertIsNotNone(corners)
        np.testing.assert_allclose(corners, expected, atol=5)

        normalized = [Point(x=float(x / 1200), y=float(y / 1600)) for x, y in corners]
        rectified, transform = rectify(image, normalized)
        self.assertEqual(rectified.shape, (TARGET_HEIGHT, TARGET_WIDTH, 3))
        self.assertEqual(transform.shape, (3, 3))

        views = reveal_views(rectified)
        self.assertEqual(len(views), 3)
        self.assertTrue(all(view.shape[:2] == (TARGET_HEIGHT, TARGET_WIDTH) for view in views))

    def test_proposes_design_border_geometry(self):
        image = np.full((TARGET_HEIGHT, TARGET_WIDTH, 3), 225, dtype=np.uint8)
        expected = np.array([[115, 145], [1154, 145], [1154, 1632], [115, 1632]])
        cv2.rectangle(image, (115, 145), (1154, 1632), (15, 15, 15), 10)

        borders, detected, offsets = printed_border_quad(image)
        np.testing.assert_allclose(borders, expected, atol=7)
        self.assertEqual(detected, ["top", "right", "bottom", "left"])
        self.assertTrue(all(offsets[side] is not None for side in detected))

    def test_inspection_map_keeps_the_canonical_card_and_two_mm_context(self):
        image = np.full((1900, 1500, 3), (20, 80, 140), dtype=np.uint8)
        corners = np.array(
            [[100, 60], [1369, 60], [1369, 1837], [100, 1837]], dtype=np.float32
        )
        cv2.fillConvexPoly(image, corners.astype(np.int32), (235, 235, 235))

        rectified, _ = warp_to_card_map(image, corners)
        inspection, _ = warp_to_inspection_map(image, corners)

        self.assertEqual(inspection.shape, (INSPECTION_HEIGHT, INSPECTION_WIDTH, 3))
        card = inspection[
            INSPECTION_MARGIN_PX : INSPECTION_MARGIN_PX + TARGET_HEIGHT,
            INSPECTION_MARGIN_PX : INSPECTION_MARGIN_PX + TARGET_WIDTH,
        ]
        np.testing.assert_allclose(card, rectified, atol=1)
        self.assertGreater(float(card.mean()), 220)
        self.assertLess(float(inspection[:INSPECTION_MARGIN_PX].mean()), 120)

    def test_returns_none_instead_of_calling_the_photo_frame_a_card(self):
        image = np.full((900, 700, 3), 120, dtype=np.uint8)
        self.assertIsNone(detect_card_quad(image))

    def test_searches_visual_and_material_contours_separately_with_retr_list(self):
        image = np.full((900, 700, 3), 120, dtype=np.uint8)
        visual = np.array([[[10, 10]], [[20, 10]], [[20, 20]], [[10, 20]]])
        material = np.array([[[30, 30]], [[40, 30]], [[40, 40]], [[30, 40]]])

        with patch(
            "card_geometry.cv2.findContours",
            side_effect=[([visual], None), ([material], None)],
        ) as find:
            contours = _candidate_contours(image)

        self.assertEqual(len(find.call_args_list), 2)
        self.assertTrue(
            all(call.args[1] == cv2.RETR_LIST for call in find.call_args_list)
        )
        self.assertIs(contours[0], visual)
        self.assertIs(contours[1], material)

    def test_rejects_a_valid_scoring_contour_when_it_touches_the_photo_frame(self):
        image = np.full((900, 700, 3), 120, dtype=np.uint8)
        frame_touching = np.array(
            [[[0, 50]], [[500, 50]], [[500, 750]], [[0, 750]]], dtype=np.int32
        )

        with patch("card_geometry._candidate_contours", return_value=[frame_touching]):
            self.assertIsNone(detect_card_quad(image))

    def test_returns_none_for_a_clipped_card_at_the_photo_boundary(self):
        image = np.zeros((1600, 1200, 3), dtype=np.uint8)
        clipped = np.array(
            [[150, 0], [1060, 20], [1040, 1295], [130, 1270]], dtype=np.int32
        )
        cv2.fillConvexPoly(image, clipped, (245, 245, 245))

        self.assertIsNone(detect_card_quad(image))

    def test_real_cubone_quads_stay_within_the_derived_corner_tolerance(self):
        canonical = np.array(
            [
                [0, 0],
                [TARGET_WIDTH - 1, 0],
                [TARGET_WIDTH - 1, TARGET_HEIGHT - 1],
                [0, TARGET_HEIGHT - 1],
            ],
            dtype=np.float32,
        )
        for side, fixture in CUBONE_FIXTURES.items():
            with self.subTest(side=side):
                encoded = fixture["path"].read_bytes()
                self.assertEqual(sha256(encoded).hexdigest(), fixture["sha256"])
                image = cv2.imdecode(
                    np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR
                )
                self.assertIsNotNone(image)

                expected = fixture["expected"]
                actual = detect_card_quad(image)
                self.assertIsNotNone(actual)

                expected_to_canonical = cv2.getPerspectiveTransform(
                    expected, canonical
                )
                actual_canonical = cv2.perspectiveTransform(
                    np.asarray(actual, dtype=np.float32)[None, :, :],
                    expected_to_canonical,
                )[0]
                canonical_delta = actual_canonical - canonical
                canonical_edge_residuals = np.abs(
                    np.array(
                        [
                            canonical_delta[0, 1],
                            canonical_delta[1, 1],
                            canonical_delta[1, 0],
                            canonical_delta[2, 0],
                            canonical_delta[2, 1],
                            canonical_delta[3, 1],
                            canonical_delta[3, 0],
                            canonical_delta[0, 0],
                        ]
                    )
                )
                self.assertTrue(np.all(np.isfinite(canonical_edge_residuals)))

                expected_map, _ = warp_to_card_map(image, expected)
                actual_map, _ = warp_to_card_map(image, actual)
                expected_offsets = find_printed_border_offsets(expected_map)
                actual_offsets = find_printed_border_offsets(actual_map)
                centering_drift_mm = [
                    abs(expected_offsets[edge] - actual_offsets[edge])
                    for edge in expected_offsets
                    if expected_offsets[edge] is not None
                    and actual_offsets[edge] is not None
                ]
                self.assertEqual(len(centering_drift_mm), len(expected_offsets))

                source_corner_error_px = float(
                    np.max(
                        np.linalg.norm(
                            np.asarray(actual, dtype=np.float32) - expected,
                            axis=1,
                        )
                    )
                )
                observed_corner_error_px = max(
                    source_corner_error_px,
                    float(np.max(canonical_edge_residuals)),
                    max(centering_drift_mm) * PX_PER_MM,
                )
                self.assertLessEqual(
                    observed_corner_error_px,
                    CUBONE_CORNER_ERROR_TOLERANCE_PX,
                )


if __name__ == "__main__":
    unittest.main()
