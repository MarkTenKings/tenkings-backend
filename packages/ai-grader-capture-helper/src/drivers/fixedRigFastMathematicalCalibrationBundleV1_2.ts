import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  validateMathematicalCalibrationProfileV1,
  type MathematicalCalibrationProfileV1,
} from "@tenkings/shared";
import {
  buildFixedRigPhysicalCalibrationV1,
  FIXED_RIG_PHYSICAL_CALIBRATION_V1_VERSION,
  type BuildFixedRigPhysicalCalibrationV1Input,
  type FixedRigPhysicalCalibrationArtifactV1,
} from "./fixedRigPhysicalCalibrationV1";
import {
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_SCHEMA,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PACKAGE_SCHEMA,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PROFILE,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
  hashFastCalibrationCanonicalV1_2,
  validateFastCalibrationRigCharacterizationV1_2,
  validateFastCalibrationRuntimeContextV1_2,
  type FastCalibrationRigCharacterizationAuthorityV1_2,
  type FastCalibrationRuntimeContextV1_2,
} from "./fixedRigFastMathematicalCalibrationV1_2";

export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_ALGORITHM =
  "fixed-rig-fast-mathematical-calibration-analysis-v1.2" as const;
export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_BUNDLE_SCHEMA =
  "ten-kings-mathematical-calibration-bundle-v1" as const;
export const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_BUNDLE_FILE =
  "mathematical-calibration-bundle-v1.json" as const;

const PROFILE_FILE = "mathematical-calibration-profile-v1.json";
const PHYSICAL_FILE = "mathematical-calibration-artifact-v1.json";
const ACCEPTANCE_FILE = "mathematical-calibration-acceptance-v1.json";
const ILLUMINATION_FILE = "illumination-pattern-v1.json";
const SHA256 = /^[a-f0-9]{64}$/;

type JsonObject = Record<string, unknown>;

export interface FastCalibrationSourceArtifactV1_2 {
  operationId: string;
  role: "checkerboard_placement" | "dark_control" | "flat_field" | "illumination_pattern";
  slot: number;
  channelIndex: number | null;
  sampleIndex: number;
  sha256: string;
  byteSize: number;
  active: boolean;
  supersedesOperationId?: string;
}

export interface FastCalibrationSourceCapturePackageV1_2 {
  schemaVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PACKAGE_SCHEMA;
  contractVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT;
  packageId: string;
  manifestSha256: string;
  rigId: string;
  captureProfileVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PROFILE;
  purpose: "mathematical_calibration_v1.2";
  thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
  thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
  captureEvidenceAcceptance: {
    exactCheckerboardPlacements: 4;
    exactPhotometricFrames: 72;
    exactTotalImageCaptures: 76;
    exactBlankReverseFlipCount: 1;
    poseFourRequiresFinalAggregateDiversity: true;
    acceptedPoseSupersessionPreservesEvidence: true;
    failedAttemptLeavesSlotPending: true;
    persistentBatchRequired: true;
    automaticFallbackAllowed: false;
  };
  stationAuthority: {
    stationId: string;
    sessionId: string;
    operatorId: string;
    createdAt: string;
    finalizedAt: string;
    noProductionMutation: true;
    protectedSettings: FastCalibrationRuntimeContextV1_2;
  };
  subject: {
    designation: "calibration_target";
    productionCard: false;
    targetVersion: string;
    targetSha256: string;
  };
  rigCharacterizationAuthority: FastCalibrationRigCharacterizationAuthorityV1_2;
  rigCharacterizationSha256: string;
  runtimeContext: FastCalibrationRuntimeContextV1_2;
  runtimeContextSha256: string;
  captureCounts: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS;
  sourceArtifactLedgerSha256: string;
}

export interface FastCalibrationGeometryVerificationV1_2 {
  accepted: boolean;
  poseCount: 4;
  minimumCoverageFraction: number;
  minimumSafetyMarginFraction: number;
  spans: { x: number; y: number; rotationDegrees: number };
  maximumAuthorityReprojectionResidualPx: number;
  authorityReprojectionU95Px: number;
}

export interface FastCalibrationAnalysisV1_2 {
  schemaVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_SCHEMA;
  contractVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT;
  algorithmVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_ALGORITHM;
  thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
  thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
  sourceManifestSha256: string;
  sourceCapturePackage: FastCalibrationSourceCapturePackageV1_2;
  sourceArtifactLedger: FastCalibrationSourceArtifactV1_2[];
  sourceArtifactLedgerSha256: string;
  captureCounts: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS;
  geometryVerification: FastCalibrationGeometryVerificationV1_2;
  authorityLayers: {
    oneTimeRigCharacterizationInputSha256: string;
    quickSiteLightingInputSha256: string;
  };
  builderInput: BuildFixedRigPhysicalCalibrationV1Input;
  flatFieldArtifacts: Array<{
    channelIndex: number;
    fileName: string;
    sha256: string;
    bytes: Buffer;
  }>;
  illuminationPatternArtifact: {
    fileName: typeof ILLUMINATION_FILE;
    sha256: string;
    bytes: Buffer;
  };
  accepted: true;
  analysisSha256: string;
}

export interface BuildFastCalibrationAnalysisV1_2Input {
  sourceManifestSha256: string;
  sourceCapturePackage: FastCalibrationSourceCapturePackageV1_2;
  sourceArtifactLedger: FastCalibrationSourceArtifactV1_2[];
  geometryVerification: FastCalibrationGeometryVerificationV1_2;
  builderInput: BuildFixedRigPhysicalCalibrationV1Input;
  flatFieldArtifacts: FastCalibrationAnalysisV1_2["flatFieldArtifacts"];
  illuminationPatternArtifact: FastCalibrationAnalysisV1_2["illuminationPatternArtifact"];
}

export interface FastCalibrationBundleAuthorityV1_2 {
  schemaVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_BUNDLE_SCHEMA;
  bundleManifestSha256: string;
  sourceCaptureManifestSha256: string;
  memberLedgerSha256: string;
  captureContractVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT;
  runtimeContextSha256: string;
  rigCharacterizationSha256: string;
  members: Array<{
    role: "calibration_profile" | "physical_calibration_artifact" | "calibration_acceptance" | "flat_field" | "illumination_pattern";
    fileName: string;
    sha256: string;
    channelIndex?: number;
  }>;
}

export interface FinalizedFastCalibrationBundleV1_2 {
  bundlePath: string;
  bundleSha256: string;
  bundleBytes: Buffer;
  bundle: JsonObject;
  profile: MathematicalCalibrationProfileV1;
  physicalArtifact: FixedRigPhysicalCalibrationArtifactV1;
  acceptance: JsonObject;
  authority: FastCalibrationBundleAuthorityV1_2;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value), null, 2)}\n`, "utf8");
}

function digest(value: Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be an exact lowercase SHA-256.`);
  return value;
}

function exactText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be non-empty.`);
  return value;
}

function oneTimeProjection(input: BuildFixedRigPhysicalCalibrationV1Input): unknown {
  return {
    rigId: input.rigId,
    targetVersion: input.targetVersion,
    targetSha256: input.targetSha256,
    scaleSamples: input.scaleSamples,
    targetPrintScaleSamples: input.targetPrintScaleSamples,
    targetCutDimensionSamples: input.targetCutDimensionSamples,
    lensResidualSamples: input.lensResidualSamples,
    repeatedPlacementSamples: input.repeatedPlacementSamples,
    measurementRepeatabilitySamples: input.measurementRepeatabilitySamples,
    lensModel: input.lensModel,
    normalizationModel: input.normalizationModel,
    targetEvidence: input.targetEvidence,
    physicalDirections: input.channels.map((channel) => ({
      channelIndex: channel.channelIndex,
      directionMeasurementSamples: channel.directionMeasurementSamples,
    })),
  };
}

function quickProjection(
  input: BuildFixedRigPhysicalCalibrationV1Input,
  sourcePackage: FastCalibrationSourceCapturePackageV1_2,
  geometry: FastCalibrationGeometryVerificationV1_2,
): unknown {
  return {
    runtimeContext: sourcePackage.runtimeContext,
    normalizationResidualSamples: input.normalizationResidualSamples,
    segmentationBoundarySamples: input.segmentationBoundarySamples,
    channels: input.channels.map((channel) => ({
      channelIndex: channel.channelIndex,
      directionValidationAngularErrorsDegrees: channel.directionValidationAngularErrorsDegrees,
      relativeResponse: Array.from(channel.relativeResponse),
      responseScale: channel.responseScale,
      flatFieldArtifactId: channel.flatFieldArtifactId,
      flatFieldArtifactSha256: channel.flatFieldArtifactSha256,
      flatFieldFrames: channel.flatFieldFrames,
      darkControlFrames: channel.darkControlFrames,
      illuminationPatternArtifactId: channel.illuminationPatternArtifactId,
      illuminationPatternArtifactSha256: channel.illuminationPatternArtifactSha256,
      illuminationPatternFrames: channel.illuminationPatternFrames,
      illuminationPatternGridWidth: channel.illuminationPatternGridWidth,
      illuminationPatternGridHeight: channel.illuminationPatternGridHeight,
      expectedDirectionalResidual: Array.from(channel.expectedDirectionalResidual),
    })),
    geometryVerification: geometry,
  };
}

function activeCaptureKey(entry: FastCalibrationSourceArtifactV1_2): string {
  return `${entry.role}:${entry.channelIndex ?? "none"}:${entry.sampleIndex}`;
}

export function validateFastCalibrationSourceCapturePackageV1_2(
  value: FastCalibrationSourceCapturePackageV1_2,
): void {
  if (
    value.schemaVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PACKAGE_SCHEMA ||
    value.contractVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT ||
    value.captureProfileVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PROFILE ||
    value.purpose !== "mathematical_calibration_v1.2" ||
    value.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
    value.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH ||
    value.stationAuthority.noProductionMutation !== true ||
    value.subject.productionCard !== false ||
    value.subject.designation !== "calibration_target"
  ) {
    throw new Error("Fast calibration source package is not the exact Production-compatible V1.2 contract.");
  }
  validateFastCalibrationRuntimeContextV1_2(value.runtimeContext);
  validateFastCalibrationRigCharacterizationV1_2(value.rigCharacterizationAuthority, value.runtimeContext);
  if (
    value.runtimeContextSha256 !== hashFastCalibrationCanonicalV1_2(value.runtimeContext) ||
    value.rigCharacterizationSha256 !== hashFastCalibrationCanonicalV1_2(value.rigCharacterizationAuthority) ||
    value.stationAuthority.protectedSettings.schemaVersion !== value.runtimeContext.schemaVersion ||
    hashFastCalibrationCanonicalV1_2(value.stationAuthority.protectedSettings) !== value.runtimeContextSha256 ||
    value.stationAuthority.stationId !== value.runtimeContext.stationId ||
    value.rigId !== value.runtimeContext.rigId ||
    value.subject.targetVersion !== value.runtimeContext.target.version ||
    value.subject.targetSha256 !== value.runtimeContext.target.sha256 ||
    value.runtimeContext.algorithmHashes.thresholdManifest !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH
  ) {
    throw new Error("Fast calibration source package runtime, rig, station, or target authority mismatch.");
  }
  exactSha(value.manifestSha256, "sourceCapturePackage.manifestSha256");
  exactSha(value.sourceArtifactLedgerSha256, "sourceCapturePackage.sourceArtifactLedgerSha256");
  if (hashFastCalibrationCanonicalV1_2(value.captureCounts) !==
      hashFastCalibrationCanonicalV1_2(FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS)) {
    throw new Error("Fast calibration source package capture counts are not exactly 4 + 72 = 76.");
  }
  if (
    value.captureEvidenceAcceptance.exactCheckerboardPlacements !== 4 ||
    value.captureEvidenceAcceptance.exactPhotometricFrames !== 72 ||
    value.captureEvidenceAcceptance.exactTotalImageCaptures !== 76 ||
    value.captureEvidenceAcceptance.exactBlankReverseFlipCount !== 1 ||
    value.captureEvidenceAcceptance.poseFourRequiresFinalAggregateDiversity !== true ||
    value.captureEvidenceAcceptance.acceptedPoseSupersessionPreservesEvidence !== true ||
    value.captureEvidenceAcceptance.failedAttemptLeavesSlotPending !== true ||
    value.captureEvidenceAcceptance.persistentBatchRequired !== true ||
    value.captureEvidenceAcceptance.automaticFallbackAllowed !== false
  ) {
    throw new Error("Fast calibration source package acceptance contract was weakened or changed.");
  }
}

function validateLedger(ledger: FastCalibrationSourceArtifactV1_2[]): void {
  if (!Array.isArray(ledger) || ledger.length < 76) throw new Error("Fast calibration source ledger is incomplete.");
  const operationIds = new Set<string>();
  const hashes = new Set<string>();
  const active = ledger.filter((entry) => entry.active);
  for (const entry of ledger) {
    exactText(entry.operationId, "sourceArtifact.operationId");
    exactSha(entry.sha256, "sourceArtifact.sha256");
    if (operationIds.has(entry.operationId)) throw new Error("Fast calibration source operationId is duplicated.");
    if (hashes.has(entry.sha256)) throw new Error("Duplicate or relabelled fast calibration evidence is rejected.");
    operationIds.add(entry.operationId);
    hashes.add(entry.sha256);
  }
  const expected = new Set<string>();
  for (let sample = 1; sample <= 4; sample += 1) expected.add(`checkerboard_placement:none:${sample}`);
  for (let channel = 1; channel <= 8; channel += 1) {
    for (const role of ["dark_control", "flat_field", "illumination_pattern"]) {
      for (let sample = 1; sample <= 3; sample += 1) expected.add(`${role}:${channel}:${sample}`);
    }
  }
  const observed = new Set(active.map(activeCaptureKey));
  if (active.length !== 76 || observed.size !== 76 || [...expected].some((key) => !observed.has(key))) {
    throw new Error("Fast calibration active source ledger must contain exact slots for four placements and 72 photometric frames.");
  }
}


function validateBuilderPhotometricLineage(
  builderInput: BuildFixedRigPhysicalCalibrationV1Input,
  ledger: FastCalibrationSourceArtifactV1_2[],
): void {
  const activeSources = new Map(
    ledger.filter((entry) => entry.active).map((entry) => [activeCaptureKey(entry), entry]),
  );
  for (const channel of builderInput.channels) {
    for (const [role, frames] of [
      ["dark_control", channel.darkControlFrames],
      ["flat_field", channel.flatFieldFrames],
      ["illumination_pattern", channel.illuminationPatternFrames],
    ] as const) {
      if (frames.length !== 3) {
        throw new Error("Fast calibration builder channel " + channel.channelIndex + " " + role + " lineage must contain exactly three frames.");
      }
      frames.forEach((frame, index) => {
        const source = activeSources.get(role + ":" + channel.channelIndex + ":" + (index + 1));
        if (!source || frame.role !== role || frame.sha256 !== source.sha256) {
          throw new Error("Fast calibration builder channel " + channel.channelIndex + " " + role + " frame " + (index + 1) + " is not bound to its exact source artifact.");
        }
      });
    }
  }
}
export function buildFastCalibrationAnalysisV1_2(
  input: BuildFastCalibrationAnalysisV1_2Input,
): FastCalibrationAnalysisV1_2 {
  validateFastCalibrationSourceCapturePackageV1_2(input.sourceCapturePackage);
  validateLedger(input.sourceArtifactLedger);
  validateBuilderPhotometricLineage(input.builderInput, input.sourceArtifactLedger);
  exactSha(input.sourceManifestSha256, "sourceManifestSha256");
  if (
    input.geometryVerification.accepted !== true || input.geometryVerification.poseCount !== 4 ||
    input.geometryVerification.minimumCoverageFraction < 0.30 ||
    input.geometryVerification.minimumSafetyMarginFraction < 0.01 ||
    input.geometryVerification.spans.x < 0.07 || input.geometryVerification.spans.y < 0.08 ||
    input.geometryVerification.spans.rotationDegrees < 2 ||
    input.geometryVerification.maximumAuthorityReprojectionResidualPx > 0.5 ||
    input.geometryVerification.authorityReprojectionU95Px > 0.5
  ) {
    throw new Error("Fast calibration four-pose geometry verification failed unchanged V1 acceptance thresholds.");
  }
  if (input.builderInput.rigId !== input.sourceCapturePackage.rigId) {
    throw new Error("Fast calibration builder input rigId differs from the source package.");
  }
  if (input.flatFieldArtifacts.length !== 8) throw new Error("Fast calibration analysis requires eight flat-field artifacts.");
  const flatChannels = new Set<number>();
  for (const artifact of input.flatFieldArtifacts) {
    if (!Number.isInteger(artifact.channelIndex) || artifact.channelIndex < 1 || artifact.channelIndex > 8 || flatChannels.has(artifact.channelIndex)) {
      throw new Error("Fast calibration flat-field channels must be unique 1 through 8.");
    }
    flatChannels.add(artifact.channelIndex);
    if (artifact.fileName !== `flat-field-channel-${artifact.channelIndex}-v1.json` || digest(artifact.bytes) !== artifact.sha256) {
      throw new Error(`Fast calibration flat-field channel ${artifact.channelIndex} file identity mismatch.`);
    }
    const builderChannel = input.builderInput.channels.find((channel) => channel.channelIndex === artifact.channelIndex);
    if (!builderChannel || builderChannel.flatFieldArtifactSha256 !== artifact.sha256) {
      throw new Error(`Fast calibration flat-field channel ${artifact.channelIndex} is not bound to builder input.`);
    }
  }
  if (
    input.illuminationPatternArtifact.fileName !== ILLUMINATION_FILE ||
    digest(input.illuminationPatternArtifact.bytes) !== input.illuminationPatternArtifact.sha256 ||
    input.builderInput.channels.some((channel) => channel.illuminationPatternArtifactSha256 !== input.illuminationPatternArtifact.sha256)
  ) {
    throw new Error("Fast calibration illumination-pattern artifact is not exactly bound to all channels.");
  }
  const sourceArtifactLedgerSha256 = hashFastCalibrationCanonicalV1_2(input.sourceArtifactLedger);
  if (
    sourceArtifactLedgerSha256 !== input.sourceCapturePackage.sourceArtifactLedgerSha256 ||
    input.sourceCapturePackage.manifestSha256 !== input.sourceManifestSha256
  ) {
    throw new Error("Fast calibration source manifest or artifact-ledger hash mismatch.");
  }
  const withoutHash = {
    schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_SCHEMA,
    contractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
    algorithmVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_ALGORITHM,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    sourceManifestSha256: input.sourceManifestSha256,
    sourceCapturePackage: input.sourceCapturePackage,
    sourceArtifactLedger: input.sourceArtifactLedger,
    sourceArtifactLedgerSha256,
    captureCounts: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_COUNTS,
    geometryVerification: input.geometryVerification,
    authorityLayers: {
      oneTimeRigCharacterizationInputSha256: hashFastCalibrationCanonicalV1_2(oneTimeProjection(input.builderInput)),
      quickSiteLightingInputSha256: hashFastCalibrationCanonicalV1_2(
        quickProjection(input.builderInput, input.sourceCapturePackage, input.geometryVerification),
      ),
    },
    builderInput: input.builderInput,
    flatFieldArtifacts: input.flatFieldArtifacts,
    illuminationPatternArtifact: input.illuminationPatternArtifact,
    accepted: true as const,
  };
  return { ...withoutHash, analysisSha256: hashFastCalibrationCanonicalV1_2(withoutHash) };
}

function analysisWithoutBuffers(analysis: FastCalibrationAnalysisV1_2): unknown {
  return {
    ...analysis,
    flatFieldArtifacts: analysis.flatFieldArtifacts.map(({ bytes: _bytes, ...artifact }) => artifact),
    illuminationPatternArtifact: (({ bytes: _bytes, ...artifact }) => artifact)(analysis.illuminationPatternArtifact),
  };
}

async function writeNew(filePath: string, bytes: Buffer): Promise<string> {
  await writeFile(filePath, bytes, { flag: "wx" });
  return digest(bytes);
}

export async function finalizeFastMathematicalCalibrationBundleV1_2(input: {
  analysis: FastCalibrationAnalysisV1_2;
  outputDir: string;
}): Promise<FinalizedFastCalibrationBundleV1_2> {
  const rebuilt = buildFastCalibrationAnalysisV1_2({
    sourceManifestSha256: input.analysis.sourceManifestSha256,
    sourceCapturePackage: input.analysis.sourceCapturePackage,
    sourceArtifactLedger: input.analysis.sourceArtifactLedger,
    geometryVerification: input.analysis.geometryVerification,
    builderInput: input.analysis.builderInput,
    flatFieldArtifacts: input.analysis.flatFieldArtifacts,
    illuminationPatternArtifact: input.analysis.illuminationPatternArtifact,
  });
  if (rebuilt.analysisSha256 !== input.analysis.analysisSha256 ||
      hashFastCalibrationCanonicalV1_2(analysisWithoutBuffers(rebuilt)) !== hashFastCalibrationCanonicalV1_2(analysisWithoutBuffers(input.analysis))) {
    throw new Error("Fast calibration analysis is not deterministic or was changed after certification.");
  }
  const physical = buildFixedRigPhysicalCalibrationV1(input.analysis.builderInput);
  if (physical.status !== "finalized" || !physical.isCalibrated || !physical.profile) {
    throw new Error(`Fast calibration physical acceptance failed without threshold weakening: ${physical.issues.map((issue) => issue.message).join("; ")}`);
  }
  const profileValidation = validateMathematicalCalibrationProfileV1(physical.profile);
  if (!profileValidation.valid || !profileValidation.isCalibrated || !profileValidation.profile) {
    throw new Error(profileValidation.issues[0]?.message ?? "Fast calibration profile is not a valid Production Mathematical V1 profile.");
  }
  const profile = profileValidation.profile;
  const acceptance: JsonObject = {
    schemaVersion: "ten-kings-mathematical-calibration-acceptance-v1",
    captureContractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
    analysisSha256: input.analysis.analysisSha256,
    sourceManifestSha256: input.analysis.sourceManifestSha256,
    sourceCapturePackage: input.analysis.sourceCapturePackage,
    sourceArtifactLedgerSha256: input.analysis.sourceArtifactLedgerSha256,
    rigCharacterizationSha256: input.analysis.sourceCapturePackage.rigCharacterizationSha256,
    runtimeContextSha256: input.analysis.sourceCapturePackage.runtimeContextSha256,
    status: "finalized",
    isCalibrated: true,
    issues: [],
    artifactId: physical.artifact.artifactId,
    artifactSha256: physical.artifact.artifactSha256,
    profileId: profile.profileId,
    calibrationVersion: profile.calibrationVersion,
  };
  const profileBytes = jsonBytes(profile);
  const physicalBytes = jsonBytes(physical.artifact);
  const acceptanceBytes = jsonBytes(acceptance);
  const members: FastCalibrationBundleAuthorityV1_2["members"] = [
    { role: "calibration_profile", fileName: PROFILE_FILE, sha256: digest(profileBytes) },
    { role: "physical_calibration_artifact", fileName: PHYSICAL_FILE, sha256: digest(physicalBytes) },
    { role: "calibration_acceptance", fileName: ACCEPTANCE_FILE, sha256: digest(acceptanceBytes) },
    ...input.analysis.flatFieldArtifacts
      .slice().sort((left, right) => left.channelIndex - right.channelIndex)
      .map((artifact) => ({
        role: "flat_field" as const,
        channelIndex: artifact.channelIndex,
        fileName: artifact.fileName,
        sha256: artifact.sha256,
      })),
    { role: "illumination_pattern", fileName: ILLUMINATION_FILE, sha256: input.analysis.illuminationPatternArtifact.sha256 },
  ];
  if (members.length !== 12) throw new Error("Fast calibration finalizer did not produce the exact 12-member ledger.");
  const bundle: JsonObject = {
    schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_BUNDLE_SCHEMA,
    rigId: profile.rigId,
    profileId: profile.profileId,
    calibrationVersion: profile.calibrationVersion,
    finalizedAt: profile.finalizedAt,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    algorithmVersion: FIXED_RIG_PHYSICAL_CALIBRATION_V1_VERSION,
    analysisAlgorithmVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_ALGORITHM,
    sourceAnalysisSha256: input.analysis.analysisSha256,
    sourceManifestSha256: input.analysis.sourceManifestSha256,
    sourceCapturePackage: input.analysis.sourceCapturePackage,
    artifacts: members,
  };
  const bundleBytes = jsonBytes(bundle);
  const bundleSha256 = digest(bundleBytes);
  const authority: FastCalibrationBundleAuthorityV1_2 = {
    schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_BUNDLE_SCHEMA,
    bundleManifestSha256: bundleSha256,
    sourceCaptureManifestSha256: input.analysis.sourceManifestSha256,
    memberLedgerSha256: digest(Buffer.from(JSON.stringify(canonical(members)), "utf8")),
    captureContractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
    runtimeContextSha256: input.analysis.sourceCapturePackage.runtimeContextSha256,
    rigCharacterizationSha256: input.analysis.sourceCapturePackage.rigCharacterizationSha256,
    members,
  };

  const outputDir = path.resolve(input.outputDir);
  await mkdir(outputDir, { recursive: false });
  await writeNew(path.join(outputDir, PROFILE_FILE), profileBytes);
  await writeNew(path.join(outputDir, PHYSICAL_FILE), physicalBytes);
  await writeNew(path.join(outputDir, ACCEPTANCE_FILE), acceptanceBytes);
  for (const artifact of input.analysis.flatFieldArtifacts) {
    await writeNew(path.join(outputDir, artifact.fileName), artifact.bytes);
  }
  await writeNew(path.join(outputDir, ILLUMINATION_FILE), input.analysis.illuminationPatternArtifact.bytes);
  const bundlePath = path.join(outputDir, FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_BUNDLE_FILE);
  await writeNew(bundlePath, bundleBytes);
  return {
    bundlePath,
    bundleSha256,
    bundleBytes,
    bundle,
    profile,
    physicalArtifact: physical.artifact,
    acceptance,
    authority,
  };
}
