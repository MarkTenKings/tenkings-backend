import {
  assertAiGraderDurableConfirmedIdentityMatchesAuthority,
  buildAiGraderCompsSearchQuery,
  canonicalAiGraderPublishAuthorityJson,
  parseAiGraderPublishAuthorityRecord,
  type AiGraderConfirmedPublishAuthority,
  type AiGraderProductionReleaseLike,
  type AiGraderProductionReportBundleLike,
  type Prisma,
} from "@tenkings/database";
import {
  buildAiGraderLabelV1RuntimeRecord,
  canonicalAiGraderLabelV1RuntimeRecord,
  parseAiGraderLabelV1RuntimeRecord,
  strictAiGraderLabelV1JsonEqual,
  type AiGraderLabelV1RuntimeRecord,
} from "../aiGraderLabelV1";
import {
  aiGraderLabelV1TemplateDigest,
  renderAiGraderLabelSheetCutSvg,
  renderAiGraderLabelSheetV1Pdf,
  type AiGraderLabelV1SheetEntry,
} from "./aiGraderLabelV1Renderer";
import {
  buildAiGraderLabelSheetRevision,
  buildAiGraderLabelSheetsResult,
  mergeAiGraderLabelSheetPayload,
  normalizeAiGraderConfirmedCardIdentity,
  parseAiGraderLabelSheetAssignment,
  printAiGraderLabelSheetAssignment,
  safeAiGraderLabelPublicUrl,
  sealAiGraderLabelSheetAssignment,
  selectNextAiGraderLabelSheetSlot,
  toSafeAiGraderLabelSheetLabel,
  type AiGraderLabelSheetDto,
  type AiGraderLabelSheetSourceRow,
  type AiGraderLabelSheetsResult,
  type AiGraderSafeConfirmedCardIdentity,
} from "../aiGraderLabelSheets";
import type { AiGraderProductionActorAudit } from "./aiGraderProductionAuth";
import { readAiGraderNfcStatusesForReports } from "./aiGraderNfcReadProjection";

type JsonRecord = Record<string, unknown>;

export type AiGraderConfirmedCardQueueResult = {
  comps: {
    status: "queued" | "running" | "ready" | "completed" | "failed";
    searchQuery: string;
    shouldStart: boolean;
  };
};

export type AiGraderPublishedLabelAssignmentResult = {
  sheetId: string;
  sheetNumber: number;
  slot: number;
  capacity: 16;
  status: "open" | "full" | "sealed" | "printed";
  assignedAt: string;
  existing: boolean;
};

export type AiGraderPreparedLabelSheetResult = {
  sheet: AiGraderLabelSheetDto;
};

export type AiGraderPrintedLabelSheetResult = {
  sheet: AiGraderLabelSheetDto;
  printedLabelCount: number;
  labelIds: string[];
};

export type AiGraderRenderedLabelSheetFile = {
  body: Buffer;
  contentType: "application/pdf" | "image/svg+xml";
  fileName: string;
  revision: string;
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
  await tx.$queryRaw`
    SELECT 1 AS "lockAcquired"
    FROM pg_advisory_xact_lock(hashtext('ai-grader-label-sheets'), hashtext(${tenantId}))
  `;
}

async function acquireReportLifecycleLock(tx: any, reportId: string) {
  if (typeof tx.$queryRaw !== "function") {
    throw new Error("AI Grader report lifecycle transaction locking is unavailable.");
  }
  await tx.$queryRaw`
    SELECT 1 AS "lockAcquired"
    FROM pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${reportId}))
  `;
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

function sourceRows(rows: unknown[], nfcByReportId: Map<string, unknown> = new Map()): AiGraderLabelSheetSourceRow[] {
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
    nfc: nfcByReportId.get(externalReportId(row)),
  }));
}

const labelSheetSelect = {
  id: true,
  reportId: true,
  certId: true,
  labelStatus: true,
  certificateStatus: true,
  labelGradeText: true,
  qrPayloadUrl: true,
  publicReportUrl: true,
  physicalPrintStatus: true,
  payload: true,
  createdAt: true,
  updatedAt: true,
  report: {
    select: {
      id: true,
      reportId: true,
      publicationStatus: true,
      cardAssetId: true,
      itemId: true,
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

export async function linkConfirmedAiGraderCardTx(input: {
  tx: any;
  tenantId: string;
  sessionId: string;
  gradingSessionId: string;
  reportId: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  confirmedIdentity: unknown;
  cardAssetId: string;
  itemId: string;
  operatorUserId: string;
  now?: Date;
}): Promise<AiGraderConfirmedCardQueueResult> {
  const now = input.now ?? new Date();
  const identity = normalizeAiGraderConfirmedCardIdentity(input.confirmedIdentity);
  const grade = finalGradeDetails(input.productionRelease);

  await acquireReportLifecycleLock(input.tx, input.reportId);

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
      publicReportUrl: null,
      qrPayloadUrl: null,
      finalOverallGrade: grade.overall,
      createdAt: now,
      updatedAt: now,
    },
  });
  const reportRowId = stringValue(report?.id ?? existingReport?.id, "");
  if (!reportRowId) throw new Error("AI Grader draft report could not be created for confirmed card linkage.");

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
  const compsStatus: AiGraderConfirmedCardQueueResult["comps"]["status"] = !existingValuation
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
    comps: {
      status: compsStatus,
      searchQuery: optionalString(existingValuation?.searchQuery) ?? searchQuery,
      // A queued durable handoff may be relaunched after a lost browser response;
      // the advisory-locked run-comps claim prevents duplicate provider execution.
      shouldStart: compsStatus === "queued",
    },
  };
}

export async function completePublishedAiGraderCardTx(input: {
  tx: any;
  tenantId: string;
  gradingSessionId: string;
  reportId: string;
  productionRelease: AiGraderProductionReleaseLike;
  cardAssetId: string;
  itemId: string;
  publishAuthority: AiGraderConfirmedPublishAuthority;
  operatorUserId?: string;
  now?: Date;
}): Promise<AiGraderPublishedLabelAssignmentResult> {
  const now = input.now ?? new Date();
  await acquireReportLifecycleLock(input.tx, input.reportId);
  const [session, report] = await Promise.all([
    input.tx.aiGraderSession.findUnique({
      where: { gradingSessionId: input.gradingSessionId },
      select: {
        id: true,
        tenantId: true,
        gradingSessionId: true,
        reportId: true,
        cardAssetId: true,
        itemId: true,
        status: true,
        cardIdentity: true,
      },
    }),
    input.tx.aiGraderReport.findUnique({
      where: { reportId: input.reportId },
      select: {
        id: true,
        tenantId: true,
        sessionId: true,
        reportId: true,
        publicationStatus: true,
        cardAssetId: true,
        itemId: true,
      },
    }),
  ]);
  const reportRowId = optionalString(report?.id);
  const sessionId = optionalString(session?.id);
  if (
    !reportRowId ||
    !sessionId ||
    optionalString(session?.tenantId) !== input.tenantId ||
    optionalString(session?.gradingSessionId) !== input.gradingSessionId ||
    optionalString(report?.tenantId) !== input.tenantId ||
    optionalString(report?.sessionId) !== sessionId ||
    optionalString(report?.reportId) !== input.reportId ||
    optionalString(session?.reportId) !== input.reportId ||
    optionalString(report?.cardAssetId) !== input.cardAssetId ||
    optionalString(report?.itemId) !== input.itemId ||
    optionalString(session?.cardAssetId) !== input.cardAssetId ||
    optionalString(session?.itemId) !== input.itemId ||
    input.publishAuthority.tenantId !== input.tenantId ||
    input.publishAuthority.gradingSessionId !== input.gradingSessionId ||
    input.publishAuthority.reportId !== input.reportId ||
    input.publishAuthority.cardAssetId !== input.cardAssetId ||
    input.publishAuthority.itemId !== input.itemId ||
    input.publishAuthority.sessionId !== sessionId ||
    input.publishAuthority.reportRowId !== reportRowId
  ) {
    throw runtimeError(
      "Verified Publish linkage does not match the durable report, session, CardAsset, and Item identity.",
      409,
      "AI_GRADER_PUBLISHED_LINKAGE_MISMATCH"
    );
  }
  const identity = normalizeAiGraderConfirmedCardIdentity(session?.cardIdentity);
  assertAiGraderDurableConfirmedIdentityMatchesAuthority(session?.cardIdentity, input.publishAuthority);
  const categoryIdentityMissing =
    (identity.category === "sport" && (!identity.playerName || !identity.sport)) ||
    (identity.category === "tcg" && (!identity.cardName || !identity.game)) ||
    (identity.category === "comics" && !identity.cardName);
  if (
    !identity.category ||
    !identity.title ||
    !identity.year ||
    !identity.manufacturer ||
    !identity.productSet ||
    !identity.cardNumber ||
    categoryIdentityMissing
  ) {
    throw runtimeError(
      "Verified Publish could not resolve the durable operator-confirmed card identity.",
      409,
      "AI_GRADER_PUBLISHED_IDENTITY_INVALID"
    );
  }
  if (optionalString(report?.publicationStatus) !== "published" || optionalString(session?.status) !== "published") {
    throw runtimeError(
      "The AI Grader report must be durably published before assigning a grading-label slot.",
      409,
      "AI_GRADER_REPORT_NOT_DURABLY_PUBLISHED"
    );
  }

  const [publication, card, item] = await Promise.all([
    input.tx.aiGraderPublication.findUnique({
      where: { reportId: reportRowId },
      select: { status: true },
    }),
    input.tx.cardAsset.findUnique({
      where: { id: input.cardAssetId },
      select: {
        id: true,
        batchId: true,
        status: true,
        imageUrl: true,
        thumbnailUrl: true,
        cdnHdUrl: true,
        cdnThumbUrl: true,
        classificationSourcesJson: true,
        aiGradingJson: true,
      },
    }),
    input.tx.item.findUnique({
      where: { id: input.itemId },
      select: { id: true, imageUrl: true, thumbnailUrl: true, cdnHdUrl: true, cdnThumbUrl: true },
    }),
  ]);
  const classificationSources = isRecord(card?.classificationSourcesJson)
    ? card.classificationSourcesJson
    : {};
  const cardAiGradingJson = isRecord(card?.aiGradingJson) ? card.aiGradingJson : {};
  const storedPublishAuthority = parseAiGraderPublishAuthorityRecord(
    classificationSources.aiGraderPublishAuthority,
  );
  const mirroredPublishAuthority = parseAiGraderPublishAuthorityRecord(
    cardAiGradingJson.publishAuthority,
  );
  if (
    canonicalAiGraderPublishAuthorityJson(storedPublishAuthority) !==
      canonicalAiGraderPublishAuthorityJson(mirroredPublishAuthority) ||
    canonicalAiGraderPublishAuthorityJson(storedPublishAuthority) !==
      canonicalAiGraderPublishAuthorityJson(input.publishAuthority.publishAuthority)
  ) {
    throw runtimeError(
      "The published card does not match its immutable Confirm authority.",
      409,
      "AI_GRADER_PUBLISH_AUTHORITY_CONTRADICTORY",
    );
  }
  const durableRelease = storedPublishAuthority.projection.release;
  const releaseLabel = isRecord(durableRelease.label) ? durableRelease.label : {};
  const certId = optionalString(releaseLabel.certId);
  if (
    durableRelease.labelDataGenerated !== true ||
    durableRelease.qrPayloadGenerated !== true ||
    optionalString(releaseLabel.status) !== "label_data_ready" ||
    !certId
  ) {
    throw runtimeError(
      "Verified Publish did not preserve complete durable grading-label authority.",
      409,
      "AI_GRADER_PUBLISHED_LABEL_NOT_READY",
    );
  }
  const batchId = optionalString(card?.batchId);
  const cardHostedImage = optionalString(card?.cdnHdUrl ?? card?.imageUrl ?? card?.thumbnailUrl ?? card?.cdnThumbUrl);
  const itemHostedImage = optionalString(item?.cdnHdUrl ?? item?.imageUrl ?? item?.thumbnailUrl ?? item?.cdnThumbUrl);
  if (
    optionalString(publication?.status) !== "published" ||
    optionalString(card?.id) !== input.cardAssetId ||
    optionalString(card?.status) !== "READY" ||
    !batchId ||
    !cardHostedImage ||
    optionalString(item?.id) !== input.itemId ||
    !itemHostedImage
  ) {
    throw runtimeError(
      "Verified Publish has not completed the durable hosted-image transition.",
      409,
      "AI_GRADER_PUBLISHED_ASSETS_NOT_READY"
    );
  }
  const batch = await input.tx.cardBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true, totalCount: true, processedCount: true },
  });
  const pendingBatch = optionalString(batch?.status) === "UPLOADING" && numberValue(batch?.processedCount) === 0;
  const publishedBatch = optionalString(batch?.status) === "READY" && numberValue(batch?.processedCount) === 1;
  if (optionalString(batch?.id) !== batchId || numberValue(batch?.totalCount) !== 1 || (!pendingBatch && !publishedBatch)) {
    throw runtimeError(
      "Verified Publish found an invalid linked CardBatch state.",
      409,
      "AI_GRADER_PUBLISHED_BATCH_STATE_INVALID"
    );
  }

  await acquireLabelSheetLock(input.tx, input.tenantId);
  const rows = await readTenantLabels(input.tx, input.tenantId);
  const sources = sourceRows(rows);
  const reportLabel = rows.find((row: any) => externalReportId(row) === input.reportId);
  const certLabel = rows.find((row: any) => optionalString(row.certId) === certId);
  if (!reportLabel || reportLabel !== certLabel) {
    throw runtimeError(
      "Verified Publish did not persist one matching grading label for this report.",
      409,
      "AI_GRADER_PUBLISHED_LABEL_MISMATCH"
    );
  }
  const labelId = optionalString(reportLabel.id);
  const labelGradeText = optionalString(reportLabel.labelGradeText);
  const publicReportUrl = optionalString(reportLabel.publicReportUrl);
  const qrPayloadUrl = optionalString(reportLabel.qrPayloadUrl);
  if (
    !labelId ||
    optionalString(reportLabel.labelStatus) !== "label_data_ready" ||
    !optionalString(reportLabel.certificateStatus) ||
    !labelGradeText ||
    !publicReportUrl ||
    !qrPayloadUrl ||
    optionalString(reportLabel.report?.publicationStatus) !== "published"
  ) {
    throw runtimeError(
      "Verified Publish grading-label evidence is incomplete.",
      409,
      "AI_GRADER_PUBLISHED_LABEL_NOT_READY"
    );
  }
  if (safeAiGraderLabelPublicUrl(publicReportUrl) !== publicReportUrl) {
    throw runtimeError(
      "Verified Publish grading-label evidence does not contain a safe public report URL.",
      409,
      "AI_GRADER_PUBLISHED_LABEL_PUBLIC_URL_UNSAFE"
    );
  }

  const slot = selectNextAiGraderLabelSheetSlot(sources, {
    reportId: input.reportId,
    assignedAt: now,
    assignedByUserId: input.operatorUserId,
  });
  const persistedRelease = {
    ...durableRelease,
    label: {
      ...releaseLabel,
      certId,
      labelGradeText,
      publicReportUrl,
      qrPayloadUrl,
      labelStatus: reportLabel.labelStatus,
      certificateStatus: reportLabel.certificateStatus,
    },
  };
  const basePayload = canonicalLabelPayload({
    productionRelease: persistedRelease,
    existingPayload: reportLabel.payload,
    identity,
    cardAssetId: input.cardAssetId,
    itemId: input.itemId,
  });
  const templateDigestSha256 = aiGraderLabelV1TemplateDigest();
  const labelV1 = buildAiGraderLabelV1RuntimeRecord({
    templateDigestSha256,
    reportId: input.reportId,
    certId,
    grade: labelGradeText,
    publicReportUrl,
    identity,
    sheetAssignment: {
      sheetId: slot.assignment.sheetId,
      sheetNumber: slot.assignment.sheetNumber,
      slot: slot.assignment.slot,
      assignedAt: slot.assignment.assignedAt,
    },
  });
  const existingPayload = isRecord(reportLabel.payload) ? reportLabel.payload : {};
  if (existingPayload.labelV1 !== undefined) {
    const existingLabelV1 = parseAiGraderLabelV1RuntimeRecord(existingPayload.labelV1, templateDigestSha256);
    if (!existingLabelV1 || canonicalAiGraderLabelV1RuntimeRecord(existingLabelV1) !== canonicalAiGraderLabelV1RuntimeRecord(labelV1)) {
      throw runtimeError(
        "The assigned Label V1 template or immutable confirmed identity changed after assignment.",
        409,
        "AI_GRADER_LABEL_V1_IMMUTABLE_SNAPSHOT_MISMATCH"
      );
    }
  } else if (slot.existing) {
    throw runtimeError(
      "The existing grading-label assignment predates Label V1 and must be reviewed before conversion.",
      409,
      "AI_GRADER_LABEL_V1_LEGACY_ASSIGNMENT_REVIEW_REQUIRED"
    );
  }
  const initialPayload = {
    ...mergeAiGraderLabelSheetPayload(basePayload, slot.assignment, identity),
    labelV1,
  };
  const previousLabel = toSafeAiGraderLabelSheetLabel(sourceRows([reportLabel])[0]);
  const nextLabel = toSafeAiGraderLabelSheetLabel({
    id: labelId,
    reportId: input.reportId,
    certId,
    labelGradeText,
    qrPayloadUrl,
    publicReportUrl,
    physicalPrintStatus: reportLabel.physicalPrintStatus,
    payload: initialPayload,
  });
  const printableContentChanged = Boolean(
    previousLabel &&
      nextLabel &&
      buildAiGraderLabelSheetRevision([previousLabel]) !== buildAiGraderLabelSheetRevision([nextLabel])
  );
  const assignmentWasPrinted = Boolean(slot.assignment.printedAt || reportLabel.physicalPrintStatus === "printed");
  const invalidatePrintedLabel = printableContentChanged && assignmentWasPrinted;
  const assignment = { ...slot.assignment };
  if (invalidatePrintedLabel) {
    delete assignment.printedAt;
    delete assignment.printedByUserId;
  }
  const payload = {
    ...mergeAiGraderLabelSheetPayload(basePayload, assignment, identity),
    labelV1,
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
  await input.tx.aiGraderLabel.update({
    where: { id: labelId },
    data: {
      ...(invalidatePrintedLabel ? { physicalPrintStatus: "not_printed" } : {}),
      payload: jsonInput(payload),
      updatedAt: now,
    },
  });
  const batchUpdate = await input.tx.cardBatch.updateMany({
    where: { id: batchId },
    data: { status: "READY", processedCount: 1 },
  });
  if (batchUpdate.count !== 1) {
    throw runtimeError(
      "Verified Publish could not promote the linked CardBatch.",
      409,
      "AI_GRADER_PUBLISHED_BATCH_NOT_READY"
    );
  }

  return {
    sheetId: assignment.sheetId,
    sheetNumber: assignment.sheetNumber,
    slot: assignment.slot,
    capacity: 16,
    status: slot.sheetStatus,
    assignedAt: assignment.assignedAt,
    existing: slot.existing,
  };
}

export async function listAiGraderLabelSheetsRuntime(input?: { dbClient?: any; tenantId?: string }): Promise<AiGraderLabelSheetsResult> {
  const { prisma } = await import("@tenkings/database");
  const db = input?.dbClient ?? (prisma as any);
  const tenantId = input?.tenantId ?? "ten-kings";
  const rows = await readTenantLabels(db, tenantId);
  const nfcByReportId = await readAiGraderNfcStatusesForReports({
    dbClient: db,
    tenantId,
    reports: rows.flatMap((row: any) => {
      const reportId = externalReportId(row);
      return reportId && optionalString(row?.report?.publicationStatus) === "published" ? [{
        reportId,
        reportRowId: optionalString(row?.report?.id),
        cardAssetId: optionalString(row?.report?.cardAssetId),
        itemId: optionalString(row?.report?.itemId),
        labelId: optionalString(row?.id),
        certId: optionalString(row?.certId),
      }] : [];
    }),
  });
  return buildAiGraderLabelSheetsResult(sourceRows(rows, nfcByReportId));
}

async function readFrozenLabelV1Sheet(input: {
  db: any;
  tenantId: string;
  sheetId: string;
  expectedRevision: string;
}) {
  const rows = await readTenantLabels(input.db, input.tenantId);
  const sources = sourceRows(rows);
  const sheet = buildAiGraderLabelSheetsResult(sources).sheets.find((candidate) => candidate.sheetId === input.sheetId);
  if (!sheet) throw runtimeError("AI Grader label sheet was not found.", 404, "AI_GRADER_LABEL_SHEET_NOT_FOUND");
  if (sheet.slotConflict) {
    throw runtimeError("AI Grader label sheet has a slot conflict and cannot be rendered.", 409, "AI_GRADER_LABEL_SHEET_SLOT_CONFLICT");
  }
  if (!input.expectedRevision || sheet.revision !== input.expectedRevision) {
    throw runtimeError("AI Grader label sheet changed. Refresh it before rendering.", 409, "AI_GRADER_LABEL_SHEET_REVISION_MISMATCH");
  }
  if (sheet.status !== "sealed" && sheet.status !== "printed") {
    throw runtimeError(
      "Prepare and seal the current AI Grader label sheet before requesting production output.",
      409,
      "AI_GRADER_LABEL_SHEET_NOT_SEALED"
    );
  }

  const templateDigestSha256 = aiGraderLabelV1TemplateDigest();
  const rowById = new Map(rows.map((row: any) => [optionalString(row.id), row]));
  let calibrationProfile: AiGraderLabelV1RuntimeRecord["calibrationProfile"] | undefined;
  const entries: AiGraderLabelV1SheetEntry[] = sheet.labels.map((label) => {
    const row = rowById.get(label.labelId);
    const payload = isRecord(row?.payload) ? row.payload : {};
    const persistedAssignment = parseAiGraderLabelSheetAssignment(payload);
    const labelV1 = parseAiGraderLabelV1RuntimeRecord(payload.labelV1, templateDigestSha256);
    if (!labelV1 || !persistedAssignment) {
      throw runtimeError(
        "AI Grader label is missing the approved immutable Label V1 template record.",
        409,
        "AI_GRADER_LABEL_V1_TEMPLATE_RECORD_INVALID"
      );
    }
    const snapshot = labelV1.renderSnapshot;
    if (calibrationProfile && !strictAiGraderLabelV1JsonEqual(calibrationProfile, labelV1.calibrationProfile)) {
      throw runtimeError(
        "AI Grader label sheet contains conflicting frozen calibration profiles.",
        409,
        "AI_GRADER_LABEL_V1_CALIBRATION_MISMATCH"
      );
    }
    calibrationProfile = labelV1.calibrationProfile;
    const persistedImmutableAssignment = {
      sheetId: persistedAssignment.sheetId,
      sheetNumber: persistedAssignment.sheetNumber,
      slot: persistedAssignment.slot,
      assignedAt: persistedAssignment.assignedAt,
    };
    if (
      label.publicationStatus !== "published" ||
      persistedAssignment.sheetId !== sheet.sheetId ||
      persistedAssignment.sheetNumber !== sheet.sheetNumber ||
      persistedAssignment.slot !== label.slot ||
      persistedAssignment.assignedAt !== label.assignedAt ||
      !strictAiGraderLabelV1JsonEqual(labelV1.immutableSheetAssignment, persistedImmutableAssignment) ||
      snapshot.reportId !== label.reportId ||
      snapshot.certId !== label.certId ||
      String(snapshot.grade) !== label.grade ||
      snapshot.publicReportUrl !== label.publicReportUrl ||
      !strictAiGraderLabelV1JsonEqual(labelV1.immutableIdentitySnapshot, label.confirmedCardIdentity)
    ) {
      throw runtimeError(
        "AI Grader label rows no longer match the immutable approved Label V1 snapshot.",
        409,
        "AI_GRADER_LABEL_V1_SNAPSHOT_MISMATCH"
      );
    }
    return { slot: label.slot, snapshot };
  });
  if (!calibrationProfile) {
    throw runtimeError("AI Grader label sheet contains no printable labels.", 409, "AI_GRADER_LABEL_SHEET_EMPTY");
  }
  return { sheet, entries, calibrationProfile };
}

async function labelV1SheetRenderAuthority(input: {
  tenantId: string;
  sheetId: string;
  expectedRevision: string;
  operatorUserId?: string | null;
  dbClient?: any;
}) {
  if (!input.operatorUserId) {
    throw runtimeError("A human operator session is required to render an AI Grader label sheet.", 403, "AI_GRADER_HUMAN_OPERATOR_REQUIRED");
  }
  const { prisma } = await import("@tenkings/database");
  return readFrozenLabelV1Sheet({
    db: input.dbClient ?? (prisma as any),
    tenantId: input.tenantId,
    sheetId: input.sheetId,
    expectedRevision: input.expectedRevision,
  });
}

export async function renderAiGraderLabelSheetPdfRuntime(input: {
  tenantId: string;
  sheetId: string;
  expectedRevision: string;
  operatorUserId?: string | null;
  dbClient?: any;
}): Promise<AiGraderRenderedLabelSheetFile> {
  const authority = await labelV1SheetRenderAuthority(input);
  const body = await renderAiGraderLabelSheetV1Pdf({
    entries: authority.entries,
    title: `Ten Kings Label V1 ${authority.sheet.sheetId} ${authority.sheet.revision}`,
    calibration: authority.calibrationProfile,
  });
  return {
    body,
    contentType: "application/pdf",
    fileName: `${authority.sheet.sheetId}-${authority.sheet.revision}.pdf`,
    revision: authority.sheet.revision,
  };
}

export async function renderAiGraderLabelSheetCutSvgRuntime(input: {
  tenantId: string;
  sheetId: string;
  expectedRevision: string;
  operatorUserId?: string | null;
  dbClient?: any;
}): Promise<AiGraderRenderedLabelSheetFile> {
  const authority = await labelV1SheetRenderAuthority(input);
  const body = Buffer.from(renderAiGraderLabelSheetCutSvg({ calibrationMarks: false, calibration: authority.calibrationProfile }), "utf8");
  return {
    body,
    contentType: "image/svg+xml",
    fileName: `${authority.sheet.sheetId}-${authority.sheet.revision}-cricut-cut.svg`,
    revision: authority.sheet.revision,
  };
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
