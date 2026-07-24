import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAiGraderFinishCardsQueueResult,
  discardAiGraderFinishCardRuntime,
  listProductionReportHistoryRuntime,
} from "../lib/server/aiGraderProductionApi";
import { deleteStorageObject } from "../lib/server/storage";

const reportId = "report-1";
const reportRowId = "report-row-1";
const sessionId = "session-row-1";
const gradingSessionId = "grading-session-1";
const queueItemId = "queue-item-1";
const cardAssetId = "card-1";
const itemId = "item-1";
const batchId = "batch-1";
const prefix = `ai-grader/reports/${reportId}/`;

test("Exact CardAsset storage deletion rejects traversal and prefix targets", async () => {
  await assert.rejects(deleteStorageObject("../shared-card.png"), /deletion key is invalid/i);
  await assert.rejects(deleteStorageObject("shared/card-assets/"), /deletion key is invalid/i);
});

function finishQueueRow(sessionStatus: string, reviewStage: string | null = null) {
  return {
    reportId,
    publicationStatus: "published",
    cardAssetId,
    itemId,
    session: { status: sessionStatus, reportId },
    cardAsset: { id: cardAssetId, reviewStage, customTitle: "Lifecycle card" },
    labels: [{ physicalPrintStatus: "not_printed" }],
    evidenceAssets: [],
    valuations: [],
  };
}

test("Finish Cards returns only published pre-inventory lifecycle rows", () => {
  const result = buildAiGraderFinishCardsQueueResult([
    finishQueueRow("published"),
    { ...finishQueueRow("inventory_ready"), reportId: "in-inventory", session: { status: "inventory_ready", reportId: "in-inventory" } },
    { ...finishQueueRow("published", "INVENTORY_READY_FOR_SALE"), reportId: "inconsistent", session: { status: "published", reportId: "inconsistent" } },
  ]);
  assert.deepEqual(result.items.map((item) => item.reportId), [reportId]);
  assert.equal("complete" in result.stats, false);
});

test("AI Grader History is tenant-scoped to cards that completed Add to Inventory", async () => {
  let receivedWhere: unknown;
  const result = await listProductionReportHistoryRuntime({
    tenantId: "tenant-a",
    dbClient: {
      aiGraderReport: {
        async findMany(query: { where: unknown }) {
          receivedWhere = query.where;
          return [{
            reportId,
            reportStatus: "completed",
            publicationStatus: "published",
            visibilityStatus: "public",
            publicReportUrl: `https://collect.tenkings.co/ai-grader/reports/${reportId}`,
            finalOverallGrade: 8.5,
            cardAssetId,
            itemId,
            publishedAt: new Date("2026-07-24T05:00:00.000Z"),
            session: { gradingSessionId },
          }];
        },
      },
      cardAsset: {
        async findMany() {
          return [{ id: cardAssetId, customTitle: "History card" }];
        },
      },
      item: {
        async findMany() {
          return [{ id: itemId, name: "History card", set: "Test Set", number: "7" }];
        },
      },
    },
  });
  assert.deepEqual(receivedWhere, {
    tenantId: "tenant-a",
    publicationStatus: "published",
    session: { is: { status: "inventory_ready" } },
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].cardTitle, "Test Set History card #7");
});

function discardDb(options: {
  sessionStatus?: string;
  failDatabaseDelete?: boolean;
  cardStorageKey?: string;
  sharedCardStorageCount?: number;
  identityReportId?: string;
} = {}) {
  const calls: string[] = [];
  const sessionStatus = options.sessionStatus ?? "published";
  const db: any = {
    calls,
    async $transaction(callback: (tx: any) => Promise<unknown>) {
      return callback(db);
    },
    async $queryRaw() {
      calls.push("lock");
      return [{ lockAcquired: 1 }];
    },
    aiGraderReport: {
      async findFirst() {
        return {
          id: reportRowId,
          tenantId: "ten-kings",
          sessionId,
          reportId,
          publicationStatus: "published",
          cardAssetId,
          itemId,
          reportBundleStorageKey: `${prefix}report-bundle.json`,
          productionReleaseStorageKey: `${prefix}production-release.json`,
          labelDataStorageKey: `${prefix}label-data.json`,
          assetManifestStorageKey: `${prefix}asset-manifest.json`,
          reportHtmlStorageKey: `${prefix}index.html`,
          session: {
            id: sessionId,
            gradingSessionId,
            reportId,
            status: sessionStatus,
            cardAssetId,
            itemId,
            reports: [{ id: reportRowId }],
          },
          publication: {
            storageKeyPrefix: prefix,
            reportBundleStorageKey: `${prefix}report-bundle.json`,
          },
          evidenceAssets: [{ id: "evidence-1", storageKey: `${prefix}evidence/front.png` }],
        };
      },
      async count() {
        return 0;
      },
      async deleteMany() {
        calls.push("delete-report");
        if (options.failDatabaseDelete) throw new Error("database delete failed");
        return { count: 1 };
      },
    },
    aiGraderSession: {
      async count() {
        return 0;
      },
      async deleteMany() {
        calls.push("delete-session");
        return { count: 1 };
      },
    },
    cardAsset: {
      async findUnique() {
        const identityReportId = options.identityReportId ?? reportId;
        const rapidQueueIdentity = { queueItemId, gradingSessionId, reportId: identityReportId };
        return {
          id: cardAssetId,
          batchId,
          storageKey: options.cardStorageKey ?? `${prefix}normalized/front.png`,
          reviewStage: "REVIEW_COMPLETE",
          classificationSourcesJson: {
            source: "ai_grader_confirmed_identity",
            reportId: identityReportId,
            rapidQueueIdentity,
          },
          aiGradingJson: {
            source: "ai_grader_new_card_intake_v0",
            reportId: identityReportId,
            rapidQueueIdentity,
          },
        };
      },
      async count() {
        return options.sharedCardStorageCount ?? 0;
      },
      async deleteMany() {
        calls.push("delete-card");
        return { count: 1 };
      },
    },
    cardBatch: {
      async findUnique() {
        return {
          id: batchId,
          notes: `Created from AI Grader report ${reportId}`,
          totalCount: 1,
          processedCount: 1,
          status: "READY",
          tags: ["ai-grader", "new-card-intake"],
          cards: [{ id: cardAssetId }],
          packLabels: [],
          sourcePacks: [],
        };
      },
      async deleteMany() {
        calls.push("delete-batch");
        return { count: 1 };
      },
    },
    item: {
      async findUnique() {
        return {
          id: itemId,
          number: cardAssetId,
          cardQrCodeId: null,
          ownerships: [{ id: "ownership-1", note: `Linked from confirmed AI Grader card asset ${cardAssetId}` }],
          _count: {
            listings: 0,
            packSlots: 0,
            ingestionTask: 0,
            shippingRequest: 0,
            kioskReveals: 0,
            goldenTicketPrize: 0,
            packLabels: 0,
          },
        };
      },
      async deleteMany() {
        calls.push("delete-item");
        return { count: 1 };
      },
    },
    aiGraderNfcTag: {
      async findMany() { return []; },
      async deleteMany() { return { count: 0 }; },
    },
    aiGraderNfcAuditEvent: { async deleteMany() { return { count: 0 }; } },
    aiGraderNfcProgrammingAttempt: { async deleteMany() { return { count: 0 }; } },
    aiGraderEvidenceAsset: {
      async deleteMany() {
        calls.push("delete-evidence");
        return { count: 1 };
      },
    },
  };
  return db;
}

test("Discard erases exact hosted storage and exclusive pre-inventory lifecycle rows", async () => {
  const db = discardDb();
  const storageCalls: string[] = [];
  const result = await discardAiGraderFinishCardRuntime({
    tenantId: "ten-kings",
    reportId,
    operatorUserId: "operator-1",
    dbClient: db,
    async deleteStoragePrefix(storagePrefix) {
      storageCalls.push(storagePrefix);
      return { storagePrefix, listedObjectCount: 8, deletedObjectCount: 8 };
    },
    async deleteStorageObject(storageKey) {
      storageCalls.push(storageKey);
      return { storageKey, deleteRequestCompleted: true };
    },
  });
  assert.deepEqual(storageCalls, [prefix]);
  assert.equal(result.databaseDeleted, true);
  assert.equal(result.deleted.report, 1);
  assert.equal(result.deleted.session, 1);
  assert.equal(result.deleted.cardAsset, 1);
  assert.equal(result.deleted.item, 1);
  assert.equal(result.deleted.cardBatch, 1);
});

test("Discard accepts an exclusively-owned CardAsset object outside the report prefix and deletes both exact storage identities", async () => {
  const cardStorageKey = `card-assets/${cardAssetId}/normalized-front.png`;
  const db = discardDb({ cardStorageKey });
  const storageCalls: string[] = [];
  const result = await discardAiGraderFinishCardRuntime({
    tenantId: "ten-kings",
    reportId,
    operatorUserId: "operator-1",
    dbClient: db,
    async deleteStoragePrefix(storagePrefix) {
      storageCalls.push(storagePrefix);
      return { storagePrefix, listedObjectCount: 8, deletedObjectCount: 8 };
    },
    async deleteStorageObject(storageKey) {
      storageCalls.push(storageKey);
      return { storageKey, deleteRequestCompleted: true };
    },
  });
  assert.deepEqual(storageCalls, [prefix, cardStorageKey]);
  assert.equal(result.cardAssetStorage?.storageKey, cardStorageKey);
  assert.equal(result.databaseDeleted, true);
});

test("Discard rejects an external CardAsset object shared by another card before touching storage", async () => {
  const db = discardDb({
    cardStorageKey: `card-assets/${cardAssetId}/normalized-front.png`,
    sharedCardStorageCount: 1,
  });
  let storageCalls = 0;
  await assert.rejects(
    discardAiGraderFinishCardRuntime({
      tenantId: "ten-kings",
      reportId,
      operatorUserId: "operator-1",
      dbClient: db,
      async deleteStoragePrefix(storagePrefix) {
        storageCalls += 1;
        return { storagePrefix, listedObjectCount: 0, deletedObjectCount: 0 };
      },
      async deleteStorageObject(storageKey) {
        storageCalls += 1;
        return { storageKey, deleteRequestCompleted: true };
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === "AI_GRADER_DISCARD_CARD_STORAGE_SHARED",
  );
  assert.equal(storageCalls, 0);
});

test("Discard rejects a CardAsset whose duplicated report identity does not match before touching storage", async () => {
  const db = discardDb({
    cardStorageKey: `card-assets/${cardAssetId}/normalized-front.png`,
    identityReportId: "different-report",
  });
  let storageCalls = 0;
  await assert.rejects(
    discardAiGraderFinishCardRuntime({
      tenantId: "ten-kings",
      reportId,
      operatorUserId: "operator-1",
      dbClient: db,
      async deleteStoragePrefix(storagePrefix) {
        storageCalls += 1;
        return { storagePrefix, listedObjectCount: 0, deletedObjectCount: 0 };
      },
      async deleteStorageObject(storageKey) {
        storageCalls += 1;
        return { storageKey, deleteRequestCompleted: true };
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === "AI_GRADER_DISCARD_CARD_OWNERSHIP_UNPROVEN",
  );
  assert.equal(storageCalls, 0);
});

test("Discard is lifecycle locked out after Add to Inventory and never touches storage", async () => {
  const db = discardDb({ sessionStatus: "inventory_ready" });
  let storageCalls = 0;
  await assert.rejects(
    discardAiGraderFinishCardRuntime({
      tenantId: "ten-kings",
      reportId,
      operatorUserId: "operator-1",
      dbClient: db,
      async deleteStoragePrefix(storagePrefix) {
        storageCalls += 1;
        return { storagePrefix, listedObjectCount: 0, deletedObjectCount: 0 };
      },
      async deleteStorageObject(storageKey) {
        storageCalls += 1;
        return { storageKey, deleteRequestCompleted: true };
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === "AI_GRADER_DISCARD_INVENTORY_READY",
  );
  assert.equal(storageCalls, 0);
});

test("Discard reports a truthful retryable partial result when storage is gone but database cleanup fails", async () => {
  const cardStorageKey = `card-assets/${cardAssetId}/normalized-front.png`;
  const db = discardDb({ failDatabaseDelete: true, cardStorageKey });
  await assert.rejects(
    discardAiGraderFinishCardRuntime({
      tenantId: "ten-kings",
      reportId,
      operatorUserId: "operator-1",
      dbClient: db,
      async deleteStoragePrefix(storagePrefix) {
        return { storagePrefix, listedObjectCount: 8, deletedObjectCount: 8 };
      },
      async deleteStorageObject(storageKey) {
        return { storageKey, deleteRequestCompleted: true };
      },
    }),
    (error: unknown) => {
      const typed = error as Error & {
        code?: string;
        partialResult?: {
          databaseDeleted?: boolean;
          retryable?: boolean;
          cardAssetStorage?: { storageKey?: string; deleteRequestCompleted?: boolean };
        };
      };
      return typed.code === "AI_GRADER_DISCARD_PARTIAL_FAILURE" &&
        typed.partialResult?.databaseDeleted === false &&
        typed.partialResult?.retryable === true &&
        typed.partialResult?.cardAssetStorage?.storageKey === cardStorageKey &&
        typed.partialResult?.cardAssetStorage?.deleteRequestCompleted === true;
    },
  );
});
