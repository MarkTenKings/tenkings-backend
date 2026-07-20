import { PrismaClient } from "@prisma/client";
import {
  aiGraderSha256,
  buildAiGraderConfirmCardReferencePlan,
  buildAiGraderProductionStoragePlan,
  persistAiGraderProductionRelease,
  persistAiGraderSlabbedPhotoAsset,
} from "@tenkings/database";
import {
  addAiGraderCardToInventoryRuntime,
  createAiGraderCardFromReportRuntime,
  persistAiGraderCompsRuntime,
  persistAiGraderSelectedCompsRuntime,
  persistProductionReleaseRuntime,
} from "../lib/server/aiGraderProductionApi";
import {
  listAiGraderLabelSheetsRuntime,
  markAiGraderLabelSheetPrintedRuntime,
  prepareAiGraderLabelSheetPrintRuntime,
} from "../lib/server/aiGraderLabelSheetRuntime";

const EXPECTED_DATABASE = "tenkings_ai_grader_nfc_validation";
const EXPECTED_USER = "tenkings_nfc_validation";
const TENANT_ID = "advisory-lock-validation-tenant";
const ACTOR_ID = "advisory-lock-validation-user";
const REPORT_ID = "advisory-lock-validation-report";
const GRADING_SESSION_ID = "advisory-lock-validation-session";
const QUEUE_ITEM_ID = "advisory-lock-validation-queue-item";
const CERT_ID = "AIG-ADVISORY-LOCK-VALIDATION";
const NOW = new Date("2026-07-17T16:00:00.000Z");
const inventoryEnv = {
  OPERATOR_USER_ID: ACTOR_ID,
  AI_GRADER_NFC_REQUIRED: "false",
};

type LockFamily = "report" | "label";

function requireProof(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`AI_GRADER_ADVISORY_LOCK_VALIDATION_${code}`);
}

function assertDisposableDatabaseTarget() {
  requireProof(process.env.AI_GRADER_NFC_DISPOSABLE_VALIDATION === "1", "DISPOSABLE_ACK_REQUIRED");
  requireProof(typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0, "DATABASE_URL_REQUIRED");
  let parsed: URL;
  try {
    parsed = new URL(process.env.DATABASE_URL);
  } catch {
    throw new Error("AI_GRADER_ADVISORY_LOCK_VALIDATION_DATABASE_URL_INVALID");
  }
  requireProof(parsed.protocol === "postgresql:" || parsed.protocol === "postgres:", "DATABASE_PROTOCOL_REFUSED");
  requireProof(parsed.hostname === "127.0.0.1", "DATABASE_HOST_REFUSED");
  requireProof(decodeURIComponent(parsed.username) === EXPECTED_USER, "DATABASE_USER_REFUSED");
  requireProof(decodeURIComponent(parsed.pathname.slice(1)) === EXPECTED_DATABASE, "DATABASE_NAME_REFUSED");
}

function confirmedIdentity() {
  return {
    category: "sport" as const,
    title: "1996 Topps Michael Jordan #23",
    playerName: "Michael Jordan",
    year: "1996",
    manufacturer: "Topps",
    sport: "basketball",
    productSet: "Topps",
    productLine: "Topps",
    set: "Topps",
    cardNumber: "23",
    parallel: "Base",
    autograph: false,
    memorabilia: false,
    sideCount: 2,
  };
}

function productionPackage() {
  const identity = confirmedIdentity();
  const frontBytes = Buffer.from("disposable advisory lock validation front", "utf8");
  const backBytes = Buffer.from("disposable advisory lock validation back", "utf8");
  const reportBundle = {
    schemaVersion: "ai-grader-report-bundle-v0.1",
    gradingSessionId: GRADING_SESSION_ID,
    reportId: REPORT_ID,
    generatedAt: NOW.toISOString(),
    reportStatus: "final_ai_grader_report_v0",
    certifiedClaim: false,
    certificateGenerated: false,
    cardIdentity: identity,
    provisionalGrade: {},
    visionLab: {
      findingValidation: {
        status: "valid",
        sourceCandidateCount: 0,
        publishedFindingCount: 0,
        issues: [],
      },
      defectFindings: [],
    },
    assets: [
      {
        id: "report/front/front-normalized-card.png",
        kind: "image",
        fileName: "front-normalized-card.png",
        contentType: "image/png",
        checksumSha256: aiGraderSha256(frontBytes),
        byteSize: frontBytes.length,
        widthPx: 1200,
        heightPx: 1680,
        side: "front",
        evidenceRole: "normalized_card",
      },
      {
        id: "report/back/back-normalized-card.png",
        kind: "image",
        fileName: "back-normalized-card.png",
        contentType: "image/png",
        checksumSha256: aiGraderSha256(backBytes),
        byteSize: backBytes.length,
        widthPx: 1200,
        heightPx: 1680,
        side: "back",
        evidenceRole: "normalized_card",
      },
    ],
    warnings: [],
  };
  const productionRelease = {
    schemaVersion: "ai-grader-production-release-v0.1",
    generatedAt: NOW.toISOString(),
    gradingSessionId: GRADING_SESSION_ID,
    reportId: REPORT_ID,
    reportStatus: "final_ai_grader_report_v0",
    finalStatus: "final_grade_computed",
    finalGradeComputed: true,
    labelDataGenerated: true,
    qrPayloadGenerated: true,
    certifiedClaim: false,
    certificateGenerated: false,
    finalGrade: {
      status: "final_ai_grader_grade_v0",
      finalGradeComputed: true,
      certifiedClaim: false,
      overall: 8.6,
      elements: {
        centering: { score: 9.2, confidence: "high", explanation: "Disposable validation centering." },
        corners: { score: 8.8, confidence: "high", explanation: "Disposable validation corners." },
        edges: { score: 8.6, confidence: "high", explanation: "Disposable validation edges." },
        surface: { score: 8.1, confidence: "medium", explanation: "Disposable validation surface." },
      },
      confidence: { score: 0.81, band: "high", warnings: [] },
      gradeImpactReasons: [],
      whyNot10: [],
    },
    label: {
      status: "label_data_ready",
      labelVersion: "ten-kings-ai-grader-label-v0",
      certId: CERT_ID,
      reportId: REPORT_ID,
      publicReportUrl: `https://collect.tenkings.co/ai-grader/reports/${REPORT_ID}`,
      qrPayloadUrl: `https://collect.tenkings.co/ai-grader/reports/${REPORT_ID}`,
      labelGradeText: "8.6",
      elementScores: { centering: 9.2, corners: 8.8, edges: 8.6, surface: 8.1 },
      certificateStatus: "report_id_issued_not_certified",
      cardIdentity: identity,
      certifiedClaim: false,
    },
    operatorFinalization: {
      operatorId: ACTOR_ID,
      finalizedAt: NOW.toISOString(),
      warningsAccepted: true,
      acceptedWarningGateIds: [],
    },
    gates: [{
      id: "disposable_evidence_complete",
      label: "Disposable evidence complete",
      status: "pass",
      reason: "Both disposable normalized-card evidence sides are present.",
      evidenceRefs: ["report/front/front-normalized-card.png", "report/back/back-normalized-card.png"],
    }],
    warnings: [],
    ebayCompsContract: { status: "not_run", compsRefs: [] },
    publication: {
      status: "local_bundle_ready",
      reportId: REPORT_ID,
      publicReportUrl: `https://collect.tenkings.co/ai-grader/reports/${REPORT_ID}`,
      qrPayloadUrl: `https://collect.tenkings.co/ai-grader/reports/${REPORT_ID}`,
      storageMode: "local_artifact_only",
      dbWritesPerformed: false,
      uploadPerformed: false,
      storageKeyPrefix: `ai-grader/reports/${REPORT_ID}/`,
    },
  };
  return {
    identity,
    reportBundle: { ...reportBundle, productionRelease },
    productionRelease,
  };
}

function lockCounts() {
  return { report: 0, label: 0 } satisfies Record<LockFamily, number>;
}

async function main() {
  assertDisposableDatabaseTarget();
  const observedLocks = lockCounts();
  const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  (prisma as any).$on("query", (event: { query?: string }) => {
    const query = event.query ?? "";
    if (!query.includes("pg_advisory_xact_lock")) return;
    requireProof(/SELECT\s+1\s+AS\s+"lockAcquired"\s+FROM\s+pg_advisory_xact_lock/i.test(query), "VOID_PROJECTION_OBSERVED");
    if (query.includes("ai-grader-report-lifecycle")) observedLocks.report += 1;
    if (query.includes("ai-grader-label-sheets")) observedLocks.label += 1;
  });

  const requireLockDelta = async <T>(
    expected: Partial<Record<LockFamily, number>>,
    operation: () => Promise<T>,
    proofCode: string,
  ) => {
    const before = { ...observedLocks };
    const result = await operation();
    for (const family of ["report", "label"] as const) {
      const expectedDelta = expected[family] ?? 0;
      requireProof(observedLocks[family] - before[family] === expectedDelta, `${proofCode}_${family.toUpperCase()}_LOCK_COUNT`);
    }
    return result;
  };

  const holdLockAndRequireBlocking = async <T>(
    family: LockFamily,
    lockIdentity: string,
    operation: () => Promise<T>,
    proofCode: string,
  ) => {
    let signalAcquired!: () => void;
    let releaseLock!: () => void;
    const acquired = new Promise<void>((resolve) => { signalAcquired = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const holder = prisma.$transaction(async (tx: any) => {
      if (family === "report") {
        await tx.$queryRaw`
          SELECT 1 AS "lockAcquired"
          FROM pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${lockIdentity}))
        `;
      } else {
        await tx.$queryRaw`
          SELECT 1 AS "lockAcquired"
          FROM pg_advisory_xact_lock(hashtext('ai-grader-label-sheets'), hashtext(${lockIdentity}))
        `;
      }
      signalAcquired();
      await release;
    });
    await acquired;
    let settled = false;
    let operationError: unknown;
    const pending = operation()
      .catch((error) => {
        operationError = error;
        return undefined;
      })
      .finally(() => { settled = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      requireProof(!settled, `${proofCode}_DID_NOT_BLOCK`);
    } finally {
      releaseLock();
    }
    await holder;
    const result = await pending;
    if (operationError) throw operationError;
    return result as T;
  };

  try {
    await prisma.user.upsert({
      where: { id: ACTOR_ID },
      update: { role: "admin" },
      create: { id: ACTOR_ID, role: "admin", createdAt: NOW },
    });
    const { identity, reportBundle, productionRelease } = productionPackage();
    const confirmPlan = buildAiGraderConfirmCardReferencePlan({
      reportBundle,
      productionRelease,
      publicReportBaseUrl: "https://collect.tenkings.co",
    });
    // Card creation owns one report lifecycle lock; publication and label finalization
    // intentionally exercise their separate report and label locks below.
    const created = await requireLockDelta(
      { report: 1 },
      () => createAiGraderCardFromReportRuntime({
        queueItemId: QUEUE_ITEM_ID,
        tenantId: TENANT_ID,
        reportBundle,
        productionRelease,
        storagePlan: confirmPlan,
        identity,
        operatorUserId: ACTOR_ID,
        dbClient: prisma,
        env: inventoryEnv,
      }),
      "CONFIRMED_CARD",
    );
    requireProof(created.reportId === REPORT_ID, "CONFIRMED_REPORT_ID");
    requireProof(created.cardAssetId.length > 0 && created.itemId.length > 0, "CONFIRMED_CARD_ITEM_LINKAGE");

    const storagePlan = buildAiGraderProductionStoragePlan({
      reportBundle,
      productionRelease: created.productionRelease,
      publicReportBaseUrl: "https://collect.tenkings.co",
    });
    let injectedFailureReached = false;
    const injectedDb = new Proxy(prisma as any, {
      get(target, property) {
        if (property === "$transaction") {
          return (callback: (tx: any) => Promise<unknown>) => prisma.$transaction(async (tx: any) => {
            const injectedTx = new Proxy(tx as any, {
              get(transactionTarget, transactionProperty) {
                if (transactionProperty === "cardBatch") {
                  const delegate = transactionTarget.cardBatch;
                  return new Proxy(delegate, {
                    get(delegateTarget, delegateProperty) {
                      if (delegateProperty === "updateMany") {
                        return async (args: unknown) => {
                          await delegateTarget.updateMany(args);
                          injectedFailureReached = true;
                          const error = new Error("Injected late publication failure.") as Error & { code?: string };
                          error.code = "AI_GRADER_ADVISORY_LOCK_INJECTED_ROLLBACK";
                          throw error;
                        };
                      }
                      const value = Reflect.get(delegateTarget, delegateProperty, delegateTarget);
                      return typeof value === "function" ? value.bind(delegateTarget) : value;
                    },
                  });
                }
                const value = Reflect.get(transactionTarget, transactionProperty, transactionTarget);
                return typeof value === "function" ? value.bind(transactionTarget) : value;
              },
            });
            return callback(injectedTx);
          });
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const beforeFailedPublish = { ...observedLocks };
    let failedPublishCode = "";
    let failedPublishDiagnostic = "UNKNOWN";
    try {
      await persistProductionReleaseRuntime({
        queueItemId: QUEUE_ITEM_ID,
        tenantId: TENANT_ID,
        reportBundle,
        productionRelease: created.productionRelease,
        storagePlan,
        publicationStatus: "published",
        operatorUserId: ACTOR_ID,
        cardAssetId: created.cardAssetId,
        itemId: created.itemId,
        dbClient: injectedDb,
        persistRelease: persistAiGraderProductionRelease,
      });
    } catch (error) {
      failedPublishCode = typeof (error as { code?: unknown })?.code === "string"
        ? String((error as { code: string }).code)
        : "";
      const diagnostic = failedPublishCode || (error instanceof Error ? error.name : "UNKNOWN");
      failedPublishDiagnostic = diagnostic.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 80) || "UNKNOWN";
    }
    if (!injectedFailureReached) {
      requireProof(false, `INJECTED_FAILURE_NOT_REACHED_${failedPublishDiagnostic}`);
    }
    requireProof(failedPublishCode === "AI_GRADER_ADVISORY_LOCK_INJECTED_ROLLBACK", "INJECTED_FAILURE_CODE");
    requireProof(observedLocks.report - beforeFailedPublish.report === 2, "FAILED_PUBLISH_REPORT_LOCK_COUNT");
    requireProof(observedLocks.label - beforeFailedPublish.label === 2, "FAILED_PUBLISH_LABEL_LOCK_COUNT");

    const [rolledBackSession, rolledBackReport, rolledBackCard, rolledBackBatch, rollbackCounts] = await Promise.all([
      prisma.aiGraderSession.findUniqueOrThrow({ where: { gradingSessionId: GRADING_SESSION_ID } }),
      prisma.aiGraderReport.findUnique({ where: { reportId: REPORT_ID } }),
      prisma.cardAsset.findUniqueOrThrow({ where: { id: created.cardAssetId } }),
      prisma.cardBatch.findUniqueOrThrow({ where: { id: created.batchId } }),
      Promise.all([
        prisma.aiGraderGrade.count({ where: { tenantId: TENANT_ID } }),
        prisma.aiGraderLabel.count({ where: { tenantId: TENANT_ID } }),
        prisma.aiGraderPublication.count({ where: { tenantId: TENANT_ID } }),
        prisma.aiGraderEvidenceAsset.count({ where: { tenantId: TENANT_ID } }),
      ]),
    ]);
    requireProof(rolledBackSession.status === "card_created", "ROLLBACK_SESSION_STATE");
    requireProof(rolledBackReport === null, "ROLLBACK_REPORT_ROW_ABSENT");
    requireProof(rolledBackCard.status === "UPLOADING" && rolledBackCard.imageUrl === "", "ROLLBACK_CARD_STATE");
    requireProof(rolledBackBatch.status === "UPLOADING" && rolledBackBatch.processedCount === 0, "ROLLBACK_BATCH_STATE");
    requireProof(rollbackCounts.every((count: number) => count === 0), "ROLLBACK_PARTIAL_ROWS");

    const published = await requireLockDelta(
      { report: 2, label: 2 },
      () => persistProductionReleaseRuntime({
        queueItemId: QUEUE_ITEM_ID,
        tenantId: TENANT_ID,
        reportBundle,
        productionRelease: created.productionRelease,
        storagePlan,
        publicationStatus: "published",
        operatorUserId: ACTOR_ID,
        cardAssetId: created.cardAssetId,
        itemId: created.itemId,
        dbClient: prisma,
      }),
      "ATOMIC_PUBLISH",
    );
    requireProof(published.publicationStatus === "published", "PUBLICATION_STATUS");
    requireProof(published.labelSheetAssignment?.slot === 1, "LABEL_V1_ASSIGNMENT");
    const durablePublishedRows = await Promise.all([
      prisma.aiGraderSession.findUniqueOrThrow({ where: { gradingSessionId: GRADING_SESSION_ID } }),
      prisma.aiGraderReport.findUniqueOrThrow({ where: { reportId: REPORT_ID } }),
      prisma.aiGraderPublication.findUniqueOrThrow({ where: { reportId: REPORT_ID } }),
      prisma.aiGraderLabel.findUniqueOrThrow({ where: { certId: CERT_ID } }),
    ]);
    requireProof(durablePublishedRows[0].status === "published", "DURABLE_SESSION_PUBLISHED");
    requireProof(durablePublishedRows[1].publicationStatus === "published", "DURABLE_REPORT_PUBLISHED");
    requireProof(durablePublishedRows[2].status === "published", "DURABLE_PUBLICATION_PUBLISHED");
    requireProof(JSON.stringify(durablePublishedRows[3].payload).includes("ai-grader-label-sheet-v1"), "DURABLE_LABEL_V1_PAYLOAD");

    const candidate = {
      id: "advisory-lock-validation-comp",
      source: "ebay_sold",
      title: "Disposable validation sold comp",
      url: "https://www.ebay.com/itm/123456789012",
      price: "$125.00",
      soldDate: "2026-07-16",
      matchScore: 0.99,
      matchQuality: "exact",
    };
    await requireLockDelta(
      { report: 1 },
      () => persistAiGraderCompsRuntime({
        tenantId: TENANT_ID,
        reportId: REPORT_ID,
        status: "running",
        attemptId: "advisory-lock-validation-attempt",
        dbClient: prisma,
      }),
      "COMPS_RUNNING",
    );
    await requireLockDelta(
      { report: 1 },
      () => persistAiGraderCompsRuntime({
        tenantId: TENANT_ID,
        reportId: REPORT_ID,
        status: "ready",
        attemptId: "advisory-lock-validation-attempt",
        compsRefs: [candidate],
        resultSummary: {
          lifecycleStatus: "ready",
          searchUrl: "https://www.ebay.com/sch/i.html?_nkw=disposable+validation",
          count: 1,
        },
        dbClient: prisma,
      }),
      "COMPS_READY",
    );
    const valuation = await requireLockDelta(
      { report: 1 },
      () => persistAiGraderSelectedCompsRuntime({
        tenantId: TENANT_ID,
        reportId: REPORT_ID,
        selectedComps: [candidate],
        requestedByUserId: ACTOR_ID,
        dbClient: prisma,
      }),
      "SELECTED_COMPS",
    );
    requireProof(valuation.valuationMinor === 12_500, "SELECTED_COMPS_VALUATION");

    const sheets = await listAiGraderLabelSheetsRuntime({ dbClient: prisma, tenantId: TENANT_ID });
    const assignedSheet = sheets.sheets.find((sheet) => sheet.sheetId === published.labelSheetAssignment?.sheetId);
    requireProof(assignedSheet, "ASSIGNED_SHEET_NOT_FOUND");
    const prepared = await requireLockDelta(
      { label: 1 },
      () => prepareAiGraderLabelSheetPrintRuntime({
        tenantId: TENANT_ID,
        sheetId: assignedSheet.sheetId,
        expectedRevision: assignedSheet.revision,
        operatorUserId: ACTOR_ID,
        dbClient: prisma,
      }),
      "LABEL_SHEET_SEAL",
    );
    const printed = await requireLockDelta(
      { label: 1 },
      () => markAiGraderLabelSheetPrintedRuntime({
        tenantId: TENANT_ID,
        sheetId: prepared.sheet.sheetId,
        expectedRevision: prepared.sheet.revision,
        operatorUserId: ACTOR_ID,
        dbClient: prisma,
      }),
      "LABEL_SHEET_PRINT",
    );
    requireProof(printed.printedLabelCount === 1 && printed.sheet.status === "printed", "LABEL_SHEET_PRINTED");

    for (const side of ["front", "back"] as const) {
      await persistAiGraderSlabbedPhotoAsset(prisma as any, {
        tenantId: TENANT_ID,
        reportId: REPORT_ID,
        side,
        storageKey: `disposable/advisory-lock-validation/slabbed-${side}.jpg`,
        publicUrl: `https://collect.tenkings.co/storage/disposable/advisory-lock-validation/slabbed-${side}.jpg`,
        mimeType: "image/jpeg",
        byteSize: 64,
        checksumSha256: aiGraderSha256(`disposable slabbed ${side}`),
        widthPx: 1200,
        heightPx: 1680,
        operatorUserId: ACTOR_ID,
      });
    }

    const inventoryInput = {
      tenantId: TENANT_ID,
      reportId: REPORT_ID,
      operatorUserId: ACTOR_ID,
      dbClient: prisma,
      env: inventoryEnv,
    };
    const inventory = await holdLockAndRequireBlocking(
      "report",
      REPORT_ID,
      () => addAiGraderCardToInventoryRuntime(inventoryInput),
      "INVENTORY_REPORT_LOCK",
    );
    requireProof(inventory.reportId === REPORT_ID && inventory.cardAssetId === created.cardAssetId, "INVENTORY_LINKAGE");
    await holdLockAndRequireBlocking(
      "label",
      TENANT_ID,
      () => addAiGraderCardToInventoryRuntime(inventoryInput),
      "INVENTORY_LABEL_LOCK",
    );

    const [inventoryCard, inventorySession, inventoryReport, inventoryLabelPairs] = await Promise.all([
      prisma.cardAsset.findUniqueOrThrow({ where: { id: created.cardAssetId } }),
      prisma.aiGraderSession.findUniqueOrThrow({ where: { gradingSessionId: GRADING_SESSION_ID } }),
      prisma.aiGraderReport.findUniqueOrThrow({ where: { reportId: REPORT_ID } }),
      prisma.packLabel.count({ where: { itemId: created.itemId } }),
    ]);
    requireProof(inventoryCard.reviewStage === "INVENTORY_READY_FOR_SALE", "INVENTORY_CARD_STATE");
    requireProof(inventorySession.status === "inventory_ready", "INVENTORY_SESSION_STATE");
    requireProof(
      inventoryReport.reportStatus === "final_ai_grader_report_v0" && inventoryReport.publicationStatus === "published",
      "INVENTORY_REPORT_STATE",
    );
    requireProof(inventoryLabelPairs === 1, "INVENTORY_IDEMPOTENT_LABEL_PAIR");
    requireProof(observedLocks.report >= 12 && observedLocks.label >= 9, "ALL_LOCK_PATHS_NOT_OBSERVED");
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log("AI_GRADER_ADVISORY_LOCK_REAL_POSTGRES_VALIDATION_PASS");
  })
  .catch((error) => {
    const normalizedCode = typeof (error as { code?: unknown })?.code === "string"
      ? String((error as { code: string }).code).toUpperCase().replace(/[^A-Z0-9_]+/g, "_").slice(0, 80)
      : "";
    const message = error instanceof Error && /^AI_GRADER_ADVISORY_LOCK_VALIDATION_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : `AI_GRADER_ADVISORY_LOCK_VALIDATION_UNEXPECTED_FAILURE_${normalizedCode || "ERROR"}`;
    console.error(message);
    process.exitCode = 1;
  });
