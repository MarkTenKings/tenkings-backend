import {
  buildAiGraderCompsSearchQuery,
  type AiGraderProductionReleaseLike,
  type AiGraderProductionReportBundleLike,
  type AiGraderProductionStoragePlan,
  type Prisma,
} from "@tenkings/database";
import {
  buildAiGraderLabelSheetRevision,
  buildAiGraderLabelSheetsResult,
  mergeAiGraderLabelSheetPayload,
  normalizeAiGraderConfirmedCardIdentity,
  parseAiGraderLabelSheetAssignment,
  printAiGraderLabelSheetAssignment,
  sealAiGraderLabelSheetAssignment,
  selectNextAiGraderLabelSheetSlot,
  toSafeAiGraderLabelSheetLabel,
  type AiGraderLabelSheetDto,
  type AiGraderLabelSheetSourceRow,
  type AiGraderLabelSheetsResult,
  type AiGraderSafeConfirmedCardIdentity,
} from "../aiGraderLabelSheets";
import type { AiGraderProductionActorAudit } from "./aiGraderProductionAuth";

type JsonRecord = Record<string, unknown>;

export type AiGraderConfirmedLabelQueueResult = {
  sheetId: string;
  sheetNumber: number;
  slot: number;
  capacity: 16;
  status: "open" | "full" | "sealed" | "printed";
  assignedAt: string;
  existing: boolean;
  comps: {
    status: "queued" | "running" | "ready" | "completed" | "failed";
    searchQuery: string;
    shouldStart: boolean;
  };
};

export type AiGraderPreparedLabelSheetResult = {
  sheet: AiGraderLabelSheetDto;
};

export type AiGraderPrintedLabelSheetResult = {
  sheet: AiGraderLabelSheetDto;
  printedLabelCount: number;
  labelIds: string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringValue(value: unknown, fallback: string) {
  return optionalString(value) ?? fallback;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function runtimeError(message: string, statusCode: number, code: string) {
  const error = new Error(message) as Error & { statusCode?: number; code?: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function acquireLabelSheetLock(tx: any, tenantId: string) {
  if (typeof tx.$queryRaw !== "function") {
    throw new Error("AI Grader label sheet transaction locking is unavailable.");
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-label-sheets'), hashtext(${tenantId}))`;
}

async function acquireReportLifecycleLock(tx: any, reportId: string) {
  if (typeof tx.$queryRaw !== "function") {
    throw new Error("AI Grader report lifecycle transaction locking is unavailable.");
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${reportId}))`;
}

function confirmedTitle(identity: AiGraderSafeConfirmedCardIdentity) {
  return [
    identity.year,
    identity.manufacturer,
    identity.productSet ?? identity.productLine,
    identity.playerName ?? identity.cardName ?? identity.title,
    identity.cardNumber ? `#${identity.cardNumber}` : undefined,
    identity.parallel,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function finalGradeDetails(productionRelease: AiGraderProductionReleaseLike) {
  const finalGrade = isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : {};
  return {
    overall: numberValue(finalGrade.overall),
    status: stringValue(finalGrade.status, productionRelease.finalGradeComputed ? "final_grade_computed" : "not_computed"),
  };
}

function canonicalLabelPayload(input: {
  productionRelease: AiGraderProductionReleaseLike;
  existingPayload?: unknown;
  identity: AiGraderSafeConfirmedCardIdentity;
  cardAssetId: string;
  itemId: string;
}) {
  const canonical = isRecord(input.productionRelease.label) ? input.productionRelease.label : {};
  const existing = isRecord(input.existingPayload) ? input.existingPayload : {};
  return {
    ...existing,
    ...canonical,
    cardIdentity: {
      ...(isRecord(existing.cardIdentity) ? existing.cardIdentity : {}),
      ...(isRecord(canonical.cardIdentity) ? canonical.cardIdentity : {}),
      ...input.identity,
      cardAssetId: input.cardAssetId,
      itemId: input.itemId,
      status: "linked",
    },
  };
}

function externalReportId(row: any) {
  return optionalString(row?.report?.reportId) ?? optionalString(row?.externalReportId) ?? optionalString(row?.reportId) ?? "";
}

function sourceRows(rows: unknown[]): AiGraderLabelSheetSourceRow[] {
  return rows.filter(isRecord).map((row) => ({
    id: row.id,
    reportId: externalReportId(row),
    certId: row.certId,
    labelGradeText: row.labelGradeText,
    qrPayloadUrl: row.qrPayloadUrl,
    publicReportUrl: row.publicReportUrl,
    physicalPrintStatus: row.physicalPrintStatus,
    payload: row.payload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publicationStatus: isRecord(row.report) ? row.report.publicationStatus : row.publicationStatus,
  }));
}

const labelSheetSelect = {
  id: true,
  reportId: true,
  certId: true,
  labelGradeText: true,
  qrPayloadUrl: true,
  publicReportUrl: true,
  physicalPrintStatus: true,
  payload: true,
  createdAt: true,
  updatedAt: true,
  report: {
    select: {
      reportId: true,
      publicationStatus: true,
    },
  },
} as const;

async function readTenantLabels(tx: any, tenantId: string) {
  const rows = await tx.aiGraderLabel.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: labelSheetSelect,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function queueConfirmedAiGraderLabelTx(input: {
  tx: any;
  tenantId: string;
  sessionId: string;
  gradingSessionId: string;
  reportId: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  storagePlan: AiGraderProductionStoragePlan;
  confirmedIdentity: unknown;
  cardAssetId: string;
  itemId: string;
  operatorUserId: string;
  now?: Date;
}): Promise<AiGraderConfirmedLabelQueueResult> {
  const now = input.now ?? new Date();
  const identity = normalizeAiGraderConfirmedCardIdentity(input.confirmedIdentity);
  const grade = finalGradeDetails(input.productionRelease);
  const label = isRecord(input.productionRelease.label) ? input.productionRelease.label : {};
  const certId = stringValue(label.certId, input.reportId);
  const labelGradeText = stringValue(label.labelGradeText, grade.overall != null ? grade.overall.toFixed(1) : "PENDING");
  const labelPreviewUrl = input.storagePlan.assetManifest.find((asset) => asset.kind === "label-preview.html")?.publicUrl;

  await acquireReportLifecycleLock(input.tx, input.reportId);
  await acquireLabelSheetLock(input.tx, input.tenantId);

  const existingReport = await input.tx.aiGraderReport.findUnique({
    where: { reportId: input.reportId },
    select: { id: true },
  });
  const report = await input.tx.aiGraderReport.upsert({
    where: { reportId: input.reportId },
    update: {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      cardAssetId: input.cardAssetId,
      itemId: input.itemId,
      publicReportUrl: input.storagePlan.publicReportUrl,
      qrPayloadUrl: input.storagePlan.qrPayloadUrl,
      finalOverallGrade: grade.overall,
      updatedAt: now,
    },
    create: {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      reportId: input.reportId,
      reportStatus: stringValue(input.productionRelease.reportStatus, "final_ai_grader_report_v0"),
      finalGradeStatus: grade.status,
      visibilityStatus: "private",
      publicationStatus: "draft",
      cardAssetId: input.cardAssetId,
      itemId: input.itemId,
      publicReportUrl: input.storagePlan.publicReportUrl,
      qrPayloadUrl: input.storagePlan.qrPayloadUrl,
      finalOverallGrade: grade.overall,
      createdAt: now,
      updatedAt: now,
    },
  });
  const reportRowId = stringValue(report?.id ?? existingReport?.id, "");
  if (!reportRowId) throw new Error("AI Grader draft report could not be created for label assignment.");

  const rows = await readTenantLabels(input.tx, input.tenantId);
  const sources = sourceRows(rows);
  const reportLabel = rows.find((row: any) => externalReportId(row) === input.reportId);
  const certLabel = rows.find((row: any) => optionalString(row.certId) === certId);
  if (reportLabel && optionalString(reportLabel.certId) !== certId) {
    throw runtimeError(
      "The AI Grader report already has a different cert ID. Resolve the cert mismatch before assigning a label sheet slot.",
      409,
      "AI_GRADER_LABEL_CERT_MISMATCH"
    );
  }
  if (certLabel && externalReportId(certLabel) !== input.reportId) {
    throw runtimeError(
      "The AI Grader cert ID is already linked to another report.",
      409,
      "AI_GRADER_LABEL_CERT_ALREADY_LINKED"
    );
  }
  const slot = selectNextAiGraderLabelSheetSlot(sources, {
    reportId: input.reportId,
    assignedAt: now,
    assignedByUserId: input.operatorUserId,
  });
  const existingLabel = reportLabel ?? certLabel;
  const basePayload = canonicalLabelPayload({
    productionRelease: input.productionRelease,
    existingPayload: existingLabel?.payload,
    identity,
    cardAssetId: input.cardAssetId,
    itemId: input.itemId,
  });
  const initialPayload = mergeAiGraderLabelSheetPayload(basePayload, slot.assignment, identity);
  const previousLabel = existingLabel ? toSafeAiGraderLabelSheetLabel(sourceRows([existingLabel])[0]) : null;
  const nextLabel = toSafeAiGraderLabelSheetLabel({
    id: existingLabel?.id ?? `pending:${certId}`,
    reportId: input.reportId,
    certId,
    labelGradeText,
    qrPayloadUrl: input.storagePlan.qrPayloadUrl,
    publicReportUrl: input.storagePlan.publicReportUrl,
    physicalPrintStatus: existingLabel?.physicalPrintStatus,
    payload: initialPayload,
  });
  const printableContentChanged = Boolean(
    previousLabel &&
      nextLabel &&
      buildAiGraderLabelSheetRevision([previousLabel]) !== buildAiGraderLabelSheetRevision([nextLabel])
  );
  const assignmentWasPrinted = Boolean(slot.assignment.printedAt || existingLabel?.physicalPrintStatus === "printed");
  const invalidatePrintedLabel = printableContentChanged && assignmentWasPrinted;
  const assignment = { ...slot.assignment };
  if (invalidatePrintedLabel) {
    delete assignment.printedAt;
    delete assignment.printedByUserId;
  }
  const payload = {
    ...mergeAiGraderLabelSheetPayload(basePayload, assignment, identity),
    ...(invalidatePrintedLabel
      ? {
          physicalPrint: {
            status: "not_printed",
            invalidatedAt: now.toISOString(),
            reason: "printable_label_content_changed",
          },
        }
      : {}),
  };
  await input.tx.aiGraderLabel.upsert({
    where: { certId },
    update: {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      reportId: reportRowId,
      labelStatus: stringValue(label.status, "label_data_ready"),
      certificateStatus: stringValue(label.certificateStatus, "report_id_issued_not_certified"),
      qrPayloadUrl: input.storagePlan.qrPayloadUrl,
      publicReportUrl: input.storagePlan.publicReportUrl,
      labelGradeText,
      labelPreviewUrl: labelPreviewUrl ?? null,
      ...(invalidatePrintedLabel ? { physicalPrintStatus: "not_printed" } : {}),
      payload: jsonInput(payload),
      updatedAt: now,
    },
    create: {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      reportId: reportRowId,
      certId,
      labelStatus: stringValue(label.status, "label_data_ready"),
      certificateStatus: stringValue(label.certificateStatus, "report_id_issued_not_certified"),
      qrPayloadUrl: input.storagePlan.qrPayloadUrl,
      publicReportUrl: input.storagePlan.publicReportUrl,
      labelGradeText,
      labelPreviewUrl: labelPreviewUrl ?? null,
      payload: jsonInput(payload),
      createdAt: now,
      updatedAt: now,
    },
  });

  const reportBundle = {
    ...input.reportBundle,
    cardIdentity: {
      ...(isRecord(input.reportBundle.cardIdentity) ? input.reportBundle.cardIdentity : {}),
      ...identity,
      title: confirmedTitle(identity) || optionalString(input.reportBundle.cardIdentity?.title),
      cardAssetId: input.cardAssetId,
      itemId: input.itemId,
    },
  };
  const searchQuery = buildAiGraderCompsSearchQuery({
    reportBundle,
    productionRelease: input.productionRelease,
  });
  const valuationId = `ai-grader-valuation:${input.reportId}`;
  const existingValuation = await input.tx.aiGraderValuation.findUnique({
    where: { id: valuationId },
    select: {
      id: true,
      status: true,
      searchQuery: true,
      compsRefs: true,
      resultSummary: true,
    },
  });
  if (!existingValuation) {
    await input.tx.aiGraderValuation.create({
      data: {
        id: valuationId,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        reportId: reportRowId,
        status: "ready",
        source: "ebay_sold",
        searchQuery: searchQuery || null,
        resultSummary: jsonInput({
          workflowStatus: "queued",
          queuedAt: now.toISOString(),
        }),
        requestedByUserId: input.operatorUserId,
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  const existingSummary = isRecord(existingValuation?.resultSummary) ? existingValuation.resultSummary : {};
  const persistedCandidateCount = Array.isArray(existingValuation?.compsRefs) ? existingValuation.compsRefs.length : 0;
  const persistedStatus = optionalString(existingValuation?.status);
  const compsStatus: AiGraderConfirmedLabelQueueResult["comps"]["status"] = !existingValuation
    ? "queued"
    : persistedStatus === "completed"
      ? "completed"
      : persistedStatus === "running"
        ? "running"
        : persistedStatus === "failed"
          ? "failed"
          : persistedCandidateCount > 0 || optionalString(existingSummary.lifecycleStatus) === "ready"
            ? "ready"
            : "queued";

  return {
    sheetId: slot.assignment.sheetId,
    sheetNumber: slot.assignment.sheetNumber,
    slot: slot.assignment.slot,
    capacity: 16,
    status: slot.sheetStatus,
    assignedAt: slot.assignment.assignedAt,
    existing: slot.existing,
    comps: {
      status: compsStatus,
      searchQuery: optionalString(existingValuation?.searchQuery) ?? searchQuery,
      shouldStart: compsStatus === "queued",
    },
  };
}

export async function listAiGraderLabelSheetsRuntime(input?: { dbClient?: any; tenantId?: string }): Promise<AiGraderLabelSheetsResult> {
  const { prisma } = await import("@tenkings/database");
  const db = input?.dbClient ?? (prisma as any);
  const rows = await readTenantLabels(db, input?.tenantId ?? "ten-kings");
  return buildAiGraderLabelSheetsResult(sourceRows(rows));
}

async function mutateSheet(input: {
  db: any;
  tenantId: string;
  sheetId: string;
  expectedRevision: string;
  operatorUserId: string;
  actorAudit?: AiGraderProductionActorAudit | null;
  mode: "seal" | "print";
}): Promise<AiGraderLabelSheetDto> {
  return input.db.$transaction(async (tx: any) => {
    await acquireLabelSheetLock(tx, input.tenantId);
    const rows = await readTenantLabels(tx, input.tenantId);
    const sources = sourceRows(rows);
    const current = buildAiGraderLabelSheetsResult(sources).sheets.find((sheet) => sheet.sheetId === input.sheetId);
    if (!current) throw runtimeError("AI Grader label sheet was not found.", 404, "AI_GRADER_LABEL_SHEET_NOT_FOUND");
    if (current.slotConflict) {
      throw runtimeError("AI Grader label sheet has a slot conflict and cannot be printed.", 409, "AI_GRADER_LABEL_SHEET_SLOT_CONFLICT");
    }
    if (!input.expectedRevision || current.revision !== input.expectedRevision) {
      throw runtimeError(
        "AI Grader label sheet changed. Refresh it before printing.",
        409,
        "AI_GRADER_LABEL_SHEET_REVISION_MISMATCH"
      );
    }
    if (input.mode === "print" && current.status !== "sealed" && current.status !== "printed") {
      throw runtimeError(
        "Prepare the AI Grader label sheet for printing before marking it printed.",
        409,
        "AI_GRADER_LABEL_SHEET_NOT_SEALED"
      );
    }

    const now = new Date();
    const currentIds = new Set(current.labels.map((label) => label.labelId));
    const patchedRows: any[] = [];
    for (const row of rows) {
      if (!currentIds.has(String(row.id))) {
        patchedRows.push(row);
        continue;
      }
      const assignment = parseAiGraderLabelSheetAssignment(row.payload);
      if (!assignment || assignment.sheetId !== input.sheetId) {
        throw runtimeError("AI Grader label sheet assignment is invalid.", 409, "AI_GRADER_LABEL_SHEET_ASSIGNMENT_INVALID");
      }
      const sealed = sealAiGraderLabelSheetAssignment(assignment, {
        sealedAt: now,
        sealedByUserId: input.operatorUserId,
      });
      const nextAssignment =
        input.mode === "print"
          ? printAiGraderLabelSheetAssignment(sealed, {
              printedAt: now,
              printedByUserId: input.operatorUserId,
            })
          : sealed;
      const nextPayload = {
        ...mergeAiGraderLabelSheetPayload(row.payload, nextAssignment),
        ...(input.mode === "print"
          ? {
              physicalPrint: {
                status: "printed",
                sheetId: input.sheetId,
                printedAt: now.toISOString(),
                operatorUserId: input.operatorUserId,
                actorAudit: input.actorAudit ?? null,
              },
            }
          : {}),
      };
      await tx.aiGraderLabel.update({
        where: { id: row.id },
        data: {
          ...(input.mode === "print" ? { physicalPrintStatus: "printed" } : {}),
          payload: jsonInput(nextPayload),
          updatedAt: now,
        },
      });
      patchedRows.push({
        ...row,
        payload: nextPayload,
        physicalPrintStatus: input.mode === "print" ? "printed" : row.physicalPrintStatus,
        updatedAt: now,
      });
    }

    const sheet = buildAiGraderLabelSheetsResult(sourceRows(patchedRows)).sheets.find((entry) => entry.sheetId === input.sheetId);
    if (!sheet) throw new Error("AI Grader label sheet could not be rebuilt after update.");
    return sheet;
  });
}

export async function prepareAiGraderLabelSheetPrintRuntime(input: {
  tenantId: string;
  sheetId: string;
  expectedRevision: string;
  operatorUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
  dbClient?: any;
}): Promise<AiGraderPreparedLabelSheetResult> {
  if (!input.operatorUserId) {
    throw runtimeError("A human operator session is required to prepare an AI Grader label sheet.", 403, "AI_GRADER_HUMAN_OPERATOR_REQUIRED");
  }
  const { prisma } = await import("@tenkings/database");
  const sheet = await mutateSheet({
    db: input.dbClient ?? (prisma as any),
    tenantId: input.tenantId,
    sheetId: input.sheetId,
    expectedRevision: input.expectedRevision,
    operatorUserId: input.operatorUserId,
    actorAudit: input.actorAudit,
    mode: "seal",
  });
  return { sheet };
}

export async function markAiGraderLabelSheetPrintedRuntime(input: {
  tenantId: string;
  sheetId: string;
  expectedRevision: string;
  operatorUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
  dbClient?: any;
}): Promise<AiGraderPrintedLabelSheetResult> {
  if (!input.operatorUserId) {
    throw runtimeError("A human operator session is required to mark an AI Grader label sheet printed.", 403, "AI_GRADER_HUMAN_OPERATOR_REQUIRED");
  }
  const { prisma } = await import("@tenkings/database");
  const sheet = await mutateSheet({
    db: input.dbClient ?? (prisma as any),
    tenantId: input.tenantId,
    sheetId: input.sheetId,
    expectedRevision: input.expectedRevision,
    operatorUserId: input.operatorUserId,
    actorAudit: input.actorAudit,
    mode: "print",
  });
  return {
    sheet,
    printedLabelCount: sheet.labels.length,
    labelIds: sheet.labels.map((label) => label.labelId),
  };
}
