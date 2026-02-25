import { createHash } from "node:crypto";
import type { NextApiRequest } from "next";
import { z } from "zod";
import {
  prisma,
  SetApprovalDecision,
  SetAuditStatus,
  SetDatasetType,
  SetIngestionJobStatus,
  SetSeedJobStatus,
  type Prisma,
} from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import type { AdminSession } from "./admin";
import { computeSetDeleteImpact, writeSetOpsAuditEvent } from "./setOps";
import { createDraftVersionPayload, extractDraftRows, normalizeDraftRows, summarizeDraftDiff } from "./setOpsDrafts";
import { runSeedJob } from "./setOpsSeed";

const REPLACE_GENERIC_LABELS = new Set([
  "insert",
  "inserts",
  "parallel",
  "parallels",
  "rookie",
  "rookies",
  "autograph",
  "autographs",
  "base",
  "veteran",
  "veterans",
]);

const SetReplaceJobStatus = {
  QUEUED: "QUEUED",
  VALIDATING_PREVIEW: "VALIDATING_PREVIEW",
  DELETING_SET: "DELETING_SET",
  CREATING_DRAFT: "CREATING_DRAFT",
  APPROVING_DRAFT: "APPROVING_DRAFT",
  SEEDING_SET: "SEEDING_SET",
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

type SetReplaceJobStatus = (typeof SetReplaceJobStatus)[keyof typeof SetReplaceJobStatus];

const REPLACE_TERMINAL_STATUSES = new Set<SetReplaceJobStatus>([
  SetReplaceJobStatus.COMPLETE,
  SetReplaceJobStatus.FAILED,
  SetReplaceJobStatus.CANCELLED,
]);

const REPLACE_ACTIVE_SEED_STATUSES = [SetSeedJobStatus.QUEUED, SetSeedJobStatus.IN_PROGRESS] as const;
const SEED_TERMINAL_STATUSES = new Set<SetSeedJobStatus>([
  SetSeedJobStatus.COMPLETE,
  SetSeedJobStatus.FAILED,
  SetSeedJobStatus.CANCELLED,
]);

const stepOrder = [
  "validate_preview",
  "delete_existing_set",
  "create_draft_version",
  "approve_draft",
  "seed_set",
] as const;

type ReplaceStepKey = (typeof stepOrder)[number];

type ReplaceStepState = {
  key: ReplaceStepKey;
  label: string;
  status: "pending" | "in_progress" | "complete" | "failed" | "cancelled";
  startedAt: string | null;
  completedAt: string | null;
  detail: string | null;
};

type ReplaceProgressState = {
  stage: SetReplaceJobStatus;
  updatedAt: string;
  steps: ReplaceStepState[];
};

const stepLabels: Record<ReplaceStepKey, string> = {
  validate_preview: "Validate preview",
  delete_existing_set: "Delete existing set data",
  create_draft_version: "Create and build draft",
  approve_draft: "Approve draft",
  seed_set: "Seed set",
};

const stageToStep: Partial<Record<SetReplaceJobStatus, ReplaceStepKey>> = {
  [SetReplaceJobStatus.VALIDATING_PREVIEW]: "validate_preview",
  [SetReplaceJobStatus.DELETING_SET]: "delete_existing_set",
  [SetReplaceJobStatus.CREATING_DRAFT]: "create_draft_version",
  [SetReplaceJobStatus.APPROVING_DRAFT]: "approve_draft",
  [SetReplaceJobStatus.SEEDING_SET]: "seed_set",
};

const replaceRunArgsSchema = z.object({
  setId: z.string().min(1),
  datasetType: z.nativeEnum(SetDatasetType),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
  previewHash: z.string().min(8),
  typedConfirmation: z.string().min(1),
  reason: z.string().trim().max(500).nullable().optional(),
});

type ReplaceJobRecord = {
  id: string;
  setId: string;
  datasetType: SetDatasetType;
  status: SetReplaceJobStatus;
  previewHash: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelRequestedAt: Date | null;
  runArgsJson: unknown;
  progressJson: unknown;
  resultJson: unknown;
  logsJson: unknown;
  ingestionJobId: string | null;
  draftId: string | null;
  draftVersionId: string | null;
  approvalId: string | null;
  seedJobId: string | null;
  activeSetLock: string | null;
};

type ReplaceJobUpdatePatch = Partial<{
  setId: string;
  datasetType: SetDatasetType;
  status: SetReplaceJobStatus;
  previewHash: string;
  runArgsJson: unknown | null;
  progressJson: unknown | null;
  resultJson: unknown | null;
  logsJson: unknown | null;
  errorMessage: string | null;
  reason: string | null;
  requestedById: string | null;
  ingestionJobId: string | null;
  draftId: string | null;
  draftVersionId: string | null;
  approvalId: string | null;
  seedJobId: string | null;
  activeSetLock: string | null;
  cancelRequestedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}>;

const replaceJobColumns = [
  "\"id\"",
  "\"setId\"",
  "\"datasetType\"",
  "\"status\"",
  "\"previewHash\"",
  "\"errorMessage\"",
  "\"createdAt\"",
  "\"updatedAt\"",
  "\"startedAt\"",
  "\"completedAt\"",
  "\"cancelRequestedAt\"",
  "\"runArgsJson\"",
  "\"progressJson\"",
  "\"resultJson\"",
  "\"logsJson\"",
  "\"ingestionJobId\"",
  "\"draftId\"",
  "\"draftVersionId\"",
  "\"approvalId\"",
  "\"seedJobId\"",
  "\"activeSetLock\"",
].join(", ");

const replaceJobJsonFields = new Set(["runArgsJson", "progressJson", "resultJson", "logsJson"]);

function buildSetIdCandidates(inputSetId: string) {
  const raw = String(inputSetId || "").trim();
  const normalized = normalizeSetLabel(raw);
  return Array.from(new Set([raw, normalized].filter(Boolean)));
}

function buildVariantKey(cardNumber: string | null, parallelId: string) {
  const normalizedCardNumber = String(cardNumber || "ALL").trim() || "ALL";
  return `${normalizedCardNumber}::${String(parallelId || "").trim()}`;
}

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function hasBlockingErrors(errors: Array<{ blocking: boolean }>) {
  return errors.some((issue) => Boolean(issue.blocking));
}

function isGenericParallelLabel(label: string) {
  const normalized = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized ? REPLACE_GENERIC_LABELS.has(normalized) : false;
}

function boolFromEnv(value: string | undefined) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return null;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
}

function toDateOrNull(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toJsonValue(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function toReplaceJobRecord(row: Record<string, unknown>): ReplaceJobRecord {
  return {
    id: String(row.id || ""),
    setId: String(row.setId || ""),
    datasetType: String(row.datasetType || SetDatasetType.PARALLEL_DB) as SetDatasetType,
    status: String(row.status || SetReplaceJobStatus.FAILED) as SetReplaceJobStatus,
    previewHash: String(row.previewHash || ""),
    errorMessage: typeof row.errorMessage === "string" ? row.errorMessage : null,
    createdAt: toDateOrNull(row.createdAt) || new Date(),
    updatedAt: toDateOrNull(row.updatedAt) || new Date(),
    startedAt: toDateOrNull(row.startedAt),
    completedAt: toDateOrNull(row.completedAt),
    cancelRequestedAt: toDateOrNull(row.cancelRequestedAt),
    runArgsJson: toJsonValue(row.runArgsJson),
    progressJson: toJsonValue(row.progressJson),
    resultJson: toJsonValue(row.resultJson),
    logsJson: toJsonValue(row.logsJson),
    ingestionJobId: typeof row.ingestionJobId === "string" ? row.ingestionJobId : null,
    draftId: typeof row.draftId === "string" ? row.draftId : null,
    draftVersionId: typeof row.draftVersionId === "string" ? row.draftVersionId : null,
    approvalId: typeof row.approvalId === "string" ? row.approvalId : null,
    seedJobId: typeof row.seedJobId === "string" ? row.seedJobId : null,
    activeSetLock: typeof row.activeSetLock === "string" ? row.activeSetLock : null,
  };
}

async function findReplaceJobById(jobId: string): Promise<ReplaceJobRecord | null> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${replaceJobColumns} FROM "SetReplaceJob" WHERE "id" = $1 LIMIT 1`,
    jobId
  );
  return rows.length > 0 ? toReplaceJobRecord(rows[0]) : null;
}

async function findActiveReplaceJobBySetLock(setLock: string): Promise<ReplaceJobRecord | null> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${replaceJobColumns}
     FROM "SetReplaceJob"
     WHERE "activeSetLock" = $1
       AND "status" NOT IN ('COMPLETE','FAILED','CANCELLED')
     ORDER BY "createdAt" DESC
     LIMIT 1`,
    setLock
  );
  return rows.length > 0 ? toReplaceJobRecord(rows[0]) : null;
}

async function listReplaceJobsByFilters(params: { setId?: string; jobId?: string; limit: number }) {
  const whereParts: string[] = [];
  const values: unknown[] = [];

  if (params.jobId) {
    values.push(params.jobId);
    whereParts.push(`\"id\" = $${values.length}`);
  }

  if (params.setId) {
    values.push(params.setId);
    whereParts.push(`\"setId\" = $${values.length}`);
  }

  values.push(params.limit);
  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  const query = `SELECT ${replaceJobColumns} FROM \"SetReplaceJob\" ${whereClause} ORDER BY \"createdAt\" DESC LIMIT $${
    values.length
  }`;

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(query, ...values);
  return rows.map(toReplaceJobRecord);
}

async function createReplaceJobRow(data: {
  setId: string;
  datasetType: SetDatasetType;
  status: SetReplaceJobStatus;
  previewHash: string;
  runArgsJson: unknown | null;
  progressJson: unknown | null;
  logsJson: unknown | null;
  reason: string | null;
  requestedById: string | null;
  activeSetLock: string | null;
}) {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `INSERT INTO "SetReplaceJob" (
      "setId",
      "datasetType",
      "status",
      "previewHash",
      "runArgsJson",
      "progressJson",
      "logsJson",
      "reason",
      "requestedById",
      "activeSetLock",
      "createdAt",
      "updatedAt"
    ) VALUES (
      $1,
      $2::\"SetDatasetType\",
      $3::\"SetReplaceJobStatus\",
      $4,
      $5::jsonb,
      $6::jsonb,
      $7::jsonb,
      $8,
      $9,
      $10,
      NOW(),
      NOW()
    )
    RETURNING ${replaceJobColumns}`,
    data.setId,
    data.datasetType,
    data.status,
    data.previewHash,
    data.runArgsJson == null ? null : JSON.stringify(data.runArgsJson),
    data.progressJson == null ? null : JSON.stringify(data.progressJson),
    data.logsJson == null ? null : JSON.stringify(data.logsJson),
    data.reason,
    data.requestedById,
    data.activeSetLock
  );

  if (rows.length < 1) {
    throw new Error("Failed to create replace job");
  }
  return toReplaceJobRecord(rows[0]);
}

async function updateReplaceJobRow(jobId: string, patch: ReplaceJobUpdatePatch) {
  const updates = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (updates.length < 1) {
    const existing = await findReplaceJobById(jobId);
    if (!existing) throw new Error("Replace job not found");
    return existing;
  }

  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [field, rawValue] of updates) {
    const value = replaceJobJsonFields.has(field) && rawValue != null ? JSON.stringify(rawValue) : rawValue;
    values.push(value);
    const cast = replaceJobJsonFields.has(field)
      ? "::jsonb"
      : field === "status"
        ? "::\"SetReplaceJobStatus\""
        : field === "datasetType"
          ? "::\"SetDatasetType\""
          : "";
    assignments.push(`\"${field}\" = $${values.length}${cast}`);
  }

  values.push(jobId);
  const query = `UPDATE \"SetReplaceJob\"
    SET ${assignments.join(", ")}, \"updatedAt\" = NOW()
    WHERE \"id\" = $${values.length}
    RETURNING ${replaceJobColumns}`;

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(query, ...values);
  if (rows.length < 1) {
    throw new Error("Replace job not found");
  }
  return toReplaceJobRecord(rows[0]);
}

function emptyProgress(stage: SetReplaceJobStatus): ReplaceProgressState {
  return {
    stage,
    updatedAt: new Date().toISOString(),
    steps: stepOrder.map((key) => ({
      key,
      label: stepLabels[key],
      status: "pending",
      startedAt: null,
      completedAt: null,
      detail: null,
    })),
  };
}

function parseProgress(value: unknown, fallbackStage: SetReplaceJobStatus): ReplaceProgressState {
  const parsed = toObject(value);
  if (!parsed) return emptyProgress(fallbackStage);
  const stageValue = String(parsed.stage || "").trim().toUpperCase();
  const stage = stageValue in SetReplaceJobStatus ? (stageValue as SetReplaceJobStatus) : fallbackStage;
  const stepsRaw = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps = stepOrder.map((key) => {
    const source = stepsRaw.find((entry) => toObject(entry)?.key === key);
    const sourceObj = toObject(source);
    const status = String(sourceObj?.status || "").toLowerCase();
    const safeStatus: ReplaceStepState["status"] =
      status === "in_progress" || status === "complete" || status === "failed" || status === "cancelled"
        ? (status as ReplaceStepState["status"])
        : "pending";
    return {
      key,
      label: stepLabels[key],
      status: safeStatus,
      startedAt: typeof sourceObj?.startedAt === "string" ? sourceObj.startedAt : null,
      completedAt: typeof sourceObj?.completedAt === "string" ? sourceObj.completedAt : null,
      detail: typeof sourceObj?.detail === "string" ? sourceObj.detail : null,
    };
  });
  return {
    stage,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    steps,
  };
}

function touchProgress(progress: ReplaceProgressState, stage: SetReplaceJobStatus) {
  progress.stage = stage;
  progress.updatedAt = new Date().toISOString();
}

function setStepStatus(
  progress: ReplaceProgressState,
  key: ReplaceStepKey,
  status: ReplaceStepState["status"],
  detail: string | null = null
) {
  const now = new Date().toISOString();
  const step = progress.steps.find((entry) => entry.key === key);
  if (!step) return;
  if (status === "in_progress" && !step.startedAt) {
    step.startedAt = now;
  }
  if ((status === "complete" || status === "failed" || status === "cancelled") && !step.completedAt) {
    step.completedAt = now;
  }
  step.status = status;
  step.detail = detail;
  progress.updatedAt = now;
}

function setStageInProgress(progress: ReplaceProgressState, stage: SetReplaceJobStatus) {
  touchProgress(progress, stage);
  const stepKey = stageToStep[stage];
  if (!stepKey) return;
  setStepStatus(progress, stepKey, "in_progress");
}

function setStageComplete(progress: ReplaceProgressState, stage: SetReplaceJobStatus, detail: string | null = null) {
  touchProgress(progress, stage);
  const stepKey = stageToStep[stage];
  if (!stepKey) return;
  setStepStatus(progress, stepKey, "complete", detail);
}

function setStageFailed(progress: ReplaceProgressState, stage: SetReplaceJobStatus, detail: string | null = null) {
  touchProgress(progress, SetReplaceJobStatus.FAILED);
  const stepKey = stageToStep[stage];
  if (!stepKey) return;
  setStepStatus(progress, stepKey, "failed", detail);
}

function setStageCancelled(progress: ReplaceProgressState, stage: SetReplaceJobStatus, detail: string | null = null) {
  touchProgress(progress, SetReplaceJobStatus.CANCELLED);
  const stepKey = stageToStep[stage];
  if (!stepKey) return;
  setStepStatus(progress, stepKey, "cancelled", detail);
}

function sanitizeRunArgs(value: unknown): Record<string, unknown> | null {
  const raw = toObject(value);
  if (!raw) return null;
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const { rows: _rows, typedConfirmation: _typed, ...rest } = raw;
  return {
    ...rest,
    rowCount: rows.length,
  };
}

export function isSetOpsReplaceWizardEnabled() {
  const explicit = boolFromEnv(process.env.SET_OPS_REPLACE_WIZARD);
  if (explicit != null) return explicit;

  const publicValue = boolFromEnv(process.env.NEXT_PUBLIC_SET_OPS_REPLACE_WIZARD);
  if (publicValue != null) return publicValue;

  return process.env.NODE_ENV !== "production";
}

export function buildSetReplaceConfirmationPhrase(setId: string) {
  return `REPLACE ${normalizeSetLabel(setId)}`;
}

export function isSetReplaceConfirmationValid(setId: string, typed: string) {
  return String(typed || "").trim() === buildSetReplaceConfirmationPhrase(setId);
}

export type SetReplacePreviewRow = {
  index: number;
  cardNumber: string | null;
  parallel: string;
  playerSeed: string;
  blockingErrorCount: number;
  warningCount: number;
};

export type SetReplacePreview = {
  setId: string;
  datasetType: SetDatasetType;
  summary: {
    rowCount: number;
    errorCount: number;
    blockingErrorCount: number;
    acceptedRowCount: number;
  };
  diff: {
    existingCount: number;
    incomingCount: number;
    toAddCount: number;
    toRemoveCount: number;
    unchangedCount: number;
  };
  labels: {
    uniqueParallelLabels: string[];
    suspiciousParallelLabels: string[];
  };
  keys: {
    toAdd: string[];
    toRemove: string[];
  };
  rows: SetReplacePreviewRow[];
  sampleRows: SetReplacePreviewRow[];
  previewHash: string;
};

type PreparedSetReplace = {
  setId: string;
  setIdCandidates: string[];
  datasetType: SetDatasetType;
  normalizedRows: ReturnType<typeof normalizeDraftRows>["rows"];
  versionPayload: ReturnType<typeof createDraftVersionPayload>;
  preview: SetReplacePreview;
};

export type SetReplaceJobView = {
  id: string;
  setId: string;
  datasetType: SetDatasetType;
  status: SetReplaceJobStatus;
  previewHash: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  runArgs: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  logs: string[];
  ingestionJobId: string | null;
  draftId: string | null;
  draftVersionId: string | null;
  approvalId: string | null;
  seedJobId: string | null;
};

export function isSetReplaceJobTerminal(status: SetReplaceJobStatus) {
  return REPLACE_TERMINAL_STATUSES.has(status);
}

export function serializeSetReplaceJob(job: ReplaceJobRecord): SetReplaceJobView {
  return {
    id: job.id,
    setId: job.setId,
    datasetType: job.datasetType,
    status: job.status,
    previewHash: job.previewHash,
    errorMessage: job.errorMessage ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: toIso(job.startedAt),
    completedAt: toIso(job.completedAt),
    cancelRequestedAt: toIso(job.cancelRequestedAt),
    runArgs: sanitizeRunArgs(job.runArgsJson),
    progress: toObject(job.progressJson),
    result: toObject(job.resultJson),
    logs: toStringArray(job.logsJson),
    ingestionJobId: job.ingestionJobId ?? null,
    draftId: job.draftId ?? null,
    draftVersionId: job.draftVersionId ?? null,
    approvalId: job.approvalId ?? null,
    seedJobId: job.seedJobId ?? null,
  };
}

export async function prepareSetReplacePreview(params: {
  setId: string;
  datasetType: SetDatasetType;
  rows: Array<Record<string, unknown>>;
}): Promise<PreparedSetReplace> {
  const rawSetId = String(params.setId || "").trim();
  const normalizedSetId = normalizeSetLabel(rawSetId);
  if (!normalizedSetId) {
    throw new Error("setId is required");
  }

  const setIdCandidates = buildSetIdCandidates(rawSetId);
  const normalized = normalizeDraftRows({
    datasetType: params.datasetType,
    fallbackSetId: normalizedSetId,
    rawPayload: params.rows,
  });

  const acceptedRows = normalized.rows.filter((row) => !hasBlockingErrors(row.errors) && Boolean(row.parallel));

  const existingVariants = await prisma.cardVariant.findMany({
    where: {
      setId: {
        in: setIdCandidates,
      },
    },
    select: {
      cardNumber: true,
      parallelId: true,
    },
  });

  const existingKeySet = new Set(existingVariants.map((row) => buildVariantKey(row.cardNumber, row.parallelId)));
  const incomingKeySet = new Set(acceptedRows.map((row) => buildVariantKey(row.cardNumber, row.parallel)));

  const toAdd = Array.from(incomingKeySet).filter((key) => !existingKeySet.has(key)).sort((a, b) => a.localeCompare(b));
  const toRemove = Array.from(existingKeySet).filter((key) => !incomingKeySet.has(key)).sort((a, b) => a.localeCompare(b));
  const unchangedCount = Array.from(incomingKeySet).filter((key) => existingKeySet.has(key)).length;

  const uniqueParallelLabels = Array.from(new Set(acceptedRows.map((row) => row.parallel).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  const suspiciousParallelLabels = uniqueParallelLabels.filter((label) => isGenericParallelLabel(label));

  const versionPayload = createDraftVersionPayload({
    setId: normalizedSetId,
    datasetType: params.datasetType,
    rows: normalized.rows,
  });

  const existingDigest = sha256(Array.from(existingKeySet).sort((a, b) => a.localeCompare(b)).join("\n"));
  const previewHash = sha256(
    JSON.stringify({
      setId: normalizedSetId,
      datasetType: params.datasetType,
      versionHash: versionPayload.versionHash,
      existingDigest,
      acceptedRowCount: acceptedRows.length,
    })
  );

  const previewRows = normalized.rows.map((row) => ({
    index: row.index,
    cardNumber: row.cardNumber,
    parallel: row.parallel,
    playerSeed: row.playerSeed,
    blockingErrorCount: row.errors.filter((issue) => issue.blocking).length,
    warningCount: row.warnings.length,
  }));

  return {
    setId: normalizedSetId,
    setIdCandidates,
    datasetType: params.datasetType,
    normalizedRows: normalized.rows,
    versionPayload,
    preview: {
      setId: normalizedSetId,
      datasetType: params.datasetType,
      summary: {
        rowCount: normalized.summary.rowCount,
        errorCount: normalized.summary.errorCount,
        blockingErrorCount: normalized.summary.blockingErrorCount,
        acceptedRowCount: acceptedRows.length,
      },
      diff: {
        existingCount: existingKeySet.size,
        incomingCount: incomingKeySet.size,
        toAddCount: toAdd.length,
        toRemoveCount: toRemove.length,
        unchangedCount,
      },
      labels: {
        uniqueParallelLabels,
        suspiciousParallelLabels,
      },
      keys: {
        toAdd: toAdd.slice(0, 100),
        toRemove: toRemove.slice(0, 100),
      },
      rows: previewRows,
      sampleRows: previewRows.slice(0, 100),
      previewHash,
    },
  };
}

function mapNormalizedRowsToRawPayload(rows: PreparedSetReplace["normalizedRows"]) {
  return rows.map((row) => ({
    index: row.index,
    setId: row.setId,
    cardNumber: row.cardNumber,
    parallel: row.parallel,
    playerSeed: row.playerSeed,
    listingId: row.listingId,
    sourceUrl: row.sourceUrl,
    duplicateKey: row.duplicateKey,
    errors: row.errors,
    warnings: row.warnings,
    raw: row.raw,
  }));
}

async function loadReplaceJob(jobId: string) {
  return findReplaceJobById(jobId);
}

function buildRunArgs(params: {
  setId: string;
  datasetType: SetDatasetType;
  rows: Array<Record<string, unknown>>;
  previewHash: string;
  typedConfirmation: string;
  reason?: string | null;
}) {
  return {
    setId: String(params.setId || "").trim(),
    datasetType: params.datasetType,
    rows: params.rows,
    previewHash: String(params.previewHash || "").trim(),
    typedConfirmation: String(params.typedConfirmation || ""),
    reason: params.reason?.trim() || null,
  };
}

function parseRunArgs(value: unknown) {
  return replaceRunArgsSchema.parse(value);
}

class SetReplaceCancelledError extends Error {
  constructor(message = "Replace job cancelled") {
    super(message);
    this.name = "SetReplaceCancelledError";
  }
}

async function refreshCancelFlag(jobId: string) {
  const row = await findReplaceJobById(jobId);

  if (!row) {
    throw new Error("Replace job no longer exists");
  }

  if (row.status === SetReplaceJobStatus.CANCELLED || row.cancelRequestedAt) {
    throw new SetReplaceCancelledError();
  }
}

async function cancelLinkedSeedJob(seedJobId: string | null) {
  if (!seedJobId) return;

  const existing = await prisma.setSeedJob.findUnique({
    where: { id: seedJobId },
    select: { status: true },
  });

  if (!existing) return;
  if (SEED_TERMINAL_STATUSES.has(existing.status)) {
    return;
  }

  await prisma.setSeedJob.update({
    where: { id: seedJobId },
    data: {
      status: SetSeedJobStatus.CANCELLED,
      cancelRequestedAt: new Date(),
      completedAt: existing.status === SetSeedJobStatus.QUEUED ? new Date() : undefined,
    },
  });
}

export async function findActiveSetReplaceJob(setId: string) {
  const normalizedSetId = normalizeSetLabel(setId);
  if (!normalizedSetId) return null;

  const job = await findActiveReplaceJobBySetLock(normalizedSetId);

  return job ? serializeSetReplaceJob(job) : null;
}

export async function ensureNoActiveSetReplaceJob(setId: string) {
  const active = await findActiveSetReplaceJob(setId);
  if (!active) return null;

  throw new Error(`Set replace job ${active.id} is currently ${active.status}. Wait for it to finish or cancel it.`);
}

export async function createSetReplaceJob(params: {
  req: NextApiRequest;
  admin: AdminSession;
  setId: string;
  datasetType: SetDatasetType;
  rows: Array<Record<string, unknown>>;
  previewHash: string;
  typedConfirmation: string;
  reason?: string | null;
}) {
  const runArgs = buildRunArgs(params);
  const parsed = parseRunArgs(runArgs);
  const normalizedSetId = normalizeSetLabel(parsed.setId);
  if (!normalizedSetId) {
    throw new Error("setId is required");
  }
  const setIdCandidates = buildSetIdCandidates(parsed.setId);

  if (!isSetReplaceConfirmationValid(normalizedSetId, parsed.typedConfirmation)) {
    throw new Error(`Typed confirmation must exactly match: ${buildSetReplaceConfirmationPhrase(normalizedSetId)}`);
  }

  await ensureNoActiveSetReplaceJob(normalizedSetId);

  const activeSeedJobCount = await prisma.setSeedJob.count({
    where: {
      status: {
        in: [...REPLACE_ACTIVE_SEED_STATUSES],
      },
      draft: {
        setId: {
          in: setIdCandidates,
        },
      },
    },
  });

  if (activeSeedJobCount > 0) {
    throw new Error(`Cannot replace while ${activeSeedJobCount} seed job(s) are active for this set.`);
  }

  const progress = emptyProgress(SetReplaceJobStatus.QUEUED);
  const logs = [`replace:queued set=${normalizedSetId} datasetType=${parsed.datasetType}`];

  try {
    const created = await createReplaceJobRow({
      setId: normalizedSetId,
      datasetType: parsed.datasetType,
      status: SetReplaceJobStatus.QUEUED,
      previewHash: parsed.previewHash,
      runArgsJson: runArgs,
      progressJson: progress,
      logsJson: logs,
      reason: parsed.reason || null,
      requestedById: params.admin.user.id,
      activeSetLock: normalizedSetId,
    });

    await writeSetOpsAuditEvent({
      req: params.req,
      admin: params.admin,
      action: "set_ops.replace.started",
      status: SetAuditStatus.SUCCESS,
      setId: normalizedSetId,
      reason: parsed.reason || null,
      metadata: {
        datasetType: parsed.datasetType,
        previewHash: parsed.previewHash,
        rowCount: parsed.rows.length,
        replaceJobId: created.id,
      },
    });

    return serializeSetReplaceJob(created);
  } catch (error) {
    const dbError = error as { code?: string; constraint?: string };
    if (dbError?.code === "23505" && String(dbError?.constraint || "").includes("SetReplaceJob_activeSetLock_key")) {
      throw new Error("Another replace job is already active for this set.");
    }
    throw error;
  }
}

export async function listSetReplaceJobs(params: { setId?: string; jobId?: string; limit?: number }) {
  const limit = Math.min(200, Math.max(1, params.limit ?? 20));
  const setId = normalizeSetLabel(params.setId || "");

  const jobs = await listReplaceJobsByFilters({
    setId: setId || undefined,
    jobId: params.jobId,
    limit,
  });

  return jobs.map(serializeSetReplaceJob);
}

export async function requestSetReplaceCancel(params: {
  req: NextApiRequest;
  admin: AdminSession;
  jobId: string;
  reason?: string | null;
}) {
  const existing = await loadReplaceJob(params.jobId);
  if (!existing) {
    throw new Error("Replace job not found");
  }

  if (isSetReplaceJobTerminal(existing.status)) {
    return serializeSetReplaceJob(existing);
  }

  const progress = parseProgress(existing.progressJson, existing.status);
  const stage = existing.status;

  if (stageToStep[stage]) {
    setStageCancelled(progress, stage, "Cancel requested by operator");
  }

  let nextStatus = existing.status;
  let completedAt: Date | null = null;
  let activeSetLock: string | null = existing.activeSetLock;

  if (existing.status === SetReplaceJobStatus.QUEUED) {
    nextStatus = SetReplaceJobStatus.CANCELLED;
    completedAt = new Date();
    activeSetLock = null;
  }

  await cancelLinkedSeedJob(existing.seedJobId);

  const logs = [...toStringArray(existing.logsJson), `replace:cancel_requested at=${new Date().toISOString()}`];

  const updated = await updateReplaceJobRow(existing.id, {
    status: nextStatus,
    cancelRequestedAt: new Date(),
    completedAt,
    activeSetLock,
    progressJson: progress,
    logsJson: logs,
    errorMessage: nextStatus === SetReplaceJobStatus.CANCELLED ? "cancel_requested" : existing.errorMessage,
  });

  await writeSetOpsAuditEvent({
    req: params.req,
    admin: params.admin,
    action: "set_ops.replace.cancel",
    status: SetAuditStatus.SUCCESS,
    setId: existing.setId,
    reason: params.reason || "cancel_requested",
    metadata: {
      replaceJobId: existing.id,
      status: updated.status,
      seedJobId: existing.seedJobId,
    },
  });

  return serializeSetReplaceJob(updated);
}

export async function runSetReplaceJob(params: {
  req: NextApiRequest;
  admin: AdminSession;
  jobId: string;
}) {
  const initialRecord = await loadReplaceJob(params.jobId);
  if (!initialRecord) {
    throw new Error("Replace job not found");
  }

  if (isSetReplaceJobTerminal(initialRecord.status)) {
    return serializeSetReplaceJob(initialRecord);
  }

  let record: ReplaceJobRecord = initialRecord;

  const runArgs = parseRunArgs(record.runArgsJson);
  const logs = toStringArray(record.logsJson);
  const progress = parseProgress(record.progressJson, record.status);

  let currentStage: SetReplaceJobStatus = SetReplaceJobStatus.VALIDATING_PREVIEW;
  let ingestionJobId = record.ingestionJobId;
  let draftId = record.draftId;
  let draftVersionId = record.draftVersionId;
  let approvalId = record.approvalId;
  let seedJobId = record.seedJobId;
  let deleteImpact: Awaited<ReturnType<typeof computeSetDeleteImpact>> | null = null;
  let prepared: PreparedSetReplace | null = null;
  let seedSummary: Awaited<ReturnType<typeof runSeedJob>> | null = null;

  const persist = async (data: ReplaceJobUpdatePatch = {}) => {
    record = await updateReplaceJobRow(params.jobId, data);
    return record;
  };

  const startStage = async (stage: SetReplaceJobStatus, logMessage: string) => {
    currentStage = stage;
    setStageInProgress(progress, stage);
    logs.push(logMessage);
    await persist({
      status: stage,
      startedAt: record.startedAt ?? new Date(),
      progressJson: progress as Prisma.InputJsonValue,
      logsJson: logs as Prisma.InputJsonValue,
    });
  };

  try {
    await refreshCancelFlag(params.jobId);

    await startStage(SetReplaceJobStatus.VALIDATING_PREVIEW, `replace:validate:start set=${runArgs.setId}`);

    prepared = await prepareSetReplacePreview({
      setId: runArgs.setId,
      datasetType: runArgs.datasetType,
      rows: runArgs.rows,
    });

    if (prepared.preview.previewHash !== runArgs.previewHash) {
      throw new Error("Preview is stale. Refresh preview before running replace.");
    }

    if (!isSetReplaceConfirmationValid(prepared.setId, runArgs.typedConfirmation)) {
      throw new Error(`Typed confirmation must exactly match: ${buildSetReplaceConfirmationPhrase(prepared.setId)}`);
    }

    if (prepared.preview.summary.blockingErrorCount > 0) {
      throw new Error(`Cannot replace while blocking errors exist (${prepared.preview.summary.blockingErrorCount}).`);
    }

    if (prepared.preview.summary.acceptedRowCount < 1) {
      throw new Error("No accepted rows available to seed after replace.");
    }

    setStageComplete(progress, SetReplaceJobStatus.VALIDATING_PREVIEW, "Preview hash and validations verified");
    await persist({
      progressJson: progress as Prisma.InputJsonValue,
      logsJson: logs as Prisma.InputJsonValue,
    });

    await refreshCancelFlag(params.jobId);

    await startStage(SetReplaceJobStatus.DELETING_SET, "replace:delete:start");

    deleteImpact = await computeSetDeleteImpact(prisma, runArgs.setId);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.cardVariantReferenceImage.deleteMany({
        where: {
          setId: {
            in: prepared!.setIdCandidates,
          },
        },
      });

      await tx.cardVariant.deleteMany({
        where: {
          setId: {
            in: prepared!.setIdCandidates,
          },
        },
      });

      await tx.setDraft.deleteMany({
        where: {
          setId: {
            in: prepared!.setIdCandidates,
          },
        },
      });
    });

    logs.push("replace:delete:complete");
    setStageComplete(progress, SetReplaceJobStatus.DELETING_SET, "Deleted existing set-scoped rows");

    await persist({
      progressJson: progress as Prisma.InputJsonValue,
      logsJson: logs as Prisma.InputJsonValue,
      resultJson: {
        deleteImpact,
      } as Prisma.InputJsonValue,
    });

    await writeSetOpsAuditEvent({
      req: params.req,
      admin: params.admin,
      action: "set_ops.replace.delete_complete",
      status: SetAuditStatus.SUCCESS,
      setId: prepared.setId,
      reason: runArgs.reason || null,
      metadata: {
        replaceJobId: params.jobId,
        deleteImpact,
      },
    });

    await refreshCancelFlag(params.jobId);

    await startStage(SetReplaceJobStatus.CREATING_DRAFT, "replace:draft:create:start");

    const draft = await prisma.setDraft.upsert({
      where: { setId: prepared.setId },
      update: {
        normalizedLabel: prepared.setId,
        status: "REVIEW_REQUIRED",
      },
      create: {
        setId: prepared.setId,
        normalizedLabel: prepared.setId,
        status: "REVIEW_REQUIRED",
        createdById: params.admin.user.id,
      },
      select: { id: true },
    });
    draftId = draft.id;

    const ingestionJob = await prisma.setIngestionJob.create({
      data: {
        setId: prepared.setId,
        draftId: draft.id,
        datasetType: prepared.datasetType,
        sourceUrl: null,
        rawPayload: mapNormalizedRowsToRawPayload(prepared.normalizedRows) as Prisma.InputJsonValue,
        parserVersion: "replace-wizard-v2",
        status: SetIngestionJobStatus.REVIEW_REQUIRED,
        parseSummaryJson: {
          sourceProvider: "REPLACE_WIZARD",
          rowCount: prepared.preview.summary.rowCount,
          errorCount: prepared.preview.summary.errorCount,
          blockingErrorCount: prepared.preview.summary.blockingErrorCount,
          previewHash: prepared.preview.previewHash,
        } as Prisma.InputJsonValue,
        createdById: params.admin.user.id,
        parsedAt: new Date(),
        reviewedAt: new Date(),
      },
      select: { id: true },
    });
    ingestionJobId = ingestionJob.id;

    const version = await prisma.setDraftVersion.create({
      data: {
        draftId: draft.id,
        version: 1,
        versionHash: prepared.versionPayload.versionHash,
        dataJson: prepared.versionPayload.dataJson as Prisma.InputJsonValue,
        validationJson: prepared.versionPayload.validationJson as Prisma.InputJsonValue,
        sourceLinksJson: {
          ingestionJobId: ingestionJob.id,
          source: "replace-wizard",
        } as Prisma.InputJsonValue,
        rowCount: prepared.versionPayload.rowCount,
        errorCount: prepared.versionPayload.errorCount,
        blockingErrorCount: prepared.versionPayload.blockingErrorCount,
        createdById: params.admin.user.id,
      },
      select: {
        id: true,
        dataJson: true,
      },
    });
    draftVersionId = version.id;

    logs.push("replace:draft:create:complete");
    setStageComplete(progress, SetReplaceJobStatus.CREATING_DRAFT, `Draft version ${version.id} created`);

    await persist({
      draftId,
      ingestionJobId,
      draftVersionId,
      progressJson: progress as Prisma.InputJsonValue,
      logsJson: logs as Prisma.InputJsonValue,
    });

    await refreshCancelFlag(params.jobId);

    await startStage(SetReplaceJobStatus.APPROVING_DRAFT, "replace:approval:start");

    const diffSummary = summarizeDraftDiff([], extractDraftRows(version.dataJson));

    const approval = await prisma.setApproval.create({
      data: {
        draftId: draft.id,
        draftVersionId: version.id,
        decision: SetApprovalDecision.APPROVED,
        reason: runArgs.reason?.trim() || "replace_wizard",
        diffSummaryJson: diffSummary as Prisma.InputJsonValue,
        versionHash: prepared.versionPayload.versionHash,
        approvedById: params.admin.user.id,
      },
      select: {
        id: true,
      },
    });
    approvalId = approval.id;

    await prisma.setDraft.update({
      where: { id: draft.id },
      data: {
        status: "APPROVED",
      },
    });

    await prisma.setIngestionJob.update({
      where: { id: ingestionJob.id },
      data: {
        status: SetIngestionJobStatus.APPROVED,
        reviewedAt: new Date(),
      },
    });

    logs.push("replace:approval:complete");
    setStageComplete(progress, SetReplaceJobStatus.APPROVING_DRAFT, `Approval ${approval.id} created`);

    await persist({
      approvalId,
      progressJson: progress as Prisma.InputJsonValue,
      logsJson: logs as Prisma.InputJsonValue,
    });

    await writeSetOpsAuditEvent({
      req: params.req,
      admin: params.admin,
      action: "set_ops.replace.draft_approved",
      status: SetAuditStatus.SUCCESS,
      setId: prepared.setId,
      draftId,
      draftVersionId,
      ingestionJobId,
      approvalId,
      reason: runArgs.reason || null,
      metadata: {
        replaceJobId: params.jobId,
        versionHash: prepared.versionPayload.versionHash,
      },
    });

    await refreshCancelFlag(params.jobId);

    await startStage(SetReplaceJobStatus.SEEDING_SET, "replace:seed:start");

    const seedJob = await prisma.setSeedJob.create({
      data: {
        draftId: draft.id,
        draftVersionId: version.id,
        status: SetSeedJobStatus.QUEUED,
        requestedById: params.admin.user.id,
        runArgsJson: {
          setId: prepared.setId,
          draftVersionId: version.id,
          source: "replace-wizard",
        } as Prisma.InputJsonValue,
        progressJson: {
          processed: 0,
          total: 0,
          inserted: 0,
          updated: 0,
          failed: 0,
          skipped: 0,
        } as Prisma.InputJsonValue,
        logsJson: ["seed:queued", "source:replace-wizard"] as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    seedJobId = seedJob.id;

    await persist({
      seedJobId,
      progressJson: progress as Prisma.InputJsonValue,
      logsJson: logs as Prisma.InputJsonValue,
    });

    await refreshCancelFlag(params.jobId);

    seedSummary = await runSeedJob({
      jobId: seedJob.id,
      setId: prepared.setId,
      draftDataJson: version.dataJson,
    });

    logs.push(`replace:seed:finish status=${seedSummary.status}`);

    if (seedSummary.status === SetSeedJobStatus.CANCELLED) {
      throw new SetReplaceCancelledError("Seed job was cancelled");
    }

    if (seedSummary.status !== SetSeedJobStatus.COMPLETE) {
      throw new Error(`Seed stage failed with status ${seedSummary.status}`);
    }

    setStageComplete(progress, SetReplaceJobStatus.SEEDING_SET, `Seed completed inserted=${seedSummary.inserted} updated=${seedSummary.updated}`);

    await writeSetOpsAuditEvent({
      req: params.req,
      admin: params.admin,
      action: "set_ops.replace.seed_complete",
      status: SetAuditStatus.SUCCESS,
      setId: prepared.setId,
      draftId,
      draftVersionId,
      ingestionJobId,
      approvalId,
      seedJobId,
      reason: runArgs.reason || null,
      metadata: {
        replaceJobId: params.jobId,
        seedSummary,
      },
    });

    touchProgress(progress, SetReplaceJobStatus.COMPLETE);

    logs.push("replace:complete");

    const completed = await persist({
      status: SetReplaceJobStatus.COMPLETE,
      errorMessage: null,
      completedAt: new Date(),
      activeSetLock: null,
      ingestionJobId,
      draftId,
      draftVersionId,
      approvalId,
      seedJobId,
      progressJson: progress as Prisma.InputJsonValue,
      logsJson: logs as Prisma.InputJsonValue,
      resultJson: {
        status: SetReplaceJobStatus.COMPLETE,
        deleteImpact,
        preview: prepared.preview,
        seedSummary,
      } as Prisma.InputJsonValue,
    });

    return serializeSetReplaceJob(completed);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown replace failure";
    const cancelled = error instanceof SetReplaceCancelledError;

    if (cancelled) {
      await cancelLinkedSeedJob(seedJobId);
      setStageCancelled(progress, currentStage, "Cancel requested by operator");
      logs.push("replace:cancelled");
    } else {
      setStageFailed(progress, currentStage, errorMessage);
      logs.push(`replace:failed stage=${currentStage} message=${errorMessage}`);
    }

    const failed = await persist({
      status: cancelled ? SetReplaceJobStatus.CANCELLED : SetReplaceJobStatus.FAILED,
      errorMessage: cancelled ? "cancel_requested" : errorMessage,
      completedAt: new Date(),
      activeSetLock: null,
      ingestionJobId,
      draftId,
      draftVersionId,
      approvalId,
      seedJobId,
      progressJson: progress as Prisma.InputJsonValue,
      logsJson: logs as Prisma.InputJsonValue,
      resultJson: {
        status: cancelled ? SetReplaceJobStatus.CANCELLED : SetReplaceJobStatus.FAILED,
        deleteImpact,
        preview: prepared?.preview ?? null,
        seedSummary,
      } as Prisma.InputJsonValue,
    });

    await writeSetOpsAuditEvent({
      req: params.req,
      admin: params.admin,
      action: "set_ops.replace.failed",
      status: SetAuditStatus.FAILURE,
      setId: failed.setId,
      draftId,
      draftVersionId,
      ingestionJobId,
      approvalId,
      seedJobId,
      reason: cancelled ? "cancel_requested" : errorMessage,
      metadata: {
        replaceJobId: params.jobId,
        stage: currentStage,
        cancelled,
      },
    });

    return serializeSetReplaceJob(failed);
  }
}
