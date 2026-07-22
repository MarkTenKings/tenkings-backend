#!/usr/bin/env python3
"""Derive and optionally record analyzer-exact calibration authority.

This pre-seal tool reads only an unsealed Mathematical Calibration V1 session,
re-hashes its target, repeated-placement, and three-per-channel illumination
captures, invokes the exact pinned analyzer implementation, and emits all 78
producer authority requests. With --bridge-url it records those requests
through the existing authenticated loopback bridge endpoint; it never edits
capture-session state directly and has no authority to seal or finalize.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


SESSION_SCHEMA = 'ten-kings-mathematical-calibration-capture-session-v1'
OUTPUT_SCHEMA = (
    'ten-kings-mathematical-calibration-evidence-authority-preseal-v1')
ALGORITHM = 'opencv_checkerboard_repeatability_measurement_v1'
METHOD = 'fixed_reference_repeatability_v1'
FIXED_ROI = 'registered_checkerboard_center_cell_and_grid_spacing_v1'
INSTRUMENT_ID = 'ten-kings-fixed-rig-repeatability-analyzer-v1'
TARGET_METHOD = 'protected_checkerboard_geometry_authority_v1'
DIRECTION_ALGORITHM = 'opencv_illumination_centroid_checkerboard_v1'
DIRECTION_METHOD = 'illumination_centroid_checkerboard_repeatability_v1'
DIRECTION_INSTRUMENT_ID = (
    'ten-kings-illumination-centroid-direction-analyzer-v1')
MEASUREMENT_CLASSES = (
    'linear_mm', 'area_mm2', 'relief_index', 'roughness_index',
    'color_delta_e')
SAFE_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
SHA256 = re.compile(r'^[a-f0-9]{64}$')
SCRIPT = Path(__file__).resolve()
ANALYZER_PATH = SCRIPT.with_name('analyze-mathematical-calibration-v1.py')
TARGET_MANIFEST_PATH = (
    SCRIPT.parents[2] / 'output' / 'pdf' /
    'ten-kings-mathematical-calibration-target-v1.json')


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=True).encode('utf-8')


def safe_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
        raise ValueError(f'{label} must be a safe identifier')
    return value


def exact_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise ValueError(f'{label} must be an exact lowercase SHA-256')
    return value


def one_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f'{label} must be one JSON object')
    return value


def read_json_object(path: Path, label: str) -> tuple[dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw.decode('utf-8'))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError(f'{label} must be readable UTF-8 JSON') from None
    return one_object(value, label), raw


def safe_member(session_dir: Path, value: Any, label: str) -> Path:
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError(f'{label} must be a portable session-relative path')
    parts = value.split('/')
    if any(not part or part in {'.', '..'} or ':' in part for part in parts):
        raise ValueError(f'{label} must be a portable session-relative path')
    resolved = session_dir.joinpath(*parts).resolve()
    try:
        resolved.relative_to(session_dir)
    except ValueError:
        raise ValueError(f'{label} escapes the calibration session') from None
    return resolved


def load_analyzer():
    spec = importlib.util.spec_from_file_location(
        'ten_kings_mathematical_calibration_analyzer_v1', ANALYZER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError('Pinned Mathematical Calibration V1 analyzer is unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def exact_repeatability_instrument(analyzer_sha256: str) -> dict[str, Any]:
    return {
        'instrumentId': INSTRUMENT_ID,
        'kind': 'fixed_rig_geometry',
        'calibrationVersion': ALGORITHM,
        'calibrationSha256': analyzer_sha256,
    }


def exact_target_instrument(subject: dict[str, Any]) -> dict[str, Any]:
    return {
        'instrumentId': 'protected-calibration-target-geometry-v1',
        'kind': 'protected_target_geometry',
        'targetVersion': safe_id(subject.get('targetVersion'), 'targetVersion'),
        'targetSha256': exact_sha256(
            subject.get('targetSha256'), 'targetSha256'),
        'authorityStatement':
            'product_owner_confirmed_exact_target_geometry_v1',
    }


def exact_direction_instrument(analyzer_sha256: str) -> dict[str, Any]:
    return {
        'instrumentId': DIRECTION_INSTRUMENT_ID,
        'kind': 'fixed_rig_geometry',
        'calibrationVersion': DIRECTION_ALGORITHM,
        'calibrationSha256': analyzer_sha256,
    }


def immutable_placement_views(
        session_dir: Path, state: dict[str, Any], analyzer: Any
        ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    artifacts = state.get('artifacts')
    captures = state.get('captures')
    if not isinstance(artifacts, list) or not isinstance(captures, list):
        raise ValueError('capture session artifacts and captures are required')
    by_id: dict[str, dict[str, Any]] = {}
    for value in artifacts:
        artifact = one_object(value, 'capture artifact')
        evidence_id = safe_id(artifact.get('evidenceId'), 'artifact.evidenceId')
        if evidence_id in by_id:
            raise ValueError(f'duplicate capture artifact {evidence_id}')
        by_id[evidence_id] = artifact
    placements = [
        one_object(value, 'repeated-placement capture')
        for value in captures
        if isinstance(value, dict) and value.get('role') == 'repeated_placement'
    ]
    if len(placements) != 10:
        raise ValueError('pre-seal repeatability requires exactly ten repeated-placement captures')
    placements.sort(key=lambda value: int(value.get('sampleIndex', 0)))
    if [entry.get('sampleIndex') for entry in placements] != list(range(1, 11)):
        raise ValueError('repeated-placement sample indexes must be exactly 1 through 10')
    if len({entry.get('operationId') for entry in placements}) != 10:
        raise ValueError('repeated-placement operation IDs must be unique')
    views: list[dict[str, Any]] = []
    bindings: list[dict[str, Any]] = []
    checkerboard = one_object(
        one_object(state.get('protectedSettings'), 'protectedSettings').get(
            'checkerboard'), 'protectedSettings.checkerboard')
    columns = int(checkerboard.get('internalColumns', 0))
    rows = int(checkerboard.get('internalRows', 0))
    if columns < 2 or rows < 2:
        raise ValueError('protected checkerboard dimensions are invalid')
    for sample_index, capture in enumerate(placements, start=1):
        operation_id = safe_id(
            capture.get('operationId'), 'repeated-placement operationId')
        source_id = safe_id(
            capture.get('rawEvidenceId'), 'repeated-placement rawEvidenceId')
        artifact = by_id.get(source_id)
        if artifact is None:
            raise ValueError(f'{source_id} raw artifact is unavailable')
        if (artifact.get('artifactClass') != 'raw_capture' or
                artifact.get('role') != 'repeated_placement' or
                artifact.get('operationId') != operation_id or
                artifact.get('targetFace') != 'checkerboard' or
                artifact.get('channelIndex') is not None or
                artifact.get('productionCard') is not False or
                capture.get('removeReseatCycleId') is None):
            raise ValueError(
                f'repeated-placement sample {sample_index} has invalid immutable authority')
        source_sha256 = exact_sha256(
            artifact.get('sha256'), f'{source_id}.sha256')
        image_path = safe_member(
            session_dir, artifact.get('path'), f'{source_id}.path')
        image_bytes = image_path.read_bytes()
        if sha256_bytes(image_bytes) != source_sha256:
            raise ValueError(f'{source_id} exact file SHA-256 mismatch')
        image = analyzer.load_gray(image_path)
        points = analyzer.orient_points(
            analyzer.detect_checkerboard(image, columns, rows), columns, rows)
        views.append({
            'evidence': {
                'evidenceId': source_id,
                'sha256': source_sha256,
                'role': 'repeated_placement',
            },
            'path': image_path,
            'shape': image.shape,
            'points': points,
        })
        bindings.append({
            'sampleIndex': sample_index,
            'sourceCaptureOperationId': operation_id,
            'sourceEvidenceId': source_id,
            'sourceSha256': source_sha256,
            'removeReseatCycleId': safe_id(
                capture.get('removeReseatCycleId'),
                'repeated-placement removeReseatCycleId'),
        })
    return views, bindings


def protected_target_requests(
        session_dir: Path, state: dict[str, Any]
        ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    target_manifest, target_manifest_bytes = read_json_object(
        TARGET_MANIFEST_PATH, 'protected calibration-target manifest')
    if target_manifest.get('schemaVersion') != (
            'ten-kings-calibration-target-manifest-v1'):
        raise ValueError('protected calibration-target manifest schema mismatch')
    subject = one_object(state.get('subject'), 'capture session subject')
    target_sha256 = exact_sha256(
        subject.get('targetSha256'), 'capture target SHA-256')
    if (target_manifest.get('version') != subject.get('targetVersion') or
            target_manifest.get('pdfSha256') != target_sha256):
        raise ValueError(
            'protected target manifest does not match the exact session target')
    artifacts = state.get('artifacts')
    if not isinstance(artifacts, list):
        raise ValueError('capture session artifacts are required')
    targets = [one_object(value, 'target artifact') for value in artifacts
               if isinstance(value, dict) and
               value.get('artifactClass') == 'target']
    if len(targets) != 1:
        raise ValueError('capture session requires exactly one target artifact')
    target = targets[0]
    if (target.get('evidenceId') != 'print-verified-calibration-target' or
            target.get('role') != 'print_verified_calibration_target' or
            target.get('sha256') != target_sha256 or
            target.get('productionCard') is not False):
        raise ValueError('capture target artifact identity is invalid')
    target_path = safe_member(
        session_dir, target.get('path'), 'target artifact path')
    if sha256_bytes(target_path.read_bytes()) != target_sha256:
        raise ValueError('capture target artifact SHA-256 mismatch')
    instrument = exact_target_instrument(subject)
    requests: list[dict[str, Any]] = []
    print_scale = one_object(
        target_manifest.get('requiredPrintScaleVerification'),
        'protected print-scale geometry')
    cut = one_object(
        target_manifest.get('requiredCutDimensionVerification'),
        'protected cut geometry')
    for value, label in ((print_scale, 'print-scale'), (cut, 'cut')):
        if (value.get('authorityBasis') !=
                'protected_checkerboard_geometry' or
                value.get('operatorInputRequired') is not False):
            raise ValueError(
                f'protected {label} manifest authority contract mismatch')
    for axis in ('x', 'y'):
        protected_span = float(one_object(
            print_scale.get(axis), f'print-scale {axis}').get(
                'nominalSpanMm'))
        requests.append({
            'sessionId': state['sessionId'],
            'operationId': f'target-authority-print-{axis}',
            'measurementType': 'print_scale',
            'axis': axis,
            'protectedSpanMm': protected_span,
            'authorityBasis': 'protected_checkerboard_geometry',
            'measurementMethod': TARGET_METHOD,
            'sourceTargetEvidenceId': target['evidenceId'],
            'instrument': instrument,
        })
        protected_dimension = float(one_object(
            cut.get(axis), f'target-cut {axis}').get(
                'nominalDimensionMm'))
        requests.append({
            'sessionId': state['sessionId'],
            'operationId': f'target-authority-cut-{axis}',
            'measurementType': 'target_cut_dimension',
            'axis': axis,
            'protectedDimensionMm': protected_dimension,
            'authorityBasis': 'protected_checkerboard_geometry',
            'measurementMethod': TARGET_METHOD,
            'sourceTargetEvidenceId': target['evidenceId'],
            'instrument': instrument,
        })
    return requests, {
        'evidenceId': target['evidenceId'],
        'sha256': target_sha256,
        'targetManifestSha256': sha256_bytes(target_manifest_bytes),
    }


def immutable_illumination_views(
        session_dir: Path, state: dict[str, Any], analyzer: Any
        ) -> tuple[dict[int, list[Any]], list[dict[str, Any]]]:
    artifacts = state.get('artifacts')
    captures = state.get('captures')
    if not isinstance(artifacts, list) or not isinstance(captures, list):
        raise ValueError('capture session artifacts and captures are required')
    by_id = {
        value.get('evidenceId'): value for value in artifacts
        if isinstance(value, dict) and isinstance(value.get('evidenceId'), str)
    }
    illumination = [
        one_object(value, 'illumination capture') for value in captures
        if isinstance(value, dict) and value.get('role') == 'illumination_pattern'
    ]
    illumination.sort(key=lambda value: (
        int(value.get('channelIndex', 0)), int(value.get('sampleIndex', 0))))
    if len(illumination) != 24:
        raise ValueError(
            'direction authority requires exactly 24 illumination captures')
    images: dict[int, list[Any]] = {channel: [] for channel in range(1, 9)}
    bindings: list[dict[str, Any]] = []
    for capture in illumination:
        channel = int(capture.get('channelIndex', 0))
        sample = int(capture.get('sampleIndex', 0))
        if channel not in images or sample not in range(1, 4):
            raise ValueError('illumination channel/sample identity is invalid')
        operation_id = safe_id(
            capture.get('operationId'), 'illumination operationId')
        evidence_id = safe_id(
            capture.get('normalizedEvidenceId'),
            'illumination normalizedEvidenceId')
        artifact = one_object(
            by_id.get(evidence_id), 'illumination normalized artifact')
        if (artifact.get('artifactClass') != 'normalized_derivative' or
                artifact.get('role') !=
                f'illumination_pattern_channel_{channel}' or
                artifact.get('operationId') != operation_id or
                artifact.get('channelIndex') != channel or
                artifact.get('targetFace') != 'blank_reverse' or
                artifact.get('productionCard') is not False):
            raise ValueError(
                f'illumination channel {channel} sample {sample} authority is invalid')
        source_sha256 = exact_sha256(
            artifact.get('sha256'), 'illumination artifact SHA-256')
        image_path = safe_member(
            session_dir, artifact.get('path'), 'illumination artifact path')
        if sha256_bytes(image_path.read_bytes()) != source_sha256:
            raise ValueError('illumination artifact SHA-256 mismatch')
        images[channel].append(analyzer.load_gray(image_path))
        bindings.append({
            'channelIndex': channel,
            'sampleIndex': sample,
            'sourceCaptureOperationId': operation_id,
            'sourceEvidenceId': evidence_id,
            'sourceSha256': source_sha256,
        })
    if any(len(images[channel]) != 3 for channel in images):
        raise ValueError(
            'every channel requires exactly three immutable illumination captures')
    return images, bindings


def direction_requests(
        session_id: str, analyzer: Any, analyzer_sha256: str,
        images: dict[int, list[Any]], bindings: list[dict[str, Any]],
        coupon_width_mm: float, coupon_height_mm: float,
        linear_repeatability_mm: list[float], coverage_factor: float
        ) -> list[dict[str, Any]]:
    binding_by_key = {
        (value['channelIndex'], value['sampleIndex']): value
        for value in bindings
    }
    instrument = exact_direction_instrument(analyzer_sha256)
    requests: list[dict[str, Any]] = []
    for channel in range(1, 9):
        derived = analyzer.compute_illumination_direction_authority(
            images[channel], coupon_width_mm, coupon_height_mm,
            linear_repeatability_mm, coverage_factor)
        for value in derived:
            sample = int(value['sampleIndex'])
            binding = binding_by_key[(channel, sample)]
            requests.append({
                'sessionId': session_id,
                'operationId': f'direction-derived-{channel}-{sample}',
                'measurementType': 'direction_geometry',
                'channelIndex': channel,
                'sampleIndex': sample,
                'sourcePointMm': value['sourcePointMm'],
                'cardCenterPointMm': value['cardCenterPointMm'],
                'pointU95Mm': value['pointU95Mm'],
                'sourceCaptureOperationId':
                    binding['sourceCaptureOperationId'],
                'sourceEvidenceId': binding['sourceEvidenceId'],
                'sourceSha256': binding['sourceSha256'],
                'measurementAlgorithmVersion': DIRECTION_ALGORITHM,
                'measurementMethod': DIRECTION_METHOD,
                'instrument': instrument,
            })
    return requests


def measurement_request(
        session_id: str, measurement_class: str, sample_index: int,
        measured_value: float, binding: dict[str, Any],
        analyzer_sha256: str) -> dict[str, Any]:
    return {
        'sessionId': session_id,
        'operationId': (
            f'repeatability-derived-{measurement_class}-{sample_index:02d}'),
        'measurementType': 'measurement_repeatability',
        'measurementClass': measurement_class,
        'sampleIndex': sample_index,
        'referenceFeatureId': (
            f'checkerboard-repeatability-{measurement_class}-v1'),
        'measuredValue': measured_value,
        'sourceCaptureOperationId': binding['sourceCaptureOperationId'],
        'measurementAlgorithmVersion': ALGORITHM,
        'measurementMethod': METHOD,
        'instrument': exact_repeatability_instrument(analyzer_sha256),
    }


def verify_existing_measurements(
        session_dir: Path, state: dict[str, Any], requests: list[dict[str, Any]],
        bindings: list[dict[str, Any]]) -> set[str]:
    measurements = state.get('measurements')
    artifacts = state.get('artifacts')
    if not isinstance(measurements, list) or not isinstance(artifacts, list):
        raise ValueError('capture session measurements/artifacts are required')
    artifacts_by_id = {
        value.get('evidenceId'): value for value in artifacts
        if isinstance(value, dict) and isinstance(value.get('evidenceId'), str)
    }
    requests_by_key = {
        (request['measurementClass'], request['sampleIndex']): request
        for request in requests
    }
    binding_by_sample = {
        binding['sampleIndex']: binding for binding in bindings
    }
    observed_keys: set[tuple[str, int]] = set()
    observed_operations: set[str] = set()
    for value in measurements:
        record = one_object(value, 'measurement record')
        if record.get('measurementType') != 'measurement_repeatability':
            continue
        payload = one_object(record.get('payload'), 'repeatability payload')
        key = (payload.get('measurementClass'), payload.get('sampleIndex'))
        if key not in requests_by_key or key in observed_keys:
            raise ValueError('capture session contains an ambiguous repeatability measurement slot')
        request = requests_by_key[key]
        binding = binding_by_sample[int(key[1])]
        expected = {
            'measurementClass': request['measurementClass'],
            'sampleIndex': request['sampleIndex'],
            'referenceFeatureId': request['referenceFeatureId'],
            'measuredValue': request['measuredValue'],
            'sourceCaptureOperationId': request['sourceCaptureOperationId'],
            'sourceEvidenceId': binding['sourceEvidenceId'],
            'sourceSha256': binding['sourceSha256'],
            'sourceRole': 'repeated_placement',
            'measurementAlgorithmVersion': ALGORITHM,
            'fixedRoiDefinition': FIXED_ROI,
            'measurementMethod': METHOD,
            'instrument': request['instrument'],
        }
        for field, expected_value in expected.items():
            if payload.get(field) != expected_value:
                raise ValueError(
                    f'existing {key[0]} sample {key[1]} conflicts with deterministic derivation')
        evidence_id = safe_id(record.get('evidenceId'), 'measurement evidenceId')
        artifact = one_object(
            artifacts_by_id.get(evidence_id), 'measurement artifact declaration')
        if (artifact.get('artifactClass') != 'measurement' or
                artifact.get('role') != 'measurement_repeatability' or
                artifact.get('operationId') != record.get('operationId')):
            raise ValueError('existing repeatability artifact authority is invalid')
        artifact_path = safe_member(
            session_dir, artifact.get('path'), 'repeatability artifact path')
        artifact_bytes = artifact_path.read_bytes()
        if sha256_bytes(artifact_bytes) != exact_sha256(
                artifact.get('sha256'), 'repeatability artifact SHA-256'):
            raise ValueError('existing repeatability artifact file SHA-256 mismatch')
        artifact_json, _ = read_json_object(
            artifact_path, 'repeatability measurement artifact')
        if artifact_json != {
                'schemaVersion':
                    'ten-kings-calibration-repeatability-measurement-v1',
                **payload}:
            raise ValueError(
                'existing repeatability artifact does not match session state')
        observed_keys.add((str(key[0]), int(key[1])))
        observed_operations.add(str(record.get('operationId')))
    return observed_operations


def request_slot(request: dict[str, Any]) -> tuple[Any, ...]:
    measurement_type = request['measurementType']
    if measurement_type in {'print_scale', 'target_cut_dimension'}:
        return (measurement_type, request['axis'])
    if measurement_type == 'direction_geometry':
        return (measurement_type, request['channelIndex'],
                request['sampleIndex'])
    if measurement_type == 'measurement_repeatability':
        return (measurement_type, request['measurementClass'],
                request['sampleIndex'])
    raise ValueError('unsupported derived authority request')


def verify_existing_derived_authority(
        session_dir: Path, state: dict[str, Any],
        requests: list[dict[str, Any]]) -> set[str]:
    measurements = state.get('measurements')
    artifacts = state.get('artifacts')
    if not isinstance(measurements, list) or not isinstance(artifacts, list):
        raise ValueError('capture session measurements/artifacts are required')
    artifacts_by_id = {
        value.get('evidenceId'): value for value in artifacts
        if isinstance(value, dict) and isinstance(value.get('evidenceId'), str)
    }
    requests_by_slot = {request_slot(request): request for request in requests}
    if len(requests_by_slot) != len(requests):
        raise ValueError('derived authority request slots are ambiguous')
    observed_slots: set[tuple[Any, ...]] = set()
    observed_operations: set[str] = set()
    for value in measurements:
        record = one_object(value, 'measurement record')
        if record.get('measurementType') == 'measurement_repeatability':
            continue
        payload = one_object(record.get('payload'), 'derived authority payload')
        measurement_type = record.get('measurementType')
        if measurement_type in {'print_scale', 'target_cut_dimension'}:
            slot = (measurement_type, payload.get('axis'))
        elif measurement_type == 'direction_geometry':
            slot = (measurement_type, payload.get('channelIndex'),
                    payload.get('sampleIndex'))
        else:
            raise ValueError('capture session contains unsupported measurement authority')
        request = requests_by_slot.get(slot)
        if request is None or slot in observed_slots:
            raise ValueError('capture session contains ambiguous derived authority')
        expected = {
            'operatorId': state['operatorId'],
            'measurementMethod': request['measurementMethod'],
            'instrument': request['instrument'],
        }
        if measurement_type == 'print_scale':
            schema = 'ten-kings-calibration-print-scale-authority-v1'
            role = f'print_scale_verification_{request["axis"]}'
            expected.update({
                'axis': request['axis'],
                'protectedSpanMm': request['protectedSpanMm'],
                'authorityBasis': request['authorityBasis'],
                'sourceTargetEvidenceId': request['sourceTargetEvidenceId'],
                'sourceTargetSha256': state['subject']['targetSha256'],
            })
        elif measurement_type == 'target_cut_dimension':
            schema = 'ten-kings-calibration-target-cut-dimension-authority-v1'
            role = f'target_cut_dimension_{request["axis"]}'
            expected.update({
                'axis': request['axis'],
                'protectedDimensionMm': request['protectedDimensionMm'],
                'authorityBasis': request['authorityBasis'],
                'sourceTargetEvidenceId': request['sourceTargetEvidenceId'],
                'sourceTargetSha256': state['subject']['targetSha256'],
            })
        else:
            schema = 'ten-kings-calibration-direction-measurement-v1'
            role = f'direction_geometry_channel_{request["channelIndex"]}'
            expected.update({
                'channelIndex': request['channelIndex'],
                'sampleIndex': request['sampleIndex'],
                'sourcePointMm': request['sourcePointMm'],
                'cardCenterPointMm': request['cardCenterPointMm'],
                'pointU95Mm': request['pointU95Mm'],
                'sourceCaptureOperationId':
                    request['sourceCaptureOperationId'],
                'sourceEvidenceId': request['sourceEvidenceId'],
                'sourceSha256': request['sourceSha256'],
                'sourceRole': role.replace('direction_geometry',
                                           'illumination_pattern'),
                'measurementAlgorithmVersion': DIRECTION_ALGORITHM,
            })
        recorded_at = payload.get('recordedAt')
        if not isinstance(recorded_at, str):
            raise ValueError('derived authority recordedAt is unavailable')
        expected['recordedAt'] = recorded_at
        if payload != expected or record.get('operationId') != request['operationId']:
            raise ValueError('existing authority conflicts with deterministic derivation')
        evidence_id = safe_id(record.get('evidenceId'), 'measurement evidenceId')
        artifact = one_object(
            artifacts_by_id.get(evidence_id), 'measurement artifact declaration')
        if (artifact.get('artifactClass') != 'measurement' or
                artifact.get('role') != role or
                artifact.get('operationId') != request['operationId']):
            raise ValueError('existing derived authority artifact is invalid')
        artifact_path = safe_member(
            session_dir, artifact.get('path'), 'derived authority artifact path')
        artifact_bytes = artifact_path.read_bytes()
        if sha256_bytes(artifact_bytes) != exact_sha256(
                artifact.get('sha256'), 'derived authority artifact SHA-256'):
            raise ValueError('derived authority artifact SHA-256 mismatch')
        artifact_json, _ = read_json_object(
            artifact_path, 'derived authority artifact')
        if artifact_json != {'schemaVersion': schema, **payload}:
            raise ValueError('derived authority artifact does not match state')
        observed_slots.add(slot)
        observed_operations.add(request['operationId'])
    return observed_operations


def derive(session_dir_value: str,
           incident_analyzer_authority_rebind: bool = False) -> dict[str, Any]:
    session_dir = Path(session_dir_value).resolve()
    state_path = session_dir / 'capture-session.json'
    state, state_bytes = read_json_object(
        state_path, 'Mathematical Calibration V1 capture session')
    if state.get('schemaVersion') != SESSION_SCHEMA:
        raise ValueError(f'capture session schema must be {SESSION_SCHEMA}')
    if state.get('purpose') != 'mathematical_calibration_v1':
        raise ValueError('capture session purpose is not mathematical_calibration_v1')
    if state.get('sealedAt') is not None and not incident_analyzer_authority_rebind:
        raise ValueError('authority preparation requires an unsealed session')
    if incident_analyzer_authority_rebind and state.get('sealedAt') is None:
        raise ValueError('incident analyzer-authority rebind requires a sealed session')
    session_id = safe_id(state.get('sessionId'), 'sessionId')
    safe_id(state.get('operatorId'), 'operatorId')
    subject = one_object(state.get('subject'), 'capture session subject')
    if (subject.get('designation') != 'calibration_target' or
            subject.get('productionCard') is not False):
        raise ValueError('authority preparation accepts only the non-production calibration target')
    captures = state.get('captures')
    if not isinstance(captures, list) or len(captures) != 102:
        raise ValueError('authority preparation requires exactly 102 captures')
    authority = one_object(
        state.get('evidenceDerivedAuthority'),
        'evidenceDerivedAuthority')
    if set(authority) != {
            'thresholdSetId', 'thresholdSetHash',
            'uncertaintyCoverageFactor'}:
        raise ValueError('evidence-derived threshold authority is incomplete')
    safe_id(authority.get('thresholdSetId'), 'thresholdSetId')
    exact_sha256(authority.get('thresholdSetHash'), 'thresholdSetHash')
    coverage_factor = authority.get('uncertaintyCoverageFactor')
    if (isinstance(coverage_factor, bool) or
            not isinstance(coverage_factor, (int, float)) or
            coverage_factor <= 0):
        raise ValueError('uncertainty coverage factor must be positive')
    analyzer = load_analyzer()
    analyzer_sha256 = sha256_bytes(ANALYZER_PATH.read_bytes())
    target_requests, target_binding = protected_target_requests(
        session_dir, state)
    views, bindings = immutable_placement_views(session_dir, state, analyzer)
    settings = one_object(state.get('protectedSettings'), 'protectedSettings')
    checkerboard = one_object(settings.get('checkerboard'), 'checkerboard')
    columns = int(checkerboard['internalColumns'])
    rows = int(checkerboard['internalRows'])
    values = analyzer.compute_checkerboard_repeatability_measurements(
        views, columns, rows)
    repeatability_requests = [
        measurement_request(
            session_id, measurement_class, sample_index,
            values[measurement_class][sample_index - 1],
            bindings[sample_index - 1], analyzer_sha256)
        for measurement_class in MEASUREMENT_CLASSES
        for sample_index in range(1, 11)
    ]
    illumination_images, illumination_bindings = immutable_illumination_views(
        session_dir, state, analyzer)
    target_manifest, _ = read_json_object(
        TARGET_MANIFEST_PATH, 'protected calibration-target manifest')
    geometry = one_object(
        target_manifest.get('geometryCheckerboard'),
        'protected checkerboard geometry')
    derived_direction_requests = direction_requests(
        session_id, analyzer, analyzer_sha256, illumination_images,
        illumination_bindings, float(geometry['couponWidthMm']),
        float(geometry['couponHeightMm']), values['linear_mm'],
        float(coverage_factor))
    derived_requests = [*target_requests, *derived_direction_requests]
    requests = [*derived_requests, *repeatability_requests]
    if incident_analyzer_authority_rebind:
        existing: set[str] = set()
    else:
        existing = verify_existing_derived_authority(
            session_dir, state, derived_requests)
        existing.update(verify_existing_measurements(
            session_dir, state, repeatability_requests, bindings))
    return {
        'sessionDir': session_dir,
        'state': state,
        'sourceStateSha256': sha256_bytes(state_bytes),
        'analyzerSourceSha256': analyzer_sha256,
        'bindings': [target_binding, *bindings, *illumination_bindings],
        'requests': requests,
        'existing': existing,
    }


def loopback_bridge_url(value: str) -> str:
    parsed = urlparse.urlparse(value)
    if (parsed.scheme != 'http' or parsed.hostname not in {
            '127.0.0.1', 'localhost', '::1'} or parsed.username or
            parsed.password or parsed.query or parsed.fragment or
            (parsed.path not in {'', '/'})):
        raise ValueError('bridge URL must be an exact loopback HTTP origin')
    if parsed.port is None:
        raise ValueError('bridge URL must include the local station port')
    return value.rstrip('/')


def submit_requests(base_url: str, token: str,
                    requests: list[dict[str, Any]],
                    existing: set[str]) -> list[str]:
    if len(token) < 16:
        raise ValueError('station token environment value is unavailable')
    submitted: list[str] = []
    endpoint = loopback_bridge_url(base_url) + (
        '/calibration/mathematical-v1/measurement')
    for measurement in requests:
        if measurement['operationId'] in existing:
            continue
        request = urlrequest.Request(
            endpoint, method='POST', data=canonical_bytes(measurement),
            headers={
                'content-type': 'application/json',
                'x-ai-grader-station-token': token,
            })
        try:
            with urlrequest.urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode('utf-8'))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError,
                urlerror.URLError) as error:
            raise RuntimeError(
                f'bridge rejected evidence-authority operation '
                f'{measurement["operationId"]}') from error
        if not isinstance(result, dict) or result.get('ok') is not True:
            raise RuntimeError(
                f'bridge did not confirm evidence-authority operation '
                f'{measurement["operationId"]}')
        submitted.append(measurement['operationId'])
    return submitted


def write_output(path_value: str, value: dict[str, Any]) -> None:
    output_path = Path(path_value).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    without_hash = {
        'schemaVersion': OUTPUT_SCHEMA,
        'algorithmVersion': ALGORITHM,
        'hashPolicy': 'sha256-canonical-json-with-artifactSha256-omitted',
        **value,
    }
    output = {
        **without_hash,
        'artifactSha256': sha256_bytes(canonical_bytes(without_hash)),
    }
    with output_path.open('xb') as stream:
        stream.write(json.dumps(
            output, indent=2, sort_keys=True,
            ensure_ascii=True).encode('utf-8') + b'\n')


def parse_arguments(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Derive analyzer-exact target, direction, and repeatability authority before seal.')
    parser.add_argument('--session-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--bridge-url')
    parser.add_argument(
        '--station-token-env', default='AI_GRADER_STATION_BRIDGE_TOKEN')
    parser.add_argument(
        '--incident-analyzer-authority-rebind', action='store_true',
        help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_arguments(sys.argv[1:] if argv is None else argv)
    if args.incident_analyzer_authority_rebind and args.bridge_url:
        raise ValueError(
            'incident analyzer-authority rebind derivation cannot submit records')
    result = derive(
        args.session_dir,
        incident_analyzer_authority_rebind=
        args.incident_analyzer_authority_rebind)
    submitted: list[str] = []
    if args.bridge_url:
        submitted = submit_requests(
            args.bridge_url, os.environ.get(args.station_token_env, ''),
            result['requests'], result['existing'])
        verified = derive(args.session_dir)
        if len(verified['existing']) != 78:
            raise RuntimeError(
                'bridge submission did not produce all 78 immutable evidence-derived authority artifacts')
        final_state_sha256 = sha256_bytes(
            (result['sessionDir'] / 'capture-session.json').read_bytes())
        status = 'recorded'
    else:
        final_state_sha256 = result['sourceStateSha256']
        status = 'derived_not_submitted'
    output = {
        'status': status,
        'sessionId': result['state']['sessionId'],
        'sourceCaptureSessionSha256': result['sourceStateSha256'],
        'finalCaptureSessionSha256': final_state_sha256,
        'analyzerSourceSha256': result['analyzerSourceSha256'],
        'sourceCaptures': result['bindings'],
        'requests': result['requests'],
        'alreadyRecordedCount': len(result['existing']),
        'submittedOperationIds': submitted,
        'v0FallbackUsed': False,
        'calibrationFinalized': False,
    }
    write_output(args.output, output)
    print(json.dumps({
        'status': status,
        'sessionId': result['state']['sessionId'],
        'measurementRequestCount': len(result['requests']),
        'alreadyRecordedCount': len(result['existing']),
        'submittedCount': len(submitted),
        'output': str(Path(args.output).resolve()),
    }, sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None
