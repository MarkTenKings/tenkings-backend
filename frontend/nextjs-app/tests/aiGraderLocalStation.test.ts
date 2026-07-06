import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import aiGraderLocalStationHandler from "../pages/api/ai-grader/station/[...action]";
import {
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
  buildSampleAiGraderReportHistory,
  buildAiGraderLocalStationStatus,
  parseAiGraderStationAction,
} from "../lib/aiGraderLocalStation";
import { SAMPLE_AI_GRADER_REPORT_BUNDLE, getAiGraderReportBundle, hasNoCertifiedClaim, hasNoFinalCertifiedClaims } from "../lib/aiGraderReportBundle";
import { buildSampleAiGraderProductionRelease } from "../lib/aiGraderProductionRelease";
import {
  AI_GRADER_EBAY_COMPS_ENABLED_ENV,
  AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV,
  AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV,
  buildAiGraderProductionHistoryResult,
  createAiGraderProductionApiHandler,
  createAiGraderPublicReportApiHandler,
} from "../lib/server/aiGraderProductionApi";
import {
  AI_GRADER_OPERATOR_USER_IDS_ENV,
  AI_GRADER_SERVICE_ACCOUNT_ID_ENV,
  AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV,
  AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV,
} from "../lib/server/aiGraderProductionAuth";
import {
  DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
  fetchAiGraderStationBridgeHealth,
  fetchAiGraderStationPreviewStatus,
  fetchAiGraderStationReportHtml,
  normalizeAiGraderStationBridgeUrl,
  openAiGraderStationPreviewStream,
  pairAiGraderStationBridge,
  stopAiGraderStationPreview,
} from "../lib/aiGraderStationBridgeClient";

type MockResponse = NextApiResponse & {
  statusCodeValue: number | null;
  headers: Record<string, string | number | readonly string[]>;
  jsonBody: unknown;
};

function mockRequest(method: string, action?: string[]): NextApiRequest {
  return {
    method,
    query: action ? { action } : {},
    body: {},
    headers: {},
  } as NextApiRequest;
}

function mockResponse(): MockResponse {
  return {
    statusCodeValue: null,
    headers: {},
    jsonBody: undefined,
    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers[name] = value;
      return this;
    },
    status(statusCode: number) {
      this.statusCodeValue = statusCode;
      return this;
    },
    json(body: unknown) {
      this.jsonBody = body;
      return this;
    },
  } as MockResponse;
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("local station contract exposes workflow status with no login, DB, or hardware actions", () => {
  const status = buildAiGraderLocalStationStatus({ action: "status", now: "test" });

  assert.equal(status.bridgeVersion, AI_GRADER_LOCAL_STATION_BRIDGE_VERSION);
  assert.equal(status.loginRequired, false);
  assert.equal(status.hardwareActionsEnabled, false);
  assert.equal(status.safety.databaseWrites, false);
  assert.equal(status.safety.hardwareAccessed, false);
  assert.equal(status.safety.finalGradeComputed, false);
  assert.equal(status.safety.certifiedClaim, false);
  assert.equal(status.bridgeContract.endpoints.some((endpoint) => endpoint.path === "/api/ai-grader/station/capture-front"), true);
  assert.equal(status.bridgeContract.endpoints.every((endpoint) => endpoint.hardwareAccess === false), true);
  assert.equal(status.previewStatus.browserEmbedded, true);
  assert.equal(status.previewStatus.localOnly, true);
  assert.equal(status.previewStatus.safety.productionServiceTokenUsed, false);
  assert.equal(status.previewStatus.safety.publicRouteExposed, false);
  assert.equal(status.warmRunnerStatus.mode, "full_forensic");
  assert.equal(status.executionPath, "warm_full_forensic_runner");
  assert.equal(status.fallbackUsed, false);
  assert.equal(status.warmRunnerStatus.executionPath, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.backend, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.fallbackUsed, false);
  assert.equal(status.warmRunnerStatus.fallback.active, false);
  assert.equal(status.timingSummary?.executionPath, "warm_full_forensic_runner");
  assert.equal(status.timingSummary?.fallbackUsed, false);
  assert.equal(status.warmRunnerStatus.evidencePlan.defaultFullForensic, true);
  assert.deepEqual(status.warmRunnerStatus.evidencePlan.rolesBySide.front.map((role) => role.role), [
    "dark_control",
    "all_on",
    "accepted_profile",
    "channel_1",
    "channel_2",
    "channel_3",
    "channel_4",
    "channel_5",
    "channel_6",
    "channel_7",
    "channel_8",
  ]);
  assert.deepEqual(status.warmRunnerStatus.evidencePlan.rolesBySide.back.map((role) => role.role), [
    "dark_control",
    "all_on",
    "accepted_profile",
    "channel_1",
    "channel_2",
    "channel_3",
    "channel_4",
    "channel_5",
    "channel_6",
    "channel_7",
    "channel_8",
  ]);
  assert.equal(status.warmRunnerStatus.fallback.available, true);
  assert.equal(status.warmRunnerStatus.safety.captureLock, true);
  assert.equal(status.warmRunnerStatus.safety.watchdogSafeOff, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnFailure, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnCancellation, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnSessionEnd, true);
  assert.equal(status.warmRunnerStatus.safety.publicRouteExposed, false);
  assert.equal(status.warmRunnerStatus.safety.productionServiceTokenUsed, false);
  assert.equal(status.latestReport.publicViewerRoute, "/ai-grader/reports/[reportId]");
  assert.equal(status.latestReport.publicViewerRoute.includes("station"), false);
});

test("local station action parser accepts known actions and rejects unknown actions", () => {
  assert.equal(parseAiGraderStationAction(["capture-front"]), "capture-front");
  assert.equal(parseAiGraderStationAction(["export-report-bundle"]), "export-report-bundle");
  assert.equal(parseAiGraderStationAction(["calculate-final-grade"]), "calculate-final-grade");
  assert.equal(parseAiGraderStationAction(["finalize-report"]), "finalize-report");
  assert.equal(parseAiGraderStationAction(["generate-label-data"]), "generate-label-data");
  assert.equal(parseAiGraderStationAction(["confirm-fixture-rulers"]), "confirm-fixture-rulers");
  assert.equal(parseAiGraderStationAction(["cancel-session"]), "cancel-session");
  assert.equal(parseAiGraderStationAction(undefined), "status");
  assert.equal(parseAiGraderStationAction(["delete-all"]), null);
});

test("local station API returns status without admin session or DB service", async () => {
  const res = mockResponse();
  await aiGraderLocalStationHandler(mockRequest("GET", ["status"]), res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; operation: string; result: ReturnType<typeof buildAiGraderLocalStationStatus> };
  assert.equal(body.ok, true);
  assert.equal(body.operation, "status");
  assert.equal(body.result.localOnly, true);
  assert.equal(body.result.safety.databaseWrites, false);
  assert.equal(body.result.safety.hardwareAccessed, false);
});

test("local station API models capture-front transition and method gating", async () => {
  const postRes = mockResponse();
  await aiGraderLocalStationHandler(mockRequest("POST", ["capture-front"]), postRes);
  assert.equal(postRes.statusCodeValue, 200);
  const body = postRes.jsonBody as { result: ReturnType<typeof buildAiGraderLocalStationStatus> };
  assert.equal(body.result.currentStep, "prompt_flip_card");
  assert.equal(body.result.sessionManifest.frontCaptured, true);
  assert.equal(body.result.sessionManifest.backCaptured, false);

  const getRes = mockResponse();
  await aiGraderLocalStationHandler(mockRequest("GET", ["capture-front"]), getRes);
  assert.equal(getRes.statusCodeValue, 405);
  assert.equal(getRes.headers.Allow, "POST");
});

test("sample public report bundle keeps provisional-only safety flags", () => {
  assert.equal(SAMPLE_AI_GRADER_REPORT_BUNDLE.reportStatus, "provisional_diagnostic_ready");
  assert.equal(SAMPLE_AI_GRADER_REPORT_BUNDLE.provisionalGrade?.overall, 8.5);
  assert.equal(SAMPLE_AI_GRADER_REPORT_BUNDLE.visionLab.available, true);
  assert.equal(hasNoFinalCertifiedClaims(SAMPLE_AI_GRADER_REPORT_BUNDLE), true);
  assert.match(SAMPLE_AI_GRADER_REPORT_BUNDLE.limitations.join(" "), /No QR Certificate Yet/);
});

test("unknown generated report ids do not reuse fixture report data", () => {
  const bundle = getAiGraderReportBundle("ai-grader-prod-smoke-missing-storage");

  assert.equal(bundle.reportId, "ai-grader-prod-smoke-missing-storage");
  assert.equal(bundle.reportStatus, "missing_report_data");
  assert.equal(bundle.visionLab.available, false);
  assert.equal(bundle.provisionalGrade, undefined);
  assert.equal(bundle.reportHtmlPath, undefined);
  assert.equal(bundle.evidenceReferences.frontPackageDir, undefined);
  assert.equal(bundle.evidenceReferences.backPackageDir, undefined);
  assert.match(bundle.limitations.join(" "), /No fixture\/sample data/);
  assert.equal(hasNoCertifiedClaim(bundle), true);
});

test("sample final report bundle exposes final V0 data without certified claim", () => {
  const bundle = getAiGraderReportBundle("sample-final-v0");

  assert.equal(bundle.reportStatus, "final_ai_grader_report_v0");
  assert.equal(bundle.finalGradeComputed, true);
  assert.equal(bundle.labelGenerated, true);
  assert.equal(bundle.qrGenerated, true);
  assert.equal(bundle.productionRelease?.label.status, "label_data_ready");
  assert.equal(bundle.productionRelease?.publication.publicReportUrl, "https://collect.tenkings.co/ai-grader/reports/sample-final-v0");
  assert.equal(hasNoCertifiedClaim(bundle), true);
});

test("production release fixture reserves label and QR URL but does not perform DB or storage writes", () => {
  const release = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);

  assert.equal(release.finalGradeComputed, true);
  assert.equal(release.certifiedClaim, false);
  assert.equal(release.certificateGenerated, false);
  assert.equal(release.label.qrPayloadUrl, "https://collect.tenkings.co/ai-grader/reports/sample-final-v0");
  assert.equal(release.publication.dbWritesPerformed, false);
  assert.equal(release.publication.uploadPerformed, false);
  assert.equal(release.databaseIntegration.existingModels.includes("AiGraderReport"), true);
  assert.equal(release.databaseIntegration.migrationsAdded, true);
  assert.equal(release.slabbedPhotoContract.status, "reserved_not_uploaded");
  assert.equal(release.ebayCompsContract.status, "not_run");
  assert.equal(release.cardInventoryLinkage.status, "contract_ready_not_persisted");
});

test("production publication API is disabled by default and does not require DB access", async () => {
  let adminCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {},
    async requireAdminSession() {
      adminCalled = true;
      throw new Error("admin should not be loaded while disabled");
    },
    publicUrlFor: (storageKey) => `/uploads/cards/${storageKey}`,
    async uploadArtifact() {
      throw new Error("upload should not run while disabled");
    },
    async persist() {
      throw new Error("persist should not run while disabled");
    },
  });

  const statusRes = mockResponse();
  await handler(mockRequest("GET", ["status"]), statusRes);
  assert.equal(statusRes.statusCodeValue, 200);
  assert.equal((statusRes.jsonBody as { enabled: boolean }).enabled, false);

  const publishRes = mockResponse();
  await handler(mockRequest("POST", ["publish"]), publishRes);
  assert.equal(publishRes.statusCodeValue, 503);
  assert.equal(adminCalled, false);
});

test("production publish accepts a bearer user session in the AI Grader operator allowlist", async () => {
  let adminCalled = false;
  let persistedActorAudit: unknown = null;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_OPERATOR_USER_IDS_ENV]: "operator-1",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      adminCalled = true;
      throw new Error("operator bearer auth should not use generic admin auth");
    },
    async requireUserSession() {
      return {
        id: "session-operator-1",
        tokenHash: "session-token-hash",
        user: { id: "operator-1", phone: null, displayName: "Operator", avatarUrl: null },
      };
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact(input) {
      return { storageKey: input.storageKey, publicUrl: `https://cdn.tenkings.test/${input.storageKey}` };
    },
    async persist(input) {
      persistedActorAudit = input.actorAudit;
      return {
        gradingSessionId: input.reportBundle.gradingSessionId,
        reportId: input.productionRelease.reportId,
        publicationStatus: input.publicationStatus,
        storagePlan: input.storagePlan,
        evidenceAssetCount: input.storagePlan.artifacts.length,
        cardAssetUpdatedCount: 0,
        itemUpdatedCount: 0,
      } as any;
    },
  });

  const req = mockRequest("POST", ["publish"]);
  req.body = {
    publicationStatus: "published",
    reportBundle: SAMPLE_AI_GRADER_REPORT_BUNDLE,
    productionRelease: buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE),
  };
  req.headers.authorization = "Bearer harmless-test-session";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  assert.equal(adminCalled, false);
  assert.deepEqual(
    {
      actorType: (persistedActorAudit as any)?.actorType,
      action: (persistedActorAudit as any)?.action,
      userId: (persistedActorAudit as any)?.userId,
      role: (persistedActorAudit as any)?.role,
    },
    {
      actorType: "human_operator",
      action: "publish",
      userId: "operator-1",
      role: "ai_grader_operator",
    }
  );
  assert.match((persistedActorAudit as any)?.requestedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("production API rejects bearer users outside AI Grader and global admin allowlists", async () => {
  let historyCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_OPERATOR_USER_IDS_ENV]: "operator-1",
    },
    async requireAdminSession() {
      throw new Error("admin auth should not run for bearer operator path");
    },
    async requireUserSession() {
      return {
        id: "session-unlisted",
        tokenHash: "session-token-hash",
        user: { id: "unlisted-user", phone: null, displayName: "Unlisted", avatarUrl: null },
      };
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact() {
      throw new Error("history should not upload");
    },
    async persist() {
      throw new Error("history should not persist");
    },
    async listHistory() {
      historyCalled = true;
      return buildAiGraderProductionHistoryResult([]);
    },
  });

  const req = mockRequest("GET", ["history"]);
  req.headers.authorization = "Bearer harmless-unlisted-session";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 403);
  assert.equal((res.jsonBody as { message?: string }).message, "AI Grader operator role required");
  assert.equal(historyCalled, false);
});

test("production API accepts a scoped service account token hash", async () => {
  let userSessionCalled = false;
  let historyCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_SERVICE_ACCOUNT_ID_ENV]: "ai-grader-smoke-service",
      [AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV]: sha256Hex("test-service-token"),
      [AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV]: "history",
    },
    async requireAdminSession() {
      throw new Error("service account should not use generic admin auth");
    },
    async requireUserSession() {
      userSessionCalled = true;
      throw new Error("service account should not use bearer user auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact() {
      throw new Error("history should not upload");
    },
    async persist() {
      throw new Error("history should not persist");
    },
    async listHistory() {
      historyCalled = true;
      return buildAiGraderProductionHistoryResult([]);
    },
  });

  const req = mockRequest("GET", ["history"]);
  req.headers["x-ai-grader-service-token"] = "test-service-token";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  assert.equal(userSessionCalled, false);
  assert.equal(historyCalled, true);
});

test("production API rejects an incorrect service account token with 401", async () => {
  let userSessionCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_SERVICE_ACCOUNT_ID_ENV]: "ai-grader-smoke-service",
      [AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV]: sha256Hex("expected-test-service-token"),
      [AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV]: "history",
    },
    async requireAdminSession() {
      throw new Error("service account should not use generic admin auth");
    },
    async requireUserSession() {
      userSessionCalled = true;
      throw new Error("wrong service token should not fall through to bearer user auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact() {
      throw new Error("history should not upload");
    },
    async persist() {
      throw new Error("history should not persist");
    },
    async listHistory() {
      throw new Error("history should not run");
    },
  });

  const req = mockRequest("GET", ["history"]);
  req.headers["x-ai-grader-service-token"] = "wrong-test-service-token";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 401);
  assert.equal((res.jsonBody as { message?: string }).message, "AI Grader service account credentials rejected");
  assert.equal(userSessionCalled, false);
});

test("production API rejects a service account token missing the requested scope", async () => {
  let userSessionCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_SERVICE_ACCOUNT_ID_ENV]: "ai-grader-smoke-service",
      [AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV]: sha256Hex("scoped-test-service-token"),
      [AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV]: "history",
    },
    async requireAdminSession() {
      throw new Error("service account should not use generic admin auth");
    },
    async requireUserSession() {
      userSessionCalled = true;
      throw new Error("scope denied service token should not fall through to bearer user auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact() {
      throw new Error("card search should not upload");
    },
    async persist() {
      throw new Error("card search should not persist");
    },
    async searchCards() {
      throw new Error("card search should not run");
    },
  });

  const req = mockRequest("GET", ["card-search"]);
  req.query = { action: ["card-search"], q: "Jordan" };
  req.headers["x-ai-grader-service-token"] = "scoped-test-service-token";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 403);
  assert.equal((res.jsonBody as { message?: string }).message, "AI Grader service account scope denied");
  assert.equal(userSessionCalled, false);
});

test("production publication API uploads artifacts and persists only when env-gated and admin-authenticated", async () => {
  const calls: string[] = [];
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      calls.push("admin");
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact(input) {
      calls.push(`upload:${input.storageKey}`);
      return { storageKey: input.storageKey, publicUrl: `https://cdn.tenkings.test/${input.storageKey}` };
    },
    async persist(input) {
      calls.push("persist");
      return {
        gradingSessionId: input.reportBundle.gradingSessionId,
        reportId: input.productionRelease.reportId,
        publicationStatus: input.publicationStatus,
        storagePlan: input.storagePlan,
        evidenceAssetCount: input.storagePlan.artifacts.length,
        cardAssetUpdatedCount: input.cardAssetId ? 1 : 0,
        itemUpdatedCount: 0,
      } as any;
    },
  });

  const req = mockRequest("POST", ["publish"]);
  req.body = {
    publicationStatus: "published",
    reportBundle: SAMPLE_AI_GRADER_REPORT_BUNDLE,
    productionRelease: buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE),
    cardAssetId: "card-asset-1",
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { publicReportUrl: string; uploadedAssetCount: number } };
  assert.equal(body.ok, true);
  assert.equal(body.result.publicReportUrl, "https://collect.tenkings.co/ai-grader/reports/sample-final-v0");
  assert.equal(body.result.uploadedAssetCount, 7);
  assert.equal(calls[0], "admin");
  assert.equal(calls.at(-1), "persist");
  assert.ok(calls.some((call) => call.startsWith("upload:ai-grader/reports/sample-final-v0/report-bundle.json")));
});

test("production history API returns persisted report stats when env-gated", async () => {
  let adminCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      adminCalled = true;
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact() {
      throw new Error("history should not upload");
    },
    async persist() {
      throw new Error("history should not persist");
    },
    async listHistory() {
      return buildAiGraderProductionHistoryResult([
        {
          reportId: "final-report-1",
          reportStatus: "final_ai_grader_report_v0",
          publicationStatus: "published",
          visibilityStatus: "public",
          publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/final-report-1",
          qrPayloadUrl: "https://collect.tenkings.co/ai-grader/reports/final-report-1",
          finalOverallGrade: 8.5,
          warnings: ["accepted clipping warning"],
          createdAt: new Date("2026-07-02T00:00:00.000Z"),
          updatedAt: new Date("2026-07-02T00:01:00.000Z"),
          session: { gradingSessionId: "session-1" },
        },
      ]);
    },
  });

  const res = mockResponse();
  await handler(mockRequest("GET", ["history"]), res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { source: string; stats: { total: number; published: number; averageFinalGrade: number; warningCount: number } } };
  assert.equal(body.ok, true);
  assert.equal(adminCalled, true);
  assert.equal(body.result.source, "persisted_records");
  assert.equal(body.result.stats.total, 1);
  assert.equal(body.result.stats.published, 1);
  assert.equal(body.result.stats.averageFinalGrade, 8.5);
  assert.equal(body.result.stats.warningCount, 1);
});

test("production card search is admin-gated and returns existing card/item candidates", async () => {
  let adminCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      adminCalled = true;
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact() {
      throw new Error("card search should not upload");
    },
    async persist() {
      throw new Error("card search should not persist");
    },
    async searchCards(input) {
      assert.equal(input.query, "Jordan");
      return [
        {
          source: "card_asset",
          cardAssetId: "card-asset-1",
          displayTitle: "Michael Jordan Test Card",
          title: "Michael Jordan Test Card",
          subtitle: "CardAsset",
        },
        {
          source: "item",
          itemId: "item-1",
          displayTitle: "Inventory Item Jordan",
          title: "Inventory Item Jordan",
          subtitle: "Item",
        },
      ];
    },
  });

  const req = mockRequest("GET", ["card-search"]);
  req.query = { action: ["card-search"], q: "Jordan", limit: "5" };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { items: Array<{ source: string; cardAssetId?: string; itemId?: string }> } };
  assert.equal(body.ok, true);
  assert.equal(adminCalled, true);
  assert.equal(body.result.items.length, 2);
  assert.equal(body.result.items[0].cardAssetId, "card-asset-1");
  assert.equal(body.result.items[1].itemId, "item-1");
});

test("slabbed photo upload action persists through the env-gated production API", async () => {
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact() {
      throw new Error("slab upload should not use release artifact upload");
    },
    async persist() {
      throw new Error("slab upload should not persist production release");
    },
    async uploadSlabbedPhoto(input) {
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.reportId, "sample-final-v0");
      assert.equal(input.side, "front");
      assert.equal(input.mimeType, "image/png");
      assert.equal(input.body.toString("utf8"), "hello");
      assert.equal(input.operatorUserId, "admin-1");
      assert.deepEqual(
        {
          actorType: input.actorAudit?.actorType,
          action: input.actorAudit?.action,
          userId: input.actorAudit?.userId,
          role: input.actorAudit?.role,
        },
        {
          actorType: "human_operator",
          action: "upload-slab-photo",
          userId: "admin-1",
          role: "ai_grader_admin",
        }
      );
      return {
        reportId: input.reportId,
        side: input.side,
        storageKey: "ai-grader/reports/sample-final-v0/slabbed/front.png",
        publicUrl: "https://cdn.tenkings.test/ai-grader/reports/sample-final-v0/slabbed/front.png",
        byteSize: input.body.length,
        checksumSha256: "checksum",
        persisted: true,
      };
    },
  });

  const req = mockRequest("POST", ["upload-slab-photo"]);
  req.body = {
    reportId: "sample-final-v0",
    side: "front",
    fileName: "front.png",
    dataUrl: `data:image/png;base64,${Buffer.from("hello").toString("base64")}`,
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { persisted: boolean; publicUrl: string } };
  assert.equal(body.ok, true);
  assert.equal(body.result.persisted, true);
  assert.match(body.result.publicUrl, /slabbed\/front\.png/);
});

test("eBay comps action reports ready without live execution when env is disabled", async () => {
  let liveCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact() {
      throw new Error("comps should not upload release artifacts");
    },
    async persist() {
      throw new Error("comps should not persist production release");
    },
    async runComps() {
      liveCalled = true;
      throw new Error("live comps should not run while disabled");
    },
  });
  const req = mockRequest("POST", ["run-comps"]);
  req.body = {
    reportBundle: {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      cardIdentity: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE.cardIdentity, title: "Michael Jordan Test Card" },
    },
    productionRelease: buildSampleAiGraderProductionRelease({
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      cardIdentity: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE.cardIdentity, title: "Michael Jordan Test Card" },
    }),
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { status: string; liveExecutionEnabled: boolean; searchQuery: string } };
  assert.equal(body.ok, true);
  assert.equal(body.result.status, "ready");
  assert.equal(body.result.liveExecutionEnabled, false);
  assert.match(body.result.searchQuery, /Michael Jordan/);
  assert.equal(liveCalled, false);
});

test("eBay comps action can run and persist through mocked operator-triggered dependencies", async () => {
  let persisted = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_EBAY_COMPS_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async uploadArtifact() {
      throw new Error("comps should not upload release artifacts");
    },
    async persist() {
      throw new Error("comps should not persist production release");
    },
    async runComps(input) {
      assert.match(input.searchQuery, /Michael Jordan/);
      return {
        searchQuery: input.searchQuery,
        searchUrl: "https://www.ebay.com/sch/i.html?_nkw=Michael+Jordan",
        compsRefs: [{ id: "comp-1", source: "ebay_sold", price: "$100.00" }],
        resultSummary: { valuationMinor: 10000, valuationCurrency: "USD" },
      };
    },
    async persistComps(input) {
      persisted = true;
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.status, "completed");
      assert.equal(input.reportId, "sample-final-v0");
      assert.equal(input.requestedByUserId, "admin-1");
      assert.deepEqual(
        {
          actorType: input.actorAudit?.actorType,
          action: input.actorAudit?.action,
          userId: input.actorAudit?.userId,
          role: input.actorAudit?.role,
        },
        {
          actorType: "human_operator",
          action: "run-comps",
          userId: "admin-1",
          role: "ai_grader_admin",
        }
      );
      return { ok: true };
    },
  });
  const finalBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: "sample-final-v0",
    cardIdentity: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE.cardIdentity, title: "Michael Jordan Test Card" },
  };
  const req = mockRequest("POST", ["run-comps"]);
  req.body = {
    reportBundle: finalBundle,
    productionRelease: buildSampleAiGraderProductionRelease(finalBundle),
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { status: string; persisted: boolean; compsRefs: unknown[] } };
  assert.equal(body.ok, true);
  assert.equal(body.result.status, "completed");
  assert.equal(body.result.persisted, true);
  assert.equal(body.result.compsRefs.length, 1);
  assert.equal(persisted, true);
});

test("public report API is read-only and disabled unless explicitly configured", async () => {
  let postReadCalled = false;
  const postHandler = createAiGraderPublicReportApiHandler({
    env: { [AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV]: "true" },
    async readPublishedBundle() {
      postReadCalled = true;
      throw new Error("POST should not read public report data");
    },
  });
  const postRes = mockResponse();
  const postReq = mockRequest("POST");
  postReq.query = { reportId: "sample-final-v0" };
  await postHandler(postReq, postRes);
  assert.equal(postRes.statusCodeValue, 405);
  assert.equal(postRes.headers.Allow, "GET");
  assert.equal(postReadCalled, false);

  const disabled = createAiGraderPublicReportApiHandler({
    env: {},
    async readPublishedBundle() {
      throw new Error("read should not run while disabled");
    },
  });
  const disabledRes = mockResponse();
  const disabledReq = mockRequest("GET");
  disabledReq.query = { reportId: "sample-final-v0" };
  await disabled(disabledReq, disabledRes);
  assert.equal(disabledRes.statusCodeValue, 503);

  const enabled = createAiGraderPublicReportApiHandler({
    env: { [AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV]: "true" },
    async readPublishedBundle(reportId) {
      assert.equal(reportId, "sample-final-v0");
      return getAiGraderReportBundle("sample-final-v0");
    },
  });
  const enabledRes = mockResponse();
  const enabledReq = mockRequest("GET");
  enabledReq.query = { reportId: "sample-final-v0" };
  await enabled(enabledReq, enabledRes);
  assert.equal(enabledRes.statusCodeValue, 200);
  const body = enabledRes.jsonBody as { ok: boolean; readOnly: boolean; noHardwareControls: boolean; bundle: { reportId: string } };
  assert.equal(body.ok, true);
  assert.equal(body.readOnly, true);
  assert.equal(body.noHardwareControls, true);
  assert.equal(body.bundle.reportId, "sample-final-v0");

  const missing = createAiGraderPublicReportApiHandler({
    env: { [AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV]: "true" },
    async readPublishedBundle() {
      return null;
    },
  });
  const missingRes = mockResponse();
  const missingReq = mockRequest("GET");
  missingReq.query = { reportId: "missing-storage-report" };
  await missing(missingReq, missingRes);
  assert.equal(missingRes.statusCodeValue, 404);
});

test("local station sample history aggregates report stats without certified claims", () => {
  const history = buildSampleAiGraderReportHistory();
  assert.equal(history.source, "fixture");
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].viewerPath, "/ai-grader/reports/sample-pr45");
  assert.equal(history.stats.allTime, 1);
  assert.equal(history.stats.provisionalGradeCounts["8"], 1);
  assert.equal(history.stats.finalizedCount, 0);
  assert.equal(history.stats.draftCount, 1);
  assert.equal(history.stats.warningsCount, 1);
  assert.equal(hasNoFinalCertifiedClaims(SAMPLE_AI_GRADER_REPORT_BUNDLE), true);
});

test("browser station bridge client accepts only loopback bridge URLs", () => {
  assert.equal(normalizeAiGraderStationBridgeUrl(""), DEFAULT_AI_GRADER_STATION_BRIDGE_URL);
  assert.equal(normalizeAiGraderStationBridgeUrl("http://localhost:47652/path?x=1"), "http://localhost:47652");
  assert.throws(() => normalizeAiGraderStationBridgeUrl("https://collect.tenkings.co/api/ai-grader/station"), /loopback|localhost|127/);
  assert.throws(() => normalizeAiGraderStationBridgeUrl("http://192.168.1.20:47652"), /localhost|127/);
});

test("browser station bridge client checks local bridge health without station or production service tokens", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:47652/health");
    assert.equal(init?.method, "GET");
    assert.equal((init?.headers as Record<string, string> | undefined)?.["x-ai-grader-service-token"], undefined);
    assert.equal((init?.headers as Record<string, string> | undefined)?.["x-ai-grader-station-token"], undefined);
    return new Response(JSON.stringify({
      ok: true,
      bridgeVersion: "ai-grader-local-station-bridge-v0.2",
      mode: "real",
      localOnly: true,
      tokenRequired: true,
      pairingAvailable: true,
      hardwareActionsEnabled: true,
      allowedOrigins: ["https://collect.tenkings.co"],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const health = await fetchAiGraderStationBridgeHealth({ baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL }, fetchImpl);
  assert.equal(health.ok, true);
  assert.equal(health.localOnly, true);
  assert.equal(health.pairingAvailable, true);
  assert.equal(health.allowedOrigins.includes("https://collect.tenkings.co"), true);
});

test("browser station bridge pairing exchanges a local pairing code for browser-local station token only", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:47652/pair");
    assert.equal(init?.method, "POST");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-ai-grader-service-token"], undefined);
    assert.equal(headers["x-ai-grader-station-token"], undefined);
    assert.deepEqual(JSON.parse(String(init?.body)), { pairingCode: "pairing-code-123456" });
    return new Response(JSON.stringify({
      ok: true,
      result: {
        bridgeUrl: "http://127.0.0.1:47652",
        stationToken: "browser-local-station-token",
        localOnly: true,
        tokenStorage: "browser_localStorage_only",
        hardwareActionsEnabled: true,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const paired = await pairAiGraderStationBridge(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, pairingCode: "pairing-code-123456" },
    fetchImpl
  );

  assert.equal(paired.bridgeUrl, DEFAULT_AI_GRADER_STATION_BRIDGE_URL);
  assert.equal(paired.stationToken, "browser-local-station-token");
  assert.equal(paired.tokenStorage, "browser_localStorage_only");
});

test("browser station bridge client opens local report HTML with station token only", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:47652/reports/report-123/html");
    assert.equal(init?.method, "GET");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-ai-grader-station-token"], "browser-local-station-token");
    assert.equal(headers["x-ai-grader-service-token"], undefined);
    return new Response("<!doctype html><title>Local report</title>", { status: 200, headers: { "content-type": "text/html" } });
  };

  const html = await fetchAiGraderStationReportHtml(
    {
      baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
      stationToken: "browser-local-station-token",
      reportId: "report-123",
    },
    fetchImpl
  );

  assert.match(html, /Local report/);
});

test("browser station bridge preview status and stream use local station token only", async () => {
  const frameBytes = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-ai-grader-station-token"], "browser-local-station-token");
    assert.equal(headers["x-ai-grader-service-token"], undefined);
    if (String(input).endsWith("/preview/status")) {
      return new Response(JSON.stringify({
        ok: true,
        result: {
          status: "live",
          implementationType: "mjpeg_fetch_stream",
          browserEmbedded: true,
          localOnly: true,
          tokenRequired: true,
          streamPath: "/preview/stream",
          statusPath: "/preview/status",
          portraitOrientation: true,
          cameraOwnership: "preview_stream",
          frameSource: "basler_pylon_continuous_grab",
          frameCount: 3,
          safety: {
            publicRouteExposed: false,
            requiresStationToken: true,
            bindsLoopbackOnly: true,
            productionServiceTokenUsed: false,
            lightingCommanded: false,
            persistentBaslerSaved: false,
            persistentLeimacSaved: false,
          },
          note: "test",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(input).endsWith("/preview/stop")) {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        ok: true,
        result: {
          status: "stopped",
          implementationType: "mjpeg_fetch_stream",
          browserEmbedded: true,
          localOnly: true,
          tokenRequired: true,
          streamPath: "/preview/stream",
          statusPath: "/preview/status",
          portraitOrientation: true,
          cameraOwnership: "released",
          frameSource: "basler_pylon_continuous_grab",
          frameCount: 3,
          lastStopReason: "operator starting front full forensic capture",
          safety: {
            publicRouteExposed: false,
            requiresStationToken: true,
            bindsLoopbackOnly: true,
            productionServiceTokenUsed: false,
            lightingCommanded: false,
            persistentBaslerSaved: false,
            persistentLeimacSaved: false,
          },
          note: "test",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(String(input), "http://127.0.0.1:47652/preview/stream");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`--tenkings-ai-grader-preview\r\nContent-Type: image/svg+xml\r\nContent-Length: ${frameBytes.length}\r\nX-AI-Grader-Frame-Index: 7\r\nX-AI-Grader-Captured-At: 2026-07-05T00:00:00.000Z\r\n\r\n`));
        controller.enqueue(frameBytes);
        controller.enqueue(new TextEncoder().encode("\r\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "multipart/x-mixed-replace; boundary=tenkings-ai-grader-preview" },
    });
  };

  const previewStatus = await fetchAiGraderStationPreviewStatus({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
  }, fetchImpl);
  assert.equal(previewStatus.localOnly, true);
  assert.equal(previewStatus.frameCount, 3);

  const stoppedPreview = await stopAiGraderStationPreview({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    reason: "operator starting front full forensic capture",
  }, fetchImpl);
  assert.equal(stoppedPreview.cameraOwnership, "released");

  const frames: Array<{ frameIndex?: number; contentType: string; byteLength: number }> = [];
  await openAiGraderStationPreviewStream(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "browser-local-station-token" },
    {
      onFrame(frame) {
        frames.push({ frameIndex: frame.frameIndex, contentType: frame.contentType, byteLength: frame.byteLength });
      },
    },
    fetchImpl
  );
  assert.deepEqual(frames, [{ frameIndex: 7, contentType: "image/svg+xml", byteLength: frameBytes.length }]);
});

test("public AI Grader report surfaces do not expose preview endpoints or hardware controls", () => {
  const publicBundleText = JSON.stringify(getAiGraderReportBundle("sample-final-v0"));
  assert.equal(publicBundleText.includes("/preview/stream"), false);
  assert.equal(publicBundleText.includes("x-ai-grader-station-token"), false);
  assert.equal(publicBundleText.includes("hardware controls"), false);
});

test("browser station bridge client reports missing bridge and missing pairing code cleanly", async () => {
  const unavailableFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ ok: false, message: "bridge not running" }), { status: 503 });

  await assert.rejects(
    () => fetchAiGraderStationBridgeHealth({ baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL }, unavailableFetch),
    /bridge not running/
  );
  await assert.rejects(
    () => pairAiGraderStationBridge({ baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, pairingCode: " " }, unavailableFetch),
    /pairing code is required/
  );
});
