import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  AiGraderValidationIssue,
  AiGraderValidationIssueCode,
  CaptureManifest,
  EvidenceArtifactContract,
  GradingMode,
  OrchestratorEventType,
  OrchestratorGuardResults,
  OrchestratorState,
} from "@tenkings/shared";
import {
  ORCHESTRATOR_NAMED_ERROR_STATES,
  transitionOrchestratorState,
  validateCaptureManifest,
  validateEvidenceArtifactContract,
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

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const NAMED_ERROR_STATES = new Set<OrchestratorState>(ORCHESTRATOR_NAMED_ERROR_STATES);

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

function buildAuditChecksum(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
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

function buildTransitionAuditInput(
  session: CaptureSessionState,
  input: PersistOrchestratorTransitionInput,
  nextState: OrchestratorState,
  status: CaptureSessionPersistedStatus,
  errorCode: string | null,
  occurredAt: Date,
  transitionAuditEventId: string,
  userVisibleMessage?: string
): RecordAuditEventInput {
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
  const checksum = buildAuditChecksum({
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

  const data: EvidenceArtifactCreateData = {
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

  return db.evidenceArtifact.create({ data });
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
      buildTransitionAuditInput(
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
