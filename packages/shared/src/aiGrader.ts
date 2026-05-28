export type GradingMode =
  | "QUICK"
  | "STANDARD"
  | "FORENSIC"
  | "AUTH_ONLY"
  | "MACRO_ONLY"
  | "MACRO_PLUS_CORNERS"
  | "MACRO_PLUS_EDGES"
  | "FULL_TWO_SCALE";

export type CaptureSide = "FRONT" | "BACK";

export type GradingElement =
  | "CENTERING"
  | "CORNERS"
  | "EDGES"
  | "SURFACE"
  | "COMPOSITE"
  | "MICRO_CORNERS"
  | "MICRO_EDGES"
  | "MICRO_SURFACE"
  | "CMYK_AUTHENTICATION";

export type GradingCaptureKind =
  | "COLOR_CHECKER_FRONT"
  | "COLOR_CHECKER_BACK"
  | "FRONT_DIFFUSE"
  | "BACK_DIFFUSE"
  | "FRONT_DARKFIELD"
  | "BACK_DARKFIELD"
  | "FRONT_LED_0"
  | "FRONT_LED_1"
  | "FRONT_LED_2"
  | "FRONT_LED_3"
  | "FRONT_LED_4"
  | "FRONT_LED_5"
  | "FRONT_LED_6"
  | "FRONT_LED_7"
  | "BACK_LED_0"
  | "BACK_LED_1"
  | "BACK_LED_2"
  | "BACK_LED_3"
  | "BACK_LED_4"
  | "BACK_LED_5"
  | "BACK_LED_6"
  | "BACK_LED_7"
  | "MICRO_CORNER_SPOT"
  | "MICRO_EDGE_SPOT"
  | "MICRO_SURFACE_SPOT"
  | "MICRO_AUTH_PATCH"
  | "MICRO_CORNER_TILE"
  | "MICRO_EDGE_TILE"
  | "MICRO_SURFACE_TILE"
  | "EDR_BASE"
  | "POLARIZED_ALL_ON"
  | "FLC_LED_0"
  | "FLC_LED_1"
  | "FLC_LED_2"
  | "FLC_LED_3"
  | "FLC_LED_4"
  | "FLC_LED_5"
  | "FLC_LED_6"
  | "FLC_LED_7";

export type DeviceType =
  | "MACRO_CAMERA"
  | "LED_CONTROLLER"
  | "MICROSCOPE"
  | "XY_STAGE"
  | "ARM_INTERLOCK"
  | "HOLDER_FIDUCIAL";

export type CoordinateUnit = "px" | "mm" | "micron" | "degree" | "bitmask";

export interface DeviceCapabilityManifest {
  id: string;
  rigId: string;
  helperInstanceId: string;
  driverName: string;
  driverVersion: string;
  deviceType: DeviceType;
  componentSerial: string;
  supportedCapturePackages: string[];
  coordinateUnits: Record<string, CoordinateUnit>;
  timingCharacteristics: Record<string, number>;
  healthChecks: Array<{ name: string; required: boolean; timeoutMs: number }>;
  requiredCalibrationTypes: string[];
  checksum: string;
  observedAt: string;
}

export interface CaptureManifestFrame {
  frameId: string;
  kind: GradingCaptureKind;
  side: CaptureSide;
  storageKey: string;
  checksumSha256: string;
  capturedAt: string;
  exposureUs?: number;
  ledMask?: number;
  stageXMicrons?: number;
  stageYMicrons?: number;
  microMagnification?: number;
  polarizerAngle?: number;
  focusScore?: number;
  sourceSuspectRegionId?: string;
  widthPx?: number;
  heightPx?: number;
}

export type DeviceHealthStatus = "PASS" | "WARN" | "FAIL";

export interface CaptureManifest {
  id: string;
  captureSessionId: string;
  tenantId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId: string;
  helperVersion: string;
  driverVersions: Record<string, string>;
  componentSerials: Record<string, string>;
  calibrationSnapshotIds: string[];
  frameList: CaptureManifestFrame[];
  operatorPrompts: Array<{ prompt: string; shownAt: string; confirmedAt?: string }>;
  deviceHealth: Array<{ check: string; status: DeviceHealthStatus; detail?: string }>;
  checksumSha256: string;
  createdAt: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EvidenceArtifactRef {
  id?: string;
  storageKey: string;
  checksumSha256: string;
  mimeType?: string;
  byteSize?: number;
  widthPx?: number;
  heightPx?: number;
}

export type PhysicalGateStatus = "PASS" | "WARN" | "FAIL" | "REVIEW";

export interface PhysicalGateResult {
  gate: string;
  status: PhysicalGateStatus;
  detail?: string;
  evidenceArtifacts?: EvidenceArtifactRef[];
}

export interface CenteringMeasurement {
  leftMm?: number;
  rightMm?: number;
  topMm?: number;
  bottomMm?: number;
  horizontalPercent?: number;
  verticalPercent?: number;
  [key: string]: unknown;
}

export interface MacroSuspectRegion {
  id: string;
  sessionId: string;
  side: CaptureSide;
  element: "SURFACE";
  rank: number;
  score: number;
  threshold: number;
  reasonCodes: string[];
  cardMm: Rect;
  warpedPx: Rect;
  sourcePx?: Rect;
  heatmapStorageKey?: string;
  macroCaptureIds: string[];
  thresholdSetId: string;
}

export interface MacroPipelineOutput {
  sessionId: string;
  side: CaptureSide;
  captureManifestId: string;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  centeringMeasurement: CenteringMeasurement;
  provisionalGrades: {
    centering: number;
    corners: number;
    edges: number;
    surface: number;
  };
  macroMeasurements: Record<string, unknown>;
  suspectRegions: MacroSuspectRegion[];
  physicalGateResults: PhysicalGateResult[];
  evidenceArtifacts: EvidenceArtifactRef[];
}

export interface MicroSpotCapturePackage {
  id: string;
  sessionId: string;
  captureManifestId: string;
  side: CaptureSide;
  element: "CORNERS" | "EDGES" | "SURFACE" | "CMYK_AUTHENTICATION";
  spotIndex: number;
  totalSpots: number;
  sourceSuspectRegionId?: string;
  stageXMicrons: number;
  stageYMicrons: number;
  microMagnification: number;
  amrReading: number;
  focusScore: number;
  frames: {
    edrBase: EvidenceArtifactRef;
    polarizedAllOn: EvidenceArtifactRef;
    flcLed0: EvidenceArtifactRef;
    flcLed1: EvidenceArtifactRef;
    flcLed2: EvidenceArtifactRef;
    flcLed3: EvidenceArtifactRef;
    flcLed4: EvidenceArtifactRef;
    flcLed5: EvidenceArtifactRef;
    flcLed6: EvidenceArtifactRef;
    flcLed7: EvidenceArtifactRef;
  };
  capturedAt: string;
  validForClassification: boolean;
}

export type FusionActionType = "LOWER" | "HOLD" | "DUST_CORRECT" | "WARNING_ONLY";

export interface FusionAction {
  action: FusionActionType;
  element: "CORNERS" | "EDGES" | "SURFACE";
  side: CaptureSide;
  regionId?: string;
  spotPackageId: string;
  macroMeasurement: unknown;
  microMeasurement: unknown;
  gradeBefore: number;
  gradeAfter: number;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  reasonCodes: string[];
}

export interface ModePlan {
  mode: GradingMode;
  macroRequired: boolean;
  microscopePlan:
    | { type: "NONE" }
    | { type: "STANDARD_SPOTS"; cornersPerSide: 4; edgesPerSide: 4; surfaceTopN: number }
    | { type: "FORENSIC_RASTER"; includeCorners: true; includeEdges: true; includeSurface: true; includeAuth: true }
    | { type: "AUTH_PATCHES"; patchCount: 5 };
  producesGrade: boolean;
  producesAuthVerdict: boolean;
  publicModeDescription: string;
}

export interface OfficeGradeRunRequest {
  sessionId: string;
  side: CaptureSide;
  mode: GradingMode;
  operatorId: string;
  rigId: string;
}

export interface StandardFusionInput {
  macroOutput: MacroPipelineOutput;
  microPackages: MicroSpotCapturePackage[];
  captureManifest: CaptureManifest;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  runtimeEnvironmentId: string;
}

export interface StandardFusionOutput {
  gradeRunDraft: {
    macroMeasurements: Record<string, unknown>;
    microMeasurements: Record<string, unknown>;
    fusionActions: FusionAction[];
    finalGrades: Record<string, number>;
    warnings: string[];
  };
}

export type AiGraderValidationIssueCode =
  | "REQUIRED"
  | "INVALID_TYPE"
  | "INVALID_ENUM"
  | "INVALID_TIMESTAMP"
  | "INVALID_CHECKSUM"
  | "INVALID_VERSION"
  | "INVALID_TOLERANCE"
  | "INVALID_ARRAY"
  | "INVALID_RECORD"
  | "INVALID_NUMBER"
  | "MISSING_TOLERANCE"
  | "REPLAY_TOLERANCE_EXCEEDED"
  | "EMPTY_ARRAY"
  | "MODE_MISSING_MACRO_FRAME"
  | "MODE_MISSING_MICRO_SPOTS"
  | "MODE_TOO_MANY_SURFACE_SPOTS"
  | "MODE_MISSING_SURFACE_REGION"
  | "MODE_MISSING_AUTH_PATCHES"
  | "MODE_MISSING_FORENSIC_RASTER";

export interface AiGraderValidationIssue {
  path: string;
  code: AiGraderValidationIssueCode;
  message: string;
}

export interface AiGraderValidationResult {
  valid: boolean;
  issues: AiGraderValidationIssue[];
}

export interface CaptureManifestModeValidationOptions {
  side?: CaptureSide;
  surfaceTopN?: number;
}

export type NumericToleranceMap = Record<string, number>;

export interface AlgorithmVersionSeed {
  name: string;
  semanticVersion: string;
  sourceHash: string;
  internalReference?: string;
  patentReference?: string;
  numericTolerance: NumericToleranceMap;
  activeFrom?: string;
  activeTo?: string;
}

export interface ThresholdSetVersionSeed {
  name: string;
  semanticVersion: string;
  thresholds: Record<string, unknown>;
  sourceHash?: string;
  activeFrom?: string;
  activeTo?: string;
}

export interface RuntimeEnvironmentFingerprintInput {
  label: string;
  containerDigest: string;
  pythonVersion?: string | null;
  nodeVersion?: string | null;
  opencvVersion?: string | null;
  numpyVersion?: string | null;
  dependencyLockHash: string;
  osInfo?: Record<string, unknown> | null;
}

export interface RuntimeEnvironmentFingerprint {
  label: string;
  containerDigest: string;
  pythonVersion?: string;
  nodeVersion?: string;
  opencvVersion?: string;
  numpyVersion?: string;
  dependencyLockHash: string;
  osInfo?: Record<string, unknown>;
  fingerprintKey: string;
}

export interface ReplayRunInput {
  sourceGradeRunId: string;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  runtimeEnvironmentId: string;
  inputChecksum: string;
  outputChecksum: string;
  deltas: Record<string, number>;
  numericTolerance: NumericToleranceMap;
}

export interface ReplayToleranceFailure {
  path: string;
  delta: number;
  tolerance: number;
}

export interface ReplayToleranceResult {
  validInput: boolean;
  tolerancePassed: boolean;
  checked: number;
  maxAbsDelta: number;
  failures: ReplayToleranceFailure[];
  issues: AiGraderValidationIssue[];
}

const GRADING_MODES = [
  "QUICK",
  "STANDARD",
  "FORENSIC",
  "AUTH_ONLY",
  "MACRO_ONLY",
  "MACRO_PLUS_CORNERS",
  "MACRO_PLUS_EDGES",
  "FULL_TWO_SCALE",
] as const;

const CAPTURE_SIDES = ["FRONT", "BACK"] as const;

const GRADING_CAPTURE_KINDS = [
  "COLOR_CHECKER_FRONT",
  "COLOR_CHECKER_BACK",
  "FRONT_DIFFUSE",
  "BACK_DIFFUSE",
  "FRONT_DARKFIELD",
  "BACK_DARKFIELD",
  "FRONT_LED_0",
  "FRONT_LED_1",
  "FRONT_LED_2",
  "FRONT_LED_3",
  "FRONT_LED_4",
  "FRONT_LED_5",
  "FRONT_LED_6",
  "FRONT_LED_7",
  "BACK_LED_0",
  "BACK_LED_1",
  "BACK_LED_2",
  "BACK_LED_3",
  "BACK_LED_4",
  "BACK_LED_5",
  "BACK_LED_6",
  "BACK_LED_7",
  "MICRO_CORNER_SPOT",
  "MICRO_EDGE_SPOT",
  "MICRO_SURFACE_SPOT",
  "MICRO_AUTH_PATCH",
  "MICRO_CORNER_TILE",
  "MICRO_EDGE_TILE",
  "MICRO_SURFACE_TILE",
  "EDR_BASE",
  "POLARIZED_ALL_ON",
  "FLC_LED_0",
  "FLC_LED_1",
  "FLC_LED_2",
  "FLC_LED_3",
  "FLC_LED_4",
  "FLC_LED_5",
  "FLC_LED_6",
  "FLC_LED_7",
] as const;

const DEVICE_TYPES = [
  "MACRO_CAMERA",
  "LED_CONTROLLER",
  "MICROSCOPE",
  "XY_STAGE",
  "ARM_INTERLOCK",
  "HOLDER_FIDUCIAL",
] as const;

const COORDINATE_UNITS = ["px", "mm", "micron", "degree", "bitmask"] as const;
const DEVICE_HEALTH_STATUSES = ["PASS", "WARN", "FAIL"] as const;

const GRADING_MODE_VALUES = new Set<string>(GRADING_MODES);
const CAPTURE_SIDE_VALUES = new Set<string>(CAPTURE_SIDES);
const GRADING_CAPTURE_KIND_VALUES = new Set<string>(GRADING_CAPTURE_KINDS);
const DEVICE_TYPE_VALUES = new Set<string>(DEVICE_TYPES);
const COORDINATE_UNIT_VALUES = new Set<string>(COORDINATE_UNITS);
const DEVICE_HEALTH_STATUS_VALUES = new Set<string>(DEVICE_HEALTH_STATUSES);
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const CONTAINER_DIGEST_RE = /^(?:sha256:)?[a-f0-9]{64}$/i;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const AI_GRADER_SEED_ACTIVE_FROM = "2026-05-28T00:00:00.000Z";
const STANDARD_SPOT_FUSION_SOURCE_HASH = "1".repeat(64);
const MACRO_PIPELINE_SOURCE_HASH = "2".repeat(64);
const CMYK_PRINT_PROFILE_SOURCE_HASH = "3".repeat(64);
const DEFAULT_THRESHOLDS_SOURCE_HASH = "4".repeat(64);

function validationResult(issues: AiGraderValidationIssue[]): AiGraderValidationResult {
  return {
    valid: issues.length === 0,
    issues,
  };
}

function issue(path: string, code: AiGraderValidationIssueCode, message: string): AiGraderValidationIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValidTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function hasValidSha256(value: unknown): boolean {
  return typeof value === "string" && SHA256_HEX_RE.test(value);
}

function hasValidContainerDigest(value: unknown): boolean {
  return typeof value === "string" && CONTAINER_DIGEST_RE.test(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireString(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: AiGraderValidationIssue[]
) {
  if (!isNonEmptyString(record[field])) {
    issues.push(issue(`${path}.${field}`, "REQUIRED", `${field} is required.`));
  }
}

function requireStringArray(
  value: unknown,
  path: string,
  issues: AiGraderValidationIssue[],
  options: { allowEmpty?: boolean } = {}
) {
  if (!Array.isArray(value)) {
    issues.push(issue(path, "INVALID_ARRAY", `${path} must be an array.`));
    return;
  }
  if (!options.allowEmpty && value.length === 0) {
    issues.push(issue(path, "EMPTY_ARRAY", `${path} must include at least one value.`));
  }
  value.forEach((entry, index) => {
    if (!isNonEmptyString(entry)) {
      issues.push(issue(`${path}[${index}]`, "REQUIRED", `${path}[${index}] must be a non-empty string.`));
    }
  });
}

function validateStringRecord(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an object.`));
    return;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    issues.push(issue(path, "EMPTY_ARRAY", `${path} must include at least one entry.`));
  }
  entries.forEach(([key, entry]) => {
    if (!isNonEmptyString(key) || !isNonEmptyString(entry)) {
      issues.push(issue(`${path}.${key}`, "REQUIRED", `${path}.${key} must be a non-empty string.`));
    }
  });
}

function validateSemver(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isNonEmptyString(value) || !SEMVER_RE.test(value)) {
    issues.push(issue(path, "INVALID_VERSION", `${path} must be a semantic version string.`));
  }
}

function validateDateWindow(record: Record<string, unknown>, path: string, issues: AiGraderValidationIssue[]) {
  if (record.activeFrom != null && !hasValidTimestamp(record.activeFrom)) {
    issues.push(issue(`${path}.activeFrom`, "INVALID_TIMESTAMP", "activeFrom must be a valid timestamp string."));
  }
  if (record.activeTo != null && !hasValidTimestamp(record.activeTo)) {
    issues.push(issue(`${path}.activeTo`, "INVALID_TIMESTAMP", "activeTo must be a valid timestamp string."));
  }
  if (
    hasValidTimestamp(record.activeFrom) &&
    hasValidTimestamp(record.activeTo) &&
    Date.parse(String(record.activeTo)) <= Date.parse(String(record.activeFrom))
  ) {
    issues.push(issue(`${path}.activeTo`, "INVALID_TIMESTAMP", "activeTo must be later than activeFrom."));
  }
}

function validateNumericToleranceMap(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an object.`));
    return;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    issues.push(issue(path, "EMPTY_ARRAY", `${path} must include at least one tolerance.`));
  }

  entries.forEach(([key, tolerance]) => {
    if (!isNonEmptyString(key) || !isFiniteNumber(tolerance) || tolerance < 0) {
      issues.push(issue(`${path}.${key}`, "INVALID_TOLERANCE", "Numeric tolerances must be non-negative finite numbers."));
    }
  });
}

function validateCaptureManifestFrameInternal(value: unknown, path: string): AiGraderValidationIssue[] {
  const issues: AiGraderValidationIssue[] = [];

  if (!isRecord(value)) {
    return [issue(path, "INVALID_RECORD", `${path} must be an object.`)];
  }

  requireString(value, "frameId", path, issues);
  requireString(value, "storageKey", path, issues);

  if (!isNonEmptyString(value.kind) || !GRADING_CAPTURE_KIND_VALUES.has(value.kind)) {
    issues.push(issue(`${path}.kind`, "INVALID_ENUM", "kind must be a supported GradingCaptureKind."));
  }

  if (!isNonEmptyString(value.side) || !CAPTURE_SIDE_VALUES.has(value.side)) {
    issues.push(issue(`${path}.side`, "INVALID_ENUM", "side must be FRONT or BACK."));
  }

  if (!hasValidSha256(value.checksumSha256)) {
    issues.push(issue(`${path}.checksumSha256`, "INVALID_CHECKSUM", "checksumSha256 must be a 64-character hex SHA-256 digest."));
  }

  if (!hasValidTimestamp(value.capturedAt)) {
    issues.push(issue(`${path}.capturedAt`, "INVALID_TIMESTAMP", "capturedAt must be a valid timestamp string."));
  }

  [
    "exposureUs",
    "ledMask",
    "stageXMicrons",
    "stageYMicrons",
    "microMagnification",
    "polarizerAngle",
    "focusScore",
    "widthPx",
    "heightPx",
  ].forEach((field) => {
    if (value[field] != null && !isFiniteNumber(value[field])) {
      issues.push(issue(`${path}.${field}`, "INVALID_NUMBER", `${field} must be a finite number when provided.`));
    }
  });

  if (value.sourceSuspectRegionId != null && !isNonEmptyString(value.sourceSuspectRegionId)) {
    issues.push(issue(`${path}.sourceSuspectRegionId`, "REQUIRED", "sourceSuspectRegionId must be non-empty when provided."));
  }

  return issues;
}

export function buildModePlan(mode: GradingMode): ModePlan {
  switch (mode) {
    case "QUICK":
    case "MACRO_ONLY":
      return {
        mode,
        macroRequired: true,
        microscopePlan: { type: "NONE" },
        producesGrade: true,
        producesAuthVerdict: false,
        publicModeDescription: "Macro-only grade; microscope evidence is not required.",
      };
    case "STANDARD":
    case "MACRO_PLUS_CORNERS":
    case "MACRO_PLUS_EDGES":
      return {
        mode,
        macroRequired: true,
        microscopePlan: { type: "STANDARD_SPOTS", cornersPerSide: 4, edgesPerSide: 4, surfaceTopN: 3 },
        producesGrade: true,
        producesAuthVerdict: false,
        publicModeDescription: "STANDARD spot-check grade with corner, edge, and routed surface microscope evidence.",
      };
    case "FORENSIC":
    case "FULL_TWO_SCALE":
      return {
        mode,
        macroRequired: true,
        microscopePlan: { type: "FORENSIC_RASTER", includeCorners: true, includeEdges: true, includeSurface: true, includeAuth: true },
        producesGrade: true,
        producesAuthVerdict: true,
        publicModeDescription: "FORENSIC raster capture with microscope evidence for grade and authentication support.",
      };
    case "AUTH_ONLY":
      return {
        mode,
        macroRequired: true,
        microscopePlan: { type: "AUTH_PATCHES", patchCount: 5 },
        producesGrade: false,
        producesAuthVerdict: true,
        publicModeDescription: "Authentication-only capture; no grade values are produced.",
      };
  }
}

export function validateDeviceCapabilityManifest(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "manifest";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "DeviceCapabilityManifest must be an object.")]);
  }

  [
    "id",
    "rigId",
    "helperInstanceId",
    "driverName",
    "driverVersion",
    "componentSerial",
    "checksum",
    "observedAt",
  ].forEach((field) => requireString(value, field, path, issues));

  if (!isNonEmptyString(value.deviceType) || !DEVICE_TYPE_VALUES.has(value.deviceType)) {
    issues.push(issue(`${path}.deviceType`, "INVALID_ENUM", "deviceType must be a supported DeviceType."));
  }

  if (!hasValidTimestamp(value.observedAt)) {
    issues.push(issue(`${path}.observedAt`, "INVALID_TIMESTAMP", "observedAt must be a valid timestamp string."));
  }

  requireStringArray(value.supportedCapturePackages, `${path}.supportedCapturePackages`, issues);
  requireStringArray(value.requiredCalibrationTypes, `${path}.requiredCalibrationTypes`, issues, { allowEmpty: true });

  if (!isRecord(value.coordinateUnits)) {
    issues.push(issue(`${path}.coordinateUnits`, "INVALID_RECORD", "coordinateUnits must be an object."));
  } else {
    Object.entries(value.coordinateUnits).forEach(([key, unit]) => {
      if (!isNonEmptyString(key) || typeof unit !== "string" || !COORDINATE_UNIT_VALUES.has(unit)) {
        issues.push(issue(`${path}.coordinateUnits.${key}`, "INVALID_ENUM", "coordinateUnits values must be supported coordinate units."));
      }
    });
  }

  if (!isRecord(value.timingCharacteristics)) {
    issues.push(issue(`${path}.timingCharacteristics`, "INVALID_RECORD", "timingCharacteristics must be an object."));
  } else {
    Object.entries(value.timingCharacteristics).forEach(([key, entry]) => {
      if (!isFiniteNumber(entry) || entry < 0) {
        issues.push(issue(`${path}.timingCharacteristics.${key}`, "INVALID_NUMBER", "timingCharacteristics values must be non-negative finite numbers."));
      }
    });
  }

  if (!Array.isArray(value.healthChecks)) {
    issues.push(issue(`${path}.healthChecks`, "INVALID_ARRAY", "healthChecks must be an array."));
  } else if (value.healthChecks.length === 0) {
    issues.push(issue(`${path}.healthChecks`, "EMPTY_ARRAY", "healthChecks must include at least one check."));
  } else {
    value.healthChecks.forEach((entry, index) => {
      const entryPath = `${path}.healthChecks[${index}]`;
      if (!isRecord(entry)) {
        issues.push(issue(entryPath, "INVALID_RECORD", `${entryPath} must be an object.`));
        return;
      }
      requireString(entry, "name", entryPath, issues);
      if (typeof entry.required !== "boolean") {
        issues.push(issue(`${entryPath}.required`, "INVALID_TYPE", "required must be a boolean."));
      }
      if (!isFiniteNumber(entry.timeoutMs) || entry.timeoutMs <= 0) {
        issues.push(issue(`${entryPath}.timeoutMs`, "INVALID_NUMBER", "timeoutMs must be a positive finite number."));
      }
    });
  }

  return validationResult(issues);
}

export function validateCaptureManifestFrame(value: unknown): AiGraderValidationResult {
  return validationResult(validateCaptureManifestFrameInternal(value, "frame"));
}

export function validateCaptureManifest(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "manifest";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "CaptureManifest must be an object.")]);
  }

  [
    "id",
    "captureSessionId",
    "tenantId",
    "rigId",
    "locationId",
    "operatorId",
    "helperInstanceId",
    "helperVersion",
    "createdAt",
  ].forEach((field) => requireString(value, field, path, issues));

  if (!hasValidSha256(value.checksumSha256)) {
    issues.push(issue(`${path}.checksumSha256`, "INVALID_CHECKSUM", "checksumSha256 must be a 64-character hex SHA-256 digest."));
  }

  if (!hasValidTimestamp(value.createdAt)) {
    issues.push(issue(`${path}.createdAt`, "INVALID_TIMESTAMP", "createdAt must be a valid timestamp string."));
  }

  validateStringRecord(value.driverVersions, `${path}.driverVersions`, issues);
  validateStringRecord(value.componentSerials, `${path}.componentSerials`, issues);
  requireStringArray(value.calibrationSnapshotIds, `${path}.calibrationSnapshotIds`, issues);

  if (!Array.isArray(value.frameList)) {
    issues.push(issue(`${path}.frameList`, "INVALID_ARRAY", "frameList must be an array."));
  } else if (value.frameList.length === 0) {
    issues.push(issue(`${path}.frameList`, "EMPTY_ARRAY", "frameList must include at least one frame."));
  } else {
    value.frameList.forEach((frame, index) => {
      issues.push(...validateCaptureManifestFrameInternal(frame, `${path}.frameList[${index}]`));
    });
  }

  if (!Array.isArray(value.operatorPrompts)) {
    issues.push(issue(`${path}.operatorPrompts`, "INVALID_ARRAY", "operatorPrompts must be an array."));
  } else {
    value.operatorPrompts.forEach((entry, index) => {
      const entryPath = `${path}.operatorPrompts[${index}]`;
      if (!isRecord(entry)) {
        issues.push(issue(entryPath, "INVALID_RECORD", `${entryPath} must be an object.`));
        return;
      }
      requireString(entry, "prompt", entryPath, issues);
      if (!hasValidTimestamp(entry.shownAt)) {
        issues.push(issue(`${entryPath}.shownAt`, "INVALID_TIMESTAMP", "shownAt must be a valid timestamp string."));
      }
      if (entry.confirmedAt != null && !hasValidTimestamp(entry.confirmedAt)) {
        issues.push(issue(`${entryPath}.confirmedAt`, "INVALID_TIMESTAMP", "confirmedAt must be a valid timestamp string."));
      }
    });
  }

  if (!Array.isArray(value.deviceHealth)) {
    issues.push(issue(`${path}.deviceHealth`, "INVALID_ARRAY", "deviceHealth must be an array."));
  } else if (value.deviceHealth.length === 0) {
    issues.push(issue(`${path}.deviceHealth`, "EMPTY_ARRAY", "deviceHealth must include at least one check result."));
  } else {
    value.deviceHealth.forEach((entry, index) => {
      const entryPath = `${path}.deviceHealth[${index}]`;
      if (!isRecord(entry)) {
        issues.push(issue(entryPath, "INVALID_RECORD", `${entryPath} must be an object.`));
        return;
      }
      requireString(entry, "check", entryPath, issues);
      if (!isNonEmptyString(entry.status) || !DEVICE_HEALTH_STATUS_VALUES.has(entry.status)) {
        issues.push(issue(`${entryPath}.status`, "INVALID_ENUM", "deviceHealth status must be PASS, WARN, or FAIL."));
      }
      if (entry.detail != null && typeof entry.detail !== "string") {
        issues.push(issue(`${entryPath}.detail`, "INVALID_TYPE", "deviceHealth detail must be a string when provided."));
      }
    });
  }

  return validationResult(issues);
}

function captureFramesForMode(value: unknown): CaptureManifestFrame[] {
  if (!isRecord(value) || !Array.isArray(value.frameList)) {
    return [];
  }
  return value.frameList.filter(isRecord) as unknown as CaptureManifestFrame[];
}

function frameMatchesSide(frame: CaptureManifestFrame, side?: CaptureSide): boolean {
  return !side || frame.side === side;
}

function isMacroFrame(frame: CaptureManifestFrame): boolean {
  return (
    frame.kind === "COLOR_CHECKER_FRONT" ||
    frame.kind === "COLOR_CHECKER_BACK" ||
    frame.kind === "FRONT_DIFFUSE" ||
    frame.kind === "BACK_DIFFUSE" ||
    frame.kind === "FRONT_DARKFIELD" ||
    frame.kind === "BACK_DARKFIELD" ||
    frame.kind.startsWith("FRONT_LED_") ||
    frame.kind.startsWith("BACK_LED_")
  );
}

function countFrames(frames: CaptureManifestFrame[], kind: GradingCaptureKind, side?: CaptureSide): number {
  return frames.filter((frame) => frame.kind === kind && frameMatchesSide(frame, side)).length;
}

export function validateCaptureManifestForMode(
  manifest: unknown,
  mode: GradingMode,
  options: CaptureManifestModeValidationOptions = {}
): AiGraderValidationResult {
  const issues = [...validateCaptureManifest(manifest).issues];

  if (!GRADING_MODE_VALUES.has(mode)) {
    issues.push(issue("mode", "INVALID_ENUM", "mode must be a supported GradingMode."));
    return validationResult(issues);
  }

  const plan = buildModePlan(mode);
  const frames = captureFramesForMode(manifest).filter((frame) => frameMatchesSide(frame, options.side));
  const sideLabel = options.side ? ` for ${options.side}` : "";
  const macroFrameCount = frames.filter(isMacroFrame).length;

  if (plan.macroRequired && macroFrameCount < 1) {
    issues.push(issue("manifest.frameList", "MODE_MISSING_MACRO_FRAME", `Mode ${mode} requires at least one macro frame${sideLabel}.`));
  }

  if (plan.microscopePlan.type === "STANDARD_SPOTS") {
    const cornerCount = countFrames(frames, "MICRO_CORNER_SPOT", options.side);
    const edgeCount = countFrames(frames, "MICRO_EDGE_SPOT", options.side);
    const surfaceCount = countFrames(frames, "MICRO_SURFACE_SPOT", options.side);
    const surfaceTopN = options.surfaceTopN ?? plan.microscopePlan.surfaceTopN;

    if (cornerCount < plan.microscopePlan.cornersPerSide || edgeCount < plan.microscopePlan.edgesPerSide) {
      issues.push(issue("manifest.frameList", "MODE_MISSING_MICRO_SPOTS", `STANDARD requires 4 corner and 4 edge microscope spots per side${sideLabel}.`));
    }
    if (surfaceCount > surfaceTopN) {
      issues.push(issue("manifest.frameList", "MODE_TOO_MANY_SURFACE_SPOTS", `STANDARD allows at most ${surfaceTopN} routed surface spots per side${sideLabel}.`));
    }
    frames
      .filter((frame) => frame.kind === "MICRO_SURFACE_SPOT")
      .forEach((frame) => {
        if (!isNonEmptyString(frame.sourceSuspectRegionId)) {
          issues.push(issue(`manifest.frameList.${frame.frameId}.sourceSuspectRegionId`, "MODE_MISSING_SURFACE_REGION", "STANDARD surface microscope spots must link to a source suspect region."));
        }
      });
  }

  if (plan.microscopePlan.type === "AUTH_PATCHES") {
    const authPatchCount = countFrames(frames, "MICRO_AUTH_PATCH", options.side);
    if (authPatchCount < plan.microscopePlan.patchCount) {
      issues.push(issue("manifest.frameList", "MODE_MISSING_AUTH_PATCHES", `AUTH_ONLY requires ${plan.microscopePlan.patchCount} microscope auth patches${sideLabel}.`));
    }
  }

  if (plan.microscopePlan.type === "FORENSIC_RASTER") {
    const authPatchCount = countFrames(frames, "MICRO_AUTH_PATCH", options.side);
    const hasCornerRaster = countFrames(frames, "MICRO_CORNER_TILE", options.side) > 0;
    const hasEdgeRaster = countFrames(frames, "MICRO_EDGE_TILE", options.side) > 0;
    const hasSurfaceRaster = countFrames(frames, "MICRO_SURFACE_TILE", options.side) > 0;
    if (!hasCornerRaster || !hasEdgeRaster || !hasSurfaceRaster) {
      issues.push(issue("manifest.frameList", "MODE_MISSING_FORENSIC_RASTER", `FORENSIC requires corner, edge, and surface raster evidence at contract level${sideLabel}.`));
    }
    if (authPatchCount < 5) {
      issues.push(issue("manifest.frameList", "MODE_MISSING_AUTH_PATCHES", `FORENSIC requires at least 5 microscope auth patches${sideLabel}.`));
    }
  }

  return validationResult(issues);
}

export function buildInitialAiGraderAlgorithmVersions(): AlgorithmVersionSeed[] {
  const seeds: AlgorithmVersionSeed[] = [
    {
      name: "STANDARD_SPOT_FUSION_V1",
      semanticVersion: "1.0.0",
      sourceHash: STANDARD_SPOT_FUSION_SOURCE_HASH,
      internalReference: "v5.standard.spot_fusion",
      numericTolerance: {
        finalGrade: 0,
        elementGrade: 0,
        measurement: 0.000001,
      },
      activeFrom: AI_GRADER_SEED_ACTIVE_FROM,
    },
    {
      name: "MACRO_PIPELINE_V1",
      semanticVersion: "1.0.0",
      sourceHash: MACRO_PIPELINE_SOURCE_HASH,
      internalReference: "v5.macro.pipeline",
      numericTolerance: {
        centeringMicrons: 15,
        suspectScore: 0.000001,
        provisionalGrade: 0,
      },
      activeFrom: AI_GRADER_SEED_ACTIVE_FROM,
    },
    {
      name: "CMYK_PRINT_PROFILE_V1",
      semanticVersion: "1.0.0",
      sourceHash: CMYK_PRINT_PROFILE_SOURCE_HASH,
      internalReference: "v5.auth.cmyk_print_profile",
      numericTolerance: {
        cmykDistance: 0.000001,
        fingerprintComponent: 0.000001,
      },
      activeFrom: AI_GRADER_SEED_ACTIVE_FROM,
    },
  ];

  return seeds.map((seed) => ({
    ...seed,
    numericTolerance: { ...seed.numericTolerance },
  }));
}

export function buildInitialAiGraderThresholdSets(): ThresholdSetVersionSeed[] {
  const seeds: ThresholdSetVersionSeed[] = [
    {
      name: "DEFAULT_AI_GRADER_THRESHOLDS_V1",
      semanticVersion: "1.0.0",
      sourceHash: DEFAULT_THRESHOLDS_SOURCE_HASH,
      thresholds: {
        surfaceSuspectThreshold: 0.72,
        standardSurfaceTopN: 3,
        standardCornersPerSide: 4,
        standardEdgesPerSide: 4,
        authPatchCount: 5,
        replayTolerance: {
          finalGrade: 0,
          elementGrade: 0,
          measurement: 0.000001,
        },
      },
      activeFrom: AI_GRADER_SEED_ACTIVE_FROM,
    },
  ];

  return seeds.map((seed) => ({
    ...seed,
    thresholds: { ...seed.thresholds },
  }));
}

export function buildRuntimeEnvironmentFingerprint(
  input: RuntimeEnvironmentFingerprintInput
): RuntimeEnvironmentFingerprint {
  const normalized: RuntimeEnvironmentFingerprint = {
    label: input.label.trim(),
    containerDigest: input.containerDigest.trim(),
    dependencyLockHash: input.dependencyLockHash.trim(),
    fingerprintKey: `${input.containerDigest.trim()}::${input.dependencyLockHash.trim()}`,
  };

  if (isNonEmptyString(input.pythonVersion)) {
    normalized.pythonVersion = input.pythonVersion.trim();
  }
  if (isNonEmptyString(input.nodeVersion)) {
    normalized.nodeVersion = input.nodeVersion.trim();
  }
  if (isNonEmptyString(input.opencvVersion)) {
    normalized.opencvVersion = input.opencvVersion.trim();
  }
  if (isNonEmptyString(input.numpyVersion)) {
    normalized.numpyVersion = input.numpyVersion.trim();
  }
  if (isRecord(input.osInfo)) {
    normalized.osInfo = { ...input.osInfo };
  }

  return normalized;
}

export function validateAlgorithmVersionSeed(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "seed";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "AlgorithmVersionSeed must be an object.")]);
  }

  requireString(value, "name", path, issues);
  validateSemver(value.semanticVersion, `${path}.semanticVersion`, issues);

  if (!hasValidSha256(value.sourceHash)) {
    issues.push(issue(`${path}.sourceHash`, "INVALID_CHECKSUM", "sourceHash must be a 64-character hex SHA-256 digest."));
  }

  if (value.internalReference != null && !isNonEmptyString(value.internalReference)) {
    issues.push(issue(`${path}.internalReference`, "REQUIRED", "internalReference must be non-empty when provided."));
  }
  if (value.patentReference != null && !isNonEmptyString(value.patentReference)) {
    issues.push(issue(`${path}.patentReference`, "REQUIRED", "patentReference must be non-empty when provided."));
  }

  validateNumericToleranceMap(value.numericTolerance, `${path}.numericTolerance`, issues);
  validateDateWindow(value, path, issues);

  return validationResult(issues);
}

export function validateThresholdSetVersionSeed(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "seed";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "ThresholdSetVersionSeed must be an object.")]);
  }

  requireString(value, "name", path, issues);
  validateSemver(value.semanticVersion, `${path}.semanticVersion`, issues);

  if (!isRecord(value.thresholds)) {
    issues.push(issue(`${path}.thresholds`, "INVALID_RECORD", "thresholds must be an object."));
  } else if (Object.keys(value.thresholds).length === 0) {
    issues.push(issue(`${path}.thresholds`, "EMPTY_ARRAY", "thresholds must include at least one threshold."));
  }

  if (value.sourceHash != null && !hasValidSha256(value.sourceHash)) {
    issues.push(issue(`${path}.sourceHash`, "INVALID_CHECKSUM", "sourceHash must be a 64-character hex SHA-256 digest when provided."));
  }

  validateDateWindow(value, path, issues);

  return validationResult(issues);
}

export function validateRuntimeEnvironmentFingerprint(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "fingerprint";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "RuntimeEnvironmentFingerprint must be an object.")]);
  }

  requireString(value, "label", path, issues);
  requireString(value, "containerDigest", path, issues);
  requireString(value, "dependencyLockHash", path, issues);
  requireString(value, "fingerprintKey", path, issues);

  if (!hasValidContainerDigest(value.containerDigest)) {
    issues.push(issue(`${path}.containerDigest`, "INVALID_CHECKSUM", "containerDigest must be a sha256 digest."));
  }
  if (!hasValidSha256(value.dependencyLockHash)) {
    issues.push(issue(`${path}.dependencyLockHash`, "INVALID_CHECKSUM", "dependencyLockHash must be a 64-character hex SHA-256 digest."));
  }
  if (
    isNonEmptyString(value.containerDigest) &&
    isNonEmptyString(value.dependencyLockHash) &&
    value.fingerprintKey !== `${value.containerDigest}::${value.dependencyLockHash}`
  ) {
    issues.push(issue(`${path}.fingerprintKey`, "INVALID_CHECKSUM", "fingerprintKey must match containerDigest and dependencyLockHash."));
  }

  ["pythonVersion", "nodeVersion", "opencvVersion", "numpyVersion"].forEach((field) => {
    if (value[field] != null && !isNonEmptyString(value[field])) {
      issues.push(issue(`${path}.${field}`, "REQUIRED", `${field} must be non-empty when provided.`));
    }
  });

  if (value.osInfo != null && !isRecord(value.osInfo)) {
    issues.push(issue(`${path}.osInfo`, "INVALID_RECORD", "osInfo must be an object when provided."));
  }

  return validationResult(issues);
}

export function validateReplayTolerance(input: ReplayRunInput): ReplayToleranceResult {
  const issues: AiGraderValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      validInput: false,
      tolerancePassed: false,
      checked: 0,
      maxAbsDelta: 0,
      failures: [],
      issues: [issue("replay", "INVALID_RECORD", "ReplayRunInput must be an object.")],
    };
  }

  [
    "sourceGradeRunId",
    "algorithmVersionId",
    "thresholdSetVersionId",
    "runtimeEnvironmentId",
  ].forEach((field) => requireString(input as unknown as Record<string, unknown>, field, "replay", issues));

  if (!hasValidSha256(input.inputChecksum)) {
    issues.push(issue("replay.inputChecksum", "INVALID_CHECKSUM", "inputChecksum must be a 64-character hex SHA-256 digest."));
  }
  if (!hasValidSha256(input.outputChecksum)) {
    issues.push(issue("replay.outputChecksum", "INVALID_CHECKSUM", "outputChecksum must be a 64-character hex SHA-256 digest."));
  }

  if (!isRecord(input.deltas)) {
    issues.push(issue("replay.deltas", "INVALID_RECORD", "deltas must be an object."));
  }
  validateNumericToleranceMap(input.numericTolerance, "replay.numericTolerance", issues);

  const failures: ReplayToleranceFailure[] = [];
  let checked = 0;
  let maxAbsDelta = 0;

  if (isRecord(input.deltas) && isRecord(input.numericTolerance)) {
    Object.entries(input.deltas).forEach(([path, rawDelta]) => {
      if (!isFiniteNumber(rawDelta)) {
        issues.push(issue(`replay.deltas.${path}`, "INVALID_NUMBER", "Replay deltas must be finite numbers."));
        return;
      }

      const rawTolerance = input.numericTolerance[path];
      if (!isFiniteNumber(rawTolerance)) {
        issues.push(issue(`replay.numericTolerance.${path}`, "MISSING_TOLERANCE", "Each replay delta must have a numeric tolerance."));
        return;
      }

      checked += 1;
      const absDelta = Math.abs(rawDelta);
      maxAbsDelta = Math.max(maxAbsDelta, absDelta);
      if (absDelta > rawTolerance) {
        failures.push({ path, delta: rawDelta, tolerance: rawTolerance });
      }
    });
  }

  return {
    validInput: issues.length === 0,
    tolerancePassed: issues.length === 0 && failures.length === 0,
    checked,
    maxAbsDelta,
    failures,
    issues,
  };
}

export type OrchestratorState =
  | "INIT"
  | "MACRO_PREFLIGHT"
  | "MACRO_CAPTURE"
  | "MACRO_PIPELINE"
  | "ARM_IN_PROMPT"
  | "ARM_IN_CONFIRMED"
  | "STAGE_HOME"
  | "MICRO_SPOTS"
  | "ARM_OUT_PROMPT"
  | "ARM_OUT_CONFIRMED"
  | "FUSION"
  | "REVIEW"
  | "OPERATOR_OVERRIDE_PENDING"
  | "COMPLETE"
  | "STAGE_HOME_FAILED"
  | "MICRO_INCOMPLETE_REQUIRES_REVIEW"
  | "ARM_POSITION_CONFLICT"
  | "MACRO_OBSTRUCTION_DETECTED"
  | "UPLOAD_FAILED"
  | "SPOT_FAILED_REQUIRES_DECISION"
  | "PHYSICAL_GATE_REVIEW"
  | "PAUSED_OPERATOR_TIMEOUT"
  | "ABORTED";

export type OrchestratorEventType =
  | "SESSION_CREATED"
  | "PREFLIGHT_PASS"
  | "MACRO_UPLOADED"
  | "MACRO_PIPELINE_COMPLETE"
  | "ARM_IN_CONFIRMED"
  | "STAGE_HOME_COMPLETE"
  | "MICRO_SPOTS_COMPLETE"
  | "ARM_OUT_CONFIRMED"
  | "FUSION_COMPLETE"
  | "OPERATOR_APPROVED"
  | "OPERATOR_OVERRIDE_SUBMITTED"
  | "ERROR"
  | "ABORT";

export type OrchestratorGuardValue = boolean | string | number;
export type OrchestratorGuardResults = Record<string, OrchestratorGuardValue>;

export interface OrchestratorEvent {
  sessionId: string;
  from: OrchestratorState;
  to: OrchestratorState;
  event: OrchestratorEventType;
  guardResults: OrchestratorGuardResults;
  errorCode?: string;
  occurredAt: string;
}

export interface OrchestratorTransitionResult {
  accepted: boolean;
  nextState: OrchestratorState;
  auditEventId: string;
  userVisibleMessage?: string;
}

export interface OrchestratorTransitionInput {
  sessionId: string;
  currentState: OrchestratorState;
  event: OrchestratorEventType;
  guardResults?: OrchestratorGuardResults;
  errorCode?: string;
  occurredAt?: string;
}

export const ORCHESTRATOR_NAMED_ERROR_STATES: readonly OrchestratorState[] = [
  "STAGE_HOME_FAILED",
  "MICRO_INCOMPLETE_REQUIRES_REVIEW",
  "ARM_POSITION_CONFLICT",
  "MACRO_OBSTRUCTION_DETECTED",
  "UPLOAD_FAILED",
  "SPOT_FAILED_REQUIRES_DECISION",
  "PHYSICAL_GATE_REVIEW",
  "PAUSED_OPERATOR_TIMEOUT",
  "ABORTED",
];

type TransitionRule = {
  from: OrchestratorState;
  to: OrchestratorState;
  event: OrchestratorEventType;
  guard?: (guards: OrchestratorGuardResults) => boolean;
  errorCode?: string;
  userVisibleMessage?: string;
};

const MICROSCOPE_MODES = new Set<GradingMode>([
  "STANDARD",
  "FORENSIC",
  "AUTH_ONLY",
  "MACRO_PLUS_CORNERS",
  "MACRO_PLUS_EDGES",
  "FULL_TWO_SCALE",
]);

function guardIsTrue(guards: OrchestratorGuardResults, key: string): boolean {
  return guards[key] === true;
}

function guardIsNotFalse(guards: OrchestratorGuardResults, key: string): boolean {
  return guards[key] !== false;
}

function guardString(guards: OrchestratorGuardResults, key: string): string {
  const value = guards[key];
  return typeof value === "string" ? value : "";
}

function hasMode(guards: OrchestratorGuardResults, modes: ReadonlySet<GradingMode>): boolean {
  const mode = guardString(guards, "mode") as GradingMode;
  return modes.has(mode);
}

function isMacroOnlyMode(guards: OrchestratorGuardResults): boolean {
  const mode = guardString(guards, "mode");
  return mode === "QUICK" || mode === "MACRO_ONLY";
}

function isArmPosition(guards: OrchestratorGuardResults, position: "ARM_IN" | "ARM_OUT"): boolean {
  return guardString(guards, "interlockPosition") === position || guardString(guards, "armPosition") === position;
}

function hasErrorCode(input: OrchestratorTransitionInput, rule: TransitionRule): boolean {
  if (!rule.errorCode) {
    return true;
  }
  return input.errorCode === rule.errorCode || input.guardResults?.errorCode === rule.errorCode;
}

const TRANSITION_RULES: readonly TransitionRule[] = [
  {
    from: "INIT",
    to: "MACRO_PREFLIGHT",
    event: "SESSION_CREATED",
    guard: (guards) =>
      guardIsTrue(guards, "sessionBelongsToTenant") &&
      guardIsTrue(guards, "rigActive") &&
      guardIsTrue(guards, "operatorAuthorized"),
  },
  {
    from: "INIT",
    to: "ABORTED",
    event: "ABORT",
    userVisibleMessage: "Session was aborted before capture started.",
  },
  {
    from: "MACRO_PREFLIGHT",
    to: "MACRO_CAPTURE",
    event: "PREFLIGHT_PASS",
    guard: (guards) =>
      isArmPosition(guards, "ARM_OUT") && guardIsTrue(guards, "noObstruction") && guardIsTrue(guards, "cardStable"),
  },
  {
    from: "MACRO_PREFLIGHT",
    to: "ARM_POSITION_CONFLICT",
    event: "ERROR",
    errorCode: "ARM_POSITION_CONFLICT",
    userVisibleMessage: "Arm position confirmation does not match the interlock.",
  },
  {
    from: "MACRO_PREFLIGHT",
    to: "MACRO_OBSTRUCTION_DETECTED",
    event: "ERROR",
    errorCode: "MACRO_OBSTRUCTION_DETECTED",
    userVisibleMessage: "Macro preview is obstructed; clear the view before recapture.",
  },
  {
    from: "MACRO_PREFLIGHT",
    to: "PHYSICAL_GATE_REVIEW",
    event: "ERROR",
    errorCode: "PHYSICAL_GATE_REVIEW",
    userVisibleMessage: "Physical gate triggered; authorized review is required.",
  },
  {
    from: "MACRO_CAPTURE",
    to: "MACRO_PIPELINE",
    event: "MACRO_UPLOADED",
    guard: (guards) => guardIsTrue(guards, "requiredFramesUploaded"),
  },
  {
    from: "MACRO_CAPTURE",
    to: "UPLOAD_FAILED",
    event: "ERROR",
    errorCode: "UPLOAD_FAILED",
    userVisibleMessage: "Required frame upload failed after retries.",
  },
  {
    from: "MACRO_PIPELINE",
    to: "FUSION",
    event: "MACRO_PIPELINE_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "macroOutputValid") && isMacroOnlyMode(guards),
  },
  {
    from: "MACRO_PIPELINE",
    to: "ARM_IN_PROMPT",
    event: "MACRO_PIPELINE_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "macroOutputValid") && hasMode(guards, MICROSCOPE_MODES),
  },
  {
    from: "MACRO_PIPELINE",
    to: "PHYSICAL_GATE_REVIEW",
    event: "ERROR",
    errorCode: "PHYSICAL_GATE_REVIEW",
    userVisibleMessage: "Physical gate triggered; authorized review is required.",
  },
  {
    from: "ARM_IN_PROMPT",
    to: "PAUSED_OPERATOR_TIMEOUT",
    event: "ERROR",
    errorCode: "PAUSED_OPERATOR_TIMEOUT",
    userVisibleMessage: "Operator confirmation timed out; the session remains resumable.",
  },
  {
    from: "ARM_IN_PROMPT",
    to: "ARM_IN_CONFIRMED",
    event: "ARM_IN_CONFIRMED",
    guard: (guards) => guardIsTrue(guards, "operatorConfirmed") && isArmPosition(guards, "ARM_IN"),
  },
  {
    from: "ARM_IN_PROMPT",
    to: "ARM_POSITION_CONFLICT",
    event: "ERROR",
    errorCode: "ARM_POSITION_CONFLICT",
    userVisibleMessage: "Arm position confirmation does not match the interlock.",
  },
  {
    from: "ARM_IN_CONFIRMED",
    to: "STAGE_HOME",
    event: "ARM_IN_CONFIRMED",
    guard: (guards) => isArmPosition(guards, "ARM_IN"),
  },
  {
    from: "ARM_IN_CONFIRMED",
    to: "ARM_POSITION_CONFLICT",
    event: "ERROR",
    errorCode: "ARM_POSITION_CONFLICT",
    userVisibleMessage: "Arm moved out of the confirmed microscope position.",
  },
  {
    from: "STAGE_HOME",
    to: "MICRO_SPOTS",
    event: "STAGE_HOME_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "homeSuccess") && guardIsTrue(guards, "positionReadable"),
  },
  {
    from: "STAGE_HOME",
    to: "STAGE_HOME_FAILED",
    event: "ERROR",
    errorCode: "STAGE_HOME_FAILED",
    userVisibleMessage: "Stage homing failed after retry; mechanical inspection is required.",
  },
  {
    from: "MICRO_SPOTS",
    to: "ARM_OUT_PROMPT",
    event: "MICRO_SPOTS_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "allRequiredPackagesValid"),
  },
  {
    from: "MICRO_SPOTS",
    to: "SPOT_FAILED_REQUIRES_DECISION",
    event: "ERROR",
    errorCode: "SPOT_FAILED_REQUIRES_DECISION",
    userVisibleMessage: "A microscope spot failed after retry; operator decision is required.",
  },
  {
    from: "MICRO_SPOTS",
    to: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    event: "ERROR",
    errorCode: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    userVisibleMessage: "Microscope evidence is incomplete and requires review.",
  },
  {
    from: "SPOT_FAILED_REQUIRES_DECISION",
    to: "MICRO_SPOTS",
    event: "MICRO_SPOTS_COMPLETE",
    guard: (guards) => guardString(guards, "operatorDecision") === "RETRY_SPOT",
  },
  {
    from: "SPOT_FAILED_REQUIRES_DECISION",
    to: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    event: "ERROR",
    errorCode: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    guard: (guards) => guardString(guards, "operatorDecision") === "COMPLETE_WITH_WARNING",
    userVisibleMessage: "Microscope evidence is incomplete and requires review.",
  },
  {
    from: "SPOT_FAILED_REQUIRES_DECISION",
    to: "ABORTED",
    event: "ABORT",
    userVisibleMessage: "Session was aborted after a failed microscope spot.",
  },
  {
    from: "ARM_OUT_PROMPT",
    to: "ARM_OUT_CONFIRMED",
    event: "ARM_OUT_CONFIRMED",
    guard: (guards) => guardIsTrue(guards, "operatorConfirmed") && isArmPosition(guards, "ARM_OUT"),
  },
  {
    from: "ARM_OUT_PROMPT",
    to: "ARM_POSITION_CONFLICT",
    event: "ERROR",
    errorCode: "ARM_POSITION_CONFLICT",
    userVisibleMessage: "Arm position confirmation does not match the interlock.",
  },
  {
    from: "ARM_OUT_CONFIRMED",
    to: "FUSION",
    event: "ARM_OUT_CONFIRMED",
    guard: (guards) => guardIsNotFalse(guards, "obstructionClear"),
  },
  {
    from: "ARM_OUT_CONFIRMED",
    to: "MACRO_OBSTRUCTION_DETECTED",
    event: "ERROR",
    errorCode: "MACRO_OBSTRUCTION_DETECTED",
    userVisibleMessage: "Macro preview is obstructed; clear the view before recapture.",
  },
  {
    from: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    to: "FUSION",
    event: "FUSION_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "warningAccepted"),
  },
  {
    from: "FUSION",
    to: "REVIEW",
    event: "FUSION_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "gradeRunWritten"),
  },
  {
    from: "FUSION",
    to: "ABORTED",
    event: "ERROR",
    errorCode: "ABORTED",
    userVisibleMessage: "Session was aborted during fusion.",
  },
  {
    from: "REVIEW",
    to: "COMPLETE",
    event: "OPERATOR_APPROVED",
    guard: (guards) => guards.blockingGates !== true,
  },
  {
    from: "REVIEW",
    to: "OPERATOR_OVERRIDE_PENDING",
    event: "OPERATOR_OVERRIDE_SUBMITTED",
  },
  {
    from: "REVIEW",
    to: "ABORTED",
    event: "ABORT",
    userVisibleMessage: "Session was rejected during review.",
  },
  {
    from: "OPERATOR_OVERRIDE_PENDING",
    to: "COMPLETE",
    event: "OPERATOR_APPROVED",
    guard: (guards) => guardIsTrue(guards, "overrideReviewedApproved"),
  },
  {
    from: "OPERATOR_OVERRIDE_PENDING",
    to: "ABORTED",
    event: "ABORT",
    userVisibleMessage: "Operator override was rejected.",
  },
];

function buildPendingAuditEventId(input: OrchestratorTransitionInput, nextState: OrchestratorState): string {
  const occurredAt = input.occurredAt ?? "";
  return ["pending", input.sessionId, input.currentState, input.event, nextState, occurredAt].join(":");
}

export function transitionOrchestratorState(
  input: OrchestratorTransitionInput
): OrchestratorTransitionResult {
  const guards = input.guardResults ?? {};
  const rule = TRANSITION_RULES.find(
    (candidate) =>
      candidate.from === input.currentState &&
      candidate.event === input.event &&
      hasErrorCode(input, candidate) &&
      (!candidate.guard || candidate.guard(guards))
  );

  const nextState = rule?.to ?? input.currentState;

  return {
    accepted: Boolean(rule),
    nextState,
    auditEventId: buildPendingAuditEventId(input, nextState),
    userVisibleMessage: rule?.userVisibleMessage,
  };
}
