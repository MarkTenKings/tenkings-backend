import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} from "@tenkings/shared";
import {
  FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2_SHA256,
  FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2_SHA256,
} from "./fixedRigFastCalibrationEvidenceAnalyzerV1_2";
import { FIXED_RIG_FAST_CALIBRATION_FINALIZER_V1_2_SHA256 } from "./fixedRigFastCalibrationFinalizerAlgorithmV1_2";
import {
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_SCHEMA,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA,
  hashFastCalibrationCanonicalV1_2,
  validateFastCalibrationRuntimeContextV1_2,
  verifyFastCalibrationRigCharacterizationSourceV1_2,
  type FastCalibrationChannelWiringV1_2,
  type FastCalibrationRigCharacterizationSourceV1_2,
  type FastCalibrationRigSourceBundleMemberV1_2,
  type FastCalibrationRuntimeContextV1_2,
} from "./fixedRigFastMathematicalCalibrationV1_2";
import {
  buildFixedRigPhysicalCalibrationV1,
  type BuildFixedRigPhysicalCalibrationV1Input,
  type FixedRigCalibrationEvidenceReferenceV1,
} from "./fixedRigPhysicalCalibrationV1";

export const FAST_CALIBRATION_RIG_MATERIALIZATION_INPUT_SCHEMA_V1_2 =
  "ten-kings-mathematical-calibration-v1.2-rig-materialization-input-v1" as const;
export const FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_SCHEMA_V1_2 =
  "ten-kings-mathematical-calibration-v1.2-rig-source-evidence-v1" as const;
export const FAST_CALIBRATION_RIG_PHYSICAL_ANALYSIS_SCHEMA_V1_2 =
  "ten-kings-mathematical-calibration-v1.2-rig-physical-analysis-v1" as const;
export const FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_SCHEMA_V1_2 =
  "ten-kings-mathematical-calibration-v1.2-rig-authority-materialization-handoff-v1" as const;
export const FAST_CALIBRATION_RIG_MATERIALIZATION_AUTHORITY_V1_2 =
  "trusted-local-supervised-rig-characterization-materializer-v1" as const;
export const FAST_CALIBRATION_RIG_MATERIALIZATION_CONFIRMATION_V1_2 =
  "MATERIALIZE MATHEMATICAL CALIBRATION V1.2 RIG AUTHORITY" as const;

export const FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2 = "mathematical-calibration-runtime-context-v1.2.json" as const;
export const FAST_CALIBRATION_RIG_SOURCE_BUNDLE_FILE_V1_2 = "rig-characterization-source-v1.2.json" as const;
export const FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_FILE_V1_2 = "rig-characterization-source-evidence-v1.json" as const;
export const FAST_CALIBRATION_RIG_PHYSICAL_ANALYSIS_FILE_V1_2 = "rig-characterization-physical-analysis-v1.json" as const;
export const FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_FILE_V1_2 = "rig-characterization-materializer-handoff-v1.json" as const;
export const FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_DIR_V1_2 = "source-evidence" as const;

const CAPTURE_MANIFEST_SCHEMA = "ten-kings-mathematical-calibration-capture-manifest-v1";
const CAPTURE_PACKAGE_SCHEMA = "ten-kings-mathematical-calibration-capture-package-v1";
const CAPTURE_PROFILE = "ten-kings-fixed-rig-mathematical-calibration-v1";
const PHYSICAL_ANALYSIS_SCHEMA = "ten-kings-mathematical-calibration-analysis-v1";
const PHYSICAL_ANALYSIS_ALGORITHM = "opencv_physical_calibration_analysis_v1";
const LIVE_PROBE_SCHEMA = "ten-kings-mathematical-calibration-v1.2-protected-live-probe-evidence-v1";
const COMPONENT_EVIDENCE_SCHEMA = "ten-kings-mathematical-calibration-v1.2-component-supervision-evidence-v1";
const EVIDENCE_DERIVED_COMPONENT_EVIDENCE_SCHEMA = "ten-kings-mathematical-calibration-v1.2-evidence-derived-component-authority-v1";
const STAGE_TRANSFORM_SCHEMA = "ten-kings-mathematical-calibration-v1.2-stage-transform-evidence-v1";
const CANONICAL_DIRECTION_FRAME_SCHEMA = "ten-kings-mathematical-calibration-v1.2-canonical-target-direction-authority-v1";
const EVIDENCE_DERIVED_LENS_SCHEMA = "ten-kings-mathematical-calibration-v1.2-evidence-derived-lens-authority-v1";
const EVIDENCE_DERIVED_WIRING_SCHEMA = "ten-kings-mathematical-calibration-v1.2-evidence-derived-wiring-authority-v1";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_RELATIVE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,511}$/;
const SOURCE_REFERENCE_ROLES = new Set([
  "instrument_calibration", "metrology_source", "lens_authority", "component_wiring", "stage_transform_measurement",
]);
const REQUIRED_NON_INSTRUMENT_REFERENCE_ROLES = [
  "lens_authority", "component_wiring", "stage_transform_measurement",
] as const;
const RIG_MEMBER_SPECS = Object.freeze([
  { role: "target_metrology", fileName: "target-metrology-authority-v1.json" },
  { role: "camera_lens", fileName: "camera-lens-authority-v1.json" },
  { role: "physical_light_directions", fileName: "physical-light-directions-authority-v1.json" },
  { role: "component_identities", fileName: "component-identities-authority-v1.json" },
  { role: "repeatability", fileName: "repeatability-authority-v1.json" },
] as const);

type JsonObject = Record<string, unknown>;
type FileReference = { fileName: string; sha256: string };
type ReferencedEvidence = FileReference & { role: string };

interface FastCalibrationRigMaterializationInputManifestBaseV1_2 {
  schemaVersion: typeof FAST_CALIBRATION_RIG_MATERIALIZATION_INPUT_SCHEMA_V1_2;
  captureManifest: FileReference;
  liveProbe: FileReference;
  componentEvidence: FileReference;
  referencedEvidence: ReferencedEvidence[];
}

export type FastCalibrationRigMaterializationInputManifestV1_2 =
  | (FastCalibrationRigMaterializationInputManifestBaseV1_2 & { stageTransformEvidence: FileReference })
  | (FastCalibrationRigMaterializationInputManifestBaseV1_2 & { directionFrameEvidence: FileReference });

export interface FastCalibrationProtectedLiveProbeEvidenceV1_2 {
  schemaVersion: typeof LIVE_PROBE_SCHEMA;
  observedAt: string;
  probeAuthority: "protected-basler-leimac-live-probe-v1";
  stationId: string;
  rigId: string;
  camera: {
    serialNumber: string;
    modelName: string;
    transport: "GigE";
    exposureUs: number;
    gain: number;
    pixelFormat: string;
    widthPx: number;
    heightPx: number;
  };
  controller: { identity: string; unit: number; responseKinds: string[] };
  dutyPercent: number;
  locationLabel: string;
  lightingConfigurationId: string;
}

export interface FastCalibrationComponentSupervisionEvidenceV1_2 {
  schemaVersion: typeof COMPONENT_EVIDENCE_SCHEMA;
  recordedAt: string;
  operatorId: string;
  rigId: string;
  controllerIdentity: string;
  componentConfigurationId: string;
  lensAuthorityId: string;
  lensAuthorityEvidenceSha256: string;
  wiringEvidenceSha256: string;
  channelWiring: FastCalibrationChannelWiringV1_2[];
  targetVersion: string;
  targetSha256: string;
}

export interface FastCalibrationEvidenceDerivedComponentAuthorityV1_2 {
  schemaVersion: typeof EVIDENCE_DERIVED_COMPONENT_EVIDENCE_SCHEMA;
  derivedAt: string;
  authorityMethod: "content_addressed_observed_rig_response_v1";
  rigId: string;
  controllerIdentity: string;
  controllerUnit: number;
  componentConfigurationId: string;
  lensAuthorityId: string;
  lensAuthorityEvidenceSha256: string;
  wiringEvidenceSha256: string;
  channelWiring: FastCalibrationChannelWiringV1_2[];
  targetVersion: string;
  targetSha256: string;
}

export type FastCalibrationComponentAuthorityEvidenceV1_2 =
  | FastCalibrationComponentSupervisionEvidenceV1_2
  | FastCalibrationEvidenceDerivedComponentAuthorityV1_2;

export interface FastCalibrationStageTransformEvidenceV1_2 {
  schemaVersion: typeof STAGE_TRANSFORM_SCHEMA;
  recordedAt: string;
  operatorId: string;
  rigId: string;
  cameraSerialNumber: string;
  cameraModelName: string;
  lensAuthorityId: string;
  method: "supervised-stage-to-undistorted-sensor-matrix-v1";
  stageToUndistortedSensorMatrix: [number, number, number, number];
  measurementEvidenceSha256: string[];
}

export interface FastCalibrationCanonicalDirectionFrameEvidenceV1_2 {
  schemaVersion: typeof CANONICAL_DIRECTION_FRAME_SCHEMA;
  derivedAt: string;
  authorityMethod: "evidence_derived_normalized_illumination_direction_v1";
  coordinateFrame: "canonical_normalized_target_v1";
  rigId: string;
  physicalAnalyzerSha256: string;
  channels: Array<{
    channelIndex: number;
    physicalDirectionId: string;
    directionMeasurementEvidence: Array<{
      evidenceId: string;
      sha256: string;
      sourceEvidenceId: string;
      sourceSha256: string;
    }>;
  }>;
}

export interface FastCalibrationEvidenceDerivedLensAuthorityV1_2 {
  schemaVersion: typeof EVIDENCE_DERIVED_LENS_SCHEMA;
  authorityMethod: "exact_capture_and_analyzer_binding_v1";
  rigId: string;
  cameraSerialNumber: string;
  cameraModelName: string;
  targetVersion: string;
  targetSha256: string;
  sourceCaptureManifestSha256: string;
  physicalAnalyzerSha256: string;
  lensGeometryEvidence: Array<{ evidenceId: string; sha256: string }>;
  normalizationRegistrationEvidence: Array<{ evidenceId: string; sha256: string }>;
}

export interface FastCalibrationEvidenceDerivedWiringAuthorityV1_2 {
  schemaVersion: typeof EVIDENCE_DERIVED_WIRING_SCHEMA;
  authorityMethod: "observed_leimac_acknowledged_response_v1";
  rigId: string;
  controllerIdentity: string;
  controllerUnit: number;
  channels: Array<{
    channelIndex: number;
    controllerOutput: string;
    responseEvidence: Array<{ evidenceId: string; role: string; sha256: string }>;
  }>;
}

export interface FastCalibrationRigPhysicalAnalysisV1_2 {
  schemaVersion: typeof FAST_CALIBRATION_RIG_PHYSICAL_ANALYSIS_SCHEMA_V1_2;
  sourceCaptureManifestSha256: string;
  sourceCapturePackageSha256: string;
  physicalAnalyzerSha256: string;
  builderInput: BuildFixedRigPhysicalCalibrationV1Input;
  physicalArtifactSha256: string;
  profileSha256: string;
}

export interface FastCalibrationRigSourceEvidenceEntryV1_2 {
  kind: string;
  evidenceId: string;
  sourceRole: string;
  fileName: string;
  sha256: string;
  byteSize: number;
}

export interface FastCalibrationRigSourceEvidenceManifestV1_2 {
  schemaVersion: typeof FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_SCHEMA_V1_2;
  inputManifestSha256: string;
  sourceCaptureManifestSha256: string;
  sourceCapturePackageSha256: string;
  physicalAnalyzerSha256: string;
  physicalAnalyzerDependencyManifestSha256: string;
  files: FastCalibrationRigSourceEvidenceEntryV1_2[];
}

export interface FastCalibrationRigMaterializationAnalysisResultV1_2 {
  builderInput: BuildFixedRigPhysicalCalibrationV1Input;
  derivedArtifacts: Array<{ kind: "derived_flat_field" | "derived_illumination_pattern"; sourceRole: string; bytes: Buffer }>;
}

export interface MaterializeFastCalibrationRigAuthorityV1_2Input {
  inputManifestPath: string;
  inputManifestSha256: string;
  acceptanceRoot: string;
  confirmation: string;
  analyzePhysicalEvidence?: (input: {
    captureManifestPath: string;
    captureManifestSha256: string;
    outputDir: string;
  }) => Promise<FastCalibrationRigMaterializationAnalysisResultV1_2>;
}

export interface MaterializedFastCalibrationRigAuthorityV1_2 {
  directoryName: string;
  runtimeContextSha256: string;
  rigSourceBundleSha256: string;
  sourceEvidenceManifestSha256: string;
  physicalAnalysisSha256: string;
  handoffSha256: string;
  runtimeContext: FastCalibrationRuntimeContextV1_2;
  rigSource: FastCalibrationRigCharacterizationSourceV1_2;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
}

function hash(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value: unknown, keys: readonly string[], label: string): asserts value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be one exact object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains missing or extra fields.`);
  }
}

function exactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${label} must be an exact safe identifier.`);
  return value;
}

function exactSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be an exact lowercase SHA-256.`);
  return value;
}

function exactTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      new Date(value).toISOString() !== value) throw new Error(`${label} must be one exact UTC timestamp.`);
  return value;
}

function finite(value: unknown, label: string, minimum?: number, maximum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) ||
      (minimum !== undefined && value < minimum) || (maximum !== undefined && value > maximum)) {
    throw new Error(`${label} is outside its finite allowed range.`);
  }
  return value;
}

function validateProtectedTargetGeometryInstrument(
  value: JsonObject,
  targetVersion: string,
  targetSha256: string,
): boolean {
  if (value.kind !== "protected_target_geometry") return false;
  exactKeys(value, [
    "instrumentId", "kind", "targetVersion", "targetSha256", "authorityStatement",
  ], "protected target geometry authority");
  if (value.instrumentId !== "protected-calibration-target-geometry-v1" ||
      value.authorityStatement !== "product_owner_confirmed_exact_target_geometry_v1") {
    throw new Error("Protected target geometry has the wrong authority identity.");
  }
  if (exactId(value.targetVersion, "protected target geometry version") !== targetVersion ||
      exactSha(value.targetSha256, "protected target geometry sha256") !== targetSha256) {
    throw new Error("Protected target geometry does not match the source capture target identity.");
  }
  return true;
}

function validateProtectedTargetGeometryMeasurement(
  value: JsonObject,
  sourceRole: string,
  targetSha256: string,
): void {
  const axis = sourceRole.endsWith("_x") ? "x" : sourceRole.endsWith("_y") ? "y" : null;
  if (!axis || value.measurementMethod !== "protected_checkerboard_geometry_authority_v1" ||
      value.authorityBasis !== "protected_checkerboard_geometry" ||
      value.sourceTargetEvidenceId !== "print-verified-calibration-target" ||
      value.sourceTargetSha256 !== targetSha256 || value.sourceMetrologyArtifactSha256 !== undefined) {
    throw new Error("Protected target geometry measurement does not use the exact nominal target-authority contract.");
  }
  if (sourceRole === `print_scale_verification_${axis}`) {
    if (value.schemaVersion !== "ten-kings-calibration-print-scale-authority-v1" ||
        value.protectedSpanMm !== (axis === "x" ? 100 : 200) ||
        value.nominalSpanMm !== undefined || value.measuredSpanMm !== undefined ||
        value.measurementU95Mm !== undefined) {
      throw new Error("Protected print-scale authority is not exact nominal checkerboard geometry.");
    }
    return;
  }
  if (sourceRole === `target_cut_dimension_${axis}`) {
    if (value.schemaVersion !== "ten-kings-calibration-target-cut-dimension-authority-v1" ||
        value.protectedDimensionMm !== (axis === "x" ? 63.5 : 88.9) ||
        value.nominalDimensionMm !== undefined || value.measuredDimensionMm !== undefined ||
        value.measurementU95Mm !== undefined) {
      throw new Error("Protected target-cut authority is not exact nominal checkerboard geometry.");
    }
    return;
  }
  throw new Error("Protected target geometry cannot authorize non-target physical measurements.");
}

function safeRelative(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_RELATIVE.test(value) || path.isAbsolute(value) || value.includes("\\") ||
      value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be one safe relative file name.`);
  }
  return value;
}

function contained(root: string, relativeName: string): string {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, ...relativeName.split("/"));
  if (resolved === absoluteRoot || !resolved.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error("Rig materialization evidence path escaped its protected root.");
  }
  return resolved;
}

function parseCanonical<T>(bytes: Buffer, label: string): T {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${label} is not valid JSON.`); }
  if (!bytes.equals(canonicalBytes(value))) throw new Error(`${label} must use exact canonical JSON bytes.`);
  return value as T;
}

async function readExact(filePath: string, expectedSha256: string, label: string): Promise<Buffer> {
  const bytes = await readFile(filePath);
  if (hash(bytes) !== expectedSha256) throw new Error(`${label} differs from its exact SHA-256.`);
  return bytes;
}

function validateFileReference(value: FileReference, label: string): void {
  exactKeys(value, ["fileName", "sha256"], label);
  safeRelative(value.fileName, `${label}.fileName`);
  exactSha(value.sha256, `${label}.sha256`);
}

function validateInputManifest(value: FastCalibrationRigMaterializationInputManifestV1_2): void {
  const canonicalDirection = "directionFrameEvidence" in value;
  const directionReference: FileReference = canonicalDirection ? value.directionFrameEvidence : value.stageTransformEvidence;
  exactKeys(value, canonicalDirection
    ? ["schemaVersion", "captureManifest", "liveProbe", "componentEvidence", "directionFrameEvidence", "referencedEvidence"]
    : ["schemaVersion", "captureManifest", "liveProbe", "componentEvidence", "stageTransformEvidence", "referencedEvidence"], "rig materialization input");
  if (value.schemaVersion !== FAST_CALIBRATION_RIG_MATERIALIZATION_INPUT_SCHEMA_V1_2) throw new Error("Rig materialization input schema mismatch.");
  validateFileReference(value.captureManifest, "captureManifest");
  validateFileReference(value.liveProbe, "liveProbe");
  validateFileReference(value.componentEvidence, "componentEvidence");
  validateFileReference(directionReference,
    canonicalDirection ? "directionFrameEvidence" : "stageTransformEvidence");
  if (!Array.isArray(value.referencedEvidence) ||
      (canonicalDirection ? value.referencedEvidence.length !== 2 : value.referencedEvidence.length < 5)) {
    throw new Error(canonicalDirection
      ? "Canonical-target rig materialization requires exactly generated lens and wiring evidence."
      : "Rig materialization requires explicit lens, wiring, and stage evidence.");
  }
  const names = new Set<string>();
  const hashes = new Set<string>();
  const roles = new Set<string>();
  for (const entry of value.referencedEvidence) {
    exactKeys(entry, ["role", "fileName", "sha256"], "referenced evidence");
    if (!SOURCE_REFERENCE_ROLES.has(entry.role)) throw new Error("Rig materialization referenced-evidence role is not allowlisted.");
    safeRelative(entry.fileName, "referenced evidence fileName");
    exactSha(entry.sha256, "referenced evidence sha256");
    if (names.has(entry.fileName) || hashes.has(entry.sha256)) throw new Error("Rig materialization rejects duplicate or relabelled referenced evidence.");
    names.add(entry.fileName);
    hashes.add(entry.sha256);
    roles.add(entry.role);
  }
  for (const role of REQUIRED_NON_INSTRUMENT_REFERENCE_ROLES) {
    if ((canonicalDirection && role === "stage_transform_measurement") || roles.has(role)) continue;
    throw new Error(`Rig materialization requires explicit ${role} evidence.`);
  }
  if (canonicalDirection && [...roles].some((role) => role !== "lens_authority" && role !== "component_wiring")) {
    throw new Error("Canonical-target rig materialization rejects legacy, instrument, metrology, and manual authority references.");
  }
}

function validateLiveProbe(value: FastCalibrationProtectedLiveProbeEvidenceV1_2): void {
  exactKeys(value, ["schemaVersion", "observedAt", "probeAuthority", "stationId", "rigId", "camera", "controller", "dutyPercent", "locationLabel", "lightingConfigurationId"], "live probe evidence");
  if (value.schemaVersion !== LIVE_PROBE_SCHEMA || value.probeAuthority !== "protected-basler-leimac-live-probe-v1") {
    throw new Error("Rig materialization rejects synthetic or unrecognized live-probe evidence.");
  }
  exactTimestamp(value.observedAt, "live probe observedAt");
  exactId(value.stationId, "live probe stationId");
  exactId(value.rigId, "live probe rigId");
  exactKeys(value.camera, ["serialNumber", "modelName", "transport", "exposureUs", "gain", "pixelFormat", "widthPx", "heightPx"], "live probe camera");
  if (value.camera.transport !== "GigE") throw new Error("Rig materialization requires observed Basler GigE evidence.");
  exactId(value.camera.serialNumber, "live probe camera serialNumber");
  exactId(value.camera.modelName, "live probe camera modelName");
  exactId(value.camera.pixelFormat, "live probe camera pixelFormat");
  finite(value.camera.exposureUs, "live probe exposureUs", 1, 10_000_000);
  finite(value.camera.gain, "live probe gain", 0, 100);
  if (!Number.isInteger(value.camera.widthPx) || !Number.isInteger(value.camera.heightPx) || value.camera.widthPx < 64 || value.camera.heightPx < 64) {
    throw new Error("Live probe camera dimensions are invalid.");
  }
  exactKeys(value.controller, ["identity", "unit", "responseKinds"], "live probe controller");
  exactId(value.controller.identity, "live probe controller identity");
  if (!Number.isInteger(value.controller.unit) || value.controller.unit < 1 || value.controller.unit > 255 ||
      !Array.isArray(value.controller.responseKinds) || value.controller.responseKinds.length === 0 ||
      value.controller.responseKinds.some((entry) => entry !== "ack")) {
    throw new Error("Live probe requires exact controller unit-information acknowledgements.");
  }
  finite(value.dutyPercent, "live probe dutyPercent", Number.EPSILON, 100);
  exactId(value.locationLabel, "live probe locationLabel");
  exactId(value.lightingConfigurationId, "live probe lightingConfigurationId");
}

function validateWiring(value: FastCalibrationChannelWiringV1_2[]): void {
  if (!Array.isArray(value) || value.length !== 8) throw new Error("Component evidence requires exact channel wiring 1 through 8.");
  const outputs = new Set<string>();
  value.forEach((entry, index) => {
    exactKeys(entry, ["channelIndex", "controllerOutput", "componentId", "physicalDirectionId"], "component channel wiring");
    if (entry.channelIndex !== index + 1) throw new Error("Component channel wiring order must be exact 1 through 8.");
    const output = exactId(entry.controllerOutput, "component controllerOutput");
    if (outputs.has(output)) throw new Error("Component controller outputs must be unique.");
    outputs.add(output);
    exactId(entry.componentId, "component componentId");
    exactId(entry.physicalDirectionId, "component physicalDirectionId");
  });
}

function validateComponentEvidence(value: FastCalibrationComponentAuthorityEvidenceV1_2): void {
  if (value.schemaVersion === EVIDENCE_DERIVED_COMPONENT_EVIDENCE_SCHEMA) {
    exactKeys(value, ["schemaVersion", "derivedAt", "authorityMethod", "rigId", "controllerIdentity", "controllerUnit", "componentConfigurationId", "lensAuthorityId", "lensAuthorityEvidenceSha256", "wiringEvidenceSha256", "channelWiring", "targetVersion", "targetSha256"], "evidence-derived component authority");
    if (value.authorityMethod !== "content_addressed_observed_rig_response_v1") throw new Error("Evidence-derived component authority method mismatch.");
    exactTimestamp(value.derivedAt, "component authority derivedAt");
    if (!Number.isInteger(value.controllerUnit) || value.controllerUnit < 1 || value.controllerUnit > 255) throw new Error("Evidence-derived component controller unit is invalid.");
  } else {
    exactKeys(value, ["schemaVersion", "recordedAt", "operatorId", "rigId", "controllerIdentity", "componentConfigurationId", "lensAuthorityId", "lensAuthorityEvidenceSha256", "wiringEvidenceSha256", "channelWiring", "targetVersion", "targetSha256"], "component evidence");
    if (value.schemaVersion !== COMPONENT_EVIDENCE_SCHEMA) throw new Error("Component supervision evidence schema mismatch.");
    exactTimestamp(value.recordedAt, "component evidence recordedAt");
    exactId(value.operatorId, "component evidence operatorId");
  }
  [value.rigId, value.controllerIdentity, value.componentConfigurationId, value.lensAuthorityId, value.targetVersion]
    .forEach((entry, index) => exactId(entry, `component evidence identity ${index}`));
  exactSha(value.lensAuthorityEvidenceSha256, "component lens evidence sha256");
  exactSha(value.wiringEvidenceSha256, "component wiring evidence sha256");
  exactSha(value.targetSha256, "component target sha256");
  validateWiring(value.channelWiring);
}

function validateCanonicalDirectionFrame(value: FastCalibrationCanonicalDirectionFrameEvidenceV1_2): void {
  exactKeys(value, ["schemaVersion", "derivedAt", "authorityMethod", "coordinateFrame", "rigId", "physicalAnalyzerSha256", "channels"], "canonical target direction authority");
  if (value.schemaVersion !== CANONICAL_DIRECTION_FRAME_SCHEMA ||
      value.authorityMethod !== "evidence_derived_normalized_illumination_direction_v1" ||
      value.coordinateFrame !== "canonical_normalized_target_v1") {
    throw new Error("Canonical target direction authority schema, method, or coordinate frame mismatch.");
  }
  exactTimestamp(value.derivedAt, "canonical target direction derivedAt");
  exactId(value.rigId, "canonical target direction rigId");
  exactSha(value.physicalAnalyzerSha256, "canonical target direction analyzer sha256");
  if (!Array.isArray(value.channels) || value.channels.length !== 8) throw new Error("Canonical target direction authority requires exactly eight channels.");
  const directionIds = new Set<string>();
  value.channels.forEach((channel, index) => {
    exactKeys(channel, ["channelIndex", "physicalDirectionId", "directionMeasurementEvidence"], "canonical target direction channel");
    if (channel.channelIndex !== index + 1 || directionIds.has(channel.physicalDirectionId)) throw new Error("Canonical target direction identities must be unique and ordered 1 through 8.");
    directionIds.add(exactId(channel.physicalDirectionId, "canonical target physicalDirectionId"));
    if (!Array.isArray(channel.directionMeasurementEvidence) || channel.directionMeasurementEvidence.length !== 3) throw new Error("Canonical target direction requires exactly three evidence-derived measurements per channel.");
    const hashes = new Set<string>();
    channel.directionMeasurementEvidence.forEach((entry) => {
      exactKeys(entry, ["evidenceId", "sha256", "sourceEvidenceId", "sourceSha256"], "canonical target direction evidence reference");
      exactId(entry.evidenceId, "direction measurement evidenceId");
      exactId(entry.sourceEvidenceId, "direction source evidenceId");
      exactSha(entry.sha256, "direction measurement sha256");
      exactSha(entry.sourceSha256, "direction source sha256");
      if (hashes.has(entry.sha256) || hashes.has(entry.sourceSha256)) throw new Error("Canonical target direction evidence contains duplicate hashes.");
      hashes.add(entry.sha256); hashes.add(entry.sourceSha256);
    });
  });
}

function operationalId(prefix: string, value: unknown): string {
  return `tk-${prefix}-${hash(canonicalBytes(value))}`;
}

function validateEvidenceDerivedLens(value: FastCalibrationEvidenceDerivedLensAuthorityV1_2): void {
  exactKeys(value, ["schemaVersion", "authorityMethod", "rigId", "cameraSerialNumber", "cameraModelName", "targetVersion", "targetSha256", "sourceCaptureManifestSha256", "physicalAnalyzerSha256", "lensGeometryEvidence", "normalizationRegistrationEvidence"], "evidence-derived lens authority");
  if (value.schemaVersion !== EVIDENCE_DERIVED_LENS_SCHEMA || value.authorityMethod !== "exact_capture_and_analyzer_binding_v1") throw new Error("Evidence-derived lens authority schema or method mismatch.");
  [value.rigId, value.cameraSerialNumber, value.cameraModelName, value.targetVersion]
    .forEach((entry, index) => exactId(entry, `evidence-derived lens identity ${index}`));
  [value.targetSha256, value.sourceCaptureManifestSha256, value.physicalAnalyzerSha256]
    .forEach((entry, index) => exactSha(entry, `evidence-derived lens hash ${index}`));
  for (const [label, entries] of [["lens geometry", value.lensGeometryEvidence], ["normalization registration", value.normalizationRegistrationEvidence]] as const) {
    if (!Array.isArray(entries) || entries.length !== 20) throw new Error(`Evidence-derived ${label} authority requires exact raw and normalized evidence for ten poses.`);
    const hashes = new Set<string>();
    entries.forEach((entry) => {
      exactKeys(entry, ["evidenceId", "sha256"], `evidence-derived ${label} reference`);
      exactId(entry.evidenceId, `${label} evidenceId`); exactSha(entry.sha256, `${label} sha256`);
      if (hashes.has(entry.sha256)) throw new Error(`Evidence-derived ${label} authority contains duplicate evidence.`);
      hashes.add(entry.sha256);
    });
  }
}

function validateEvidenceDerivedWiring(value: FastCalibrationEvidenceDerivedWiringAuthorityV1_2): void {
  exactKeys(value, ["schemaVersion", "authorityMethod", "rigId", "controllerIdentity", "controllerUnit", "channels"], "evidence-derived wiring authority");
  if (value.schemaVersion !== EVIDENCE_DERIVED_WIRING_SCHEMA || value.authorityMethod !== "observed_leimac_acknowledged_response_v1") throw new Error("Evidence-derived wiring authority schema or method mismatch.");
  exactId(value.rigId, "evidence-derived wiring rigId"); exactId(value.controllerIdentity, "evidence-derived wiring controllerIdentity");
  if (!Number.isInteger(value.controllerUnit) || value.controllerUnit < 1 || value.controllerUnit > 255 || !Array.isArray(value.channels) || value.channels.length !== 8) throw new Error("Evidence-derived wiring requires one valid controller unit and exactly eight channels.");
  const outputs = new Set<string>(); const hashes = new Set<string>();
  value.channels.forEach((channel, index) => {
    exactKeys(channel, ["channelIndex", "controllerOutput", "responseEvidence"], "evidence-derived wiring channel");
    if (channel.channelIndex !== index + 1) throw new Error("Evidence-derived wiring channels must be ordered 1 through 8.");
    exactId(channel.controllerOutput, "evidence-derived controllerOutput");
    if (outputs.has(channel.controllerOutput)) throw new Error("Evidence-derived controller outputs must be unique.");
    outputs.add(channel.controllerOutput);
    if (!Array.isArray(channel.responseEvidence) || channel.responseEvidence.length !== 6) throw new Error("Evidence-derived wiring requires exactly six acknowledged on-channel response captures per channel.");
    channel.responseEvidence.forEach((entry) => {
      exactKeys(entry, ["evidenceId", "role", "sha256"], "evidence-derived wiring response reference");
      exactId(entry.evidenceId, "wiring response evidenceId"); exactId(entry.role, "wiring response role"); exactSha(entry.sha256, "wiring response sha256");
      if (hashes.has(entry.sha256)) throw new Error("Evidence-derived wiring response hashes must be globally unique.");
      hashes.add(entry.sha256);
    });
  });
}

function validateStageTransform(value: FastCalibrationStageTransformEvidenceV1_2): void {
  exactKeys(value, ["schemaVersion", "recordedAt", "operatorId", "rigId", "cameraSerialNumber", "cameraModelName", "lensAuthorityId", "method", "stageToUndistortedSensorMatrix", "measurementEvidenceSha256"], "stage transform evidence");
  if (value.schemaVersion !== STAGE_TRANSFORM_SCHEMA || value.method !== "supervised-stage-to-undistorted-sensor-matrix-v1") {
    throw new Error("Stage transform evidence schema or method mismatch.");
  }
  exactTimestamp(value.recordedAt, "stage transform recordedAt");
  [value.operatorId, value.rigId, value.cameraSerialNumber, value.cameraModelName, value.lensAuthorityId]
    .forEach((entry, index) => exactId(entry, `stage transform identity ${index}`));
  if (!Array.isArray(value.stageToUndistortedSensorMatrix) || value.stageToUndistortedSensorMatrix.length !== 4 ||
      value.stageToUndistortedSensorMatrix.some((entry) => !Number.isFinite(entry)) ||
      Math.abs(value.stageToUndistortedSensorMatrix[0] * value.stageToUndistortedSensorMatrix[3] -
        value.stageToUndistortedSensorMatrix[1] * value.stageToUndistortedSensorMatrix[2]) < 1e-12) {
    throw new Error("Stage transform requires one finite non-singular measured matrix.");
  }
  if (!Array.isArray(value.measurementEvidenceSha256) || value.measurementEvidenceSha256.length < 3 ||
      new Set(value.measurementEvidenceSha256).size !== value.measurementEvidenceSha256.length) {
    throw new Error("Stage transform requires at least three unique supervised measurement artifacts.");
  }
  value.measurementEvidenceSha256.forEach((entry) => exactSha(entry, "stage transform measurement evidence sha256"));
}

type CapturedArtifact = {
  evidenceId: string;
  sourceRole: string;
  kind: "capture_artifact";
  bytes: Buffer;
  metadata: JsonObject;
};

function validateCanonicalGeneratedAuthorities(input: {
  live: FastCalibrationProtectedLiveProbeEvidenceV1_2;
  components: FastCalibrationComponentAuthorityEvidenceV1_2;
  directions: FastCalibrationCanonicalDirectionFrameEvidenceV1_2;
  lens: FastCalibrationEvidenceDerivedLensAuthorityV1_2;
  wiring: FastCalibrationEvidenceDerivedWiringAuthorityV1_2;
  captureManifestSha256: string;
  physicalAnalyzerSha256: string;
  artifacts: CapturedArtifact[];
  builder?: BuildFixedRigPhysicalCalibrationV1Input;
}): void {
  const { live, components, directions, lens, wiring } = input;
  if (!("controllerUnit" in components)) throw new Error("Canonical-target materialization rejects legacy or manually supplied component authority.");
  validateEvidenceDerivedLens(lens); validateEvidenceDerivedWiring(wiring);
  if (lens.rigId !== live.rigId || lens.cameraSerialNumber !== live.camera.serialNumber ||
      lens.cameraModelName !== live.camera.modelName || lens.sourceCaptureManifestSha256 !== input.captureManifestSha256 ||
      lens.physicalAnalyzerSha256 !== input.physicalAnalyzerSha256 || directions.physicalAnalyzerSha256 !== input.physicalAnalyzerSha256 ||
      wiring.rigId !== live.rigId || wiring.controllerIdentity !== live.controller.identity || wiring.controllerUnit !== live.controller.unit ||
      components.targetVersion !== lens.targetVersion || components.targetSha256 !== lens.targetSha256) {
    throw new Error("Canonical-target authority does not bind the exact live, capture, target, and analyzer evidence.");
  }
  if (components.lensAuthorityId !== operationalId("lens-authority", lens) ||
      components.componentConfigurationId !== operationalId("component-configuration", wiring)) {
    throw new Error("Canonical-target operational lens or component identity is not content-addressed from exact evidence.");
  }
  const byId = new Map(input.artifacts.map((entry) => [entry.evidenceId, entry]));
  for (const [label, entries, roles] of [
    ["lens geometry", lens.lensGeometryEvidence, ["lens_geometry", "lens_geometry_normalized"]],
    ["normalization registration", lens.normalizationRegistrationEvidence, ["normalization_registration", "normalization_registration_normalized"]],
  ] as const) {
    for (const reference of entries) {
      const artifact = byId.get(reference.evidenceId);
      if (!artifact || artifact.metadata.sha256 !== reference.sha256 || !roles.includes(artifact.sourceRole as never)) {
        throw new Error(`Canonical-target ${label} authority contains missing, mismatched, or relabelled capture evidence.`);
      }
    }
  }
  wiring.channels.forEach((channel, index) => {
    const direction = directions.channels[index]!;
    const expectedComponentId = operationalId("component", {
      rigId: live.rigId, controllerIdentity: live.controller.identity, controllerUnit: live.controller.unit,
      controllerOutput: channel.controllerOutput, channelIndex: channel.channelIndex,
      responseEvidenceSha256: channel.responseEvidence.map((entry) => entry.sha256),
    });
    const expectedDirectionId = operationalId("physical-direction", {
      rigId: live.rigId, coordinateFrame: directions.coordinateFrame, channelIndex: direction.channelIndex,
      directionMeasurementEvidence: direction.directionMeasurementEvidence,
    });
    const binding = components.channelWiring[index]!;
    if (direction.channelIndex !== channel.channelIndex || direction.physicalDirectionId !== expectedDirectionId ||
        binding.channelIndex !== channel.channelIndex || binding.controllerOutput !== channel.controllerOutput ||
        binding.componentId !== expectedComponentId || binding.physicalDirectionId !== expectedDirectionId) {
      throw new Error("Canonical-target channel operational identities are not uniquely content-addressed from exact evidence.");
    }
    for (const response of channel.responseEvidence) {
      const artifact = byId.get(response.evidenceId);
      const metadata = artifact?.metadata;
      const leimac = metadata?.leimac as JsonObject | undefined;
      const safeOff = metadata?.safeOff as JsonObject | undefined;
      if (!artifact || artifact.sourceRole !== response.role || metadata?.sha256 !== response.sha256 ||
          metadata.artifactClass !== "raw_capture" || metadata.channelIndex !== channel.channelIndex ||
          !leimac || leimac.unit !== live.controller.unit || leimac.complete !== true ||
          !Array.isArray(leimac.enabledChannels) || leimac.enabledChannels.length !== 1 || leimac.enabledChannels[0] !== channel.channelIndex ||
          leimac.expectedWriteCount !== leimac.acknowledgedWriteCount || !Array.isArray(leimac.responseKinds) ||
          (leimac.responseKinds as unknown[]).some((entry) => entry !== "ack") || !safeOff ||
          safeOff.beforeCaptureConfirmed !== true || safeOff.afterCaptureConfirmed !== true) {
        throw new Error("Canonical-target component identity lacks exact acknowledged on-channel response evidence.");
      }
    }
    if (input.builder) {
      const samples = input.builder.channels[index]?.directionMeasurementSamples;
      if (!samples || samples.length !== 3 || samples.some((sample, sampleIndex) => {
        const expected = direction.directionMeasurementEvidence[sampleIndex]!;
        const derivedSample = sample as typeof sample & { sourceEvidenceId?: string; sourceSha256?: string };
        return sample.evidenceId !== expected.evidenceId || sample.sha256 !== expected.sha256 ||
          derivedSample.sourceEvidenceId !== expected.sourceEvidenceId || derivedSample.sourceSha256 !== expected.sourceSha256;
      })) throw new Error("Canonical-target direction identity does not bind the exact analyzer-derived direction samples.");
    }
  });
}

async function loadCaptureAuthority(input: {
  root: string;
  captureManifestRef: FileReference;
  liveProbe: FastCalibrationProtectedLiveProbeEvidenceV1_2;
  physicalAnalyzerSha256: string;
  referencesByHash: Map<string, ReferencedEvidence>;
  consumedReferenceHashes: Set<string>;
}): Promise<{ captureManifestBytes: Buffer; capturePackageBytes: Buffer; capturePackageSha256: string; artifacts: CapturedArtifact[]; packageValue: JsonObject }> {
  const captureManifestPath = contained(input.root, input.captureManifestRef.fileName);
  const captureManifestBytes = await readExact(captureManifestPath, input.captureManifestRef.sha256, "source capture manifest");
  const manifest = parseCanonical<JsonObject>(captureManifestBytes, "source capture manifest");
  if (manifest.schemaVersion !== CAPTURE_MANIFEST_SCHEMA || manifest.captureProfileVersion !== CAPTURE_PROFILE) {
    throw new Error("Rig materialization requires the exact supervised V1.0.1 raw capture manifest, never an old profile or V1.1 projection.");
  }
  exactKeys(manifest.sourceCapturePackage, ["packageId", "path", "sha256"], "source capture package binding");
  const packageRef = manifest.sourceCapturePackage as { packageId: string; path: string; sha256: string };
  exactId(packageRef.packageId, "source capture packageId");
  safeRelative(packageRef.path, "source capture package path");
  exactSha(packageRef.sha256, "source capture package sha256");
  const capturePackageBytes = await readExact(contained(input.root, packageRef.path), packageRef.sha256, "source capture package");
  const packageValue = parseCanonical<JsonObject>(capturePackageBytes, "source capture package");
  if (packageValue.schemaVersion !== CAPTURE_PACKAGE_SCHEMA || packageValue.captureProfileVersion !== CAPTURE_PROFILE ||
      packageValue.purpose !== "mathematical_calibration_v1" || packageValue.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
      packageValue.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH) {
    throw new Error("Source capture package is not exact supervised Mathematical V1.0.1 raw evidence.");
  }
  const evidenceDerivedAuthority = packageValue.evidenceDerivedAuthority as JsonObject;
  if (!evidenceDerivedAuthority) throw new Error("Source capture package lacks evidence-derived threshold authority.");
  exactKeys(evidenceDerivedAuthority, ["thresholdSetId", "thresholdSetHash", "uncertaintyCoverageFactor"], "evidence-derived threshold authority");
  if (evidenceDerivedAuthority.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
      evidenceDerivedAuthority.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH ||
      evidenceDerivedAuthority.uncertaintyCoverageFactor !== MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.coverageFactor) {
    throw new Error("Evidence-derived uncertainty does not bind the loaded centralized threshold authority.");
  }
  const subject = packageValue.subject as JsonObject;
  if (!subject || subject.designation !== "calibration_target" || subject.productionCard !== false) {
    throw new Error("Source capture package must be a non-production calibration target.");
  }
  const subjectTargetVersion = exactId(subject.targetVersion, "source capture targetVersion");
  const subjectTargetSha256 = exactSha(subject.targetSha256, "source capture targetSha256");
  const station = packageValue.stationAuthority as JsonObject;
  const settings = station?.protectedSettings as JsonObject;
  if (!station || station.noProductionMutation !== true || !settings || settings.stationId !== input.liveProbe.stationId ||
      settings.rigId !== input.liveProbe.rigId || settings.captureProfileVersion !== CAPTURE_PROFILE ||
      settings.exposureUs !== input.liveProbe.camera.exposureUs || settings.gain !== input.liveProbe.camera.gain ||
      settings.dutyPercent !== input.liveProbe.dutyPercent || settings.leimacUnit !== input.liveProbe.controller.unit) {
    throw new Error("Source capture protected settings differ from the protected live probe.");
  }
  const artifactsValue = packageValue.artifacts;
  if (!Array.isArray(artifactsValue) || artifactsValue.length === 0) throw new Error("Source capture package has no exact artifact ledger.");
  const ids = new Set<string>();
  const paths = new Set<string>();
  const hashes = new Set<string>();
  const artifacts: CapturedArtifact[] = [];
  let rawCount = 0;
  let normalizedCount = 0;
  let measurementCount = 0;
  let targetCount = 0;
  for (const candidate of artifactsValue) {
    const artifact = candidate as JsonObject;
    const evidenceId = exactId(artifact.evidenceId, "capture artifact evidenceId");
    const relative = safeRelative(artifact.path, "capture artifact path");
    const sha256 = exactSha(artifact.sha256, "capture artifact sha256");
    const sourceRole = exactId(artifact.role, "capture artifact role");
    if (ids.has(evidenceId) || paths.has(relative) || hashes.has(sha256)) throw new Error("Source capture package contains duplicate or relabelled evidence.");
    ids.add(evidenceId); paths.add(relative); hashes.add(sha256);
    const bytes = await readExact(contained(input.root, relative), sha256, `capture artifact ${evidenceId}`);
    if (!Number.isInteger(artifact.byteSize) || artifact.byteSize !== bytes.length || artifact.rigId !== input.liveProbe.rigId ||
        artifact.captureProfileVersion !== CAPTURE_PROFILE || artifact.subjectDesignation !== "calibration_target" || artifact.productionCard !== false) {
      throw new Error("Source capture artifact metadata differs from its exact bytes or protected identity.");
    }
    if (artifact.artifactClass === "raw_capture") {
      rawCount += 1;
      const camera = artifact.camera as JsonObject;
      const pylon = artifact.pylon as JsonObject;
      const leimac = artifact.leimac as JsonObject;
      const safeOff = artifact.safeOff as JsonObject;
      if (!camera || camera.serialNumber !== input.liveProbe.camera.serialNumber || camera.modelName !== input.liveProbe.camera.modelName ||
          camera.transport !== "GigE" || camera.sourcePixelFormat !== input.liveProbe.camera.pixelFormat ||
          camera.exposureUs !== input.liveProbe.camera.exposureUs || camera.gain !== input.liveProbe.camera.gain ||
          !pylon || typeof pylon.version !== "string" || typeof pylon.bridgeVersion !== "string" ||
          !leimac || leimac.unit !== input.liveProbe.controller.unit || leimac.complete !== true ||
          leimac.expectedWriteCount !== leimac.acknowledgedWriteCount || !Array.isArray(leimac.responseKinds) ||
          (leimac.responseKinds as unknown[]).some((entry) => entry !== "ack") || !safeOff ||
          safeOff.beforeCaptureConfirmed !== true || safeOff.afterCaptureConfirmed !== true) {
        throw new Error("Raw capture lacks exact observed camera/controller/safe-off authority.");
      }
    } else if (artifact.artifactClass === "normalized_derivative") normalizedCount += 1;
    else if (artifact.artifactClass === "measurement") {
      measurementCount += 1;
      const measurement = parseCanonical<JsonObject>(bytes, `measurement artifact ${evidenceId}`);
      const instrument = measurement.instrument as JsonObject;
      if (!instrument) throw new Error("Measurement artifact lacks exact instrument authority.");
      const protectedTargetGeometry = validateProtectedTargetGeometryInstrument(
        instrument,
        subjectTargetVersion,
        subjectTargetSha256,
      );
      const instrumentHash = protectedTargetGeometry
        ? subjectTargetSha256
        : exactSha(instrument.calibrationSha256, "measurement instrument authority sha256");
      if (protectedTargetGeometry) {
        validateProtectedTargetGeometryMeasurement(measurement, sourceRole, subjectTargetSha256);
      } else if (instrument.kind === "fixed_rig_geometry") {
        if (instrumentHash !== input.physicalAnalyzerSha256) throw new Error("Repeatability measurement does not bind the loaded physical analyzer bytes.");
      } else {
        const reference = input.referencesByHash.get(instrumentHash);
        if (!reference || reference.role !== "instrument_calibration") throw new Error("Measurement instrument authority hash is not dereferenced to exact purpose-bound bytes.");
        input.consumedReferenceHashes.add(instrumentHash);
      }
      if (measurement.sourceMetrologyArtifactSha256 !== undefined) {
        const metrologyHash = exactSha(measurement.sourceMetrologyArtifactSha256, "measurement source metrology sha256");
        const reference = input.referencesByHash.get(metrologyHash);
        if (!reference || reference.role !== "metrology_source") throw new Error("Measurement metrology hash is not dereferenced to exact bytes.");
        input.consumedReferenceHashes.add(metrologyHash);
      }
    } else if (artifact.artifactClass === "target") {
      targetCount += 1;
      if (sourceRole !== "print_verified_calibration_target" || sha256 !== subjectTargetSha256) {
        throw new Error("Protected target artifact does not match the source capture target identity.");
      }
    }
    else throw new Error("Source capture artifact class is not allowlisted.");
    artifacts.push({ evidenceId, sourceRole, kind: "capture_artifact", bytes, metadata: artifact });
  }
  if (rawCount !== 102 || normalizedCount !== 102 || measurementCount !== 78 || targetCount !== 1 || artifacts.length !== 283) {
    throw new Error("Source capture package must contain exact V1.0.1 102-capture/78-measurement supervised evidence with no extras.");
  }
  return { captureManifestBytes, capturePackageBytes, capturePackageSha256: hash(capturePackageBytes), artifacts, packageValue };
}

function allBuilderEvidence(input: BuildFixedRigPhysicalCalibrationV1Input): FixedRigCalibrationEvidenceReferenceV1[] {
  return [
    ...input.targetEvidence, ...input.scaleSamples, ...input.targetPrintScaleSamples, ...input.targetCutDimensionSamples,
    ...input.lensResidualSamples, ...input.normalizationResidualSamples, ...input.repeatedPlacementSamples,
    ...input.segmentationBoundarySamples, ...input.measurementRepeatabilitySamples,
    ...input.channels.flatMap((channel) => channel.directionMeasurementSamples),
    ...input.channels.flatMap((channel) => channel.flatFieldFrames),
    ...input.channels.flatMap((channel) => channel.darkControlFrames),
    ...input.channels.flatMap((channel) => channel.illuminationPatternFrames),
  ];
}

function validateBuilderInput(builder: BuildFixedRigPhysicalCalibrationV1Input, artifacts: CapturedArtifact[], derived: FastCalibrationRigMaterializationAnalysisResultV1_2["derivedArtifacts"]): void {
  exactKeys(builder, ["profileId", "calibrationVersion", "rigId", "artifactId", "finalizedAt", "normalizedWidthPx", "normalizedHeightPx", "scaleSamples", "targetPrintScaleSamples", "targetCutDimensionSamples", "lensResidualSamples", "normalizationResidualSamples", "repeatedPlacementSamples", "segmentationBoundarySamples", "measurementRepeatabilitySamples", "channels", "targetEvidence", "operatorId", "targetVersion", "targetSha256", "lensModel", "normalizationModel"], "physical analyzer builderInput");
  const byId = new Map(artifacts.map((entry) => [entry.evidenceId, entry]));
  for (const evidence of allBuilderEvidence(builder)) {
    const artifact = byId.get(exactId(evidence.evidenceId, "builder evidenceId"));
    if (!artifact || artifact.sourceRole !== evidence.role || hash(artifact.bytes) !== exactSha(evidence.sha256, "builder evidence sha256")) {
      throw new Error("Physical analyzer result contains unverified, relabelled, or corrupt evidence linkage.");
    }
  }
  const derivedHashes = new Map(derived.map((entry) => [hash(entry.bytes), entry]));
  if (derived.length !== 9 || new Set(derived.map((entry) => hash(entry.bytes))).size !== derived.length) {
    throw new Error("Physical analyzer must return exactly eight unique flat fields and one unique illumination artifact.");
  }
  const consumedDerivedHashes = new Set<string>();
  for (const channel of builder.channels) {
    const flatSha256 = exactSha(channel.flatFieldArtifactSha256, "flat-field artifact sha256");
    const illuminationSha256 = exactSha(channel.illuminationPatternArtifactSha256, "illumination artifact sha256");
    const flat = derivedHashes.get(flatSha256);
    const illumination = derivedHashes.get(illuminationSha256);
    if (!flat || flat.kind !== "derived_flat_field" || !illumination || illumination.kind !== "derived_illumination_pattern") {
      throw new Error("Physical analyzer channel artifacts are not dereferenced to exact derived bytes.");
    }
    consumedDerivedHashes.add(flatSha256); consumedDerivedHashes.add(illuminationSha256);
  }
  if (consumedDerivedHashes.size !== derived.length) {
    throw new Error("Physical analyzer returned unused or relabelled derived artifacts.");
  }
}

type AnalyzerProcessExit = { code: number | null; signal: NodeJS.Signals | null };

async function terminateAnalyzerProcess(input: {
  child: ReturnType<typeof spawn>;
  exit: Promise<AnalyzerProcessExit>;
  timeoutMs: number;
}): Promise<void> {
  if (input.child.exitCode === null && input.child.signalCode === null) {
    try { input.child.kill("SIGKILL"); } catch { /* bounded exit wait below remains authoritative */ }
  }
  let timer: NodeJS.Timeout | undefined;
  const closed = await Promise.race([
    input.exit.then(() => true),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), input.timeoutMs); }),
  ]);
  if (timer) clearTimeout(timer);
  if (!closed) throw new Error("Physical calibration analyzer cleanup timed out before process exit.");
}

async function runProcess(executable: string, args: string[], timeoutMs: number, terminationTimeoutMs = 5_000): Promise<void> {
  const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4000); });
  const exit = new Promise<AnalyzerProcessExit>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  let timeout: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      exit.then((value) => ({ kind: "exit" as const, value })),
      new Promise<{ kind: "error"; error: Error }>((resolve) => {
        child.once("error", (error) => resolve({ kind: "error", error }));
      }),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);
    if (outcome.kind === "timeout") {
      await terminateAnalyzerProcess({ child, exit, timeoutMs: terminationTimeoutMs });
      throw new Error("Physical calibration analyzer timed out after bounded process cleanup.");
    }
    if (outcome.kind === "error") {
      await terminateAnalyzerProcess({ child, exit, timeoutMs: terminationTimeoutMs });
      throw outcome.error;
    }
    if (outcome.value.code !== 0) {
      throw new Error(`Physical calibration analyzer failed closed (${outcome.value.code ?? outcome.value.signal ?? "no-exit"}): ${stderr}`);
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const PHYSICAL_ANALYSIS_PAYLOAD_KEYS = [
  "schemaVersion", "algorithmVersion", "sourceManifestSha256", "sourceCapturePackage",
  "captureEvidenceAudit", "builderInput", "flatFieldArtifacts", "illuminationPatternArtifact",
] as const;

export async function readVerifiedPhysicalAnalysisOutputV1_2(input: {
  outputDir: string;
  captureManifestSha256: string;
}): Promise<FastCalibrationRigMaterializationAnalysisResultV1_2> {
  const resultBytes = await readFile(path.join(input.outputDir, "mathematical-calibration-analysis-v1.json"));
  let result: JsonObject;
  try { result = JSON.parse(resultBytes.toString("utf8")) as JsonObject; } catch { throw new Error("Physical analyzer result is not valid JSON."); }
  exactKeys(result, [...PHYSICAL_ANALYSIS_PAYLOAD_KEYS, "hashPolicy", "analysisPayloadJson", "analysisSha256"], "physical analyzer result envelope");
  if (result.hashPolicy !== "sha256-exact-utf8-analysisPayloadJson") throw new Error("Physical analyzer result hash policy mismatch.");
  const payloadJson = result.analysisPayloadJson;
  const analysisSha256 = exactSha(result.analysisSha256, "physical analyzer analysisSha256");
  if (typeof payloadJson !== "string" || hash(Buffer.from(payloadJson, "utf8")) !== analysisSha256) {
    throw new Error("Physical analyzer result hash does not bind its exact payload.");
  }
  let payload: JsonObject;
  try { payload = JSON.parse(payloadJson) as JsonObject; } catch { throw new Error("Physical analyzer canonical payload is not valid JSON."); }
  exactKeys(payload, PHYSICAL_ANALYSIS_PAYLOAD_KEYS, "physical analyzer canonical payload");
  if (payload.schemaVersion !== PHYSICAL_ANALYSIS_SCHEMA || payload.algorithmVersion !== PHYSICAL_ANALYSIS_ALGORITHM ||
      payload.sourceManifestSha256 !== input.captureManifestSha256) throw new Error("Physical analyzer payload identity mismatch.");
  for (const key of PHYSICAL_ANALYSIS_PAYLOAD_KEYS) {
    if (!isDeepStrictEqual(result[key], payload[key])) throw new Error(`Physical analyzer envelope ${key} differs from its hash-bound payload.`);
  }
  const flat = Array.isArray(payload.flatFieldArtifacts) ? payload.flatFieldArtifacts as JsonObject[] : [];
  const illumination = payload.illuminationPatternArtifact as JsonObject;
  const derivedArtifacts: FastCalibrationRigMaterializationAnalysisResultV1_2["derivedArtifacts"] = [];
  for (const entry of flat) {
    exactKeys(entry, ["channelIndex", "artifactFileName", "artifactFileSha256", "contentSha256", "maximumResidualDeviationFraction"], "physical analyzer flat-field reference");
    const fileName = safeRelative(entry.artifactFileName, "physical analyzer flat-field fileName");
    const bytes = await readExact(contained(input.outputDir, fileName), exactSha(entry.artifactFileSha256, "physical analyzer flat-field sha256"), "physical analyzer flat-field artifact");
    derivedArtifacts.push({ kind: "derived_flat_field", sourceRole: fileName.replace(/\.json$/, ""), bytes });
  }
  if (!illumination) throw new Error("Physical analyzer did not emit an illumination-pattern artifact.");
  exactKeys(illumination, ["artifactFileName", "artifactFileSha256", "contentSha256"], "physical analyzer illumination reference");
  const illuminationName = safeRelative(illumination.artifactFileName, "physical analyzer illumination fileName");
  const illuminationBytes = await readExact(contained(input.outputDir, illuminationName), exactSha(illumination.artifactFileSha256, "physical analyzer illumination sha256"), "physical analyzer illumination artifact");
  derivedArtifacts.push({ kind: "derived_illumination_pattern", sourceRole: "illumination-pattern-v1", bytes: illuminationBytes });
  return { builderInput: payload.builderInput as unknown as BuildFixedRigPhysicalCalibrationV1Input, derivedArtifacts };
}

async function defaultAnalyzePhysicalEvidence(input: {
  captureManifestPath: string;
  captureManifestSha256: string;
  outputDir: string;
  analyzerScriptPath: string;
}): Promise<FastCalibrationRigMaterializationAnalysisResultV1_2> {
  await mkdir(input.outputDir, { recursive: true });
  await runProcess("python", [input.analyzerScriptPath, "--manifest", input.captureManifestPath, "--output-dir", input.outputDir], 10 * 60_000);
  return readVerifiedPhysicalAnalysisOutputV1_2({
    outputDir: input.outputDir,
    captureManifestSha256: input.captureManifestSha256,
  });
}

function sourceEntry(kind: string, evidenceId: string, sourceRole: string, bytes: Buffer, index: number): { manifest: FastCalibrationRigSourceEvidenceEntryV1_2; bytes: Buffer } {
  const sha256 = hash(bytes);
  return {
    manifest: {
      kind, evidenceId, sourceRole,
      fileName: `${FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_DIR_V1_2}/${String(index).padStart(4, "0")}-${sha256}.bin`,
      sha256, byteSize: bytes.length,
    },
    bytes,
  };
}

async function writeExclusive(filePath: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes, { flag: "wx" });
}

function referenceByRole(references: ReferencedEvidence[], hashValue: string, role: string): ReferencedEvidence {
  const reference = references.find((entry) => entry.sha256 === hashValue && entry.role === role);
  if (!reference) throw new Error(`${role} authority hash is not dereferenced to exact supervised bytes.`);
  return reference;
}

function expectedTopLevelEntries(): string[] {
  return [
    FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2,
    FAST_CALIBRATION_RIG_SOURCE_BUNDLE_FILE_V1_2,
    FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_FILE_V1_2,
    FAST_CALIBRATION_RIG_PHYSICAL_ANALYSIS_FILE_V1_2,
    FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_FILE_V1_2,
    FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_DIR_V1_2,
    ...RIG_MEMBER_SPECS.map((entry) => entry.fileName),
  ].sort();
}

export async function loadMaterializedFastCalibrationRigAuthorityV1_2(input: {
  directory: string;
  expectedRuntimeContextSha256?: string;
  expectedRigSourceBundleSha256?: string;
}): Promise<MaterializedFastCalibrationRigAuthorityV1_2> {
  if (!path.isAbsolute(input.directory)) throw new Error("Materialized rig authority directory must be absolute.");
  const actualTop = (await readdir(input.directory)).sort();
  const expectedTop = expectedTopLevelEntries();
  if (actualTop.length !== expectedTop.length || actualTop.some((entry, index) => entry !== expectedTop[index])) {
    throw new Error("Materialized rig authority directory is partial or contains unexpected files.");
  }
  const runtimeBytes = await readFile(path.join(input.directory, FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2));
  const runtimeSha256 = hash(runtimeBytes);
  if (input.expectedRuntimeContextSha256 && runtimeSha256 !== input.expectedRuntimeContextSha256) throw new Error("Materialized runtime context hash mismatch.");
  const runtimeContext = parseCanonical<FastCalibrationRuntimeContextV1_2>(runtimeBytes, "materialized runtime context");
  validateFastCalibrationRuntimeContextV1_2(runtimeContext);
  if (runtimeContext.algorithmHashes.geometry !== FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2_SHA256 ||
      runtimeContext.algorithmHashes.photometric !== FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2_SHA256 ||
      runtimeContext.algorithmHashes.finalizer !== FIXED_RIG_FAST_CALIBRATION_FINALIZER_V1_2_SHA256 ||
      runtimeContext.algorithmHashes.thresholdManifest !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH) {
    throw new Error("Materialized runtime context algorithm identity differs from the loaded Production implementation.");
  }
  const bundleBytes = await readFile(path.join(input.directory, FAST_CALIBRATION_RIG_SOURCE_BUNDLE_FILE_V1_2));
  const bundleSha256 = hash(bundleBytes);
  if (input.expectedRigSourceBundleSha256 && bundleSha256 !== input.expectedRigSourceBundleSha256) throw new Error("Materialized rig source bundle hash mismatch.");
  const bundle = parseCanonical<JsonObject>(bundleBytes, "materialized rig source bundle");
  const evidenceManifestBytes = await readFile(path.join(input.directory, FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_FILE_V1_2));
  if (hash(evidenceManifestBytes) !== bundle.sourceEvidenceManifestSha256) throw new Error("Rig source bundle does not bind the exact source-evidence manifest.");
  const evidence = parseCanonical<FastCalibrationRigSourceEvidenceManifestV1_2>(evidenceManifestBytes, "materialized source-evidence manifest");
  exactKeys(evidence, ["schemaVersion", "inputManifestSha256", "sourceCaptureManifestSha256", "sourceCapturePackageSha256", "physicalAnalyzerSha256", "physicalAnalyzerDependencyManifestSha256", "files"], "materialized source-evidence manifest");
  if (evidence.schemaVersion !== FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_SCHEMA_V1_2 || !Array.isArray(evidence.files)) throw new Error("Materialized source-evidence manifest schema mismatch.");
  exactSha(evidence.inputManifestSha256, "materialized input manifest sha256");
  exactSha(evidence.sourceCaptureManifestSha256, "materialized source capture manifest sha256");
  exactSha(evidence.sourceCapturePackageSha256, "materialized source capture package sha256");
  exactSha(evidence.physicalAnalyzerSha256, "materialized physical analyzer sha256");
  exactSha(evidence.physicalAnalyzerDependencyManifestSha256, "materialized analyzer dependency sha256");
  const evidenceDirectory = path.join(input.directory, FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_DIR_V1_2);
  const expectedEvidenceNames = evidence.files.map((entry) => path.basename(entry.fileName)).sort();
  const actualEvidenceNames = (await readdir(evidenceDirectory)).sort();
  if (expectedEvidenceNames.length !== actualEvidenceNames.length || expectedEvidenceNames.some((entry, index) => entry !== actualEvidenceNames[index])) {
    throw new Error("Materialized source evidence is missing, duplicated, or contains extra files.");
  }
  const evidenceBytes = new Map<string, Buffer>();
  const evidenceEntries = new Map<string, FastCalibrationRigSourceEvidenceEntryV1_2>();
  const evidenceIds = new Set<string>();
  const evidenceHashes = new Set<string>();
  for (const entry of evidence.files) {
    exactKeys(entry, ["kind", "evidenceId", "sourceRole", "fileName", "sha256", "byteSize"], "materialized evidence entry");
    safeRelative(entry.fileName, "materialized evidence fileName");
    exactId(entry.kind, "materialized evidence kind");
    exactId(entry.evidenceId, "materialized evidenceId");
    exactId(entry.sourceRole, "materialized evidence sourceRole");
    exactSha(entry.sha256, "materialized evidence sha256");
    if (evidenceIds.has(entry.evidenceId) || evidenceHashes.has(entry.sha256)) throw new Error("Materialized source evidence is duplicated or relabelled.");
    evidenceIds.add(entry.evidenceId); evidenceHashes.add(entry.sha256);
    const bytes = await readExact(contained(input.directory, entry.fileName), entry.sha256, `materialized evidence ${entry.evidenceId}`);
    if (entry.byteSize !== bytes.length) throw new Error("Materialized evidence byte size mismatch.");
    evidenceBytes.set(entry.evidenceId, bytes);
    evidenceEntries.set(entry.evidenceId, entry);
  }
  const requireEvidence = (evidenceId: string, kind: string, expectedSha256?: string): { entry: FastCalibrationRigSourceEvidenceEntryV1_2; bytes: Buffer } => {
    const entry = evidenceEntries.get(evidenceId);
    const bytes = evidenceBytes.get(evidenceId);
    if (!entry || !bytes || entry.kind !== kind || (expectedSha256 !== undefined && entry.sha256 !== expectedSha256)) {
      throw new Error(`Materialized ${evidenceId} evidence identity or hash mismatch.`);
    }
    return { entry, bytes };
  };
  const inputManifestEvidence = requireEvidence("rig-materialization-input", "input_manifest", evidence.inputManifestSha256);
  const sourceInput = parseCanonical<FastCalibrationRigMaterializationInputManifestV1_2>(inputManifestEvidence.bytes, "materialized rig input manifest");
  validateInputManifest(sourceInput);
  const canonicalDirection = "directionFrameEvidence" in sourceInput;
  const liveEvidence = requireEvidence("protected-live-probe", "live_probe", sourceInput.liveProbe.sha256);
  const componentEvidence = requireEvidence(canonicalDirection ? "evidence-derived-components" : "component-supervision", "component_evidence", sourceInput.componentEvidence.sha256);
  const directionEvidence = canonicalDirection
    ? requireEvidence("canonical-target-directions", "direction_frame", sourceInput.directionFrameEvidence.sha256)
    : requireEvidence("stage-transform", "stage_transform", sourceInput.stageTransformEvidence.sha256);
  const live = parseCanonical<FastCalibrationProtectedLiveProbeEvidenceV1_2>(liveEvidence.bytes, "materialized protected live probe");
  const components = parseCanonical<FastCalibrationComponentAuthorityEvidenceV1_2>(componentEvidence.bytes, "materialized component evidence");
  const directionAuthority = canonicalDirection
    ? parseCanonical<FastCalibrationCanonicalDirectionFrameEvidenceV1_2>(directionEvidence.bytes, "materialized canonical target direction evidence")
    : parseCanonical<FastCalibrationStageTransformEvidenceV1_2>(directionEvidence.bytes, "materialized stage transform evidence");
  validateLiveProbe(live); validateComponentEvidence(components);
  if (canonicalDirection) validateCanonicalDirectionFrame(directionAuthority as FastCalibrationCanonicalDirectionFrameEvidenceV1_2);
  else validateStageTransform(directionAuthority as FastCalibrationStageTransformEvidenceV1_2);
  if (components.rigId !== live.rigId || components.controllerIdentity !== live.controller.identity ||
      directionAuthority.rigId !== live.rigId ||
      (!canonicalDirection && ((directionAuthority as FastCalibrationStageTransformEvidenceV1_2).cameraSerialNumber !== live.camera.serialNumber ||
        (directionAuthority as FastCalibrationStageTransformEvidenceV1_2).cameraModelName !== live.camera.modelName ||
        (directionAuthority as FastCalibrationStageTransformEvidenceV1_2).lensAuthorityId !== components.lensAuthorityId ||
        !("operatorId" in components) || components.operatorId !== (directionAuthority as FastCalibrationStageTransformEvidenceV1_2).operatorId)) ||
      (canonicalDirection && (!("controllerUnit" in components) || components.controllerUnit !== live.controller.unit))) {
    throw new Error("Materialized component/stage/live evidence identities do not match.");
  }
  for (const reference of sourceInput.referencedEvidence) {
    const matching = evidence.files.filter((entry) => entry.kind === "referenced_evidence" &&
      entry.sourceRole === reference.role && entry.sha256 === reference.sha256);
    if (matching.length !== 1) throw new Error("Materialized supervised reference is missing, duplicated, or relabelled.");
  }
  const sourceReferenceByHash = new Map(sourceInput.referencedEvidence.map((entry) => [entry.sha256, entry]));
  const consumedSourceReferenceHashes = new Set<string>();
  const consumeSourceReference = (sha256: string, role: string): void => {
    const reference = sourceReferenceByHash.get(sha256);
    if (!reference || reference.role !== role) throw new Error(`Materialized ${role} authority is not dereferenced to exact supervised bytes.`);
    consumedSourceReferenceHashes.add(sha256);
  };
  consumeSourceReference(components.lensAuthorityEvidenceSha256, "lens_authority");
  consumeSourceReference(components.wiringEvidenceSha256, "component_wiring");
  if (!canonicalDirection) (directionAuthority as FastCalibrationStageTransformEvidenceV1_2).measurementEvidenceSha256
    .forEach((sha256) => consumeSourceReference(sha256, "stage_transform_measurement"));
  const referencedBytesByHash = (sha256: string): Buffer => {
    const entry = evidence.files.find((candidate) => candidate.kind === "referenced_evidence" && candidate.sha256 === sha256);
    const bytes = entry ? evidenceBytes.get(entry.evidenceId) : undefined;
    if (!bytes) throw new Error("Materialized referenced authority bytes are missing.");
    return bytes;
  };
  const canonicalLens = canonicalDirection
    ? parseCanonical<FastCalibrationEvidenceDerivedLensAuthorityV1_2>(referencedBytesByHash(components.lensAuthorityEvidenceSha256), "materialized evidence-derived lens authority")
    : undefined;
  const canonicalWiring = canonicalDirection
    ? parseCanonical<FastCalibrationEvidenceDerivedWiringAuthorityV1_2>(referencedBytesByHash(components.wiringEvidenceSha256), "materialized evidence-derived wiring authority")
    : undefined;
  const analyzerEvidence = requireEvidence("physical-analyzer-source", "physical_analyzer", evidence.physicalAnalyzerSha256);
  const analyzerDependencyEvidence = requireEvidence("physical-analyzer-dependencies", "physical_analyzer_dependency", evidence.physicalAnalyzerDependencyManifestSha256);
  const analyzerScriptPath = path.resolve(__dirname, "../../../../scripts/ai-grader/analyze-mathematical-calibration-v1.py");
  const analyzerDependencyPath = path.resolve(__dirname, "../../../../scripts/ai-grader/requirements-mathematical-calibration-v1.txt");
  if (hash(await readFile(analyzerScriptPath)) !== analyzerEvidence.entry.sha256 ||
      hash(await readFile(analyzerDependencyPath)) !== analyzerDependencyEvidence.entry.sha256) {
    throw new Error("Materialized physical analyzer authority differs from the shipped Production analyzer/dependencies.");
  }
  const captureManifestEvidence = requireEvidence("source-capture-manifest", "capture_manifest", evidence.sourceCaptureManifestSha256);
  const capturePackageEvidence = requireEvidence("source-capture-package", "capture_package", evidence.sourceCapturePackageSha256);
  if (sourceInput.captureManifest.sha256 !== captureManifestEvidence.entry.sha256) {
    throw new Error("Materialized input manifest does not bind the exact source capture manifest bytes.");
  }
  const captureManifest = parseCanonical<JsonObject>(captureManifestEvidence.bytes, "materialized source capture manifest");
  const capturePackage = parseCanonical<JsonObject>(capturePackageEvidence.bytes, "materialized source capture package");
  if (captureManifest.schemaVersion !== CAPTURE_MANIFEST_SCHEMA || captureManifest.captureProfileVersion !== CAPTURE_PROFILE ||
      capturePackage.schemaVersion !== CAPTURE_PACKAGE_SCHEMA || capturePackage.captureProfileVersion !== CAPTURE_PROFILE ||
      capturePackage.purpose !== "mathematical_calibration_v1" || capturePackage.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
      capturePackage.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH) {
    throw new Error("Materialized capture authority is not exact supervised Mathematical V1.0.1 raw evidence.");
  }
  const materializedEvidenceAuthority = capturePackage.evidenceDerivedAuthority as JsonObject;
  if (!materializedEvidenceAuthority) throw new Error("Materialized capture package lacks evidence-derived threshold authority.");
  exactKeys(materializedEvidenceAuthority, ["thresholdSetId", "thresholdSetHash", "uncertaintyCoverageFactor"], "materialized evidence-derived threshold authority");
  if (materializedEvidenceAuthority.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
      materializedEvidenceAuthority.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH ||
      materializedEvidenceAuthority.uncertaintyCoverageFactor !== MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.coverageFactor) {
    throw new Error("Materialized evidence-derived uncertainty differs from the loaded threshold authority.");
  }
  exactKeys(captureManifest.sourceCapturePackage, ["packageId", "path", "sha256"], "materialized source capture package binding");
  if ((captureManifest.sourceCapturePackage as JsonObject).sha256 !== capturePackageEvidence.entry.sha256) {
    throw new Error("Materialized capture manifest does not bind the exact copied capture package bytes.");
  }
  const captureSubject = capturePackage.subject as JsonObject;
  if (!captureSubject || captureSubject.designation !== "calibration_target" || captureSubject.productionCard !== false) {
    throw new Error("Materialized capture package must retain the non-production calibration target identity.");
  }
  const captureTargetVersion = exactId(captureSubject.targetVersion, "materialized capture targetVersion");
  const captureTargetSha256 = exactSha(captureSubject.targetSha256, "materialized capture targetSha256");
  const station = capturePackage.stationAuthority as JsonObject;
  const settings = station?.protectedSettings as JsonObject;
  if (!station || station.noProductionMutation !== true || !settings || settings.stationId !== live.stationId ||
      settings.rigId !== live.rigId || settings.captureProfileVersion !== CAPTURE_PROFILE ||
      settings.exposureUs !== live.camera.exposureUs || settings.gain !== live.camera.gain ||
      settings.dutyPercent !== live.dutyPercent || settings.leimacUnit !== live.controller.unit) {
    throw new Error("Materialized capture protected settings differ from the protected live probe.");
  }
  if (!Array.isArray(capturePackage.artifacts) || capturePackage.artifacts.length !== 283) {
    throw new Error("Materialized capture package must retain the exact 283-artifact ledger.");
  }
  const materializedArtifacts: CapturedArtifact[] = [];
  for (const candidate of capturePackage.artifacts) {
    const artifact = candidate as JsonObject;
    const artifactEntry = evidenceEntries.get(exactId(artifact.evidenceId, "materialized capture artifact evidenceId"));
    if (!artifactEntry || artifactEntry.kind !== "capture_artifact" || artifactEntry.sha256 !== artifact.sha256 ||
        artifactEntry.sourceRole !== artifact.role || artifactEntry.byteSize !== artifact.byteSize) {
      throw new Error("Materialized capture artifact bytes are missing, corrupt, or relabelled.");
    }
    const artifactBytes = evidenceBytes.get(artifactEntry.evidenceId);
    if (!artifactBytes) throw new Error("Materialized capture artifact bytes are missing.");
    materializedArtifacts.push({ evidenceId: artifactEntry.evidenceId, sourceRole: artifactEntry.sourceRole, kind: "capture_artifact", bytes: artifactBytes, metadata: artifact });
    if (artifact.artifactClass === "raw_capture") {
      const camera = artifact.camera as JsonObject;
      const leimac = artifact.leimac as JsonObject;
      const safeOff = artifact.safeOff as JsonObject;
      if (!camera || camera.serialNumber !== live.camera.serialNumber || camera.modelName !== live.camera.modelName ||
          camera.transport !== "GigE" || camera.sourcePixelFormat !== live.camera.pixelFormat ||
          camera.exposureUs !== live.camera.exposureUs || camera.gain !== live.camera.gain ||
          !leimac || leimac.unit !== live.controller.unit || leimac.complete !== true ||
          leimac.expectedWriteCount !== leimac.acknowledgedWriteCount || !Array.isArray(leimac.responseKinds) ||
          (leimac.responseKinds as unknown[]).some((entry) => entry !== "ack") || !safeOff ||
          safeOff.beforeCaptureConfirmed !== true || safeOff.afterCaptureConfirmed !== true) {
        throw new Error("Materialized raw capture does not reproduce observed camera/controller/safe-off authority.");
      }
    } else if (artifact.artifactClass === "measurement") {
      const measurementBytes = evidenceBytes.get(artifactEntry.evidenceId);
      if (!measurementBytes) throw new Error("Materialized measurement bytes are missing.");
      const measurement = parseCanonical<JsonObject>(measurementBytes, `materialized measurement ${artifactEntry.evidenceId}`);
      const instrument = measurement.instrument as JsonObject;
      if (!instrument) throw new Error("Materialized measurement lacks instrument authority.");
      const protectedTargetGeometry = validateProtectedTargetGeometryInstrument(
        instrument,
        captureTargetVersion,
        captureTargetSha256,
      );
      const instrumentSha256 = protectedTargetGeometry
        ? captureTargetSha256
        : exactSha(instrument.calibrationSha256, "materialized measurement instrument sha256");
      if (protectedTargetGeometry) {
        validateProtectedTargetGeometryMeasurement(measurement, artifactEntry.sourceRole, captureTargetSha256);
        const targetEntry = evidence.files.find((entry) => entry.kind === "capture_artifact" &&
          entry.sourceRole === "print_verified_calibration_target" && entry.sha256 === captureTargetSha256);
        if (!targetEntry) throw new Error("Materialized protected target geometry bytes are unavailable.");
      } else if (instrument.kind === "fixed_rig_geometry") {
        if (instrumentSha256 !== evidence.physicalAnalyzerSha256) throw new Error("Materialized repeatability measurement does not bind the shipped physical analyzer.");
      } else {
        consumeSourceReference(instrumentSha256, "instrument_calibration");
      }
      if (measurement.sourceMetrologyArtifactSha256 !== undefined) {
        consumeSourceReference(exactSha(measurement.sourceMetrologyArtifactSha256, "materialized measurement metrology sha256"), "metrology_source");
      }
    } else if (artifact.artifactClass === "target" &&
        (artifactEntry.sourceRole !== "print_verified_calibration_target" || artifactEntry.sha256 !== captureTargetSha256)) {
      throw new Error("Materialized protected target artifact does not match the capture target identity.");
    }
  }
  if (consumedSourceReferenceHashes.size !== sourceInput.referencedEvidence.length) {
    throw new Error("Materialized supervised evidence contains unused or unverified references.");
  }
  const physicalAnalysisBytes = await readFile(path.join(input.directory, FAST_CALIBRATION_RIG_PHYSICAL_ANALYSIS_FILE_V1_2));
  const physicalAnalysis = parseCanonical<FastCalibrationRigPhysicalAnalysisV1_2>(physicalAnalysisBytes, "materialized physical analysis");
  exactKeys(physicalAnalysis, ["schemaVersion", "sourceCaptureManifestSha256", "sourceCapturePackageSha256", "physicalAnalyzerSha256", "builderInput", "physicalArtifactSha256", "profileSha256"], "materialized physical analysis");
  if (physicalAnalysis.schemaVersion !== FAST_CALIBRATION_RIG_PHYSICAL_ANALYSIS_SCHEMA_V1_2 ||
      physicalAnalysis.sourceCaptureManifestSha256 !== evidence.sourceCaptureManifestSha256 ||
      physicalAnalysis.sourceCapturePackageSha256 !== evidence.sourceCapturePackageSha256 ||
      physicalAnalysis.physicalAnalyzerSha256 !== evidence.physicalAnalyzerSha256) {
    throw new Error("Materialized physical analysis source authority mismatch.");
  }
  const rebuilt = buildFixedRigPhysicalCalibrationV1(physicalAnalysis.builderInput);
  if (rebuilt.status !== "finalized" || rebuilt.artifact.artifactSha256 !== physicalAnalysis.physicalArtifactSha256 ||
      hashFastCalibrationCanonicalV1_2(rebuilt.profile) !== physicalAnalysis.profileSha256) {
    throw new Error("Materialized physical analysis does not reproduce accepted physical calculations.");
  }
  if (canonicalDirection) validateCanonicalGeneratedAuthorities({
    live, components,
    directions: directionAuthority as FastCalibrationCanonicalDirectionFrameEvidenceV1_2,
    lens: canonicalLens!, wiring: canonicalWiring!,
    captureManifestSha256: sourceInput.captureManifest.sha256,
    physicalAnalyzerSha256: evidence.physicalAnalyzerSha256,
    artifacts: materializedArtifacts, builder: physicalAnalysis.builderInput,
  });
  const artifactEvidence = evidence.files.filter((entry) => entry.kind === "capture_artifact");
  const byId = new Map(artifactEvidence.map((entry) => [entry.evidenceId, entry]));
  for (const reference of allBuilderEvidence(physicalAnalysis.builderInput)) {
    const entry = byId.get(reference.evidenceId);
    if (!entry || entry.sha256 !== reference.sha256 || entry.sourceRole !== reference.role) {
      throw new Error("Materialized physical analysis contains an unverified evidence reference.");
    }
  }
  const members = await Promise.all(RIG_MEMBER_SPECS.map(async (member) => ({
    fileName: member.fileName,
    bytes: await readFile(path.join(input.directory, member.fileName)),
  })));
  const rigSource = { bundleBytes, members };
  const verified = verifyFastCalibrationRigCharacterizationSourceV1_2(rigSource, runtimeContext);
  if (verified.authority.sourceCaptureManifestSha256 !== evidence.sourceCaptureManifestSha256) {
    throw new Error("Materialized rig authority does not bind the exact source capture manifest.");
  }
  if (physicalAnalysis.builderInput.rigId !== live.rigId ||
      (!canonicalDirection && (!("operatorId" in components) || physicalAnalysis.builderInput.operatorId !== components.operatorId)) ||
      physicalAnalysis.builderInput.targetVersion !== components.targetVersion || physicalAnalysis.builderInput.targetSha256 !== components.targetSha256 ||
      physicalAnalysis.builderInput.lensModel.sourceWidthPx !== live.camera.widthPx ||
      physicalAnalysis.builderInput.lensModel.sourceHeightPx !== live.camera.heightPx || runtimeContext.stationId !== live.stationId ||
      runtimeContext.rigId !== live.rigId || runtimeContext.camera.serialNumber !== live.camera.serialNumber ||
      runtimeContext.camera.modelName !== live.camera.modelName || runtimeContext.camera.lensAuthorityId !== components.lensAuthorityId ||
      runtimeContext.controller.identity !== components.controllerIdentity ||
      hashFastCalibrationCanonicalV1_2(runtimeContext.controller.channelWiring) !== hashFastCalibrationCanonicalV1_2(components.channelWiring)) {
    throw new Error("Materialized runtime/rig authority does not reconstruct the supervised live/component/target evidence.");
  }
  const handoffBytes = await readFile(path.join(input.directory, FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_FILE_V1_2));
  const handoff = parseCanonical<JsonObject>(handoffBytes, "materialized operator handoff");
  exactKeys(handoff, ["schemaVersion", "authority", "characterizedAt", "rigId", "operatorId", "runtimeContextFileName", "runtimeContextSha256", "rigSourceBundleFileName", "rigSourceBundleSha256", "sourceEvidenceManifestFileName", "sourceEvidenceManifestSha256", "physicalAnalysisFileName", "physicalAnalysisSha256", "physicalArtifactSha256", "profileSha256", "members"], "materialized operator handoff");
  if (handoff.schemaVersion !== FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_SCHEMA_V1_2 ||
      handoff.authority !== FAST_CALIBRATION_RIG_MATERIALIZATION_AUTHORITY_V1_2 || handoff.rigSourceBundleSha256 !== bundleSha256 ||
      handoff.runtimeContextSha256 !== runtimeSha256 || handoff.sourceEvidenceManifestSha256 !== hash(evidenceManifestBytes) ||
      handoff.physicalAnalysisSha256 !== hash(physicalAnalysisBytes) || handoff.physicalArtifactSha256 !== physicalAnalysis.physicalArtifactSha256 ||
      handoff.profileSha256 !== physicalAnalysis.profileSha256 ||
      hashFastCalibrationCanonicalV1_2(handoff.members) !== hashFastCalibrationCanonicalV1_2(bundle.members)) {
    throw new Error("Materialized operator handoff does not bind the exact authority outputs.");
  }
  return {
    directoryName: path.basename(input.directory), runtimeContextSha256: runtimeSha256,
    rigSourceBundleSha256: bundleSha256, sourceEvidenceManifestSha256: hash(evidenceManifestBytes),
    physicalAnalysisSha256: hash(physicalAnalysisBytes), handoffSha256: hash(handoffBytes), runtimeContext, rigSource,
  };
}

export async function materializeFastCalibrationRigAuthorityV1_2(
  input: MaterializeFastCalibrationRigAuthorityV1_2Input,
): Promise<MaterializedFastCalibrationRigAuthorityV1_2> {
  if (input.confirmation !== FAST_CALIBRATION_RIG_MATERIALIZATION_CONFIRMATION_V1_2) throw new Error("Rig authority materialization requires the exact operator confirmation.");
  if (!path.isAbsolute(input.inputManifestPath) || !path.isAbsolute(input.acceptanceRoot)) throw new Error("Rig materialization paths must be protected absolute paths.");
  exactSha(input.inputManifestSha256, "rig materialization input manifest sha256");
  const sourceRoot = path.dirname(input.inputManifestPath);
  const inputManifestBytes = await readExact(input.inputManifestPath, input.inputManifestSha256, "rig materialization input manifest");
  const manifest = parseCanonical<FastCalibrationRigMaterializationInputManifestV1_2>(inputManifestBytes, "rig materialization input manifest");
  validateInputManifest(manifest);
  const canonicalDirection = "directionFrameEvidence" in manifest;
  const readReferenced = async <T>(reference: FileReference, label: string): Promise<{ bytes: Buffer; value: T }> => {
    const bytes = await readExact(contained(sourceRoot, reference.fileName), reference.sha256, label);
    return { bytes, value: parseCanonical<T>(bytes, label) };
  };
  const live = await readReferenced<FastCalibrationProtectedLiveProbeEvidenceV1_2>(manifest.liveProbe, "protected live probe evidence");
  const components = await readReferenced<FastCalibrationComponentAuthorityEvidenceV1_2>(manifest.componentEvidence, "component authority evidence");
  const directionAuthority = canonicalDirection
    ? await readReferenced<FastCalibrationCanonicalDirectionFrameEvidenceV1_2>(manifest.directionFrameEvidence, "canonical target direction evidence")
    : await readReferenced<FastCalibrationStageTransformEvidenceV1_2>(manifest.stageTransformEvidence, "stage transform evidence");
  validateLiveProbe(live.value); validateComponentEvidence(components.value);
  if (canonicalDirection) validateCanonicalDirectionFrame(directionAuthority.value as FastCalibrationCanonicalDirectionFrameEvidenceV1_2);
  else validateStageTransform(directionAuthority.value as FastCalibrationStageTransformEvidenceV1_2);
  if (components.value.rigId !== live.value.rigId || components.value.controllerIdentity !== live.value.controller.identity ||
      directionAuthority.value.rigId !== live.value.rigId ||
      (!canonicalDirection && ((directionAuthority.value as FastCalibrationStageTransformEvidenceV1_2).cameraSerialNumber !== live.value.camera.serialNumber ||
        (directionAuthority.value as FastCalibrationStageTransformEvidenceV1_2).cameraModelName !== live.value.camera.modelName ||
        (directionAuthority.value as FastCalibrationStageTransformEvidenceV1_2).lensAuthorityId !== components.value.lensAuthorityId ||
        !("operatorId" in components.value) || components.value.operatorId !== (directionAuthority.value as FastCalibrationStageTransformEvidenceV1_2).operatorId)) ||
      (canonicalDirection && (!("controllerUnit" in components.value) || components.value.controllerUnit !== live.value.controller.unit))) {
    throw new Error("Component/direction/live evidence identities do not match.");
  }
  const referencesByHash = new Map<string, ReferencedEvidence>();
  const referencedBytes = new Map<string, Buffer>();
  for (const reference of manifest.referencedEvidence) {
    const bytes = await readExact(contained(sourceRoot, reference.fileName), reference.sha256, `referenced ${reference.role} evidence`);
    referencesByHash.set(reference.sha256, reference);
    referencedBytes.set(reference.sha256, bytes);
  }
  const consumedReferenceHashes = new Set<string>();
  for (const [sha256, role] of [
    [components.value.lensAuthorityEvidenceSha256, "lens_authority"],
    [components.value.wiringEvidenceSha256, "component_wiring"],
  ] as const) {
    referenceByRole(manifest.referencedEvidence, sha256, role);
    consumedReferenceHashes.add(sha256);
  }
  for (const sha256 of canonicalDirection ? [] : (directionAuthority.value as FastCalibrationStageTransformEvidenceV1_2).measurementEvidenceSha256) {
    referenceByRole(manifest.referencedEvidence, sha256, "stage_transform_measurement");
    consumedReferenceHashes.add(sha256);
  }
  const analyzerScriptPath = path.resolve(__dirname, "../../../../scripts/ai-grader/analyze-mathematical-calibration-v1.py");
  const analyzerDependencyPath = path.resolve(__dirname, "../../../../scripts/ai-grader/requirements-mathematical-calibration-v1.txt");
  const analyzerScriptBytes = await readFile(analyzerScriptPath);
  const analyzerDependencyBytes = await readFile(analyzerDependencyPath);
  const physicalAnalyzerSha256 = hash(analyzerScriptBytes);
  const capture = await loadCaptureAuthority({
    root: sourceRoot, captureManifestRef: manifest.captureManifest, liveProbe: live.value,
    physicalAnalyzerSha256, referencesByHash, consumedReferenceHashes,
  });
  const canonicalLens = canonicalDirection
    ? parseCanonical<FastCalibrationEvidenceDerivedLensAuthorityV1_2>(referencedBytes.get(components.value.lensAuthorityEvidenceSha256)!, "evidence-derived lens authority")
    : undefined;
  const canonicalWiring = canonicalDirection
    ? parseCanonical<FastCalibrationEvidenceDerivedWiringAuthorityV1_2>(referencedBytes.get(components.value.wiringEvidenceSha256)!, "evidence-derived wiring authority")
    : undefined;
  if (canonicalDirection) validateCanonicalGeneratedAuthorities({
    live: live.value,
    components: components.value,
    directions: directionAuthority.value as FastCalibrationCanonicalDirectionFrameEvidenceV1_2,
    lens: canonicalLens!, wiring: canonicalWiring!,
    captureManifestSha256: manifest.captureManifest.sha256,
    physicalAnalyzerSha256, artifacts: capture.artifacts,
  });
  if (consumedReferenceHashes.size !== manifest.referencedEvidence.length ||
      manifest.referencedEvidence.some((entry) => !consumedReferenceHashes.has(entry.sha256))) {
    throw new Error("Rig materialization referenced evidence contains unused or unverified files.");
  }
  await mkdir(input.acceptanceRoot, { recursive: true });
  const temporary = path.join(input.acceptanceRoot, `.rig-materialization-${crypto.randomUUID()}`);
  await mkdir(temporary, { recursive: false });
  try {
    const analysisWorking = path.join(temporary, ".physical-analysis-working");
    const analysis = input.analyzePhysicalEvidence
      ? await input.analyzePhysicalEvidence({ captureManifestPath: contained(sourceRoot, manifest.captureManifest.fileName), captureManifestSha256: manifest.captureManifest.sha256, outputDir: analysisWorking })
      : await defaultAnalyzePhysicalEvidence({ captureManifestPath: contained(sourceRoot, manifest.captureManifest.fileName), captureManifestSha256: manifest.captureManifest.sha256, outputDir: analysisWorking, analyzerScriptPath });
    validateBuilderInput(analysis.builderInput, capture.artifacts, analysis.derivedArtifacts);
    const builder = analysis.builderInput;
    const physical = buildFixedRigPhysicalCalibrationV1(builder);
    if (physical.status !== "finalized") throw new Error(`Rig physical acceptance rejected: ${JSON.stringify(physical.issues)}`);
    if (builder.rigId !== live.value.rigId ||
        (!canonicalDirection && (!("operatorId" in components.value) || builder.operatorId !== components.value.operatorId)) ||
        builder.targetVersion !== components.value.targetVersion || builder.targetSha256 !== components.value.targetSha256 ||
        builder.lensModel.sourceWidthPx !== live.value.camera.widthPx || builder.lensModel.sourceHeightPx !== live.value.camera.heightPx) {
      throw new Error("Physical analysis target/rig/operator/camera identity differs from supervised evidence.");
    }
    if (canonicalDirection) validateCanonicalGeneratedAuthorities({
      live: live.value, components: components.value,
      directions: directionAuthority.value as FastCalibrationCanonicalDirectionFrameEvidenceV1_2,
      lens: canonicalLens!, wiring: canonicalWiring!, captureManifestSha256: manifest.captureManifest.sha256,
      physicalAnalyzerSha256, artifacts: capture.artifacts, builder,
    });
    const algorithmHashes = {
      geometry: FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2_SHA256,
      photometric: FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2_SHA256,
      finalizer: FIXED_RIG_FAST_CALIBRATION_FINALIZER_V1_2_SHA256,
      thresholdManifest: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    };
    const runtimeContext: FastCalibrationRuntimeContextV1_2 = {
      schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SCHEMA,
      stationId: live.value.stationId, rigId: live.value.rigId,
      camera: { ...live.value.camera, lensAuthorityId: components.value.lensAuthorityId } as FastCalibrationRuntimeContextV1_2["camera"],
      controller: { identity: live.value.controller.identity, unit: live.value.controller.unit, channelWiring: components.value.channelWiring },
      dutyPercent: live.value.dutyPercent,
      target: { version: builder.targetVersion, sha256: builder.targetSha256 },
      componentConfigurationId: components.value.componentConfigurationId,
      algorithmHashes, locationLabel: live.value.locationLabel, lightingConfigurationId: live.value.lightingConfigurationId,
    };
    delete (runtimeContext.camera as unknown as JsonObject).transport;
    validateFastCalibrationRuntimeContextV1_2(runtimeContext);
    const memberValues = [
      {
        schemaVersion: "ten-kings-target-metrology-authority-v1", rigId: builder.rigId,
        targetVersion: builder.targetVersion, targetSha256: builder.targetSha256,
        scaleSamples: builder.scaleSamples, targetPrintScaleSamples: builder.targetPrintScaleSamples,
        targetCutDimensionSamples: builder.targetCutDimensionSamples, targetEvidence: builder.targetEvidence,
      },
      {
        schemaVersion: "ten-kings-camera-lens-authority-v1", rigId: builder.rigId,
        cameraSerialNumber: live.value.camera.serialNumber, cameraModelName: live.value.camera.modelName,
        lensAuthorityId: components.value.lensAuthorityId, normalizedWidthPx: builder.normalizedWidthPx,
        normalizedHeightPx: builder.normalizedHeightPx, lensResidualSamples: builder.lensResidualSamples,
        lensModel: builder.lensModel, normalizationModel: builder.normalizationModel,
      },
      {
        schemaVersion: "ten-kings-physical-light-directions-authority-v1", rigId: builder.rigId,
        ...(canonicalDirection ? {
          coordinateFrame: "canonical_normalized_target_v1",
          authorityMethod: "evidence_derived_normalized_illumination_direction_v1",
        } : {
          stageToUndistortedSensorMatrix: (directionAuthority.value as FastCalibrationStageTransformEvidenceV1_2).stageToUndistortedSensorMatrix,
        }),
        channels: builder.channels.map(({ channelIndex, directionMeasurementSamples }) => ({ channelIndex, directionMeasurementSamples })),
      },
      {
        schemaVersion: "ten-kings-component-identities-authority-v1", rigId: builder.rigId,
        controllerIdentity: components.value.controllerIdentity, componentConfigurationId: components.value.componentConfigurationId,
        channelWiring: components.value.channelWiring, algorithmHashes,
      },
      {
        schemaVersion: "ten-kings-repeatability-authority-v1", rigId: builder.rigId,
        repeatedPlacementSamples: builder.repeatedPlacementSamples,
        measurementRepeatabilitySamples: builder.measurementRepeatabilitySamples,
      },
    ];
    const memberBytes = memberValues.map(canonicalBytes);
    const memberLedger: FastCalibrationRigSourceBundleMemberV1_2[] = RIG_MEMBER_SPECS.map((entry, index) => ({
      role: entry.role, fileName: entry.fileName, sha256: hash(memberBytes[index]!),
    }));
    const sourceFiles: Array<{ kind: string; evidenceId: string; sourceRole: string; bytes: Buffer }> = [
      { kind: "input_manifest", evidenceId: "rig-materialization-input", sourceRole: "materialization_input", bytes: inputManifestBytes },
      { kind: "capture_manifest", evidenceId: "source-capture-manifest", sourceRole: "capture_manifest", bytes: capture.captureManifestBytes },
      { kind: "capture_package", evidenceId: "source-capture-package", sourceRole: "capture_package", bytes: capture.capturePackageBytes },
      ...capture.artifacts.map((entry) => ({ kind: entry.kind, evidenceId: entry.evidenceId, sourceRole: entry.sourceRole, bytes: entry.bytes })),
      { kind: "live_probe", evidenceId: "protected-live-probe", sourceRole: "live_runtime", bytes: live.bytes },
      { kind: "component_evidence", evidenceId: canonicalDirection ? "evidence-derived-components" : "component-supervision", sourceRole: "component_authority", bytes: components.bytes },
      canonicalDirection
        ? { kind: "direction_frame", evidenceId: "canonical-target-directions", sourceRole: "canonical_normalized_target", bytes: directionAuthority.bytes }
        : { kind: "stage_transform", evidenceId: "stage-transform", sourceRole: "stage_transform", bytes: directionAuthority.bytes },
      ...manifest.referencedEvidence.map((entry) => ({ kind: "referenced_evidence", evidenceId: `reference-${entry.role}-${entry.sha256.slice(0, 16)}`, sourceRole: entry.role, bytes: referencedBytes.get(entry.sha256)! })),
      { kind: "physical_analyzer", evidenceId: "physical-analyzer-source", sourceRole: PHYSICAL_ANALYSIS_ALGORITHM, bytes: analyzerScriptBytes },
      { kind: "physical_analyzer_dependency", evidenceId: "physical-analyzer-dependencies", sourceRole: "python-opencv-dependency-manifest", bytes: analyzerDependencyBytes },
      ...analysis.derivedArtifacts.map((entry, index) => ({ kind: entry.kind, evidenceId: `derived-${entry.kind}-${index + 1}`, sourceRole: entry.sourceRole, bytes: entry.bytes })),
    ];
    const sourceHashes = sourceFiles.map((entry) => hash(entry.bytes));
    if (new Set(sourceFiles.map((entry) => entry.evidenceId)).size !== sourceFiles.length || new Set(sourceHashes).size !== sourceHashes.length) {
      throw new Error("Rig materialization source evidence contains duplicate or relabelled bytes.");
    }
    const stagedEvidence = sourceFiles.map((entry, index) => sourceEntry(entry.kind, entry.evidenceId, entry.sourceRole, entry.bytes, index + 1));
    const sourceEvidenceManifest: FastCalibrationRigSourceEvidenceManifestV1_2 = {
      schemaVersion: FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_SCHEMA_V1_2,
      inputManifestSha256: input.inputManifestSha256,
      sourceCaptureManifestSha256: manifest.captureManifest.sha256,
      sourceCapturePackageSha256: capture.capturePackageSha256,
      physicalAnalyzerSha256,
      physicalAnalyzerDependencyManifestSha256: hash(analyzerDependencyBytes),
      files: stagedEvidence.map((entry) => entry.manifest),
    };
    const sourceEvidenceManifestBytes = canonicalBytes(sourceEvidenceManifest);
    const sourceEvidenceManifestSha256 = hash(sourceEvidenceManifestBytes);
    const physicalAnalysis: FastCalibrationRigPhysicalAnalysisV1_2 = {
      schemaVersion: FAST_CALIBRATION_RIG_PHYSICAL_ANALYSIS_SCHEMA_V1_2,
      sourceCaptureManifestSha256: manifest.captureManifest.sha256,
      sourceCapturePackageSha256: capture.capturePackageSha256,
      physicalAnalyzerSha256, builderInput: builder,
      physicalArtifactSha256: physical.artifact.artifactSha256,
      profileSha256: hashFastCalibrationCanonicalV1_2(physical.profile),
    };
    const physicalAnalysisBytes = canonicalBytes(physicalAnalysis);
    const rigSourceBundleBytes = canonicalBytes({
      schemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_SCHEMA,
      characterizedAt: builder.finalizedAt, rigId: builder.rigId,
      sourceCaptureManifestSha256: manifest.captureManifest.sha256,
      sourceEvidenceManifestSha256,
      members: memberLedger,
    });
    const rigSourceBundleSha256 = hash(rigSourceBundleBytes);
    const runtimeContextBytes = canonicalBytes(runtimeContext);
    const handoff = {
      schemaVersion: FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_SCHEMA_V1_2,
      authority: FAST_CALIBRATION_RIG_MATERIALIZATION_AUTHORITY_V1_2,
      characterizedAt: builder.finalizedAt, rigId: builder.rigId, operatorId: builder.operatorId,
      runtimeContextFileName: FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2,
      runtimeContextSha256: hash(runtimeContextBytes),
      rigSourceBundleFileName: FAST_CALIBRATION_RIG_SOURCE_BUNDLE_FILE_V1_2,
      rigSourceBundleSha256,
      sourceEvidenceManifestFileName: FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_FILE_V1_2,
      sourceEvidenceManifestSha256,
      physicalAnalysisFileName: FAST_CALIBRATION_RIG_PHYSICAL_ANALYSIS_FILE_V1_2,
      physicalAnalysisSha256: hash(physicalAnalysisBytes),
      physicalArtifactSha256: physical.artifact.artifactSha256,
      profileSha256: hashFastCalibrationCanonicalV1_2(physical.profile),
      members: memberLedger,
    };
    const handoffBytes = canonicalBytes(handoff);
    await rm(analysisWorking, { recursive: true, force: true });
    await writeExclusive(path.join(temporary, FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2), runtimeContextBytes);
    await writeExclusive(path.join(temporary, FAST_CALIBRATION_RIG_SOURCE_BUNDLE_FILE_V1_2), rigSourceBundleBytes);
    await writeExclusive(path.join(temporary, FAST_CALIBRATION_RIG_SOURCE_EVIDENCE_FILE_V1_2), sourceEvidenceManifestBytes);
    await writeExclusive(path.join(temporary, FAST_CALIBRATION_RIG_PHYSICAL_ANALYSIS_FILE_V1_2), physicalAnalysisBytes);
    await writeExclusive(path.join(temporary, FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_FILE_V1_2), handoffBytes);
    for (let index = 0; index < RIG_MEMBER_SPECS.length; index += 1) await writeExclusive(path.join(temporary, RIG_MEMBER_SPECS[index]!.fileName), memberBytes[index]!);
    for (const entry of stagedEvidence) await writeExclusive(contained(temporary, entry.manifest.fileName), entry.bytes);
    const destination = path.join(input.acceptanceRoot, rigSourceBundleSha256);
    try {
      await rename(temporary, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY" && code !== "EPERM") throw error;
      const existing = await loadMaterializedFastCalibrationRigAuthorityV1_2({
        directory: destination,
        expectedRuntimeContextSha256: hash(runtimeContextBytes),
        expectedRigSourceBundleSha256: rigSourceBundleSha256,
      });
      const existingHandoff = await readFile(path.join(destination, FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_FILE_V1_2));
      if (!existingHandoff.equals(handoffBytes)) throw new Error("Existing rig authority materialization conflicts with the exact evidence/output.");
      await rm(temporary, { recursive: true, force: true });
      return existing;
    }
    return await loadMaterializedFastCalibrationRigAuthorityV1_2({
      directory: destination,
      expectedRuntimeContextSha256: hash(runtimeContextBytes),
      expectedRigSourceBundleSha256: rigSourceBundleSha256,
    });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
