import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS,
  type OperationallyUsableMathematicalCalibrationProfileV1,
  type ProductOwnerOperationalAcceptanceV1,
} from "@tenkings/shared";
import {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PACKAGE_V1,
  FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1,
} from "./fixedRigMathematicalCalibrationCaptureContractV1";
import { FIXED_RIG_PHYSICAL_CALIBRATION_V1_VERSION } from "./fixedRigPhysicalCalibrationV1";
import {
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_ALGORITHM,
  validateFastCalibrationSourceCapturePackageV1_2,
  type FastCalibrationSourceCapturePackageV1_2,
} from "./fixedRigFastMathematicalCalibrationBundleV1_2";
import {
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PACKAGE_SCHEMA,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
  assertFastCalibrationRuntimeContextMatchV1_2,
  type FastCalibrationRuntimeContextV1_2,
} from "./fixedRigFastMathematicalCalibrationV1_2";
import {
  validateMathematicalCalibrationForOperationalUseV1,
  verifyProductOwnerOperationalAcceptanceV1,
} from "./productOwnerOperationalAcceptanceV1";

export const FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_V1 =
  "ten-kings-mathematical-calibration-bundle-v1" as const;
export const FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1 =
  "mathematical-calibration-bundle-v1.json" as const;
export const FIXED_RIG_MATHEMATICAL_CALIBRATION_ANALYSIS_ALGORITHM_V1 =
  "opencv_physical_calibration_analysis_v1" as const;

const ARTIFACT_HASH_POLICY = "sha256-canonical-json-with-artifactSha256-omitted";
const SHA256 = /^[a-f0-9]{64}$/;

export interface FixedRigMathematicalCalibrationBundleFileV1 {
  path: string;
  sha256: string;
  bytes: Buffer;
  artifact: Record<string, unknown>;
}

export type FixedRigMathematicalCalibrationBundleMemberRoleV1 =
  | "calibration_profile"
  | "physical_calibration_artifact"
  | "calibration_acceptance"
  | "product_owner_operational_acceptance"
  | "flat_field"
  | "illumination_pattern";

export type FixedRigMathematicalCalibrationBundleAuthorityMemberV1 =
  | {
      role: Exclude<FixedRigMathematicalCalibrationBundleMemberRoleV1, 'flat_field'>;
      fileName: string;
      sha256: string;
    }
  | {
      role: 'flat_field';
      channelIndex: number;
      fileName: string;
      sha256: string;
    };

/**
 * Immutable identity of the complete finalized calibration bundle. This is
 * produced only after the bundle manifest and every one of its twelve or
 * thirteen members
 * have been read and verified by this loader.
 */
export interface FixedRigMathematicalCalibrationBundleAuthorityV1 {
  schemaVersion: typeof FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_V1;
  bundleManifestSha256: string;
  sourceCaptureManifestSha256: string;
  memberLedgerSha256: string;
  members: FixedRigMathematicalCalibrationBundleAuthorityMemberV1[];
  captureContractVersion?: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT;
  runtimeContextSha256?: string;
  rigCharacterizationSha256?: string;
}

export interface LoadedFixedRigMathematicalCalibrationBundleV1 {
  bundlePath: string;
  bundleSha256: string;
  bundle: Record<string, unknown>;
  profile: OperationallyUsableMathematicalCalibrationProfileV1;
  physicalArtifact: Record<string, unknown>;
  acceptance: Record<string, unknown>;
  operationalAcceptance?: ProductOwnerOperationalAcceptanceV1;
  authority: FixedRigMathematicalCalibrationBundleAuthorityV1;
  files: {
    profile: FixedRigMathematicalCalibrationBundleFileV1;
    physicalArtifact: FixedRigMathematicalCalibrationBundleFileV1;
    acceptance: FixedRigMathematicalCalibrationBundleFileV1;
    operationalAcceptance?: FixedRigMathematicalCalibrationBundleFileV1;
    flatFields: FixedRigMathematicalCalibrationBundleFileV1[];
    illuminationPattern: FixedRigMathematicalCalibrationBundleFileV1;
  };
}

export interface LoadFixedRigMathematicalCalibrationBundleV1Input {
  bundlePath: string;
  bundleSha256: string;
  expectedRigId: string;
  expectedRuntimeContext?: FastCalibrationRuntimeContextV1_2;
}

export interface VerifyFixedRigMathematicalCalibrationBundleBytesV1Input {
  bundlePath: string;
  bundleSha256: string;
  expectedRigId: string;
  bundleBytes: Uint8Array;
  expectedRuntimeContext?: FastCalibrationRuntimeContextV1_2;
  readMemberBytes(fileName: string): {
    path: string;
    bytes: Uint8Array;
  };
}

export interface LoadFixedRigMathematicalCalibrationBundleFromStorageV1Input {
  bundleStorageKey: string;
  bundleSha256: string;
  expectedRigId: string;
  readArtifactBytes(storageKey: string): Promise<Uint8Array>;
  expectedRuntimeContext?: FastCalibrationRuntimeContextV1_2;
}

const EXACT_MEMBER_FILE_NAMES = [
  "mathematical-calibration-profile-v1.json",
  "mathematical-calibration-artifact-v1.json",
  "mathematical-calibration-acceptance-v1.json",
  "flat-field-channel-1-v1.json",
  "flat-field-channel-2-v1.json",
  "flat-field-channel-3-v1.json",
  "flat-field-channel-4-v1.json",
  "flat-field-channel-5-v1.json",
  "flat-field-channel-6-v1.json",
  "flat-field-channel-7-v1.json",
  "flat-field-channel-8-v1.json",
  "illumination-pattern-v1.json",
] as const;
const PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_FILE_NAME =
  "product-owner-operational-acceptance-v1.json" as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be one JSON object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${label} fields do not match the exact V1 contract.`);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function exactSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be an exact lowercase SHA-256.`);
  }
  return value;
}

function exactString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function parseJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  try {
    return record(JSON.parse(Buffer.from(bytes).toString("utf-8")), label);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} must be valid UTF-8 JSON.`);
    throw error;
  }
}

function verifyContentHash(artifact: Record<string, unknown>, label: string): void {
  if (artifact.hashPolicy !== ARTIFACT_HASH_POLICY) {
    throw new Error(`${label} does not use the exact V1 content-hash policy.`);
  }
  const declared = exactSha256(artifact.artifactSha256, `${label} artifactSha256`);
  const { artifactSha256: _omitted, ...withoutHash } = artifact;
  const observed = sha256(Buffer.from(JSON.stringify(canonical(withoutHash)), "utf-8"));
  if (observed !== declared) throw new Error(`${label} canonical content SHA-256 mismatch.`);
}

function verifyDeclaredContentHash(artifact: Record<string, unknown>, label: string): void {
  if (artifact.hashPolicy !== ARTIFACT_HASH_POLICY) {
    throw new Error(`${label} does not use the exact V1 content-hash policy.`);
  }
  exactSha256(artifact.artifactSha256, `${label} artifactSha256`);
}

function safeMemberPath(bundleDirectory: string, value: unknown, expected: string, label: string): string {
  if (typeof value !== "string" || value !== expected || path.basename(value) !== value) {
    throw new Error(`${label} must be the exact safe leaf ${expected}.`);
  }
  const resolvedDirectory = path.resolve(bundleDirectory);
  const resolvedPath = path.resolve(bundleDirectory, value);
  if (path.dirname(resolvedPath).toLowerCase() !== resolvedDirectory.toLowerCase()) {
    throw new Error(`${label} must remain inside the finalized calibration bundle directory.`);
  }
  return resolvedPath;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function verifyFixedRigMathematicalCalibrationBundleBytesV1(
  input: VerifyFixedRigMathematicalCalibrationBundleBytesV1Input,
): LoadedFixedRigMathematicalCalibrationBundleV1 {
  if (path.basename(input.bundlePath) !== FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1) {
    throw new Error(`Configured calibration bundle must be named ${FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1}.`);
  }
  const bundlePath = input.bundlePath;
  const bundleBytes = Buffer.from(input.bundleBytes);
  const observedBundleSha256 = sha256(bundleBytes);
  if (observedBundleSha256 !== exactSha256(input.bundleSha256, "Protected calibration bundle SHA-256")) {
    throw new Error("Configured calibration-bundle file SHA-256 does not match the protected station setting.");
  }
  const bundle = parseJson(bundleBytes, "Mathematical Calibration V1 bundle");
  exactKeys(bundle, [
    "schemaVersion", "rigId", "profileId", "calibrationVersion", "finalizedAt",
    "thresholdSetId", "thresholdSetHash", "algorithmVersion", "analysisAlgorithmVersion",
    "sourceAnalysisSha256", "sourceManifestSha256", "sourceCapturePackage",
    ...(bundle.operationalAcceptance === undefined ? [] : ["operationalAcceptance"]),
    "artifacts",
  ], "Mathematical Calibration V1 bundle");
  if (bundle.schemaVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_V1) {
    throw new Error(`Calibration bundle schema must be ${FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_V1}.`);
  }
  if (
    bundle.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
    bundle.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH
  ) {
    throw new Error("Calibration bundle threshold authority does not match the compiled Mathematical Grading V1 manifest.");
  }
  if (bundle.algorithmVersion !== FIXED_RIG_PHYSICAL_CALIBRATION_V1_VERSION) {
    throw new Error("Calibration bundle physical algorithm authority does not match the exact Production V1 algorithm.");
  }
  const rigId = exactString(bundle.rigId, "Calibration bundle rigId");
  if (rigId !== input.expectedRigId) {
    throw new Error("Configured calibration bundle rigId does not match this station's protected fixed-rig identity.");
  }
  exactSha256(bundle.sourceAnalysisSha256, "Calibration bundle sourceAnalysisSha256");
  const sourceAnalysisManifestSha256 = exactSha256(
    bundle.sourceManifestSha256,
    "Calibration bundle sourceManifestSha256",
  );

  const sourcePackage = record(bundle.sourceCapturePackage, "Calibration bundle sourceCapturePackage");
  const isFastV1_2 = sourcePackage.schemaVersion === FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CAPTURE_PACKAGE_SCHEMA;
  if (isFastV1_2) {
    exactKeys(sourcePackage, [
      "schemaVersion", "contractVersion", "packageId", "manifestSha256", "rigId", "captureProfileVersion", "purpose",
      "thresholdSetId", "thresholdSetHash", "captureEvidenceAcceptance", "stationAuthority", "subject",
      "rigCharacterizationAuthority", "rigCharacterizationSha256", "runtimeContext", "runtimeContextSha256",
      "captureCounts", "sourceArtifactLedgerSha256",
    ], "Calibration bundle V1.2 sourceCapturePackage");
    if (bundle.analysisAlgorithmVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_ANALYSIS_ALGORITHM) {
      throw new Error("Calibration bundle V1.2 analysis algorithm authority is not exact.");
    }
    const fastSourcePackage = sourcePackage as unknown as FastCalibrationSourceCapturePackageV1_2;
    validateFastCalibrationSourceCapturePackageV1_2(fastSourcePackage);
    if (!input.expectedRuntimeContext) {
      throw new Error("Calibration bundle V1.2 requires the exact live runtime context; no implicit or old-profile fallback is allowed.");
    }
    assertFastCalibrationRuntimeContextMatchV1_2(input.expectedRuntimeContext, fastSourcePackage.runtimeContext);
    if (fastSourcePackage.rigId !== rigId) {
      throw new Error("Calibration bundle V1.2 source package rigId does not match the bundle authority.");
    }
  } else {
    exactKeys(sourcePackage, [
      "schemaVersion", "packageId", "manifestSha256", "rigId", "captureProfileVersion", "purpose",
      "thresholdSetId", "thresholdSetHash", "captureEvidenceAcceptance", "evidenceDerivedAuthority",
      "stationAuthority", "subject",
      ...(sourcePackage.analyzerAuthoritySupersession === undefined
        ? []
        : ["analyzerAuthoritySupersession"]),
    ], "Calibration bundle sourceCapturePackage");
    if (sourcePackage.analyzerAuthoritySupersession !== undefined) {
      const supersession = record(
        sourcePackage.analyzerAuthoritySupersession,
        "Calibration bundle analyzerAuthoritySupersession",
      );
      exactKeys(
        supersession,
        ["schemaVersion", "rebindId", "path", "sha256", "byteSize"],
        "Calibration bundle analyzerAuthoritySupersession",
      );
      exactString(supersession.schemaVersion, "Calibration bundle analyzerAuthoritySupersession.schemaVersion");
      exactString(supersession.rebindId, "Calibration bundle analyzerAuthoritySupersession.rebindId");
      exactString(supersession.path, "Calibration bundle analyzerAuthoritySupersession.path");
      exactSha256(supersession.sha256, "Calibration bundle analyzerAuthoritySupersession.sha256");
      if (!Number.isSafeInteger(supersession.byteSize) || (supersession.byteSize as number) <= 0) {
        throw new Error("Calibration bundle analyzerAuthoritySupersession.byteSize must be a positive safe integer.");
      }
    }
    const evidenceDerivedAuthority = record(
      sourcePackage.evidenceDerivedAuthority,
      "Calibration bundle evidenceDerivedAuthority",
    );
    exactKeys(evidenceDerivedAuthority, [
      "thresholdSetId", "thresholdSetHash", "uncertaintyCoverageFactor",
    ], "Calibration bundle evidenceDerivedAuthority");
    if (
      bundle.analysisAlgorithmVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_ANALYSIS_ALGORITHM_V1 ||
      sourcePackage.schemaVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PACKAGE_V1 ||
      sourcePackage.captureProfileVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1 ||
      sourcePackage.purpose !== "mathematical_calibration_v1" || sourcePackage.rigId !== rigId ||
      sourcePackage.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
      sourcePackage.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH ||
      evidenceDerivedAuthority.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
      evidenceDerivedAuthority.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH ||
      evidenceDerivedAuthority.uncertaintyCoverageFactor !==
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.coverageFactor ||
      !sameJson(
        sourcePackage.captureEvidenceAcceptance,
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.captureEvidence,
      )
    ) {
      throw new Error("Calibration bundle source capture package does not use the exact protected V1 producer and threshold contract.");
    }
  }
  exactString(sourcePackage.packageId, "Calibration bundle source packageId");
  const sourceCaptureManifestSha256 = exactSha256(
    sourcePackage.manifestSha256,
    "Calibration bundle source manifestSha256",
  );
  // These hashes intentionally identify two distinct immutable inputs:
  // sourceAnalysisManifestSha256 is the analyzer's measurement/capture manifest,
  // while sourceCaptureManifestSha256 is the bridge capture-package artifact ledger.
  // Both remain exact bundle fields and are independently repeated in the sealed
  // acceptance artifact below; requiring equality would erase that provenance.

  const stationAuthority = record(sourcePackage.stationAuthority, "Calibration bundle stationAuthority");
  exactKeys(stationAuthority, [
    "stationId", "sessionId", "operatorId", "createdAt", "finalizedAt", "noProductionMutation", "protectedSettings",
  ], "Calibration bundle stationAuthority");
  for (const key of ["stationId", "sessionId", "operatorId", "createdAt", "finalizedAt"] as const) {
    exactString(stationAuthority[key], `Calibration bundle stationAuthority.${key}`);
  }
  if (stationAuthority.noProductionMutation !== true) {
    throw new Error("Calibration bundle station authority must explicitly prohibit Production mutation.");
  }
  const protectedSettings = record(stationAuthority.protectedSettings, "Calibration bundle protectedSettings");
  if (!isFastV1_2) {
  exactKeys(protectedSettings, [
    "stationId", "rigId", "captureProfileVersion", "cameraIndex", "exposureUs", "gain", "dutyPercent",
    "leimacUnit", "selectedChannels", "normalizedWidthPx", "normalizedHeightPx", "checkerboard",
  ], "Calibration bundle protectedSettings");
  if (
    protectedSettings.stationId !== stationAuthority.stationId || protectedSettings.rigId !== rigId ||
    protectedSettings.captureProfileVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_CAPTURE_PROFILE_V1 ||
    !Number.isInteger(protectedSettings.cameraIndex) || !Number.isInteger(protectedSettings.exposureUs) ||
    (protectedSettings.exposureUs as number) <= 0 || typeof protectedSettings.gain !== "number" ||
    !Number.isFinite(protectedSettings.gain) || (protectedSettings.gain as number) < 0 ||
    typeof protectedSettings.dutyPercent !== "number" || !Number.isFinite(protectedSettings.dutyPercent) ||
    (protectedSettings.dutyPercent as number) < 0 || !Number.isInteger(protectedSettings.leimacUnit) ||
    !Number.isInteger(protectedSettings.normalizedWidthPx) || (protectedSettings.normalizedWidthPx as number) <= 0 ||
    !Number.isInteger(protectedSettings.normalizedHeightPx) || (protectedSettings.normalizedHeightPx as number) <= 0 ||
    !sameJson(protectedSettings.selectedChannels, [1, 2, 3, 4, 5, 6, 7, 8])
  ) {
    throw new Error("Calibration bundle protected station settings are invalid or do not match the fixed-rig authority.");
  }
  const checkerboard = record(protectedSettings.checkerboard, "Calibration bundle protected checkerboard");
  exactKeys(checkerboard, ["internalColumns", "internalRows", "cellMm"], "Calibration bundle protected checkerboard");
  if (
    !Number.isInteger(checkerboard.internalColumns) || (checkerboard.internalColumns as number) < 2 ||
    !Number.isInteger(checkerboard.internalRows) || (checkerboard.internalRows as number) < 2 ||
    typeof checkerboard.cellMm !== "number" || !Number.isFinite(checkerboard.cellMm) || (checkerboard.cellMm as number) <= 0
  ) {
    throw new Error("Calibration bundle protected checkerboard settings are invalid.");
  }
  }
  const subject = record(sourcePackage.subject, "Calibration bundle calibration subject");
  exactKeys(subject, ["designation", "productionCard", "targetVersion", "targetSha256"], "Calibration bundle calibration subject");
  if (subject.designation !== "calibration_target" || subject.productionCard !== false) {
    throw new Error("Calibration bundle source subject must be the explicitly non-production calibration target.");
  }
  exactString(subject.targetVersion, "Calibration bundle targetVersion");
  exactSha256(subject.targetSha256, "Calibration bundle targetSha256");

  const hasOperationalAcceptance = bundle.operationalAcceptance !== undefined;
  if (hasOperationalAcceptance && isFastV1_2) {
    throw new Error("Product-owner operational acceptance is bound only to the exact preserved V1.0.1 session.");
  }
  const expectedArtifactCount = hasOperationalAcceptance ? 13 : 12;
  if (!Array.isArray(bundle.artifacts) || bundle.artifacts.length !== expectedArtifactCount) {
    throw new Error(
      "Calibration bundle must contain the exact profile, physical, acceptance, optional product-owner authority, eight flat-field, and illumination artifacts.",
    );
  }
  const descriptors = bundle.artifacts.map((entry, index) => record(entry, `Calibration bundle artifact ${index + 1}`));
  const seenNames = new Set<string>();
  const readMember = (descriptor: Record<string, unknown>, role: string, fileName: string): FixedRigMathematicalCalibrationBundleFileV1 => {
    exactKeys(
      descriptor,
      descriptor.channelIndex === undefined ? ["role", "fileName", "sha256"] : ["role", "channelIndex", "fileName", "sha256"],
      `Calibration bundle ${role} descriptor`,
    );
    if (descriptor.role !== role) throw new Error(`Calibration bundle is missing exact ${role} role binding.`);
    if (
      typeof descriptor.fileName !== "string" ||
      descriptor.fileName !== fileName ||
      path.basename(descriptor.fileName) !== descriptor.fileName
    ) {
      throw new Error(`${role} fileName must be the exact safe leaf ${fileName}.`);
    }
    if (seenNames.has(fileName)) throw new Error(`Calibration bundle artifact ${fileName} is duplicated.`);
    seenNames.add(fileName);
    const expectedSha256 = exactSha256(descriptor.sha256, `${role} file SHA-256`);
    const member = input.readMemberBytes(fileName);
    const bytes = Buffer.from(member.bytes);
    if (sha256(bytes) !== expectedSha256) throw new Error(`${fileName} exact file SHA-256 mismatch.`);
    return { path: member.path, sha256: expectedSha256, bytes, artifact: parseJson(bytes, fileName) };
  };
  const singleRole = (role: string) => {
    const matches = descriptors.filter((entry) => entry.role === role);
    if (matches.length !== 1) throw new Error(`Calibration bundle must contain exactly one ${role} artifact.`);
    return matches[0]!;
  };

  const profileFile = readMember(singleRole("calibration_profile"), "calibration_profile", "mathematical-calibration-profile-v1.json");
  const physicalFile = readMember(singleRole("physical_calibration_artifact"), "physical_calibration_artifact", "mathematical-calibration-artifact-v1.json");
  const acceptanceFile = readMember(singleRole("calibration_acceptance"), "calibration_acceptance", "mathematical-calibration-acceptance-v1.json");
  let operationalAcceptanceFile: FixedRigMathematicalCalibrationBundleFileV1 | undefined;
  let operationalAcceptance: ProductOwnerOperationalAcceptanceV1 | undefined;
  if (hasOperationalAcceptance) {
    operationalAcceptanceFile = readMember(
      singleRole("product_owner_operational_acceptance"),
      "product_owner_operational_acceptance",
      PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_FILE_NAME,
    );
    operationalAcceptance = verifyProductOwnerOperationalAcceptanceV1(
      operationalAcceptanceFile.artifact,
    );
    const summary = record(bundle.operationalAcceptance, "Calibration bundle operationalAcceptance");
    exactKeys(summary, [
      "status", "authorityId", "authoritySha256", "authorityFileSha256",
      "exceptionLedgerSha256", "exceptionCount",
    ], "Calibration bundle operationalAcceptance");
    if (
      summary.status !== PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS ||
      summary.authorityId !== operationalAcceptance.authorityId ||
      summary.authoritySha256 !== operationalAcceptance.authoritySha256 ||
      summary.authorityFileSha256 !== operationalAcceptanceFile.sha256 ||
      summary.exceptionLedgerSha256 !== operationalAcceptance.exceptionLedgerSha256 ||
      summary.exceptionCount !== operationalAcceptance.exceptionLedger.length
    ) {
      throw new Error("Calibration bundle operational-acceptance summary is not exactly bound to its authority file.");
    }
    if (!sameJson(profileFile.artifact.operationalAcceptance, operationalAcceptance)) {
      throw new Error("Bundled operational profile does not embed the exact product-owner authority.");
    }
  } else if (descriptors.some((entry) => entry.role === "product_owner_operational_acceptance")) {
    throw new Error("Calibration bundle cannot contain an unreferenced product-owner authority.");
  }
  const validation = validateMathematicalCalibrationForOperationalUseV1(profileFile.artifact);
  if (
    !validation.valid || !validation.profile ||
    (!validation.isCalibrated && !validation.isOperationallyAccepted) ||
    validation.isOperationallyAccepted !== hasOperationalAcceptance
  ) {
    throw new Error(validation.issues[0]?.message ?? "Bundled calibration profile is not operationally authorized.");
  }
  const profile = validation.profile;
  if (
    profile.rigId !== rigId || profile.profileId !== bundle.profileId ||
    profile.calibrationVersion !== bundle.calibrationVersion || profile.finalizedAt !== bundle.finalizedAt
  ) {
    throw new Error("Bundled calibration profile identity does not match the bundle authority.");
  }

  const physical = physicalFile.artifact;
  verifyContentHash(physical, "Physical calibration artifact");
  if (
    physical.schemaVersion !== "ai-grader-physical-calibration-artifact-v1" ||
    physical.algorithmVersion !== FIXED_RIG_PHYSICAL_CALIBRATION_V1_VERSION ||
    physical.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
    physical.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH ||
    physical.rigId !== rigId || physical.profileId !== profile.profileId ||
    physical.calibrationVersion !== profile.calibrationVersion || physical.finalizedAt !== profile.finalizedAt ||
    physical.artifactSha256 !== profile.artifactSha256
  ) {
    throw new Error("Physical calibration artifact is not identity- and threshold-bound to the bundled profile.");
  }

  const acceptance = acceptanceFile.artifact;
  exactKeys(acceptance, isFastV1_2 ? [
    "schemaVersion", "captureContractVersion", "analysisSha256", "sourceManifestSha256", "sourceCapturePackage",
    "sourceArtifactLedgerSha256", "rigCharacterizationSha256", "runtimeContextSha256", "status", "isCalibrated",
    "issues", "artifactId", "artifactSha256", "profileId", "calibrationVersion",
  ] : [
    "schemaVersion", "analysisSha256", "sourceManifestSha256", "sourceCapturePackage", "status", "isCalibrated",
    "issues", "artifactId", "artifactSha256", "profileId", "calibrationVersion",
  ], "Calibration acceptance artifact");
  const fastAcceptanceBound = !isFastV1_2 || (
    acceptance.captureContractVersion === FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT &&
    acceptance.sourceArtifactLedgerSha256 === sourcePackage.sourceArtifactLedgerSha256 &&
    acceptance.rigCharacterizationSha256 === sourcePackage.rigCharacterizationSha256 &&
    acceptance.runtimeContextSha256 === sourcePackage.runtimeContextSha256
  );
  const commonAcceptanceBound =
    acceptance.schemaVersion === "ten-kings-mathematical-calibration-acceptance-v1" &&
    acceptance.analysisSha256 === bundle.sourceAnalysisSha256 &&
    acceptance.sourceManifestSha256 === sourceAnalysisManifestSha256 &&
    sameJson(acceptance.sourceCapturePackage, sourcePackage) &&
    acceptance.artifactId === physical.artifactId &&
    acceptance.artifactSha256 === physical.artifactSha256 &&
    fastAcceptanceBound;
  const acceptedMathematically =
    acceptance.status === "finalized" && acceptance.isCalibrated === true &&
    Array.isArray(acceptance.issues) && acceptance.issues.length === 0 &&
    acceptance.profileId === profile.profileId &&
    acceptance.calibrationVersion === profile.calibrationVersion;
  const acceptedOperationally =
    operationalAcceptance !== undefined &&
    acceptance.status === "rejected" && acceptance.isCalibrated === false &&
    Array.isArray(acceptance.issues) &&
    sameJson(acceptance.issues, operationalAcceptance.exceptionLedger) &&
    acceptance.profileId === null && acceptance.calibrationVersion === null &&
    operationalAcceptance.subject.analysisSha256 === bundle.sourceAnalysisSha256 &&
    operationalAcceptance.subject.sourceCaptureManifestSha256 === sourceAnalysisManifestSha256 &&
    operationalAcceptance.subject.sourceCapturePackageSha256 === sourceCaptureManifestSha256 &&
    operationalAcceptance.subject.thresholdSetHash === MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH &&
    operationalAcceptance.subject.physicalArtifactSha256 === physical.artifactSha256 &&
    operationalAcceptance.subject.mathematicalAcceptanceFileSha256 === acceptanceFile.sha256 &&
    operationalAcceptance.subject.rigId === rigId &&
    operationalAcceptance.subject.profileId === profile.profileId &&
    operationalAcceptance.subject.calibrationVersion === profile.calibrationVersion &&
    operationalAcceptance.subject.finalizedAt === profile.finalizedAt &&
    operationalAcceptance.subject.artifactId === profile.artifactId;
  if (
    !commonAcceptanceBound ||
    (hasOperationalAcceptance ? !acceptedOperationally : !acceptedMathematically) ||
    (hasOperationalAcceptance && acceptedMathematically)
  ) {
    throw new Error("Calibration acceptance artifact is not exactly bound to the finalized bundle evidence.");
  }

  const physicalInputs = record(physical.inputs, "Physical calibration artifact inputs");
  if (!Array.isArray(physicalInputs.channels) || physicalInputs.channels.length !== 8) {
    throw new Error("Physical calibration artifact must bind exactly eight lighting channels.");
  }
  const physicalChannels = new Map<number, Record<string, unknown>>();
  for (const value of physicalInputs.channels) {
    const channel = record(value, "Physical calibration channel");
    if (!Number.isInteger(channel.channelIndex) || (channel.channelIndex as number) < 1 || (channel.channelIndex as number) > 8) {
      throw new Error("Physical calibration channelIndex must be an integer from 1 through 8.");
    }
    const index = channel.channelIndex as number;
    if (physicalChannels.has(index)) throw new Error(`Physical calibration channel ${index} is duplicated.`);
    physicalChannels.set(index, channel);
  }

  const flatDescriptors = descriptors.filter((entry) => entry.role === "flat_field");
  if (flatDescriptors.length !== 8) throw new Error("Calibration bundle must contain exactly eight flat-field artifacts.");
  const flatFields: FixedRigMathematicalCalibrationBundleFileV1[] = [];
  for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
    const matches = flatDescriptors.filter((entry) => entry.channelIndex === channelIndex);
    if (matches.length !== 1) throw new Error(`Calibration bundle must contain exactly one flat-field artifact for channel ${channelIndex}.`);
    const file = readMember(matches[0]!, "flat_field", `flat-field-channel-${channelIndex}-v1.json`);
    // Python/OpenCV floating-point JSON is authenticated by the exact member
    // file SHA bound into the physical artifact and bundle. Re-serializing it
    // in JavaScript would create a second, language-dependent hash authority.
    verifyDeclaredContentHash(file.artifact, `Flat-field channel ${channelIndex} artifact`);
    if (
      file.artifact.schemaVersion !== "ten-kings-flat-field-artifact-v1" ||
      file.artifact.algorithmVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_ANALYSIS_ALGORITHM_V1 ||
      file.artifact.channelIndex !== channelIndex ||
      physicalChannels.get(channelIndex)?.flatFieldArtifactSha256 !== file.sha256
    ) {
      throw new Error(`Flat-field channel ${channelIndex} is not exactly bound to the physical calibration artifact.`);
    }
    flatFields.push(file);
  }

  const illuminationPattern = readMember(singleRole("illumination_pattern"), "illumination_pattern", "illumination-pattern-v1.json");
  verifyDeclaredContentHash(illuminationPattern.artifact, "Illumination-pattern artifact");
  if (
    illuminationPattern.artifact.schemaVersion !== "ten-kings-illumination-pattern-artifact-v1" ||
    illuminationPattern.artifact.algorithmVersion !== FIXED_RIG_MATHEMATICAL_CALIBRATION_ANALYSIS_ALGORITHM_V1 ||
    illuminationPattern.artifact.coordinateFrame !== "normalized_card_portrait_pixels" ||
    !Array.isArray(illuminationPattern.artifact.channels) || illuminationPattern.artifact.channels.length !== 8
  ) {
    throw new Error("Illumination-pattern artifact metadata is invalid.");
  }
  const illuminationChannels = new Set<number>();
  for (const value of illuminationPattern.artifact.channels) {
    const channel = record(value, "Illumination-pattern channel");
    if (!Number.isInteger(channel.channelIndex) || (channel.channelIndex as number) < 1 || (channel.channelIndex as number) > 8) {
      throw new Error("Illumination-pattern channelIndex must be an integer from 1 through 8.");
    }
    const index = channel.channelIndex as number;
    if (illuminationChannels.has(index)) throw new Error(`Illumination-pattern channel ${index} is duplicated.`);
    illuminationChannels.add(index);
    if (physicalChannels.get(index)?.illuminationPatternArtifactSha256 !== illuminationPattern.sha256) {
      throw new Error(`Illumination-pattern channel ${index} is not exactly bound to the physical calibration artifact.`);
    }
  }
  if (seenNames.size !== expectedArtifactCount) {
    throw new Error("Calibration bundle artifact ledger was not consumed exactly once.");
  }

  const members: FixedRigMathematicalCalibrationBundleAuthorityMemberV1[] = [
    { role: "calibration_profile", fileName: "mathematical-calibration-profile-v1.json", sha256: profileFile.sha256 },
    {
      role: "physical_calibration_artifact",
      fileName: "mathematical-calibration-artifact-v1.json",
      sha256: physicalFile.sha256,
    },
    {
      role: "calibration_acceptance",
      fileName: "mathematical-calibration-acceptance-v1.json",
      sha256: acceptanceFile.sha256,
    },
    ...(operationalAcceptanceFile
      ? [{
          role: "product_owner_operational_acceptance" as const,
          fileName: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_FILE_NAME,
          sha256: operationalAcceptanceFile.sha256,
        }]
      : []),
    ...flatFields.map((file, index) => ({
      role: "flat_field" as const,
      channelIndex: index + 1,
      fileName: `flat-field-channel-${index + 1}-v1.json`,
      sha256: file.sha256,
    })),
    {
      role: "illumination_pattern",
      fileName: "illumination-pattern-v1.json",
      sha256: illuminationPattern.sha256,
    },
  ];
  const authority: FixedRigMathematicalCalibrationBundleAuthorityV1 = {
    schemaVersion: FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_V1,
    bundleManifestSha256: observedBundleSha256,
    sourceCaptureManifestSha256,
    memberLedgerSha256: sha256(Buffer.from(JSON.stringify(canonical(members)), "utf-8")),
    ...(isFastV1_2 ? {
      captureContractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
      runtimeContextSha256: exactSha256(sourcePackage.runtimeContextSha256, "V1.2 runtimeContextSha256"),
      rigCharacterizationSha256: exactSha256(sourcePackage.rigCharacterizationSha256, "V1.2 rigCharacterizationSha256"),
    } : {}),
    members,
  };

  return {
    bundlePath,
    bundleSha256: observedBundleSha256,
    bundle,
    profile,
    physicalArtifact: physical,
    acceptance,
    operationalAcceptance,
    authority,
    files: {
      profile: profileFile,
      physicalArtifact: physicalFile,
      acceptance: acceptanceFile,
      operationalAcceptance: operationalAcceptanceFile,
      flatFields,
      illuminationPattern,
    },
  };
}

export function loadFixedRigMathematicalCalibrationBundleV1(
  input: LoadFixedRigMathematicalCalibrationBundleV1Input,
): LoadedFixedRigMathematicalCalibrationBundleV1 {
  if (path.basename(input.bundlePath) !== FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1) {
    throw new Error(`Configured calibration bundle must be named ${FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1}.`);
  }
  const bundlePath = path.resolve(input.bundlePath);
  const bundleDirectory = path.dirname(bundlePath);
  return verifyFixedRigMathematicalCalibrationBundleBytesV1({
    bundlePath,
    bundleSha256: input.bundleSha256,
    expectedRigId: input.expectedRigId,
    expectedRuntimeContext: input.expectedRuntimeContext,
    bundleBytes: readFileSync(bundlePath),
    readMemberBytes(fileName) {
      const memberPath = safeMemberPath(bundleDirectory, fileName, fileName, `${fileName} path`);
      return { path: memberPath, bytes: readFileSync(memberPath) };
    },
  });
}

function exactStorageBundleKey(value: string): { bundleStorageKey: string; directory: string } {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    throw new Error("Calibration bundle storage key must be one exact relative object key.");
  }
  const segments = value.split("/");
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.at(-1) !== FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1
  ) {
    throw new Error(
      `Calibration bundle storage key must end with the exact safe leaf ${FIXED_RIG_MATHEMATICAL_CALIBRATION_BUNDLE_FILE_V1}.`,
    );
  }
  return { bundleStorageKey: value, directory: segments.slice(0, -1).join("/") };
}

export async function loadFixedRigMathematicalCalibrationBundleFromStorageV1(
  input: LoadFixedRigMathematicalCalibrationBundleFromStorageV1Input,
): Promise<LoadedFixedRigMathematicalCalibrationBundleV1> {
  if (typeof input.readArtifactBytes !== "function") {
    throw new Error("Calibration bundle storage loader requires an artifact byte reader.");
  }
  const { bundleStorageKey, directory } = exactStorageBundleKey(input.bundleStorageKey);
  const memberStorageKey = (fileName: string) => directory ? `${directory}/${fileName}` : fileName;
  const bundleBytes = await input.readArtifactBytes(bundleStorageKey);
  const parsedBundle = parseJson(bundleBytes, "Stored Mathematical Calibration V1 bundle");
  const storedArtifacts = Array.isArray(parsedBundle.artifacts) ? parsedBundle.artifacts : [];
  const includesOperationalAuthority = storedArtifacts.some((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry) &&
    (entry as Record<string, unknown>).role === "product_owner_operational_acceptance"
  );
  const expectedMemberFileNames = includesOperationalAuthority
    ? [...EXACT_MEMBER_FILE_NAMES, PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_FILE_NAME]
    : [...EXACT_MEMBER_FILE_NAMES];
  const memberByteValues = await Promise.all(
    expectedMemberFileNames.map((fileName) => input.readArtifactBytes(memberStorageKey(fileName))),
  );
  const members = new Map<string, { path: string; bytes: Uint8Array }>(
    expectedMemberFileNames.map((fileName, index) => [
      fileName,
      { path: memberStorageKey(fileName), bytes: memberByteValues[index]! },
    ]),
  );
  return verifyFixedRigMathematicalCalibrationBundleBytesV1({
    bundlePath: bundleStorageKey,
    bundleSha256: input.bundleSha256,
    expectedRigId: input.expectedRigId,
    expectedRuntimeContext: input.expectedRuntimeContext,
    bundleBytes,
    readMemberBytes(fileName) {
      const member = members.get(fileName);
      if (!member) throw new Error(`Calibration bundle requested an unexpected member ${fileName}.`);
      return member;
    },
  });
}
