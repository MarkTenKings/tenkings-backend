import { Prisma } from "@prisma/client";
import type {
  AiGraderValidationIssue,
  AiGraderValidationIssueCode,
  CaptureManifest,
  EvidenceArtifactContract,
  GradingMode,
  OrchestratorState,
} from "@tenkings/shared";
import {
  validateCaptureManifest,
  validateEvidenceArtifactContract,
} from "@tenkings/shared";

type NullableJsonInput = Prisma.InputJsonValue | typeof Prisma.JsonNull;

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

export type AiGraderServicePrismaClient = {
  auditEvent: {
    create(args: { data: AuditEventCreateData }): Promise<unknown>;
  };
  captureManifest: {
    create(args: { data: CaptureManifestCreateData }): Promise<unknown>;
  };
  captureSession: {
    create(args: { data: CaptureSessionDraftCreateData }): Promise<unknown>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: typeof captureSessionStateSelect;
    }): Promise<CaptureSessionState | null>;
  };
  evidenceArtifact: {
    create(args: { data: EvidenceArtifactCreateData }): Promise<unknown>;
  };
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

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

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

function assertValidManifest(manifest: CaptureManifest) {
  const result = validateCaptureManifest(manifest);
  throwIfInvalid("Invalid capture manifest.", result.issues);
}

function assertValidEvidenceArtifact(artifact: EvidenceArtifactContract) {
  const result = validateEvidenceArtifactContract(artifact);
  throwIfInvalid("Invalid evidence artifact.", result.issues);
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
    readCaptureSessionState: (input: ReadCaptureSessionStateInput) =>
      readCaptureSessionState(db, input),
  };
}
