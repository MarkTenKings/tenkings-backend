#!/usr/bin/env python3
"""Derive and optionally record analyzer-exact repeatability measurements.

This pre-seal tool reads only an unsealed Mathematical Calibration V1 session,
re-hashes its ten immutable repeated-placement captures, invokes the exact
pinned analyzer implementation, and emits the 50 producer measurement
requests. With --bridge-url it records those requests through the existing
authenticated loopback bridge endpoint; it never edits capture-session state
directly and has no authority to seal or finalize calibration.
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
    'ten-kings-mathematical-calibration-repeatability-preseal-v1')
ALGORITHM = 'opencv_checkerboard_repeatability_measurement_v1'
METHOD = 'fixed_reference_repeatability_v1'
FIXED_ROI = 'registered_checkerboard_center_cell_and_grid_spacing_v1'
INSTRUMENT_ID = 'ten-kings-fixed-rig-repeatability-analyzer-v1'
MEASUREMENT_CLASSES = (
    'linear_mm', 'area_mm2', 'relief_index', 'roughness_index',
    'color_delta_e')
SAFE_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
SHA256 = re.compile(r'^[a-f0-9]{64}$')
SCRIPT = Path(__file__).resolve()
ANALYZER_PATH = SCRIPT.with_name('analyze-mathematical-calibration-v1.py')


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
        bindings: list[dict[str, Any]]) -> set[tuple[str, int]]:
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
    observed: set[tuple[str, int]] = set()
    for value in measurements:
        record = one_object(value, 'measurement record')
        if record.get('measurementType') != 'measurement_repeatability':
            continue
        payload = one_object(record.get('payload'), 'repeatability payload')
        key = (payload.get('measurementClass'), payload.get('sampleIndex'))
        if key not in requests_by_key or key in observed:
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
        observed.add((str(key[0]), int(key[1])))
    return observed


def derive(session_dir_value: str) -> dict[str, Any]:
    session_dir = Path(session_dir_value).resolve()
    state_path = session_dir / 'capture-session.json'
    state, state_bytes = read_json_object(
        state_path, 'Mathematical Calibration V1 capture session')
    if state.get('schemaVersion') != SESSION_SCHEMA:
        raise ValueError(f'capture session schema must be {SESSION_SCHEMA}')
    if state.get('purpose') != 'mathematical_calibration_v1':
        raise ValueError('capture session purpose is not mathematical_calibration_v1')
    if state.get('sealedAt') is not None:
        raise ValueError('repeatability preparation requires an unsealed session')
    session_id = safe_id(state.get('sessionId'), 'sessionId')
    safe_id(state.get('operatorId'), 'operatorId')
    subject = one_object(state.get('subject'), 'capture session subject')
    if (subject.get('designation') != 'calibration_target' or
            subject.get('productionCard') is not False):
        raise ValueError('repeatability preparation accepts only the non-production calibration target')
    analyzer = load_analyzer()
    analyzer_sha256 = sha256_bytes(ANALYZER_PATH.read_bytes())
    views, bindings = immutable_placement_views(session_dir, state, analyzer)
    settings = one_object(state.get('protectedSettings'), 'protectedSettings')
    checkerboard = one_object(settings.get('checkerboard'), 'checkerboard')
    columns = int(checkerboard['internalColumns'])
    rows = int(checkerboard['internalRows'])
    values = analyzer.compute_checkerboard_repeatability_measurements(
        views, columns, rows)
    requests = [
        measurement_request(
            session_id, measurement_class, sample_index,
            values[measurement_class][sample_index - 1],
            bindings[sample_index - 1], analyzer_sha256)
        for measurement_class in MEASUREMENT_CLASSES
        for sample_index in range(1, 11)
    ]
    existing = verify_existing_measurements(
        session_dir, state, requests, bindings)
    return {
        'sessionDir': session_dir,
        'state': state,
        'sourceStateSha256': sha256_bytes(state_bytes),
        'analyzerSourceSha256': analyzer_sha256,
        'bindings': bindings,
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
                    existing: set[tuple[str, int]]) -> list[str]:
    if len(token) < 16:
        raise ValueError('station token environment value is unavailable')
    submitted: list[str] = []
    endpoint = loopback_bridge_url(base_url) + (
        '/calibration/mathematical-v1/measurement')
    for measurement in requests:
        key = (measurement['measurementClass'], measurement['sampleIndex'])
        if key in existing:
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
                f'bridge rejected repeatability operation '
                f'{measurement["operationId"]}') from error
        if not isinstance(result, dict) or result.get('ok') is not True:
            raise RuntimeError(
                f'bridge did not confirm repeatability operation '
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
        description='Derive analyzer-exact repeatability measurements before calibration seal.')
    parser.add_argument('--session-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--bridge-url')
    parser.add_argument(
        '--station-token-env', default='AI_GRADER_STATION_BRIDGE_TOKEN')
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_arguments(sys.argv[1:] if argv is None else argv)
    result = derive(args.session_dir)
    submitted: list[str] = []
    if args.bridge_url:
        submitted = submit_requests(
            args.bridge_url, os.environ.get(args.station_token_env, ''),
            result['requests'], result['existing'])
        verified = derive(args.session_dir)
        if len(verified['existing']) != 50:
            raise RuntimeError(
                'bridge submission did not produce all 50 immutable repeatability artifacts')
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
