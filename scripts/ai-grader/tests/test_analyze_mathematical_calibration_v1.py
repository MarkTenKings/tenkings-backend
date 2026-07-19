from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np


SCRIPT = Path(__file__).parents[1] / 'analyze-mathematical-calibration-v1.py'
SPEC = importlib.util.spec_from_file_location('mathematical_calibration_v1', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)
PRESEAL_SCRIPT = SCRIPT.with_name(
    'prepare-mathematical-calibration-repeatability-v1.py')
PRESEAL_SPEC = importlib.util.spec_from_file_location(
    'mathematical_calibration_repeatability_preseal_v1', PRESEAL_SCRIPT)
PRESEAL = importlib.util.module_from_spec(PRESEAL_SPEC)
assert PRESEAL_SPEC and PRESEAL_SPEC.loader
PRESEAL_SPEC.loader.exec_module(PRESEAL)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_png(path: Path, image: np.ndarray) -> None:
    success, encoded = cv2.imencode('.png', image)
    if not success:
        raise RuntimeError('synthetic PNG encoding failed')
    path.write_bytes(encoded.tobytes())


def checkerboard() -> np.ndarray:
    pixels_per_mm = 12
    cell = 5 * pixels_per_mm
    coupon_width = round(63.5 * pixels_per_mm)
    coupon_height = round(88.9 * pixels_per_mm)
    board = np.full((coupon_height, coupon_width), 255, np.uint8)
    board_width = 12 * cell
    board_height = 17 * cell
    offset_x = (coupon_width - board_width) // 2
    offset_y = (coupon_height - board_height) // 2
    for row in range(17):
        for column in range(12):
            if (row + column) % 2 == 0:
                board[offset_y + row * cell:offset_y + (row + 1) * cell,
                      offset_x + column * cell:
                      offset_x + (column + 1) * cell] = 0
    return board


def geometry_view(board: np.ndarray, index: int) -> np.ndarray:
    canvas_width, canvas_height = 1400, 1900
    source = np.float32([
        [0, 0], [board.shape[1] - 1, 0],
        [board.shape[1] - 1, board.shape[0] - 1],
        [0, board.shape[0] - 1],
    ])
    shift_x = (index % 5 - 2) * 36
    shift_y = (index // 5 - 0.5) * 180
    skew = (index % 3 - 1) * 7
    destination = np.float32([
        [270 + shift_x + skew, 330 + shift_y],
        [1120 + shift_x, 315 + shift_y - skew],
        [1140 + shift_x - skew, 1515 + shift_y],
        [250 + shift_x, 1530 + shift_y + skew],
    ])
    center = destination.mean(axis=0)
    rotation_degrees = (index - 4.5) * 0.6
    radians = np.deg2rad(rotation_degrees)
    rotation = np.float32([
        [np.cos(radians), -np.sin(radians)],
        [np.sin(radians), np.cos(radians)],
    ])
    destination = (destination - center) @ rotation.T + center
    transform = cv2.getPerspectiveTransform(source, destination)
    return cv2.warpPerspective(
        board, transform, (canvas_width, canvas_height),
        flags=cv2.INTER_LINEAR, borderValue=210)


class MathematicalCalibrationAnalysisTest(unittest.TestCase):
    def build_fixture(self, root: Path) -> Path:
        operator_id = 'offline-test'
        finalized_at = '2026-07-18T20:00:00.000Z'
        instrument = {
            'instrumentId': 'synthetic-traceable-ruler',
            'kind': 'traceable_ruler',
            'calibrationVersion': 'synthetic-instrument-v1',
            'calibrationSha256': 'a' * 64,
        }
        repeatability_instrument = {
            'instrumentId':
                'ten-kings-fixed-rig-repeatability-analyzer-v1',
            'kind': 'fixed_rig_geometry',
            'calibrationVersion':
                'opencv_checkerboard_repeatability_measurement_v1',
            'calibrationSha256': digest(SCRIPT),
        }
        measurement_counter = 0

        def measurement_provenance(method: str,
                                   selected_instrument=None) -> dict:
            nonlocal measurement_counter
            measurement_counter += 1
            return {
                'operatorId': operator_id,
                'recordedAt':
                    f'2026-07-18T20:01:00.{measurement_counter:03d}Z',
                'measurementMethod': method,
                'instrument': selected_instrument or instrument,
            }

        board = checkerboard()
        geometry_entries = []
        for index in range(10):
            path = root / f'geometry-{index + 1:02d}.png'
            write_png(path, geometry_view(board, index))
            geometry_entries.append({
                'evidenceId': f'geometry-{index + 1:02d}',
                'path': path.name,
                'sha256': digest(path),
            })
        normalization_entries = []
        for index in range(10):
            path = root / f'normalization-{index + 1:02d}.png'
            normalization_image = geometry_view(board, index)
            normalization_image[0, index] = 209
            write_png(path, normalization_image)
            normalization_entries.append({
                'evidenceId': f'normalization-{index + 1:02d}',
                'path': path.name,
                'sha256': digest(path),
            })
        placement_reference = geometry_view(board, 4)
        placement_entries = []
        for index in range(10):
            shift = (index - 4.5) * 0.04
            transform = np.float32([[1, 0, shift], [0, 1, -shift * 0.8]])
            placement_image = cv2.warpAffine(
                placement_reference, transform,
                (placement_reference.shape[1], placement_reference.shape[0]),
                flags=cv2.INTER_LINEAR, borderValue=210)
            amplitude = 1 + (index % 3)
            yy, xx = np.indices(placement_image.shape)
            texture_mask = (xx + yy) % 2 == 0
            darker = texture_mask & (placement_image >= 128)
            lighter = texture_mask & (placement_image < 128)
            textured = placement_image.astype(np.int16)
            textured[darker] -= amplitude
            textured[lighter] += amplitude
            placement_image = np.clip(textured, 0, 255).astype(np.uint8)
            placement_image[1, index] = 208
            path = root / f'placement-{index + 1:02d}.png'
            write_png(path, placement_image)
            placement_entries.append({
                'evidenceId': f'placement-{index + 1:02d}',
                'path': path.name,
                'sha256': digest(path),
            })
        channel_entries = []
        y, x = np.mgrid[0:128, 0:128]
        for channel in range(1, 9):
            angle = (channel - 1) * np.pi / 4
            normalized_x = (x - 63.5) / 63.5
            normalized_y = (y - 63.5) / 63.5
            frames = []
            dark_frames = []
            pattern_frames = []
            direction_measurements = []
            for frame_index in range(3):
                response = (
                     150.0 + channel * 3.0 +
                     48.0 * (np.cos(angle) * normalized_x +
                            np.sin(angle) * (63.5 / 88.9) * normalized_y) +
                    1.0 * np.sin((x + channel * 2) / 30.0) +
                    0.8 * np.cos((y - channel) / 27.0) +
                    frame_index * 0.2
                )
                image = np.clip(response, 1, 254).astype(np.uint8)
                path = root / f'flat-{channel}-{frame_index + 1}.png'
                write_png(path, image)
                frames.append({
                    'evidenceId': f'flat-{channel}-{frame_index + 1}',
                    'path': path.name,
                    'sha256': digest(path),
                })
                pattern_path = (
                    root / f'pattern-{channel}-{frame_index + 1}.png')
                pattern_image = image.copy()
                pattern_image[0, 0] = max(1, int(pattern_image[0, 0]) - 1)
                write_png(pattern_path, pattern_image)
                pattern_frames.append({
                    'evidenceId':
                        f'pattern-{channel}-{frame_index + 1}',
                    'path': pattern_path.name,
                    'sha256': digest(pattern_path),
                })
                dark_path = root / f'dark-{channel}-{frame_index + 1}.png'
                write_png(
                    dark_path,
                    np.full((128, 128), 10 + channel * 3 + frame_index,
                            np.uint8))
                dark_frames.append({
                    'evidenceId': f'dark-{channel}-{frame_index + 1}',
                    'path': dark_path.name,
                    'sha256': digest(dark_path),
                })
                direction_path = (
                    root / f'direction-{channel}-{frame_index + 1}.json')
                source_point = {
                    'x': round(31.75 + 30 * float(np.cos(angle)), 6),
                    'y': round(44.45 + 30 * float(np.sin(angle)), 6),
                }
                provenance = measurement_provenance(
                    'fixed_ring_segment_geometry_with_ruler_v1')
                direction_path.write_text(json.dumps({
                    'schemaVersion':
                        'ten-kings-calibration-direction-measurement-v1',
                    'channelIndex': channel,
                    'sampleIndex': frame_index + 1,
                    'measurementMethod':
                        'fixed_ring_segment_geometry_with_ruler_v1',
                    'sourcePointMm': source_point,
                    'cardCenterPointMm': {'x': 31.75, 'y': 44.45},
                    'pointU95Mm': 0.05,
                    **provenance,
                }, sort_keys=True) + '\n', encoding='utf-8')
                direction_measurements.append({
                    'evidenceId':
                        f'direction-{channel}-{frame_index + 1}',
                    'path': direction_path.name,
                    'sha256': digest(direction_path),
                    'sampleIndex': frame_index + 1,
                    'measurementMethod':
                        'fixed_ring_segment_geometry_with_ruler_v1',
                    'sourcePointMm': source_point,
                    'cardCenterPointMm': {'x': 31.75, 'y': 44.45},
                    'pointU95Mm': 0.05,
                    **provenance,
                })
            channel_entries.append({
                'channelIndex': channel,
                'frames': frames,
                'darkFrames': dark_frames,
                'directionMeasurements': direction_measurements,
                'illuminationPatternFrames': pattern_frames,
            })

        measurement_repeatability = []
        placement_measurement_views = []
        for entry in placement_entries:
            placement_path = root / entry['path']
            image = MODULE.load_gray(placement_path)
            points = MODULE.orient_points(
                MODULE.detect_checkerboard(image, 11, 16), 11, 16)
            placement_measurement_views.append({
                'points': points,
                'path': placement_path,
            })
        repeatability_values = (
            MODULE.compute_checkerboard_repeatability_measurements(
                placement_measurement_views, 11, 16))
        for measurement_class in (
                'linear_mm', 'area_mm2', 'relief_index',
                'roughness_index', 'color_delta_e'):
            for index in range(10):
                path = root / f'repeat-{measurement_class}-{index + 1}.json'
                measured_value = repeatability_values[
                    measurement_class][index]
                provenance = measurement_provenance(
                    'fixed_reference_repeatability_v1',
                    repeatability_instrument)
                source = placement_entries[index]
                source_binding = {
                    'sourceCaptureOperationId':
                        f'capture-{source["evidenceId"]}',
                    'sourceEvidenceId': source['evidenceId'],
                    'sourceSha256': source['sha256'],
                    'sourceRole': 'repeated_placement',
                    'measurementAlgorithmVersion':
                        'opencv_checkerboard_repeatability_measurement_v1',
                    'fixedRoiDefinition':
                        'registered_checkerboard_center_cell_and_grid_spacing_v1',
                }
                path.write_text(json.dumps({
                    'schemaVersion':
                        'ten-kings-calibration-repeatability-measurement-v1',
                    'measurementClass': measurement_class,
                    'sampleIndex': index + 1,
                    'referenceFeatureId':
                        f'checkerboard-repeatability-{measurement_class}-v1',
                    'measuredValue': measured_value,
                    **source_binding,
                    **provenance,
                }, sort_keys=True) + '\n', encoding='utf-8')
                measurement_repeatability.append({
                    'evidenceId': f'repeat-{measurement_class}-{index + 1}',
                    'path': path.name,
                    'sha256': digest(path),
                    'measurementClass': measurement_class,
                    'sampleIndex': index + 1,
                    'referenceFeatureId':
                        f'checkerboard-repeatability-{measurement_class}-v1',
                    'measuredValue': measured_value,
                    **source_binding,
                    **provenance,
                })

        target_path = root / 'synthetic-target.pdf'
        target_path.write_bytes(b'%PDF-1.4\n% synthetic calibration target fixture\n')
        target_hash = digest(target_path)
        rig_id = 'fixed-rig-test'
        capture_profile_version = (
            'ten-kings-fixed-rig-mathematical-calibration-v1')
        target_version = (
            'ten-kings-mathematical-calibration-target-v1.0.0')
        print_scale_entries = {}
        for axis, nominal, measured, u95 in (
                ('x', 100.0, 100.0, 0.05),
                ('y', 200.0, 200.0, 0.10)):
            path = root / f'print-scale-{axis}.json'
            provenance = measurement_provenance(
                'traceable_ruler_direct_v1')
            measurement = {
                'schemaVersion':
                    'ten-kings-calibration-print-scale-measurement-v1',
                'axis': axis,
                'nominalSpanMm': nominal,
                'measuredSpanMm': measured,
                'measurementU95Mm': u95,
                **provenance,
            }
            path.write_text(
                json.dumps(measurement, sort_keys=True) + '\n',
                encoding='utf-8')
            print_scale_entries[axis] = {
                'evidenceId': f'synthetic-print-scale-{axis}',
                'path': path.name,
                'sha256': digest(path),
                'nominalSpanMm': nominal,
                'measuredSpanMm': measured,
                'measurementU95Mm': u95,
                **provenance,
            }
        cut_dimension_entries = {}
        for axis, nominal, measured, u95 in (
                ('x', 63.5, 63.5, 0.05),
                ('y', 88.9, 88.9, 0.05)):
            path = root / f'target-cut-dimension-{axis}.json'
            provenance = measurement_provenance(
                'traceable_ruler_direct_v1')
            measurement = {
                'schemaVersion':
                    'ten-kings-calibration-target-cut-dimension-measurement-v1',
                'axis': axis,
                'nominalDimensionMm': nominal,
                'measuredDimensionMm': measured,
                'measurementU95Mm': u95,
                **provenance,
            }
            path.write_text(
                json.dumps(measurement, sort_keys=True) + '\n',
                encoding='utf-8')
            cut_dimension_entries[axis] = {
                'evidenceId': f'synthetic-target-cut-dimension-{axis}',
                'path': path.name,
                'sha256': digest(path),
                'nominalDimensionMm': nominal,
                'measuredDimensionMm': measured,
                'measurementU95Mm': u95,
                **provenance,
            }
        target_entry = {
            'evidenceId': 'synthetic-target',
            'path': target_path.name,
            'version': target_version,
            'sha256': target_hash,
            'couponWidthMm': 63.5,
            'couponHeightMm': 88.9,
            'cutDimensionVerification': cut_dimension_entries,
            'printScaleVerification': print_scale_entries,
        }
        package_artifacts = []
        capture_counter = 0

        def next_capture_timestamp() -> str:
            nonlocal capture_counter
            capture_counter += 1
            return f'2026-07-18T20:02:00.{capture_counter:03d}Z'

        def pose_for(sample_index: int) -> dict:
            x = 0.44 + ((sample_index - 1) % 5) * 0.03
            y = 0.44 + ((sample_index - 1) // 5) * 0.12
            return {
                'centerXFraction': round(x, 6),
                'centerYFraction': round(y, 6),
                'coverageFraction': 0.4,
                'rotationDegrees': round(-2.5 +
                                         (sample_index - 1) * 0.6, 6),
                'cornerSignature': [
                    round(x - 0.2, 6), round(y - 0.2, 6),
                    round(x + 0.2, 6), round(y - 0.2, 6),
                    round(x + 0.2, 6), round(y + 0.2, 6),
                    round(x - 0.2, 6), round(y + 0.2, 6),
                ],
            }

        def raw_hardware(role, channel_index, timestamp):
            enabled_channels = ([] if role.startswith('dark_control_') else
                                ([channel_index] if channel_index is not None
                                 else list(range(1, 9))))
            duty = 0.0 if not enabled_channels else 1.2
            return {
                'camera': {
                    'serialNumber': 'SYNTHETIC-SERIAL',
                    'modelName': 'Basler-synthetic',
                    'transport': 'GigE',
                    'sourcePixelFormat': 'Mono8',
                    'savedImageFormat': 'PNG',
                    'exposureUs': 6200,
                    'gain': 0,
                },
                'pylon': {
                    'version': '7.5.0-test',
                    'bridgeVersion': 'basler-pylon-bridge-test',
                },
                'leimac': {
                    'unit': 1,
                    'dutyPercent': duty,
                    'enabledChannels': enabled_channels,
                    'expectedWriteCount': 3,
                    'acknowledgedWriteCount': 3,
                    'responseKinds': ['ack', 'ack', 'ack'],
                    'complete': True,
                },
                'safeOff': {
                    'beforeCaptureConfirmed': True,
                    'afterCaptureConfirmed': True,
                    'confirmedAt': timestamp,
                },
            }

        def base_artifact(entry, role, artifact_class, operation_id,
                          captured_at, channel_index=None):
            file_path = root / entry['path']
            return {
                'evidenceId': entry['evidenceId'],
                'path': entry['path'],
                'sha256': entry['sha256'],
                'role': role,
                'artifactClass': artifact_class,
                'rigId': rig_id,
                'captureProfileVersion': capture_profile_version,
                'subjectDesignation': 'calibration_target',
                'productionCard': False,
                'operationId': operation_id,
                'capturedAt': captured_at,
                'channelIndex': channel_index,
                'byteSize': file_path.stat().st_size,
                'mediaType': (
                    'application/pdf' if artifact_class == 'target' else
                    'application/json' if artifact_class == 'measurement'
                    else 'image/png'),
            }

        raw_roles = {
            'lens_geometry', 'normalization_registration',
            'repeated_placement'}

        def declare(entries, role, channel_index=None):
            for list_index, entry in enumerate(entries):
                sample_index = int(entry.get('sampleIndex', list_index + 1))
                if role == 'print_verified_calibration_target':
                    artifact = base_artifact(
                        entry, role, 'target', 'session-start',
                        '2026-07-18T20:00:00.000Z', channel_index)
                    package_artifacts.append(artifact)
                    continue
                if (role == 'measurement_repeatability' or
                        role.startswith('direction_geometry_channel_') or
                        role.startswith('target_cut_dimension_') or
                        role.startswith('print_scale_verification_')):
                    artifact = base_artifact(
                        entry, role, 'measurement',
                        f'measurement-{entry["evidenceId"]}',
                        entry['recordedAt'], channel_index)
                    package_artifacts.append(artifact)
                    continue
                captured_at = next_capture_timestamp()
                operation_id = f'capture-{entry["evidenceId"]}'
                target_face = (
                    'checkerboard' if role in raw_roles else
                    'blank_reverse')
                if role in raw_roles:
                    artifact = base_artifact(
                        entry, role, 'raw_capture', operation_id,
                        captured_at, channel_index)
                    artifact.update({
                        'targetFace': target_face,
                        'pose': pose_for(sample_index),
                        **raw_hardware(role, channel_index, captured_at),
                    })
                    if role == 'repeated_placement':
                        artifact['removeReseatCycleId'] = (
                            f'remove-reseat-cycle-{sample_index}')
                    package_artifacts.append(artifact)
                    normalized_path = root / f'normalized-{entry["path"]}'
                    raw_image = cv2.imread(
                        str(root / entry['path']), cv2.IMREAD_GRAYSCALE)
                    normalized_image = cv2.resize(
                        raw_image, (1120, 1568),
                        interpolation=cv2.INTER_AREA)
                    marker = int(hashlib.sha256(
                        entry['evidenceId'].encode('utf-8')).hexdigest()[:4],
                        16)
                    normalized_image[0, marker % 1120] = marker % 200
                    write_png(normalized_path, normalized_image)
                    normalized_entry = {
                        'evidenceId': f'{entry["evidenceId"]}-normalized',
                        'path': normalized_path.name,
                        'sha256': digest(normalized_path),
                    }
                    normalized_artifact = base_artifact(
                        normalized_entry, f'{role}_normalized',
                        'normalized_derivative', operation_id, captured_at,
                        channel_index)
                    normalized_artifact.update({
                        'targetFace': target_face,
                        'parentEvidenceId': entry['evidenceId'],
                        'parentSha256': entry['sha256'],
                        'pose': pose_for(sample_index),
                        'normalization': {
                            'algorithmVersion':
                                'ten-kings-card-geometry-v1',
                            'sourceSha256': entry['sha256'],
                            'coordinateFrame':
                                'normalized_card_portrait_pixels',
                            'widthPx': 1120,
                            'heightPx': 1568,
                            'geometricResamplingApplied': True,
                            'sourceCropWidth': 850,
                            'sourceCropHeight': 1200,
                            'scaleX': 1.317647,
                            'scaleY': 1.306667,
                            'deskewAppliedDegrees': 0.0,
                        },
                    })
                    if role == 'repeated_placement':
                        normalized_artifact['removeReseatCycleId'] = (
                            f'remove-reseat-cycle-{sample_index}')
                    package_artifacts.append(normalized_artifact)
                    continue
                normalized_path = root / entry['path']
                raw_parent_path = root / f'raw-parent-{entry["path"]}'
                image = cv2.imread(str(normalized_path), cv2.IMREAD_GRAYSCALE)
                success, encoded = cv2.imencode(
                    '.png', image, [cv2.IMWRITE_PNG_COMPRESSION, 0])
                if not success:
                    raise RuntimeError('synthetic raw-parent encoding failed')
                raw_parent_path.write_bytes(encoded.tobytes())
                parent_entry = {
                    'evidenceId': f'{entry["evidenceId"]}-raw',
                    'path': raw_parent_path.name,
                    'sha256': digest(raw_parent_path),
                }
                raw_artifact = base_artifact(
                    parent_entry, f'{role}_raw', 'raw_capture', operation_id,
                    captured_at, channel_index)
                raw_artifact.update({
                    'targetFace': target_face,
                    'pose': pose_for(sample_index),
                    **raw_hardware(f'{role}_raw', channel_index, captured_at),
                })
                normalized_artifact = base_artifact(
                    entry, role, 'normalized_derivative', operation_id,
                    captured_at, channel_index)
                normalized_artifact.update({
                    'targetFace': target_face,
                    'parentEvidenceId': parent_entry['evidenceId'],
                    'parentSha256': parent_entry['sha256'],
                    'pose': pose_for(sample_index),
                    'normalization': {
                        'algorithmVersion': 'ten-kings-card-geometry-v1',
                        'sourceSha256': parent_entry['sha256'],
                        'coordinateFrame':
                            'normalized_card_portrait_pixels',
                        'widthPx': 1120,
                        'heightPx': 1568,
                        'geometricResamplingApplied': True,
                        'sourceCropWidth': 1200,
                        'sourceCropHeight': 1680,
                        'scaleX': 0.933333,
                        'scaleY': 0.933333,
                        'deskewAppliedDegrees': 0.0,
                    },
                })
                package_artifacts.extend((raw_artifact,
                                          normalized_artifact))

        declare([target_entry], 'print_verified_calibration_target')
        declare(
            [cut_dimension_entries['x']], 'target_cut_dimension_x')
        declare(
            [cut_dimension_entries['y']], 'target_cut_dimension_y')
        declare([print_scale_entries['x']], 'print_scale_verification_x')
        declare([print_scale_entries['y']], 'print_scale_verification_y')
        declare(geometry_entries, 'lens_geometry')
        declare(normalization_entries, 'normalization_registration')
        declare(placement_entries, 'repeated_placement')
        declare(measurement_repeatability, 'measurement_repeatability')
        for channel_entry in channel_entries:
            channel_index = channel_entry['channelIndex']
            declare(
                channel_entry['directionMeasurements'],
                f'direction_geometry_channel_{channel_index}', channel_index)
            declare(
                channel_entry['frames'],
                f'flat_field_channel_{channel_index}', channel_index)
            declare(
                channel_entry['darkFrames'],
                f'dark_control_channel_{channel_index}', channel_index)
            declare(
                channel_entry['illuminationPatternFrames'],
                f'illumination_pattern_channel_{channel_index}',
                channel_index)
        package_path = root / 'source-capture-package.json'
        threshold_source = (
            SCRIPT.parents[2] / 'packages' / 'shared' / 'src' /
            'aiGraderMathematicalCalibrationV1.ts').read_text(
                encoding='utf-8')
        threshold_match = re.search(
            r'MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH\s*=\s*\n?\s*'
            r'"([0-9a-f]{64})"', threshold_source)
        if threshold_match is None:
            raise RuntimeError('threshold-set hash was not found')
        package_path.write_text(json.dumps({
            'schemaVersion':
                'ten-kings-mathematical-calibration-capture-package-v1',
            'packageId': 'synthetic-calibration-capture-package-v1',
            'rigId': rig_id,
            'captureProfileVersion': capture_profile_version,
            'purpose': 'mathematical_calibration_v1',
            'thresholdSetId': 'ten-kings-mathematical-grading-v1.0.0',
            'thresholdSetHash': threshold_match.group(1),
            'captureEvidenceAcceptance': {
                'poseDiversity': {
                    'minimumDetectedTargetCoverageFractionPerView': 0.3,
                    'geometry': {
                        'minimumNormalizedCenterSpanX': 0.08,
                        'minimumNormalizedCenterSpanY': 0.08,
                        'minimumRotationSpanDegrees': 2,
                    },
                    'normalization': {
                        'minimumNormalizedCenterSpanX': 0.08,
                        'minimumNormalizedCenterSpanY': 0.08,
                        'minimumRotationSpanDegrees': 2,
                    },
                    'targetCoverageFormula':
                        'detectedOuterContourAreaPx / sourceFrameAreaPx >= '
                        'minimumDetectedTargetCoverageFractionPerView for every '
                        'accepted geometry and normalization view',
                    'spanFormula':
                        'max(observedPoseValue) - min(observedPoseValue) >= '
                        'minimumSpan',
                },
                'repeatedPlacementAuthority':
                    'minimumRepeatedPlacements unique bridge capture operation '
                    'IDs, timestamps, and source hashes with explicit '
                    'remove/reseat cycle evidence; no minimum displacement is '
                    'imposed',
            },
            'stationAuthority': {
                'stationId': 'local-dell-ai-grader-station',
                'sessionId': 'synthetic-calibration-session-v1',
                'operatorId': operator_id,
                'createdAt': '2026-07-18T19:59:59.000Z',
                'finalizedAt': finalized_at,
                'noProductionMutation': True,
                'protectedSettings': {
                    'stationId': 'local-dell-ai-grader-station',
                    'rigId': rig_id,
                    'captureProfileVersion': capture_profile_version,
                    'cameraIndex': 0,
                    'exposureUs': 6200,
                    'gain': 0,
                    'dutyPercent': 1.2,
                    'leimacUnit': 1,
                    'selectedChannels': list(range(1, 9)),
                    'normalizedWidthPx': 1120,
                    'normalizedHeightPx': 1568,
                    'checkerboard': {
                        'internalColumns': 11,
                        'internalRows': 16,
                        'cellMm': 5.0,
                    },
                },
            },
            'subject': {
                'designation': 'calibration_target',
                'productionCard': False,
                'targetVersion': target_version,
                'targetSha256': target_hash,
            },
            'artifacts': package_artifacts,
        }, indent=2, sort_keys=True) + '\n', encoding='utf-8')
        manifest = {
            'schemaVersion':
                'ten-kings-mathematical-calibration-capture-manifest-v1',
            'evidenceRoot': '.',
            'profileId': 'synthetic-fixed-rig-v1',
            'calibrationVersion': 'synthetic-v1',
            'rigId': rig_id,
            'captureProfileVersion': capture_profile_version,
            'sourceCapturePackage': {
                'packageId': 'synthetic-calibration-capture-package-v1',
                'path': package_path.name,
                'sha256': digest(package_path),
            },
            'artifactId': 'synthetic-calibration-artifact-v1',
            'operatorId': operator_id,
            'finalizedAt': finalized_at,
            'normalizedWidthPx': 1120,
            'normalizedHeightPx': 1568,
            'checkerboard': {
                'internalColumns': 11,
                'internalRows': 16,
                'cellMm': 5.0,
            },
            'target': target_entry,
            'geometryViews': geometry_entries,
            'normalizationViews': normalization_entries,
            'placementViews': placement_entries,
            'measurementRepeatabilitySamples': measurement_repeatability,
            'flatFieldChannels': channel_entries,
        }
        manifest_path = root / 'capture-manifest.json'
        manifest_path.write_text(
            json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        return manifest_path

    def test_exact_synthetic_calibration_is_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = self.build_fixture(root)
            first = MODULE.analyze(manifest_path, root / 'out-one')
            second = MODULE.analyze(manifest_path, root / 'out-two')
            self.assertEqual(first['analysisSha256'],
                             second['analysisSha256'])
            finalizer = SCRIPT.parents[2] / 'scripts' / 'ai-grader' / (
                'finalize-mathematical-calibration-v1.mjs')
            finalization = subprocess.run(
                [
                    'node', str(finalizer), '--analysis',
                    str(root / 'out-one' /
                        'mathematical-calibration-analysis-v1.json'),
                    '--output-dir', str(root / 'finalized'),
                ],
                cwd=SCRIPT.parents[2], check=False, capture_output=True,
                text=True)
            self.assertEqual(
                finalization.returncode, 0,
                'cross-runtime finalization failed: '
                f'stdout={finalization.stdout} stderr={finalization.stderr}')
            acceptance = json.loads(finalization.stdout)
            self.assertTrue(acceptance['isCalibrated'])
            bundle_authority = acceptance['calibrationBundle']
            self.assertIsNotNone(bundle_authority)
            bundle_loader = SCRIPT.parents[2] / 'packages' / (
                'ai-grader-capture-helper') / 'dist' / 'drivers' / (
                'fixedRigMathematicalCalibrationBundleV1.js')
            load_bundle = subprocess.run(
                [
                    'node', '-e',
                    "const m=require(process.argv[1]);" +
                    "const x=m.loadFixedRigMathematicalCalibrationBundleV1({" +
                    "bundlePath:process.argv[2],bundleSha256:process.argv[3]," +
                    "expectedRigId:'fixed-rig-test'});" +
                    "process.stdout.write(JSON.stringify({" +
                    "profileId:x.profile.profileId,flatFields:" +
                    "x.files.flatFields.length,bundleSha256:x.bundleSha256," +
                    "sourceCaptureManifestSha256:" +
                    "x.authority.sourceCaptureManifestSha256}));",
                    str(bundle_loader), bundle_authority['path'],
                    bundle_authority['sha256'],
                ],
                cwd=SCRIPT.parents[2], check=False, capture_output=True,
                text=True)
            self.assertEqual(
                load_bundle.returncode, 0,
                'bridge bundle loader rejected real finalizer output: '
                f'stdout={load_bundle.stdout} stderr={load_bundle.stderr}')
            loaded_authority = json.loads(load_bundle.stdout)
            self.assertEqual(loaded_authority['profileId'],
                             'synthetic-fixed-rig-v1')
            self.assertEqual(loaded_authority['flatFields'], 8)
            self.assertEqual(loaded_authority['bundleSha256'],
                             bundle_authority['sha256'])
            self.assertEqual(
                acceptance['sourceManifestSha256'],
                first['sourceManifestSha256'])
            self.assertEqual(
                acceptance['sourceCapturePackage']['manifestSha256'],
                first['sourceCapturePackage']['manifestSha256'])
            self.assertEqual(
                loaded_authority['sourceCaptureManifestSha256'],
                first['sourceCapturePackage']['manifestSha256'])
            self.assertNotEqual(
                first['sourceManifestSha256'],
                first['sourceCapturePackage']['manifestSha256'])
            package_authority = first['sourceCapturePackage']
            self.assertEqual(
                package_authority['schemaVersion'],
                'ten-kings-mathematical-calibration-capture-package-v1')
            self.assertEqual(package_authority['rigId'], 'fixed-rig-test')
            self.assertEqual(
                package_authority['captureProfileVersion'],
                'ten-kings-fixed-rig-mathematical-calibration-v1')
            self.assertEqual(
                package_authority['subject']['designation'],
                'calibration_target')
            self.assertFalse(package_authority['subject']['productionCard'])
            self.assertNotIn('path', package_authority)
            self.assertNotIn('artifactsById', package_authority)
            builder = first['builderInput']
            self.assertEqual(len(builder['scaleSamples']), 20)
            self.assertEqual(len(builder['lensResidualSamples']), 10)
            self.assertEqual(len(builder['normalizationResidualSamples']), 10)
            self.assertEqual(len(builder['repeatedPlacementSamples']), 10)
            self.assertEqual(len(builder['segmentationBoundarySamples']), 10)
            self.assertEqual(len(builder['targetCutDimensionSamples']), 2)
            self.assertEqual(
                [sample['nominalDimensionMm']
                 for sample in builder['targetCutDimensionSamples']],
                [63.5, 88.9])
            self.assertTrue(any(
                abs(sample['displacementXMm']) > 0 or
                abs(sample['displacementYMm']) > 0
                for sample in builder['repeatedPlacementSamples']))
            self.assertTrue(all(
                sample['outerContourFitResidualPx'] > 0
                for sample in builder['segmentationBoundarySamples']))
            self.assertEqual(
                {sample['measurementClass']
                 for sample in builder['measurementRepeatabilitySamples']},
                {
                    'linear_mm', 'area_mm2', 'relief_index',
                    'roughness_index', 'color_delta_e',
                })
            self.assertEqual([channel['channelIndex']
                              for channel in builder['channels']],
                             list(range(1, 9)))
            for index, channel in enumerate(builder['channels']):
                self.assertEqual(len(channel['directionMeasurementSamples']), 3)
                self.assertTrue(all(
                    sample['measurementMethod'] ==
                    'fixed_ring_segment_geometry_with_ruler_v1'
                    for sample in channel['directionMeasurementSamples']))
                self.assertTrue(all(
                    sample['pointU95Mm'] > 0
                    for sample in channel['directionMeasurementSamples']))
                self.assertEqual(len(
                    channel['directionValidationAngularErrorsDegrees']), 3)
                angle = index * np.pi / 4
                self.assertGreater(
                    channel['direction']['x'] * np.cos(angle) +
                    channel['direction']['y'] * np.sin(angle), 0.9)
            self.assertEqual(len(builder['targetPrintScaleSamples']), 2)
            self.assertEqual(builder['lensModel']['model'],
                             'opencv_brown_conrady_v1')
            self.assertLess(
                max(sample['residualPx']
                    for sample in builder['lensResidualSamples']), 0.5)
            self.assertLess(
                max(sample['residualPx']
                    for sample in builder['normalizationResidualSamples']), 1)
            for summary, channel in zip(
                    first['flatFieldArtifacts'], builder['channels']):
                artifact_path = root / 'out-one' / summary['artifactFileName']
                artifact = json.loads(artifact_path.read_text(encoding='utf-8'))
                artifact_without_hash = {
                    key: value for key, value in artifact.items()
                    if key != 'artifactSha256'
                }
                self.assertEqual(
                    artifact['artifactSha256'],
                    hashlib.sha256(MODULE.canonical_bytes(
                        artifact_without_hash)).hexdigest())
                residuals = artifact['correctedResidualSamples']
                self.assertEqual(residuals, channel['relativeResponse'])
                self.assertEqual(
                    artifact['sourceEvidence'], channel['flatFieldFrames'])
                self.assertEqual(
                    artifact['darkControlEvidence'], channel['darkControlFrames'])
                residual_mean = sum(residuals) / len(residuals)
                recomputed_deviation = max(
                    abs(value / residual_mean - 1.0) for value in residuals)
                self.assertAlmostEqual(
                    artifact['correctedMaximumDeviationFraction'],
                    recomputed_deviation,
                    places=6)
                self.assertEqual(
                    summary['maximumResidualDeviationFraction'],
                    artifact['correctedMaximumDeviationFraction'])
                self.assertLess(recomputed_deviation, 0.05)

    def test_preseal_repeatability_derivation_records_exact_node_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = self.build_fixture(root)
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            package = json.loads((root / 'source-capture-package.json').read_text(
                encoding='utf-8'))
            declarations = {
                artifact['evidenceId']: artifact
                for artifact in package['artifacts']
            }
            session_id = 'preseal-repeatability-session-v1'
            output_root = root / 'sessions'
            session_dir = output_root / session_id
            raw_dir = session_dir / 'evidence' / 'raw'
            raw_dir.mkdir(parents=True)
            state_artifacts = []
            state_captures = []
            for sample_index, entry in enumerate(
                    manifest['placementViews'], start=1):
                declaration = declarations[entry['evidenceId']]
                relative_path = (
                    f'evidence/raw/placement-{sample_index:02d}.png')
                destination = session_dir.joinpath(*relative_path.split('/'))
                shutil.copyfile(root / entry['path'], destination)
                self.assertEqual(digest(destination), entry['sha256'])
                operation_id = declaration['operationId']
                state_artifacts.append({
                    'evidenceId': entry['evidenceId'],
                    'path': relative_path,
                    'sha256': entry['sha256'],
                    'role': 'repeated_placement',
                    'artifactClass': 'raw_capture',
                    'rigId': 'fixed-rig-test',
                    'captureProfileVersion':
                        'ten-kings-fixed-rig-mathematical-calibration-v1',
                    'subjectDesignation': 'calibration_target',
                    'productionCard': False,
                    'operationId': operation_id,
                    'capturedAt': declaration['capturedAt'],
                    'channelIndex': None,
                    'targetFace': 'checkerboard',
                    'removeReseatCycleId':
                        f'remove-reseat-cycle-{sample_index}',
                    'byteSize': destination.stat().st_size,
                    'mediaType': 'image/png',
                })
                state_captures.append({
                    'operationId': operation_id,
                    'role': 'repeated_placement',
                    'sampleIndex': sample_index,
                    'targetFace': 'checkerboard',
                    'capturedAt': declaration['capturedAt'],
                    'removeReseatCycleId':
                        f'remove-reseat-cycle-{sample_index}',
                    'rawEvidenceId': entry['evidenceId'],
                    'normalizedEvidenceId':
                        f'{entry["evidenceId"]}-normalized',
                    'completedAt': declaration['capturedAt'],
                })
            state = {
                'schemaVersion':
                    'ten-kings-mathematical-calibration-capture-session-v1',
                'sessionId': session_id,
                'operatorId': 'offline-test',
                'packageId': f'mathematical-calibration-{session_id}',
                'purpose': 'mathematical_calibration_v1',
                'subject': {
                    'designation': 'calibration_target',
                    'productionCard': False,
                    'targetVersion': package['subject']['targetVersion'],
                    'targetSha256': package['subject']['targetSha256'],
                },
                'createdAt': '2026-07-18T20:00:00.000Z',
                'updatedAt': '2026-07-18T20:00:00.000Z',
                'protectedSettings': package['stationAuthority'][
                    'protectedSettings'],
                'artifacts': state_artifacts,
                'captures': state_captures,
                'measurements': [],
                'failedOperations': [],
            }
            state_path = session_dir / 'capture-session.json'
            state_path.write_text(
                json.dumps(state, indent=2, sort_keys=True) + '\n',
                encoding='utf-8')
            derived = PRESEAL.derive(str(session_dir))
            self.assertEqual(len(derived['requests']), 50)
            self.assertEqual(len(derived['existing']), 0)
            expected_values = {
                (entry['measurementClass'], entry['sampleIndex']):
                    entry['measuredValue']
                for entry in manifest['measurementRepeatabilitySamples']
            }
            self.assertEqual(
                {(request['measurementClass'], request['sampleIndex']):
                    request['measuredValue']
                 for request in derived['requests']},
                expected_values)
            self.assertTrue(all(
                request['instrument']['calibrationSha256'] == digest(SCRIPT)
                for request in derived['requests']))

            request_path = root / 'preseal-requests.json'
            request_path.write_text(
                json.dumps(derived['requests']), encoding='utf-8')
            producer_module = SCRIPT.parents[2] / 'packages' / (
                'ai-grader-capture-helper') / 'dist' / 'drivers' / (
                'fixedRigMathematicalCalibrationCaptureV1.js')
            node_record = subprocess.run(
                [
                    'node', '-e',
                    "const fs=require('node:fs');" +
                    "const m=require(process.argv[1]);" +
                    "const outputRoot=process.argv[2];" +
                    "const requests=JSON.parse(fs.readFileSync(" +
                    "process.argv[3],'utf8'));" +
                    "const state=JSON.parse(fs.readFileSync(" +
                    "process.argv[4],'utf8'));" +
                    "const producer=new " +
                    "m.FixedRigMathematicalCalibrationCaptureProducerV1({" +
                    "outputRoot,targetPath:process.argv[4]," +
                    "targetVersion:state.subject.targetVersion," +
                    "targetSha256:state.subject.targetSha256," +
                    "protectedSettings:state.protectedSettings," +
                    "capture:async()=>{throw new Error('not used')}});" +
                    "(async()=>{for(const request of requests)" +
                    "await producer.recordMeasurement(request);" +
                    "process.stdout.write('recorded');})().catch(error=>{" +
                    "process.stderr.write(error.stack||String(error));" +
                    "process.exitCode=1;});",
                    str(producer_module), str(output_root),
                    str(request_path), str(state_path),
                ],
                cwd=SCRIPT.parents[2], check=False, capture_output=True,
                text=True)
            self.assertEqual(
                node_record.returncode, 0,
                'Node producer rejected Python-derived requests: '
                f'stdout={node_record.stdout} stderr={node_record.stderr}')
            self.assertEqual(node_record.stdout, 'recorded')
            verified = PRESEAL.derive(str(session_dir))
            self.assertEqual(len(verified['existing']), 50)
            recorded_state = json.loads(state_path.read_text(encoding='utf-8'))
            self.assertEqual(len(recorded_state['measurements']), 50)
            self.assertEqual(len([
                artifact for artifact in recorded_state['artifacts']
                if artifact['role'] == 'measurement_repeatability']), 50)
            first_source = session_dir.joinpath(
                *state_artifacts[0]['path'].split('/'))
            first_source.write_bytes(first_source.read_bytes() + b'tamper')
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                PRESEAL.derive(str(session_dir))

    def test_hash_mismatch_fails_before_analysis(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = self.build_fixture(root)
            tampered = root / 'geometry-01.png'
            tampered.write_bytes(tampered.read_bytes() + b'tamper')
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                MODULE.analyze(manifest_path, root / 'rejected')

    def test_capture_package_provenance_rejects_ambiguous_or_production_evidence(
            self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = self.build_fixture(root)
            package_path = root / 'source-capture-package.json'
            baseline_manifest = manifest_path.read_bytes()
            baseline_package = package_path.read_bytes()

            def reset():
                manifest_path.write_bytes(baseline_manifest)
                package_path.write_bytes(baseline_package)

            def rewrite(package_mutator=None, manifest_mutator=None,
                        refresh_binding=True):
                manifest = json.loads(
                    manifest_path.read_text(encoding='utf-8'))
                package = json.loads(
                    package_path.read_text(encoding='utf-8'))
                if package_mutator:
                    package_mutator(package)
                if manifest_mutator:
                    manifest_mutator(manifest)
                package_path.write_text(
                    json.dumps(package, indent=2, sort_keys=True) + '\n',
                    encoding='utf-8')
                if refresh_binding:
                    manifest['sourceCapturePackage']['sha256'] = digest(
                        package_path)
                manifest_path.write_text(
                    json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

            cases = [
                (
                    'duplicate evidence identity with a conflicting role',
                    lambda package: package['artifacts'].append({
                        **package['artifacts'][0], 'role': 'lens_geometry',
                    }),
                    None,
                    'duplicate evidenceId',
                ),
                (
                    'duplicate path under an alias identity',
                    lambda package: package['artifacts'].append({
                        **package['artifacts'][0],
                        'evidenceId': 'aliased-target-evidence',
                    }),
                    None,
                    'duplicate artifact path',
                ),
                (
                    'wrong role',
                    lambda package: package['artifacts'][1].update({
                        'role': 'lens_geometry',
                    }),
                    None,
                    'role does not match',
                ),
                (
                    'wrong channel',
                    lambda package: package['artifacts'][1].update({
                        'channelIndex': 1,
                    }),
                    None,
                    'channelIndex does not match',
                ),
                (
                    'wrong rig',
                    lambda package: package['artifacts'][1].update({
                        'rigId': 'different-rig',
                    }),
                    None,
                    'artifact rigId mismatch',
                ),
                (
                    'wrong package rig',
                    lambda package: package.update({
                        'rigId': 'different-rig',
                    }),
                    None,
                    'source capture-package rigId mismatch',
                ),
                (
                    'wrong capture profile',
                    lambda package: package['artifacts'][1].update({
                        'captureProfileVersion': 'different-profile',
                    }),
                    None,
                    'artifact captureProfileVersion mismatch',
                ),
                (
                    'wrong package capture profile',
                    lambda package: package.update({
                        'captureProfileVersion': 'different-profile',
                    }),
                    None,
                    'source capture-package captureProfileVersion',
                ),
                (
                    'artifact designated as a production card',
                    lambda package: package['artifacts'][1].update({
                        'productionCard': True,
                    }),
                    None,
                    'not designated as non-production',
                ),
                (
                    'package subject designated as a production card',
                    lambda package: package['subject'].update({
                        'productionCard': True,
                    }),
                    None,
                    'non-production calibration target',
                ),
                (
                    'undeclared path alias',
                    None,
                    lambda manifest: manifest['target'][
                        'printScaleVerification']['x'].update({
                            'path': manifest['target'][
                                'printScaleVerification']['y']['path'],
                            'sha256': manifest['target'][
                                'printScaleVerification']['y']['sha256'],
                        }),
                    'path does not match',
                ),
                (
                    'undeclared evidence identity',
                    None,
                    lambda manifest: manifest['target'][
                        'printScaleVerification']['x'].update({
                            'evidenceId': 'undeclared-print-scale',
                        }),
                    'not declared by the source capture package',
                ),
                (
                    'cut measurement differs from immutable artifact',
                    None,
                    lambda manifest: manifest['target'][
                        'cutDimensionVerification']['x'].update({
                            'measuredDimensionMm': 63.4,
                        }),
                    'does not match its immutable measurement artifact',
                ),
            ]
            for name, package_mutator, manifest_mutator, message in cases:
                with self.subTest(name=name):
                    reset()
                    rewrite(package_mutator, manifest_mutator)
                    with self.assertRaisesRegex(ValueError, message):
                        MODULE.analyze(manifest_path, root / 'rejected')

            reset()
            package_path.write_bytes(baseline_package + b' ')
            with self.assertRaisesRegex(
                    ValueError,
                    'source capture-package manifest SHA-256 mismatch'):
                MODULE.analyze(manifest_path, root / 'rejected')


if __name__ == '__main__':
    unittest.main()
