// Exact browser-safe DTO contract copied from frozen Agent 2 SHA 0dabf96521c64fac75553dd8cd2bcac4a02a49f4.
const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT = "1.2.0" as const;
const FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA = "ten-kings-mathematical-calibration-capture-session-v1.2" as const;
export type FastCalibrationPhaseV1_2 = "checkerboard_placements" | "blank_reverse_flip" | "photometric_sweep" | "analyze" | "finalize" | "ready_for_explicit_activation";
export interface FastCalibrationPoseV1_2 {
  sourceFrameSha256: string;
  centerXFraction: number;
  centerYFraction: number;
  coverageFraction: number;
  rotationDegrees: number;
  safetyMarginFraction: number;
  authorityReprojectionResidualPx: number;
  outerCorners: readonly [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
}

export const MATHEMATICAL_CALIBRATION_V1_2_BASE_PATH =
  "/calibration/mathematical-v1.2" as const;

export const MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS = Object.freeze({
  sessions: "/calibration/mathematical-v1.2/sessions",
  start: "/calibration/mathematical-v1.2/start",
  status: "/calibration/mathematical-v1.2/status",
  capture: "/calibration/mathematical-v1.2/capture",
  retry: "/calibration/mathematical-v1.2/retry",
  replacePose: "/calibration/mathematical-v1.2/replace-pose",
  analyze: "/calibration/mathematical-v1.2/analyze",
  finalize: "/calibration/mathematical-v1.2/finalize",
} as const);

export const MATHEMATICAL_CALIBRATION_V1_2_STATUS_DTO_SCHEMA =
  "ten-kings-mathematical-calibration-session-status-v1.2" as const;
export const MATHEMATICAL_CALIBRATION_V1_2_LIST_DTO_SCHEMA =
  "ten-kings-mathematical-calibration-session-list-v1.2" as const;
export const MATHEMATICAL_CALIBRATION_V1_2_REPLACEMENT_ACKNOWLEDGEMENT =
  "replace_accepted_pose_and_preserve_superseded_evidence" as const;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export type MathematicalCalibrationV1_2RevisionToken = string;
export type MathematicalCalibrationV1_2BridgeAction =
  | "mathematical-calibration-v1.2-sessions"
  | "mathematical-calibration-v1.2-start"
  | "mathematical-calibration-v1.2-status"
  | "mathematical-calibration-v1.2-capture"
  | "mathematical-calibration-v1.2-retry"
  | "mathematical-calibration-v1.2-replace-pose"
  | "mathematical-calibration-v1.2-analyze"
  | "mathematical-calibration-v1.2-finalize";

export interface MathematicalCalibrationV1_2ExpectedActionDto {
  action:
    | "capture_checkerboard"
    | "confirm_blank_reverse_flip"
    | "capture_photometric"
    | "complete_batch_cleanup"
    | "analyze"
    | "finalize"
    | "activate_explicitly";
  role:
    | "checkerboard_placement"
    | "blank_reverse_flip"
    | "dark_control"
    | "flat_field"
    | "illumination_pattern"
    | "safe_off"
    | "analysis"
    | "finalization"
    | "activation";
  slot: number | null;
  channelIndex: number | null;
  sampleIndex: number | null;
}

export interface MathematicalCalibrationV1_2AcceptedPoseDto {
  operationId: string;
  slot: number;
  evidenceSha256: string;
  byteSize: number;
  acceptedRevision: MathematicalCalibrationV1_2RevisionToken;
  supersedesOperationId: string | null;
  supersededByOperationId: string | null;
  active: boolean;
  pose: FastCalibrationPoseV1_2;
}

export interface MathematicalCalibrationV1_2FailedAttemptDto {
  operationId: string;
  recordedRevision: MathematicalCalibrationV1_2RevisionToken;
  action: MathematicalCalibrationV1_2ExpectedActionDto["action"];
  slot: number | null;
  channelIndex: number | null;
  sampleIndex: number | null;
  issue: string;
}

export interface MathematicalCalibrationV1_2AutomaticSweepProgressDto {
  acceptedFrames: number;
  requiredFrames: 72;
  darkAccepted: number;
  darkRequired: 24;
  flatFieldAccepted: number;
  flatFieldRequired: 24;
  illuminationPatternAccepted: number;
  illuminationPatternRequired: 24;
  batchCleanupConfirmed: boolean;
  nextRole: "dark_control" | "flat_field" | "illumination_pattern" | null;
  nextChannelIndex: number | null;
  nextSampleIndex: number | null;
}

export interface MathematicalCalibrationV1_2AnalysisStateDto {
  state: "not_started" | "failed" | "accepted";
  analysisSha256: string | null;
  sourceManifestSha256: string | null;
  sourceArtifactLedgerSha256: string | null;
  issues: string[];
}

export interface MathematicalCalibrationV1_2FinalizationStateDto {
  state: "not_started" | "failed" | "completed";
  bundleSha256: string | null;
  memberLedgerSha256: string | null;
  analysisSha256: string | null;
  sourceArtifactLedgerSha256: string | null;
  runtimeContextSha256: string;
  rigCharacterizationSha256: string;
  memberCount: 0 | 12;
  issues: string[];
}

export interface MathematicalCalibrationV1_2SessionStatusDto {
  schemaVersion: typeof MATHEMATICAL_CALIBRATION_V1_2_STATUS_DTO_SCHEMA;
  sessionSchemaVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA;
  contractVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT;
  sessionId: string;
  revision: MathematicalCalibrationV1_2RevisionToken;
  phase: FastCalibrationPhaseV1_2;
  expectedAction: MathematicalCalibrationV1_2ExpectedActionDto;
  acceptedPoses: MathematicalCalibrationV1_2AcceptedPoseDto[];
  failedAttempts: MathematicalCalibrationV1_2FailedAttemptDto[];
  aggregateSpans: { x: number; y: number; rotationDegrees: number };
  blankReverseFlip: { confirmed: boolean; count: 0 | 1 };
  automaticSweep: MathematicalCalibrationV1_2AutomaticSweepProgressDto;
  analysis: MathematicalCalibrationV1_2AnalysisStateDto;
  finalization: MathematicalCalibrationV1_2FinalizationStateDto;
  activationEligible: boolean;
}

export interface MathematicalCalibrationV1_2SessionListItemDto {
  sessionId: string;
  revision: MathematicalCalibrationV1_2RevisionToken;
  contractVersion: typeof FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT;
  phase: FastCalibrationPhaseV1_2;
  expectedAction: MathematicalCalibrationV1_2ExpectedActionDto["action"];
  acceptedImageCount: number;
  requiredImageCount: 76;
  activationEligible: boolean;
}

export interface MathematicalCalibrationV1_2SessionListResponseDto {
  schemaVersion: typeof MATHEMATICAL_CALIBRATION_V1_2_LIST_DTO_SCHEMA;
  sessions: MathematicalCalibrationV1_2SessionListItemDto[];
}

export interface StartMathematicalCalibrationV1_2SessionRequestDto {
  resumeSessionId?: string;
  expectedRevision?: MathematicalCalibrationV1_2RevisionToken;
}

export interface MathematicalCalibrationV1_2SessionMutationRequestDto {
  sessionId: string;
  expectedRevision: MathematicalCalibrationV1_2RevisionToken;
}

export interface ReplaceMathematicalCalibrationV1_2PoseRequestDto
  extends MathematicalCalibrationV1_2SessionMutationRequestDto {
  acceptedSlot: 1 | 2 | 3 | 4;
  acknowledgement: typeof MATHEMATICAL_CALIBRATION_V1_2_REPLACEMENT_ACKNOWLEDGEMENT;
}

export interface MathematicalCalibrationV1_2LocalSessionAuthority {
  listSessions(): Promise<MathematicalCalibrationV1_2SessionListResponseDto>;
  startOrResume(
    request: StartMathematicalCalibrationV1_2SessionRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto>;
  status(sessionId: string): Promise<MathematicalCalibrationV1_2SessionStatusDto>;
  executeExpectedStep(
    request: MathematicalCalibrationV1_2SessionMutationRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto>;
  retryExpectedStep(
    request: MathematicalCalibrationV1_2SessionMutationRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto>;
  replaceAcceptedPose(
    request: ReplaceMathematicalCalibrationV1_2PoseRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto>;
  analyze(
    request: MathematicalCalibrationV1_2SessionMutationRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto>;
  finalize(
    request: MathematicalCalibrationV1_2SessionMutationRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto>;
}

type JsonObject = Record<string, unknown>;

const PHASES = new Set<FastCalibrationPhaseV1_2>([
  "checkerboard_placements",
  "blank_reverse_flip",
  "photometric_sweep",
  "analyze",
  "finalize",
  "ready_for_explicit_activation",
]);
const ACTIONS = new Set<MathematicalCalibrationV1_2ExpectedActionDto["action"]>([
  "capture_checkerboard", "confirm_blank_reverse_flip", "capture_photometric", "complete_batch_cleanup",
  "analyze", "finalize", "activate_explicitly",
]);
const PHOTOMETRIC_ROLES = new Set(["dark_control", "flat_field", "illumination_pattern"]);

function exactObject(value: unknown, keys: readonly string[], label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be one exact object.`);
  }
  const record = value as JsonObject;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields do not match the exact V1.2 bridge contract.`);
  }
  return record;
}

function exactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${label} must be an exact safe identifier.`);
  return value;
}

function exactRevision(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a server-issued SHA-256 revision token.`);
  return value;
}

function nullableSha(value: unknown, label: string): void {
  if (value !== null) exactRevision(value, label);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function finiteNonNegative(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative.`);
  }
}

function issueList(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((issue) => typeof issue !== "string" || issue.length === 0 || issue.length > 1000)) {
    throw new Error(`${label} must contain bounded non-empty issue strings.`);
  }
}

function validateExpectedAction(value: unknown): asserts value is MathematicalCalibrationV1_2ExpectedActionDto {
  const action = exactObject(value, ["action", "role", "slot", "channelIndex", "sampleIndex"], "expectedAction");
  const roles = new Set([
    "checkerboard_placement", "blank_reverse_flip", "dark_control", "flat_field", "illumination_pattern",
    "safe_off", "analysis", "finalization", "activation",
  ]);
  if (!ACTIONS.has(action.action as MathematicalCalibrationV1_2ExpectedActionDto["action"]) ||
      !roles.has(action.role as string)) {
    throw new Error("expectedAction action or role is not allowlisted.");
  }
  if (action.action === "capture_checkerboard") {
    const slot = boundedInteger(action.slot, 1, 4, "expectedAction.slot");
    if (action.role !== "checkerboard_placement" || action.channelIndex !== null || action.sampleIndex !== slot) {
      throw new Error("Checkerboard expectedAction identity is inconsistent.");
    }
    return;
  }
  if (action.action === "capture_photometric") {
    boundedInteger(action.slot, 1, 72, "expectedAction.slot");
    boundedInteger(action.channelIndex, 1, 8, "expectedAction.channelIndex");
    boundedInteger(action.sampleIndex, 1, 3, "expectedAction.sampleIndex");
    if (!PHOTOMETRIC_ROLES.has(action.role as string)) {
      throw new Error("Photometric expectedAction role is inconsistent.");
    }
    return;
  }
  const nonCaptureBindings: Record<string, string> = {
    confirm_blank_reverse_flip: "blank_reverse_flip",
    complete_batch_cleanup: "safe_off",
    analyze: "analysis",
    finalize: "finalization",
    activate_explicitly: "activation",
  };
  if (action.role !== nonCaptureBindings[action.action as string] || action.slot !== null ||
      action.channelIndex !== null || action.sampleIndex !== null) {
    throw new Error("Non-capture expectedAction identity is inconsistent.");
  }
}

export function validateMathematicalCalibrationV1_2SessionStatusDto(
  value: unknown,
): MathematicalCalibrationV1_2SessionStatusDto {
  const status = exactObject(value, [
    "schemaVersion", "sessionSchemaVersion", "contractVersion", "sessionId", "revision", "phase",
    "expectedAction", "acceptedPoses", "failedAttempts", "aggregateSpans", "blankReverseFlip",
    "automaticSweep", "analysis", "finalization", "activationEligible",
  ], "Mathematical Calibration V1.2 session status");
  if (status.schemaVersion !== MATHEMATICAL_CALIBRATION_V1_2_STATUS_DTO_SCHEMA ||
      status.sessionSchemaVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA ||
      status.contractVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT) {
    throw new Error("Mathematical Calibration V1.2 session status authority version mismatch.");
  }
  exactId(status.sessionId, "status.sessionId");
  exactRevision(status.revision, "status.revision");
  if (!PHASES.has(status.phase as FastCalibrationPhaseV1_2)) throw new Error("Session phase is not allowlisted.");
  validateExpectedAction(status.expectedAction);
  const expectedForPhase: Record<FastCalibrationPhaseV1_2, readonly string[]> = {
    checkerboard_placements: ["capture_checkerboard"],
    blank_reverse_flip: ["confirm_blank_reverse_flip"],
    photometric_sweep: ["capture_photometric", "complete_batch_cleanup"],
    analyze: ["analyze"],
    finalize: ["finalize"],
    ready_for_explicit_activation: ["activate_explicitly"],
  };
  if (!expectedForPhase[status.phase as FastCalibrationPhaseV1_2].includes(
    (status.expectedAction as MathematicalCalibrationV1_2ExpectedActionDto).action,
  )) {
    throw new Error("Session phase and server-owned expected action are inconsistent.");
  }
  if (!Array.isArray(status.acceptedPoses) || !Array.isArray(status.failedAttempts)) {
    throw new Error("Status accepted poses and failed attempts must be arrays.");
  }
  const acceptedOperationIds = new Set<string>();
  for (const value of status.acceptedPoses) {
    const pose = exactObject(value, [
      "operationId", "slot", "evidenceSha256", "byteSize", "acceptedRevision", "supersedesOperationId",
      "supersededByOperationId", "active", "pose",
    ], "accepted pose");
    const operationId = exactId(pose.operationId, "accepted pose operationId");
    if (acceptedOperationIds.has(operationId)) throw new Error("Accepted pose operationId is duplicated.");
    acceptedOperationIds.add(operationId);
    boundedInteger(pose.slot, 1, 4, "accepted pose slot");
    exactRevision(pose.evidenceSha256, "accepted pose evidenceSha256");
    boundedInteger(pose.byteSize, 1, Number.MAX_SAFE_INTEGER, "accepted pose byteSize");
    exactRevision(pose.acceptedRevision, "accepted pose acceptedRevision");
    if (pose.supersedesOperationId !== null) exactId(pose.supersedesOperationId, "accepted pose supersedesOperationId");
    if (pose.supersededByOperationId !== null) exactId(pose.supersededByOperationId, "accepted pose supersededByOperationId");
    if (typeof pose.active !== "boolean" || !pose.pose || typeof pose.pose !== "object") {
      throw new Error("Accepted pose active state or geometry is invalid.");
    }
    const geometry = exactObject(pose.pose, [
      "sourceFrameSha256", "centerXFraction", "centerYFraction", "coverageFraction", "rotationDegrees",
      "safetyMarginFraction", "authorityReprojectionResidualPx", "outerCorners",
    ], "accepted pose geometry");
    exactRevision(geometry.sourceFrameSha256, "accepted pose sourceFrameSha256");
    for (const name of ["centerXFraction", "centerYFraction", "coverageFraction", "safetyMarginFraction"] as const) {
      if (typeof geometry[name] !== "number" || !Number.isFinite(geometry[name]) ||
          (geometry[name] as number) <= 0 || (geometry[name] as number) >= 1) {
        throw new Error(`Accepted pose ${name} must be strictly inside normalized bounds.`);
      }
    }
    if (typeof geometry.rotationDegrees !== "number" || !Number.isFinite(geometry.rotationDegrees)) {
      throw new Error("Accepted pose rotationDegrees must be finite.");
    }
    finiteNonNegative(geometry.authorityReprojectionResidualPx, "accepted pose authorityReprojectionResidualPx");
    if (!Array.isArray(geometry.outerCorners) || geometry.outerCorners.length !== 4 || geometry.outerCorners.some((corner) => {
      const point = exactObject(corner, ["x", "y"], "accepted pose outer corner");
      return typeof point.x !== "number" || !Number.isFinite(point.x) || point.x <= 0 ||
        typeof point.y !== "number" || !Number.isFinite(point.y) || point.y <= 0;
    })) throw new Error("Accepted pose must contain four positive finite outer corners.");
  }
  for (const value of status.failedAttempts) {
    const failure = exactObject(value, [
      "operationId", "recordedRevision", "action", "slot", "channelIndex", "sampleIndex", "issue",
    ], "failed attempt");
    exactId(failure.operationId, "failed attempt operationId");
    exactRevision(failure.recordedRevision, "failed attempt recordedRevision");
    if (!ACTIONS.has(failure.action as MathematicalCalibrationV1_2ExpectedActionDto["action"]) ||
        typeof failure.issue !== "string" || failure.issue.length === 0 || failure.issue.length > 1000) {
      throw new Error("Failed attempt action or issue is invalid.");
    }
    if (failure.slot !== null) boundedInteger(failure.slot, 1, 72, "failed attempt slot");
    if (failure.channelIndex !== null) boundedInteger(failure.channelIndex, 1, 8, "failed attempt channelIndex");
    if (failure.sampleIndex !== null) boundedInteger(failure.sampleIndex, 1, 72, "failed attempt sampleIndex");
  }
  const spans = exactObject(status.aggregateSpans, ["x", "y", "rotationDegrees"], "aggregateSpans");
  Object.entries(spans).forEach(([name, value]) => finiteNonNegative(value, `aggregateSpans.${name}`));
  const flip = exactObject(status.blankReverseFlip, ["confirmed", "count"], "blankReverseFlip");
  if (typeof flip.confirmed !== "boolean" || (flip.count !== 0 && flip.count !== 1) || flip.confirmed !== (flip.count === 1)) {
    throw new Error("Blank reverse flip projection is inconsistent.");
  }
  const sweep = exactObject(status.automaticSweep, [
    "acceptedFrames", "requiredFrames", "darkAccepted", "darkRequired", "flatFieldAccepted", "flatFieldRequired",
    "illuminationPatternAccepted", "illuminationPatternRequired", "batchCleanupConfirmed", "nextRole",
    "nextChannelIndex", "nextSampleIndex",
  ], "automaticSweep");
  boundedInteger(sweep.acceptedFrames, 0, 72, "automaticSweep.acceptedFrames");
  boundedInteger(sweep.darkAccepted, 0, 24, "automaticSweep.darkAccepted");
  boundedInteger(sweep.flatFieldAccepted, 0, 24, "automaticSweep.flatFieldAccepted");
  boundedInteger(sweep.illuminationPatternAccepted, 0, 24, "automaticSweep.illuminationPatternAccepted");
  if (sweep.requiredFrames !== 72 || sweep.darkRequired !== 24 || sweep.flatFieldRequired !== 24 ||
      sweep.illuminationPatternRequired !== 24 || typeof sweep.batchCleanupConfirmed !== "boolean") {
    throw new Error("Automatic sweep required counts or cleanup state changed.");
  }
  if (sweep.acceptedFrames !== (sweep.darkAccepted as number) + (sweep.flatFieldAccepted as number) +
      (sweep.illuminationPatternAccepted as number)) {
    throw new Error("Automatic sweep accepted-frame projection is inconsistent.");
  }
  if (sweep.nextRole === null) {
    if (sweep.nextChannelIndex !== null || sweep.nextSampleIndex !== null || sweep.acceptedFrames !== 72) {
      throw new Error("Automatic sweep missing-frame projection is inconsistent.");
    }
  } else {
    if (!PHOTOMETRIC_ROLES.has(sweep.nextRole as string) || sweep.acceptedFrames >= 72) {
      throw new Error("Automatic sweep nextRole is invalid.");
    }
    boundedInteger(sweep.nextChannelIndex, 1, 8, "automaticSweep.nextChannelIndex");
    boundedInteger(sweep.nextSampleIndex, 1, 3, "automaticSweep.nextSampleIndex");
  }
  const analysis = exactObject(status.analysis, [
    "state", "analysisSha256", "sourceManifestSha256", "sourceArtifactLedgerSha256", "issues",
  ], "analysis");
  if (!["not_started", "failed", "accepted"].includes(analysis.state as string)) throw new Error("Analysis state is invalid.");
  nullableSha(analysis.analysisSha256, "analysis.analysisSha256");
  nullableSha(analysis.sourceManifestSha256, "analysis.sourceManifestSha256");
  nullableSha(analysis.sourceArtifactLedgerSha256, "analysis.sourceArtifactLedgerSha256");
  issueList(analysis.issues, "analysis.issues");
  if (analysis.state === "accepted" &&
      [analysis.analysisSha256, analysis.sourceManifestSha256, analysis.sourceArtifactLedgerSha256].some((value) => value === null)) {
    throw new Error("Accepted analysis must expose all exact result hashes.");
  }
  const finalization = exactObject(status.finalization, [
    "state", "bundleSha256", "memberLedgerSha256", "analysisSha256", "sourceArtifactLedgerSha256",
    "runtimeContextSha256", "rigCharacterizationSha256", "memberCount", "issues",
  ], "finalization");
  if (!["not_started", "failed", "completed"].includes(finalization.state as string)) throw new Error("Finalization state is invalid.");
  nullableSha(finalization.bundleSha256, "finalization.bundleSha256");
  nullableSha(finalization.memberLedgerSha256, "finalization.memberLedgerSha256");
  nullableSha(finalization.analysisSha256, "finalization.analysisSha256");
  nullableSha(finalization.sourceArtifactLedgerSha256, "finalization.sourceArtifactLedgerSha256");
  exactRevision(finalization.runtimeContextSha256, "finalization.runtimeContextSha256");
  exactRevision(finalization.rigCharacterizationSha256, "finalization.rigCharacterizationSha256");
  if (finalization.memberCount !== 0 && finalization.memberCount !== 12) throw new Error("Finalization memberCount must be 0 or 12.");
  issueList(finalization.issues, "finalization.issues");
  if (finalization.state === "completed" &&
      (finalization.memberCount !== 12 || [finalization.bundleSha256, finalization.memberLedgerSha256,
        finalization.analysisSha256, finalization.sourceArtifactLedgerSha256].some((value) => value === null))) {
    throw new Error("Completed finalization must expose the exact 12-member authority hashes.");
  }
  if (typeof status.activationEligible !== "boolean" ||
      status.activationEligible !== (status.phase === "ready_for_explicit_activation" && finalization.state === "completed")) {
    throw new Error("activationEligible must be derived only from completed local finalization.");
  }
  return value as MathematicalCalibrationV1_2SessionStatusDto;
}

export function validateMathematicalCalibrationV1_2SessionListResponseDto(
  value: unknown,
): MathematicalCalibrationV1_2SessionListResponseDto {
  const response = exactObject(value, ["schemaVersion", "sessions"], "Mathematical Calibration V1.2 session list");
  if (response.schemaVersion !== MATHEMATICAL_CALIBRATION_V1_2_LIST_DTO_SCHEMA || !Array.isArray(response.sessions)) {
    throw new Error("Mathematical Calibration V1.2 session list schema mismatch.");
  }
  for (const value of response.sessions) {
    const item = exactObject(value, [
      "sessionId", "revision", "contractVersion", "phase", "expectedAction",
      "acceptedImageCount", "requiredImageCount", "activationEligible",
    ], "session list item");
    exactId(item.sessionId, "session list item sessionId");
    exactRevision(item.revision, "session list item revision");
    if (!PHASES.has(item.phase as FastCalibrationPhaseV1_2) ||
        !ACTIONS.has(item.expectedAction as MathematicalCalibrationV1_2ExpectedActionDto["action"])) {
      throw new Error("Session list item phase or expected action is not allowlisted.");
    }
    if (item.contractVersion !== FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT ||
        item.requiredImageCount !== 76 || typeof item.activationEligible !== "boolean") {
      throw new Error("Session list item authority or required count mismatch.");
    }
    boundedInteger(item.acceptedImageCount, 0, 76, "session list item acceptedImageCount");
    if (item.activationEligible !== (item.phase === "ready_for_explicit_activation")) {
      throw new Error("Session list item activationEligible is not derived from the finalized phase.");
    }
  }
  return value as MathematicalCalibrationV1_2SessionListResponseDto;
}

export function parseStartMathematicalCalibrationV1_2SessionRequestDto(
  value: unknown,
): StartMathematicalCalibrationV1_2SessionRequestDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("V1.2 start request must be one exact object.");
  }
  const body = exactObject(value, Object.keys(value as JsonObject).length === 0
    ? []
    : ["resumeSessionId", "expectedRevision"], "V1.2 start request");
  if (Object.keys(body).length === 0) return {};
  return {
    resumeSessionId: exactId(body.resumeSessionId, "resumeSessionId"),
    expectedRevision: exactRevision(body.expectedRevision, "expectedRevision"),
  };
}

export function parseMathematicalCalibrationV1_2SessionMutationRequestDto(
  value: unknown,
): MathematicalCalibrationV1_2SessionMutationRequestDto {
  const body = exactObject(value, ["sessionId", "expectedRevision"], "V1.2 session mutation request");
  return {
    sessionId: exactId(body.sessionId, "sessionId"),
    expectedRevision: exactRevision(body.expectedRevision, "expectedRevision"),
  };
}

export function parseReplaceMathematicalCalibrationV1_2PoseRequestDto(
  value: unknown,
): ReplaceMathematicalCalibrationV1_2PoseRequestDto {
  const body = exactObject(value, [
    "sessionId", "expectedRevision", "acceptedSlot", "acknowledgement",
  ], "V1.2 replace-pose request");
  if (body.acknowledgement !== MATHEMATICAL_CALIBRATION_V1_2_REPLACEMENT_ACKNOWLEDGEMENT) {
    throw new Error("Explicit accepted-pose replacement requires the exact history-preservation acknowledgement.");
  }
  return {
    sessionId: exactId(body.sessionId, "sessionId"),
    expectedRevision: exactRevision(body.expectedRevision, "expectedRevision"),
    acceptedSlot: boundedInteger(body.acceptedSlot, 1, 4, "acceptedSlot") as 1 | 2 | 3 | 4,
    acknowledgement: MATHEMATICAL_CALIBRATION_V1_2_REPLACEMENT_ACKNOWLEDGEMENT,
  };
}
