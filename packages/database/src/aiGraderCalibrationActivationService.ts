import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as signSignature,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import {
  AI_GRADER_CALIBRATION_HOSTED_AUTHORITY_SIGNATURE_ALGORITHM_V1,
  AI_GRADER_CALIBRATION_OBSERVATION_AUTHORITY_V1_SCHEMA_VERSION,
  AI_GRADER_CALIBRATION_PENDING_AUTHORITY_V1_SCHEMA_VERSION,
  AI_GRADER_CALIBRATION_ACTIVATION_AUTHORITY_V1_SCHEMA_VERSION,
  aiGraderCalibrationActivationAuthorityV1Schema,
  aiGraderCalibrationObservationAuthorityV1Schema,
  aiGraderCalibrationPendingAuthorityV1Schema,
  aiGraderCalibrationWorkstationReceiptStatementV1,
  aiGraderCalibrationWorkstationReceiptV1Schema,
  aiGraderCalibrationWorkstationObservationStatementV1,
  aiGraderCalibrationWorkstationObservationV1Schema,
  aiGraderOperatingContextV1Schema,
  canonicalAiGraderCalibrationJsonV1,
  canonicalAiGraderCalibrationHostedAuthorityStatementV1,
  canonicalAiGraderOperatingContextV1,
  canonicalAiGraderRuntimeContextV1,
  type AiGraderCalibrationActivationAuthorityV1,
  type AiGraderCalibrationObservationAuthorityV1,
  type AiGraderCalibrationActivationProjectionV1,
  type AiGraderCalibrationActivationRegistryProjectionV1,
  type AiGraderCalibrationActivationStateV1,
  type AiGraderCalibrationActivateRequestV1,
  type AiGraderCalibrationPendingAuthorityV1,
  type AiGraderCalibrationCompleteActivationRequestV1,
  type AiGraderCalibrationFailActivationRequestV1,
  type AiGraderCalibrationReactivateRequestV1,
  type AiGraderCalibrationSnapshotProjectionV1,
  type AiGraderCalibrationWorkstationReceiptV1,
  type AiGraderCalibrationWorkstationObservationV1,
  type AiGraderOperatingContextV1,
} from "@tenkings/shared";

type JsonRecord = Record<string, unknown>;
type DbClient = Record<string, any>;
type ActivationRequest =
  | (AiGraderCalibrationActivateRequestV1 & { action: "activate" })
  | (AiGraderCalibrationReactivateRequestV1 & { action: "reactivate" });

const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_TTL_MS = 30 * 60 * 1000;
const RECEIPT_CLOCK_SKEW_MS = 30 * 1000;
const DEFAULT_ACTIVE_AUTHORITY_TTL_MS = 2 * 60 * 1000;
const MAX_ACTIVE_AUTHORITY_TTL_MS = 10 * 60 * 1000;

export type AiGraderCalibrationWorkstationPublicKeyV1 = {
  keyId: string;
  tenantId: string;
  publicKey: KeyObject;
};

export type AiGraderCalibrationHostedAuthoritySigningKeyV1 = {
  keyId: string;
  privateKey: KeyObject;
};

export type AiGraderCalibrationActivationServiceOptions = {
  now?: () => Date;
  randomId?: () => string;
  pendingTtlMs?: number;
  acquireRigLock?: (tx: DbClient, rigId: string) => Promise<void>;
  verifySnapshotStorage?: (snapshot: JsonRecord) => Promise<void>;
  workstationPublicKeys?: Map<string, AiGraderCalibrationWorkstationPublicKeyV1>;
  hostedAuthoritySigningKey?: AiGraderCalibrationHostedAuthoritySigningKeyV1;
  activeAuthorityTtlMs?: number;
};

export type AiGraderCalibrationActivationServiceErrorCode =
  | "AI_GRADER_CALIBRATION_ACTIVATION_INVALID_INPUT"
  | "AI_GRADER_CALIBRATION_ACTIVATION_SCHEMA_UNAVAILABLE"
  | "AI_GRADER_CALIBRATION_ACTIVATION_REVISION_CONFLICT"
  | "AI_GRADER_CALIBRATION_ACTIVATION_IDEMPOTENCY_CONFLICT"
  | "AI_GRADER_CALIBRATION_ACTIVATION_SNAPSHOT_NOT_ELIGIBLE"
  | "AI_GRADER_CALIBRATION_ACTIVATION_EXPLICIT_REACTIVATION_REQUIRED"
  | "AI_GRADER_CALIBRATION_ACTIVATION_NOT_FOUND"
  | "AI_GRADER_CALIBRATION_ACTIVATION_PENDING_MISMATCH"
  | "AI_GRADER_CALIBRATION_ACTIVATION_PENDING_EXPIRED"
  | "AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED"
  | "AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY"
  | "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE";

export class AiGraderCalibrationActivationServiceError extends Error {
  readonly code: AiGraderCalibrationActivationServiceErrorCode;
  readonly statusCode: number;
  readonly field?: string;

  constructor(
    code: AiGraderCalibrationActivationServiceErrorCode,
    message: string,
    statusCode = 409,
    field?: string,
  ) {
    super(message);
    this.name = "AiGraderCalibrationActivationServiceError";
    this.code = code;
    this.statusCode = statusCode;
    this.field = field;
  }
}

function failure(
  code: AiGraderCalibrationActivationServiceErrorCode,
  message: string,
  statusCode = 409,
  field?: string,
): never {
  throw new AiGraderCalibrationActivationServiceError(code, message, statusCode, field);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", `${label} is not an object.`, 503);
  }
  return value as JsonRecord;
}

function text(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > maximum) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_INVALID_INPUT", `${field} must be a canonical non-empty string.`, 400, field);
  }
  return value;
}

function exactSha(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_INVALID_INPUT", `${field} must be an exact lowercase SHA-256.`, 400, field);
  }
  return value;
}

function nullableSha(value: unknown): string | null {
  return typeof value === "string" && SHA256.test(value) ? value : null;
}

function date(value: unknown, field: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime())
    : typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(parsed.getTime())) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", `${field} is not a valid timestamp.`, 503);
  }
  return parsed;
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashCanonical(value: unknown): string {
  return hash(canonicalAiGraderCalibrationJsonV1(value));
}

function iso(value: unknown): string {
  return date(value, "timestamp").toISOString();
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function parseContext(snapshot: JsonRecord): AiGraderOperatingContextV1 {
  const parsed = aiGraderOperatingContextV1Schema.safeParse(snapshot.mathematicalOperatingContextV1);
  if (!parsed.success) {
    return failure(
      "AI_GRADER_CALIBRATION_ACTIVATION_SNAPSHOT_NOT_ELIGIBLE",
      "The selected immutable snapshot has no valid canonical operatingContextV1.",
      409,
    );
  }
  const contextHash = hash(canonicalAiGraderOperatingContextV1(parsed.data));
  if (contextHash !== snapshot.mathematicalOperatingContextHash) {
    return failure(
      "AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY",
      "The selected snapshot operating context does not reproduce its immutable hash.",
      503,
    );
  }
  return parsed.data;
}

function snapshotProjection(rowValue: unknown): AiGraderCalibrationSnapshotProjectionV1 {
  const row = record(rowValue, "CalibrationSnapshot");
  const trustStatus = row.trustStatus === "DRAFT" || row.trustStatus === "TRUSTED" || row.trustStatus === "REVOKED"
    ? row.trustStatus : failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Snapshot trust state is invalid.", 503);
  const parsedContext = aiGraderOperatingContextV1Schema.safeParse(row.mathematicalOperatingContextV1);
  const computedOperatingContextHash = parsedContext.success
    ? hash(canonicalAiGraderOperatingContextV1(parsedContext.data)) : null;
  const storedOperatingContextHash = nullableSha(row.mathematicalOperatingContextHash);
  const artifactSha256 = nullableSha(row.mathematicalArtifactSha256);
  const bundleManifestSha256 = nullableSha(row.mathematicalBundleManifestSha256);
  const memberLedgerSha256 = nullableSha(row.mathematicalMemberLedgerSha256);
  const runtimeContextHash = nullableSha(row.mathematicalRuntimeContextHash);
  const rigCharacterizationSha256 = nullableSha(row.mathematicalRigCharacterizationSha256);
  const identityComplete = Boolean(artifactSha256 && bundleManifestSha256 && memberLedgerSha256 &&
    runtimeContextHash && rigCharacterizationSha256 && storedOperatingContextHash);
  const activationIneligibilityCode = trustStatus === "REVOKED" ? "SNAPSHOT_REVOKED"
    : trustStatus !== "TRUSTED" ? "SNAPSHOT_NOT_TRUSTED"
    : !identityComplete ? "IDENTITY_INCOMPLETE"
    : !parsedContext.success ? "OPERATING_CONTEXT_INVALID"
    : computedOperatingContextHash !== storedOperatingContextHash ? "OPERATING_CONTEXT_HASH_MISMATCH"
    : null;
  return {
    snapshotId: text(row.id, "snapshot.id"),
    rigId: text(row.rigId, "snapshot.rigId"),
    trustStatus,
    activationEligible: activationIneligibilityCode === null,
    activationIneligibilityCode,
    profileId: text(row.mathematicalProfileId, "snapshot.mathematicalProfileId"),
    calibrationVersion: text(row.mathematicalCalibrationVersion, "snapshot.mathematicalCalibrationVersion"),
    artifactSha256,
    bundleManifestSha256,
    memberLedgerSha256,
    runtimeContextHash,
    rigCharacterizationSha256,
    operatingContextHash: computedOperatingContextHash === storedOperatingContextHash ? storedOperatingContextHash : null,
    importedAt: iso(row.createdAt),
    trustedAt: nullableIso(row.trustedAt),
    revokedAt: nullableIso(row.revokedAt),
  };
}

function sortedEvents(row: JsonRecord): JsonRecord[] {
  if (!Array.isArray(row.events) || row.events.length < 1) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Activation event chain is empty.", 503);
  }
  const events = row.events.map((entry) => record(entry, "activation event"))
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  let previous: string | null = null;
  events.forEach((event, index) => {
    if (event.sequence !== index + 1 || event.previousEventHash !== previous) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Activation event sequence/hash chain is contradictory.", 503);
    }
    previous = exactSha(event.eventHash, "activation.eventHash");
  });
  return events;
}

function eventState(type: unknown): AiGraderCalibrationActivationStateV1 {
  switch (type) {
    case "PENDING_CREATED": return "PENDING";
    case "LOCAL_VERIFIED": return "LOCAL_VERIFIED";
    case "ACTIVATED": return "ACTIVE";
    case "FAILED": return "FAILED";
    case "EXPIRED": return "EXPIRED";
    case "SUPERSEDED": return "SUPERSEDED";
    case "REVOKED": return "REVOKED";
    default: return failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Activation event type is invalid.", 503);
  }
}

function activationProjection(rowValue: unknown, observedAt: Date): AiGraderCalibrationActivationProjectionV1 {
  const row = record(rowValue, "MathematicalCalibrationActivation");
  const events = sortedEvents(row);
  const latest = events.at(-1)!;
  let state = eventState(latest.eventType);
  if ((state === "PENDING" || state === "LOCAL_VERIFIED") && date(row.pendingExpiresAt, "pendingExpiresAt") <= observedAt) {
    state = "EXPIRED";
  }
  const receiptEvent = [...events].reverse().find((entry) => typeof entry.workstationReceiptSha256 === "string");
  const pendingDetails = record(events[0]!.safeDetails, "pending activation details");
  const localEvent = events.find((entry) => entry.eventType === "LOCAL_VERIFIED");
  const activeEvent = events.find((entry) => entry.eventType === "ACTIVATED");
  const terminalEvent = [...events].reverse().find((entry) =>
    ["FAILED", "EXPIRED", "SUPERSEDED", "REVOKED"].includes(String(entry.eventType)));
  const successor = [...events].reverse().find((entry) => entry.eventType === "SUPERSEDED")?.safeDetails;
  const successorId = successor && typeof successor === "object" && !Array.isArray(successor)
    ? typeof (successor as JsonRecord).supersededByActivationId === "string"
      ? String((successor as JsonRecord).supersededByActivationId) : null
    : null;
  return {
    activationId: text(row.id, "activation.id"),
    activationHash: exactSha(row.activationHash, "activation.activationHash"),
    activationRevision: exactSha(latest.eventHash, "activation.eventHash"),
    state,
    snapshotId: text(row.calibrationSnapshotId, "activation.calibrationSnapshotId"),
    rigId: text(row.rigId, "activation.rigId"),
    bundleManifestSha256: exactSha(row.bundleManifestSha256, "activation.bundleManifestSha256"),
    memberLedgerSha256: exactSha(row.memberLedgerSha256, "activation.memberLedgerSha256"),
    runtimeContextHash: exactSha(row.runtimeContextHash, "activation.runtimeContextHash"),
    rigCharacterizationSha256: exactSha(row.rigCharacterizationSha256, "activation.rigCharacterizationSha256"),
    operatingContextHash: exactSha(row.operatingContextHash, "activation.operatingContextHash"),
    observationId: text(pendingDetails.observationId, "activation.observationId"),
    workstationObservationSha256: exactSha(
      pendingDetails.workstationObservationSha256,
      "activation.workstationObservationSha256",
    ),
    workstationReceiptSha256: receiptEvent ? exactSha(receiptEvent.workstationReceiptSha256, "activation.workstationReceiptSha256") : null,
    requestedAt: iso(row.requestedAt),
    pendingExpiresAt: iso(row.pendingExpiresAt),
    locallyVerifiedAt: localEvent ? iso(localEvent.occurredAt) : null,
    activatedAt: activeEvent ? iso(activeEvent.occurredAt) : null,
    terminatedAt: terminalEvent ? iso(terminalEvent.occurredAt) : null,
    priorActivationId: row.priorActivationId === null ? null : text(row.priorActivationId, "activation.priorActivationId"),
    supersededByActivationId: successorId,
  };
}

function registryRevision(input: {
  rigId: string;
  active: JsonRecord | null;
  pending: JsonRecord | null;
  activations: AiGraderCalibrationActivationProjectionV1[];
}): string {
  return hashCanonical({
    schemaVersion: "ten-kings-ai-grader-calibration-registry-revision-v1",
    rigId: input.rigId,
    active: input.active ? {
      activationId: input.active.activationId,
      activationRevision: input.active.activationRevision,
      workstationReceiptSha256: input.active.workstationReceiptSha256,
    } : null,
    pending: input.pending ? {
      activationId: input.pending.activationId,
      activationRevision: input.pending.activationRevision,
      pendingExpiresAt: iso(input.pending.pendingExpiresAt),
    } : null,
    activations: input.activations.map((entry) => ({
      activationId: entry.activationId,
      activationRevision: entry.activationRevision,
      state: entry.state,
    })),
  });
}

async function loadRegistry(tx: DbClient, rigId: string, now: Date, includeIncomplete = true): Promise<AiGraderCalibrationActivationRegistryProjectionV1> {
  if (!tx.calibrationSnapshot?.findMany || !tx.mathematicalCalibrationActivation?.findMany ||
      !tx.mathematicalCalibrationActivePointer?.findUnique || !tx.mathematicalCalibrationPendingPointer?.findUnique) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_SCHEMA_UNAVAILABLE", "Calibration activation registry schema is unavailable.", 503);
  }
  const [snapshotRows, activationRows, active, pending] = await Promise.all([
    tx.calibrationSnapshot.findMany({
      where: { rigId, calibrationType: "MATHEMATICAL_GRADING_V1" },
      orderBy: [{ createdAt: "desc" }],
    }),
    tx.mathematicalCalibrationActivation.findMany({
      where: { rigId },
      include: { events: { orderBy: { sequence: "asc" } } },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    }),
    tx.mathematicalCalibrationActivePointer.findUnique({ where: { rigId } }),
    tx.mathematicalCalibrationPendingPointer.findUnique({ where: { rigId } }),
  ]);
  let activations = (activationRows as unknown[]).map((row) => activationProjection(row, now));
  if (!includeIncomplete) activations = activations.filter((entry) => entry.state === "ACTIVE" || entry.terminatedAt !== null);
  const activeRecord = active ? record(active, "active pointer") : null;
  const pendingRecord = pending ? record(pending, "pending pointer") : null;
  const revision = registryRevision({ rigId, active: activeRecord, pending: pendingRecord, activations });
  return {
    schemaVersion: "ten-kings-ai-grader-calibration-activation-registry-projection-v1",
    rigId,
    registryRevision: revision,
    activeActivationId: activeRecord ? text(activeRecord.activationId, "activePointer.activationId") : null,
    pendingActivationId: pendingRecord ? text(pendingRecord.activationId, "pendingPointer.activationId") : null,
    snapshots: (snapshotRows as unknown[]).map(snapshotProjection),
    activations,
    observedAt: now.toISOString(),
  };
}

function activationEventHash(input: {
  activationHash: string;
  sequence: number;
  eventType: string;
  previousEventHash: string | null;
  workstationReceiptSha256?: string | null;
  actorUserId?: string | null;
  safeDetails?: JsonRecord | null;
  occurredAt: Date;
}) {
  return hashCanonical({
    schemaVersion: "ten-kings-ai-grader-calibration-activation-event-v1",
    activationHash: input.activationHash,
    sequence: input.sequence,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    workstationReceiptSha256: input.workstationReceiptSha256 ?? null,
    actorUserId: input.actorUserId ?? null,
    safeDetails: input.safeDetails ?? null,
    occurredAt: input.occurredAt.toISOString(),
  });
}

async function appendEvent(tx: DbClient, input: {
  activationId: string;
  activationHash: string;
  sequence: number;
  eventType: string;
  previousEventHash: string | null;
  workstationReceipt?: AiGraderCalibrationWorkstationReceiptV1;
  workstationReceiptSha256?: string;
  actorUserId?: string;
  safeDetails?: JsonRecord;
  occurredAt: Date;
}) {
  const eventHash = activationEventHash(input);
  return tx.mathematicalCalibrationActivationEvent.create({ data: {
    activationId: input.activationId,
    sequence: input.sequence,
    eventType: input.eventType,
    eventHash,
    previousEventHash: input.previousEventHash,
    workstationReceipt: input.workstationReceipt,
    workstationReceiptSha256: input.workstationReceiptSha256,
    actorUserId: input.actorUserId,
    safeDetails: input.safeDetails,
    occurredAt: input.occurredAt,
  } });
}

async function defaultAcquireRigLock(tx: DbClient, rigId: string) {
  if (typeof tx.$queryRawUnsafe !== "function") {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Calibration activation concurrency lock is unavailable.", 503);
  }
  await tx.$queryRawUnsafe(
    "SELECT 1 AS \"lockAcquired\" FROM pg_advisory_xact_lock(hashtext('ai-grader-calibration-activation'), hashtext($1))",
    rigId,
  );
}

function keyEntry(value: unknown): { tenantId: string; algorithm: string; publicSpkiDerBase64: string } {
  const entry = record(value, "workstation public key");
  const fields = Object.keys(entry).sort().join("|");
  if (fields !== ["algorithm", "publicSpkiDerBase64", "tenantId"].sort().join("|")) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Calibration workstation key configuration is invalid.", 503);
  }
  return {
    tenantId: text(entry.tenantId, "workstation tenantId"),
    algorithm: text(entry.algorithm, "workstation algorithm"),
    publicSpkiDerBase64: text(entry.publicSpkiDerBase64, "workstation public key", 4096),
  };
}

export function parseAiGraderCalibrationWorkstationPublicKeysV1(raw: unknown) {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > 128 * 1024) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Calibration workstation key configuration is unavailable.", 503);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Calibration workstation key configuration is invalid.", 503);
  }
  const root = record(parsed, "workstation public keys");
  const result = new Map<string, AiGraderCalibrationWorkstationPublicKeyV1>();
  for (const [keyId, value] of Object.entries(root)) {
    if (!SHA256.test(keyId) || result.has(keyId)) {
      return failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Calibration workstation key configuration is invalid.", 503);
    }
    const entry = keyEntry(value);
    if (entry.algorithm !== "ecdsa-p256-sha256-ieee-p1363" || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.publicSpkiDerBase64)) {
      return failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Calibration workstation key configuration is invalid.", 503);
    }
    const der = Buffer.from(entry.publicSpkiDerBase64, "base64");
    if (hash(der) !== keyId || der.toString("base64") !== entry.publicSpkiDerBase64) {
      return failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Calibration workstation key configuration is invalid.", 503);
    }
    let publicKey: KeyObject;
    try {
      publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
      if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("wrong key");
    } catch {
      return failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Calibration workstation key configuration is invalid.", 503);
    }
    result.set(keyId, { keyId, tenantId: entry.tenantId, publicKey });
  }
  return result;
}

export function parseAiGraderCalibrationHostedAuthoritySigningKeyV1(
  raw: unknown,
): AiGraderCalibrationHostedAuthoritySigningKeyV1 {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > 16 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    return failure(
      "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
      "Hosted calibration authority signing key is unavailable.",
      503,
    );
  }
  const der = Buffer.from(raw, "base64");
  if (der.toString("base64") !== raw) {
    return failure(
      "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
      "Hosted calibration authority signing key is invalid.",
      503,
    );
  }
  try {
    const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ec" ||
        privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new Error("wrong key");
    }
    const publicSpkiDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    return { keyId: hash(publicSpkiDer), privateKey };
  } catch {
    return failure(
      "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
      "Hosted calibration authority signing key is invalid.",
      503,
    );
  }
}

function exactSnapshotForActivation(snapshotValue: unknown, rigId: string) {
  const snapshot = record(snapshotValue, "CalibrationSnapshot");
  if (
    snapshot.rigId !== rigId || snapshot.calibrationType !== "MATHEMATICAL_GRADING_V1" ||
    snapshot.trustStatus !== "TRUSTED" || snapshot.revokedAt !== null || !snapshot.trustedAt
  ) {
    return failure(
      "AI_GRADER_CALIBRATION_ACTIVATION_SNAPSHOT_NOT_ELIGIBLE",
      "Activation requires one exact trusted, non-revoked Mathematical CalibrationSnapshot for this rig.",
      409,
    );
  }
  parseContext(snapshot);
  return snapshot;
}

function authorityFrom(
  activation: AiGraderCalibrationActivationProjectionV1,
  issuedAt: Date,
  activeAuthorityTtlMs: number,
  signingKey: AiGraderCalibrationHostedAuthoritySigningKeyV1 | undefined,
): AiGraderCalibrationActivationAuthorityV1 {
  if (activation.state !== "ACTIVE" || !activation.workstationReceiptSha256 || !activation.activatedAt) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Active activation authority is incomplete.", 503);
  }
  if (!signingKey) {
    return failure(
      "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
      "Hosted calibration authority signing is unavailable.",
      503,
    );
  }
  const unsigned = {
    schemaVersion: AI_GRADER_CALIBRATION_ACTIVATION_AUTHORITY_V1_SCHEMA_VERSION,
    authorityPhase: "ACTIVE" as const,
    activationId: activation.activationId,
    activationHash: activation.activationHash,
    activationRevision: activation.activationRevision,
    snapshotId: activation.snapshotId,
    rigId: activation.rigId,
    bundleManifestSha256: activation.bundleManifestSha256,
    memberLedgerSha256: activation.memberLedgerSha256,
    runtimeContextHash: activation.runtimeContextHash,
    rigCharacterizationSha256: activation.rigCharacterizationSha256,
    operatingContextHash: activation.operatingContextHash,
    observationId: activation.observationId,
    workstationObservationSha256: activation.workstationObservationSha256,
    workstationReceiptSha256: activation.workstationReceiptSha256,
    activatedAt: activation.activatedAt,
    hostedAuthorityKeyId: signingKey.keyId,
    hostedAuthoritySignatureAlgorithm: AI_GRADER_CALIBRATION_HOSTED_AUTHORITY_SIGNATURE_ALGORITHM_V1,
    hostedAuthorityIssuedAt: issuedAt.toISOString(),
    hostedAuthorityExpiresAt: new Date(issuedAt.getTime() + activeAuthorityTtlMs).toISOString(),
  };
  const hostedAuthoritySignature = signSignature(
    "sha256",
    Buffer.from(canonicalAiGraderCalibrationHostedAuthorityStatementV1(unsigned), "utf8"),
    { key: signingKey.privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");
  return aiGraderCalibrationActivationAuthorityV1Schema.parse({
    ...unsigned,
    hostedAuthoritySignature,
  });
}

function pendingAuthorityFrom(
  rootValue: unknown,
  activationRevisionValue: unknown,
  signingKey: AiGraderCalibrationHostedAuthoritySigningKeyV1 | undefined,
): AiGraderCalibrationPendingAuthorityV1 {
  const root = record(rootValue, "pending activation");
  const context = aiGraderOperatingContextV1Schema.safeParse(root.operatingContextV1);
  if (!context.success) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Pending activation operating context is invalid.", 503);
  }
  const operatingContextHash = hash(canonicalAiGraderOperatingContextV1(context.data));
  if (operatingContextHash !== root.operatingContextHash) {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Pending activation operating context hash is contradictory.", 503);
  }
  if (!signingKey) {
    return failure(
      "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
      "Hosted calibration authority signing is unavailable.",
      503,
    );
  }
  const requestedAt = iso(root.requestedAt);
  const pendingExpiresAt = iso(root.pendingExpiresAt);
  const pendingEvent = sortedEvents(root)[0]!;
  if (pendingEvent.eventType !== "PENDING_CREATED") {
    return failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Pending activation event authority is invalid.", 503);
  }
  const pendingDetails = record(pendingEvent.safeDetails, "pending activation details");
  const unsigned = {
    schemaVersion: AI_GRADER_CALIBRATION_PENDING_AUTHORITY_V1_SCHEMA_VERSION,
    authorityPhase: "PENDING" as const,
    activationId: text(root.id, "activation.id"),
    activationHash: exactSha(root.activationHash, "activation.activationHash"),
    activationRevision: exactSha(activationRevisionValue, "activation.activationRevision"),
    snapshotId: text(root.calibrationSnapshotId, "activation.calibrationSnapshotId"),
    rigId: text(root.rigId, "activation.rigId"),
    bundleManifestSha256: exactSha(root.bundleManifestSha256, "activation.bundleManifestSha256"),
    memberLedgerSha256: exactSha(root.memberLedgerSha256, "activation.memberLedgerSha256"),
    runtimeContextHash: exactSha(root.runtimeContextHash, "activation.runtimeContextHash"),
    rigCharacterizationSha256: exactSha(root.rigCharacterizationSha256, "activation.rigCharacterizationSha256"),
    operatingContextHash,
    observationId: text(pendingDetails.observationId, "activation.observationId"),
    workstationObservationSha256: exactSha(
      pendingDetails.workstationObservationSha256,
      "activation.workstationObservationSha256",
    ),
    operatingContextV1: context.data,
    requestedAt,
    pendingExpiresAt,
    hostedAuthorityKeyId: signingKey.keyId,
    hostedAuthoritySignatureAlgorithm: AI_GRADER_CALIBRATION_HOSTED_AUTHORITY_SIGNATURE_ALGORITHM_V1,
    hostedAuthorityIssuedAt: requestedAt,
    hostedAuthorityExpiresAt: pendingExpiresAt,
  };
  const hostedAuthoritySignature = signSignature(
    "sha256",
    Buffer.from(canonicalAiGraderCalibrationHostedAuthorityStatementV1(unsigned), "utf8"),
    { key: signingKey.privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");
  return aiGraderCalibrationPendingAuthorityV1Schema.parse({
    ...unsigned,
    hostedAuthoritySignature,
  });
}

function observationAuthorityFrom(
  snapshotValue: unknown,
  registryRevision: string,
  observationId: string,
  issuedAt: Date,
  ttlMs: number,
  signingKey: AiGraderCalibrationHostedAuthoritySigningKeyV1,
): AiGraderCalibrationObservationAuthorityV1 {
  const snapshot = record(snapshotValue, "observation snapshot");
  const context = parseContext(snapshot);
  const unsigned = {
    schemaVersion: AI_GRADER_CALIBRATION_OBSERVATION_AUTHORITY_V1_SCHEMA_VERSION,
    authorityPhase: "OBSERVATION" as const,
    observationId: text(observationId, "observationId"),
    registryRevision: exactSha(registryRevision, "registryRevision"),
    snapshotId: text(snapshot.id, "snapshot.id"),
    rigId: text(snapshot.rigId, "snapshot.rigId"),
    bundleManifestSha256: exactSha(snapshot.mathematicalBundleManifestSha256, "snapshot.bundleManifestSha256"),
    memberLedgerSha256: exactSha(snapshot.mathematicalMemberLedgerSha256, "snapshot.memberLedgerSha256"),
    runtimeContextHash: exactSha(snapshot.mathematicalRuntimeContextHash, "snapshot.runtimeContextHash"),
    rigCharacterizationSha256: exactSha(
      snapshot.mathematicalRigCharacterizationSha256,
      "snapshot.rigCharacterizationSha256",
    ),
    operatingContextHash: exactSha(snapshot.mathematicalOperatingContextHash, "snapshot.operatingContextHash"),
    operatingContextV1: context,
    hostedAuthorityKeyId: signingKey.keyId,
    hostedAuthoritySignatureAlgorithm: AI_GRADER_CALIBRATION_HOSTED_AUTHORITY_SIGNATURE_ALGORITHM_V1,
    hostedAuthorityIssuedAt: issuedAt.toISOString(),
    hostedAuthorityExpiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
  };
  const hostedAuthoritySignature = signSignature(
    "sha256",
    Buffer.from(canonicalAiGraderCalibrationHostedAuthorityStatementV1(unsigned), "utf8"),
    { key: signingKey.privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");
  return aiGraderCalibrationObservationAuthorityV1Schema.parse({
    ...unsigned,
    hostedAuthoritySignature,
  });
}


export function createAiGraderCalibrationActivationService(
  db: DbClient,
  options: AiGraderCalibrationActivationServiceOptions = {},
) {
  if (!db || typeof db.$transaction !== "function") {
    failure("AI_GRADER_CALIBRATION_ACTIVATION_SCHEMA_UNAVAILABLE", "Calibration activation transaction service is unavailable.", 503);
  }
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? randomUUID;
  const ttlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > MAX_PENDING_TTL_MS) {
    failure("AI_GRADER_CALIBRATION_ACTIVATION_INVALID_INPUT", "pendingTtlMs is outside the safe activation window.", 400);
  }
  const activeAuthorityTtlMs = options.activeAuthorityTtlMs ?? DEFAULT_ACTIVE_AUTHORITY_TTL_MS;
  if (!Number.isSafeInteger(activeAuthorityTtlMs) || activeAuthorityTtlMs < 60_000 ||
      activeAuthorityTtlMs > MAX_ACTIVE_AUTHORITY_TTL_MS) {
    failure(
      "AI_GRADER_CALIBRATION_ACTIVATION_INVALID_INPUT",
      "activeAuthorityTtlMs is outside the safe hosted authority window.",
      400,
    );
  }
  const acquireRigLock = options.acquireRigLock ?? defaultAcquireRigLock;
  const verifySnapshotStorage = options.verifySnapshotStorage ?? (async () => {
    failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Hosted calibration byte verification is unavailable.", 503);
  });
  const workstationKeys = options.workstationPublicKeys ?? new Map();
  const hostedAuthoritySigningKey = options.hostedAuthoritySigningKey;
  if (hostedAuthoritySigningKey) {
    let valid = false;
    try {
      const publicSpkiDer = createPublicKey(hostedAuthoritySigningKey.privateKey).export({
        format: "der",
        type: "spki",
      });
      valid = SHA256.test(hostedAuthoritySigningKey.keyId) &&
        hostedAuthoritySigningKey.privateKey.type === "private" &&
        hostedAuthoritySigningKey.privateKey.asymmetricKeyType === "ec" &&
        hostedAuthoritySigningKey.privateKey.asymmetricKeyDetails?.namedCurve === "prime256v1" &&
        hash(publicSpkiDer) === hostedAuthoritySigningKey.keyId;
    } catch {
      valid = false;
    }
    if (!valid) {
      failure(
        "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
        "Hosted calibration authority signing configuration is invalid.",
        503,
      );
    }
  }
  const requireHostedAuthoritySigningKey = () => {
    if (!hostedAuthoritySigningKey) {
      return failure(
        "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
        "Hosted calibration authority signing is unavailable.",
        503,
      );
    }
    return hostedAuthoritySigningKey;
  };

  const transaction = <T>(callback: (tx: DbClient) => Promise<T>) => db.$transaction(callback);

  async function list(rigIdValue: string, includeIncomplete = true) {
    const rigId = text(rigIdValue, "rigId");
    return loadRegistry(db, rigId, date(now(), "now"), includeIncomplete);
  }

  async function resolveTrustedRegistry() {
    requireHostedAuthoritySigningKey();
    if (!db.calibrationSnapshot?.findMany) {
      return failure(
        "AI_GRADER_CALIBRATION_ACTIVATION_SCHEMA_UNAVAILABLE",
        "Calibration snapshot registry is unavailable.",
        503,
      );
    }
    const trustedRows = await db.calibrationSnapshot.findMany({
      where: {
        calibrationType: "MATHEMATICAL_GRADING_V1",
        trustStatus: "TRUSTED",
        revokedAt: null,
      },
      include: {
        rig: {
          include: {
            tenant: true,
            location: true,
          },
        },
      },
      orderBy: [{ trustedAt: "desc" }, { id: "asc" }],
      take: 2,
    });
    if (!Array.isArray(trustedRows) || trustedRows.length !== 1) {
      return failure(
        "AI_GRADER_CALIBRATION_ACTIVATION_SNAPSHOT_NOT_ELIGIBLE",
        "Hosted activation resolution requires exactly one trusted Mathematical CalibrationSnapshot.",
        409,
      );
    }

    const snapshot = record(trustedRows[0], "resolved CalibrationSnapshot");
    const rigId = text(snapshot.rigId, "snapshot.rigId");
    exactSnapshotForActivation(snapshot, rigId);
    const context = parseContext(snapshot);
    const rig = record(snapshot.rig, "snapshot.rig");
    const tenant = record(rig.tenant, "snapshot.rig.tenant");
    const location = record(rig.location, "snapshot.rig.location");
    const canonicalRigMatches =
      rig.id === rigId &&
      rig.status === "ACTIVE" &&
      rig.label === rigId &&
      rig.tenantId === tenant.id &&
      tenant.slug === tenant.id &&
      rig.locationId === location.id &&
      location.tenantId === tenant.id &&
      location.name === location.id &&
      context.rig.tenantId === tenant.id &&
      context.rig.rigId === rigId &&
      context.rig.rigVersion === rig.rigVersion &&
      context.rig.locationId === location.id;
    if (!canonicalRigMatches) {
      return failure(
        "AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY",
        "The sole trusted snapshot does not match one exact active tenant/location/rig/version authority.",
        503,
      );
    }
    const exactContextBindings =
      snapshot.mathematicalArtifactSha256 === context.calibration.rigCharacterizationSha256 &&
      snapshot.mathematicalRigCharacterizationSha256 === context.calibration.rigCharacterizationSha256 &&
      snapshot.mathematicalBundleManifestSha256 === context.calibration.bundleManifestSha256 &&
      snapshot.mathematicalMemberLedgerSha256 === context.calibration.memberLedgerSha256 &&
      snapshot.mathematicalRuntimeContextHash === hash(canonicalAiGraderRuntimeContextV1(context));
    if (!exactContextBindings) {
      return failure(
        "AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY",
        "The sole trusted snapshot does not reproduce its immutable bundle/runtime/rig hash authority.",
        503,
      );
    }
    const tenantWorkstationKeys = [...workstationKeys.values()]
      .filter((entry) => entry.tenantId === tenant.id);
    if (tenantWorkstationKeys.length !== 1) {
      return failure(
        "AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE",
        "Hosted activation resolution requires one canonical workstation public identity for the exact tenant.",
        503,
      );
    }

    await verifySnapshotStorage(snapshot);
    const registry = await loadRegistry(db, rigId, date(now(), "now"), true);
    const exactTrustedSnapshots = registry.snapshots.filter((entry) =>
      entry.trustStatus === "TRUSTED" && entry.activationEligible);
    if (
      exactTrustedSnapshots.length !== 1 ||
      exactTrustedSnapshots[0]?.snapshotId !== snapshot.id ||
      registry.pendingActivationId !== null ||
      registry.activeActivationId !== null ||
      registry.activations.length !== 0
    ) {
      return failure(
        "AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY",
        "Hosted activation resolution found ambiguous snapshot or competing activation authority.",
        409,
      );
    }
    return {
      registry,
      status: {
        ok: true,
        registryRevision: registry.registryRevision,
        active: null,
        pending: null,
        authority: null,
        observedAt: registry.observedAt,
      },
    };
  }

  async function status(rigIdValue: string) {
    const registry = await list(rigIdValue, true);
    const active = registry.activeActivationId
      ? registry.activations.find((entry) => entry.activationId === registry.activeActivationId) ?? null : null;
    const pending = registry.pendingActivationId
      ? registry.activations.find((entry) => entry.activationId === registry.pendingActivationId) ?? null : null;
    if (registry.activeActivationId && (!active || active.state !== "ACTIVE")) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Hosted active pointer is contradictory.", 503);
    }
    return {
      registryRevision: registry.registryRevision,
      active,
      pending,
      authority: active
        ? authorityFrom(active, date(now(), "now"), activeAuthorityTtlMs, requireHostedAuthoritySigningKey())
        : null,
      observedAt: registry.observedAt,
    };
  }

  async function requestObservationAuthority(input: {
    rigId: string;
    snapshotId: string;
    expectedRegistryRevision: string;
  }) {
    const signingKey = requireHostedAuthoritySigningKey();
    const rigId = text(input.rigId, "rigId");
    const snapshotId = text(input.snapshotId, "snapshotId");
    const expectedRegistryRevision = exactSha(input.expectedRegistryRevision, "expectedRegistryRevision");
    const at = date(now(), "now");
    const registry = await loadRegistry(db, rigId, at, true);
    if (registry.registryRevision !== expectedRegistryRevision) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_REVISION_CONFLICT", "Calibration registry changed before runtime observation.", 409);
    }
    if (registry.pendingActivationId !== null) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Runtime observation is blocked by an existing pending activation.", 409);
    }
    const selected = registry.snapshots.filter((entry) =>
      entry.snapshotId === snapshotId && entry.trustStatus === "TRUSTED" && entry.activationEligible);
    if (selected.length !== 1) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_SNAPSHOT_NOT_ELIGIBLE", "Runtime observation requires one exact trusted snapshot.", 409);
    }
    const snapshotRow = await db.calibrationSnapshot.findFirst({ where: { id: snapshotId, rigId } });
    if (!snapshotRow) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_SNAPSHOT_NOT_ELIGIBLE", "Runtime observation snapshot was not found.", 404);
    }
    const snapshot = exactSnapshotForActivation(snapshotRow, rigId);
    await verifySnapshotStorage(snapshot);
    return {
      observationAuthority: observationAuthorityFrom(
        snapshot,
        registry.registryRevision,
        `calibration-observation-${randomId()}`,
        at,
        ttlMs,
        signingKey,
      ),
    };
  }

  function verifyObservationForActivation(
    authorityValue: unknown,
    observationValue: unknown,
    snapshot: JsonRecord,
    expectedRegistryRevision: string,
    at: Date,
  ) {
    const authorityParsed = aiGraderCalibrationObservationAuthorityV1Schema.safeParse(authorityValue);
    const observationParsed = aiGraderCalibrationWorkstationObservationV1Schema.safeParse(observationValue);
    if (!authorityParsed.success || !observationParsed.success) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED", "Runtime observation authority/evidence contract is invalid.", 400);
    }
    const authority = authorityParsed.data;
    const observation = observationParsed.data;
    const signingKey = requireHostedAuthoritySigningKey();
    let hostedSignatureValid = false;
    try {
      hostedSignatureValid = authority.hostedAuthorityKeyId === signingKey.keyId && verifySignature(
        "sha256",
        Buffer.from(canonicalAiGraderCalibrationHostedAuthorityStatementV1(authority), "utf8"),
        { key: createPublicKey(signingKey.privateKey), dsaEncoding: "ieee-p1363" },
        Buffer.from(authority.hostedAuthoritySignature, "base64url"),
      );
    } catch { hostedSignatureValid = false; }
    const issuedAt = date(authority.hostedAuthorityIssuedAt, "observationAuthority.issuedAt");
    const expiresAt = date(authority.hostedAuthorityExpiresAt, "observationAuthority.expiresAt");
    const observedAt = date(observation.observedAt, "workstationObservation.observedAt");
    const authoritySha256 = hashCanonical(authority);
    const runtimeObservationSha256 = hashCanonical(observation.runtimeObservation);
    if (
      !hostedSignatureValid ||
      authority.registryRevision !== expectedRegistryRevision ||
      authority.snapshotId !== snapshot.id ||
      authority.rigId !== snapshot.rigId ||
      authority.bundleManifestSha256 !== snapshot.mathematicalBundleManifestSha256 ||
      authority.memberLedgerSha256 !== snapshot.mathematicalMemberLedgerSha256 ||
      authority.runtimeContextHash !== snapshot.mathematicalRuntimeContextHash ||
      authority.rigCharacterizationSha256 !== snapshot.mathematicalRigCharacterizationSha256 ||
      authority.operatingContextHash !== snapshot.mathematicalOperatingContextHash ||
      hash(canonicalAiGraderOperatingContextV1(authority.operatingContextV1)) !== authority.operatingContextHash ||
      observation.observationId !== authority.observationId ||
      observation.hostedObservationAuthoritySha256 !== authoritySha256 ||
      observation.registryRevision !== authority.registryRevision ||
      observation.snapshotId !== authority.snapshotId ||
      observation.rigId !== authority.rigId ||
      observation.bundleManifestSha256 !== authority.bundleManifestSha256 ||
      observation.memberLedgerSha256 !== authority.memberLedgerSha256 ||
      observation.runtimeContextHash !== authority.runtimeContextHash ||
      observation.rigCharacterizationSha256 !== authority.rigCharacterizationSha256 ||
      observation.expectedOperatingContextHash !== authority.operatingContextHash ||
      observation.observedOperatingContextHash !== authority.operatingContextHash ||
      observation.runtimeObservationSha256 !== runtimeObservationSha256 ||
      observation.runtimeObservation.camera.serial !== authority.operatingContextV1.camera.serial ||
      observation.runtimeObservation.camera.model !== authority.operatingContextV1.camera.model ||
      canonicalAiGraderCalibrationJsonV1(observation.runtimeObservation.capture) !==
        canonicalAiGraderCalibrationJsonV1(authority.operatingContextV1.capture) ||
      observation.runtimeObservation.software.helperInstanceId !==
        authority.operatingContextV1.software.helperInstanceId ||
      observation.runtimeObservation.software.helperVersion !==
        authority.operatingContextV1.software.helperVersion ||
      observedAt.getTime() < issuedAt.getTime() - RECEIPT_CLOCK_SKEW_MS ||
      observedAt.getTime() > expiresAt.getTime() ||
      observedAt.getTime() > at.getTime() + RECEIPT_CLOCK_SKEW_MS ||
      at.getTime() > expiresAt.getTime()
    ) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED", "Runtime observation does not match the exact signed snapshot authority.", 409);
    }
    const key = workstationKeys.get(observation.workstationKeyId);
    const snapshotRig = record(snapshot.rig, "snapshot.rig");
    const tenantId = text(record(snapshotRig.tenant, "snapshot.rig.tenant").id, "snapshot.rig.tenant.id");
    let workstationSignatureValid = false;
    try {
      workstationSignatureValid = Boolean(key && key.tenantId === tenantId) && verifySignature(
        "sha256",
        Buffer.from(aiGraderCalibrationWorkstationObservationStatementV1(observation), "utf8"),
        { key: key!.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(observation.signature, "base64url"),
      );
    } catch { workstationSignatureValid = false; }
    if (!workstationSignatureValid) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED", "Runtime observation workstation signature was rejected.", 403);
    }
    return {
      authority,
      observation,
      workstationObservationSha256: hashCanonical(observation),
    };
  }

  async function requestActivation(input: ActivationRequest, actorUserIdValue: string) {
    requireHostedAuthoritySigningKey();
    const rigId = text(input.rigId, "rigId");
    const snapshotId = text(input.snapshotId, "snapshotId");
    const expectedRegistryRevision = exactSha(input.expectedRegistryRevision, "expectedRegistryRevision");
    const actorUserId = text(actorUserIdValue, "actorUserId");
    const idempotencyKey = text(input.idempotencyKey, "idempotencyKey", 256);
    const reason = text(input.reason, "reason", 1024);
    const kind = input.action;
    const priorActivationId = kind === "reactivate" ? text(input.priorActivationId, "priorActivationId") : null;
    const idempotencyHash = hash(idempotencyKey);
    const parsedObservation = aiGraderCalibrationWorkstationObservationV1Schema.safeParse(input.workstationObservation);
    if (!parsedObservation.success) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED", "Runtime observation evidence is invalid.", 400);
    }
    const workstationObservationSha256 = hashCanonical(parsedObservation.data);
    const requestHash = hashCanonical({
      schemaVersion: "ten-kings-ai-grader-calibration-activation-request-v1",
      kind,
      rigId,
      snapshotId,
      priorActivationId,
      reason,
      workstationObservationSha256,
    });
    return transaction(async (tx) => {
      await acquireRigLock(tx, rigId);
      const existing = await tx.mathematicalCalibrationActivation.findFirst({
        where: { rigId, requestIdempotencyKeyHash: idempotencyHash },
        include: { events: { orderBy: { sequence: "asc" } } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          failure("AI_GRADER_CALIBRATION_ACTIVATION_IDEMPOTENCY_CONFLICT", "The idempotency key was already used for different activation content.", 409);
        }
        const registry = await loadRegistry(tx, rigId, date(now(), "now"), true);
        const activation = registry.activations.find((entry) => entry.activationId === existing.id);
        if (!activation) failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Idempotent activation cannot be projected.", 503);
        return {
          registryRevision: registry.registryRevision,
          activation,
          pendingAuthority: activation.state === "PENDING"
            ? pendingAuthorityFrom(existing, activation.activationRevision, hostedAuthoritySigningKey)
            : null,
        };
      }
      const at = date(now(), "now");
      const before = await loadRegistry(tx, rigId, at, true);
      if (before.registryRevision !== expectedRegistryRevision) {
        failure("AI_GRADER_CALIBRATION_ACTIVATION_REVISION_CONFLICT", "Calibration registry changed; refresh before selecting an exact profile.", 409);
      }
      const snapshotRow = await tx.calibrationSnapshot.findFirst({
        where: { id: snapshotId, rigId },
        include: { rig: { include: { tenant: true } } },
      });
      if (!snapshotRow) failure("AI_GRADER_CALIBRATION_ACTIVATION_SNAPSHOT_NOT_ELIGIBLE", "The exact selected snapshot was not found for this rig.", 404);
      const snapshot = exactSnapshotForActivation(snapshotRow, rigId);
      await verifySnapshotStorage(snapshot);
      const context = parseContext(snapshot);
      const observation = verifyObservationForActivation(
        input.observationAuthority,
        input.workstationObservation,
        snapshot,
        expectedRegistryRevision,
        at,
      );
      if (observation.workstationObservationSha256 !== workstationObservationSha256) {
        failure("AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED", "Runtime observation evidence hash changed during verification.", 409);
      }
      const prior = priorActivationId
        ? await tx.mathematicalCalibrationActivation.findFirst({
            where: { id: priorActivationId, rigId, calibrationSnapshotId: snapshotId },
            include: { events: { orderBy: { sequence: "asc" } } },
          }) : null;
      const priorWasActive = prior
        ? sortedEvents(record(prior, "prior activation")).some((entry) => entry.eventType === "ACTIVATED")
        : false;
      const historical = await tx.mathematicalCalibrationActivation.findMany({
        where: { rigId, calibrationSnapshotId: snapshotId },
        include: { events: { orderBy: { sequence: "asc" } } },
      });
      const anyHistoricalActivationWasActive = historical.some((row: unknown) =>
        sortedEvents(record(row, "historical activation")).some((entry) => entry.eventType === "ACTIVATED"));
      if (kind === "activate" && anyHistoricalActivationWasActive) {
        failure("AI_GRADER_CALIBRATION_ACTIVATION_EXPLICIT_REACTIVATION_REQUIRED", "A previously activated snapshot requires the explicit Reactivate action.", 409);
      }
      if (kind === "reactivate" && !priorWasActive) {
        failure("AI_GRADER_CALIBRATION_ACTIVATION_EXPLICIT_REACTIVATION_REQUIRED", "Reactivate requires the exact prior active activation for this preserved snapshot.", 409);
      }
      const activationId = text(randomId(), "activationId");
      const expiresAt = new Date(at.getTime() + ttlMs);
      const activationIdentity = {
        schemaVersion: "ten-kings-ai-grader-calibration-activation-v1",
        activationId,
        rigId,
        snapshotId,
        operatingContextHash: snapshot.mathematicalOperatingContextHash,
        runtimeContextHash: snapshot.mathematicalRuntimeContextHash,
        rigCharacterizationSha256: snapshot.mathematicalRigCharacterizationSha256,
        bundleManifestSha256: snapshot.mathematicalBundleManifestSha256,
        memberLedgerSha256: snapshot.mathematicalMemberLedgerSha256,
        requestedByUserId: actorUserId,
        requestKind: kind,
        requestReason: reason,
        requestedAt: at.toISOString(),
        pendingExpiresAt: expiresAt.toISOString(),
        priorActivationId,
        observationId: observation.authority.observationId,
        workstationObservationSha256,
      };
      const activationHash = hashCanonical(activationIdentity);
      const activePointer = await tx.mathematicalCalibrationActivePointer.findUnique({ where: { rigId } });
      const pendingPointer = await tx.mathematicalCalibrationPendingPointer.findUnique({ where: { rigId } });
      for (const pointer of [activePointer, pendingPointer]) {
        if (!pointer) continue;
        const old = await tx.mathematicalCalibrationActivation.findFirst({
          where: { id: pointer.activationId, rigId },
          include: { events: { orderBy: { sequence: "asc" } } },
        });
        if (!old) failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Existing activation pointer has no immutable activation.", 503);
        const oldEvents = sortedEvents(record(old, "existing activation"));
        const oldLatest = oldEvents.at(-1)!;
        await appendEvent(tx, {
          activationId: old.id,
          activationHash: old.activationHash,
          sequence: oldEvents.length + 1,
          eventType: pointer === activePointer ? "SUPERSEDED" : "FAILED",
          previousEventHash: String(oldLatest.eventHash),
          actorUserId,
          safeDetails: pointer === activePointer
            ? { reasonCode: "explicit_new_activation_selected", supersededByActivationId: activationId }
            : { reasonCode: "replaced_by_explicit_new_activation", supersededByActivationId: activationId },
          occurredAt: at,
        });
      }
      if (pendingPointer) await tx.mathematicalCalibrationPendingPointer.delete({ where: { rigId } });
      if (activePointer) await tx.mathematicalCalibrationActivePointer.delete({ where: { rigId } });
      const createdActivation = await tx.mathematicalCalibrationActivation.create({ data: {
        id: activationId,
        rigId,
        calibrationSnapshotId: snapshotId,
        activationHash,
        operatingContextV1: context,
        operatingContextHash: snapshot.mathematicalOperatingContextHash,
        runtimeContextHash: snapshot.mathematicalRuntimeContextHash,
        rigCharacterizationSha256: snapshot.mathematicalRigCharacterizationSha256,
        bundleManifestSha256: snapshot.mathematicalBundleManifestSha256,
        memberLedgerSha256: snapshot.mathematicalMemberLedgerSha256,
        requestedByUserId: actorUserId,
        requestKind: kind,
        requestReason: reason,
        requestIdempotencyKeyHash: idempotencyHash,
        requestHash,
        requestedAt: at,
        pendingExpiresAt: expiresAt,
        priorActivationId,
      } });
      const pendingEvent = await appendEvent(tx, {
        activationId,
        activationHash,
        sequence: 1,
        eventType: "PENDING_CREATED",
        previousEventHash: null,
        actorUserId,
        safeDetails: {
          requestKind: kind,
          observationId: observation.authority.observationId,
          workstationObservationSha256,
          runtimeObservationSha256: observation.observation.runtimeObservationSha256,
          evidenceImageSha256: observation.observation.evidenceImageSha256,
        },
        occurredAt: at,
      });
      await tx.mathematicalCalibrationPendingPointer.create({ data: {
        rigId,
        activationId,
        activationHash,
        activationRevision: pendingEvent.eventHash,
        pendingExpiresAt: expiresAt,
        createdAt: at,
      } });
      const registry = await loadRegistry(tx, rigId, at, true);
      const activation = registry.activations.find((entry) => entry.activationId === activationId);
      if (!activation || activation.state !== "PENDING") {
        failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Pending activation could not be projected exactly.", 503);
      }
      return {
        registryRevision: registry.registryRevision,
        activation,
        pendingAuthority: pendingAuthorityFrom(
          { ...createdActivation, events: [pendingEvent] },
          pendingEvent.eventHash,
          hostedAuthoritySigningKey,
        ),
      };
    });
  }

  function verifyReceipt(
    receipt: AiGraderCalibrationWorkstationReceiptV1,
    root: JsonRecord,
    pending: JsonRecord,
    snapshot: JsonRecord,
    at: Date,
  ) {
    const receiptSha256 = hashCanonical(receipt);
    const pendingDetails = record(sortedEvents(root)[0]!.safeDetails, "pending activation details");
    if (
      receipt.activationId !== root.id || receipt.activationHash !== root.activationHash ||
      receipt.activationRevision !== pending.activationRevision || receipt.snapshotId !== root.calibrationSnapshotId ||
      receipt.rigId !== root.rigId || receipt.bundleManifestSha256 !== root.bundleManifestSha256 ||
      receipt.memberLedgerSha256 !== root.memberLedgerSha256 || receipt.runtimeContextHash !== root.runtimeContextHash ||
      receipt.rigCharacterizationSha256 !== root.rigCharacterizationSha256 ||
      receipt.expectedOperatingContextHash !== root.operatingContextHash ||
      receipt.observedOperatingContextHash !== root.operatingContextHash ||
      receipt.observationId !== pendingDetails.observationId ||
      receipt.workstationObservationSha256 !== pendingDetails.workstationObservationSha256 ||
      receipt.runtimeObservationSha256 !== pendingDetails.runtimeObservationSha256 ||
      receipt.evidenceImageSha256 !== pendingDetails.evidenceImageSha256
    ) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED", "Workstation receipt does not match the exact pending activation, bundle, and live operating context.", 409);
    }
    const verifiedAt = date(receipt.verifiedAt, "receipt.verifiedAt");
    const expiresAt = date(receipt.expiresAt, "receipt.expiresAt");
    const requestedAt = date(root.requestedAt, "activation.requestedAt");
    const pendingExpiresAt = date(root.pendingExpiresAt, "activation.pendingExpiresAt");
    if (
      verifiedAt.getTime() < requestedAt.getTime() - RECEIPT_CLOCK_SKEW_MS ||
      verifiedAt.getTime() > pendingExpiresAt.getTime() + RECEIPT_CLOCK_SKEW_MS ||
      expiresAt.getTime() !== pendingExpiresAt.getTime() ||
      at.getTime() > pendingExpiresAt.getTime()
    ) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_PENDING_EXPIRED", "Workstation receipt is outside the exact pending activation window.", 409);
    }
    const key = workstationKeys.get(receipt.workstationKeyId);
    const tenantId = text(record(record(snapshot.rig, "snapshot.rig").tenant, "snapshot.rig.tenant").id, "snapshot.rig.tenant.id");
    if (!key || key.tenantId !== tenantId) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED", "Workstation receipt signer is not allowlisted for this tenant.", 403);
    }
    let valid = false;
    try {
      valid = verifySignature(
        "sha256",
        Buffer.from(aiGraderCalibrationWorkstationReceiptStatementV1(receipt), "utf8"),
        { key: key.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(receipt.signature, "base64url"),
      );
    } catch { valid = false; }
    if (!valid) failure("AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED", "Workstation receipt signature was rejected.", 403);
    return receiptSha256;
  }

  async function completeActivation(input: AiGraderCalibrationCompleteActivationRequestV1, actorUserIdValue: string) {
    requireHostedAuthoritySigningKey();
    const activationId = text(input.activationId, "activationId");
    const expectedRevision = exactSha(input.expectedActivationRevision, "expectedActivationRevision");
    const actorUserId = text(actorUserIdValue, "actorUserId");
    const completionIdempotencyHash = hash(text(input.idempotencyKey, "idempotencyKey", 256));
    const parsedReceipt = aiGraderCalibrationWorkstationReceiptV1Schema.safeParse(input.workstationReceipt);
    if (!parsedReceipt.success) failure("AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED", "Workstation receipt contract is invalid.", 400);
    const receipt = parsedReceipt.data;
    const receiptSha256 = hashCanonical(receipt);
    const completionRequestHash = hashCanonical({
      schemaVersion: "ten-kings-ai-grader-calibration-completion-request-v1",
      activationId,
      expectedRevision,
      receiptSha256,
    });
    return transaction(async (tx) => {
      const unlockedRootRow = await tx.mathematicalCalibrationActivation.findFirst({ where: { id: activationId } });
      if (!unlockedRootRow) failure("AI_GRADER_CALIBRATION_ACTIVATION_NOT_FOUND", "Exact activation was not found.", 404);
      const rigId = text(unlockedRootRow.rigId, "activation.rigId");
      await acquireRigLock(tx, rigId);
      const lockedRootRow = await tx.mathematicalCalibrationActivation.findFirst({
        where: { id: activationId, rigId },
        include: { events: { orderBy: { sequence: "asc" } } },
      });
      if (!lockedRootRow) failure("AI_GRADER_CALIBRATION_ACTIVATION_NOT_FOUND", "Exact activation was not found after locking its rig.", 404);
      const root = record(lockedRootRow, "activation");
      const events = sortedEvents(root);
      const activeEvent = events.find((event) => event.eventType === "ACTIVATED");
      if (activeEvent) {
        const details = record(activeEvent.safeDetails, "activation completion details");
        if (details.completionIdempotencyKeyHash !== completionIdempotencyHash || details.completionRequestHash !== completionRequestHash) {
          failure("AI_GRADER_CALIBRATION_ACTIVATION_IDEMPOTENCY_CONFLICT", "Activation completion idempotency key was already used for different content.", 409);
        }
        const registry = await loadRegistry(tx, rigId, date(now(), "now"), true);
        const activation = registry.activations.find((entry) => entry.activationId === activationId);
        if (!activation || activation.state !== "ACTIVE") failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Completed activation is not the exact active projection.", 503);
        return {
          registryRevision: registry.registryRevision,
          activation,
          authority: authorityFrom(
            activation,
            date(now(), "now"),
            activeAuthorityTtlMs,
            hostedAuthoritySigningKey,
          ),
        };
      }
      const at = date(now(), "now");
      const pendingRow = await tx.mathematicalCalibrationPendingPointer.findUnique({ where: { rigId } });
      if (!pendingRow || pendingRow.activationId !== activationId || pendingRow.activationRevision !== expectedRevision) {
        failure("AI_GRADER_CALIBRATION_ACTIVATION_PENDING_MISMATCH", "The exact pending activation/revision is no longer current.", 409);
      }
      if (date(pendingRow.pendingExpiresAt, "pending.pendingExpiresAt") <= at) {
        failure("AI_GRADER_CALIBRATION_ACTIVATION_PENDING_EXPIRED", "The pending activation expired and cannot activate.", 409);
      }
      const snapshotRow = await tx.calibrationSnapshot.findFirst({
        where: { id: root.calibrationSnapshotId, rigId },
        include: { rig: { include: { tenant: true } } },
      });
      if (!snapshotRow) failure("AI_GRADER_CALIBRATION_ACTIVATION_SNAPSHOT_NOT_ELIGIBLE", "The pending activation snapshot no longer exists.", 409);
      const snapshot = exactSnapshotForActivation(snapshotRow, rigId);
      await verifySnapshotStorage(snapshot);
      const verifiedReceiptSha256 = verifyReceipt(receipt, root, record(pendingRow, "pending pointer"), snapshot, at);
      if (verifiedReceiptSha256 !== receiptSha256) failure("AI_GRADER_CALIBRATION_ACTIVATION_RECEIPT_REJECTED", "Workstation receipt hash changed during verification.", 409);
      const previous = events.at(-1)!;
      const localEvent = await appendEvent(tx, {
        activationId,
        activationHash: String(root.activationHash),
        sequence: events.length + 1,
        eventType: "LOCAL_VERIFIED",
        previousEventHash: String(previous.eventHash),
        workstationReceipt: receipt,
        workstationReceiptSha256: receiptSha256,
        actorUserId,
        safeDetails: { helperInstanceId: receipt.helperInstanceId, helperVersion: receipt.helperVersion },
        occurredAt: at,
      });
      const activatedEvent = await appendEvent(tx, {
        activationId,
        activationHash: String(root.activationHash),
        sequence: events.length + 2,
        eventType: "ACTIVATED",
        previousEventHash: String(localEvent.eventHash),
        workstationReceipt: receipt,
        workstationReceiptSha256: receiptSha256,
        actorUserId,
        safeDetails: { completionIdempotencyKeyHash: completionIdempotencyHash, completionRequestHash },
        occurredAt: at,
      });
      await tx.mathematicalCalibrationPendingPointer.delete({ where: { rigId } });
      await tx.mathematicalCalibrationActivePointer.create({ data: {
        rigId,
        activationId,
        activationHash: root.activationHash,
        activationRevision: activatedEvent.eventHash,
        operatingContextHash: root.operatingContextHash,
        workstationReceiptSha256: receiptSha256,
        activatedAt: at,
        createdAt: at,
      } });
      const registry = await loadRegistry(tx, rigId, at, true);
      const activation = registry.activations.find((entry) => entry.activationId === activationId);
      if (!activation || activation.state !== "ACTIVE") failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Activation did not become exact hosted ACTIVE authority.", 503);
      return {
        registryRevision: registry.registryRevision,
        activation,
        authority: authorityFrom(
          activation,
          at,
          activeAuthorityTtlMs,
          hostedAuthoritySigningKey,
        ),
      };
    });
  }

  async function failActivation(input: AiGraderCalibrationFailActivationRequestV1, actorUserIdValue: string) {
    const activationId = text(input.activationId, "activationId");
    const expectedRevision = exactSha(input.expectedActivationRevision, "expectedActivationRevision");
    const actorUserId = text(actorUserIdValue, "actorUserId");
    const failureCode = text(input.failureCode, "failureCode", 128);
    const idempotencyHash = hash(text(input.idempotencyKey, "idempotencyKey", 256));
    return transaction(async (tx) => {
      const rootRow = await tx.mathematicalCalibrationActivation.findFirst({ where: { id: activationId }, include: { events: { orderBy: { sequence: "asc" } } } });
      if (!rootRow) failure("AI_GRADER_CALIBRATION_ACTIVATION_NOT_FOUND", "Exact activation was not found.", 404);
      const root = record(rootRow, "activation");
      const rigId = text(root.rigId, "activation.rigId");
      await acquireRigLock(tx, rigId);
      const events = sortedEvents(root);
      const existingFailure = events.find((entry) => entry.eventType === "FAILED");
      if (existingFailure) {
        const details = record(existingFailure.safeDetails, "failed activation details");
        if (details.idempotencyHash !== idempotencyHash || details.failureCode !== failureCode) {
          failure("AI_GRADER_CALIBRATION_ACTIVATION_IDEMPOTENCY_CONFLICT", "Failure idempotency key was already used for different content.", 409);
        }
      } else {
        const pending = await tx.mathematicalCalibrationPendingPointer.findUnique({ where: { rigId } });
        if (!pending || pending.activationId !== activationId || pending.activationRevision !== expectedRevision) {
          failure("AI_GRADER_CALIBRATION_ACTIVATION_PENDING_MISMATCH", "The exact pending activation/revision is no longer current.", 409);
        }
        await appendEvent(tx, {
          activationId,
          activationHash: String(root.activationHash),
          sequence: events.length + 1,
          eventType: "FAILED",
          previousEventHash: String(events.at(-1)!.eventHash),
          actorUserId,
          safeDetails: { failureCode, idempotencyHash },
          occurredAt: date(now(), "now"),
        });
        await tx.mathematicalCalibrationPendingPointer.delete({ where: { rigId } });
      }
      const registry = await loadRegistry(tx, rigId, date(now(), "now"), true);
      const activation = registry.activations.find((entry) => entry.activationId === activationId);
      if (!activation) failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Failed activation cannot be projected.", 503);
      return { registryRevision: registry.registryRevision, activation };
    });
  }

  async function recordSnapshotRevoked(
    snapshotIdValue: string,
    actorUserIdValue: string,
    reasonValue: string,
  ) {
    const snapshotId = text(snapshotIdValue, "snapshotId");
    const actorUserId = text(actorUserIdValue, "actorUserId");
    const reason = text(reasonValue, "reason", 1024);
    return transaction(async (tx) => {
      const snapshotRow = await tx.calibrationSnapshot.findFirst({ where: { id: snapshotId } });
      if (!snapshotRow) {
        failure("AI_GRADER_CALIBRATION_ACTIVATION_SNAPSHOT_NOT_ELIGIBLE", "Revoked calibration snapshot was not found.", 404);
      }
      const snapshot = record(snapshotRow, "revoked snapshot");
      const rigId = text(snapshot.rigId, "snapshot.rigId");
      await acquireRigLock(tx, rigId);
      const roots = await tx.mathematicalCalibrationActivation.findMany({
        where: { rigId, calibrationSnapshotId: snapshotId },
        include: { events: { orderBy: { sequence: "asc" } } },
      });
      const activationIds = new Set<string>();
      let recorded = 0;
      for (const rootValue of roots as unknown[]) {
        const root = record(rootValue, "revoked activation");
        const activationId = text(root.id, "activation.id");
        activationIds.add(activationId);
        const events = sortedEvents(root);
        if (events.some((event) => event.eventType === "REVOKED")) continue;
        await appendEvent(tx, {
          activationId,
          activationHash: exactSha(root.activationHash, "activation.activationHash"),
          sequence: events.length + 1,
          eventType: "REVOKED",
          previousEventHash: exactSha(events.at(-1)!.eventHash, "activation.eventHash"),
          actorUserId,
          safeDetails: { reason },
          occurredAt: date(now(), "now"),
        });
        recorded += 1;
      }
      const active = await tx.mathematicalCalibrationActivePointer.findUnique({ where: { rigId } });
      const pending = await tx.mathematicalCalibrationPendingPointer.findUnique({ where: { rigId } });
      if (active && activationIds.has(String(active.activationId))) {
        await tx.mathematicalCalibrationActivePointer.delete({ where: { rigId } });
      }
      if (pending && activationIds.has(String(pending.activationId))) {
        await tx.mathematicalCalibrationPendingPointer.delete({ where: { rigId } });
      }
      return { snapshotId, rigId, revokedActivationEventsRecorded: recorded };
    });
  }

  async function readStartAuthority(tenantIdValue: string, rigIdValue: string) {
    const tenantId = text(tenantIdValue, "tenantId");
    const rigId = text(rigIdValue, "rigId");
    const at = date(now(), "now");
    const registry = await loadRegistry(db, rigId, at, true);
    if (registry.pendingActivationId) {
      return failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Start New Card is blocked while an exact calibration activation is pending.", 409);
    }
    if (!registry.activeActivationId) {
      return failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Start New Card requires one exact hosted ACTIVE calibration activation.", 409);
    }
    const active = registry.activations.find((entry) => entry.activationId === registry.activeActivationId);
    if (!active || active.state !== "ACTIVE") {
      return failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Hosted active calibration pointer is contradictory.", 503);
    }
    const rootRow = await db.mathematicalCalibrationActivation.findFirst({
      where: { id: active.activationId, rigId },
      include: { events: { orderBy: { sequence: "asc" } }, calibrationSnapshot: { include: { rig: { include: { tenant: true } } } } },
    });
    if (!rootRow) failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Hosted active calibration record is missing.", 503);
    const root = record(rootRow, "active activation");
    const snapshot = exactSnapshotForActivation(root.calibrationSnapshot, rigId);
    const rig = record(snapshot.rig, "snapshot.rig");
    const tenant = record(rig.tenant, "snapshot.rig.tenant");
    if (tenant.id !== tenantId || rig.status !== "ACTIVE") {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_UNAVAILABLE", "Hosted ACTIVE calibration does not belong to the exact active tenant rig.", 409);
    }
    await verifySnapshotStorage(snapshot);
    const events = sortedEvents(root);
    const receiptEvent = [...events].reverse().find((entry) => entry.eventType === "ACTIVATED");
    if (!receiptEvent?.workstationReceipt || receiptEvent.workstationReceiptSha256 !== active.workstationReceiptSha256) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Hosted ACTIVE calibration receipt is missing or contradictory.", 503);
    }
    const receiptParsed = aiGraderCalibrationWorkstationReceiptV1Schema.safeParse(receiptEvent.workstationReceipt);
    if (!receiptParsed.success || hashCanonical(receiptParsed.data) !== active.workstationReceiptSha256) {
      failure("AI_GRADER_CALIBRATION_ACTIVATION_STATE_CONTRADICTORY", "Hosted ACTIVE calibration receipt does not reproduce.", 503);
    }
    return {
      registryRevision: registry.registryRevision,
      authority: authorityFrom(active, at, activeAuthorityTtlMs, requireHostedAuthoritySigningKey()),
      activation: active,
    };
  }

  return {
    resolveTrustedRegistry,
    list,
    status,
    requestObservationAuthority,
    requestActivation,
    completeActivation,
    failActivation,
    recordSnapshotRevoked,
    readStartAuthority,
  };
}
