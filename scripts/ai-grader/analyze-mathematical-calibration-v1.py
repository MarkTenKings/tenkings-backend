#!/usr/bin/env python3
"""Build deterministic physical-calibration measurements from offline captures.

The script never captures hardware and never marks a profile calibrated. It
turns an explicit, hash-bound evidence manifest into the measurement input for
the TypeScript acceptance/finalization authority.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np


SCHEMA = 'ten-kings-mathematical-calibration-capture-manifest-v1'
CAPTURE_PACKAGE_SCHEMA = (
    'ten-kings-mathematical-calibration-capture-package-v1')
CAPTURE_PACKAGE_PURPOSE = 'mathematical_calibration_v1'
CALIBRATION_SUBJECT_DESIGNATION = 'calibration_target'
CAPTURE_PROFILE_VERSION = (
    'ten-kings-fixed-rig-mathematical-calibration-v1')
CARD_GEOMETRY_NORMALIZATION_ALGORITHM = 'ten-kings-card-geometry-v1'
ANALYSIS_SCHEMA = 'ten-kings-mathematical-calibration-analysis-v1'
ALGORITHM = 'opencv_physical_calibration_analysis_v1'
REPEATABILITY_ALGORITHM = (
    'opencv_checkerboard_repeatability_measurement_v1')
REPEATABILITY_INSTRUMENT_ID = (
    'ten-kings-fixed-rig-repeatability-analyzer-v1')
TARGET_AUTHORITY_METHOD = 'protected_checkerboard_geometry_authority_v1'
DIRECTION_ALGORITHM = 'opencv_illumination_centroid_checkerboard_v1'
DIRECTION_METHOD = 'illumination_centroid_checkerboard_repeatability_v1'
DIRECTION_INSTRUMENT_ID = (
    'ten-kings-illumination-centroid-direction-analyzer-v1')
SHA256_RE = __import__('re').compile(r'^[0-9a-f]{64}$')
UTC_TIMESTAMP_RE = __import__('re').compile(
    r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$')
cv2.setNumThreads(1)
cv2.ocl.setUseOpenCL(False)
cv2.setRNGSeed(0)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=True).encode('utf-8')


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def round_number(value: float, digits: int = 6) -> float:
    return round(float(value), digits)


def finite_number(value: Any, name: str, *, positive: bool = False) -> float:
    number = float(value)
    if not math.isfinite(number) or (positive and number <= 0):
        raise ValueError(f'{name} must be finite' +
                         (' and positive' if positive else ''))
    return number


def safe_identifier(value: Any, name: str) -> str:
    text = str(value).strip()
    if not text or len(text) > 128 or not all(
            character.isalnum() or character in '._:-' for character in text):
        raise ValueError(f'{name} must be a safe identifier')
    return text


def safe_relative_path_text(value: Any, name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f'{name} must be a portable relative path')
    text = value.strip()
    parts = text.split('/')
    if (not text or text != value or '\\' in text or text.startswith('/') or
            any(not part or part in {'.', '..'} or ':' in part
                for part in parts)):
        raise ValueError(f'{name} must be a portable relative path')
    return text


def safe_relative_path(root: Path, value: Any, name: str) -> Path:
    text = safe_relative_path_text(value, name)
    candidate = root.joinpath(*text.split('/')).resolve()
    resolved_root = root.resolve()
    if candidate != resolved_root and resolved_root not in candidate.parents:
        raise ValueError(f'{name} must remain beneath the evidence root')
    if not candidate.is_file():
        raise ValueError(f'{name} does not identify a regular file')
    return candidate


def exact_sha256(value: Any, name: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ValueError(f'{name} must be an exact lowercase SHA-256')
    return value


def exact_utc_timestamp(value: Any, name: str) -> str:
    match = (UTC_TIMESTAMP_RE.fullmatch(value)
             if isinstance(value, str) else None)
    if match is None:
        raise ValueError(f'{name} must be an exact UTC timestamp')
    try:
        datetime.datetime(
            int(value[0:4]), int(value[5:7]), int(value[8:10]),
            int(value[11:13]), int(value[14:16]), int(value[17:19]),
            tzinfo=datetime.timezone.utc)
    except ValueError as error:
        raise ValueError(
            f'{name} must be an exact UTC timestamp') from error
    return value


def exact_bool(value: Any, expected: bool, name: str) -> bool:
    if value is not expected:
        raise ValueError(f'{name} must be {str(expected).lower()}')
    return expected


def require_measurement_provenance(
        value: dict[str, Any], label: str,
        expected_target: dict[str, Any] | None = None) -> dict[str, Any]:
    operator_id = safe_identifier(value.get('operatorId'),
                                  f'{label}.operatorId')
    recorded_at = exact_utc_timestamp(value.get('recordedAt'),
                                      f'{label}.recordedAt')
    measurement_method = safe_identifier(
        value.get('measurementMethod'), f'{label}.measurementMethod')
    instrument = value.get('instrument')
    if not isinstance(instrument, dict):
        raise ValueError(f'{label}.instrument is required')
    instrument_id = safe_identifier(
        instrument.get('instrumentId'), f'{label}.instrument.instrumentId')
    kind = instrument.get('kind')
    if kind not in {'traceable_ruler', 'caliper', 'fixed_rig_geometry',
                    'protected_target_geometry'}:
        raise ValueError(f'{label}.instrument.kind is not allowlisted')
    if kind == 'protected_target_geometry':
        if (instrument_id != 'protected-calibration-target-geometry-v1' or
                instrument.get('authorityStatement') !=
                'product_owner_confirmed_exact_target_geometry_v1'):
            raise ValueError(
                f'{label}.instrument protected target authority is invalid')
        target_version = safe_identifier(
            instrument.get('targetVersion'),
            f'{label}.instrument.targetVersion')
        target_sha256 = exact_sha256(
            instrument.get('targetSha256'),
            f'{label}.instrument.targetSha256')
        if (not isinstance(expected_target, dict) or
                target_version != expected_target.get('targetVersion') or
                target_sha256 != expected_target.get('targetSha256')):
            raise ValueError(
                f'{label}.instrument protected target identity mismatch')
        return {
            'operatorId': operator_id,
            'recordedAt': recorded_at,
            'measurementMethod': measurement_method,
            'instrument': {
                'instrumentId': instrument_id,
                'kind': kind,
                'targetVersion': target_version,
                'targetSha256': target_sha256,
                'authorityStatement':
                    'product_owner_confirmed_exact_target_geometry_v1',
            },
        }
    calibration_version = safe_identifier(
        instrument.get('calibrationVersion'),
        f'{label}.instrument.calibrationVersion')
    calibration_sha256 = exact_sha256(
        instrument.get('calibrationSha256'),
        f'{label}.instrument.calibrationSha256')
    return {
        'operatorId': operator_id,
        'recordedAt': recorded_at,
        'measurementMethod': measurement_method,
        'instrument': {
            'instrumentId': instrument_id,
            'kind': kind,
            'calibrationVersion': calibration_version,
            'calibrationSha256': calibration_sha256,
        },
    }


def load_capture_package_authority(
        root: Path, binding: Any, expected_rig_id: str,
        expected_capture_profile_version: str) -> dict[str, Any]:
    if not isinstance(binding, dict):
        raise ValueError('sourceCapturePackage is required')
    package_path = safe_relative_path(
        root, binding.get('path'), 'source capture-package manifest path')
    expected_manifest_sha = exact_sha256(
        binding.get('sha256'), 'source capture-package manifest sha256')
    package_bytes = package_path.read_bytes()
    manifest_sha = sha256_bytes(package_bytes)
    if manifest_sha != expected_manifest_sha:
        raise ValueError('source capture-package manifest SHA-256 mismatch')
    try:
        package = json.loads(package_bytes.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError(
            'source capture-package manifest must be valid UTF-8 JSON') from None
    if (not isinstance(package, dict) or
            package.get('schemaVersion') != CAPTURE_PACKAGE_SCHEMA):
        raise ValueError(
            f'source capture-package schemaVersion must be '
            f'{CAPTURE_PACKAGE_SCHEMA}')
    package_id = safe_identifier(package.get('packageId'), 'packageId')
    if safe_identifier(binding.get('packageId'),
                       'sourceCapturePackage.packageId') != package_id:
        raise ValueError('source capture-package packageId mismatch')
    rig_id = safe_identifier(package.get('rigId'), 'capture package rigId')
    capture_profile_version = safe_identifier(
        package.get('captureProfileVersion'),
        'capture package captureProfileVersion')
    if capture_profile_version != CAPTURE_PROFILE_VERSION:
        raise ValueError(
            f'source capture-package captureProfileVersion must be '
            f'{CAPTURE_PROFILE_VERSION}')
    if rig_id != expected_rig_id:
        raise ValueError('source capture-package rigId mismatch')
    if capture_profile_version != expected_capture_profile_version:
        raise ValueError(
            'source capture-package captureProfileVersion mismatch')
    if package.get('purpose') != CAPTURE_PACKAGE_PURPOSE:
        raise ValueError('source capture-package purpose is not calibration')
    if package.get('thresholdSetId') != 'ten-kings-mathematical-grading-v1.0.1':
        raise ValueError('source capture-package thresholdSetId mismatch')
    threshold_set_hash = exact_sha256(
        package.get('thresholdSetHash'), 'source capture-package thresholdSetHash')
    evidence_derived_authority = package.get('evidenceDerivedAuthority')
    if (not isinstance(evidence_derived_authority, dict) or
            set(evidence_derived_authority) != {
                'thresholdSetId', 'thresholdSetHash',
                'uncertaintyCoverageFactor'} or
            evidence_derived_authority.get('thresholdSetId') !=
            package.get('thresholdSetId') or
            evidence_derived_authority.get('thresholdSetHash') !=
            threshold_set_hash):
        raise ValueError(
            'source capture-package evidence-derived authority does not bind the threshold set')
    uncertainty_coverage_factor = finite_number(
        evidence_derived_authority.get('uncertaintyCoverageFactor'),
        'evidence-derived uncertainty coverage factor', positive=True)
    capture_evidence_acceptance = package.get('captureEvidenceAcceptance')
    if not isinstance(capture_evidence_acceptance, dict):
        raise ValueError(
            'source capture-package captureEvidenceAcceptance is required')
    pose_diversity = capture_evidence_acceptance.get('poseDiversity')
    if not isinstance(pose_diversity, dict):
        raise ValueError('capture-evidence poseDiversity policy is required')
    minimum_target_coverage = finite_number(
        pose_diversity.get('minimumDetectedTargetCoverageFractionPerView'),
        'minimum detected-target coverage', positive=True)
    if minimum_target_coverage > 1:
        raise ValueError('minimum detected-target coverage must be <= 1')
    for role_name in ('geometry', 'normalization'):
        role_policy = pose_diversity.get(role_name)
        if not isinstance(role_policy, dict):
            raise ValueError(f'poseDiversity.{role_name} is required')
        for field in ('minimumNormalizedCenterSpanX',
                      'minimumNormalizedCenterSpanY'):
            value = finite_number(
                role_policy.get(field), f'poseDiversity.{role_name}.{field}',
                positive=True)
            if value > 1:
                raise ValueError(
                    f'poseDiversity.{role_name}.{field} must be <= 1')
        finite_number(role_policy.get('minimumRotationSpanDegrees'),
                      f'poseDiversity.{role_name}.minimumRotationSpanDegrees',
                      positive=True)
    if capture_evidence_acceptance.get('repeatedPlacementAuthority') != (
            'minimumRepeatedPlacements unique bridge capture operation IDs, '
            'timestamps, and source hashes with explicit remove/reseat cycle '
            'evidence; no minimum displacement is imposed'):
        raise ValueError('repeated-placement authority contract mismatch')
    station_authority = package.get('stationAuthority')
    if not isinstance(station_authority, dict):
        raise ValueError('source capture-package stationAuthority is required')
    station_id = safe_identifier(
        station_authority.get('stationId'), 'stationAuthority.stationId')
    station_session_id = safe_identifier(
        station_authority.get('sessionId'), 'stationAuthority.sessionId')
    operator_id = safe_identifier(
        station_authority.get('operatorId'), 'stationAuthority.operatorId')
    created_at = exact_utc_timestamp(
        station_authority.get('createdAt'), 'stationAuthority.createdAt')
    finalized_at = exact_utc_timestamp(
        station_authority.get('finalizedAt'), 'stationAuthority.finalizedAt')
    exact_bool(station_authority.get('noProductionMutation'), True,
               'stationAuthority.noProductionMutation')
    protected = station_authority.get('protectedSettings')
    if not isinstance(protected, dict):
        raise ValueError('stationAuthority.protectedSettings is required')
    if safe_identifier(protected.get('stationId'),
                       'protectedSettings.stationId') != station_id:
        raise ValueError('protected stationId mismatch')
    if safe_identifier(protected.get('rigId'),
                       'protectedSettings.rigId') != rig_id:
        raise ValueError('protected rigId mismatch')
    if safe_identifier(
            protected.get('captureProfileVersion'),
            'protectedSettings.captureProfileVersion') != capture_profile_version:
        raise ValueError('protected captureProfileVersion mismatch')
    camera_index = protected.get('cameraIndex')
    if (isinstance(camera_index, bool) or not isinstance(camera_index, int) or
            camera_index < 0):
        raise ValueError('protected cameraIndex must be nonnegative integer')
    exposure_us = finite_number(
        protected.get('exposureUs'), 'protected exposureUs', positive=True)
    gain = finite_number(protected.get('gain'), 'protected gain')
    duty_percent = finite_number(
        protected.get('dutyPercent'), 'protected dutyPercent', positive=True)
    leimac_unit = protected.get('leimacUnit')
    if (isinstance(leimac_unit, bool) or not isinstance(leimac_unit, int) or
            leimac_unit < 1):
        raise ValueError('protected leimacUnit must be positive integer')
    if protected.get('selectedChannels') != list(range(1, 9)):
        raise ValueError('protected selectedChannels must be exact channels 1-8')
    normalized_width_px = protected.get('normalizedWidthPx')
    normalized_height_px = protected.get('normalizedHeightPx')
    if (isinstance(normalized_width_px, bool) or
            not isinstance(normalized_width_px, int) or
            normalized_width_px < 1 or
            isinstance(normalized_height_px, bool) or
            not isinstance(normalized_height_px, int) or
            normalized_height_px < 1):
        raise ValueError('protected normalized dimensions must be positive integers')
    checkerboard = protected.get('checkerboard')
    if not isinstance(checkerboard, dict):
        raise ValueError('protected checkerboard contract is required')
    subject = package.get('subject')
    if (not isinstance(subject, dict) or
            subject.get('designation') != CALIBRATION_SUBJECT_DESIGNATION or
            subject.get('productionCard') is not False):
        raise ValueError(
            'source capture-package must designate a non-production '
            'calibration target')
    target_version = safe_identifier(
        subject.get('targetVersion'), 'capture package targetVersion')
    target_sha256 = exact_sha256(
        subject.get('targetSha256'), 'capture package targetSha256')
    artifacts = package.get('artifacts')
    if not isinstance(artifacts, list) or not artifacts:
        raise ValueError(
            'source capture-package must contain an artifact ledger')
    artifacts_by_id: dict[str, dict[str, Any]] = {}
    evidence_id_by_path: dict[str, str] = {}
    evidence_id_by_sha256: dict[str, str] = {}
    for index, artifact in enumerate(artifacts):
        label = f'capture package artifacts[{index}]'
        if not isinstance(artifact, dict):
            raise ValueError(f'{label} must be an object')
        evidence_id = safe_identifier(
            artifact.get('evidenceId'), f'{label}.evidenceId')
        if evidence_id in artifacts_by_id:
            raise ValueError(
                'source capture-package contains a duplicate evidenceId')
        relative_path = safe_relative_path_text(
            artifact.get('path'), f'{label}.path')
        if relative_path in evidence_id_by_path:
            raise ValueError(
                'source capture-package contains a duplicate artifact path')
        artifact_path = safe_relative_path(
            root, relative_path, f'{label}.path')
        artifact_sha256 = exact_sha256(
            artifact.get('sha256'), f'{label}.sha256')
        artifact_bytes = artifact_path.read_bytes()
        if sha256_bytes(artifact_bytes) != artifact_sha256:
            raise ValueError('capture package artifact SHA-256 mismatch')
        if artifact_sha256 in evidence_id_by_sha256:
            raise ValueError(
                'source capture-package contains duplicate artifact bytes '
                'relabeled as distinct evidence')
        byte_size = artifact.get('byteSize')
        if (isinstance(byte_size, bool) or not isinstance(byte_size, int) or
                byte_size != len(artifact_bytes)):
            raise ValueError(f'{label}.byteSize must match exact file bytes')
        role = safe_identifier(artifact.get('role'), f'{label}.role')
        artifact_class = artifact.get('artifactClass')
        if artifact_class not in {
                'raw_capture', 'normalized_derivative', 'measurement',
                'target'}:
            raise ValueError(f'{label}.artifactClass is not allowlisted')
        operation_id = safe_identifier(
            artifact.get('operationId'), f'{label}.operationId')
        captured_at = exact_utc_timestamp(
            artifact.get('capturedAt'), f'{label}.capturedAt')
        media_type = artifact.get('mediaType')
        if media_type not in {
                'image/png', 'image/tiff', 'application/json',
                'application/pdf'}:
            raise ValueError(f'{label}.mediaType is not allowlisted')
        if safe_identifier(artifact.get('rigId'),
                           f'{label}.rigId') != rig_id:
            raise ValueError('capture package artifact rigId mismatch')
        if safe_identifier(
                artifact.get('captureProfileVersion'),
                f'{label}.captureProfileVersion') != capture_profile_version:
            raise ValueError(
                'capture package artifact captureProfileVersion mismatch')
        if (artifact.get('subjectDesignation') !=
                CALIBRATION_SUBJECT_DESIGNATION or
                artifact.get('productionCard') is not False):
            raise ValueError(
                'capture package artifact is not designated as '
                'non-production calibration-target evidence')
        channel_index = artifact.get('channelIndex')
        if channel_index is not None and (
                isinstance(channel_index, bool) or
                not isinstance(channel_index, int) or
                channel_index < 1 or channel_index > 8):
            raise ValueError(
                'capture package artifact channelIndex must be null or 1-8')
        target_face = artifact.get('targetFace')
        if target_face is not None and target_face not in {
                'checkerboard', 'blank_reverse'}:
            raise ValueError(f'{label}.targetFace is not allowlisted')
        pose = artifact.get('pose')
        if artifact_class in {'raw_capture', 'normalized_derivative'}:
            if not isinstance(pose, dict):
                raise ValueError(f'{label}.pose is required for image evidence')
            for field in ('centerXFraction', 'centerYFraction',
                          'coverageFraction'):
                pose_value = finite_number(pose.get(field),
                                           f'{label}.pose.{field}')
                if pose_value < 0 or pose_value > 1:
                    raise ValueError(f'{label}.pose.{field} must be 0-1')
            finite_number(pose.get('rotationDegrees'),
                          f'{label}.pose.rotationDegrees')
            corner_signature = pose.get('cornerSignature')
            if (not isinstance(corner_signature, list) or
                    len(corner_signature) != 8):
                raise ValueError(
                    f'{label}.pose.cornerSignature must contain 8 values')
            for signature_index, signature_value in enumerate(
                    corner_signature):
                normalized_value = finite_number(
                    signature_value,
                    f'{label}.pose.cornerSignature[{signature_index}]')
                if normalized_value < 0 or normalized_value > 1:
                    raise ValueError(
                        f'{label}.pose.cornerSignature values must be 0-1')
        if artifact_class == 'raw_capture':
            camera = artifact.get('camera')
            pylon = artifact.get('pylon')
            leimac = artifact.get('leimac')
            safe_off = artifact.get('safeOff')
            if not all(isinstance(value, dict) for value in (
                    camera, pylon, leimac, safe_off)):
                raise ValueError(
                    f'{label} raw capture lacks camera/pylon/Leimac/safe-off provenance')
            safe_identifier(camera.get('serialNumber'),
                            f'{label}.camera.serialNumber')
            safe_identifier(camera.get('modelName'),
                            f'{label}.camera.modelName')
            if camera.get('transport') != 'GigE':
                raise ValueError(f'{label}.camera.transport must be GigE')
            safe_identifier(camera.get('sourcePixelFormat'),
                            f'{label}.camera.sourcePixelFormat')
            if camera.get('savedImageFormat') not in {'PNG', 'TIFF'}:
                raise ValueError(
                    f'{label}.camera.savedImageFormat must be PNG or TIFF')
            if finite_number(camera.get('exposureUs'),
                             f'{label}.camera.exposureUs') != exposure_us:
                raise ValueError(f'{label} exposure does not match protected setting')
            if finite_number(camera.get('gain'),
                             f'{label}.camera.gain') != gain:
                raise ValueError(f'{label} gain does not match protected setting')
            safe_identifier(pylon.get('version'), f'{label}.pylon.version')
            safe_identifier(pylon.get('bridgeVersion'),
                            f'{label}.pylon.bridgeVersion')
            if leimac.get('unit') != leimac_unit:
                raise ValueError(f'{label} Leimac unit mismatch')
            enabled_channels = leimac.get('enabledChannels')
            expected_channels = ([] if role.startswith('dark_control_') else
                                 ([channel_index] if channel_index is not None
                                  else list(range(1, 9))))
            expected_duty = 0.0 if not expected_channels else duty_percent
            if (enabled_channels != expected_channels or
                    finite_number(leimac.get('dutyPercent'),
                                  f'{label}.leimac.dutyPercent') != expected_duty):
                raise ValueError(f'{label} logical Leimac settings mismatch')
            expected_writes = leimac.get('expectedWriteCount')
            acknowledged_writes = leimac.get('acknowledgedWriteCount')
            responses = leimac.get('responseKinds')
            if (isinstance(expected_writes, bool) or
                    not isinstance(expected_writes, int) or
                    expected_writes < 1 or
                    acknowledged_writes != expected_writes or
                    leimac.get('complete') is not True or
                    not isinstance(responses, list) or
                    len(responses) != expected_writes or
                    any(response != 'ack' for response in responses)):
                raise ValueError(f'{label} Leimac acknowledgement is incomplete')
            if (safe_off.get('beforeCaptureConfirmed') is not True or
                    safe_off.get('afterCaptureConfirmed') is not True):
                raise ValueError(f'{label} lacks confirmed before/after safe-off')
            exact_utc_timestamp(safe_off.get('confirmedAt'),
                                f'{label}.safeOff.confirmedAt')
        artifacts_by_id[evidence_id] = {
            'evidenceId': evidence_id,
            'path': relative_path,
            'resolvedPath': artifact_path,
            'sha256': artifact_sha256,
            'role': role,
            'rigId': rig_id,
            'captureProfileVersion': capture_profile_version,
            'subjectDesignation': artifact.get('subjectDesignation'),
            'productionCard': artifact.get('productionCard'),
            'channelIndex': channel_index,
            'artifactClass': artifact_class,
            'operationId': operation_id,
            'capturedAt': captured_at,
            'mediaType': media_type,
            'targetFace': target_face,
            'parentEvidenceId': artifact.get('parentEvidenceId'),
            'parentSha256': artifact.get('parentSha256'),
            'normalization': artifact.get('normalization'),
            'pose': artifact.get('pose'),
            'removeReseatCycleId': artifact.get('removeReseatCycleId'),
        }
        evidence_id_by_path[relative_path] = evidence_id
        evidence_id_by_sha256[artifact_sha256] = evidence_id
    normalized_child_counts: dict[str, int] = {}
    for evidence_id, artifact in artifacts_by_id.items():
        if artifact['artifactClass'] != 'normalized_derivative':
            continue
        parent_id = safe_identifier(
            artifact.get('parentEvidenceId'),
            f'{evidence_id}.parentEvidenceId')
        parent_sha = exact_sha256(
            artifact.get('parentSha256'), f'{evidence_id}.parentSha256')
        parent = artifacts_by_id.get(parent_id)
        if (parent is None or parent['artifactClass'] != 'raw_capture'):
            raise ValueError(
                f'{evidence_id} normalized derivative lacks an exact raw parent')
        if (parent['sha256'] != parent_sha or
                parent['operationId'] != artifact['operationId'] or
                parent['capturedAt'] != artifact['capturedAt'] or
                parent['channelIndex'] != artifact['channelIndex'] or
                parent['targetFace'] != artifact['targetFace']):
            raise ValueError(
                f'{evidence_id} normalized derivative/raw provenance mismatch')
        expected_normalized_role = (
            parent['role'][:-4] if parent['role'].endswith('_raw') else
            f'{parent["role"]}_normalized')
        if artifact['role'] != expected_normalized_role:
            raise ValueError(
                f'{evidence_id} normalized derivative role does not match raw parent')
        normalized_child_counts[parent_id] = (
            normalized_child_counts.get(parent_id, 0) + 1)
        normalization = artifact.get('normalization')
        if not isinstance(normalization, dict):
            raise ValueError(f'{evidence_id}.normalization is required')
        if (normalization.get('algorithmVersion') !=
                CARD_GEOMETRY_NORMALIZATION_ALGORITHM or
                normalization.get('sourceSha256') != parent_sha or
                normalization.get('coordinateFrame') !=
                'normalized_card_portrait_pixels' or
                normalization.get('widthPx') != normalized_width_px or
                normalization.get('heightPx') != normalized_height_px):
            raise ValueError(
                f'{evidence_id} normalization contract is not authoritative')
        for field in ('sourceCropWidth', 'sourceCropHeight', 'scaleX',
                      'scaleY', 'deskewAppliedDegrees'):
            finite_number(normalization.get(field),
                          f'{evidence_id}.normalization.{field}')
    for evidence_id, artifact in artifacts_by_id.items():
        if (artifact['artifactClass'] == 'raw_capture' and
                normalized_child_counts.get(evidence_id) != 1):
            raise ValueError(
                f'{evidence_id} raw capture must have exactly one normalized derivative')
    return {
        'schemaVersion': CAPTURE_PACKAGE_SCHEMA,
        'packageId': package_id,
        'manifestSha256': manifest_sha,
        'rigId': rig_id,
        'captureProfileVersion': capture_profile_version,
        'purpose': CAPTURE_PACKAGE_PURPOSE,
        'thresholdSetId': package.get('thresholdSetId'),
        'thresholdSetHash': threshold_set_hash,
        'evidenceDerivedAuthority': {
            'thresholdSetId': package.get('thresholdSetId'),
            'thresholdSetHash': threshold_set_hash,
            'uncertaintyCoverageFactor': uncertainty_coverage_factor,
        },
        'captureEvidenceAcceptance': capture_evidence_acceptance,
        'stationAuthority': {
            'stationId': station_id,
            'sessionId': station_session_id,
            'operatorId': operator_id,
            'createdAt': created_at,
            'finalizedAt': finalized_at,
            'noProductionMutation': True,
            'protectedSettings': protected,
        },
        'subject': {
            'designation': CALIBRATION_SUBJECT_DESIGNATION,
            'productionCard': False,
            'targetVersion': target_version,
            'targetSha256': target_sha256,
        },
        'artifactsById': artifacts_by_id,
    }


def verify_evidence(authority: dict[str, Any], entry: dict[str, Any],
                    role: str, channel_index: int | None = None
                    ) -> tuple[dict[str, str], Path]:
    evidence_id = safe_identifier(entry.get('evidenceId'), 'evidenceId')
    relative_path = safe_relative_path_text(
        entry.get('path'), 'evidence path')
    expected = exact_sha256(entry.get('sha256'), f'{evidence_id} sha256')
    declared = authority['artifactsById'].get(evidence_id)
    if declared is None:
        raise ValueError(
            f'{evidence_id} is not declared by the source capture package')
    if declared['path'] != relative_path:
        raise ValueError(
            f'{evidence_id} path does not match the source capture package')
    if declared['sha256'] != expected:
        raise ValueError(
            f'{evidence_id} hash does not match the source capture package')
    if declared['role'] != role:
        raise ValueError(
            f'{evidence_id} role does not match the source capture package')
    raw_roles = {
        'lens_geometry', 'normalization_registration', 'repeated_placement'}
    normalized_role = (
        role.startswith('flat_field_channel_') or
        role.startswith('dark_control_channel_') or
        role.startswith('illumination_pattern_channel_'))
    measurement_role = (
        role == 'measurement_repeatability' or
        role.startswith('direction_geometry_channel_') or
        role.startswith('target_cut_dimension_') or
        role.startswith('print_scale_verification_'))
    expected_class = (
        'raw_capture' if role in raw_roles else
        'normalized_derivative' if normalized_role else
        'measurement' if measurement_role else
        'target' if role == 'print_verified_calibration_target' else None)
    if expected_class is None or declared['artifactClass'] != expected_class:
        raise ValueError(
            f'{evidence_id} artifactClass does not match calibration role')
    if measurement_role:
        if (entry.get('recordedAt') != declared['capturedAt'] or
                entry.get('operatorId') !=
                authority['stationAuthority']['operatorId']):
            raise ValueError(
                f'{evidence_id} measurement operator/time provenance mismatch')
    if role in raw_roles and declared['targetFace'] != 'checkerboard':
        raise ValueError(
            f'{evidence_id} must be checkerboard-face raw evidence')
    if normalized_role and declared['targetFace'] != 'blank_reverse':
        raise ValueError(
            f'{evidence_id} must be a normalized blank-reverse derivative')
    if declared['rigId'] != authority['rigId']:
        raise ValueError(
            f'{evidence_id} rigId does not match the source capture package')
    if (declared['captureProfileVersion'] !=
            authority['captureProfileVersion']):
        raise ValueError(
            f'{evidence_id} captureProfileVersion does not match the '
            'source capture package')
    if (declared['subjectDesignation'] !=
            CALIBRATION_SUBJECT_DESIGNATION or
            declared['productionCard'] is not False):
        raise ValueError(
            f'{evidence_id} is not non-production calibration-target evidence')
    if declared['channelIndex'] != channel_index:
        raise ValueError(
            f'{evidence_id} channelIndex does not match its calibration role')
    file_path = declared['resolvedPath']
    digest = sha256_bytes(file_path.read_bytes())
    if expected != digest:
        raise ValueError(f'{evidence_id} SHA-256 mismatch')
    return ({
        'evidenceId': evidence_id,
        'sha256': digest,
        'role': role,
    }, file_path)


def verify_measurement_artifact(file_path: Path, expected: dict[str, Any],
                                label: str,
                                declaration: dict[str, Any],
                                target_identity: dict[str, Any]) -> None:
    try:
        observed = json.loads(file_path.read_text(encoding='utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError(f'{label} must be valid UTF-8 JSON') from None
    expected_with_provenance = {
        **expected,
        **require_measurement_provenance(
            declaration, label, target_identity),
    }
    if observed != expected_with_provenance:
        raise ValueError(
            f'{label} does not match its immutable measurement artifact')


def load_gray(file_path: Path) -> np.ndarray:
    data = np.frombuffer(file_path.read_bytes(), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
    if image is None or image.ndim != 2 or min(image.shape) < 32:
        raise ValueError(f'unsupported or undersized calibration image: {file_path.name}')
    return image


def object_points(columns: int, rows: int, cell_mm: float) -> np.ndarray:
    points = np.zeros((rows * columns, 3), np.float32)
    points[:, :2] = np.mgrid[0:columns, 0:rows].T.reshape(-1, 2)
    points[:, :2] *= cell_mm
    return points


def valid_checkerboard_points(points: np.ndarray, columns: int, rows: int,
                              width: int, height: int) -> bool:
    return bool(
        points.shape == (columns * rows, 2)
        and np.isfinite(points).all()
        and (points[:, 0] >= 0.0).all()
        and (points[:, 0] <= float(width - 1)).all()
        and (points[:, 1] >= 0.0).all()
        and (points[:, 1] <= float(height - 1)).all()
    )


def find_checkerboard_sb(image: np.ndarray, columns: int,
                         rows: int) -> np.ndarray | None:
    flags = (cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY |
             cv2.CALIB_CB_NORMALIZE_IMAGE)
    found, corners = cv2.findChessboardCornersSB(
        image, (columns, rows), flags=flags)
    if not found or corners is None or corners.shape != (
            columns * rows, 1, 2):
        return None
    points = corners.reshape(-1, 2).astype(np.float32)
    if not valid_checkerboard_points(
            points, columns, rows, image.shape[1], image.shape[0]):
        return None
    return points


def find_checkerboard_sb_with_local_contrast(
        image: np.ndarray, columns: int, rows: int) -> np.ndarray | None:
    if (columns, rows) != (11, 16):
        return None
    height, width = image.shape[:2]
    for threshold in (40, 60, 80, 100, 120, 140):
        _, mask = cv2.threshold(
            image, threshold, 255, cv2.THRESH_BINARY_INV)
        contours, _ = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        x, y, roi_width, roi_height = cv2.boundingRect(contour)
        if roi_width * roi_height < width * height * 0.10:
            continue
        for inset_fraction in (0.0, 0.03, 0.04, 0.05):
            inset_x = round(roi_width * inset_fraction)
            inset_y = round(roi_height * inset_fraction)
            crop_x = x + inset_x
            crop_y = y + inset_y
            crop_width = roi_width - 2 * inset_x
            crop_height = roi_height - 2 * inset_y
            if crop_width <= 0 or crop_height <= 0:
                continue
            roi = cv2.equalizeHist(
                image[crop_y:crop_y + crop_height,
                      crop_x:crop_x + crop_width])
            points = find_checkerboard_sb(roi, columns, rows)
            if points is None:
                continue
            source_points = points + np.array(
                [crop_x, crop_y], dtype=np.float32)
            if valid_checkerboard_points(
                    source_points, columns, rows, width, height):
                return source_points
    return None


def detect_checkerboard(image: np.ndarray, columns: int,
                        rows: int) -> np.ndarray:
    points = find_checkerboard_sb(image, columns, rows)
    if points is None and (columns, rows) == (11, 16):
        points = find_checkerboard_sb_with_local_contrast(
            image, columns, rows)
    if points is None:
        raise ValueError(
            f'checkerboard detection failed: expected {columns}x{rows} internal corners')
    if not valid_checkerboard_points(
            points, columns, rows, image.shape[1], image.shape[0]):
        raise ValueError(
            'checkerboard detector produced non-finite or out-of-frame coordinates')
    return points


def orient_points(points: np.ndarray, columns: int, rows: int) -> np.ndarray:
    grid = points.reshape(rows, columns, 2)
    horizontal = np.linalg.norm(grid[:, -1] - grid[:, 0], axis=1).mean()
    vertical = np.linalg.norm(grid[-1] - grid[0], axis=1).mean()
    if horizontal <= 0 or vertical <= 0:
        raise ValueError('degenerate checkerboard geometry')
    return grid.reshape(-1, 2)


def rms_reprojection(object_grid: np.ndarray, image_points: np.ndarray,
                     rvec: np.ndarray, tvec: np.ndarray,
                     matrix: np.ndarray, distortion: np.ndarray) -> float:
    projected, _ = cv2.projectPoints(object_grid, rvec, tvec,
                                     matrix, distortion)
    difference = projected.reshape(-1, 2) - image_points.reshape(-1, 2)
    return float(np.sqrt(np.mean(np.sum(difference * difference, axis=1))))


def undistort_points(points: np.ndarray, matrix: np.ndarray,
                     distortion: np.ndarray) -> np.ndarray:
    return cv2.undistortPoints(
        points.reshape(-1, 1, 2), matrix, distortion, P=matrix,
    ).reshape(-1, 2)


def median_grid_spans(points: np.ndarray, columns: int,
                      rows: int) -> tuple[float, float]:
    grid = points.reshape(rows, columns, 2)
    x_spans = np.linalg.norm(grid[:, 1:] - grid[:, :-1], axis=2)
    y_spans = np.linalg.norm(grid[1:] - grid[:-1], axis=2)
    x_span = float(np.median(x_spans))
    y_span = float(np.median(y_spans))
    if x_span <= 0 or y_span <= 0:
        raise ValueError('checkerboard scale span is degenerate')
    return x_span, y_span


def homography_residual(object_grid: np.ndarray,
                        image_points: np.ndarray) -> float:
    source = object_grid[:, :2].astype(np.float32)
    target = image_points.astype(np.float32)
    transform, _ = cv2.findHomography(source, target, method=0)
    if transform is None or not np.isfinite(transform).all():
        raise ValueError('normalization homography could not be fit')
    projected = cv2.perspectiveTransform(
        source.reshape(-1, 1, 2), transform,
    ).reshape(-1, 2)
    residual = projected - target
    return float(np.sqrt(np.mean(np.sum(residual * residual, axis=1))))


def normalize_to_target_grid(image_points: np.ndarray,
                             target_points: np.ndarray) -> tuple[np.ndarray, float]:
    transform, _ = cv2.findHomography(
        image_points.astype(np.float32),
        target_points.astype(np.float32),
        method=0,
    )
    if transform is None or not np.isfinite(transform).all():
        raise ValueError('normalized target homography could not be fit')
    projected = cv2.perspectiveTransform(
        image_points.reshape(-1, 1, 2).astype(np.float32), transform,
    ).reshape(-1, 2)
    residual = projected - target_points
    return projected, float(
        np.sqrt(np.mean(np.sum(residual * residual, axis=1))))


def perspective_points(points: np.ndarray,
                       transform: np.ndarray) -> np.ndarray:
    return cv2.perspectiveTransform(
        points.reshape(-1, 1, 2).astype(np.float32), transform,
    ).reshape(-1, 2)


def fit_boundary_line(
        gradient_x: np.ndarray, gradient_y: np.ndarray,
        start: np.ndarray, end: np.ndarray,
        search_half_width_px: int) -> tuple[np.ndarray, float]:
    tangent = end - start
    length = float(np.linalg.norm(tangent))
    if not math.isfinite(length) or length <= 0:
        raise ValueError('predicted coupon boundary is degenerate')
    tangent /= length
    normal = np.array([-tangent[1], tangent[0]], np.float32)
    height, width = gradient_x.shape
    samples: list[np.ndarray] = []
    for fraction_value in np.linspace(0.1, 0.9, 48):
        predicted = start + tangent * length * float(fraction_value)
        best_response = -1.0
        best_offset = 0
        best_point: np.ndarray | None = None
        for offset in range(-search_half_width_px,
                            search_half_width_px + 1):
            candidate = predicted + normal * offset
            x = int(round(float(candidate[0])))
            y = int(round(float(candidate[1])))
            if x < 1 or x >= width - 1 or y < 1 or y >= height - 1:
                continue
            response = abs(
                float(gradient_x[y, x]) * float(normal[0]) +
                float(gradient_y[y, x]) * float(normal[1]))
            if (response > best_response + 1e-9 or
                    (abs(response - best_response) <= 1e-9 and
                     abs(offset) < abs(best_offset))):
                best_response = response
                best_offset = offset
                best_point = np.array([x, y], np.float32)
        if best_point is None or best_response < 4:
            continue
        samples.append(best_point)
    if len(samples) < 24:
        raise ValueError(
            'outer coupon boundary has insufficient measured cross-sections')
    points = np.stack(samples).astype(np.float32)
    line = cv2.fitLine(points, cv2.DIST_HUBER, 0, 0.01, 0.01).reshape(-1)
    vx, vy, x0, y0 = [float(value) for value in line]
    norm = math.hypot(vx, vy)
    if not all(math.isfinite(value) for value in (vx, vy, x0, y0)) or norm <= 0:
        raise ValueError('outer coupon robust line fit failed')
    vx /= norm
    vy /= norm
    equation = np.array([-vy, vx, vy * x0 - vx * y0], np.float64)
    distances = np.abs(
        points[:, 0] * equation[0] +
        points[:, 1] * equation[1] +
        equation[2])
    median = float(np.median(distances))
    mad = float(np.median(np.abs(distances - median)))
    limit = max(1.0, median + 4 * max(mad, 1e-6))
    inliers = points[distances <= limit]
    if len(inliers) < 24:
        raise ValueError('outer coupon robust line fit lost required support')
    refined = cv2.fitLine(
        inliers.astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01,
    ).reshape(-1)
    vx, vy, x0, y0 = [float(value) for value in refined]
    norm = math.hypot(vx, vy)
    vx /= norm
    vy /= norm
    equation = np.array([-vy, vx, vy * x0 - vx * y0], np.float64)
    residuals = (
        inliers[:, 0] * equation[0] +
        inliers[:, 1] * equation[1] +
        equation[2])
    return equation, float(np.sqrt(np.mean(residuals * residuals)))


def line_intersection(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    determinant = left[0] * right[1] - right[0] * left[1]
    if not math.isfinite(float(determinant)) or abs(float(determinant)) < 1e-9:
        raise ValueError('outer coupon fitted boundary lines do not intersect')
    return np.array([
        (left[1] * right[2] - right[1] * left[2]) / determinant,
        (left[2] * right[0] - right[2] * left[0]) / determinant,
    ], np.float32)


def detect_outer_coupon(
        file_path: Path, corrected_checkerboard_points: np.ndarray,
        object_grid: np.ndarray, matrix: np.ndarray, distortion: np.ndarray,
        coupon_width_mm: float, coupon_height_mm: float,
        first_internal_corner_mm: tuple[float, float],
        normalized_width_px: int,
        normalized_height_px: int) -> tuple[np.ndarray, float]:
    physical_to_image, _ = cv2.findHomography(
        object_grid[:, :2].astype(np.float32),
        corrected_checkerboard_points.astype(np.float32), method=0)
    if physical_to_image is None or not np.isfinite(physical_to_image).all():
        raise ValueError('coupon prediction homography could not be fit')
    first_x, first_y = first_internal_corner_mm
    coupon_relative_to_first = np.float32([
        [-first_x, -first_y],
        [coupon_width_mm - first_x, -first_y],
        [coupon_width_mm - first_x, coupon_height_mm - first_y],
        [-first_x, coupon_height_mm - first_y],
    ])
    predicted = perspective_points(
        coupon_relative_to_first, physical_to_image)
    image = cv2.undistort(load_gray(file_path), matrix, distortion)
    gradient_x = cv2.Sobel(
        image.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3)
    gradient_y = cv2.Sobel(
        image.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3)
    horizontal_scale = (
        (np.linalg.norm(predicted[1] - predicted[0]) +
         np.linalg.norm(predicted[2] - predicted[3])) /
        (2 * coupon_width_mm))
    vertical_scale = (
        (np.linalg.norm(predicted[3] - predicted[0]) +
         np.linalg.norm(predicted[2] - predicted[1])) /
        (2 * coupon_height_mm))
    search_half_width_px = max(
        3, int(math.ceil(0.75 * max(horizontal_scale, vertical_scale))))
    lines = [
        fit_boundary_line(
            gradient_x, gradient_y, predicted[index],
            predicted[(index + 1) % 4], search_half_width_px)
        for index in range(4)
    ]
    equations = [entry[0] for entry in lines]
    contour = np.stack([
        line_intersection(equations[3], equations[0]),
        line_intersection(equations[0], equations[1]),
        line_intersection(equations[1], equations[2]),
        line_intersection(equations[2], equations[3]),
    ])
    if not np.isfinite(contour).all():
        raise ValueError('outer coupon contour contains non-finite corners')
    prediction_error = float(np.sqrt(np.mean(np.sum(
        (contour - predicted) * (contour - predicted), axis=1))))
    if prediction_error > search_half_width_px * 1.5:
        raise ValueError('detected outer coupon contour is outside its physical search band')
    source_mean_side = float(np.mean([
        np.linalg.norm(contour[(index + 1) % 4] - contour[index])
        for index in range(4)
    ]))
    normalized_mean_side = (
        normalized_width_px + normalized_height_px) / 2
    normalized_scale = normalized_mean_side / source_mean_side
    fit_residual_normalized_px = float(
        np.sqrt(np.mean([entry[1] ** 2 for entry in lines])) *
        normalized_scale)
    return contour, fit_residual_normalized_px


def measured_source_pose(contour: np.ndarray, image_width: int,
                         image_height: int) -> dict[str, float]:
    if (not np.isfinite(contour).all() or
            np.any(contour[:, 0] <= 0) or
            np.any(contour[:, 0] >= image_width) or
            np.any(contour[:, 1] <= 0) or
            np.any(contour[:, 1] >= image_height)):
        raise ValueError(
            'detected outer coupon corners must be finite and strictly inside '
            'the source frame')
    area = abs(float(cv2.contourArea(contour.astype(np.float32))))
    center = np.mean(contour, axis=0)
    top_edge = contour[1] - contour[0]
    return {
        'centerXFraction': round_number(float(center[0]) / image_width),
        'centerYFraction': round_number(float(center[1]) / image_height),
        'coverageFraction': round_number(
            area / float(image_width * image_height)),
        'rotationDegrees': round_number(math.degrees(math.atan2(
            float(top_edge[1]), float(top_edge[0])))),
    }


def enforce_pose_diversity(role: str, poses: list[dict[str, float]],
                           policy: dict[str, Any],
                           minimum_coverage: float) -> dict[str, Any]:
    if not poses:
        raise ValueError(f'{role} pose evidence is required')
    minimum_observed_coverage = min(
        pose['coverageFraction'] for pose in poses)
    if minimum_observed_coverage < minimum_coverage:
        raise ValueError(
            f'{role} has a source view below the centralized target-coverage gate')
    center_x_span = max(pose['centerXFraction'] for pose in poses) - min(
        pose['centerXFraction'] for pose in poses)
    center_y_span = max(pose['centerYFraction'] for pose in poses) - min(
        pose['centerYFraction'] for pose in poses)
    rotation_span = max(pose['rotationDegrees'] for pose in poses) - min(
        pose['rotationDegrees'] for pose in poses)
    if (center_x_span < float(policy['minimumNormalizedCenterSpanX']) or
            center_y_span < float(policy['minimumNormalizedCenterSpanY']) or
            rotation_span < float(policy['minimumRotationSpanDegrees'])):
        raise ValueError(
            f'{role} does not satisfy centralized independent pose-diversity gates')
    return {
        'role': role,
        'viewCount': len(poses),
        'minimumObservedCoverageFraction': round_number(
            minimum_observed_coverage),
        'centerXSpan': round_number(center_x_span),
        'centerYSpan': round_number(center_y_span),
        'rotationSpanDegrees': round_number(rotation_span),
        'policy': policy,
        'coveragePolicy': minimum_coverage,
        'source': 'independently_detected_outer_coupon_contours',
    }


def downsample_mean(image: np.ndarray, width: int = 32,
                    height: int = 32) -> np.ndarray:
    return cv2.resize(image.astype(np.float32), (width, height),
                      interpolation=cv2.INTER_AREA)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json.dumps(value, indent=2, sort_keys=True,
                                ensure_ascii=True).encode('utf-8') + b'\n')


def load_views(authority: dict[str, Any], entries: list[dict[str, Any]], role: str,
               columns: int, rows: int) -> list[dict[str, Any]]:
    views: list[dict[str, Any]] = []
    expected_shape: tuple[int, int] | None = None
    for entry in entries:
        evidence, file_path = verify_evidence(authority, entry, role)
        image = load_gray(file_path)
        if expected_shape is None:
            expected_shape = image.shape
        elif image.shape != expected_shape:
            raise ValueError(f'{role} images must share exact dimensions')
        points = orient_points(detect_checkerboard(image, columns, rows),
                               columns, rows)
        views.append({
            'evidence': evidence,
            'path': file_path,
            'shape': image.shape,
            'points': points,
        })
    return views


def compute_checkerboard_repeatability_measurements(
        views: list[dict[str, Any]], columns: int,
        rows: int) -> dict[str, list[float]]:
    if len(views) != 10:
        raise ValueError(
            'deterministic measurement repeatability requires exact 10 source views')
    linear_pixel_samples: list[float] = []
    area_pixel_samples: list[float] = []
    relief_samples: list[float] = []
    roughness_samples: list[float] = []
    lightness_samples: list[float] = []
    canonical_step = 40
    canonical_width = (columns - 1) * canonical_step + 1
    canonical_height = (rows - 1) * canonical_step + 1
    destination = np.float32([
        [0, 0], [canonical_width - 1, 0],
        [canonical_width - 1, canonical_height - 1],
        [0, canonical_height - 1],
    ])
    for view in views:
        grid = view['points'].reshape(rows, columns, 2)
        horizontal = np.linalg.norm(
            grid[:, 1:, :] - grid[:, :-1, :], axis=2)
        vertical = np.linalg.norm(
            grid[1:, :, :] - grid[:-1, :, :], axis=2)
        horizontal_median = float(np.median(horizontal))
        vertical_median = float(np.median(vertical))
        linear_pixel_samples.append(
            (horizontal_median + vertical_median) / 2)
        area_pixel_samples.append(horizontal_median * vertical_median)
        source = np.float32([
            grid[0, 0], grid[0, -1], grid[-1, -1], grid[-1, 0],
        ])
        transform = cv2.getPerspectiveTransform(source, destination)
        image = load_gray(view['path'])
        registered = cv2.warpPerspective(
            image, transform, (canonical_width, canonical_height),
            flags=cv2.INTER_LINEAR)
        # One fixed central checker cell, with 20% edge exclusion, is the
        # immutable ROI for relief/roughness/lightness repeatability.
        column = (columns - 1) // 2
        row = (rows - 1) // 2
        inset = canonical_step // 5
        patch = registered[
            row * canonical_step + inset:(row + 1) * canonical_step - inset,
            column * canonical_step + inset:
            (column + 1) * canonical_step - inset,
        ].astype(np.float32)
        if patch.size < 64:
            raise ValueError('fixed checkerboard repeatability ROI is invalid')
        relief_samples.append(float(np.std(patch) / 255.0))
        laplacian = cv2.Laplacian(patch, cv2.CV_32F, ksize=3)
        roughness_samples.append(float(np.mean(np.abs(laplacian)) / 255.0))
        lab = cv2.cvtColor(
            np.repeat(patch.astype(np.uint8)[:, :, None], 3, axis=2),
            cv2.COLOR_BGR2LAB)
        lightness_samples.append(float(np.mean(lab[:, :, 0]) * 100 / 255))
    mean_linear = float(np.mean(linear_pixel_samples))
    mean_area = float(np.mean(area_pixel_samples))
    mean_lightness = float(np.mean(lightness_samples))
    return {
        'linear_mm': [round_number(5.0 * value / mean_linear)
                      for value in linear_pixel_samples],
        'area_mm2': [round_number(25.0 * value / mean_area)
                     for value in area_pixel_samples],
        'relief_index': [round_number(value) for value in relief_samples],
        'roughness_index': [round_number(value) for value in roughness_samples],
        'color_delta_e': [round_number(abs(value - mean_lightness))
                          for value in lightness_samples],
    }


def parse_direction(value: Any, name: str) -> dict[str, float]:
    if not isinstance(value, dict):
        raise ValueError(f'{name} must be an object')
    x = finite_number(value.get('x'), f'{name}.x')
    y = finite_number(value.get('y'), f'{name}.y')
    length = math.hypot(x, y)
    if length <= 0:
        raise ValueError(f'{name} must be nonzero')
    return {'x': round_number(x / length), 'y': round_number(y / length)}


def angular_error_degrees(left: dict[str, float],
                          right: dict[str, float]) -> float:
    cosine = max(-1.0, min(1.0, left['x'] * right['x'] +
                          left['y'] * right['y']))
    return math.degrees(math.acos(cosine))


def irradiance_centroid(image: np.ndarray) -> tuple[float, float]:
    baseline = float(np.median(image))
    weights = np.maximum(image.astype(np.float64) - baseline, 0.0)
    total = float(weights.sum())
    if not math.isfinite(total) or total <= 0:
        raise ValueError('uniform-target irradiance response has no measurable direction')
    y_coordinates, x_coordinates = np.indices(image.shape, dtype=np.float64)
    return (
        float((x_coordinates * weights).sum() / total),
        float((y_coordinates * weights).sum() / total),
    )


def sample_standard_deviation(values: list[float]) -> float:
    if len(values) < 2 or not all(math.isfinite(value) for value in values):
        raise ValueError('uncertainty derivation requires at least two finite samples')
    return float(np.std(np.asarray(values, dtype=np.float64), ddof=1))


def compute_illumination_direction_authority(
        images: list[np.ndarray], coupon_width_mm: float,
        coupon_height_mm: float, linear_repeatability_mm: list[float],
        coverage_factor: float
        ) -> list[dict[str, Any]]:
    if len(images) != 3:
        raise ValueError(
            'direction authority requires exactly three illumination captures')
    if len(linear_repeatability_mm) != 10:
        raise ValueError(
            'direction uncertainty requires exactly ten checkerboard repeatability samples')
    shapes = {image.shape for image in images}
    if len(shapes) != 1:
        raise ValueError('direction illumination captures must share dimensions')
    height, width = next(iter(shapes))
    if height <= 1 or width <= 1:
        raise ValueError('direction illumination captures are undersized')
    points: list[dict[str, float]] = []
    for image in images:
        centroid_x, centroid_y = irradiance_centroid(image)
        points.append({
            'x': round_number(centroid_x * coupon_width_mm / (width - 1)),
            'y': round_number(centroid_y * coupon_height_mm / (height - 1)),
        })
    center = {
        'x': round_number(coupon_width_mm / 2),
        'y': round_number(coupon_height_mm / 2),
    }
    vectors = [parse_direction({
        'x': point['x'] - center['x'],
        'y': point['y'] - center['y'],
    }, 'illumination-centroid direction sample') for point in points]
    mean_direction = parse_direction({
        'x': float(np.mean([value['x'] for value in vectors])),
        'y': float(np.mean([value['y'] for value in vectors])),
    }, 'mean illumination-centroid direction')
    validation_errors = []
    for index, vector in enumerate(vectors):
        holdout = [value for position, value in enumerate(vectors)
                   if position != index]
        holdout_direction = parse_direction({
            'x': float(np.mean([value['x'] for value in holdout])),
            'y': float(np.mean([value['y'] for value in holdout])),
        }, 'leave-one-out illumination-centroid direction')
        validation_errors.append(round_number(
            angular_error_degrees(holdout_direction, vector)))
    checkerboard_u95_mm = coverage_factor * sample_standard_deviation(
        linear_repeatability_mm)
    centroid_u95_mm = coverage_factor * math.hypot(
        sample_standard_deviation([point['x'] for point in points]),
        sample_standard_deviation([point['y'] for point in points]),
    )
    point_u95_mm = round_number(math.hypot(
        checkerboard_u95_mm, centroid_u95_mm))
    if not math.isfinite(point_u95_mm) or point_u95_mm <= 0:
        raise ValueError(
            'evidence-derived direction point U95 must be finite and positive')
    return [{
        'sampleIndex': index + 1,
        'sourcePointMm': point,
        'cardCenterPointMm': center,
        'pointU95Mm': point_u95_mm,
        'directionValidationErrorDegrees': validation_errors[index],
        'meanDirection': mean_direction,
    } for index, point in enumerate(points)]


def analyze_flat_field_channel(
        authority: dict[str, Any], entry: dict[str, Any],
        output_dir: Path, coupon_width_mm: float,
        coupon_height_mm: float,
        linear_repeatability_mm: list[float]) -> tuple[
            dict[str, Any], dict[str, Any], np.ndarray, list[dict[str, str]]]:
    channel_index = int(entry.get('channelIndex'))
    if channel_index < 1 or channel_index > 8:
        raise ValueError('flat-field channelIndex must be from 1 to 8')
    direction_measurements: list[dict[str, Any]] = []
    direction_vectors: list[dict[str, float]] = []
    direction_methods: set[str] = set()
    for measurement_entry in entry.get('directionMeasurements', []):
        evidence, measurement_path = verify_evidence(
            authority, measurement_entry,
            f'direction_geometry_channel_{channel_index}', channel_index)
        measurement_method = measurement_entry.get('measurementMethod')
        if measurement_method not in {
                'fixed_ring_segment_geometry_with_ruler_v1',
                DIRECTION_METHOD}:
            raise ValueError(
                'V1 channel direction method is not allowlisted')
        direction_methods.add(str(measurement_method))
        if (measurement_method != DIRECTION_METHOD and
                isinstance(measurement_entry.get('instrument'), dict) and
                measurement_entry['instrument'].get('kind') ==
                'protected_target_geometry'):
            raise ValueError(
                'protected target geometry cannot authorize physical light-direction coordinates')
        source_point_raw = measurement_entry.get('sourcePointMm')
        card_center_raw = measurement_entry.get('cardCenterPointMm')
        if not isinstance(source_point_raw, dict) or not isinstance(
                card_center_raw, dict):
            raise ValueError('direction geometry points are required')
        source_point = {
            'x': round_number(finite_number(
                source_point_raw.get('x'), 'direction sourcePointMm.x')),
            'y': round_number(finite_number(
                source_point_raw.get('y'), 'direction sourcePointMm.y')),
        }
        card_center = {
            'x': round_number(finite_number(
                card_center_raw.get('x'), 'direction cardCenterPointMm.x')),
            'y': round_number(finite_number(
                card_center_raw.get('y'), 'direction cardCenterPointMm.y')),
        }
        point_u95_mm = finite_number(
            measurement_entry.get('pointU95Mm'),
            'direction pointU95Mm', positive=True)
        sample_index = measurement_entry.get('sampleIndex')
        if (isinstance(sample_index, bool) or
                not isinstance(sample_index, int) or sample_index <= 0):
            raise ValueError('direction sampleIndex must be a positive integer')
        expected_measurement = {
            'schemaVersion':
                'ten-kings-calibration-direction-measurement-v1',
            'channelIndex': channel_index,
            'sampleIndex': sample_index,
            'measurementMethod': measurement_method,
            'sourcePointMm': source_point,
            'cardCenterPointMm': card_center,
            'pointU95Mm': round_number(point_u95_mm),
        }
        derived_binding: dict[str, Any] = {}
        if measurement_method == DIRECTION_METHOD:
            if measurement_entry.get('measurementAlgorithmVersion') != DIRECTION_ALGORITHM:
                raise ValueError('direction measurement algorithm identity mismatch')
            source_capture_operation_id = safe_identifier(
                measurement_entry.get('sourceCaptureOperationId'),
                'direction sourceCaptureOperationId')
            source_evidence_id = safe_identifier(
                measurement_entry.get('sourceEvidenceId'),
                'direction sourceEvidenceId')
            source_sha256 = exact_sha256(
                measurement_entry.get('sourceSha256'),
                'direction sourceSha256')
            source_role = (
                f'illumination_pattern_channel_{channel_index}')
            if measurement_entry.get('sourceRole') != source_role:
                raise ValueError('direction source role mismatch')
            derived_binding = {
                'sourceCaptureOperationId': source_capture_operation_id,
                'sourceEvidenceId': source_evidence_id,
                'sourceSha256': source_sha256,
                'sourceRole': source_role,
                'measurementAlgorithmVersion': DIRECTION_ALGORITHM,
            }
            expected_measurement.update(derived_binding)
        verify_measurement_artifact(measurement_path, expected_measurement,
            f'channel {channel_index} direction measurement',
            measurement_entry, authority['subject'])
        vector = parse_direction({
            'x': source_point['x'] - card_center['x'],
            'y': source_point['y'] - card_center['y'],
        }, f'channel {channel_index} fixed geometry direction')
        direction_vectors.append(vector)
        direction_measurements.append({
            **evidence,
            **({'sampleIndex': sample_index}
               if measurement_method == DIRECTION_METHOD else {}),
            'measurementMethod': measurement_method,
            'sourcePointMm': source_point,
            'cardCenterPointMm': card_center,
            'pointU95Mm': round_number(point_u95_mm),
            **derived_binding,
        })
    if len(direction_measurements) < 3:
        raise ValueError(
            f'channel {channel_index} requires at least three immutable '
            'direction authority measurements')
    if len(direction_methods) != 1:
        raise ValueError(
            f'channel {channel_index} cannot mix direction authority methods')
    mean_geometry_x = float(np.mean(
        [sample['x'] for sample in direction_vectors]))
    mean_geometry_y = float(np.mean(
        [sample['y'] for sample in direction_vectors]))
    direction = parse_direction(
        {'x': mean_geometry_x, 'y': mean_geometry_y},
        f'channel {channel_index} mean fixed geometry direction')
    frame_records: list[dict[str, str]] = []
    frames: list[np.ndarray] = []
    shape: tuple[int, int] | None = None
    for frame_entry in entry.get('frames', []):
        evidence, file_path = verify_evidence(
            authority, frame_entry, f'flat_field_channel_{channel_index}',
            channel_index)
        image = load_gray(file_path).astype(np.float32)
        if shape is None:
            shape = image.shape
        elif image.shape != shape:
            raise ValueError('flat-field frames for one channel must share dimensions')
        frames.append(image)
        frame_records.append(evidence)
    if len(frames) < 3:
        raise ValueError(f'channel {channel_index} requires at least three flat-field frames')

    dark_frames: list[np.ndarray] = []
    dark_records: list[dict[str, str]] = []
    for dark_entry in entry.get('darkFrames', []):
        evidence, file_path = verify_evidence(
            authority, dark_entry, f'dark_control_channel_{channel_index}',
            channel_index)
        image = load_gray(file_path).astype(np.float32)
        if image.shape != shape:
            raise ValueError('dark and flat-field frames must share dimensions')
        dark_frames.append(image)
        dark_records.append(evidence)
    dark = np.mean(dark_frames, axis=0) if dark_frames else np.zeros(shape,
                                                                    np.float32)
    if len(dark_frames) < 3:
        raise ValueError(
            f'channel {channel_index} requires at least three exact dark-control frames')
    corrected_source = [np.maximum(frame - dark, 1.0) for frame in frames]
    if shape[0] <= 1 or shape[1] <= 1:
        raise ValueError('flat-field frames must be at least 2x2 pixels')
    direction_validation_errors: list[float] = []
    if DIRECTION_METHOD not in direction_methods:
        for image, evidence in zip(corrected_source, frame_records):
            centroid_x, centroid_y = irradiance_centroid(image)
            source_point = {
                'x': round_number(centroid_x * coupon_width_mm / (image.shape[1] - 1)),
                'y': round_number(centroid_y * coupon_height_mm / (image.shape[0] - 1)),
            }
            card_center = {
                'x': round_number(coupon_width_mm / 2),
                'y': round_number(coupon_height_mm / 2),
            }
            irradiance_direction = parse_direction({
                'x': source_point['x'] - card_center['x'],
                'y': source_point['y'] - card_center['y'],
            }, f'channel {channel_index} measured irradiance direction')
            direction_validation_errors.append(round_number(
                angular_error_degrees(direction, irradiance_direction)))
    response_scale = float(np.mean([image.mean() for image in corrected_source]))
    normalized = [image / float(image.mean()) for image in corrected_source]
    response = np.mean(normalized, axis=0)
    gain = 1.0 / np.maximum(response, 1e-6)
    gain /= float(gain.mean())

    residual_planes: list[np.ndarray] = []
    for image in corrected_source:
        corrected = image * gain
        residual_planes.append(
            downsample_mean(corrected / float(corrected.mean())))
    residual_values = np.concatenate(
        [plane.reshape(-1) for plane in residual_planes])
    if not np.isfinite(residual_values).all() or np.any(residual_values <= 0):
        raise ValueError(f'channel {channel_index} flat-field residual is invalid')
    # Persist the exact acceptance samples in the runtime artifact.  The
    # TypeScript finalizer and runtime loader both recompute the acceptance
    # statistic from these same rounded values, so a separately supplied
    # scalar cannot attest a different flat-field response.
    corrected_residual_samples = [
        round_number(value) for value in residual_values.tolist()
    ]
    corrected_residual_mean = float(np.mean(corrected_residual_samples))
    corrected_maximum_deviation = max(
        abs(value / corrected_residual_mean - 1.0)
        for value in corrected_residual_samples)
    sampled_gain = downsample_mean(gain)
    pattern_records: list[dict[str, str]] = []
    pattern_frames: list[np.ndarray] = []
    pattern_authority_images: list[np.ndarray] = []
    for pattern_entry in entry.get('illuminationPatternFrames', []):
        evidence, file_path = verify_evidence(
            authority, pattern_entry,
            f'illumination_pattern_channel_{channel_index}', channel_index)
        image = load_gray(file_path).astype(np.float32)
        if image.shape != shape:
            raise ValueError(
                'illumination-pattern and flat-field frames must share dimensions')
        pattern_authority_images.append(image)
        corrected = np.maximum(image - dark, 1.0) * gain
        pattern_frames.append(corrected / float(corrected.mean()))
        pattern_records.append(evidence)
    if len(pattern_frames) != 3:
        raise ValueError(
            f'channel {channel_index} requires exactly three illumination-pattern frames')
    if DIRECTION_METHOD in direction_methods:
        derived = compute_illumination_direction_authority(
            pattern_authority_images, coupon_width_mm, coupon_height_mm,
            linear_repeatability_mm,
            authority['evidenceDerivedAuthority'][
                'uncertaintyCoverageFactor'])
        measurements_by_sample = {
            int(sample.get('sampleIndex', 0)): sample
            for sample in direction_measurements
        }
        for expected, source in zip(derived, pattern_records):
            sample_index = expected['sampleIndex']
            observed = measurements_by_sample.get(sample_index)
            source_declaration = authority['artifactsById'][
                source['evidenceId']]
            if (observed is None or
                    observed['sourcePointMm'] != expected['sourcePointMm'] or
                    observed['cardCenterPointMm'] != expected['cardCenterPointMm'] or
                    observed['pointU95Mm'] != expected['pointU95Mm'] or
                    observed.get('sourceEvidenceId') != source['evidenceId'] or
                    observed.get('sourceSha256') != source['sha256'] or
                    observed.get('sourceCaptureOperationId') !=
                    source_declaration['operationId']):
                raise ValueError(
                    f'channel {channel_index} direction authority does not match deterministic illumination/repeatability derivation')
        direction = derived[0]['meanDirection']
        direction_validation_errors = [
            sample['directionValidationErrorDegrees'] for sample in derived]
    flat_artifact_without_hash = {
        'schemaVersion': 'ten-kings-flat-field-artifact-v1',
        'algorithmVersion': ALGORITHM,
        'hashPolicy': 'sha256-canonical-json-with-artifactSha256-omitted',
        'channelIndex': channel_index,
        'direction': direction,
        'directionMeasurementSamples': direction_measurements,
        'directionValidationAngularErrorsDegrees': direction_validation_errors,
        'sourceEvidence': frame_records,
        'darkControlEvidence': dark_records,
        'sourceWidthPx': int(shape[1]),
        'sourceHeightPx': int(shape[0]),
        'gainGrid': {
            'width': int(sampled_gain.shape[1]),
            'height': int(sampled_gain.shape[0]),
            'values': [round_number(value) for value in sampled_gain.reshape(-1)],
        },
        'correctedResidualSamples': corrected_residual_samples,
        'responseScale': round_number(response_scale),
        'correctedMaximumDeviationFraction': round_number(
            corrected_maximum_deviation),
    }
    artifact_hash = sha256_bytes(canonical_bytes(flat_artifact_without_hash))
    flat_artifact = {
        **flat_artifact_without_hash,
        'artifactSha256': artifact_hash,
    }
    artifact_name = f'flat-field-channel-{channel_index}-v1.json'
    artifact_path = output_dir / artifact_name
    write_json(artifact_path, flat_artifact)
    exact_file_hash = sha256_bytes(artifact_path.read_bytes())
    builder_channel = {
        'channelIndex': channel_index,
        'direction': direction,
        'directionMeasurementSamples': direction_measurements,
        'directionValidationAngularErrorsDegrees': direction_validation_errors,
        'relativeResponse': corrected_residual_samples,
        'responseScale': round_number(response_scale),
        'flatFieldArtifactId': f'flat-field-channel-{channel_index}-v1',
        'flatFieldArtifactSha256': exact_file_hash,
        'flatFieldFrames': frame_records,
        'darkControlFrames': dark_records,
    }
    pattern_response = downsample_mean(np.mean(pattern_frames, axis=0))
    return builder_channel, {
        'channelIndex': channel_index,
        'artifactFileName': artifact_name,
        'artifactFileSha256': exact_file_hash,
        'contentSha256': artifact_hash,
        'maximumResidualDeviationFraction':
            flat_artifact_without_hash['correctedMaximumDeviationFraction'],
    }, pattern_response, pattern_records


def analyze(manifest_path: Path, output_dir: Path) -> dict[str, Any]:
    raw = json.loads(manifest_path.read_text(encoding='utf-8'))
    if not isinstance(raw, dict) or raw.get('schemaVersion') != SCHEMA:
        raise ValueError(f'manifest schemaVersion must be {SCHEMA}')
    evidence_root_value = raw.get('evidenceRoot', '.')
    evidence_root = (manifest_path.parent / str(evidence_root_value)).resolve()
    if not evidence_root.is_dir():
        raise ValueError('evidenceRoot must identify an existing directory')
    rig_id = safe_identifier(raw.get('rigId'), 'rigId')
    capture_profile_version = safe_identifier(
        raw.get('captureProfileVersion'), 'captureProfileVersion')
    if capture_profile_version != CAPTURE_PROFILE_VERSION:
        raise ValueError(
            f'captureProfileVersion must be {CAPTURE_PROFILE_VERSION}')
    capture_package_authority = load_capture_package_authority(
        evidence_root, raw.get('sourceCapturePackage'), rig_id,
        capture_profile_version)
    checkerboard = raw.get('checkerboard')
    if not isinstance(checkerboard, dict):
        raise ValueError('checkerboard is required')
    columns = int(checkerboard.get('internalColumns'))
    rows = int(checkerboard.get('internalRows'))
    cell_mm = finite_number(checkerboard.get('cellMm'),
                            'checkerboard.cellMm', positive=True)
    if (columns, rows, round_number(cell_mm)) != (11, 16, 5.0):
        raise ValueError('V1 requires the exact 11x16 internal-corner, 5.00 mm target')
    protected_settings = capture_package_authority[
        'stationAuthority']['protectedSettings']
    if protected_settings.get('checkerboard') != checkerboard:
        raise ValueError(
            'capture manifest checkerboard differs from protected station settings')
    object_grid = object_points(columns, rows, cell_mm)
    target = raw.get('target')
    if not isinstance(target, dict):
        raise ValueError('target is required')
    coupon_width_mm = finite_number(
        target.get('couponWidthMm'), 'target.couponWidthMm', positive=True)
    coupon_height_mm = finite_number(
        target.get('couponHeightMm'), 'target.couponHeightMm', positive=True)
    if (round_number(coupon_width_mm), round_number(coupon_height_mm)) != (63.5, 88.9):
        raise ValueError('V1 requires the exact 63.50 x 88.90 mm calibration coupon')
    normalized_width_px = int(raw.get('normalizedWidthPx'))
    normalized_height_px = int(raw.get('normalizedHeightPx'))
    if normalized_width_px <= 0 or normalized_height_px <= 0:
        raise ValueError('normalized dimensions must be positive integers')
    if (protected_settings.get('normalizedWidthPx') != normalized_width_px or
            protected_settings.get('normalizedHeightPx') !=
            normalized_height_px):
        raise ValueError(
            'capture manifest normalized dimensions differ from protected settings')
    manifest_operator_id = safe_identifier(raw.get('operatorId'), 'operatorId')
    manifest_finalized_at = exact_utc_timestamp(
        raw.get('finalizedAt'), 'finalizedAt')
    if (manifest_operator_id !=
            capture_package_authority['stationAuthority']['operatorId'] or
            manifest_finalized_at !=
            capture_package_authority['stationAuthority']['finalizedAt']):
        raise ValueError(
            'capture manifest operator/finalized time differs from package authority')
    cut_dimensions = target.get('cutDimensionVerification')
    if not isinstance(cut_dimensions, dict):
        raise ValueError('target.cutDimensionVerification is required')
    target_cut_dimension_samples: list[dict[str, Any]] = []
    for axis, required_nominal in (('x', 63.5), ('y', 88.9)):
        entry = cut_dimensions.get(axis)
        if not isinstance(entry, dict):
            raise ValueError(
                f'target.cutDimensionVerification.{axis} is required')
        evidence, measurement_path = verify_evidence(
            capture_package_authority, entry,
            f'target_cut_dimension_{axis}')
        if entry.get('authorityBasis') == 'protected_checkerboard_geometry':
            protected = finite_number(
                entry.get('protectedDimensionMm'),
                f'target.cutDimensionVerification.{axis}.protectedDimensionMm',
                positive=True)
            if (round_number(protected) != required_nominal or
                    entry.get('measurementMethod') != TARGET_AUTHORITY_METHOD or
                    entry.get('sourceTargetEvidenceId') != target.get('evidenceId') or
                    entry.get('sourceTargetSha256') != target.get('sha256')):
                raise ValueError(
                    f'V1 {axis.upper()} cut authority does not match the exact protected checkerboard target')
            verify_measurement_artifact(measurement_path, {
                'schemaVersion':
                    'ten-kings-calibration-target-cut-dimension-authority-v1',
                'axis': axis,
                'protectedDimensionMm': round_number(protected),
                'authorityBasis': 'protected_checkerboard_geometry',
                'sourceTargetEvidenceId': target.get('evidenceId'),
                'sourceTargetSha256': target.get('sha256'),
            }, f'{axis.upper()} protected target cut authority', entry,
                capture_package_authority['subject'])
            target_cut_dimension_samples.append({
                **evidence,
                'axis': axis,
                'authorityBasis': 'protected_checkerboard_geometry',
                'protectedDimensionMm': round_number(protected),
                'targetVersion': target.get('version'),
                'targetSha256': target.get('sha256'),
            })
        else:
            if (isinstance(entry.get('instrument'), dict) and
                    entry['instrument'].get('kind') ==
                    'protected_target_geometry'):
                raise ValueError(
                    'protected target geometry must use nominal target-cut authority')
            nominal = finite_number(
                entry.get('nominalDimensionMm'),
                f'target.cutDimensionVerification.{axis}.nominalDimensionMm',
                positive=True)
            measured = finite_number(
                entry.get('measuredDimensionMm'),
                f'target.cutDimensionVerification.{axis}.measuredDimensionMm',
                positive=True)
            measurement_u95 = finite_number(
                entry.get('measurementU95Mm'),
                f'target.cutDimensionVerification.{axis}.measurementU95Mm',
                positive=True)
            if round_number(nominal) != required_nominal:
                raise ValueError(
                    f'V1 {axis.upper()} cut dimension must use the '
                    f'{required_nominal:.2f} mm nominal target dimension')
            verify_measurement_artifact(measurement_path, {
                'schemaVersion':
                    'ten-kings-calibration-target-cut-dimension-measurement-v1',
                'axis': axis,
                'nominalDimensionMm': round_number(nominal),
                'measuredDimensionMm': round_number(measured),
                'measurementU95Mm': round_number(measurement_u95),
            }, f'{axis.upper()} target cut-dimension measurement', entry,
                capture_package_authority['subject'])
            target_cut_dimension_samples.append({
                **evidence,
                'axis': axis,
                'nominalDimensionMm': round_number(nominal),
                'measuredDimensionMm': round_number(measured),
                'measurementU95Mm': round_number(measurement_u95),
            })
    print_scale = target.get('printScaleVerification')
    if not isinstance(print_scale, dict):
        raise ValueError('target.printScaleVerification is required')
    target_print_scale_samples: list[dict[str, Any]] = []
    actual_cell_mm: dict[str, float] = {}
    cell_u95_mm: dict[str, float] = {}
    for axis, required_nominal in (('x', 100.0), ('y', 200.0)):
        entry = print_scale.get(axis)
        if not isinstance(entry, dict):
            raise ValueError(f'target.printScaleVerification.{axis} is required')
        evidence, measurement_path = verify_evidence(
            capture_package_authority, entry,
            f'print_scale_verification_{axis}')
        if entry.get('authorityBasis') == 'protected_checkerboard_geometry':
            protected = finite_number(
                entry.get('protectedSpanMm'),
                f'target.printScaleVerification.{axis}.protectedSpanMm',
                positive=True)
            if (round_number(protected) != required_nominal or
                    entry.get('measurementMethod') != TARGET_AUTHORITY_METHOD or
                    entry.get('sourceTargetEvidenceId') != target.get('evidenceId') or
                    entry.get('sourceTargetSha256') != target.get('sha256')):
                raise ValueError(
                    f'V1 {axis.upper()} print-scale authority does not match the exact protected checkerboard target')
            verify_measurement_artifact(measurement_path, {
                'schemaVersion':
                    'ten-kings-calibration-print-scale-authority-v1',
                'axis': axis,
                'protectedSpanMm': round_number(protected),
                'authorityBasis': 'protected_checkerboard_geometry',
                'sourceTargetEvidenceId': target.get('evidenceId'),
                'sourceTargetSha256': target.get('sha256'),
            }, f'{axis.upper()} protected target print-scale authority', entry,
                capture_package_authority['subject'])
            target_print_scale_samples.append({
                **evidence,
                'axis': axis,
                'authorityBasis': 'protected_checkerboard_geometry',
                'protectedSpanMm': round_number(protected),
                'targetVersion': target.get('version'),
                'targetSha256': target.get('sha256'),
            })
            actual_cell_mm[axis] = cell_mm
        else:
            if (isinstance(entry.get('instrument'), dict) and
                    entry['instrument'].get('kind') ==
                    'protected_target_geometry'):
                raise ValueError(
                    'protected target geometry must use nominal print-scale authority')
            nominal = finite_number(
                entry.get('nominalSpanMm'),
                f'target.printScaleVerification.{axis}.nominalSpanMm', positive=True)
            measured = finite_number(
                entry.get('measuredSpanMm'),
                f'target.printScaleVerification.{axis}.measuredSpanMm', positive=True)
            measurement_u95 = finite_number(
                entry.get('measurementU95Mm'),
                f'target.printScaleVerification.{axis}.measurementU95Mm')
            if measurement_u95 <= 0:
                raise ValueError('print-scale measurement U95 must be positive')
            if round_number(nominal) != required_nominal:
                raise ValueError(
                    f'V1 {axis.upper()} print-scale verification must use the '
                    f'{required_nominal:.2f} mm bar')
            verify_measurement_artifact(measurement_path, {
                'schemaVersion':
                    'ten-kings-calibration-print-scale-measurement-v1',
                'axis': axis,
                'nominalSpanMm': round_number(nominal),
                'measuredSpanMm': round_number(measured),
                'measurementU95Mm': round_number(measurement_u95),
            }, f'{axis.upper()} print-scale measurement', entry,
                capture_package_authority['subject'])
            target_print_scale_samples.append({
                **evidence,
                'axis': axis,
                'nominalSpanMm': round_number(nominal),
                'measuredSpanMm': round_number(measured),
                'measurementU95Mm': round_number(measurement_u95),
            })
            actual_cell_mm[axis] = cell_mm * measured / nominal
            cell_u95_mm[axis] = cell_mm * measurement_u95 / nominal
    protected_target_authority = all(
        sample.get('authorityBasis') == 'protected_checkerboard_geometry'
        for sample in target_print_scale_samples)
    if protected_target_authority != any(
            sample.get('authorityBasis') == 'protected_checkerboard_geometry'
            for sample in target_print_scale_samples):
        raise ValueError('print-scale authority cannot mix protected and measured sources')
    protected_cut_authority = all(
        sample.get('authorityBasis') == 'protected_checkerboard_geometry'
        for sample in target_cut_dimension_samples)
    if protected_cut_authority != any(
            sample.get('authorityBasis') == 'protected_checkerboard_geometry'
            for sample in target_cut_dimension_samples):
        raise ValueError('target-cut authority cannot mix protected and measured sources')
    if protected_target_authority != protected_cut_authority:
        raise ValueError('target geometry authority must use one consistent source contract')
    calibration_object_grid = object_grid.copy()
    calibration_object_grid[:, 0] *= actual_cell_mm['x'] / cell_mm
    calibration_object_grid[:, 1] *= actual_cell_mm['y'] / cell_mm
    board_width_mm = (columns + 1) * actual_cell_mm['x']
    board_height_mm = (rows + 1) * actual_cell_mm['y']
    first_internal_corner_mm = (
        (coupon_width_mm - board_width_mm) / 2 + actual_cell_mm['x'],
        (coupon_height_mm - board_height_mm) / 2 + actual_cell_mm['y'],
    )
    target_grid = calibration_object_grid[:, :2].copy()
    target_grid[:, 0] += first_internal_corner_mm[0]
    target_grid[:, 1] += first_internal_corner_mm[1]
    target_grid[:, 0] *= normalized_width_px / coupon_width_mm
    target_grid[:, 1] *= normalized_height_px / coupon_height_mm
    geometry = load_views(capture_package_authority,
                          raw.get('geometryViews', []),
                          'lens_geometry', columns, rows)
    normalization = load_views(
        capture_package_authority, raw.get('normalizationViews', []),
        'normalization_registration', columns, rows)
    placement = load_views(capture_package_authority,
                           raw.get('placementViews', []),
                           'repeated_placement', columns, rows)
    if len(geometry) < 10 or len(normalization) < 10 or len(placement) < 10:
        raise ValueError('geometry, normalization, and placement each require at least 10 views')
    recomputed_repeatability = (
        compute_checkerboard_repeatability_measurements(
            placement, columns, rows))
    if protected_target_authority:
        checkerboard_linear_u95_mm = (
            capture_package_authority['evidenceDerivedAuthority'][
                'uncertaintyCoverageFactor'] * sample_standard_deviation(
                    recomputed_repeatability['linear_mm']))
        if not math.isfinite(checkerboard_linear_u95_mm) or checkerboard_linear_u95_mm <= 0:
            raise ValueError(
                'protected checkerboard scale uncertainty requires positive repeatability U95')
        cell_u95_mm['x'] = checkerboard_linear_u95_mm
        cell_u95_mm['y'] = checkerboard_linear_u95_mm
    shapes = {view['shape'] for view in geometry + normalization + placement}
    if len(shapes) != 1:
        raise ValueError('every calibration image must share exact source dimensions')
    image_height, image_width = next(iter(shapes))
    object_sets = [calibration_object_grid for _ in geometry]
    image_sets = [view['points'].reshape(-1, 1, 2) for view in geometry]
    cv2.setRNGSeed(0)
    rms, matrix, distortion, rvecs, tvecs = cv2.calibrateCamera(
        object_sets, image_sets, (image_width, image_height), None, None,
        flags=cv2.CALIB_FIX_K3,
    )
    if (not math.isfinite(float(rms)) or not np.isfinite(matrix).all() or
            not np.isfinite(distortion).all()):
        raise ValueError('lens calibration produced non-finite parameters')

    lens_samples: list[dict[str, Any]] = []
    per_view_errors: list[float] = []
    geometry_source_poses: list[dict[str, float]] = []
    for index, view in enumerate(geometry):
        residual = rms_reprojection(
            calibration_object_grid, view['points'], rvecs[index], tvecs[index],
            matrix, distortion)
        per_view_errors.append(residual)
        lens_samples.append({
            **view['evidence'],
            'residualPx': round_number(residual),
        })
        corrected = undistort_points(view['points'], matrix, distortion)
        geometry_outer_contour, _geometry_boundary_residual = (
            detect_outer_coupon(
                view['path'], corrected, calibration_object_grid,
                matrix, distortion, coupon_width_mm, coupon_height_mm,
                first_internal_corner_mm, normalized_width_px,
                normalized_height_px))
        geometry_source_poses.append(measured_source_pose(
            geometry_outer_contour, image_width, image_height))

    normalization_samples: list[dict[str, Any]] = []
    scale_samples: list[dict[str, Any]] = []
    normalization_source_poses: list[dict[str, float]] = []
    canonical_outer_contour = np.float32([
        [0, 0],
        [normalized_width_px, 0],
        [normalized_width_px, normalized_height_px],
        [0, normalized_height_px],
    ])
    for view in normalization:
        corrected = undistort_points(view['points'], matrix, distortion)
        outer_contour, _boundary_residual = detect_outer_coupon(
            view['path'], corrected, calibration_object_grid,
            matrix, distortion, coupon_width_mm, coupon_height_mm,
            first_internal_corner_mm, normalized_width_px,
            normalized_height_px)
        normalization_source_poses.append(measured_source_pose(
            outer_contour, image_width, image_height))
        normalization_transform = cv2.getPerspectiveTransform(
            outer_contour.astype(np.float32), canonical_outer_contour)
        normalized_points = perspective_points(
            corrected, normalization_transform)
        difference = normalized_points - target_grid
        normalization_residual = float(np.sqrt(np.mean(
            np.sum(difference * difference, axis=1))))
        x_span, y_span = median_grid_spans(
            normalized_points, columns, rows)
        normalization_samples.append({
            **view['evidence'],
            'residualPx': round_number(normalization_residual),
        })
        scale_samples.extend(({
            **view['evidence'], 'axis': 'x',
            'physicalSpanMm': round_number(actual_cell_mm['x']),
            'physicalSpanU95Mm': round_number(cell_u95_mm['x']),
            'pixelSpan': round_number(x_span),
        }, {
            **view['evidence'], 'axis': 'y',
            'physicalSpanMm': round_number(actual_cell_mm['y']),
            'physicalSpanU95Mm': round_number(cell_u95_mm['y']),
            'pixelSpan': round_number(y_span),
        }))

    pose_policy = capture_package_authority[
        'captureEvidenceAcceptance']['poseDiversity']
    minimum_pose_coverage = float(
        pose_policy['minimumDetectedTargetCoverageFractionPerView'])
    capture_pose_audit = {
        'geometry': enforce_pose_diversity(
            'geometry', geometry_source_poses, pose_policy['geometry'],
            minimum_pose_coverage),
        'normalization': enforce_pose_diversity(
            'normalization', normalization_source_poses,
            pose_policy['normalization'], minimum_pose_coverage),
    }

    placement_authority_records = []
    for entry in raw.get('placementViews', []):
        declared = capture_package_authority['artifactsById'][
            safe_identifier(entry.get('evidenceId'),
                            'placement evidenceId')]
        cycle_id = safe_identifier(
            declared.get('removeReseatCycleId'),
            'repeated-placement removeReseatCycleId')
        placement_authority_records.append({
            'operationId': declared['operationId'],
            'capturedAt': declared['capturedAt'],
            'sha256': declared['sha256'],
            'removeReseatCycleId': cycle_id,
        })
    for field in ('operationId', 'capturedAt', 'sha256',
                  'removeReseatCycleId'):
        if len({record[field] for record in placement_authority_records}) != len(
                placement_authority_records):
            raise ValueError(
                f'repeated-placement {field} must be unique for every remove/reseat cycle')

    x_mm_per_pixel = np.mean([
        sample['physicalSpanMm'] / sample['pixelSpan']
        for sample in scale_samples if sample['axis'] == 'x'])
    y_mm_per_pixel = np.mean([
        sample['physicalSpanMm'] / sample['pixelSpan']
        for sample in scale_samples if sample['axis'] == 'y'])
    placement_contours: list[np.ndarray] = []
    placement_boundary_residuals: list[float] = []
    for view in placement:
        corrected = undistort_points(view['points'], matrix, distortion)
        outer_contour, boundary_residual = detect_outer_coupon(
            view['path'], corrected, calibration_object_grid,
            matrix, distortion, coupon_width_mm, coupon_height_mm,
            first_internal_corner_mm, normalized_width_px,
            normalized_height_px)
        placement_contours.append(outer_contour)
        placement_boundary_residuals.append(boundary_residual)
    fixed_holdout_transform = cv2.getPerspectiveTransform(
        placement_contours[0].astype(np.float32), canonical_outer_contour)
    heldout_contours = [
        perspective_points(contour, fixed_holdout_transform)
        for contour in placement_contours
    ]
    placement_centers = [
        contour.mean(axis=0) for contour in heldout_contours
    ]
    center_mean = np.mean(placement_centers, axis=0)
    placement_samples: list[dict[str, Any]] = []
    boundary_samples: list[dict[str, Any]] = []
    for view, center, boundary_residual in zip(
            placement, placement_centers, placement_boundary_residuals):
        placement_samples.append({
            **view['evidence'],
            'displacementXMm': round_number(
                (center[0] - center_mean[0]) * x_mm_per_pixel),
            'displacementYMm': round_number(
                (center[1] - center_mean[1]) * y_mm_per_pixel),
        })
        boundary_samples.append({
            **view['evidence'],
            'outerContourFitResidualPx': round_number(boundary_residual),
        })

    output_dir.mkdir(parents=True, exist_ok=True)
    channels: list[dict[str, Any]] = []
    channel_artifacts: list[dict[str, Any]] = []
    pattern_responses: list[tuple[int, np.ndarray, list[dict[str, str]]]] = []
    seen_channels: set[int] = set()
    for channel_entry in raw.get('flatFieldChannels', []):
        channel, artifact, pattern_response, pattern_records = analyze_flat_field_channel(
            capture_package_authority, channel_entry, output_dir,
            coupon_width_mm, coupon_height_mm,
            recomputed_repeatability['linear_mm'])
        if channel['channelIndex'] in seen_channels:
            raise ValueError('flatFieldChannels must have unique channelIndex values')
        seen_channels.add(channel['channelIndex'])
        channels.append(channel)
        channel_artifacts.append(artifact)
        pattern_responses.append(
            (channel['channelIndex'], pattern_response, pattern_records))
    if seen_channels != set(range(1, 9)):
        raise ValueError('flatFieldChannels must contain exact channels 1 through 8')
    pattern_responses.sort(key=lambda value: value[0])
    pattern_stack = np.stack([entry[1] for entry in pattern_responses], axis=0)
    common_mode = np.median(pattern_stack, axis=0)
    directional_residuals = pattern_stack - common_mode
    pattern_without_hash = {
        'schemaVersion': 'ten-kings-illumination-pattern-artifact-v1',
        'algorithmVersion': ALGORITHM,
        'hashPolicy': 'sha256-canonical-json-with-artifactSha256-omitted',
        'coordinateFrame': 'normalized_card_portrait_pixels',
        'grid': {
            'width': int(common_mode.shape[1]),
            'height': int(common_mode.shape[0]),
        },
        'channels': [{
            'channelIndex': channel_index,
            'sourceEvidence': pattern_records,
            'expectedDirectionalResidual': [
                round_number(value)
                for value in directional_residuals[index].reshape(-1)
            ],
        } for index, (
            channel_index, _response, pattern_records,
        ) in enumerate(pattern_responses)],
    }
    pattern_content_hash = sha256_bytes(canonical_bytes(pattern_without_hash))
    pattern_artifact = {
        **pattern_without_hash,
        'artifactSha256': pattern_content_hash,
    }
    pattern_file_name = 'illumination-pattern-v1.json'
    pattern_file_path = output_dir / pattern_file_name
    write_json(pattern_file_path, pattern_artifact)
    pattern_file_hash = sha256_bytes(pattern_file_path.read_bytes())
    pattern_by_channel = {
        entry['channelIndex']: entry for entry in pattern_without_hash['channels']
    }
    for channel in channels:
        pattern_channel = pattern_by_channel[channel['channelIndex']]
        channel['illuminationPatternArtifactId'] = 'illumination-pattern-v1'
        channel['illuminationPatternArtifactSha256'] = pattern_file_hash
        channel['illuminationPatternFrames'] = pattern_channel['sourceEvidence']
        channel['expectedDirectionalResidual'] = (
            pattern_channel['expectedDirectionalResidual'])
        channel['illuminationPatternGridWidth'] = int(common_mode.shape[1])
        channel['illuminationPatternGridHeight'] = int(common_mode.shape[0])

    target_reference, _target_path = verify_evidence(
        capture_package_authority, target,
        'print_verified_calibration_target')
    target_hash = target_reference['sha256']
    target_version = safe_identifier(target.get('version'), 'target.version')
    if (capture_package_authority['subject']['targetVersion'] !=
            target_version or
            capture_package_authority['subject']['targetSha256'] !=
            target_hash):
        raise ValueError(
            'source capture-package calibration-target identity mismatch')
    target_evidence = [target_reference]
    measurement_repeatability_samples: list[dict[str, Any]] = []
    allowed_measurement_classes = {
        'linear_mm', 'area_mm2', 'relief_index', 'roughness_index',
        'color_delta_e',
    }
    for entry in raw.get('measurementRepeatabilitySamples', []):
        evidence, measurement_path = verify_evidence(
            capture_package_authority, entry, 'measurement_repeatability')
        measurement_class = str(entry.get('measurementClass', ''))
        if measurement_class not in allowed_measurement_classes:
            raise ValueError('unsupported measurement repeatability class')
        measured_value = finite_number(
            entry.get('measuredValue'),
            f'{measurement_class}.measuredValue')
        if measured_value < 0:
            raise ValueError('repeatability measuredValue must be nonnegative')
        reference_feature_id = safe_identifier(
            entry.get('referenceFeatureId'), 'referenceFeatureId')
        sample_index = entry.get('sampleIndex')
        if (isinstance(sample_index, bool) or
                not isinstance(sample_index, int) or
                sample_index < 1 or sample_index > 10):
            raise ValueError(
                'repeatability sampleIndex must be an integer from 1 to 10')
        expected_feature_id = (
            f'checkerboard-repeatability-{measurement_class}-v1')
        if reference_feature_id != expected_feature_id:
            raise ValueError(
                f'repeatability referenceFeatureId must be {expected_feature_id}')
        source_capture_operation_id = safe_identifier(
            entry.get('sourceCaptureOperationId'),
            'repeatability sourceCaptureOperationId')
        source_evidence_id = safe_identifier(
            entry.get('sourceEvidenceId'),
            'repeatability sourceEvidenceId')
        source_sha256 = exact_sha256(
            entry.get('sourceSha256'), 'repeatability sourceSha256')
        provenance = require_measurement_provenance(
            entry, f'{measurement_class} repeatability measurement')
        expected_analyzer_source_sha256 = sha256_bytes(
            Path(__file__).resolve().read_bytes())
        if provenance['instrument'] != {
                'instrumentId': REPEATABILITY_INSTRUMENT_ID,
                'kind': 'fixed_rig_geometry',
                'calibrationVersion': REPEATABILITY_ALGORITHM,
                'calibrationSha256': expected_analyzer_source_sha256,
        }:
            raise ValueError(
                'repeatability instrument must bind the exact pinned analyzer source')
        if (entry.get('sourceRole') != 'repeated_placement' or
                entry.get('measurementAlgorithmVersion') !=
                REPEATABILITY_ALGORITHM or
                entry.get('fixedRoiDefinition') !=
                'registered_checkerboard_center_cell_and_grid_spacing_v1' or
                entry.get('measurementMethod') !=
                'fixed_reference_repeatability_v1'):
            raise ValueError(
                'repeatability source/algorithm/fixed-ROI contract mismatch')
        placement_entry = raw.get('placementViews', [])[sample_index - 1]
        placement_evidence_id = safe_identifier(
            placement_entry.get('evidenceId'),
            'placement source evidenceId')
        placement_declared = capture_package_authority['artifactsById'][
            placement_evidence_id]
        if (source_capture_operation_id !=
                placement_declared['operationId'] or
                source_evidence_id != placement_evidence_id or
                source_sha256 != placement_declared['sha256']):
            raise ValueError(
                'repeatability measurement is not bound to its exact immutable source capture')
        recomputed_value = recomputed_repeatability[
            measurement_class][sample_index - 1]
        if round_number(measured_value) != recomputed_value:
            raise ValueError(
                'repeatability measuredValue does not match deterministic '
                'recomputation from immutable capture evidence')
        verify_measurement_artifact(measurement_path, {
            'schemaVersion':
                'ten-kings-calibration-repeatability-measurement-v1',
            'measurementClass': measurement_class,
            'sampleIndex': sample_index,
            'referenceFeatureId': reference_feature_id,
            'measuredValue': recomputed_value,
            'sourceCaptureOperationId': source_capture_operation_id,
            'sourceEvidenceId': source_evidence_id,
            'sourceSha256': source_sha256,
            'sourceRole': 'repeated_placement',
            'measurementAlgorithmVersion':
                'opencv_checkerboard_repeatability_measurement_v1',
            'fixedRoiDefinition':
                'registered_checkerboard_center_cell_and_grid_spacing_v1',
        }, f'{measurement_class} repeatability measurement', entry,
            capture_package_authority['subject'])
        measurement_repeatability_samples.append({
            **evidence,
            'measurementClass': measurement_class,
            'sampleIndex': sample_index,
            'referenceFeatureId': reference_feature_id,
            'measuredValue': recomputed_value,
            'sourceEvidenceId': source_evidence_id,
            'sourceSha256': source_sha256,
            'measurementAlgorithmVersion':
                'opencv_checkerboard_repeatability_measurement_v1',
        })
    finalized_at = manifest_finalized_at
    builder_input = {
        'profileId': safe_identifier(raw.get('profileId'), 'profileId'),
        'calibrationVersion': safe_identifier(
            raw.get('calibrationVersion'), 'calibrationVersion'),
        'rigId': rig_id,
        'artifactId': safe_identifier(raw.get('artifactId'), 'artifactId'),
        'finalizedAt': finalized_at,
        'normalizedWidthPx': normalized_width_px,
        'normalizedHeightPx': normalized_height_px,
        'scaleSamples': scale_samples,
        'targetPrintScaleSamples': target_print_scale_samples,
        'targetCutDimensionSamples': target_cut_dimension_samples,
        'lensResidualSamples': lens_samples,
        'normalizationResidualSamples': normalization_samples,
        'repeatedPlacementSamples': placement_samples,
        'segmentationBoundarySamples': boundary_samples,
        'measurementRepeatabilitySamples':
            measurement_repeatability_samples,
        'channels': sorted(channels, key=lambda value: value['channelIndex']),
        'targetEvidence': target_evidence,
        'operatorId': manifest_operator_id,
        'targetVersion': target_version,
        'targetSha256': target_hash,
        'lensModel': {
            'model': 'opencv_brown_conrady_v1',
            'sourceWidthPx': image_width,
            'sourceHeightPx': image_height,
            'cameraMatrix': [round_number(value)
                             for value in matrix.reshape(-1).tolist()],
            'distortionCoefficients': [
                round_number(value) for value in distortion.reshape(-1).tolist()
            ],
            'calibrationRmsPx': round_number(float(rms)),
            'perViewResidualPx': [
                round_number(value) for value in per_view_errors
            ],
        },
        'normalizationModel': {
            'model':
                'undistort_outer_cut_homography_with_fixed_holdout_repeatability_v1',
            'sampleResidualPx': [
                sample['residualPx'] for sample in normalization_samples
            ],
        },
    }
    analysis_payload = {
        'schemaVersion': ANALYSIS_SCHEMA,
        'algorithmVersion': ALGORITHM,
        'sourceManifestSha256': sha256_bytes(manifest_path.read_bytes()),
        'sourceCapturePackage': {
            key: value for key, value in capture_package_authority.items()
            if key != 'artifactsById'
        },
        'captureEvidenceAudit': {
            'poseDiversity': capture_pose_audit,
            'repeatedPlacementAuthority': {
                'cycleCount': len(placement_authority_records),
                'uniqueOperationIds': True,
                'uniqueCaptureTimestamps': True,
                'uniqueSourceHashes': True,
                'uniqueRemoveReseatCycleIds': True,
                'records': placement_authority_records,
            },
        },
        'builderInput': builder_input,
        'flatFieldArtifacts': channel_artifacts,
        'illuminationPatternArtifact': {
            'artifactFileName': pattern_file_name,
            'artifactFileSha256': pattern_file_hash,
            'contentSha256': pattern_content_hash,
        },
    }
    analysis_payload_json = canonical_bytes(analysis_payload).decode('utf-8')
    analysis_hash = sha256_bytes(analysis_payload_json.encode('utf-8'))
    result = {
        **analysis_payload,
        'hashPolicy': 'sha256-exact-utf8-analysisPayloadJson',
        'analysisPayloadJson': analysis_payload_json,
        'analysisSha256': analysis_hash,
    }
    write_json(output_dir / 'mathematical-calibration-analysis-v1.json',
               result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Analyze immutable Mathematical Calibration V1 captures.')
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    arguments = parser.parse_args()
    result = analyze(arguments.manifest.resolve(),
                     arguments.output_dir.resolve())
    print(json.dumps({
        'schemaVersion': result['schemaVersion'],
        'analysisSha256': result['analysisSha256'],
        'sourceManifestSha256': result['sourceManifestSha256'],
        'output': 'mathematical-calibration-analysis-v1.json',
    }, sort_keys=True))


if __name__ == '__main__':
    main()
