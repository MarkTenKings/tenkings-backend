import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FixedRigApprovedDesignReferencePixelsV1 } from './fixedRigDesignReferenceV1';
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  type AiGraderCalibrationActivationAuthorityV1,
  type MathematicalGradingElementV1,
  type TrustedPokemonCardFormatAuthorityV1,
} from '@tenkings/shared';
import {
  buildFixedRigMathematicalCalibrationReportPackageV1,
  FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
  type BuildFixedRigMathematicalCalibrationOrchestratorV1Result,
  type FixedRigExactReportEvidenceFileV1,
  type FixedRigMathematicalCardIdentityV1,
  type FixedRigMathematicalCalibrationSideInputV1,
  type FixedRigMathematicalFindingReviewV1,
  type FixedRigMathematicalOrchestrationStageV1,
} from './fixedRigMathematicalCalibrationOrchestratorV1';
import type {
  FixedRigOperatorResolutionAuthorityV1,
  FixedRigOperatorResolutionNativeRoleV1,
} from './fixedRigOperatorResolutionAuthorityV1';
import {
  buildFixedRigStandardTradingCardBoundaryV1,
  FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID,
} from './fixedRigStandardCardFormatV1';
import { loadFixedRigMathematicalCalibrationBundleV1 } from './fixedRigMathematicalCalibrationBundleV1';
import type { FastCalibrationRuntimeContextV1_2 } from './fixedRigFastMathematicalCalibrationV1_2';
import { buildFixedRigAutomaticDesignRegistrationV1 } from './fixedRigAutomaticDesignRegistrationV1';
import {
  verifyCardGeometryNormalizedDenseContourV1,
  verifyCardGeometryObservedDenseContourV1,
  verifyCardGeometryRawToNormalizedTransformV1,
  type CardGeometryNormalizedDenseContourV1,
  type CardGeometryObservedDenseContourV1,
  type CardGeometryRawToNormalizedTransformV1,
} from './cardGeometry';
import {
  buildFixedRigPokemonTcgStandardBoundaryV1,
  FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID,
  verifyTrustedPokemonCardFormatAuthorityV1,
} from './fixedRigPokemonStandardCornerProfileV1';

export const FIXED_RIG_MATHEMATICAL_STATION_ADAPTER_V1_VERSION =
  'fixed_rig_mathematical_station_adapter_v1' as const;
export const FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION =
  'fixed_rig_mathematical_station_grading_authority_v1' as const;

export type FixedRigMathematicalStationCenteringAuthorityV1 =
  | {
      profile: 'printed_border_v1';
    }
  | {
      profile: 'registered_design_template_v1';
      approvedReference: FixedRigApprovedDesignReferencePixelsV1;
      /** Exact bridge-private staged file produced by the bounded authenticated upload route. */
      approvedDesignArtifact: FixedRigExactReportEvidenceFileV1;
    };

type FixedRigMathematicalStationGradingAuthorityBaseV1 = {
  schemaVersion: typeof FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION;
  cardIdentity: FixedRigMathematicalCardIdentityV1;
  sides: {
    front: { centering: FixedRigMathematicalStationCenteringAuthorityV1 };
    back: { centering: FixedRigMathematicalStationCenteringAuthorityV1 };
  };
  publication: {
    certId: string;
    publicReportUrl: string;
    qrPayloadUrl: string;
  };
};

export type FixedRigMathematicalStationGradingAuthorityV1 =
  | FixedRigMathematicalStationGradingAuthorityBaseV1 & {
      cardFormatId: typeof FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID;
    }
  | FixedRigMathematicalStationGradingAuthorityBaseV1 & {
      cardFormatId: typeof FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID;
      trustedCardFormatAuthority: TrustedPokemonCardFormatAuthorityV1;
    };

export interface BuildFixedRigMathematicalCalibrationStationPackageV1Input {
  authority: FixedRigMathematicalStationGradingAuthorityV1;
  gradingSessionId: string;
  generatedAt: string;
  reportId: string;
  outputDir: string;
  captureProfileVersion: string;
  calibration: {
    bundlePath: string;
    bundleSha256: string;
    expectedRigId: string;
    expectedRuntimeContext?: FastCalibrationRuntimeContextV1_2;
    activationAuthority?: AiGraderCalibrationActivationAuthorityV1;
  };
  warmSides: {
    front: { manifestPath: string; manifestSha256: string };
    back: { manifestPath: string; manifestSha256: string };
  };
  findingReviews?: FixedRigMathematicalFindingReviewV1[];
  queueItemId: string;
  operatorResolutionAuthorities?: FixedRigOperatorResolutionAuthorityV1[];
  forcedOperatorReviewElements?: MathematicalGradingElementV1[];
  cardFormatAuthorityVerification?: {
    hmacKey: string;
    keyId: string;
  };
}

export type BuildFixedRigMathematicalCalibrationStationPackageV1Result =
  BuildFixedRigMathematicalCalibrationOrchestratorV1Result;

type Side = 'front' | 'back';
type JsonObject = Record<string, unknown>;

interface ParsedWarmSideV1 {
  rawAllOn: FixedRigExactReportEvidenceFileV1;
  rawGeometryAuthority: FixedRigExactReportEvidenceFileV1;
  geometryAuthorityRole: "all_on";
  normalizedAllOn: FixedRigExactReportEvidenceFileV1;
  normalizedCard: FixedRigExactReportEvidenceFileV1;
  photometricExposureBracket: NonNullable<
    FixedRigMathematicalCalibrationSideInputV1['photometricExposureBracket']
  >;
  rawToNormalizedTransform: FixedRigMathematicalCalibrationSideInputV1['rawToNormalizedTransform'];
  observedOuterContour: FixedRigMathematicalCalibrationSideInputV1['observedOuterContour'];
  normalizedCardBytes: Buffer;
  geometry: Record<string, unknown>;
  geometryCaptureDecisions: Record<string, unknown>;
  captureTiming: Record<string, unknown>;
  warmManifestSha256: string;
  nativeCaptureRoles: FixedRigOperatorResolutionNativeRoleV1[];
}

function adapterInsufficient(
  stage: FixedRigMathematicalOrchestrationStageV1,
  reasons: string[],
  flags: {
    requiresRecapture?: boolean;
    requiresApprovedDesignReference?: boolean;
    requiresCalibration?: boolean;
    requiresImplementationCorrection?: boolean;
  } = {},
): BuildFixedRigMathematicalCalibrationStationPackageV1Result {
  return {
    version: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
    status: 'insufficient_evidence',
    gradingContract: 'mathematical_calibration_v1',
    v0FallbackUsed: false,
    failedStage: stage,
    reasons: [...new Set(reasons)],
    requiresRecapture: flags.requiresRecapture ?? false,
    requiresApprovedDesignReference: flags.requiresApprovedDesignReference ?? false,
    requiresCalibration: flags.requiresCalibration ?? false,
    requiresImplementationCorrection: flags.requiresImplementationCorrection ?? false,
    reportPackage: null,
    stationInput: null,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object.');
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' must be non-empty.');
  return value;
}

function exactNativeCaptureRole(
  value: unknown,
  expected: string,
  label: string,
): string {
  const role = string(value, label);
  if (role !== expected) throw new Error(label + ' must equal ' + expected + '.');
  return role;
}

function exactSha(value: unknown, label: string): string {
  const result = string(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(label + ' must be an exact SHA-256.');
  return result;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(label + ' must be an array.');
  return value;
}

function exactNumber(value: unknown, expected: number, label: string): number {
  if (typeof value !== 'number' || value !== expected) {
    throw new Error(label + ' must equal ' + expected + '.');
  }
  return value;
}

function fixedRigLeimacUnitOneRequestFrameV1(
  commandNumber: '11' | '85' | '86',
  values: readonly string[],
): string {
  if (
    values.length !== 8 ||
    values.some((value) => !/^\d{4}$/.test(value))
  ) {
    throw new Error('Fixed-rig Leimac request frames require eight exact four-digit values.');
  }
  return `W${commandNumber}01${values
    .map((value, index) => String(index + 1).padStart(2, '0') + value)
    .join('')}`;
}

const FIXED_RIG_LEIMAC_SAFE_OFF_REQUEST_FRAMES_V1 = [
  fixedRigLeimacUnitOneRequestFrameV1('86', Array(8).fill('0000')),
  fixedRigLeimacUnitOneRequestFrameV1('85', Array(8).fill('0000')),
  fixedRigLeimacUnitOneRequestFrameV1('11', Array(8).fill('0000')),
] as const;

export function assertFixedRigExactLeimacWritesV1(
  value: unknown,
  expectedRequestFrames: readonly string[],
  label: string,
): void {
  const writes = array(value, label);
  if (writes.length !== expectedRequestFrames.length || writes.some((entry, index) => {
    const write = object(entry, label + ' write');
    const frame = object(write.frame, label + ' write frame');
    const expectedRequestFrame = expectedRequestFrames[index]!;
    const commandNumber = expectedRequestFrame.slice(1, 3);
    const expectedAck = `W${commandNumber}ACK0`;
    return write.ok !== true ||
      write.responseKind !== 'ack' ||
      write.attempt !== 1 ||
      write.automaticRetryCount !== 0 ||
      write.expectedAck !== expectedAck ||
      write.normalizedResponse !== expectedAck ||
      write.exactAck !== true ||
      String(write.rawResponse ?? '').trim() !== expectedAck ||
      frame.commandNumber !== commandNumber ||
      frame.targetDesignation !== '01' ||
      frame.requestAscii !== expectedRequestFrame ||
      frame.requestFrame !== expectedRequestFrame;
  })) {
    throw new Error(label + ' must contain exact unit-one request frames and one-shot command ACK evidence.');
  }
}

export function assertFixedRigPhotometricBracketCaptureProvenanceV1(
  value: unknown,
  side: Side,
): void {
  const cells = array(value, side + ' bracket cells');
  if (cells.length !== 3) {
    throw new Error(side + ' exposure bracket requires exactly three cells.');
  }
  const expectedExposures = [15000, 30000, 37500];
  const rawPaths = new Set<string>();
  const normalizedPaths = new Set<string>();
  const captureTimestamps = new Set<string>();
  let authoritativeCameraSerial: string | undefined;
  let previousFinishedTicks = 0;
  let captureCount = 0;

  const validateRole = (
    roleValue: unknown,
    expectedRole: string,
    expectedExposureUs: number,
    label: string,
  ) => {
    const role = object(roleValue, label);
    if (role.role !== expectedRole) {
      throw new Error(label + ' role does not match its exact capture-plan position.');
    }
    const startedTicks = role.monotonicStartedTicks;
    const finishedTicks = role.monotonicFinishedTicks;
    if (
      typeof startedTicks !== 'number' ||
      typeof finishedTicks !== 'number' ||
      !Number.isSafeInteger(startedTicks) ||
      !Number.isSafeInteger(finishedTicks) ||
      startedTicks <= 0 ||
      finishedTicks <= startedTicks ||
      startedTicks <= previousFinishedTicks
    ) {
      throw new Error(label + ' capture window is not positive and strictly monotonic.');
    }
    previousFinishedTicks = finishedTicks;

    const capture = object(role.capture, label + ' capture');
    exactNumber(capture.exposureTime, expectedExposureUs, label + ' capture exposure');
    const camera = object(capture.camera, label + ' capture camera');
    const cameraSerial = string(camera.serialNumber, label + ' capture camera serial');
    if (!authoritativeCameraSerial) authoritativeCameraSerial = cameraSerial;
    if (cameraSerial !== authoritativeCameraSerial) {
      throw new Error(label + ' capture camera serial differs within the bracket.');
    }
    const rawPath = path.resolve(string(capture.outputFilePath, label + ' raw path')).toLowerCase();
    exactSha(capture.sha256, label + ' raw sha256');
    const captureTimestamp = string(capture.timestamp, label + ' capture timestamp');
    const normalized = object(role.normalized, label + ' normalized role');
    const artifact = object(normalized.analysisArtifact, label + ' normalized artifact');
    const normalizedPath = path.resolve(
      string(artifact.localOutputPath, label + ' normalized path'),
    ).toLowerCase();
    exactSha(artifact.sha256, label + ' normalized sha256');
    if (
      rawPaths.has(rawPath) ||
      normalizedPaths.has(normalizedPath) ||
      captureTimestamps.has(captureTimestamp)
    ) {
      throw new Error(label + ' aliases another bracket capture source or artifact.');
    }
    rawPaths.add(rawPath);
    normalizedPaths.add(normalizedPath);
    captureTimestamps.add(captureTimestamp);
    captureCount += 1;
  };

  cells.forEach((cellValue, cellIndex) => {
    const exposureUs = expectedExposures[cellIndex]!;
    const cell = object(cellValue, side + ' bracket cell');
    exactNumber(cell.exposureUs, exposureUs, side + ' bracket exposure');
    const readback = object(cell.cameraReadback, side + ' bracket camera readback');
    const cellCameraSerial = string(
      readback.cameraSerialNumber,
      side + ' bracket camera readback serial',
    );
    if (!authoritativeCameraSerial) authoritativeCameraSerial = cellCameraSerial;
    if (cellCameraSerial !== authoritativeCameraSerial) {
      throw new Error(side + ' bracket camera readback serial differs within the bracket.');
    }
    const references = array(cell.references, side + ' bracket references');
    const channels = array(cell.channels, side + ' bracket channels');
    if (references.length !== 3 || channels.length !== 8) {
      throw new Error(side + ' bracket cell requires three references and channels 1 through 8.');
    }
    references.forEach((role, index) => validateRole(
      role,
      `bracket_${exposureUs}_reference_${index + 1}`,
      exposureUs,
      `${side} bracket ${exposureUs} reference ${index + 1}`,
    ));
    channels.forEach((role, index) => validateRole(
      role,
      `bracket_${exposureUs}_channel_${index + 1}`,
      exposureUs,
      `${side} bracket ${exposureUs} channel ${index + 1}`,
    ));
  });
  if (
    captureCount !== 33 ||
    rawPaths.size !== 33 ||
    normalizedPaths.size !== 33 ||
    captureTimestamps.size !== 33
  ) {
    throw new Error(side + ' bracket must contain 33 distinct ordered capture records and paths.');
  }
}

function within(root: string, filePath: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(filePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(label + ' path escapes its immutable warm package.');
  }
  return resolved;
}

async function readExact(filePath: string, expectedSha256: string, label: string): Promise<Buffer> {
  const bytes = await readFile(filePath);
  if (sha256(bytes) !== expectedSha256.toLowerCase()) {
    throw new Error(label + ' file SHA-256 mismatch.');
  }
  return bytes;
}

function contentType(filePath: string): string {
  return path.extname(filePath).toLowerCase() === '.tiff' ||
    path.extname(filePath).toLowerCase() === '.tif' ? 'image/tiff' : 'image/png';
}

function evidenceFrom(input: {
  packageDir: string;
  artifact: JsonObject;
  pathField: 'localOutputPath' | 'outputFilePath';
  assetId: string;
  label: string;
}): FixedRigExactReportEvidenceFileV1 {
  const filePath = within(
    input.packageDir,
    string(input.artifact[input.pathField], input.label + ' path'),
    input.label,
  );
  return {
    filePath,
    sha256: exactSha(input.artifact.sha256, input.label + ' sha256'),
    assetId: input.assetId,
    fileName: path.basename(filePath),
    contentType: contentType(filePath),
  };
}

export async function rehashFixedRigPhotometricBracketRawCapturesV1(input: {
  cells: unknown;
  packageDir: string;
  side: Side;
}): Promise<FixedRigExactReportEvidenceFileV1[]> {
  const rawFiles: FixedRigExactReportEvidenceFileV1[] = [];
  const cells = array(input.cells, input.side + ' bracket cells');
  cells.forEach((cellValue, cellIndex) => {
    const cell = object(cellValue, input.side + ' bracket cell');
    const exposureUs = [15000, 30000, 37500][cellIndex]!;
    const roles = [
      ...array(cell.references, input.side + ' bracket references').map(
        (value, index) => ({
          value,
          suffix: `reference-${index + 1}`,
        }),
      ),
      ...array(cell.channels, input.side + ' bracket channels').map(
        (value, index) => ({
          value,
          suffix: `channel-${index + 1}`,
        }),
      ),
    ];
    roles.forEach(({ value, suffix }) => {
      const capture = object(
        object(value, `${input.side} bracket ${exposureUs} ${suffix}`).capture,
        `${input.side} bracket ${exposureUs} ${suffix} capture`,
      );
      rawFiles.push(evidenceFrom({
        packageDir: input.packageDir,
        artifact: capture,
        pathField: 'outputFilePath',
        assetId: `${input.side}-bracket-${exposureUs}-${suffix}-raw`,
        label: `${input.side} bracket ${exposureUs} ${suffix} raw`,
      }));
    });
  });
  if (rawFiles.length !== 33) {
    throw new Error(input.side + ' bracket must rehash exactly 33 raw capture roles.');
  }
  await Promise.all(rawFiles.map((file) =>
    readExact(file.filePath, file.sha256, input.side + ' ' + file.assetId)));
  return rawFiles;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function assertFixedRigReusedAuthoritativeTransformV1(input: {
  artifact: JsonObject;
  rawCapture: JsonObject;
  authority: CardGeometryRawToNormalizedTransformV1;
  label: string;
}): void {
  const transform = object(
    input.artifact.rawToNormalizedTransform,
    input.label + ' raw-to-normalized transform',
  ) as unknown as CardGeometryRawToNormalizedTransformV1;
  const sourceSha256 = exactSha(input.rawCapture.sha256, input.label + ' raw capture SHA-256');
  if (
    exactSha(input.artifact.sourceSha256, input.label + ' normalized source SHA-256') !==
      sourceSha256 ||
    transform.sourceSha256 !== sourceSha256 ||
    !verifyCardGeometryRawToNormalizedTransformV1(transform)
  ) {
    throw new Error(input.label + ' is not hash-bound to its exact raw capture and transform.');
  }
  const sameFixedTransform =
    transform.schemaVersion === input.authority.schemaVersion &&
    transform.sourceCoordinateFrame === input.authority.sourceCoordinateFrame &&
    transform.sourceWidthPx === input.authority.sourceWidthPx &&
    transform.sourceHeightPx === input.authority.sourceHeightPx &&
    transform.autoOrientApplied === input.authority.autoOrientApplied &&
    transform.deskewClockwiseDegrees === input.authority.deskewClockwiseDegrees &&
    transform.rotatedWidthPx === input.authority.rotatedWidthPx &&
    transform.rotatedHeightPx === input.authority.rotatedHeightPx &&
    JSON.stringify(transform.crop) === JSON.stringify(input.authority.crop) &&
    transform.outputCoordinateFrame === input.authority.outputCoordinateFrame &&
    transform.outputWidthPx === input.authority.outputWidthPx &&
    transform.outputHeightPx === input.authority.outputHeightPx &&
    JSON.stringify(transform.matrix) === JSON.stringify(input.authority.matrix);
  if (!sameFixedTransform) {
    throw new Error(input.label + ' did not reuse the one authoritative side transform.');
  }
}

export function assertFixedRigMathematicalWarmSideCaptureProfileV1(
  value: unknown,
  side: Side,
): void {
  const manifest = object(value, side + ' warm manifest');
  const captureProfilePlan = object(
    manifest.captureProfilePlan,
    side + ' warm capture profile plan',
  );
  if (
    manifest.status !== 'completed' ||
    manifest.executionPath !== 'warm_full_forensic_runner' ||
    manifest.captureProfile !== 'production_fast' ||
    manifest.evidenceSide !== side ||
    captureProfilePlan.rawEvidenceFormat !== 'tiff' ||
    captureProfilePlan.evidenceRoles !== 'full_forensic' ||
    captureProfilePlan.productionFastOptIn !== true
  ) {
    throw new Error(
      side + ' warm manifest is not one completed production-fast package with full-forensic TIFF evidence.',
    );
  }
}

export function collectFixedRigMathematicalNativeCaptureRolesV1(
  value: unknown,
  side: Side,
): FixedRigOperatorResolutionNativeRoleV1[] {
  const sideEvidence = object(value, side + ' side evidence');
  const allOn = object(sideEvidence.allOn, side + ' all-on evidence');
  const accepted = object(sideEvidence.acceptedProfile, side + ' accepted-profile evidence');
  if (
    allOn.label !== `${side}-all-on` ||
    accepted.label !== `${side}-accepted-lighting-profile`
  ) {
    throw new Error(side + ' presentation capture roles do not match their canonical side identities.');
  }
  const roles: FixedRigOperatorResolutionNativeRoleV1[] = [
    {
      captureRole: 'all_on',
      sha256: exactSha(
        object(allOn.capture, side + ' raw all-on capture').sha256,
        side + ' raw all-on capture sha256',
      ),
    },
    {
      captureRole: 'accepted_profile',
      sha256: exactSha(
        object(accepted.capture, side + ' raw accepted-profile capture').sha256,
        side + ' raw accepted-profile capture sha256',
      ),
    },
  ];
  const bracket = object(
    sideEvidence.photometricExposureBracket,
    side + ' photometric exposure bracket',
  );
  const cells = array(bracket.cells, side + ' bracket cells');
  const expectedExposures = [15000, 30000, 37500];
  if (cells.length !== expectedExposures.length) {
    throw new Error(side + ' exposure bracket requires exactly three cells.');
  }
  cells.forEach((value, cellIndex) => {
    const cell = object(value, side + ' bracket cell');
    const exposureUs = expectedExposures[cellIndex]!;
    exactNumber(cell.exposureUs, exposureUs, side + ' bracket exposure');
    const references = array(cell.references, side + ' bracket references');
    const channels = array(cell.channels, side + ' bracket channels');
    if (references.length !== 3 || channels.length !== 8) {
      throw new Error(side + ' bracket cell requires three references and channels 1 through 8.');
    }
    references.forEach((entry, index) => {
      const role = object(entry, side + ' bracket reference');
      roles.push({
        captureRole: exactNativeCaptureRole(
          role.role,
          `bracket_${exposureUs}_reference_${index + 1}`,
          side + ' bracket reference captureRole',
        ),
        sha256: exactSha(
          object(role.capture, side + ' bracket reference capture').sha256,
          side + ' bracket reference raw sha256',
        ),
      });
    });
    channels.forEach((entry, index) => {
      const role = object(entry, side + ' bracket channel');
      roles.push({
        captureRole: exactNativeCaptureRole(
          role.role,
          `bracket_${exposureUs}_channel_${index + 1}`,
          side + ' bracket channel captureRole',
        ),
        sha256: exactSha(
          object(role.capture, side + ' bracket channel capture').sha256,
          side + ' bracket channel raw sha256',
        ),
      });
    });
  });
  if (
    roles.length !== 35 ||
    new Set(roles.map((entry) => entry.captureRole)).size !== roles.length ||
    new Set(roles.map((entry) => entry.sha256)).size !== roles.length
  ) {
    throw new Error(side + ' native capture roles or hashes are missing, duplicated, or aliased.');
  }
  return roles;
}

async function parseWarmSideV1(input: {
  side: Side;
  manifestPath: string;
  manifestSha256: string;
  channelConfidences: ReadonlyMap<number, number>;
}): Promise<ParsedWarmSideV1> {
  const manifestPath = path.resolve(input.manifestPath);
  const packageDir = path.dirname(manifestPath);
  const bytes = await readExact(
    manifestPath,
    exactSha(input.manifestSha256, input.side + ' warm manifest sha256'),
    input.side + ' warm manifest',
  );
  const manifest = object(JSON.parse(bytes.toString('utf8')), input.side + ' warm manifest');
  assertFixedRigMathematicalWarmSideCaptureProfileV1(manifest, input.side);
  if (path.resolve(string(manifest.packageDir, input.side + ' packageDir')) !== packageDir) {
    throw new Error(input.side + ' warm manifest packageDir does not match its protected location.');
  }
  const rawIntegrity = object(manifest.rawEvidenceIntegrity, input.side + ' raw evidence integrity');
  if (rawIntegrity.verified !== true) {
    throw new Error(input.side + ' raw evidence integrity was not verified.');
  }
  const side = object(manifest[input.side], input.side + ' side evidence');
  const allOn = object(side.allOn, input.side + ' all-on evidence');
  const accepted = object(side.acceptedProfile, input.side + ' accepted-profile evidence');
  const nativeCaptureRoles =
    collectFixedRigMathematicalNativeCaptureRolesV1(side, input.side);
  const normalizedCard = object(side.normalizedCard, input.side + ' normalized-card evidence');
  const rawAllOn = evidenceFrom({
    packageDir,
    artifact: object(allOn.capture, input.side + ' raw all-on capture'),
    pathField: 'outputFilePath',
    assetId: input.side + '-raw-all-on',
    label: input.side + ' raw all-on',
  });
  const geometryAuthority = object(
    side.fullResolutionGeometryAuthority,
    input.side + ' full-resolution geometry authority',
  );
  const geometryAuthoritySource = object(
    geometryAuthority.source,
    input.side + ' full-resolution geometry authority source',
  );
  const geometryAuthorityRole = string(
    geometryAuthoritySource.role,
    input.side + ' geometry authority role',
  );
  if (geometryAuthorityRole !== 'all_on') {
    throw new Error(
      input.side + ' geometry authority must be the calibrated dense contour from the exact all-on captured pixels.',
    );
  }
  const rawGeometryAuthority = rawAllOn;
  if (
    geometryAuthoritySource.role !== geometryAuthorityRole ||
    exactSha(
      geometryAuthoritySource.sourceSha256,
      input.side + ' geometry authority source SHA-256',
    ) !== rawGeometryAuthority.sha256
  ) {
    throw new Error(
      input.side + ' geometry authority source identity does not match its captured pixels.',
    );
  }
  const normalizedAllOnArtifact = object(
    allOn.analysisArtifact,
    input.side + ' normalized all-on artifact',
  );
  const normalizedAllOn = evidenceFrom({
    packageDir,
    artifact: normalizedAllOnArtifact,
    pathField: 'localOutputPath',
    assetId: input.side + '-normalized-all-on',
    label: input.side + ' normalized all-on',
  });
  const acceptedArtifact = object(
    accepted.analysisArtifact,
    input.side + ' accepted-profile artifact',
  );
  const normalizedAccepted = evidenceFrom({
    packageDir,
    artifact: acceptedArtifact,
    pathField: 'localOutputPath',
    assetId: input.side + '-accepted-profile',
    label: input.side + ' accepted profile',
  });
  const normalizedCardArtifact = object(
    normalizedCard.normalizedArtifact,
    input.side + ' normalization authority artifact',
  );
  const rawToNormalizedTransform = object(
    normalizedCardArtifact.rawToNormalizedTransform,
    input.side + ' raw-to-normalized transform',
  ) as unknown as CardGeometryRawToNormalizedTransformV1;
  const authorityNormalizedArtifact =
    geometryAuthorityRole === 'all_on'
      ? normalizedAllOnArtifact
      : acceptedArtifact;
  if (
    rawToNormalizedTransform.sourceSha256 !== rawGeometryAuthority.sha256 ||
    !verifyCardGeometryRawToNormalizedTransformV1(rawToNormalizedTransform) ||
    rawToNormalizedTransform.transformSha256 !==
      (authorityNormalizedArtifact.rawToNormalizedTransform as JsonObject | undefined)?.transformSha256
  ) {
    throw new Error(input.side + ' geometry transform is not bound to its exact captured authority role.');
  }
  const geometry = recordOrEmpty(normalizedCard.geometry);
  const observedDenseContour = object(
    geometry.observedDenseContour,
    input.side + ' observed dense contour',
  ) as unknown as CardGeometryObservedDenseContourV1;
  const normalizedDenseContour = object(
    normalizedCardArtifact.normalizedDenseContour,
    input.side + ' normalized dense contour',
  ) as unknown as CardGeometryNormalizedDenseContourV1;
  if (
    observedDenseContour.sourceAssetSha256 !== rawGeometryAuthority.sha256 ||
    !verifyCardGeometryObservedDenseContourV1(
      observedDenseContour,
      rawToNormalizedTransform.sourceWidthPx,
      rawToNormalizedTransform.sourceHeightPx,
    ) ||
    !verifyCardGeometryNormalizedDenseContourV1({
      contour: normalizedDenseContour,
      observed: observedDenseContour,
      transform: rawToNormalizedTransform,
    })
  ) {
    throw new Error(
      input.side + ' observed dense contour is not exactly hash-bound through normalization.',
    );
  }
  assertFixedRigReusedAuthoritativeTransformV1({
    artifact: acceptedArtifact,
    rawCapture: object(accepted.capture, input.side + ' raw accepted-profile capture'),
    authority: rawToNormalizedTransform,
    label: input.side + ' accepted-profile registration',
  });
  const bracket = object(
    side.photometricExposureBracket,
    input.side + ' photometric exposure bracket',
  );
  if (
    bracket.version !== 'fixed_rig_exposure_bracket_capture_v1' ||
    bracket.pixelFormat !== 'Mono8' ||
    bracket.automaticRetryCount !== 0
  ) {
    throw new Error(input.side + ' requires the authenticated production exposure-bracket contract.');
  }
  exactNumber(bracket.isolatedDutyTenthsPercent, 24, input.side + ' bracket duty');
  exactNumber(bracket.settleMs, 0, input.side + ' bracket settle');
  exactNumber(bracket.gain, 0, input.side + ' bracket gain');
  const expectedExposures = [15000, 30000, 37500];
  const cells = array(bracket.cells, input.side + ' bracket cells');
  if (cells.length !== 3) {
    throw new Error(input.side + ' exposure bracket requires exactly three cells.');
  }
  assertFixedRigPhotometricBracketCaptureProvenanceV1(cells, input.side);
  await rehashFixedRigPhotometricBracketRawCapturesV1({
    cells,
    packageDir,
    side: input.side,
  });
  const bracketReferences: NonNullable<
    FixedRigMathematicalCalibrationSideInputV1['photometricExposureBracket']
  >['references'] = [];
  const bracketChannels = new Map<number, NonNullable<
    FixedRigMathematicalCalibrationSideInputV1['photometricExposureBracket']
  >['channels'][number]>(Array.from({ length: 8 }, (_, index) => [
    index + 1,
    {
      channel: index + 1,
      channelConfidence: Number(input.channelConfidences.get(index + 1)),
      observations: [],
    },
  ]));
  const bracketFiles: FixedRigExactReportEvidenceFileV1[] = [];
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
    const cell = object(cells[cellIndex], input.side + ' bracket cell');
    const exposureUs = expectedExposures[cellIndex]!;
    exactNumber(cell.exposureUs, exposureUs, input.side + ' bracket exposure');
    const readback = object(cell.cameraReadback, input.side + ' bracket camera readback');
    exactNumber(readback.exposureUs, exposureUs, input.side + ' bracket exposure readback');
    exactNumber(readback.gain, 0, input.side + ' bracket gain readback');
    if (readback.pixelFormat !== 'Mono8' || typeof readback.cameraSerialNumber !== 'string' ||
        !readback.cameraSerialNumber) {
      throw new Error(input.side + ' bracket camera identity/readback is incomplete.');
    }
    assertFixedRigExactLeimacWritesV1(
      cell.safeOffBefore,
      FIXED_RIG_LEIMAC_SAFE_OFF_REQUEST_FRAMES_V1,
      input.side + ' bracket cell safe-off before',
    );
    assertFixedRigExactLeimacWritesV1(
      cell.safeOffAfter,
      FIXED_RIG_LEIMAC_SAFE_OFF_REQUEST_FRAMES_V1,
      input.side + ' bracket cell safe-off after',
    );
    const references = array(cell.references, input.side + ' bracket references');
    const observations = array(cell.channels, input.side + ' bracket channels');
    if (references.length !== 3 || observations.length !== 8) {
      throw new Error(input.side + ' bracket cell requires three references and channels 1 through 8.');
    }
    references.forEach((value, index) => {
      const role = object(value, input.side + ' bracket reference');
      exactNumber(role.exposureUs, exposureUs, input.side + ' reference exposure');
      exactNumber(role.referenceOrdinal, index + 1, input.side + ' reference ordinal');
      assertFixedRigExactLeimacWritesV1(
        role.safeOffBefore,
        FIXED_RIG_LEIMAC_SAFE_OFF_REQUEST_FRAMES_V1,
        input.side + ' reference safe-off',
      );
      const capture = object(role.capture, input.side + ' bracket reference capture');
      exactNumber(capture.exposureTime, exposureUs, input.side + ' reference capture exposure');
      exactNumber(capture.gain, 0, input.side + ' reference capture gain');
      if (capture.sourcePixelFormat !== 'Mono8') {
        throw new Error(input.side + ' bracket reference is not Mono8.');
      }
      const normalized = object(role.normalized, input.side + ' normalized bracket reference');
      const artifact = object(normalized.analysisArtifact, input.side + ' bracket reference artifact');
      assertFixedRigReusedAuthoritativeTransformV1({
        artifact,
        rawCapture: capture,
        authority: rawToNormalizedTransform,
        label: input.side + ' bracket reference registration',
      });
      const evidence = evidenceFrom({
        packageDir,
        artifact,
        pathField: 'localOutputPath',
        assetId: `${input.side}-bracket-${exposureUs}-reference-${index + 1}`,
        label: `${input.side} bracket ${exposureUs} reference ${index + 1}`,
      });
      bracketReferences.push({ ...evidence, exposureUs });
      bracketFiles.push(evidence);
    });
    observations.forEach((value, index) => {
      const role = object(value, input.side + ' bracket channel');
      const channel = index + 1;
      exactNumber(role.channel, channel, input.side + ' bracket channel index');
      exactNumber(role.exposureUs, exposureUs, input.side + ' bracket channel exposure');
      exactNumber(role.dutyTenthsPercent, 24, input.side + ' bracket channel duty');
      exactNumber(role.settleMs, 0, input.side + ' bracket channel settle');
      assertFixedRigExactLeimacWritesV1(
        role.safeOffBefore,
        FIXED_RIG_LEIMAC_SAFE_OFF_REQUEST_FRAMES_V1,
        input.side + ' bracket channel safe-off before',
      );
      const capture = object(role.capture, input.side + ' bracket channel capture');
      exactNumber(capture.exposureTime, exposureUs, input.side + ' bracket channel capture exposure');
      exactNumber(capture.gain, 0, input.side + ' bracket channel capture gain');
      if (capture.sourcePixelFormat !== 'Mono8') {
        throw new Error(input.side + ' bracket channel is not Mono8.');
      }
      const frames = array(role.frames, input.side + ' bracket one-hot frames');
      const w11 = object(frames[0], 'W11 frame');
      const w86 = object(frames[1], 'W86 frame');
      const expectedW11 = fixedRigLeimacUnitOneRequestFrameV1(
        '11',
        Array.from({ length: 8 }, (_, position) =>
          position === index ? '0024' : '0000'),
      );
      const expectedW86 = fixedRigLeimacUnitOneRequestFrameV1(
        '86',
        Array.from({ length: 8 }, (_, position) =>
          position === index ? '0001' : '0000'),
      );
      assertFixedRigExactLeimacWritesV1(
        role.writes,
        [expectedW11, expectedW86],
        input.side + ' bracket channel one-hot writes',
      );
      assertFixedRigExactLeimacWritesV1(
        role.safeOffAfter,
        FIXED_RIG_LEIMAC_SAFE_OFF_REQUEST_FRAMES_V1,
        input.side + ' bracket channel safe-off after',
      );
      if (frames.length !== 2 ||
          w11.commandNumber !== '11' ||
          w86.commandNumber !== '86' ||
          w11.targetDesignation !== '01' ||
          w86.targetDesignation !== '01' ||
          w11.requestAscii !== expectedW11 ||
          w86.requestAscii !== expectedW86 ||
          w11.requestFrame !== expectedW11 ||
          w86.requestFrame !== expectedW86) {
        throw new Error(input.side + ' bracket lighting must use exact one-hot W11/W86 frames.');
      }
      const normalized = object(role.normalized, input.side + ' normalized bracket channel');
      const artifact = object(normalized.analysisArtifact, input.side + ' bracket channel artifact');
      assertFixedRigReusedAuthoritativeTransformV1({
        artifact,
        rawCapture: capture,
        authority: rawToNormalizedTransform,
        label: input.side + ' bracket channel registration',
      });
      const evidence = evidenceFrom({
        packageDir,
        artifact,
        pathField: 'localOutputPath',
        assetId: `${input.side}-bracket-${exposureUs}-channel-${channel}`,
        label: `${input.side} bracket ${exposureUs} channel ${channel}`,
      });
      bracketChannels.get(channel)!.observations.push({ ...evidence, exposureUs });
      bracketFiles.push(evidence);
    });
  }
  const photometricExposureBracket: ParsedWarmSideV1['photometricExposureBracket'] = {
    version: 'fixed_rig_exposure_bracket_capture_v1',
    isolatedDutyTenthsPercent: 24,
    settleMs: 0,
    gain: 0,
    pixelFormat: 'Mono8',
    references: bracketReferences,
    channels: [...bracketChannels.values()],
  };
  const allFiles = [
    rawAllOn,
    rawGeometryAuthority,
    normalizedAllOn,
    normalizedAccepted,
    ...bracketFiles,
  ];
  await Promise.all(allFiles.map((file) =>
    readExact(file.filePath, file.sha256, input.side + ' ' + file.assetId)));
  return {
    rawAllOn,
    rawGeometryAuthority,
    geometryAuthorityRole,
    normalizedAllOn,
    normalizedCard: normalizedAccepted,
    photometricExposureBracket,
    rawToNormalizedTransform,
    observedOuterContour: {
      raw: observedDenseContour,
      normalized: normalizedDenseContour,
    },
    normalizedCardBytes: await readExact(
      normalizedAccepted.filePath,
      normalizedAccepted.sha256,
      input.side + ' accepted-profile registration source',
    ),
    geometry,
    geometryCaptureDecisions: recordOrEmpty(manifest.geometryPolicy),
    captureTiming: recordOrEmpty(manifest.captureTiming),
    warmManifestSha256: exactSha(input.manifestSha256, input.side + ' warm manifest sha256'),
    nativeCaptureRoles,
  };
}

async function resolveCenteringAuthorityV1(input: {
  side: Side;
  authority: FixedRigMathematicalStationCenteringAuthorityV1;
  cardIdentity: FixedRigMathematicalCardIdentityV1;
  source: ParsedWarmSideV1;
  normalizedWidthPx: number;
  normalizedHeightPx: number;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
}): Promise<
  | {
      status: 'computed';
      centering: FixedRigMathematicalCalibrationSideInputV1['centering'];
      designReference?: FixedRigMathematicalCalibrationSideInputV1['designReference'];
      designReferenceArtifact?: FixedRigExactReportEvidenceFileV1;
      designRegistration?: FixedRigMathematicalCalibrationSideInputV1['designRegistration'];
    }
  | { status: 'insufficient_evidence'; reasons: string[] }
> {
  if (input.authority.profile === 'printed_border_v1') {
    return { status: 'computed', centering: { profileInput: { profile: 'printed_border_v1' } } };
  }
  const approved = input.authority.approvedReference;
  const artifact = input.authority.approvedDesignArtifact;
  const identityMatches =
    approved.side === input.side &&
    approved.tenantId === input.cardIdentity.tenantId &&
    approved.setId === input.cardIdentity.setId &&
    approved.programId === input.cardIdentity.programId &&
    approved.cardNumber === input.cardIdentity.cardNumber &&
    approved.variantId === input.cardIdentity.variantId &&
    approved.parallelId === input.cardIdentity.parallelId;
  if (!identityMatches || approved.status !== 'approved' ||
      approved.artifactWidthPx !== input.normalizedWidthPx ||
      approved.artifactHeightPx !== input.normalizedHeightPx ||
      approved.artifactSha256 !== artifact.sha256.toLowerCase()) {
    return { status: 'insufficient_evidence', reasons: [
      input.side + ' approved design reference does not match the exact card, side, frame, or staged artifact.',
    ] };
  }
  let artifactBytes: Buffer;
  try {
    artifactBytes = await readExact(
      artifact.filePath,
      artifact.sha256,
      input.side + ' approved design artifact',
    );
  } catch (error) {
    return { status: 'insufficient_evidence', reasons: [
      error instanceof Error ? error.message : input.side + ' approved design artifact is unavailable.',
    ] };
  }
  const registration = await buildFixedRigAutomaticDesignRegistrationV1({
    approvedReference: approved,
    artifactEvidence: {
      assetId: artifact.assetId,
      sha256: artifact.sha256.toLowerCase(),
      bytes: artifactBytes,
    },
    normalizedSourceEvidence: {
      assetId: input.source.normalizedCard.assetId,
      sha256: input.source.normalizedCard.sha256.toLowerCase(),
      bytes: input.source.normalizedCardBytes,
      side: input.side,
      coordinateFrame: 'normalized_card_portrait_pixels',
      widthPx: input.normalizedWidthPx,
      heightPx: input.normalizedHeightPx,
    },
    measurementCalibration: {
      pixelsPerMmX: input.pixelsPerMmX,
      pixelsPerMmY: input.pixelsPerMmY,
    },
  });
  if (registration.status !== 'computed') {
    return { status: 'insufficient_evidence', reasons: registration.reasons };
  }
  return {
    status: 'computed',
    centering: { profileInput: registration.projection.centeringProfileInput },
    designReference: registration.projection.designReference,
    designReferenceArtifact: artifact,
    designRegistration: registration.conditionRegistration,
  };
}

export async function buildFixedRigMathematicalCalibrationStationPackageV1(
  input: BuildFixedRigMathematicalCalibrationStationPackageV1Input,
): Promise<BuildFixedRigMathematicalCalibrationStationPackageV1Result> {
  if (input.authority.schemaVersion !==
      FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION ||
      (input.authority.cardFormatId !== FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID &&
        input.authority.cardFormatId !== FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID)) {
    return adapterInsufficient('input_contract', [
      'Station authority must select one exact supported card-format contract.',
    ], { requiresImplementationCorrection: true });
  }
  let trustedPokemonAuthority: TrustedPokemonCardFormatAuthorityV1 | undefined;
  if (input.authority.cardFormatId === FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID) {
    try {
      trustedPokemonAuthority = verifyTrustedPokemonCardFormatAuthorityV1({
        authority: input.authority.trustedCardFormatAuthority,
        hmacKey: input.cardFormatAuthorityVerification?.hmacKey,
        expectedKeyId: input.cardFormatAuthorityVerification?.keyId,
        expectedCardIdentity: input.authority.cardIdentity,
      });
    } catch (error) {
      return adapterInsufficient('input_contract', [
        error instanceof Error ? error.message :
          'Trusted Pokémon physical-format authority could not be verified.',
      ], { requiresImplementationCorrection: true });
    }
  } else if ('trustedCardFormatAuthority' in input.authority) {
    return adapterInsufficient('input_contract', [
      'Generic standard-card authority cannot carry a Pokémon profile artifact.',
    ], { requiresImplementationCorrection: true });
  }
  let loaded: ReturnType<typeof loadFixedRigMathematicalCalibrationBundleV1>;
  try {
    loaded = loadFixedRigMathematicalCalibrationBundleV1({
      bundlePath: input.calibration.bundlePath,
      bundleSha256: input.calibration.bundleSha256,
      expectedRigId: input.calibration.expectedRigId,
      ...(input.calibration.expectedRuntimeContext
        ? { expectedRuntimeContext: input.calibration.expectedRuntimeContext }
        : {}),
    });
  } catch (error) {
    return adapterInsufficient('calibration_ingestion', [
      error instanceof Error ? error.message : 'Finalized calibration bundle could not be verified.',
    ], { requiresCalibration: true });
  }
  const channelConfidences = new Map(
    loaded.profile.channels.map((entry) => [entry.channelIndex, entry.directionConfidence]),
  );
  let warm: { front: ParsedWarmSideV1; back: ParsedWarmSideV1 };
  try {
    const [front, back] = await Promise.all([
      parseWarmSideV1({
        side: 'front',
        ...input.warmSides.front,
        channelConfidences,
      }),
      parseWarmSideV1({
        side: 'back',
        ...input.warmSides.back,
        channelConfidences,
      }),
    ]);
    warm = { front, back };
  } catch (error) {
    return adapterInsufficient('capture_evidence_ingestion', [
      error instanceof Error ? error.message : 'Warm front/back evidence could not be verified.',
    ], { requiresRecapture: true });
  }
  const intendedOuterBoundary = input.authority.cardFormatId ===
      FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID
    ? buildFixedRigPokemonTcgStandardBoundaryV1({
        normalizedWidthPx: loaded.profile.normalizedWidthPx,
        normalizedHeightPx: loaded.profile.normalizedHeightPx,
      })
    : buildFixedRigStandardTradingCardBoundaryV1({
        normalizedWidthPx: loaded.profile.normalizedWidthPx,
        normalizedHeightPx: loaded.profile.normalizedHeightPx,
      });
  const resolvedCentering = await Promise.all((['front', 'back'] as const).map((side) =>
    resolveCenteringAuthorityV1({
      side,
      authority: input.authority.sides[side].centering,
      cardIdentity: input.authority.cardIdentity,
      source: warm[side],
      normalizedWidthPx: loaded.profile.normalizedWidthPx,
      normalizedHeightPx: loaded.profile.normalizedHeightPx,
      pixelsPerMmX: 1 / loaded.profile.mmPerPixelX,
      pixelsPerMmY: 1 / loaded.profile.mmPerPixelY,
    })));
  if (resolvedCentering.some((entry) => entry.status !== 'computed')) {
    return adapterInsufficient('centering', resolvedCentering.flatMap((entry) =>
      entry.status === 'insufficient_evidence' ? entry.reasons : []), {
      requiresApprovedDesignReference: true,
      requiresRecapture: true,
    });
  }
  const centering = {
    front: resolvedCentering[0] as Extract<typeof resolvedCentering[number], { status: 'computed' }>,
    back: resolvedCentering[1] as Extract<typeof resolvedCentering[number], { status: 'computed' }>,
  };
  const sideInput = (side: Side): FixedRigMathematicalCalibrationSideInputV1 => ({
    rawAllOn: warm[side].rawAllOn,
    rawGeometryAuthority: warm[side].rawGeometryAuthority,
    geometryAuthorityRole: warm[side].geometryAuthorityRole,
    rawToNormalizedTransform: warm[side].rawToNormalizedTransform,
    observedOuterContour: warm[side].observedOuterContour,
    normalizedAllOn: warm[side].normalizedAllOn,
    normalizedCard: warm[side].normalizedCard,
    photometricExposureBracket: warm[side].photometricExposureBracket,
    intendedOuterBoundary,
    ...(centering[side].designReference ? {
      designReference: centering[side].designReference,
      designReferenceArtifact: centering[side].designReferenceArtifact,
      designRegistration: centering[side].designRegistration,
    } : {}),
    centering: centering[side].centering,
    measurementCalibration: {
      profile: loaded.profile,
      calibrationProfileId: loaded.profile.profileId,
      calibrationVersion: loaded.profile.calibrationVersion,
      calibrationSha256: loaded.profile.artifactSha256,
      pixelsPerMmX: 1 / loaded.profile.mmPerPixelX,
      pixelsPerMmY: 1 / loaded.profile.mmPerPixelY,
    },
    algorithmVersion: FIXED_RIG_MATHEMATICAL_STATION_ADAPTER_V1_VERSION,
    warmManifestSha256: warm[side].warmManifestSha256,
    nativeCaptureRoles: warm[side].nativeCaptureRoles,
  });
  return buildFixedRigMathematicalCalibrationReportPackageV1({
    gradingContract: 'mathematical_calibration_v1',
    gradingSessionId: input.gradingSessionId,
    generatedAt: input.generatedAt,
    reportId: input.reportId,
    queueItemId: input.queueItemId,
    outputDir: input.outputDir,
    captureProfileVersion: input.captureProfileVersion,
    cardIdentity: input.authority.cardIdentity,
    ...(trustedPokemonAuthority ? {
      pokemonStandardCornerAuthority: trustedPokemonAuthority,
      pokemonStandardCornerAuthorityVerification: input.cardFormatAuthorityVerification,
    } : {}),
    calibration: {
      finalizedProfile: loaded.profile,
      bundleAuthority: loaded.authority,
      activationAuthority: input.calibration.activationAuthority,
      physicalArtifact: {
        filePath: loaded.files.physicalArtifact.path,
        sha256: loaded.files.physicalArtifact.sha256,
      },
      flatFieldArtifacts: loaded.files.flatFields.map((file) => ({
        filePath: file.path,
        sha256: file.sha256,
      })),
      illuminationPatternArtifact: {
        filePath: loaded.files.illuminationPattern.path,
        sha256: loaded.files.illuminationPattern.sha256,
      },
      sensorMaximumValue:
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.evidenceEncoding.decodedRasterPlane
          .maximumDigitalValue,
    },
    sides: {
      front: sideInput('front'),
      back: sideInput('back'),
    },
    findingReviews: input.findingReviews,
    operatorResolutionAuthorities: input.operatorResolutionAuthorities,
    forcedOperatorReviewElements: input.forcedOperatorReviewElements,
    report: {
      publication: input.authority.publication,
      geometry: {
        front: warm.front.geometry,
        back: warm.back.geometry,
      },
      geometryCaptureDecisions: {
        front: warm.front.geometryCaptureDecisions,
        back: warm.back.geometryCaptureDecisions,
      },
      captureTiming: {
        front: warm.front.captureTiming,
        back: warm.back.captureTiming,
      },
      limitations: [
        'Registered design centering is available only when automatic local image registration satisfies every centralized acceptance gate.',
      ],
    },
  });
}
