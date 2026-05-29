import { Prisma } from "@prisma/client";
import type {
  AiGraderValidationIssue,
  AiGraderValidationIssueCode,
  CaptureManifest,
  CaptureSide,
  EvidenceArtifactRef,
  EvidenceArtifactContract,
  FusionAction,
  GradingMode,
  MacroPipelineOutput,
  MacroSuspectRegion,
  MicroSpotCapturePackage,
  MicroSpotFrameKey,
  OrchestratorEventType,
  OrchestratorGuardResults,
  OrchestratorState,
  StandardFusionOutput,
} from "@tenkings/shared";
import {
  ORCHESTRATOR_NAMED_ERROR_STATES,
  transitionOrchestratorState,
  validateCaptureManifest,
  validateEvidenceArtifactContract,
  validateMacroPipelineOutput,
  validateMacroSuspectRegion,
  validateMicroSpotCapturePackage,
  validateStandardFusionOutput,
} from "@tenkings/shared";

type NullableJsonInput = Prisma.InputJsonValue | typeof Prisma.JsonNull;

export type CaptureSessionPersistedStatus =
  | "CREATED"
  | "RUNNING"
  | "PAUSED"
  | "MICRO_INCOMPLETE_REQUIRES_REVIEW"
  | "PHYSICAL_GATE_REVIEW"
  | "REVIEW"
  | "COMPLETE"
  | "ABORTED";

export type CaptureSessionDraftCreateData = {
  id?: string;
  tenantId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId: string | null;
  gradingMode: GradingMode;
  status: "CREATED";
  currentState: OrchestratorState;
  rawCardOnly: boolean;
  cardIdentity?: NullableJsonInput;
  physicalGateResults?: NullableJsonInput;
};

export type CaptureSessionUpdateData = {
  currentState: OrchestratorState;
  status: CaptureSessionPersistedStatus;
  errorCode: string | null;
  startedAt?: Date;
  finishedAt?: Date;
};

export type CaptureManifestCreateData = {
  id: string;
  captureSessionId: string;
  tenantId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId: string;
  helperVersion: string;
  driverVersions: Prisma.InputJsonValue;
  componentSerials: Prisma.InputJsonValue;
  calibrationSnapshotIds: Prisma.InputJsonValue;
  frameList: Prisma.InputJsonValue;
  operatorPrompts: Prisma.InputJsonValue;
  deviceHealth: Prisma.InputJsonValue;
  checksum: string;
  createdAt: Date;
};

export type EvidenceArtifactCreateData = {
  id: string;
  tenantId: string;
  captureSessionId: string | null;
  gradeRunId: string | null;
  authRunId: string | null;
  certificateId: string | null;
  evidenceClass: EvidenceArtifactContract["evidenceClass"];
  kind: string;
  storageKey: string;
  checksumSha256: string;
  mimeType: string;
  byteSize?: number;
  widthPx?: number;
  heightPx?: number;
  retentionUntil?: Date;
  publicUrl?: string;
  metadata?: NullableJsonInput;
  createdAt: Date;
};

export type GradingSuspectRegionCreateData = {
  id: string;
  sessionId: string;
  side: CaptureSide;
  element: "SURFACE";
  rank: number;
  score: number;
  threshold: number;
  reasonCodes: Prisma.InputJsonValue;
  cardMm: Prisma.InputJsonValue;
  warpedPx: Prisma.InputJsonValue;
  sourcePx?: Prisma.InputJsonValue;
  heatmapStorageKey?: string;
  macroCaptureIds: Prisma.InputJsonValue;
  routedCaptureIds?: Prisma.InputJsonValue;
  thresholdSetId: string;
};

export type GradeRunStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "REPLAYED";

export type GradeRunCreateData = {
  id?: string;
  captureSessionId: string;
  captureManifestId: string;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  runtimeEnvironmentId: string;
  status: GradeRunStatus;
  mode: GradingMode;
  inputChecksum: string;
  outputChecksum?: string;
  macroMeasurements: Prisma.InputJsonValue;
  microMeasurements?: NullableJsonInput;
  fusionActions: Prisma.InputJsonValue;
  finalGrades?: NullableJsonInput;
  confidence?: NullableJsonInput;
  warnings?: NullableJsonInput;
  errorCode?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
};

export type GradeRunUpdateData = {
  status: GradeRunStatus;
  outputChecksum: string;
  macroMeasurements?: Prisma.InputJsonValue;
  microMeasurements?: NullableJsonInput;
  fusionActions: Prisma.InputJsonValue;
  finalGrades: Prisma.InputJsonValue;
  confidence?: NullableJsonInput;
  warnings?: NullableJsonInput;
  errorCode: string | null;
  finishedAt: Date;
};

export type AuditEventCreateData = {
  id?: string;
  tenantId: string;
  actorOperatorId: string | null;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED" | "WARNING";
  before?: NullableJsonInput;
  after?: NullableJsonInput;
  reasonCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  checksum: string;
  createdAt?: Date;
};

export type CaptureSessionState = {
  id: string;
  tenantId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId: string | null;
  gradingMode: GradingMode;
  status: string;
  currentState: string;
  errorCode: string | null;
  rawCardOnly: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GradeRunState = {
  id: string;
  captureSessionId: string;
  captureManifestId: string;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  runtimeEnvironmentId: string;
  status: GradeRunStatus;
  mode: GradingMode;
  inputChecksum: string;
  outputChecksum: string | null;
  macroMeasurements: Prisma.JsonValue;
  microMeasurements: Prisma.JsonValue | null;
  fusionActions: Prisma.JsonValue;
  finalGrades: Prisma.JsonValue | null;
  confidence: Prisma.JsonValue | null;
  warnings: Prisma.JsonValue | null;
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type AuthRunScope = {
  id: string;
  tenantId: string;
  captureSessionId: string | null;
};

export type GradeCertificateScope = {
  id: string;
  tenantId: string;
  gradeRunId: string;
  authRunId: string | null;
};

export type AiGraderServiceTransactionClient = {
  auditEvent: {
    create(args: { data: AuditEventCreateData }): Promise<unknown>;
  };
  captureManifest: {
    create(args: { data: CaptureManifestCreateData }): Promise<unknown>;
  };
  captureSession: {
    create(args: { data: CaptureSessionDraftCreateData }): Promise<unknown>;
    updateMany(args: {
      where: { id: string; tenantId: string };
      data: CaptureSessionUpdateData;
    }): Promise<{ count: number }>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: typeof captureSessionStateSelect;
    }): Promise<CaptureSessionState | null>;
  };
  evidenceArtifact: {
    create(args: { data: EvidenceArtifactCreateData }): Promise<unknown>;
  };
  gradeRun: {
    create(args: { data: GradeRunCreateData }): Promise<unknown>;
    updateMany(args: {
      where: { id: string; captureSession: { tenantId: string } };
      data: GradeRunUpdateData;
    }): Promise<{ count: number }>;
    findFirst(args: {
      where: { id: string; captureSession: { tenantId: string } };
      select: typeof gradeRunStateSelect;
    }): Promise<GradeRunState | null>;
  };
  authRun: {
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: typeof authRunScopeSelect;
    }): Promise<AuthRunScope | null>;
  };
  gradeCertificate: {
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: typeof gradeCertificateScopeSelect;
    }): Promise<GradeCertificateScope | null>;
  };
  gradingSuspectRegion: {
    createMany(args: { data: GradingSuspectRegionCreateData[] }): Promise<{ count: number }>;
  };
};

export type AiGraderServicePrismaClient = AiGraderServiceTransactionClient & {
  $transaction?: <T>(
    fn: (tx: AiGraderServiceTransactionClient) => Promise<T>
  ) => Promise<T>;
};

export type CreateCaptureSessionDraftInput = {
  id?: string;
  tenantId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId?: string | null;
  gradingMode?: GradingMode;
  rawCardOnly?: boolean;
  cardIdentity?: Prisma.InputJsonValue | null;
  physicalGateResults?: Prisma.InputJsonValue | null;
  currentState?: OrchestratorState;
};

export type ReadCaptureSessionStateInput = {
  tenantId: string;
  captureSessionId: string;
};

export type RecordAuditEventInput = {
  id?: string;
  tenantId: string;
  actorOperatorId?: string | null;
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED" | "WARNING";
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  reasonCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  checksum: string;
  createdAt?: string | Date;
};

export type PersistOrchestratorTransitionInput = {
  tenantId: string;
  captureSessionId: string;
  event: OrchestratorEventType;
  guardResults?: OrchestratorGuardResults;
  errorCode?: string;
  actorOperatorId?: string | null;
  actorUserId?: string | null;
  reasonCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: string | Date;
};

export type CommonCaptureSessionStateUpdateInput = {
  tenantId: string;
  captureSessionId: string;
  actorOperatorId?: string | null;
  actorUserId?: string | null;
  reasonCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: string | Date;
};

export type PersistedOrchestratorTransition = {
  session: CaptureSessionState;
  fromState: string;
  toState: OrchestratorState;
  status: CaptureSessionPersistedStatus;
  errorCode: string | null;
  transitionAuditEventId: string;
  auditEvent: unknown;
  updatedCount: number;
  userVisibleMessage?: string;
};

export type PersistMacroSuspectRegionsInput = {
  tenantId: string;
  captureSessionId: string;
  side: CaptureSide;
  regions: MacroSuspectRegion[];
};

export type PersistedMacroSuspectRegions = {
  session: CaptureSessionState;
  side: CaptureSide;
  count: number;
  regions: MacroSuspectRegion[];
};

export type RecordMacroPipelineCompletionInput = {
  tenantId: string;
  captureSessionId: string;
  output: MacroPipelineOutput;
  actorOperatorId?: string | null;
  actorUserId?: string | null;
  reasonCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: string | Date;
  advanceOrchestrator?: boolean;
  orchestratorGuardResults?: OrchestratorGuardResults;
};

export type RecordedMacroPipelineCompletion = {
  session: CaptureSessionState;
  auditEvent: unknown;
  orchestratorTransition?: PersistedOrchestratorTransition;
};

export type PersistMicroSpotPackageInput = {
  tenantId: string;
  captureSessionId: string;
  microSpotPackage: MicroSpotCapturePackage;
  createdAt?: string | Date;
};

export type PersistedMicroSpotPackage = {
  session: CaptureSessionState;
  microSpotPackage: MicroSpotCapturePackage;
  evidenceArtifacts: unknown[];
};

export type CreateGradeRunDraftInput = {
  id?: string;
  tenantId: string;
  captureSessionId: string;
  captureManifestId: string;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  runtimeEnvironmentId: string;
  mode?: GradingMode;
  status?: Extract<GradeRunStatus, "PENDING" | "RUNNING">;
  inputChecksum: string;
  macroMeasurements: Record<string, unknown>;
  microMeasurements?: Record<string, unknown> | null;
  fusionActions?: FusionAction[];
  startedAt?: string | Date;
};

export type CreatedGradeRunDraft = {
  session: CaptureSessionState;
  gradeRun: unknown;
};

export type FinalizeGradeRunInput = {
  tenantId: string;
  gradeRunId: string;
  outputChecksum: string;
  finalGrades: Record<string, number>;
  fusionActions: FusionAction[];
  macroMeasurements?: Record<string, unknown>;
  microMeasurements?: Record<string, unknown> | null;
  confidence?: Record<string, unknown> | null;
  warnings?: string[];
  finishedAt?: string | Date;
};

export type FinalizedGradeRun = {
  gradeRun: GradeRunState;
  updatedCount: number;
};

export type LinkedEvidenceArtifact = {
  artifact: unknown;
  scopes: {
    captureSession?: CaptureSessionState;
    gradeRun?: GradeRunState;
    authRun?: AuthRunScope;
    certificate?: GradeCertificateScope;
  };
};

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const NAMED_ERROR_STATES = new Set<OrchestratorState>(ORCHESTRATOR_NAMED_ERROR_STATES);
const REQUIRED_MICRO_SPOT_FRAME_KEYS: MicroSpotFrameKey[] = [
  "edrBase",
  "polarizedAllOn",
  "flcLed0",
  "flcLed1",
  "flcLed2",
  "flcLed3",
  "flcLed4",
  "flcLed5",
  "flcLed6",
  "flcLed7",
];

const captureSessionStateSelect = {
  id: true,
  tenantId: true,
  rigId: true,
  locationId: true,
  operatorId: true,
  helperInstanceId: true,
  gradingMode: true,
  status: true,
  currentState: true,
  errorCode: true,
  rawCardOnly: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const gradeRunStateSelect = {
  id: true,
  captureSessionId: true,
  captureManifestId: true,
  algorithmVersionId: true,
  thresholdSetVersionId: true,
  runtimeEnvironmentId: true,
  status: true,
  mode: true,
  inputChecksum: true,
  outputChecksum: true,
  macroMeasurements: true,
  microMeasurements: true,
  fusionActions: true,
  finalGrades: true,
  confidence: true,
  warnings: true,
  errorCode: true,
  startedAt: true,
  finishedAt: true,
} as const;

const authRunScopeSelect = {
  id: true,
  tenantId: true,
  captureSessionId: true,
} as const;

const gradeCertificateScopeSelect = {
  id: true,
  tenantId: true,
  gradeRunId: true,
  authRunId: true,
} as const;

export class AiGraderServiceValidationError extends Error {
  readonly issues: AiGraderValidationIssue[];

  constructor(message: string, issues: AiGraderValidationIssue[]) {
    super(message);
    this.name = "AiGraderServiceValidationError";
    this.issues = issues;
  }
}

function issue(
  path: string,
  code: AiGraderValidationIssueCode,
  message: string
): AiGraderValidationIssue {
  return { path, code, message };
}

function requireNonEmptyString(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(issue(path, "REQUIRED", `${path} is required.`));
  }
}

function throwIfInvalid(message: string, issues: AiGraderValidationIssue[]) {
  if (issues.length > 0) {
    throw new AiGraderServiceValidationError(message, issues);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prefixedIssue(pathPrefix: string, entry: AiGraderValidationIssue): AiGraderValidationIssue {
  if (entry.path.length === 0) {
    return { ...entry, path: pathPrefix };
  }
  return { ...entry, path: `${pathPrefix}.${entry.path}` };
}

function validateCaptureSessionDraftInput(input: CreateCaptureSessionDraftInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.rigId, "captureSession.rigId", issues);
  requireNonEmptyString(input.locationId, "captureSession.locationId", issues);
  requireNonEmptyString(input.operatorId, "captureSession.operatorId", issues);
  if (input.id != null) requireNonEmptyString(input.id, "captureSession.id", issues);
  if (input.helperInstanceId != null) {
    requireNonEmptyString(input.helperInstanceId, "captureSession.helperInstanceId", issues);
  }

  throwIfInvalid("Invalid capture session draft input.", issues);
}

function validateReadCaptureSessionStateInput(input: ReadCaptureSessionStateInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "captureSession.id", issues);

  throwIfInvalid("Invalid capture session state input.", issues);
}

function validateOrchestratorTransitionInput(input: PersistOrchestratorTransitionInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "captureSession.id", issues);
  requireNonEmptyString(input.event, "orchestrator.event", issues);
  if (input.errorCode != null) requireNonEmptyString(input.errorCode, "orchestrator.errorCode", issues);
  if (input.reasonCode != null) requireNonEmptyString(input.reasonCode, "orchestrator.reasonCode", issues);

  throwIfInvalid("Invalid orchestrator transition input.", issues);
}

function validateMacroSuspectRegionCollection(
  regions: unknown,
  input: Pick<PersistMacroSuspectRegionsInput, "captureSessionId" | "side">
): AiGraderValidationIssue[] {
  const issues: AiGraderValidationIssue[] = [];

  if (!Array.isArray(regions)) {
    issues.push(issue("macroSuspectRegions", "INVALID_ARRAY", "macroSuspectRegions must be an array."));
    return issues;
  }

  const ranks = new Set<number>();
  const ids = new Set<string>();
  regions.forEach((region, index) => {
    const path = `macroSuspectRegions[${index}]`;
    const result = validateMacroSuspectRegion(region);
    issues.push(...result.issues.map((entry) => prefixedIssue(path, entry)));

    if (!isRecord(region)) {
      return;
    }

    if (region.sessionId !== input.captureSessionId) {
      issues.push(issue(`${path}.sessionId`, "INVALID_RECORD", "suspect sessionId must match captureSessionId."));
    }
    if (region.side !== input.side) {
      issues.push(issue(`${path}.side`, "INVALID_ENUM", "suspect side must match the requested side."));
    }
    if (typeof region.rank === "number" && Number.isInteger(region.rank) && region.rank >= 1) {
      if (ranks.has(region.rank)) {
        issues.push(issue(`${path}.rank`, "INVALID_RANK", "suspect ranks must be unique per session, side, and element."));
      }
      ranks.add(region.rank);
    }
    if (typeof region.id === "string" && region.id.trim().length > 0) {
      if (ids.has(region.id)) {
        issues.push(issue(`${path}.id`, "INVALID_RECORD", "suspect ids must be unique."));
      }
      ids.add(region.id);
    }
  });

  return issues;
}

function validatePersistMacroSuspectRegionsInput(input: PersistMacroSuspectRegionsInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "captureSession.id", issues);
  if (input.side !== "FRONT" && input.side !== "BACK") {
    issues.push(issue("macroSuspectRegions.side", "INVALID_ENUM", "side must be FRONT or BACK."));
  }
  issues.push(...validateMacroSuspectRegionCollection(input.regions, input));

  throwIfInvalid("Invalid macro suspect regions input.", issues);
}

function validateMacroPipelineCompletionInput(input: RecordMacroPipelineCompletionInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "captureSession.id", issues);
  if (input.reasonCode != null) requireNonEmptyString(input.reasonCode, "macroPipeline.reasonCode", issues);

  const result = validateMacroPipelineOutput(input.output);
  issues.push(...result.issues.map((entry) => prefixedIssue("macroPipeline", entry)));
  if (input.output?.sessionId !== input.captureSessionId) {
    issues.push(issue("macroPipeline.output.sessionId", "INVALID_RECORD", "macro output sessionId must match captureSessionId."));
  }
  if (input.output && Array.isArray(input.output.suspectRegions)) {
    issues.push(...validateMacroSuspectRegionCollection(input.output.suspectRegions, {
      captureSessionId: input.captureSessionId,
      side: input.output.side,
    }));
  }

  throwIfInvalid("Invalid macro pipeline completion input.", issues);
}

function validateSha256(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
    issues.push(issue(path, "INVALID_CHECKSUM", `${path} must be a 64-character hex SHA-256 digest.`));
  }
}

function validateRecordInput(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an object.`));
  }
}

function validateOptionalRecordInput(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (value != null) {
    validateRecordInput(value, path, issues);
  }
}

function validateWarnings(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    issues.push(issue(path, "INVALID_ARRAY", `${path} must be an array when provided.`));
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      issues.push(issue(`${path}[${index}]`, "REQUIRED", `${path}[${index}] must be a non-empty string.`));
    }
  });
}

function validateFinalGrades(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an object.`));
    return;
  }

  Object.entries(value).forEach(([key, grade]) => {
    if (typeof grade !== "number" || !Number.isFinite(grade)) {
      issues.push(issue(`${path}.${key}`, "INVALID_NUMBER", "final grade values must be finite numbers."));
    }
  });
}

function hasEvidenceSourceLinkage(artifact: EvidenceArtifactContract): boolean {
  return Boolean(
    artifact.captureSessionId ||
      artifact.gradeRunId ||
      artifact.authRunId ||
      artifact.certificateId
  );
}

function validatePersistMicroSpotPackageInput(input: PersistMicroSpotPackageInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "captureSession.id", issues);

  const result = validateMicroSpotCapturePackage(input.microSpotPackage);
  issues.push(...result.issues.map((entry) => prefixedIssue("microSpotPackage", entry)));

  if (input.microSpotPackage?.sessionId !== input.captureSessionId) {
    issues.push(issue("microSpotPackage.sessionId", "INVALID_MICRO_PACKAGE", "micro package sessionId must match captureSessionId."));
  }
  if (input.microSpotPackage?.element === "CMYK_AUTHENTICATION") {
    issues.push(issue("microSpotPackage.element", "INVALID_ENUM", "STANDARD micro package persistence accepts CORNERS, EDGES, or SURFACE only."));
  }
  REQUIRED_MICRO_SPOT_FRAME_KEYS.forEach((frameKey) => {
    if (!input.microSpotPackage?.frames || input.microSpotPackage.frames[frameKey] == null) {
      issues.push(issue(`microSpotPackage.frames.${frameKey}`, "MISSING_FRAME", `${frameKey} is required.`));
    }
  });

  throwIfInvalid("Invalid micro spot package input.", issues);
}

function validateCreateGradeRunDraftInput(input: CreateGradeRunDraftInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "gradeRun.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "gradeRun.captureSessionId", issues);
  requireNonEmptyString(input.captureManifestId, "gradeRun.captureManifestId", issues);
  requireNonEmptyString(input.algorithmVersionId, "gradeRun.algorithmVersionId", issues);
  requireNonEmptyString(input.thresholdSetVersionId, "gradeRun.thresholdSetVersionId", issues);
  requireNonEmptyString(input.runtimeEnvironmentId, "gradeRun.runtimeEnvironmentId", issues);
  if (input.id != null) requireNonEmptyString(input.id, "gradeRun.id", issues);
  if (input.mode != null) requireNonEmptyString(input.mode, "gradeRun.mode", issues);
  if (input.status != null && input.status !== "PENDING" && input.status !== "RUNNING") {
    issues.push(issue("gradeRun.status", "INVALID_ENUM", "draft status must be PENDING or RUNNING."));
  }
  validateSha256(input.inputChecksum, "gradeRun.inputChecksum", issues);
  validateRecordInput(input.macroMeasurements, "gradeRun.macroMeasurements", issues);
  validateOptionalRecordInput(input.microMeasurements, "gradeRun.microMeasurements", issues);
  if (input.fusionActions != null && !Array.isArray(input.fusionActions)) {
    issues.push(issue("gradeRun.fusionActions", "INVALID_ARRAY", "fusionActions must be an array when provided."));
  }

  throwIfInvalid("Invalid grade run draft input.", issues);
}

function validateFinalizeGradeRunInput(input: FinalizeGradeRunInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "gradeRun.tenantId", issues);
  requireNonEmptyString(input.gradeRunId, "gradeRun.id", issues);
  validateSha256(input.outputChecksum, "gradeRun.outputChecksum", issues);
  validateFinalGrades(input.finalGrades, "gradeRun.finalGrades", issues);
  if (!Array.isArray(input.fusionActions)) {
    issues.push(issue("gradeRun.fusionActions", "INVALID_ARRAY", "fusionActions must be an array."));
  }
  validateOptionalRecordInput(input.macroMeasurements, "gradeRun.macroMeasurements", issues);
  validateOptionalRecordInput(input.microMeasurements, "gradeRun.microMeasurements", issues);
  validateOptionalRecordInput(input.confidence, "gradeRun.confidence", issues);
  validateWarnings(input.warnings, "gradeRun.warnings", issues);

  throwIfInvalid("Invalid grade run finalization input.", issues);
}

function validateLinkEvidenceArtifactInput(artifact: EvidenceArtifactContract) {
  assertValidEvidenceArtifact(artifact);

  if (!hasEvidenceSourceLinkage(artifact)) {
    throw new AiGraderServiceValidationError("Invalid evidence artifact linkage.", [
      issue("evidenceArtifact", "INVALID_EVIDENCE_ARTIFACT", "evidence artifacts must link to a capture session, grade run, auth run, or certificate."),
    ]);
  }
}

function validateAuditEventInput(input: RecordAuditEventInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "auditEvent.tenantId", issues);
  requireNonEmptyString(input.entityType, "auditEvent.entityType", issues);
  requireNonEmptyString(input.entityId, "auditEvent.entityId", issues);
  requireNonEmptyString(input.action, "auditEvent.action", issues);
  requireNonEmptyString(input.outcome, "auditEvent.outcome", issues);
  requireNonEmptyString(input.checksum, "auditEvent.checksum", issues);
  if (input.checksum && !SHA256_HEX_RE.test(input.checksum)) {
    issues.push(issue("auditEvent.checksum", "INVALID_CHECKSUM", "checksum must be a 64-character hex SHA-256 digest."));
  }

  throwIfInvalid("Invalid audit event input.", issues);
}

function optionalNullableJson(value: Prisma.InputJsonValue | null | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? Prisma.JsonNull : value;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildAuditChecksum(value: unknown) {
  const encoded = new TextEncoder().encode(stableJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

function isoDate(value: string, path: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AiGraderServiceValidationError("Invalid timestamp.", [
      issue(path, "INVALID_TIMESTAMP", `${path} must be a valid timestamp.`),
    ]);
  }
  return parsed;
}

function optionalDate(value: string | Date | undefined, path: string) {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new AiGraderServiceValidationError("Invalid timestamp.", [
        issue(path, "INVALID_TIMESTAMP", `${path} must be a valid timestamp.`),
      ]);
    }
    return value;
  }
  return isoDate(value, path);
}

function dateFromOptional(value: string | Date | undefined, path: string) {
  return optionalDate(value, path) ?? new Date();
}

function assertValidManifest(manifest: CaptureManifest) {
  const result = validateCaptureManifest(manifest);
  throwIfInvalid("Invalid capture manifest.", result.issues);
}

function assertValidEvidenceArtifact(artifact: EvidenceArtifactContract) {
  const result = validateEvidenceArtifactContract(artifact);
  throwIfInvalid("Invalid evidence artifact.", result.issues);
}

function evidenceArtifactCreateData(artifact: EvidenceArtifactContract): EvidenceArtifactCreateData {
  return {
    id: artifact.id,
    tenantId: artifact.tenantId,
    captureSessionId: artifact.captureSessionId ?? null,
    gradeRunId: artifact.gradeRunId ?? null,
    authRunId: artifact.authRunId ?? null,
    certificateId: artifact.certificateId ?? null,
    evidenceClass: artifact.evidenceClass,
    kind: artifact.kind,
    storageKey: artifact.storageKey,
    checksumSha256: artifact.checksumSha256,
    mimeType: artifact.mimeType,
    byteSize: artifact.byteSize,
    widthPx: artifact.widthPx,
    heightPx: artifact.heightPx,
    retentionUntil: artifact.retentionUntil ? isoDate(artifact.retentionUntil, "evidenceArtifact.retentionUntil") : undefined,
    publicUrl: artifact.publicUrl,
    metadata: optionalNullableJson(artifact.metadata as Prisma.InputJsonValue | undefined),
    createdAt: isoDate(artifact.createdAt, "evidenceArtifact.createdAt"),
  };
}

function statusForOrchestratorState(state: OrchestratorState): CaptureSessionPersistedStatus {
  if (state === "INIT") return "CREATED";
  if (state === "COMPLETE") return "COMPLETE";
  if (state === "ABORTED") return "ABORTED";
  if (state === "PAUSED_OPERATOR_TIMEOUT") return "PAUSED";
  if (state === "MICRO_INCOMPLETE_REQUIRES_REVIEW") return "MICRO_INCOMPLETE_REQUIRES_REVIEW";
  if (state === "PHYSICAL_GATE_REVIEW") return "PHYSICAL_GATE_REVIEW";
  if (state === "REVIEW" || state === "OPERATOR_OVERRIDE_PENDING" || NAMED_ERROR_STATES.has(state)) return "REVIEW";
  return "RUNNING";
}

function errorCodeForOrchestratorState(
  state: OrchestratorState,
  input: Pick<PersistOrchestratorTransitionInput, "errorCode" | "reasonCode">
) {
  if (!NAMED_ERROR_STATES.has(state)) {
    return null;
  }
  if (state === "ABORTED" && input.reasonCode) {
    return input.reasonCode;
  }
  return input.errorCode ?? input.reasonCode ?? state;
}

function auditOutcomeForStatus(status: CaptureSessionPersistedStatus): RecordAuditEventInput["outcome"] {
  if (status === "ABORTED") return "FAILURE";
  if (
    status === "PAUSED" ||
    status === "MICRO_INCOMPLETE_REQUIRES_REVIEW" ||
    status === "PHYSICAL_GATE_REVIEW" ||
    status === "REVIEW"
  ) {
    return "WARNING";
  }
  return "SUCCESS";
}

async function buildTransitionAuditInput(
  session: CaptureSessionState,
  input: PersistOrchestratorTransitionInput,
  nextState: OrchestratorState,
  status: CaptureSessionPersistedStatus,
  errorCode: string | null,
  occurredAt: Date,
  transitionAuditEventId: string,
  userVisibleMessage?: string
): Promise<RecordAuditEventInput> {
  const before = {
    currentState: session.currentState,
    status: session.status,
    errorCode: session.errorCode,
  };
  const after = {
    currentState: nextState,
    status,
    errorCode,
    event: input.event,
    guardResults: input.guardResults ?? {},
    transitionAuditEventId,
    userVisibleMessage: userVisibleMessage ?? null,
  };
  const checksum = await buildAuditChecksum({
    tenantId: input.tenantId,
    captureSessionId: input.captureSessionId,
    before,
    after,
    occurredAt: occurredAt.toISOString(),
  });

  return {
    tenantId: input.tenantId,
    actorOperatorId: input.actorOperatorId ?? null,
    actorUserId: input.actorUserId ?? null,
    entityType: "CaptureSession",
    entityId: input.captureSessionId,
    action: "ai_grader.orchestrator.transition",
    outcome: auditOutcomeForStatus(status),
    before: before as Prisma.InputJsonValue,
    after: after as Prisma.InputJsonValue,
    reasonCode: input.reasonCode ?? input.errorCode ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    checksum,
    createdAt: occurredAt,
  };
}

async function buildMacroPipelineCompletionAuditInput(
  session: CaptureSessionState,
  input: RecordMacroPipelineCompletionInput,
  occurredAt: Date
): Promise<RecordAuditEventInput> {
  const output = input.output;
  const before = {
    currentState: session.currentState,
    status: session.status,
    errorCode: session.errorCode,
  };
  const after = {
    sessionId: output.sessionId,
    side: output.side,
    captureManifestId: output.captureManifestId,
    algorithmVersionId: output.algorithmVersionId,
    thresholdSetVersionId: output.thresholdSetVersionId,
    suspectRegionCount: output.suspectRegions.length,
    physicalGateResultCount: output.physicalGateResults.length,
    evidenceArtifactCount: output.evidenceArtifacts.length,
    provisionalGrades: output.provisionalGrades,
    macroMeasurements: output.macroMeasurements,
    advanceOrchestrator: input.advanceOrchestrator === true,
  };
  const checksum = await buildAuditChecksum({
    tenantId: input.tenantId,
    captureSessionId: input.captureSessionId,
    before,
    after,
    occurredAt: occurredAt.toISOString(),
  });

  return {
    tenantId: input.tenantId,
    actorOperatorId: input.actorOperatorId ?? null,
    actorUserId: input.actorUserId ?? null,
    entityType: "CaptureSession",
    entityId: input.captureSessionId,
    action: "ai_grader.macro_pipeline.completed",
    outcome: "SUCCESS",
    before: before as Prisma.InputJsonValue,
    after: after as Prisma.InputJsonValue,
    reasonCode: input.reasonCode ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    checksum,
    createdAt: occurredAt,
  };
}

function transitionUpdateData(
  session: CaptureSessionState,
  nextState: OrchestratorState,
  status: CaptureSessionPersistedStatus,
  errorCode: string | null,
  occurredAt: Date
): CaptureSessionUpdateData {
  return {
    currentState: nextState,
    status,
    errorCode,
    ...(status === "RUNNING" && !session.startedAt ? { startedAt: occurredAt } : {}),
    ...(status === "COMPLETE" || status === "ABORTED" ? { finishedAt: occurredAt } : {}),
  };
}

function runInAiGraderTransaction<T>(
  db: AiGraderServicePrismaClient,
  fn: (tx: AiGraderServiceTransactionClient) => Promise<T>
) {
  if (db.$transaction) {
    return db.$transaction(fn);
  }
  return fn(db);
}

function macroSuspectRegionCreateData(region: MacroSuspectRegion): GradingSuspectRegionCreateData {
  return {
    id: region.id,
    sessionId: region.sessionId,
    side: region.side,
    element: "SURFACE",
    rank: region.rank,
    score: region.score,
    threshold: region.threshold,
    reasonCodes: region.reasonCodes,
    cardMm: region.cardMm as unknown as Prisma.InputJsonValue,
    warpedPx: region.warpedPx as unknown as Prisma.InputJsonValue,
    sourcePx: region.sourcePx as unknown as Prisma.InputJsonValue | undefined,
    heatmapStorageKey: region.heatmapStorageKey,
    macroCaptureIds: region.macroCaptureIds,
    thresholdSetId: region.thresholdSetId,
  };
}

function evidenceArtifactRefId(
  microSpotPackage: MicroSpotCapturePackage,
  frameKey: MicroSpotFrameKey,
  frame: EvidenceArtifactRef
) {
  return frame.id ?? `${microSpotPackage.id}:${frameKey}`;
}

function microSpotFrameEvidenceArtifact(
  input: PersistMicroSpotPackageInput,
  frameKey: MicroSpotFrameKey,
  frame: EvidenceArtifactRef,
  createdAt: Date
): EvidenceArtifactContract {
  const microSpotPackage = input.microSpotPackage;
  return {
    id: evidenceArtifactRefId(microSpotPackage, frameKey, frame),
    tenantId: input.tenantId,
    captureSessionId: input.captureSessionId,
    evidenceClass: "ORIGINAL",
    kind: "MICRO_SPOT_FRAME",
    storageKey: frame.storageKey,
    checksumSha256: frame.checksumSha256,
    mimeType: frame.mimeType ?? "image/tiff",
    byteSize: frame.byteSize,
    widthPx: frame.widthPx,
    heightPx: frame.heightPx,
    metadata: {
      captureManifestId: microSpotPackage.captureManifestId,
      microSpotPackageId: microSpotPackage.id,
      frameKey,
      side: microSpotPackage.side,
      element: microSpotPackage.element,
      spotIndex: microSpotPackage.spotIndex,
      totalSpots: microSpotPackage.totalSpots,
      sourceSuspectRegionId: microSpotPackage.sourceSuspectRegionId ?? null,
      stageXMicrons: microSpotPackage.stageXMicrons,
      stageYMicrons: microSpotPackage.stageYMicrons,
      microMagnification: microSpotPackage.microMagnification,
      amrReading: microSpotPackage.amrReading,
      focusScore: microSpotPackage.focusScore,
      validForClassification: microSpotPackage.validForClassification,
    },
    createdAt: createdAt.toISOString(),
  };
}

async function microSpotPackageEvidenceArtifacts(
  input: PersistMicroSpotPackageInput,
  createdAt: Date
): Promise<EvidenceArtifactContract[]> {
  const frameArtifacts = REQUIRED_MICRO_SPOT_FRAME_KEYS.map((frameKey) =>
    microSpotFrameEvidenceArtifact(input, frameKey, input.microSpotPackage.frames[frameKey], createdAt)
  );
  const packageChecksum = await buildAuditChecksum({
    tenantId: input.tenantId,
    captureSessionId: input.captureSessionId,
    microSpotPackage: input.microSpotPackage,
    frameArtifactIds: frameArtifacts.map((artifact) => artifact.id),
  });

  return [
    {
      id: `${input.microSpotPackage.id}:metadata`,
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
      evidenceClass: "DERIVED",
      kind: "MICRO_SPOT_PACKAGE_METADATA",
      storageKey: `ai-grader/${input.captureSessionId}/micro-packages/${encodeURIComponent(input.microSpotPackage.id)}.json`,
      checksumSha256: packageChecksum,
      mimeType: "application/json",
      metadata: {
        captureManifestId: input.microSpotPackage.captureManifestId,
        microSpotPackage: input.microSpotPackage,
        frameArtifactIds: frameArtifacts.map((artifact) => artifact.id),
      },
      createdAt: createdAt.toISOString(),
    },
    ...frameArtifacts,
  ];
}

function standardFusionOutputForFinalization(
  input: FinalizeGradeRunInput,
  gradeRun: GradeRunState
): StandardFusionOutput {
  return {
    gradeRunDraft: {
      macroMeasurements: input.macroMeasurements ?? (gradeRun.macroMeasurements as Record<string, unknown>),
      microMeasurements:
        input.microMeasurements ??
        (gradeRun.microMeasurements as Record<string, unknown> | null) ??
        {},
      fusionActions: input.fusionActions,
      finalGrades: input.finalGrades,
      warnings: input.warnings ?? [],
    },
  };
}

export async function createCaptureSessionDraft(
  db: AiGraderServicePrismaClient,
  input: CreateCaptureSessionDraftInput
) {
  validateCaptureSessionDraftInput(input);

  const data: CaptureSessionDraftCreateData = {
    ...(input.id ? { id: input.id } : {}),
    tenantId: input.tenantId,
    rigId: input.rigId,
    locationId: input.locationId,
    operatorId: input.operatorId,
    helperInstanceId: input.helperInstanceId ?? null,
    gradingMode: input.gradingMode ?? "STANDARD",
    status: "CREATED",
    currentState: input.currentState ?? "INIT",
    rawCardOnly: input.rawCardOnly ?? true,
    cardIdentity: optionalNullableJson(input.cardIdentity),
    physicalGateResults: optionalNullableJson(input.physicalGateResults),
  };

  return db.captureSession.create({ data });
}

export async function recordCaptureManifest(
  db: AiGraderServicePrismaClient,
  manifest: CaptureManifest
) {
  assertValidManifest(manifest);

  const data: CaptureManifestCreateData = {
    id: manifest.id,
    captureSessionId: manifest.captureSessionId,
    tenantId: manifest.tenantId,
    rigId: manifest.rigId,
    locationId: manifest.locationId,
    operatorId: manifest.operatorId,
    helperInstanceId: manifest.helperInstanceId,
    helperVersion: manifest.helperVersion,
    driverVersions: manifest.driverVersions as Prisma.InputJsonValue,
    componentSerials: manifest.componentSerials as Prisma.InputJsonValue,
    calibrationSnapshotIds: manifest.calibrationSnapshotIds,
    frameList: manifest.frameList as unknown as Prisma.InputJsonValue,
    operatorPrompts: manifest.operatorPrompts as unknown as Prisma.InputJsonValue,
    deviceHealth: manifest.deviceHealth as unknown as Prisma.InputJsonValue,
    checksum: manifest.checksumSha256,
    createdAt: isoDate(manifest.createdAt, "manifest.createdAt"),
  };

  return db.captureManifest.create({ data });
}

export async function recordEvidenceArtifact(
  db: AiGraderServicePrismaClient,
  artifact: EvidenceArtifactContract
) {
  assertValidEvidenceArtifact(artifact);

  return db.evidenceArtifact.create({ data: evidenceArtifactCreateData(artifact) });
}

export async function recordAuditEvent(
  db: AiGraderServicePrismaClient,
  input: RecordAuditEventInput
) {
  validateAuditEventInput(input);

  const data: AuditEventCreateData = {
    ...(input.id ? { id: input.id } : {}),
    tenantId: input.tenantId,
    actorOperatorId: input.actorOperatorId ?? null,
    actorUserId: input.actorUserId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    outcome: input.outcome,
    before: optionalNullableJson(input.before),
    after: optionalNullableJson(input.after),
    reasonCode: input.reasonCode ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    checksum: input.checksum,
    createdAt: optionalDate(input.createdAt, "auditEvent.createdAt"),
  };

  return db.auditEvent.create({ data });
}

export async function persistMacroSuspectRegions(
  db: AiGraderServicePrismaClient,
  input: PersistMacroSuspectRegionsInput
): Promise<PersistedMacroSuspectRegions> {
  validatePersistMacroSuspectRegionsInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for tenant.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession was not found for the supplied tenant and session id."),
      ]);
    }

    if (input.regions.length === 0) {
      return {
        session,
        side: input.side,
        count: 0,
        regions: [],
      };
    }

    const result = await tx.gradingSuspectRegion.createMany({
      data: input.regions.map(macroSuspectRegionCreateData),
    });

    return {
      session,
      side: input.side,
      count: result.count,
      regions: input.regions.map((region) => ({ ...region })),
    };
  });
}

export async function recordMacroPipelineCompletion(
  db: AiGraderServicePrismaClient,
  input: RecordMacroPipelineCompletionInput
): Promise<RecordedMacroPipelineCompletion> {
  validateMacroPipelineCompletionInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for tenant.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession was not found for the supplied tenant and session id."),
      ]);
    }

    const occurredAt = dateFromOptional(input.occurredAt, "macroPipeline.occurredAt");
    const orchestratorTransition = input.advanceOrchestrator
      ? await persistOrchestratorTransition(tx, {
          tenantId: input.tenantId,
          captureSessionId: input.captureSessionId,
          event: "MACRO_PIPELINE_COMPLETE",
          guardResults: {
            macroOutputValid: true,
            mode: session.gradingMode,
            ...(input.orchestratorGuardResults ?? {}),
          },
          actorOperatorId: input.actorOperatorId ?? null,
          actorUserId: input.actorUserId ?? null,
          reasonCode: input.reasonCode ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          occurredAt,
        })
      : undefined;

    const auditEvent = await recordAuditEvent(
      tx,
      await buildMacroPipelineCompletionAuditInput(session, input, occurredAt)
    );

    return {
      session,
      auditEvent,
      ...(orchestratorTransition ? { orchestratorTransition } : {}),
    };
  });
}

export async function persistMicroSpotPackage(
  db: AiGraderServicePrismaClient,
  input: PersistMicroSpotPackageInput
): Promise<PersistedMicroSpotPackage> {
  validatePersistMicroSpotPackageInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for tenant.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession was not found for the supplied tenant and session id."),
      ]);
    }

    const createdAt = dateFromOptional(input.createdAt ?? input.microSpotPackage.capturedAt, "microSpotPackage.createdAt");
    const artifacts = await microSpotPackageEvidenceArtifacts(input, createdAt);
    artifacts.forEach(assertValidEvidenceArtifact);

    const persistedArtifacts = [];
    for (const artifact of artifacts) {
      persistedArtifacts.push(await tx.evidenceArtifact.create({ data: evidenceArtifactCreateData(artifact) }));
    }

    return {
      session,
      microSpotPackage: { ...input.microSpotPackage },
      evidenceArtifacts: persistedArtifacts,
    };
  });
}

export async function createGradeRunDraft(
  db: AiGraderServicePrismaClient,
  input: CreateGradeRunDraftInput
): Promise<CreatedGradeRunDraft> {
  validateCreateGradeRunDraftInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for tenant.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession was not found for the supplied tenant and session id."),
      ]);
    }

    const mode = input.mode ?? session.gradingMode;
    if (input.mode != null && input.mode !== session.gradingMode) {
      throw new AiGraderServiceValidationError("Grade run mode does not match capture session.", [
        issue("gradeRun.mode", "INVALID_RECORD", "grade run mode must match the scoped capture session gradingMode."),
      ]);
    }

    const data: GradeRunCreateData = {
      ...(input.id ? { id: input.id } : {}),
      captureSessionId: input.captureSessionId,
      captureManifestId: input.captureManifestId,
      algorithmVersionId: input.algorithmVersionId,
      thresholdSetVersionId: input.thresholdSetVersionId,
      runtimeEnvironmentId: input.runtimeEnvironmentId,
      status: input.status ?? "RUNNING",
      mode,
      inputChecksum: input.inputChecksum,
      macroMeasurements: input.macroMeasurements as Prisma.InputJsonValue,
      microMeasurements: optionalNullableJson(input.microMeasurements as Prisma.InputJsonValue | null | undefined),
      fusionActions: (input.fusionActions ?? []) as unknown as Prisma.InputJsonValue,
      startedAt: optionalDate(input.startedAt, "gradeRun.startedAt"),
    };

    return {
      session,
      gradeRun: await tx.gradeRun.create({ data }),
    };
  });
}

export async function finalizeGradeRun(
  db: AiGraderServicePrismaClient,
  input: FinalizeGradeRunInput
): Promise<FinalizedGradeRun> {
  validateFinalizeGradeRunInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const gradeRun = await tx.gradeRun.findFirst({
      where: {
        id: input.gradeRunId,
        captureSession: { tenantId: input.tenantId },
      },
      select: gradeRunStateSelect,
    });

    if (!gradeRun) {
      throw new AiGraderServiceValidationError("Grade run not found for tenant.", [
        issue("gradeRun", "INVALID_RECORD", "GradeRun was not found for the supplied tenant and grade run id."),
      ]);
    }
    if (gradeRun.status !== "PENDING" && gradeRun.status !== "RUNNING") {
      throw new AiGraderServiceValidationError("Grade run cannot be finalized from current status.", [
        issue("gradeRun.status", "INVALID_RECORD", "GradeRun finalization requires PENDING or RUNNING status."),
      ]);
    }
    if (gradeRun.mode === "STANDARD" && input.fusionActions.length === 0) {
      throw new AiGraderServiceValidationError("STANDARD grade run finalization requires fusion actions.", [
        issue("gradeRun.fusionActions", "EMPTY_ARRAY", "STANDARD completion requires at least one fusion action."),
      ]);
    }

    if (gradeRun.mode === "STANDARD") {
      const fusionResult = validateStandardFusionOutput(standardFusionOutputForFinalization(input, gradeRun));
      throwIfInvalid("Invalid STANDARD grade run finalization payload.", fusionResult.issues);
    }

    const update = await tx.gradeRun.updateMany({
      where: {
        id: input.gradeRunId,
        captureSession: { tenantId: input.tenantId },
      },
      data: {
        status: "COMPLETE",
        outputChecksum: input.outputChecksum,
        macroMeasurements: input.macroMeasurements as Prisma.InputJsonValue | undefined,
        microMeasurements: optionalNullableJson(input.microMeasurements as Prisma.InputJsonValue | null | undefined),
        fusionActions: input.fusionActions as unknown as Prisma.InputJsonValue,
        finalGrades: input.finalGrades as Prisma.InputJsonValue,
        confidence: optionalNullableJson(input.confidence as Prisma.InputJsonValue | null | undefined),
        warnings: optionalNullableJson((input.warnings ?? []) as Prisma.InputJsonValue),
        errorCode: null,
        finishedAt: dateFromOptional(input.finishedAt, "gradeRun.finishedAt"),
      },
    });

    if (update.count !== 1) {
      throw new AiGraderServiceValidationError("Grade run update failed.", [
        issue("gradeRun", "INVALID_RECORD", "GradeRun update did not match exactly one scoped row."),
      ]);
    }

    return {
      gradeRun,
      updatedCount: update.count,
    };
  });
}

export async function linkEvidenceArtifact(
  db: AiGraderServicePrismaClient,
  artifact: EvidenceArtifactContract
): Promise<LinkedEvidenceArtifact> {
  validateLinkEvidenceArtifactInput(artifact);

  return runInAiGraderTransaction(db, async (tx) => {
    const scopes: LinkedEvidenceArtifact["scopes"] = {};

    if (artifact.captureSessionId) {
      const captureSession = await readCaptureSessionState(tx, {
        tenantId: artifact.tenantId,
        captureSessionId: artifact.captureSessionId,
      });
      if (!captureSession) {
        throw new AiGraderServiceValidationError("Capture session not found for evidence artifact.", [
          issue("evidenceArtifact.captureSessionId", "INVALID_RECORD", "captureSessionId must belong to the artifact tenant."),
        ]);
      }
      scopes.captureSession = captureSession;
    }

    if (artifact.gradeRunId) {
      const gradeRun = await tx.gradeRun.findFirst({
        where: {
          id: artifact.gradeRunId,
          captureSession: { tenantId: artifact.tenantId },
        },
        select: gradeRunStateSelect,
      });
      if (!gradeRun) {
        throw new AiGraderServiceValidationError("Grade run not found for evidence artifact.", [
          issue("evidenceArtifact.gradeRunId", "INVALID_RECORD", "gradeRunId must belong to the artifact tenant."),
        ]);
      }
      scopes.gradeRun = gradeRun;
    }

    if (artifact.authRunId) {
      const authRun = await tx.authRun.findFirst({
        where: {
          id: artifact.authRunId,
          tenantId: artifact.tenantId,
        },
        select: authRunScopeSelect,
      });
      if (!authRun) {
        throw new AiGraderServiceValidationError("Auth run not found for evidence artifact.", [
          issue("evidenceArtifact.authRunId", "INVALID_RECORD", "authRunId must belong to the artifact tenant."),
        ]);
      }
      scopes.authRun = authRun;
    }

    if (artifact.certificateId) {
      const certificate = await tx.gradeCertificate.findFirst({
        where: {
          id: artifact.certificateId,
          tenantId: artifact.tenantId,
        },
        select: gradeCertificateScopeSelect,
      });
      if (!certificate) {
        throw new AiGraderServiceValidationError("Certificate not found for evidence artifact.", [
          issue("evidenceArtifact.certificateId", "INVALID_RECORD", "certificateId must belong to the artifact tenant."),
        ]);
      }
      scopes.certificate = certificate;
    }

    return {
      artifact: await tx.evidenceArtifact.create({ data: evidenceArtifactCreateData(artifact) }),
      scopes,
    };
  });
}

export async function persistOrchestratorTransition(
  db: AiGraderServicePrismaClient,
  input: PersistOrchestratorTransitionInput
): Promise<PersistedOrchestratorTransition> {
  validateOrchestratorTransitionInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for tenant.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession was not found for the supplied tenant and session id."),
      ]);
    }

    const occurredAt = dateFromOptional(input.occurredAt, "orchestrator.occurredAt");
    const transition = transitionOrchestratorState({
      sessionId: input.captureSessionId,
      currentState: session.currentState as OrchestratorState,
      event: input.event,
      guardResults: input.guardResults,
      errorCode: input.errorCode,
      occurredAt: occurredAt.toISOString(),
    });

    if (!transition.accepted) {
      throw new AiGraderServiceValidationError("Invalid orchestrator transition.", [
        issue(
          "orchestrator.transition",
          "INVALID_TRANSFORM",
          `Transition ${input.event} is not valid from ${session.currentState}.`
        ),
      ]);
    }

    const status = statusForOrchestratorState(transition.nextState);
    const errorCode = errorCodeForOrchestratorState(transition.nextState, input);
    const update = await tx.captureSession.updateMany({
      where: {
        id: input.captureSessionId,
        tenantId: input.tenantId,
      },
      data: transitionUpdateData(session, transition.nextState, status, errorCode, occurredAt),
    });

    if (update.count !== 1) {
      throw new AiGraderServiceValidationError("Capture session update failed.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession update did not match exactly one scoped row."),
      ]);
    }

    const auditEvent = await recordAuditEvent(
      tx,
      await buildTransitionAuditInput(
        session,
        input,
        transition.nextState,
        status,
        errorCode,
        occurredAt,
        transition.auditEventId,
        transition.userVisibleMessage
      )
    );

    return {
      session,
      fromState: session.currentState,
      toState: transition.nextState,
      status,
      errorCode,
      transitionAuditEventId: transition.auditEventId,
      auditEvent,
      updatedCount: update.count,
      userVisibleMessage: transition.userVisibleMessage,
    };
  });
}

export async function markCaptureSessionPausedForOperatorTimeout(
  db: AiGraderServicePrismaClient,
  input: CommonCaptureSessionStateUpdateInput
) {
  return persistOrchestratorTransition(db, {
    ...input,
    event: "ERROR",
    errorCode: "PAUSED_OPERATOR_TIMEOUT",
    reasonCode: input.reasonCode ?? "PAUSED_OPERATOR_TIMEOUT",
  });
}

export async function markCaptureSessionMicroIncompleteRequiresReview(
  db: AiGraderServicePrismaClient,
  input: CommonCaptureSessionStateUpdateInput
) {
  return persistOrchestratorTransition(db, {
    ...input,
    event: "ERROR",
    errorCode: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    reasonCode: input.reasonCode ?? "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    guardResults: { operatorDecision: "COMPLETE_WITH_WARNING" },
  });
}

export async function markCaptureSessionPhysicalGateReview(
  db: AiGraderServicePrismaClient,
  input: CommonCaptureSessionStateUpdateInput
) {
  return persistOrchestratorTransition(db, {
    ...input,
    event: "ERROR",
    errorCode: "PHYSICAL_GATE_REVIEW",
    reasonCode: input.reasonCode ?? "PHYSICAL_GATE_REVIEW",
  });
}

export async function markCaptureSessionAborted(
  db: AiGraderServicePrismaClient,
  input: CommonCaptureSessionStateUpdateInput & { reasonCode: string }
) {
  return persistOrchestratorTransition(db, {
    ...input,
    event: "ABORT",
    errorCode: input.reasonCode,
  });
}

export async function markCaptureSessionComplete(
  db: AiGraderServicePrismaClient,
  input: CommonCaptureSessionStateUpdateInput
) {
  return persistOrchestratorTransition(db, {
    ...input,
    event: "OPERATOR_APPROVED",
    guardResults: {
      blockingGates: false,
      overrideReviewedApproved: true,
    },
  });
}

export async function readCaptureSessionState(
  db: AiGraderServicePrismaClient,
  input: ReadCaptureSessionStateInput
): Promise<CaptureSessionState | null> {
  validateReadCaptureSessionStateInput(input);

  return db.captureSession.findFirst({
    where: {
      id: input.captureSessionId,
      tenantId: input.tenantId,
    },
    select: captureSessionStateSelect,
  });
}

export function createAiGraderService(db: AiGraderServicePrismaClient) {
  return {
    createCaptureSessionDraft: (input: CreateCaptureSessionDraftInput) =>
      createCaptureSessionDraft(db, input),
    recordCaptureManifest: (manifest: CaptureManifest) =>
      recordCaptureManifest(db, manifest),
    recordEvidenceArtifact: (artifact: EvidenceArtifactContract) =>
      recordEvidenceArtifact(db, artifact),
    recordAuditEvent: (input: RecordAuditEventInput) => recordAuditEvent(db, input),
    persistMacroSuspectRegions: (input: PersistMacroSuspectRegionsInput) =>
      persistMacroSuspectRegions(db, input),
    recordMacroPipelineCompletion: (input: RecordMacroPipelineCompletionInput) =>
      recordMacroPipelineCompletion(db, input),
    persistMicroSpotPackage: (input: PersistMicroSpotPackageInput) =>
      persistMicroSpotPackage(db, input),
    createGradeRunDraft: (input: CreateGradeRunDraftInput) =>
      createGradeRunDraft(db, input),
    finalizeGradeRun: (input: FinalizeGradeRunInput) =>
      finalizeGradeRun(db, input),
    linkEvidenceArtifact: (artifact: EvidenceArtifactContract) =>
      linkEvidenceArtifact(db, artifact),
    persistOrchestratorTransition: (input: PersistOrchestratorTransitionInput) =>
      persistOrchestratorTransition(db, input),
    markCaptureSessionPausedForOperatorTimeout: (input: CommonCaptureSessionStateUpdateInput) =>
      markCaptureSessionPausedForOperatorTimeout(db, input),
    markCaptureSessionMicroIncompleteRequiresReview: (input: CommonCaptureSessionStateUpdateInput) =>
      markCaptureSessionMicroIncompleteRequiresReview(db, input),
    markCaptureSessionPhysicalGateReview: (input: CommonCaptureSessionStateUpdateInput) =>
      markCaptureSessionPhysicalGateReview(db, input),
    markCaptureSessionAborted: (input: CommonCaptureSessionStateUpdateInput & { reasonCode: string }) =>
      markCaptureSessionAborted(db, input),
    markCaptureSessionComplete: (input: CommonCaptureSessionStateUpdateInput) =>
      markCaptureSessionComplete(db, input),
    readCaptureSessionState: (input: ReadCaptureSessionStateInput) =>
      readCaptureSessionState(db, input),
  };
}
