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
