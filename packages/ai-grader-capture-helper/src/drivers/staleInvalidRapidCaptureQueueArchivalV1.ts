import crypto from "node:crypto";
import { createConnection } from "node:net";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;
const QUEUE_SCHEMA = "ten-kings-ai-grader-rapid-capture-queue-v2" as const;
const ARCHIVE_SCHEMA = "ten-kings-ai-grader-stale-invalid-review-archive-v1" as const;
const RECEIPT_SCHEMA = "ten-kings-ai-grader-stale-invalid-review-archive-receipt-v1" as const;
const JOURNAL_SCHEMA = "ten-kings-ai-grader-stale-invalid-review-archive-journal-v1" as const;
const POINTER_SCHEMA = "ten-kings-ai-grader-stale-invalid-review-archive-pointer-v1" as const;
export const EXTERNAL_SAFE_OFF_RECEIPT_SCHEMA_V1 = "ten-kings-ai-grader-stale-invalid-review-external-safe-off-receipt-v1" as const;
export const EXTERNAL_SAFE_OFF_PURPOSE_V1 = "stale_invalid_review_archive_preflight" as const;
const REASON = "owner_removed_stale_invalid_finding_review_v1" as const;
const TARGET_SOURCE_CANDIDATES = 16;
const TARGET_VALIDATION_ISSUES = 32;
const EXTERNAL_SAFE_OFF_MAX_AGE_MS = 5 * 60_000;
const EXTERNAL_SAFE_OFF_TIMEOUT_MS = 1500;
const SAFE_OFF_FRAME_EXPECTATIONS = [
  {
    name: "lightingOutput",
    commandNumber: "86",
    description: "Lighting output ON/OFF; channel enable or safe off",
    request: "W8601010000020000030000040000050000060000070000080000",
    response: "W86ACK0",
    meaning: "Lighting output OFF",
  },
  {
    name: "asynchronousOutput",
    commandNumber: "85",
    description: "Asynchronous output ON/OFF; OFF for trigger-only profile",
    request: "W8501010000020000030000040000050000060000070000080000",
    response: "W85ACK0",
    meaning: "Asynchronous output OFF",
  },
  {
    name: "lightingOutputValue",
    commandNumber: "11",
    description: "Lighting output value; PWM duty cycle in 1000 steps",
    request: "W1101010000020000030000040000050000060000070000080000",
    response: "W11ACK0",
    meaning: "PWM duty 0 steps for safe-off",
  },
] as const;

type JsonRecord = Record<string, any>;

type DefectFindingsRepresentationV1 = "absent" | "explicit_empty_array";

interface StaleInvalidRapidCaptureQueueIncidentTargetV1 {
  queueItemId: string;
  sessionId: string;
  reportId: string;
  evidence: {
    manifestSha256: string;
    reportBundleSha256: string;
    productionReleaseSha256: string;
    defectFindingsRepresentation: DefectFindingsRepresentationV1;
  };
}

export interface StaleInvalidRapidCaptureQueueIncidentV1 {
  incidentId: string;
  expectedBeforeQueueSha256: string;
  targetItems: readonly [StaleInvalidRapidCaptureQueueIncidentTargetV1, StaleInvalidRapidCaptureQueueIncidentTargetV1];
  owner: "Mark / Ten Kings";
  reason: typeof REASON;
  authorizationSource: string;
  safeOffController: {
    identity: string;
    host: string;
    port: number;
  };
}

export const STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722: StaleInvalidRapidCaptureQueueIncidentV1 = {
  incidentId: "ten-kings-stale-invalid-review-removal-20260722-v1",
  expectedBeforeQueueSha256: "3bdb4118245ee92406280f74bb45ed43c56e279f5d2cad37c2c6b444d256e05f",
  targetItems: [
    {
      queueItemId: "ai-grader-browser-station-session-2026-07-21T042424764Z-session-rapid-card",
      sessionId: "ai-grader-browser-station-session-2026-07-21T042424764Z-session",
      reportId: "ai-grader-browser-station-session-2026-07-21T042424764Z-report",
      evidence: {
        manifestSha256: "0fe9a33bb0057fa4b57aa184df099711609b504ad56ccc641ec4cb4ca7638979",
        reportBundleSha256: "2cc1ba76cb854c68359000ecf95f42718c90de2a4d4a5b8d8dce5f73c0eb331d",
        productionReleaseSha256: "b124003d436b3a7e0e2b4963a7f00656f1c17ae31ed5ea96c2aafbffe611d3c5",
        defectFindingsRepresentation: "absent",
      },
    },
    {
      queueItemId: "ai-grader-browser-station-session-2026-07-21T035440224Z-session-rapid-card",
      sessionId: "ai-grader-browser-station-session-2026-07-21T035440224Z-session",
      reportId: "ai-grader-browser-station-session-2026-07-21T035440224Z-report",
      evidence: {
        manifestSha256: "5d5b21bf1b2d3d419114f5e9374d54b418828964d3af1344610061ec998a4003",
        reportBundleSha256: "8d6fefee97bc3ecd53be35f71555d1c940b22dd3fe3f04bfd1cb9dc248e0dc70",
        productionReleaseSha256: "46016f6a4ed4f72e9869128fa31a051c0788358ae177f42c5e7b3ec9c512d70f",
        defectFindingsRepresentation: "absent",
      },
    },
  ],
  owner: "Mark / Ten Kings",
  reason: REASON,
  authorizationSource: "explicit_product_owner_instruction_2026-07-22",
  safeOffController: {
    identity: "leimac-idmu-tcp:169.254.191.156:1000",
    host: "169.254.191.156",
    port: 1000,
  },
};

export interface StaleInvalidRapidCaptureQueueArchivalOptionsV1 {
  outputDir: string;
  archiveRoot: string;
  idleStatusPath: string;
  idleStatusSha256: string;
  externalSafeOffReceiptPath?: string;
  externalSafeOffReceiptSha256?: string;
  now?: string;
  helperPort?: number;
  requireHelperPortReleased?: () => Promise<void>;
  failpoint?: "after_archive" | "after_journal" | "after_backup_rename" | "after_install" | "after_backup_cleanup_before_journal_cleanup";
}

export interface StaleInvalidRapidCaptureQueueArchivalResultV1 {
  incidentId: string;
  idempotent: boolean;
  archiveId: string;
  archiveDir: string;
  receiptPath: string;
  receiptSha256: string;
  archivePointerPath: string;
  archivePointerSha256: string;
  beforeQueueSha256: string;
  afterQueueSha256: string;
  beforeCount: number;
  removedCount: 2;
  afterCount: number;
  unfinishedAfterCount: 0;
  referencedEvidenceCount: number;
}

interface FileIdentityV1 {
  path: string;
  sha256: string;
  byteSize: number;
}

type SafeOffEvidenceV1 = {
  source: "bridge_status";
  bridgePhysicalState: "safe_off_verified";
  physicalComplete: true;
} | {
  source: "external_guarded_leimac_safe_off";
  bridgePhysicalState: "unverified";
  physicalComplete: false;
  receipt: FileIdentityV1;
  controllerIdentity: string;
  controllerHost: string;
  controllerPort: number;
  command: "leimac-idmu-safe-off";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  idleStatusCapturedAt: string;
  receiptToStatusMs: number;
  statusToExecutionMs: number;
  ackResponses: ["W86ACK0", "W85ACK0", "W11ACK0"];
  zeroedChannels: [1, 2, 3, 4, 5, 6, 7, 8];
  lightsCommanded: false;
  persistentSaved: false;
};

interface ArchiveLedgerV1 {
  schemaVersion: typeof ARCHIVE_SCHEMA;
  incidentId: string;
  executedAt: string;
  authorization: {
    owner: "Mark / Ten Kings";
    reason: typeof REASON;
    source: string;
  };
  idleStatusEvidence: FileIdentityV1;
  safeOffEvidence: SafeOffEvidenceV1;
  queue: {
    schemaVersion: typeof QUEUE_SCHEMA;
    beforeSha256: string;
    beforeByteSize: number;
    beforeCount: number;
    afterSha256: string;
    afterByteSize: number;
    afterCount: number;
    unfinishedBeforeCount: number;
    unfinishedAfterCount: 0;
  };
  removedEntries: Array<{
    queueItemId: string;
    sessionId: string;
    reportId: string;
    canonicalEntrySha256: string;
    manifestSha256: string;
    reportBundleSha256: string;
    productionReleaseSha256: string;
    findingValidation: {
      status: "invalid";
      sourceCandidateCount: 16;
      publishedFindingCount: 0;
      issueCount: 32;
      defectFindingsRepresentation: DefectFindingsRepresentationV1;
    };
    publication: {
      storageUpload: "pending_not_uploaded";
      cardLinkage: "not_linked";
    };
  }>;
  retainedTerminalEntries: Array<{
    queueItemId: string;
    sessionId: string;
    reportId: string;
    state: "failed" | "published";
    canonicalEntrySha256: string;
  }>;
  referencedEvidence: FileIdentityV1[];
  preservation: {
    referencedFilesRemainInPlace: true;
    reportManifestArtifactDeletionPerformed: false;
    reportBytesRewritten: false;
    terminalEntryPayloadsUnchanged: true;
  };
}

interface ArchiveReceiptV1 {
  schemaVersion: typeof RECEIPT_SCHEMA;
  incidentId: string;
  archiveId: string;
  executedAt: string;
  owner: "Mark / Ten Kings";
  reason: typeof REASON;
  beforeQueueSha256: string;
  afterQueueSha256: string;
  beforeCount: number;
  removedCount: 2;
  afterCount: number;
  unfinishedAfterCount: 0;
  removedQueueItemIds: string[];
  removedDefectFindingsRepresentations: Array<{
    queueItemId: string;
    representation: DefectFindingsRepresentationV1;
  }>;
  archiveLedgerSha256: string;
  safeOffEvidence: SafeOffEvidenceV1;
}

interface TransactionJournalV1 {
  schemaVersion: typeof JOURNAL_SCHEMA;
  incidentId: string;
  archiveId: string;
  expectedBeforeQueueSha256: string;
  expectedAfterQueueSha256: string;
  queuePath: string;
  stagePath: string;
  backupPath: string;
  pointerPath: string;
  pointerStagePath: string;
  expectedPointerSha256: string;
  archiveDir: string;
}

interface ArchivePointerV1 {
  schemaVersion: typeof POINTER_SCHEMA;
  incidentId: string;
  archiveId: string;
  archiveDir: string;
  beforeQueueSha256: string;
  afterQueueSha256: string;
  removedItems: Array<{ queueItemId: string; sessionId: string; reportId: string }>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is JsonRecord {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseCanonical<T>(bytes: Buffer, label: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!bytes.equals(canonicalBytes(parsed))) throw new Error(`${label} is not exact canonical JSON.`);
  return parsed as T;
}

function exactTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new Error("The maintenance transaction timestamp must be exact canonical UTC milliseconds.");
  }
  return value;
}

function safeAbsolute(value: string, label: string): string {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) throw new Error(`${label} is not one safe absolute path.`);
  return resolved;
}

function ensureDirectory(value: string, label: string): string {
  const resolved = safeAbsolute(value, label);
  mkdirSync(resolved, { recursive: true });
  const link = lstatSync(resolved);
  if (!link.isDirectory() || link.isSymbolicLink()) throw new Error(`${label} must be one real directory without a reparse/symbolic link.`);
  return resolved;
}

function containedBy(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function writeExclusiveSynced(filePath: string, bytes: Buffer): void {
  const handle = openSync(filePath, "wx");
  try {
    writeFileSync(handle, bytes);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

function fileIdentity(filePath: string): FileIdentityV1 {
  const resolved = path.resolve(filePath);
  const link = lstatSync(resolved);
  if (!link.isFile() || link.isSymbolicLink()) throw new Error(`Referenced evidence is not one immutable regular file: ${resolved}`);
  const bytes = readFileSync(resolved);
  return { path: resolved, sha256: sha256(bytes), byteSize: bytes.length };
}

function sameJson(left: unknown, right: unknown): boolean {
  return sha256(canonicalBytes(left)) === sha256(canonicalBytes(right));
}

function queueObject(bytes: Buffer, expectedSha256?: string): JsonRecord {
  if (expectedSha256 && sha256(bytes) !== expectedSha256) throw new Error("Rapid queue SHA-256 changed; no archive or queue mutation was performed.");
  let queue: unknown;
  try {
    queue = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Rapid queue is not valid JSON.");
  }
  if (!isRecord(queue) || queue.schemaVersion !== QUEUE_SCHEMA || !Array.isArray(queue.items) || typeof queue.updatedAt !== "string" || typeof queue.rapidCaptureEnabled !== "boolean") {
    throw new Error("Rapid queue is not the exact recognized v2 schema.");
  }
  return queue;
}

function unfinishedItems(queue: JsonRecord): JsonRecord[] {
  return queue.items.filter((item: unknown) => isRecord(item) && item.state !== "failed" && item.state !== "published");
}

export function evaluateRapidCaptureQueueMaintenanceGateV1(queue: unknown): {
  ready: boolean;
  unfinishedQueueItemIds: string[];
  terminalQueueItemIds: string[];
} {
  if (!isRecord(queue) || queue.schemaVersion !== QUEUE_SCHEMA || !Array.isArray(queue.items)) {
    throw new Error("Maintenance gate requires one recognized Rapid queue v2 object.");
  }
  const unfinishedQueueItemIds: string[] = [];
  const terminalQueueItemIds: string[] = [];
  for (const item of queue.items) {
    if (!isRecord(item) || typeof item.queueItemId !== "string" || typeof item.state !== "string") {
      throw new Error("Maintenance gate refuses one malformed Rapid queue item.");
    }
    (item.state === "failed" || item.state === "published" ? terminalQueueItemIds : unfinishedQueueItemIds).push(item.queueItemId);
  }
  return { ready: unfinishedQueueItemIds.length === 0, unfinishedQueueItemIds, terminalQueueItemIds };
}

function timestampMs(value: unknown, label: string): number {
  if (typeof value !== "string") throw new Error(`${label} timestamp is missing.`);
  exactTimestamp(value);
  return Date.parse(value);
}

function exactZeroedFrame(value: unknown, index: number): JsonRecord {
  const expected = SAFE_OFF_FRAME_EXPECTATIONS[index];
  if (!expected || !exactKeys(value, [
    "name", "commandNumber", "description", "targetDesignation", "channelValues",
    "requestAscii", "requestFrame", "terminator", "allowlisted",
  ])) throw new Error("External safe-off receipt frame shape is invalid.");
  if (
    value.name !== expected.name || value.commandNumber !== expected.commandNumber || value.description !== expected.description ||
    value.targetDesignation !== "01" || value.requestAscii !== expected.request || value.requestFrame !== expected.request ||
    value.terminator !== "" || value.allowlisted !== true || !Array.isArray(value.channelValues) || value.channelValues.length !== 8
  ) throw new Error(`External safe-off receipt frame ${expected.name} is not the exact allowlisted safe-off command.`);
  value.channelValues.forEach((channel: unknown, channelIndex: number) => {
    if (
      !exactKeys(channel, ["channel", "value", "meaning"]) || channel.channel !== channelIndex + 1 ||
      channel.value !== "0000" || channel.meaning !== expected.meaning
    ) throw new Error(`External safe-off receipt frame ${expected.name} did not zero every channel.`);
  });
  return value;
}

type ExternalSafeOffReceiptIncidentV1 = Pick<
  StaleInvalidRapidCaptureQueueIncidentV1,
  "incidentId" | "owner" | "authorizationSource" | "safeOffController"
>;

interface ParsedExternalSafeOffReceiptV1 {
  result: JsonRecord;
  startedMs: number;
  finishedMs: number;
}

export interface VerifiedExternalSafeOffReceiptOperationV1 {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  controllerIdentity: string;
  controllerHost: string;
  controllerPort: number;
  ackResponses: ["W86ACK0", "W85ACK0", "W11ACK0"];
  zeroedChannels: [1, 2, 3, 4, 5, 6, 7, 8];
  lightsCommanded: false;
  persistentSaved: false;
}

function parsedExternalSafeOffReceiptV1(
  bytes: Buffer,
  incident: ExternalSafeOffReceiptIncidentV1,
): ParsedExternalSafeOffReceiptV1 {
  const receipt = parseCanonical<JsonRecord>(bytes, "External safe-off receipt");
  if (!exactKeys(receipt, ["schemaVersion", "incidentId", "purpose", "authorization", "operation"]) ||
      receipt.schemaVersion !== EXTERNAL_SAFE_OFF_RECEIPT_SCHEMA_V1 || receipt.incidentId !== incident.incidentId ||
      receipt.purpose !== EXTERNAL_SAFE_OFF_PURPOSE_V1 || !exactKeys(receipt.authorization, ["owner", "source"]) ||
      receipt.authorization.owner !== incident.owner || receipt.authorization.source !== incident.authorizationSource ||
      !exactKeys(receipt.operation, ["ok", "service", "command", "result"]) || receipt.operation.ok !== true ||
      receipt.operation.service !== "ai-grader-capture-helper" || receipt.operation.command !== "leimac-idmu-safe-off" ||
      !isRecord(receipt.operation.result)) {
    throw new Error("External safe-off receipt is not the exact guarded capture-helper operation.");
  }
  const result = receipt.operation.result;
  const controller = incident.safeOffController;
  if (!exactKeys(result, [
    "ok", "host", "port", "timeoutMs", "startedAt", "finishedAt", "durationMs", "applied", "frames", "writes", "safety",
  ]) || result.ok !== true || result.applied !== true || result.host !== controller.host || result.port !== controller.port ||
      result.timeoutMs !== EXTERNAL_SAFE_OFF_TIMEOUT_MS || !Number.isSafeInteger(result.durationMs) || result.durationMs < 0 ||
      result.durationMs > 10_000 || !Array.isArray(result.frames) || result.frames.length !== 3 ||
      !Array.isArray(result.writes) || result.writes.length !== 3 || !isRecord(result.safety)) {
    throw new Error("External safe-off receipt completion or configured controller identity is invalid.");
  }
  const startedMs = timestampMs(result.startedAt, "External safe-off start");
  const finishedMs = timestampMs(result.finishedAt, "External safe-off finish");
  if (finishedMs < startedMs || finishedMs - startedMs !== result.durationMs) {
    throw new Error("External safe-off receipt duration does not match its exact timestamps.");
  }
  result.frames.forEach((frame: unknown, index: number) => exactZeroedFrame(frame, index));
  let priorFinishedMs = startedMs;
  result.writes.forEach((write: unknown, index: number) => {
    const expected = SAFE_OFF_FRAME_EXPECTATIONS[index];
    if (!expected || !exactKeys(write, [
      "ok", "host", "port", "timeoutMs", "startedAt", "finishedAt", "durationMs", "frame", "rawResponse", "responseKind",
    ])) throw new Error("External safe-off receipt write shape is invalid.");
    const writeStartedMs = timestampMs(write.startedAt, "External safe-off write start");
    const writeFinishedMs = timestampMs(write.finishedAt, "External safe-off write finish");
    if (
      write.ok !== true || write.host !== controller.host || write.port !== controller.port || write.timeoutMs !== EXTERNAL_SAFE_OFF_TIMEOUT_MS ||
      write.rawResponse !== expected.response || write.responseKind !== "ack" || !sameJson(write.frame, result.frames[index]) ||
      writeStartedMs < priorFinishedMs || writeFinishedMs < writeStartedMs || writeFinishedMs - writeStartedMs !== write.durationMs ||
      !Number.isSafeInteger(write.durationMs) || writeStartedMs < startedMs || writeFinishedMs > finishedMs
    ) throw new Error(`External safe-off receipt write ${expected.name} lacks its exact bounded acknowledgement.`);
    priorFinishedMs = writeFinishedMs;
  });
  if (priorFinishedMs > finishedMs || !exactKeys(result.safety, [
    "writesApplied", "lightsCommanded", "outputSettingsChanged", "triggerSettingsChanged", "persistentSaved", "arbitraryWritesAllowed",
  ]) || result.safety.writesApplied !== true || result.safety.lightsCommanded !== false ||
      result.safety.outputSettingsChanged !== true || result.safety.triggerSettingsChanged !== false ||
      result.safety.persistentSaved !== false || result.safety.arbitraryWritesAllowed !== false) {
    throw new Error("External safe-off receipt safety summary is invalid.");
  }
  return { result, startedMs, finishedMs };
}

export function verifyExternalSafeOffReceiptOperationV1(
  bytes: Buffer,
  incident: ExternalSafeOffReceiptIncidentV1 = STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722,
): VerifiedExternalSafeOffReceiptOperationV1 {
  const parsed = parsedExternalSafeOffReceiptV1(bytes, incident);
  return {
    startedAt: parsed.result.startedAt,
    finishedAt: parsed.result.finishedAt,
    durationMs: parsed.result.durationMs,
    controllerIdentity: incident.safeOffController.identity,
    controllerHost: incident.safeOffController.host,
    controllerPort: incident.safeOffController.port,
    ackResponses: ["W86ACK0", "W85ACK0", "W11ACK0"],
    zeroedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
    lightsCommanded: false,
    persistentSaved: false,
  };
}

export function buildExternalSafeOffReceiptBytesV1(
  operation: unknown,
  incident: ExternalSafeOffReceiptIncidentV1 = STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722,
): Buffer {
  const bytes = canonicalBytes({
    schemaVersion: EXTERNAL_SAFE_OFF_RECEIPT_SCHEMA_V1,
    incidentId: incident.incidentId,
    purpose: EXTERNAL_SAFE_OFF_PURPOSE_V1,
    authorization: { owner: incident.owner, source: incident.authorizationSource },
    operation,
  });
  parsedExternalSafeOffReceiptV1(bytes, incident);
  return bytes;
}

function externalSafeOffEvidenceFromBytes(
  bytes: Buffer,
  identity: FileIdentityV1,
  status: JsonRecord,
  statusCapturedAt: string,
  executedAt: string,
  incident: ExternalSafeOffReceiptIncidentV1,
): SafeOffEvidenceV1 {
  const parsedReceipt = parsedExternalSafeOffReceiptV1(bytes, incident);
  const result = parsedReceipt.result;
  const startedMs = parsedReceipt.startedMs;
  const finishedMs = parsedReceipt.finishedMs;
  const controller = incident.safeOffController;

  const statusCapturedMs = timestampMs(statusCapturedAt, "Idle status capture");
  const executionMs = timestampMs(executedAt, "Maintenance execution");
  const statusUpdatedMs = timestampMs(status.updatedAt, "Authenticated helper status update");
  if (
    statusUpdatedMs > startedMs || finishedMs > statusCapturedMs || statusCapturedMs > executionMs ||
    statusCapturedMs - finishedMs > EXTERNAL_SAFE_OFF_MAX_AGE_MS || executionMs - statusCapturedMs > EXTERNAL_SAFE_OFF_MAX_AGE_MS
  ) throw new Error("External safe-off receipt is stale, future-dated, unrelated, or ordered incorrectly against status and execution.");

  const lighting = isRecord(status.liveLighting) ? status.liveLighting : {};
  const physical = isRecord(lighting.physicalState) ? lighting.physicalState : {};
  const profile = isRecord(lighting.profile) ? lighting.profile : {};
  const applied = isRecord(lighting.applied) ? lighting.applied : {};
  const connection = isRecord(lighting.connection) ? lighting.connection : {};
  const preview = isRecord(status.previewStatus) ? status.previewStatus : {};
  const previewSafety = isRecord(preview.safety) ? preview.safety : {};
  const physicalChangedMs = timestampMs(physical.changedAt, "Bridge physical-state change");
  const appliedAtMs = typeof applied.appliedAt === "string" ? timestampMs(applied.appliedAt, "Bridge lighting apply") : undefined;
  const conflictingEvent = Array.isArray(lighting.safetyEvents) && lighting.safetyEvents.some((event: unknown) => {
    if (!isRecord(event)) return true;
    const candidate = typeof event.at === "string" ? event.at : typeof event.changedAt === "string" ? event.changedAt : undefined;
    return candidate !== undefined && timestampMs(candidate, "Bridge lighting event") > startedMs;
  });
  if (
    lighting.status !== "unavailable" || physical.state !== "unverified" || physical.complete !== false ||
    physical.expectedWriteCount !== 0 || physical.acknowledgedWriteCount !== 0 || physicalChangedMs > startedMs ||
    profile.enabled !== false || applied.dutyPercent !== 0 || applied.actualLeimacPwmStep !== 0 ||
    !Array.isArray(applied.channels) || applied.channels.length !== 0 || applied.verificationState !== "unknown" ||
    applied.expectedWriteCount !== 0 || applied.acknowledgedWriteCount !== 0 || applied.verificationComplete !== false ||
    connection.state !== "idle" || connection.persistentLeimacSession !== false || previewSafety.lightingCommanded !== false ||
    (appliedAtMs !== undefined && appliedAtMs > startedMs) || conflictingEvent
  ) throw new Error("Authenticated helper status contains post-command or conflicting lighting state; external safe-off evidence cannot be composed.");

  return {
    source: "external_guarded_leimac_safe_off",
    bridgePhysicalState: "unverified",
    physicalComplete: false,
    receipt: identity,
    controllerIdentity: controller.identity,
    controllerHost: controller.host,
    controllerPort: controller.port,
    command: "leimac-idmu-safe-off",
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    idleStatusCapturedAt: statusCapturedAt,
    receiptToStatusMs: statusCapturedMs - finishedMs,
    statusToExecutionMs: executionMs - statusCapturedMs,
    ackResponses: ["W86ACK0", "W85ACK0", "W11ACK0"],
    zeroedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
    lightsCommanded: false,
    persistentSaved: false,
  };
}

function verifyIdleStatus(
  statusPath: string,
  expectedSha256: string,
  executedAt: string,
  externalReceipt: { path?: string; sha256?: string },
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
): { identity: FileIdentityV1; safeOffEvidence: SafeOffEvidenceV1 } {
  if (!SHA256.test(expectedSha256)) throw new Error("Idle status evidence SHA-256 is invalid.");
  const identity = fileIdentity(statusPath);
  if (identity.sha256 !== expectedSha256) throw new Error("Idle status evidence SHA-256 does not match its exact bytes.");
  const status = JSON.parse(readFileSync(identity.path, "utf8")) as JsonRecord;
  const preview = isRecord(status.previewStatus) ? status.previewStatus : {};
  const warm = isRecord(status.warmRunnerStatus) ? status.warmRunnerStatus : {};
  const captureLock = isRecord(warm.captureLock) ? warm.captureLock : {};
  const queues = isRecord(warm.queues) ? warm.queues : {};
  const lighting = isRecord(status.liveLighting) ? status.liveLighting : {};
  const physical = isRecord(lighting.physicalState) ? lighting.physicalState : {};
  const statusTime = typeof status.updatedAt === "string" ? Date.parse(status.updatedAt) : Number.NaN;
  const executionTime = Date.parse(executedAt);
  if (
    status.ok !== true || status.localOnly !== true || status.currentStep !== "start_new_card" || status.sessionId !== undefined ||
    !Number.isFinite(statusTime) || statusTime > executionTime ||
    !["not_started", "stopped"].includes(preview.status) || !["idle", "released"].includes(preview.cameraOwnership) ||
    !isRecord(preview.intentionalTransition) || preview.intentionalTransition.active !== false ||
    warm.status !== "idle" || captureLock.held !== false ||
    !Array.isArray(queues.capture) || queues.capture.length !== 0 || !Array.isArray(queues.processing) || queues.processing.length !== 0 || !Array.isArray(queues.report) || queues.report.length !== 0
  ) {
    throw new Error("Authenticated helper status does not prove idle session, preview, camera, capture lock, and worker queues.");
  }
  const hasReceiptPath = typeof externalReceipt.path === "string" && externalReceipt.path.length > 0;
  const hasReceiptSha = typeof externalReceipt.sha256 === "string" && externalReceipt.sha256.length > 0;
  if (hasReceiptPath !== hasReceiptSha) throw new Error("External safe-off receipt path and SHA-256 must be supplied together.");
  if (["safe_off", "off"].includes(lighting.status) && physical.state === "safe_off_verified" && physical.complete === true) {
    if (hasReceiptPath) throw new Error("External safe-off receipt is not accepted when bridge-native safe_off_verified evidence is already authoritative.");
    if (executionTime - statusTime > EXTERNAL_SAFE_OFF_MAX_AGE_MS) throw new Error("Authenticated helper safe-off status is stale.");
    return {
      identity,
      safeOffEvidence: { source: "bridge_status", bridgePhysicalState: "safe_off_verified", physicalComplete: true },
    };
  }
  if (!hasReceiptPath || !hasReceiptSha || !SHA256.test(externalReceipt.sha256!)) {
    throw new Error("Bridge physical state is unverified; the exact external safe-off receipt path and SHA-256 are required.");
  }
  const receiptIdentity = fileIdentity(externalReceipt.path!);
  if (receiptIdentity.sha256 !== externalReceipt.sha256) throw new Error("External safe-off receipt SHA-256 does not match its exact bytes.");
  const statusCapturedAt = statSync(identity.path).mtime.toISOString();
  return {
    identity,
    safeOffEvidence: externalSafeOffEvidenceFromBytes(
      readFileSync(receiptIdentity.path), receiptIdentity, status, statusCapturedAt, executedAt, incident,
    ),
  };
}

async function requirePortReleased(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (error?: Error) => {
      socket.removeAllListeners();
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.setTimeout(750, () => finish(new Error(`Loopback port ${port} did not prove released.`)));
    socket.once("connect", () => finish(new Error(`Loopback port ${port} is still listening; stop only the old capture helper before this transaction.`)));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") finish();
      else finish(new Error(`Loopback port ${port} release probe failed: ${error.code ?? error.message}`));
    });
  });
}

function collectPathStrings(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => collectPathStrings(entry, found));
  else if (isRecord(value)) Object.values(value).forEach((entry) => collectPathStrings(entry, found));
  else if (typeof value === "string" && path.isAbsolute(value) && existsSync(value)) found.add(path.resolve(value));
  return found;
}

function collectFiles(targetPath: string, files: Set<string>): void {
  const link = lstatSync(targetPath);
  if (link.isSymbolicLink()) throw new Error(`Referenced evidence cannot traverse a reparse/symbolic link: ${targetPath}`);
  if (link.isFile()) {
    files.add(path.resolve(targetPath));
    return;
  }
  if (!link.isDirectory()) throw new Error(`Referenced evidence path is neither a regular file nor directory: ${targetPath}`);
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    collectFiles(path.join(targetPath, entry.name), files);
  }
}

function targetIdentity(item: JsonRecord): { queueItemId: string; sessionId: string; reportId: string } {
  return { queueItemId: item.queueItemId, sessionId: item.sessionId, reportId: item.reportId };
}

function isExactFixedLegacyAbsentTarget(
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
  target: StaleInvalidRapidCaptureQueueIncidentTargetV1,
): boolean {
  const fixed = STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722;
  const fixedTarget = fixed.targetItems.find((candidate) => sameJson(targetIdentity(candidate), targetIdentity(target)));
  return (
    incident.incidentId === fixed.incidentId && incident.expectedBeforeQueueSha256 === fixed.expectedBeforeQueueSha256 &&
    incident.owner === fixed.owner && incident.reason === fixed.reason && incident.authorizationSource === fixed.authorizationSource &&
    sameJson(incident.safeOffController, fixed.safeOffController) && sameJson(incident.targetItems, fixed.targetItems) &&
    fixedTarget !== undefined && sameJson(target, fixedTarget) &&
    target.evidence.defectFindingsRepresentation === "absent"
  );
}

function defectFindingsRepresentation(
  visionLab: JsonRecord,
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
  target: StaleInvalidRapidCaptureQueueIncidentTargetV1,
): DefectFindingsRepresentationV1 {
  if (!Object.prototype.hasOwnProperty.call(visionLab, "defectFindings")) {
    if (!isExactFixedLegacyAbsentTarget(incident, target)) {
      throw new Error("Absent defectFindings is accepted only for the exact hash-pinned 2026-07-22 legacy incident targets.");
    }
    return "absent";
  }
  if (!Array.isArray(visionLab.defectFindings) || visionLab.defectFindings.length !== 0) {
    throw new Error("Persisted defectFindings must be an explicit empty array when the property is present.");
  }
  return "explicit_empty_array";
}

/** Test seam only: runtime validation reaches this through the fixed incident transaction. */
export function defectFindingsRepresentationForTestV1(
  visionLab: unknown,
  target: StaleInvalidRapidCaptureQueueIncidentTargetV1,
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
): DefectFindingsRepresentationV1 {
  if (!isRecord(visionLab)) throw new Error("Vision Lab evidence must be one object.");
  return defectFindingsRepresentation(visionLab, incident, target);
}

function exactTargetItem(queue: JsonRecord, target: StaleInvalidRapidCaptureQueueIncidentV1["targetItems"][number]): JsonRecord {
  const matches = queue.items.filter((item: unknown) => isRecord(item) && item.queueItemId === target.queueItemId);
  if (matches.length !== 1 || !sameJson(targetIdentity(matches[0]), targetIdentity(target))) throw new Error(`Exact queue/session/report linkage is absent for ${target.queueItemId}.`);
  const item = matches[0];
  if (item.state !== "report_ready_needs_confirm" || !isRecord(item.ocr) || item.ocr.state !== "succeeded" || typeof item.manifestPath !== "string") {
    throw new Error(`Target ${target.queueItemId} is no longer one succeeded-OCR report_ready_needs_confirm item.`);
  }
  return item;
}

function readJsonFile(filePath: string, label: string): { body: JsonRecord; identity: FileIdentityV1 } {
  const identity = fileIdentity(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(identity.path, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} is not one JSON object.`);
  return { body: parsed, identity };
}

function verifyTargetEvidence(
  item: JsonRecord,
  target: StaleInvalidRapidCaptureQueueIncidentTargetV1,
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
): {
  removed: ArchiveLedgerV1["removedEntries"][number];
  referenced: FileIdentityV1[];
} {
  const manifestResult = readJsonFile(item.manifestPath, "Target station manifest");
  const manifest = manifestResult.body;
  if (
    manifestResult.identity.sha256 !== target.evidence.manifestSha256 ||
    manifest.sessionId !== item.sessionId || manifest.reportId !== item.reportId || !isRecord(manifest.rapidCapture) ||
    manifest.rapidCapture.queueItemId !== item.queueItemId || manifest.rapidCapture.workflowState !== item.state ||
    !isRecord(manifest.outputs) || typeof manifest.outputs.reportBundlePath !== "string" || typeof manifest.outputs.productionReleasePath !== "string"
  ) throw new Error(`Station manifest linkage changed for ${item.queueItemId}.`);

  const bundleResult = readJsonFile(manifest.outputs.reportBundlePath, "Target report bundle");
  const releaseResult = readJsonFile(manifest.outputs.productionReleasePath, "Target production release");
  const bundle = bundleResult.body;
  const release = releaseResult.body;
  if (
    bundleResult.identity.sha256 !== target.evidence.reportBundleSha256 ||
    releaseResult.identity.sha256 !== target.evidence.productionReleaseSha256
  ) throw new Error(`Pinned manifest/report/release evidence identity changed for ${item.queueItemId}.`);
  const visionLab = isRecord(bundle.visionLab) ? bundle.visionLab : {};
  const validation = isRecord(visionLab.findingValidation) ? visionLab.findingValidation : {};
  if (
    bundle.reportId !== item.reportId || bundle.gradingSessionId !== item.sessionId ||
    validation.status !== "invalid" || validation.sourceCandidateCount !== TARGET_SOURCE_CANDIDATES || validation.publishedFindingCount !== 0 ||
    !Array.isArray(validation.issues) || validation.issues.length !== TARGET_VALIDATION_ISSUES
  ) throw new Error(`Persisted finding extraction is not the exact invalid 16/0/32 unpublished contract for ${item.queueItemId}.`);
  const findingRepresentation = defectFindingsRepresentation(visionLab, incident, target);
  if (findingRepresentation !== target.evidence.defectFindingsRepresentation) {
    throw new Error(`Persisted defectFindings representation changed for ${item.queueItemId}.`);
  }

  const publication = isRecord(release.publication) ? release.publication : {};
  const storage = isRecord(release.storageIntegration) ? release.storageIntegration : {};
  const database = isRecord(release.databaseIntegration) ? release.databaseIntegration : {};
  const linkage = isRecord(release.cardInventoryLinkage) ? release.cardInventoryLinkage : {};
  const cardIdentity = isRecord(bundle.cardIdentity) ? bundle.cardIdentity : {};
  if (
    release.reportId !== item.reportId || release.gradingSessionId !== item.sessionId ||
    publication.uploadPerformed !== false || storage.uploadPerformed !== false || database.productionDbWritesPerformed !== false ||
    publication.status !== "local_bundle_ready" || linkage.status !== "contract_ready_not_persisted" ||
    linkage.cardAssetId !== undefined || linkage.itemId !== undefined || cardIdentity.cardAssetId !== undefined || cardIdentity.itemId !== undefined
  ) throw new Error(`Target ${item.queueItemId} is published, uploaded, linked, or lacks exact pending/unlinked release evidence.`);

  const pathRoots = collectPathStrings({ item, manifest, bundle, release });
  pathRoots.add(path.resolve(item.manifestPath));
  pathRoots.add(path.resolve(manifest.outputs.reportBundlePath));
  pathRoots.add(path.resolve(manifest.outputs.productionReleasePath));
  const filePaths = new Set<string>();
  for (const root of pathRoots) collectFiles(root, filePaths);
  const referenced = [...filePaths].sort((a, b) => a.localeCompare(b)).map(fileIdentity);
  const byHash = new Map(referenced.map((entry) => [`${entry.sha256}:${entry.byteSize}`, entry]));
  for (const side of item.rawEvidence?.sides ?? []) {
    for (const role of side.roles ?? []) {
      if (!byHash.has(`${String(role.sha256).toLowerCase()}:${role.byteSize}`)) {
        throw new Error(`Raw evidence ${side.side}/${role.role} is not reproduced by the immutable referenced-file ledger.`);
      }
    }
  }
  for (const image of item.ocr.images ?? []) {
    if (typeof image.localPath !== "string" || !byHash.has(`${String(image.checksumSha256).toLowerCase()}:${image.byteSize}`)) {
      throw new Error("Queued OCR normalized evidence is not reproduced by the immutable referenced-file ledger.");
    }
  }
  return {
    removed: {
      ...targetIdentity(item),
      canonicalEntrySha256: sha256(canonicalBytes(item)),
      manifestSha256: manifestResult.identity.sha256,
      reportBundleSha256: bundleResult.identity.sha256,
      productionReleaseSha256: releaseResult.identity.sha256,
      findingValidation: {
        status: "invalid",
        sourceCandidateCount: 16,
        publishedFindingCount: 0,
        issueCount: 32,
        defectFindingsRepresentation: findingRepresentation,
      },
      publication: { storageUpload: "pending_not_uploaded", cardLinkage: "not_linked" },
    },
    referenced,
  };
}

function mergeReferencedEvidence(groups: FileIdentityV1[][]): FileIdentityV1[] {
  const byPath = new Map<string, FileIdentityV1>();
  for (const entry of groups.flat()) {
    const existing = byPath.get(entry.path);
    if (existing && (existing.sha256 !== entry.sha256 || existing.byteSize !== entry.byteSize)) throw new Error("Referenced evidence changed during preflight hashing.");
    byPath.set(entry.path, entry);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function afterQueueBytes(queue: JsonRecord, targets: readonly JsonRecord[], executedAt: string): { queue: JsonRecord; bytes: Buffer } {
  const removed = new Set(targets.map((item) => item.queueItemId));
  const next = { ...queue, updatedAt: executedAt, items: queue.items.filter((item: JsonRecord) => !removed.has(item.queueItemId)) };
  return { queue: next, bytes: Buffer.from(`${JSON.stringify(next, null, 2)}\n`, "utf8") };
}

function expectedReceipt(ledger: ArchiveLedgerV1, archiveId: string): ArchiveReceiptV1 {
  return {
    schemaVersion: RECEIPT_SCHEMA,
    incidentId: ledger.incidentId,
    archiveId,
    executedAt: ledger.executedAt,
    owner: ledger.authorization.owner,
    reason: ledger.authorization.reason,
    beforeQueueSha256: ledger.queue.beforeSha256,
    afterQueueSha256: ledger.queue.afterSha256,
    beforeCount: ledger.queue.beforeCount,
    removedCount: 2,
    afterCount: ledger.queue.afterCount,
    unfinishedAfterCount: 0,
    removedQueueItemIds: ledger.removedEntries.map((entry) => entry.queueItemId),
    removedDefectFindingsRepresentations: ledger.removedEntries.map((entry) => ({
      queueItemId: entry.queueItemId,
      representation: entry.findingValidation.defectFindingsRepresentation,
    })),
    archiveLedgerSha256: archiveId,
    safeOffEvidence: ledger.safeOffEvidence,
  };
}

function createArchive(
  archiveRoot: string,
  ledger: ArchiveLedgerV1,
  beforeBytes: Buffer,
  afterBytes: Buffer,
  removedItems: readonly JsonRecord[],
): { archiveId: string; archiveDir: string; receiptPath: string; receiptSha256: string } {
  const ledgerBytes = canonicalBytes(ledger);
  const archiveId = sha256(ledgerBytes);
  const archiveDir = path.join(archiveRoot, archiveId);
  const receipt = expectedReceipt(ledger, archiveId);
  const receiptBytes = canonicalBytes(receipt);
  if (existsSync(archiveDir)) {
    const verified = verifyArchive(archiveDir);
    if (verified.archiveId !== archiveId) throw new Error("Pre-existing incident archive does not match this exact transaction.");
    return { archiveId, archiveDir, receiptPath: path.join(archiveDir, "receipt.json"), receiptSha256: verified.receiptSha256 };
  }
  const temporary = path.join(archiveRoot, `.${ledger.incidentId}.${process.pid}.tmp`);
  if (existsSync(temporary)) throw new Error("Incident archive staging path already exists; preserve it for review.");
  mkdirSync(temporary);
  try {
    writeExclusiveSynced(path.join(temporary, "before-rapid-capture-queue.json"), beforeBytes);
    writeExclusiveSynced(path.join(temporary, "after-rapid-capture-queue.json"), afterBytes);
    writeExclusiveSynced(path.join(temporary, "removed-entries.json"), canonicalBytes(removedItems));
    writeExclusiveSynced(path.join(temporary, "idle-status-evidence.json"), readFileSync(ledger.idleStatusEvidence.path));
    if (ledger.safeOffEvidence.source === "external_guarded_leimac_safe_off") {
      writeExclusiveSynced(path.join(temporary, "external-safe-off-receipt.json"), readFileSync(ledger.safeOffEvidence.receipt.path));
    }
    writeExclusiveSynced(path.join(temporary, "archive-ledger.json"), ledgerBytes);
    writeExclusiveSynced(path.join(temporary, "receipt.json"), receiptBytes);
    renameSync(temporary, archiveDir);
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return { archiveId, archiveDir, receiptPath: path.join(archiveDir, "receipt.json"), receiptSha256: sha256(receiptBytes) };
}

function verifyArchive(archiveDir: string): { ledger: ArchiveLedgerV1; receipt: ArchiveReceiptV1; archiveId: string; receiptSha256: string; beforeBytes: Buffer; afterBytes: Buffer } {
  const ledgerBytes = readFileSync(path.join(archiveDir, "archive-ledger.json"));
  const ledger = parseCanonical<ArchiveLedgerV1>(ledgerBytes, "Archive ledger");
  const archiveId = sha256(ledgerBytes);
  if (
    path.basename(path.resolve(archiveDir)) !== archiveId || ledger.schemaVersion !== ARCHIVE_SCHEMA ||
    !exactKeys(ledger, ["schemaVersion", "incidentId", "executedAt", "authorization", "idleStatusEvidence", "safeOffEvidence", "queue", "removedEntries", "retainedTerminalEntries", "referencedEvidence", "preservation"])
  ) throw new Error("Archive directory is not bound to its exact canonical ledger.");
  const expectedArchiveFiles = [
    "after-rapid-capture-queue.json", "archive-ledger.json", "before-rapid-capture-queue.json",
    "idle-status-evidence.json", "receipt.json", "removed-entries.json",
    ...(ledger.safeOffEvidence.source === "external_guarded_leimac_safe_off" ? ["external-safe-off-receipt.json"] : []),
  ].sort();
  if (!sameJson(readdirSync(archiveDir).sort(), expectedArchiveFiles)) throw new Error("Archive contains an unexpected or missing incident evidence member.");
  const receiptBytes = readFileSync(path.join(archiveDir, "receipt.json"));
  const receipt = parseCanonical<ArchiveReceiptV1>(receiptBytes, "Archive receipt");
  if (!sameJson(receipt, expectedReceipt(ledger, archiveId))) throw new Error("Archive receipt does not reproduce the exact ledger and archive identity.");
  const beforeBytes = readFileSync(path.join(archiveDir, "before-rapid-capture-queue.json"));
  const afterBytes = readFileSync(path.join(archiveDir, "after-rapid-capture-queue.json"));
  const removedBytes = readFileSync(path.join(archiveDir, "removed-entries.json"));
  const removed = parseCanonical<JsonRecord[]>(removedBytes, "Archived removed entries");
  if (
    sha256(beforeBytes) !== ledger.queue.beforeSha256 || beforeBytes.length !== ledger.queue.beforeByteSize ||
    sha256(afterBytes) !== ledger.queue.afterSha256 || afterBytes.length !== ledger.queue.afterByteSize ||
    removed.length !== 2 || removed.some((item, index) => sha256(canonicalBytes(item)) !== ledger.removedEntries[index]?.canonicalEntrySha256)
  ) throw new Error("Archive queue or removed-entry bytes do not reproduce the exact ledger.");
  const idleBytes = readFileSync(path.join(archiveDir, "idle-status-evidence.json"));
  if (sha256(idleBytes) !== ledger.idleStatusEvidence.sha256 || idleBytes.length !== ledger.idleStatusEvidence.byteSize) {
    throw new Error("Archived idle-status evidence no longer matches its exact ledger identity.");
  }
  if (ledger.safeOffEvidence.source === "external_guarded_leimac_safe_off") {
    const externalBytes = readFileSync(path.join(archiveDir, "external-safe-off-receipt.json"));
    if (
      sha256(externalBytes) !== ledger.safeOffEvidence.receipt.sha256 ||
      externalBytes.length !== ledger.safeOffEvidence.receipt.byteSize
    ) throw new Error("Archived external safe-off receipt no longer matches its exact ledger identity.");
    const status = JSON.parse(idleBytes.toString("utf8")) as JsonRecord;
    const reproduced = externalSafeOffEvidenceFromBytes(
      externalBytes,
      ledger.safeOffEvidence.receipt,
      status,
      ledger.safeOffEvidence.idleStatusCapturedAt,
      ledger.executedAt,
      {
        incidentId: ledger.incidentId,
        owner: ledger.authorization.owner,
        authorizationSource: ledger.authorization.source,
        safeOffController: {
          identity: ledger.safeOffEvidence.controllerIdentity,
          host: ledger.safeOffEvidence.controllerHost,
          port: ledger.safeOffEvidence.controllerPort,
        },
      },
    );
    if (!sameJson(reproduced, ledger.safeOffEvidence)) throw new Error("Archived external safe-off verification summary does not reproduce exactly.");
  } else if (
    ledger.safeOffEvidence.bridgePhysicalState !== "safe_off_verified" || ledger.safeOffEvidence.physicalComplete !== true
  ) throw new Error("Archive bridge-native safe-off evidence is invalid.");
  for (const expected of ledger.referencedEvidence) {
    if (!sameJson(fileIdentity(expected.path), expected)) throw new Error(`Archived referenced evidence changed or disappeared: ${expected.path}`);
  }
  return { ledger, receipt, archiveId, receiptSha256: sha256(receiptBytes), beforeBytes, afterBytes };
}

function archivePointer(verified: ReturnType<typeof verifyArchive>, archiveDir: string): ArchivePointerV1 {
  return {
    schemaVersion: POINTER_SCHEMA,
    incidentId: verified.ledger.incidentId,
    archiveId: verified.archiveId,
    archiveDir: path.resolve(archiveDir),
    beforeQueueSha256: verified.ledger.queue.beforeSha256,
    afterQueueSha256: verified.ledger.queue.afterSha256,
    removedItems: verified.ledger.removedEntries.map(({ queueItemId, sessionId, reportId }) => ({ queueItemId, sessionId, reportId })),
  };
}

function archivePointerPath(outputDir: string): string {
  return path.join(outputDir, "rapid-capture-queue.owner-removal-v1.archive-pointer.json");
}

function assertVerifiedArchiveMatchesIncident(
  verified: ReturnType<typeof verifyArchive>,
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
): void {
  const ledger = verified.ledger;
  if (
    ledger.incidentId !== incident.incidentId || ledger.queue.beforeSha256 !== incident.expectedBeforeQueueSha256 ||
    ledger.queue.beforeCount !== 5 || ledger.queue.afterCount !== 3 || ledger.queue.unfinishedBeforeCount !== 2 || ledger.queue.unfinishedAfterCount !== 0 ||
    ledger.authorization.owner !== incident.owner || ledger.authorization.reason !== incident.reason || ledger.authorization.source !== incident.authorizationSource ||
    (ledger.safeOffEvidence.source === "external_guarded_leimac_safe_off" && (
      ledger.safeOffEvidence.controllerIdentity !== incident.safeOffController.identity ||
      ledger.safeOffEvidence.controllerHost !== incident.safeOffController.host ||
      ledger.safeOffEvidence.controllerPort !== incident.safeOffController.port
    )) ||
    ledger.removedEntries.length !== 2 || !sameJson(ledger.removedEntries.map(targetIdentity), incident.targetItems.map(targetIdentity)) ||
    ledger.removedEntries.some((entry, index) => {
      const expected = incident.targetItems[index]?.evidence;
      return !expected || entry.manifestSha256 !== expected.manifestSha256 || entry.reportBundleSha256 !== expected.reportBundleSha256 ||
        entry.productionReleaseSha256 !== expected.productionReleaseSha256 || entry.findingValidation.status !== "invalid" ||
        entry.findingValidation.sourceCandidateCount !== 16 || entry.findingValidation.publishedFindingCount !== 0 ||
        entry.findingValidation.issueCount !== 32 || entry.findingValidation.defectFindingsRepresentation !== expected.defectFindingsRepresentation ||
        entry.publication.storageUpload !== "pending_not_uploaded" || entry.publication.cardLinkage !== "not_linked";
    }) ||
    ledger.retainedTerminalEntries.length !== 3 || ledger.retainedTerminalEntries.some((entry) => entry.state !== "failed") ||
    ledger.preservation.referencedFilesRemainInPlace !== true || ledger.preservation.reportManifestArtifactDeletionPerformed !== false ||
    ledger.preservation.reportBytesRewritten !== false || ledger.preservation.terminalEntryPayloadsUnchanged !== true
  ) throw new Error("Immutable stale-review archive does not match the exact fixed incident authority.");
}

function verifyArchivePointer(
  pointerPath: string,
  queuePath: string,
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
): { pointer: ArchivePointerV1; pointerSha256: string; verified: ReturnType<typeof verifyArchive> } {
  const pointerBytes = readFileSync(pointerPath);
  const pointer = parseCanonical<ArchivePointerV1>(pointerBytes, "Rapid queue archive pointer");
  if (
    pointer.schemaVersion !== POINTER_SCHEMA || pointer.incidentId !== incident.incidentId ||
    pointer.beforeQueueSha256 !== incident.expectedBeforeQueueSha256 || pointer.removedItems.length !== 2 ||
    !sameJson(pointer.removedItems, incident.targetItems.map(targetIdentity)) || !SHA256.test(pointer.archiveId) || !SHA256.test(pointer.afterQueueSha256)
  ) throw new Error("Rapid queue archive pointer is not the exact fixed incident authority.");
  const verified = verifyArchive(pointer.archiveDir);
  assertVerifiedArchiveMatchesIncident(verified, incident);
  const currentQueue = queueObject(readFileSync(queuePath));
  for (const item of currentQueue.items) {
    if (
      !isRecord(item) || typeof item.queueItemId !== "string" || typeof item.sessionId !== "string" ||
      typeof item.reportId !== "string" || typeof item.state !== "string"
    ) throw new Error("Active Rapid queue contains a malformed item after the archive transaction.");
    if (incident.targetItems.some((target) =>
      item.queueItemId === target.queueItemId ||
      (item.sessionId === target.sessionId && item.reportId === target.reportId)
    )) throw new Error("An owner-removed stale review identity was reintroduced into the active Rapid queue.");
  }
  if (
    pointer.archiveId !== verified.archiveId || pointer.afterQueueSha256 !== verified.ledger.queue.afterSha256 ||
    !sameJson(pointer, archivePointer(verified, pointer.archiveDir))
  ) throw new Error("Rapid queue archive pointer, active queue, and immutable archive do not agree exactly.");
  return { pointer, pointerSha256: sha256(pointerBytes), verified };
}

function archivedTriples(
  outputDir: string,
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
): Set<string> {
  const queuePath = path.join(outputDir, "rapid-capture-queue.json");
  const pointerPath = archivePointerPath(outputDir);
  if (!existsSync(pointerPath)) return new Set();
  const { pointer } = verifyArchivePointer(pointerPath, queuePath, incident);
  return new Set(pointer.removedItems.map((entry) => `${entry.queueItemId}|${entry.sessionId}|${entry.reportId}`));
}

export function archivedRapidCaptureQueueTriplesForMaintenanceV1(outputDir: string): Set<string> {
  return archivedTriples(outputDir, STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722);
}

/** Test seam only: runtime maintenance always uses the fixed production incident above. */
export function archivedRapidCaptureQueueTriplesForTestV1(
  outputDir: string,
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
): Set<string> {
  return archivedTriples(outputDir, incident);
}

function archiveCandidates(archiveRoot: string, incidentId: string): string[] {
  if (!existsSync(archiveRoot)) return [];
  const candidates: string[] = [];
  for (const entry of readdirSync(archiveRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SHA256.test(entry.name)) continue;
    const candidate = path.join(archiveRoot, entry.name);
    const verified = verifyArchive(candidate);
    if (verified.ledger.incidentId === incidentId) candidates.push(candidate);
  }
  return candidates;
}

function resultFromArchive(
  verified: ReturnType<typeof verifyArchive>,
  archiveDir: string,
  pointerPath: string,
  pointerSha256: string,
  idempotent: boolean,
): StaleInvalidRapidCaptureQueueArchivalResultV1 {
  return {
    incidentId: verified.ledger.incidentId,
    idempotent,
    archiveId: verified.archiveId,
    archiveDir,
    receiptPath: path.join(archiveDir, "receipt.json"),
    receiptSha256: verified.receiptSha256,
    archivePointerPath: pointerPath,
    archivePointerSha256: pointerSha256,
    beforeQueueSha256: verified.ledger.queue.beforeSha256,
    afterQueueSha256: verified.ledger.queue.afterSha256,
    beforeCount: verified.ledger.queue.beforeCount,
    removedCount: 2,
    afterCount: verified.ledger.queue.afterCount,
    unfinishedAfterCount: 0,
    referencedEvidenceCount: verified.ledger.referencedEvidence.length,
  };
}

function journalPaths(queuePath: string) {
  return {
    stagePath: `${queuePath}.owner-removal-v1.stage`,
    backupPath: `${queuePath}.owner-removal-v1.backup`,
    quarantinePath: `${queuePath}.owner-removal-v1.quarantine`,
    journalPath: `${queuePath}.owner-removal-v1.journal.json`,
    pointerPath: archivePointerPath(path.dirname(queuePath)),
    pointerStagePath: `${queuePath}.owner-removal-v1.pointer.stage`,
    pointerQuarantinePath: `${queuePath}.owner-removal-v1.pointer.quarantine`,
  };
}

function authenticateJournal(journalPath: string, incident: StaleInvalidRapidCaptureQueueIncidentV1): TransactionJournalV1 {
  const journal = parseCanonical<TransactionJournalV1>(readFileSync(journalPath), "Queue archival journal");
  if (
    !exactKeys(journal, ["schemaVersion", "incidentId", "archiveId", "expectedBeforeQueueSha256", "expectedAfterQueueSha256", "queuePath", "stagePath", "backupPath", "pointerPath", "pointerStagePath", "expectedPointerSha256", "archiveDir"]) ||
    journal.schemaVersion !== JOURNAL_SCHEMA || journal.incidentId !== incident.incidentId ||
    journal.expectedBeforeQueueSha256 !== incident.expectedBeforeQueueSha256 || !SHA256.test(journal.expectedAfterQueueSha256) ||
    !SHA256.test(journal.expectedPointerSha256) || !SHA256.test(journal.archiveId) ||
    journal.pointerPath !== archivePointerPath(path.dirname(journal.queuePath)) || journal.pointerStagePath !== `${journal.queuePath}.owner-removal-v1.pointer.stage`
  ) throw new Error("Queue archival journal is not the exact authenticated fixed incident.");
  return journal;
}

function restoreOriginal(
  queuePath: string,
  backupPath: string,
  stagePath: string,
  quarantinePath: string,
  pointerPath: string,
  pointerStagePath: string,
  pointerQuarantinePath: string,
  journalPath: string,
  expectedBeforeQueueSha256: string,
): never {
  if (!existsSync(backupPath) || sha256(readFileSync(backupPath)) !== expectedBeforeQueueSha256) {
    throw new Error("Rollback cannot authenticate the exact original queue backup; all transaction files remain preserved.");
  }
  if (existsSync(queuePath)) {
    if (existsSync(quarantinePath)) throw new Error("Rollback refuses to overwrite an existing queue quarantine; live and backup remain preserved.");
    renameSync(queuePath, quarantinePath);
  } else if (existsSync(stagePath)) {
    if (existsSync(quarantinePath)) throw new Error("Rollback refuses to overwrite an existing queue quarantine; stage and backup remain preserved.");
    renameSync(stagePath, quarantinePath);
  }
  renameSync(backupPath, queuePath);
  if (sha256(readFileSync(queuePath)) !== expectedBeforeQueueSha256) throw new Error("Rollback did not reproduce the exact original queue at its canonical path.");
  if (existsSync(pointerPath)) {
    if (existsSync(pointerQuarantinePath)) throw new Error("Rollback restored the queue but refuses to overwrite an existing pointer quarantine; both pointer files remain preserved.");
    renameSync(pointerPath, pointerQuarantinePath);
  } else if (existsSync(pointerStagePath)) {
    if (existsSync(pointerQuarantinePath)) throw new Error("Rollback restored the queue but refuses to overwrite an existing pointer quarantine; staged pointer remains preserved.");
    renameSync(pointerStagePath, pointerQuarantinePath);
  }
  rmSync(journalPath, { force: true });
  throw new Error("Queue installation failed verification; the exact original queue was restored and the failed replacement was quarantined. Retry only after review.");
}

async function execute(
  options: StaleInvalidRapidCaptureQueueArchivalOptionsV1,
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
): Promise<StaleInvalidRapidCaptureQueueArchivalResultV1> {
  const outputDir = ensureDirectory(options.outputDir, "Rapid output directory");
  const archiveRoot = ensureDirectory(options.archiveRoot, "Quarantine archive root");
  if (containedBy(archiveRoot, outputDir) || containedBy(outputDir, archiveRoot)) {
    throw new Error("Quarantine archive root and Rapid output directory must be disjoint.");
  }
  const idleStatusPath = safeAbsolute(options.idleStatusPath, "Idle status evidence path");
  if (containedBy(idleStatusPath, outputDir) || containedBy(idleStatusPath, archiveRoot)) {
    throw new Error("Idle status evidence must be outside both the Rapid output and quarantine archive roots.");
  }
  const hasExternalReceiptPath = typeof options.externalSafeOffReceiptPath === "string" && options.externalSafeOffReceiptPath.length > 0;
  const hasExternalReceiptSha = typeof options.externalSafeOffReceiptSha256 === "string" && options.externalSafeOffReceiptSha256.length > 0;
  if (hasExternalReceiptPath !== hasExternalReceiptSha) {
    throw new Error("External safe-off receipt path and SHA-256 must be supplied together.");
  }
  const externalSafeOffReceiptPath = hasExternalReceiptPath
    ? safeAbsolute(options.externalSafeOffReceiptPath!, "External safe-off receipt path")
    : undefined;
  if (externalSafeOffReceiptPath && (
    containedBy(externalSafeOffReceiptPath, outputDir) || containedBy(externalSafeOffReceiptPath, archiveRoot) ||
    externalSafeOffReceiptPath === idleStatusPath
  )) throw new Error("External safe-off receipt must be a distinct file outside the Rapid output and quarantine archive roots.");
  const queuePath = path.join(outputDir, "rapid-capture-queue.json");
  const paths = journalPaths(queuePath);
  const executedAt = exactTimestamp(options.now ?? new Date().toISOString());
  if (!existsSync(paths.journalPath)) {
    const completed = archiveCandidates(archiveRoot, incident.incidentId);
    if (completed.length > 1) throw new Error("More than one archive claims this fixed incident; no queue mutation was performed.");
    if (completed.length === 1 && existsSync(queuePath)) {
      const verified = verifyArchive(completed[0]);
      if (existsSync(paths.pointerPath)) {
        queueObject(readFileSync(queuePath));
        try {
          const pointer = verifyArchivePointer(paths.pointerPath, queuePath, incident);
          if (existsSync(paths.backupPath)) {
            if (sha256(readFileSync(paths.backupPath)) !== incident.expectedBeforeQueueSha256) {
              throw new Error("Completed transaction backup does not reproduce the exact original queue.");
            }
            rmSync(paths.backupPath);
          }
          return resultFromArchive(verified, completed[0], paths.pointerPath, pointer.pointerSha256, true);
        } catch {
          // Continue into fail-closed preflight/recovery so a changed active item cannot be masked as replay.
        }
      } else {
        const liveBytes = readFileSync(queuePath);
        assertVerifiedArchiveMatchesIncident(verified, incident);
        if (
          sha256(liveBytes) !== incident.expectedBeforeQueueSha256 ||
          verified.ledger.queue.beforeSha256 !== incident.expectedBeforeQueueSha256 ||
          !verified.beforeBytes.equals(liveBytes) ||
          existsSync(paths.stagePath) || existsSync(paths.backupPath) || existsSync(paths.pointerStagePath)
        ) {
          throw new Error("A pointerless incident archive is not a proven pre-transaction incomplete attempt; it remains preserved for review.");
        }
        rmSync(completed[0], { recursive: true });
      }
    }
  }
  const verifiedIdleStatus = verifyIdleStatus(
    idleStatusPath,
    options.idleStatusSha256,
    executedAt,
    { path: externalSafeOffReceiptPath, sha256: options.externalSafeOffReceiptSha256?.toLowerCase() },
    incident,
  );
  const idleStatusEvidence = verifiedIdleStatus.identity;
  await (options.requireHelperPortReleased ?? (() => requirePortReleased(options.helperPort ?? 47652)))();

  if (existsSync(paths.journalPath)) {
    const journal = authenticateJournal(paths.journalPath, incident);
    if (
      journal.queuePath !== queuePath || journal.stagePath !== paths.stagePath || journal.backupPath !== paths.backupPath ||
      journal.pointerPath !== paths.pointerPath || journal.pointerStagePath !== paths.pointerStagePath ||
      journal.archiveDir !== path.join(archiveRoot, journal.archiveId)
    ) throw new Error("Authenticated journal paths are not the exact fixed transaction paths.");
    const verifiedArchive = verifyArchive(journal.archiveDir);
    if (verifiedArchive.archiveId !== journal.archiveId || verifiedArchive.ledger.queue.afterSha256 !== journal.expectedAfterQueueSha256) {
      throw new Error("Authenticated journal and immutable archive do not match.");
    }
    const expectedPointerBytes = canonicalBytes(archivePointer(verifiedArchive, journal.archiveDir));
    if (sha256(expectedPointerBytes) !== journal.expectedPointerSha256) throw new Error("Authenticated journal pointer identity does not match the immutable archive.");
    const installOrVerifyPointer = () => {
      if (!existsSync(paths.pointerPath)) {
        if (!existsSync(paths.pointerStagePath) || sha256(readFileSync(paths.pointerStagePath)) !== journal.expectedPointerSha256) {
          throw new Error("Journal recovery is missing the exact staged archive pointer.");
        }
        renameSync(paths.pointerStagePath, paths.pointerPath);
      }
      const pointer = verifyArchivePointer(paths.pointerPath, queuePath, incident);
      if (pointer.pointerSha256 !== journal.expectedPointerSha256) throw new Error("Installed archive pointer does not match the authenticated journal.");
      return pointer;
    };
    const liveHash = existsSync(queuePath) ? sha256(readFileSync(queuePath)) : undefined;
    const backupHash = existsSync(paths.backupPath) ? sha256(readFileSync(paths.backupPath)) : undefined;
    if (liveHash === journal.expectedAfterQueueSha256 && backupHash === incident.expectedBeforeQueueSha256) {
      queueObject(readFileSync(queuePath));
      verifyArchive(journal.archiveDir);
      const pointer = installOrVerifyPointer();
      rmSync(paths.backupPath);
      rmSync(paths.journalPath);
      return resultFromArchive(verifiedArchive, journal.archiveDir, paths.pointerPath, pointer.pointerSha256, false);
    }
    if (liveHash === journal.expectedAfterQueueSha256 && backupHash === undefined) {
      queueObject(readFileSync(queuePath), journal.expectedAfterQueueSha256);
      verifyArchive(journal.archiveDir);
      const pointer = installOrVerifyPointer();
      rmSync(paths.journalPath);
      return resultFromArchive(verifiedArchive, journal.archiveDir, paths.pointerPath, pointer.pointerSha256, false);
    }
    if (!liveHash && backupHash === incident.expectedBeforeQueueSha256 && existsSync(paths.stagePath) && sha256(readFileSync(paths.stagePath)) === journal.expectedAfterQueueSha256) {
      renameSync(paths.stagePath, queuePath);
      verifyArchive(journal.archiveDir);
      const pointer = installOrVerifyPointer();
      rmSync(paths.backupPath);
      rmSync(paths.journalPath);
      return resultFromArchive(verifiedArchive, journal.archiveDir, paths.pointerPath, pointer.pointerSha256, false);
    }
    if (liveHash === incident.expectedBeforeQueueSha256 && backupHash === undefined) {
      rmSync(paths.stagePath, { force: true });
      rmSync(paths.pointerStagePath, { force: true });
      if (existsSync(paths.pointerPath)) {
        if (existsSync(paths.pointerQuarantinePath)) throw new Error("Stale rollback pointer cannot be quarantined safely; pointer and journal remain preserved.");
        renameSync(paths.pointerPath, paths.pointerQuarantinePath);
      }
      rmSync(paths.journalPath);
    } else if (backupHash === incident.expectedBeforeQueueSha256) {
      restoreOriginal(
        queuePath, paths.backupPath, paths.stagePath, paths.quarantinePath,
        paths.pointerPath, paths.pointerStagePath, paths.pointerQuarantinePath,
        paths.journalPath, incident.expectedBeforeQueueSha256,
      );
    } else {
      throw new Error("Authenticated queue transaction has no safe recognized recovery state; every file remains preserved.");
    }
  }

  const beforeBytes = readFileSync(queuePath);
  const queue = queueObject(beforeBytes, incident.expectedBeforeQueueSha256);
  if (existsSync(paths.pointerPath) || existsSync(paths.pointerStagePath)) throw new Error("A stale archive pointer exists for the unchanged queue; preserve it for review before retry.");
  if (queue.items.length !== 5) throw new Error("Fixed incident requires the exact five-entry live queue.");
  const targets = incident.targetItems.map((target) => exactTargetItem(queue, target));
  if (unfinishedItems(queue).length !== 2 || unfinishedItems(queue).some((item) => !targets.includes(item))) {
    throw new Error("Fixed incident requires exactly the two authorized unfinished queue items and no other unfinished work.");
  }
  const retained = queue.items.filter((item: JsonRecord) => !targets.includes(item));
  if (retained.length !== 3 || retained.some((item: JsonRecord) => item.state !== "failed")) {
    throw new Error("Fixed incident requires exactly three pre-existing terminal failed entries to remain active and unchanged.");
  }
  const evidence = incident.targetItems.map((target, index) => verifyTargetEvidence(targets[index], target, incident));
  const referencedEvidence = mergeReferencedEvidence(evidence.map((entry) => entry.referenced));
  const after = afterQueueBytes(queue, targets, executedAt);
  const gate = evaluateRapidCaptureQueueMaintenanceGateV1(after.queue);
  if (!gate.ready || gate.unfinishedQueueItemIds.length !== 0) throw new Error("After queue still contains unfinished work.");
  const ledger: ArchiveLedgerV1 = {
    schemaVersion: ARCHIVE_SCHEMA,
    incidentId: incident.incidentId,
    executedAt,
    authorization: { owner: incident.owner, reason: incident.reason, source: incident.authorizationSource },
    idleStatusEvidence,
    safeOffEvidence: verifiedIdleStatus.safeOffEvidence,
    queue: {
      schemaVersion: QUEUE_SCHEMA,
      beforeSha256: sha256(beforeBytes),
      beforeByteSize: beforeBytes.length,
      beforeCount: queue.items.length,
      afterSha256: sha256(after.bytes),
      afterByteSize: after.bytes.length,
      afterCount: after.queue.items.length,
      unfinishedBeforeCount: unfinishedItems(queue).length,
      unfinishedAfterCount: 0,
    },
    removedEntries: evidence.map((entry) => entry.removed),
    retainedTerminalEntries: retained.map((item: JsonRecord) => ({
      ...targetIdentity(item), state: item.state, canonicalEntrySha256: sha256(canonicalBytes(item)),
    })),
    referencedEvidence,
    preservation: {
      referencedFilesRemainInPlace: true,
      reportManifestArtifactDeletionPerformed: false,
      reportBytesRewritten: false,
      terminalEntryPayloadsUnchanged: true,
    },
  };
  const archive = createArchive(archiveRoot, ledger, beforeBytes, after.bytes, targets);
  const verifiedArchive = verifyArchive(archive.archiveDir);
  const pointerBytes = canonicalBytes(archivePointer(verifiedArchive, archive.archiveDir));
  if (options.failpoint === "after_archive") throw new Error("Injected failure after immutable archive creation.");
  const journal: TransactionJournalV1 = {
    schemaVersion: JOURNAL_SCHEMA,
    incidentId: incident.incidentId,
    archiveId: archive.archiveId,
    expectedBeforeQueueSha256: incident.expectedBeforeQueueSha256,
    expectedAfterQueueSha256: ledger.queue.afterSha256,
    queuePath,
    stagePath: paths.stagePath,
    backupPath: paths.backupPath,
    pointerPath: paths.pointerPath,
    pointerStagePath: paths.pointerStagePath,
    expectedPointerSha256: sha256(pointerBytes),
    archiveDir: archive.archiveDir,
  };
  writeExclusiveSynced(paths.stagePath, after.bytes);
  writeExclusiveSynced(paths.pointerStagePath, pointerBytes);
  writeExclusiveSynced(paths.journalPath, canonicalBytes(journal));
  if (options.failpoint === "after_journal") throw new Error("Injected failure after transaction journal creation.");
  renameSync(queuePath, paths.backupPath);
  if (options.failpoint === "after_backup_rename") throw new Error("Injected failure after original queue backup rename.");
  renameSync(paths.stagePath, queuePath);
  renameSync(paths.pointerStagePath, paths.pointerPath);
  if (options.failpoint === "after_install") throw new Error("Injected failure after replacement queue installation.");
  try {
    const installed = queueObject(readFileSync(queuePath), ledger.queue.afterSha256);
    if (installed.items.length !== 3 || !installed.items.every((item: JsonRecord, index: number) => sameJson(item, retained[index]))) {
      throw new Error("Installed queue did not preserve every retained terminal entry unchanged.");
    }
    verifyArchive(archive.archiveDir);
    verifyArchivePointer(paths.pointerPath, queuePath, incident);
  } catch {
    restoreOriginal(
      queuePath, paths.backupPath, paths.stagePath, paths.quarantinePath,
      paths.pointerPath, paths.pointerStagePath, paths.pointerQuarantinePath,
      paths.journalPath, incident.expectedBeforeQueueSha256,
    );
  }
  rmSync(paths.backupPath);
  if (options.failpoint === "after_backup_cleanup_before_journal_cleanup") {
    throw new Error("Injected failure after exact original backup cleanup and before transaction journal cleanup.");
  }
  rmSync(paths.journalPath);
  const installedPointer = verifyArchivePointer(paths.pointerPath, queuePath, incident);
  return resultFromArchive(verifyArchive(archive.archiveDir), archive.archiveDir, paths.pointerPath, installedPointer.pointerSha256, false);
}

export function archiveAuthorizedStaleInvalidRapidCaptureQueueItemsV1(
  options: StaleInvalidRapidCaptureQueueArchivalOptionsV1,
): Promise<StaleInvalidRapidCaptureQueueArchivalResultV1> {
  return execute(options, STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722);
}

/** Test seam only: the executable CLI always uses the fixed production incident above. */
export function archiveStaleInvalidRapidCaptureQueueItemsForTestV1(
  options: StaleInvalidRapidCaptureQueueArchivalOptionsV1,
  incident: StaleInvalidRapidCaptureQueueIncidentV1,
): Promise<StaleInvalidRapidCaptureQueueArchivalResultV1> {
  return execute(options, incident);
}
