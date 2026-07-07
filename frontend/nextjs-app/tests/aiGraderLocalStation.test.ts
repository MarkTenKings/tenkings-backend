import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import aiGraderLocalStationHandler from "../pages/api/ai-grader/station/[...action]";
import { config as aiGraderProductionRouteConfig } from "../pages/api/admin/ai-grader/production/[...action]";
import {
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
  buildSampleAiGraderReportHistory,
  buildAiGraderLocalStationStatus,
  parseAiGraderStationAction,
} from "../lib/aiGraderLocalStation";
import { SAMPLE_AI_GRADER_REPORT_BUNDLE, getAiGraderReportBundle, hasNoCertifiedClaim, hasNoFinalCertifiedClaims } from "../lib/aiGraderReportBundle";
import { buildSampleAiGraderProductionRelease } from "../lib/aiGraderProductionRelease";
import {
  AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS,
  buildAiGraderCompsReadiness,
  buildAiGraderLabelPreviewUrl,
  buildAiGraderPublishReadiness,
} from "../lib/aiGraderOperatorWorkflow";
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
  acceptAiGraderLiveLightingProfile,
  applyAiGraderLiveLighting,
  fetchAiGraderLiveLightingStatus,
  fetchAiGraderStationBridgeHealth,
  fetchAiGraderStationPreviewStatus,
  fetchAiGraderStationReportAsset,
  fetchAiGraderStationReportBundle,
  heartbeatAiGraderLiveLighting,
  normalizeAiGraderStationBridgeUrl,
  openAiGraderStationPreviewStream,
  pairAiGraderStationBridge,
  safeOffAiGraderLiveLighting,
  stopAiGraderStationPreview,
} from "../lib/aiGraderStationBridgeClient";
import { reportImageAssets } from "../lib/aiGraderReportImages";

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

function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function sampleStorageReadyReportBundle(overrides: Partial<typeof SAMPLE_AI_GRADER_REPORT_BUNDLE> = {}) {
  const imageBytes = Buffer.from("front-image");
  return {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: "sample-final-v0",
    finalGradeComputed: true,
    assets: [
      {
        id: "front/front-all-on-portrait-display.png",
        kind: "image",
        fileName: "front-all-on-portrait-display.png",
        contentType: "image/png",
        checksumSha256: sha256Hex(imageBytes),
        sha256: sha256Hex(imageBytes),
        byteSize: imageBytes.length,
      },
    ],
    ...overrides,
  };
}

function presignForTest(input: { storageKey: string; contentType: string; checksumSha256: string }) {
  return {
    storageKey: input.storageKey,
    uploadUrl: `https://uploads.tenkings.test/${encodeURIComponent(input.storageKey)}`,
    uploadMethod: "PUT" as const,
    uploadHeaders: {
      "Content-Type": input.contentType,
      "x-amz-meta-sha256": input.checksumSha256,
    },
    publicUrl: `https://cdn.tenkings.test/${input.storageKey}`,
  };
}

function uploadManifestFromPlan(artifacts: Array<{ artifactId: string; storageKey: string; publicUrl?: string; checksumSha256: string; byteSize: number; contentType: string }>) {
  return {
    artifacts: artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      storageKey: artifact.storageKey,
      publicUrl: artifact.publicUrl,
      checksumSha256: artifact.checksumSha256,
      byteSize: artifact.byteSize,
      contentType: artifact.contentType,
      uploadedAt: "2026-07-06T23:00:00.000Z",
    })),
  };
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
  assert.equal(status.liveLighting.localOnly, true);
  assert.equal(status.liveLighting.tokenRequired, true);
  assert.equal(status.liveLighting.safety.publicRouteExposed, false);
  assert.equal(status.liveLighting.safety.productionServiceTokenUsed, false);
  assert.equal(status.liveLighting.safety.maxDutyPercent, 5);
  assert.equal(status.bridgeContract.endpoints.some((endpoint) => endpoint.path === "/lighting/apply"), true);
  assert.equal(status.warmRunnerStatus.mode, "full_forensic");
  assert.equal(status.executionPath, "warm_full_forensic_runner");
  assert.equal(status.fallbackUsed, false);
  assert.equal(status.warmRunnerStatus.executionPath, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.backend, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.fallbackUsed, false);
  assert.equal(status.warmRunnerStatus.fallback.active, false);
  assert.equal(status.warmRunnerStatus.previewPolicy.holdPreviewDuringFullForensicRun, true);
  assert.equal(status.warmRunnerStatus.previewPolicy.holdActive, false);
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

test("missing report route params do not render sample AI Grader report data", () => {
  const bundle = getAiGraderReportBundle(undefined);

  assert.equal(bundle.reportId, "missing-report-data");
  assert.equal(bundle.reportStatus, "missing_report_data");
  assert.equal(bundle.provisionalGrade, undefined);
  assert.equal(bundle.visionLab.available, false);
  assert.match(bundle.limitations.join(" "), /No fixture\/sample data/);
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

test("normal AI Grader operator workflow hides internal pipeline buttons", () => {
  assert.deepEqual([...AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS], [
    "Review Report",
    "Publish to Ten Kings",
    "View Public Report",
    "Print Label",
    "Run eBay Comps",
    "Card History Reports",
  ]);
  assert.equal(AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS.includes("Calculate Final Grade" as any), false);
  assert.equal(AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS.includes("Finalize / Publish" as any), false);
  assert.equal(AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS.includes("Publish to Ten Kings System" as any), false);
});

test("AI Grader publish readiness holds public links until hosted publish succeeds", () => {
  const release = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  const finalBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: release.reportId,
    reportStatus: "final_ai_grader_report_v0" as const,
    finalStatus: "final_grade_computed" as const,
    finalGradeComputed: true,
    labelGenerated: true,
    qrGenerated: true,
    productionRelease: release,
  };
  const readiness = buildAiGraderPublishReadiness({ bundle: finalBundle, productionRelease: release });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, "ready");
  assert.equal(readiness.publicReportUrl, undefined);
  assert.equal(readiness.qrPayloadUrl, undefined);
  assert.equal(readiness.labelPreviewUrl, undefined);
  assert.equal(readiness.certId, release.label.certId);

  const publishedReadiness = buildAiGraderPublishReadiness({ bundle: finalBundle, productionRelease: release, published: true });
  assert.equal(publishedReadiness.ready, true);
  assert.equal(publishedReadiness.status, "published");
  assert.equal(publishedReadiness.publicReportUrl, "https://collect.tenkings.co/ai-grader/reports/sample-final-v0");
  assert.equal(publishedReadiness.qrPayloadUrl, publishedReadiness.publicReportUrl);
  assert.equal(publishedReadiness.labelPreviewUrl, "https://collect.tenkings.co/ai-grader/labels/sample-final-v0");
  assert.equal(publishedReadiness.certId, release.label.certId);
});

test("insufficient evidence AI Grader reports cannot be published", () => {
  const blockedBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportStatus: "insufficient_evidence" as const,
    finalStatus: "insufficient_evidence" as const,
    finalGradeComputed: false,
    provisionalGrade: {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE.provisionalGrade,
      overall: undefined,
      gates: {
        requiredGatesPassed: false,
        results: [
          {
            gate: "clipping",
            status: "fail",
            summary: "Maximum clipped fraction is 0.99; soft target is 0.02.",
            evidenceRefs: ["analysis.back.allOn.clippedPixelFraction"],
          },
        ],
        blockers: ["clipping: Maximum clipped fraction is 0.99; soft target is 0.02."],
        acceptedWarnings: [],
      },
    },
  };
  const readiness = buildAiGraderPublishReadiness({ bundle: blockedBundle });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.status, "not_ready_insufficient_evidence");
  assert.match(readiness.message, /insufficient evidence/i);
  assert.equal(readiness.failedGates[0]?.id, "clipping");
  assert.match(readiness.failedGates[0]?.reason ?? "", /0\.99/);
});

test("AI Grader comps readiness requires final grade and card identity", () => {
  const release = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  const finalBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    finalGradeComputed: true,
    productionRelease: release,
  };

  assert.equal(buildAiGraderCompsReadiness({ bundle: SAMPLE_AI_GRADER_REPORT_BUNDLE }).status, "not_ready_missing_grade");
  assert.equal(
    buildAiGraderCompsReadiness({
      bundle: { ...finalBundle, cardIdentity: { ...finalBundle.cardIdentity, title: undefined, set: undefined, cardNumber: undefined } },
      productionRelease: release,
    }).status,
    "not_ready_missing_identity"
  );
  assert.equal(buildAiGraderCompsReadiness({ bundle: finalBundle, productionRelease: release }).status, "ready");
  assert.equal(buildAiGraderLabelPreviewUrl("report-1"), "https://collect.tenkings.co/ai-grader/labels/report-1");
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
    async presignUpload() {
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
  await handler(mockRequest("POST", ["publish-init"]), publishRes);
  assert.equal(publishRes.statusCodeValue, 503);
  assert.equal(adminCalled, false);
});

test("production publication API route keeps Vercel request bodies platform-safe", () => {
  assert.equal(aiGraderProductionRouteConfig.api.bodyParser.sizeLimit, "1mb");
});

test("production publication API rejects insufficient evidence reports before upload", async () => {
  const release = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  const blockedRelease = {
    ...release,
    reportStatus: "insufficient_evidence",
    finalStatus: "insufficient_evidence",
    finalGradeComputed: false,
    labelDataGenerated: false,
    qrPayloadGenerated: false,
    label: {
      ...release.label,
      status: "blocked_insufficient_evidence",
    },
  };
  let uploadCalled = false;
  let persistCalled = false;
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
    async presignUpload() {
      uploadCalled = true;
      throw new Error("blocked report should not upload");
    },
    async persist() {
      persistCalled = true;
      throw new Error("blocked report should not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = {
    publicationStatus: "published",
    reportBundle: {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      reportStatus: "insufficient_evidence",
      finalStatus: "insufficient_evidence",
      finalGradeComputed: false,
      productionRelease: blockedRelease,
    },
    productionRelease: blockedRelease,
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  assert.equal(uploadCalled, false);
  assert.equal(persistCalled, false);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    code: "AI_GRADER_REPORT_NOT_PUBLISH_READY",
    message: "AI Grader report is not publish-ready. Final grade, label data, and QR payload are required before publishing.",
  });
});

test("legacy production publish action is rejected instead of accepting image bodies through Vercel", async () => {
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      throw new Error("legacy publish should reject before auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async persist() {
      throw new Error("legacy publish should not persist");
    },
  });

  const req = mockRequest("POST", ["publish"]);
  req.body = {
    publicationStatus: "published",
    reportBundle: {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      assets: [{ bodyBase64: Buffer.from("front-image").toString("base64") }],
    },
    productionRelease: buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE),
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 410);
  const body = res.jsonBody as { ok: boolean; code?: string; message?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "AI_GRADER_LEGACY_PUBLISH_REJECTED");
  assert.match(body.message ?? "", /publish-init/);
});

test("production publish init creates direct storage upload plan without embedded bodies", async () => {
  const calls: string[] = [];
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
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
    async presignUpload(input) {
      calls.push(`presign:${input.storageKey}`);
      return presignForTest(input);
    },
    async persist() {
      throw new Error("publish-init should not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = {
    publicationStatus: "published",
    reportId: reportBundle.reportId,
    certId: productionRelease.label.certId,
    gradingSessionId: reportBundle.gradingSessionId,
    reportBundle,
    productionRelease,
    assetManifest: { assets: reportBundle.assets },
    checksums: {
      checksums: reportBundle.assets?.map((asset) => ({
        id: asset.id,
        checksumSha256: asset.checksumSha256,
        byteSize: asset.byteSize,
      })),
    },
    cardAssetId: "card-asset-1",
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as {
    ok: boolean;
    result: {
      publishSessionId: string;
      storageKeyPrefix: string;
      uploadPlan: { artifacts: Array<{ kind: string; artifactClass: string; body?: string; bodyBase64?: string; sourceAssetId?: string; uploadUrl: string }> };
      finalizeManifestShape: { uploadManifest: { artifacts: unknown[] } };
    };
  };
  assert.equal(body.ok, true);
  assert.match(body.result.publishSessionId, /^aigpub_/);
  assert.equal(body.result.storageKeyPrefix, "ai-grader/reports/sample-final-v0/");
  assert.equal(body.result.uploadPlan.artifacts.some((artifact) => artifact.artifactClass === "report_asset" && artifact.sourceAssetId), true);
  assert.equal(JSON.stringify(body).includes("bodyBase64"), false);
  assert.equal(JSON.stringify(body).includes("data:image"), false);
  assert.equal(JSON.stringify(body).includes("C:\\TenKings"), false);
  assert.ok(calls.some((call) => call.startsWith("presign:ai-grader/reports/sample-final-v0/report-bundle.json")));
  assert.ok(body.result.finalizeManifestShape.uploadManifest.artifacts.length >= 8);
});

test("production publish init rejects bodyBase64, data URLs, local paths, bridge URLs, and token markers", async () => {
  const reportBundle = sampleStorageReadyReportBundle({
    assets: [
      {
        id: "front/front-all-on-portrait-display.png",
        kind: "image",
        fileName: "front-all-on-portrait-display.png",
        contentType: "image/png",
        checksumSha256: sha256Hex(Buffer.from("front-image")),
        byteSize: Buffer.byteLength("front-image"),
        bodyBase64: Buffer.from("front-image").toString("base64"),
      } as any,
    ],
  });
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      throw new Error("unsafe payload should reject before auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async persist() {
      throw new Error("unsafe payload should not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = {
    publicationStatus: "published",
    reportBundle,
    productionRelease: buildSampleAiGraderProductionRelease(reportBundle),
    stationToken: "must-not-send",
    bridgeUrl: "http://127.0.0.1:47652",
    preview: "data:image/png;base64,abc",
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  assert.match((res.jsonBody as { message?: string }).message ?? "", /Unsafe AI Grader publish payload/);
});

test("production publish finalize verifies upload manifest and persists DB records", async () => {
  let adminCalled = false;
  let persistedActorAudit: unknown = null;
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  let uploadManifest: ReturnType<typeof uploadManifestFromPlan> | null = null;
  let publishSessionId = "";
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
    async presignUpload(input) {
      return presignForTest(input);
    },
    async verifyUploadedArtifact(input) {
      return {
        ok: true,
        byteSize: input.byteSize,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
      };
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

  const initReq = mockRequest("POST", ["publish-init"]);
  initReq.body = {
    publicationStatus: "published",
    reportBundle,
    productionRelease,
  };
  initReq.headers.authorization = "Bearer harmless-test-session";
  const initRes = mockResponse();
  await handler(initReq, initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const initBody = initRes.jsonBody as { result: { publishSessionId: string; uploadPlan: { artifacts: Array<{ artifactId: string; storageKey: string; publicUrl?: string; checksumSha256: string; byteSize: number; contentType: string }> } } };
  publishSessionId = initBody.result.publishSessionId;
  uploadManifest = uploadManifestFromPlan(initBody.result.uploadPlan.artifacts);

  const req = mockRequest("POST", ["publish-finalize"]);
  req.body = {
    publicationStatus: "published",
    reportId: reportBundle.reportId,
    publishSessionId,
    uploadManifest,
    reportBundle,
    productionRelease,
    cardAssetId: "card-asset-1",
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
  const body = res.jsonBody as { ok: boolean; result: { uploadedAssetCount: number; evidenceAssetCount: number; storageKeyPrefix: string } };
  assert.equal(body.ok, true);
  assert.equal(body.result.uploadedAssetCount, uploadManifest?.artifacts.length);
  assert.equal(body.result.evidenceAssetCount, uploadManifest?.artifacts.length);
  assert.equal(body.result.storageKeyPrefix, "ai-grader/reports/sample-final-v0/");
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
    async presignUpload() {
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
    async presignUpload() {
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
    async presignUpload() {
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
    async presignUpload() {
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

test("production publish finalize updates CardAsset linkage when identity is present", async () => {
  const calls: string[] = [];
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
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
    async presignUpload(input) {
      calls.push(`presign:${input.storageKey}`);
      return presignForTest(input);
    },
    async verifyUploadedArtifact(input) {
      calls.push(`verify:${input.storageKey}`);
      return { ok: true, byteSize: input.byteSize, checksumSha256: input.checksumSha256 };
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

  const initReq = mockRequest("POST", ["publish-init"]);
  initReq.body = {
    publicationStatus: "published",
    reportBundle,
    productionRelease,
    cardAssetId: "card-asset-1",
  };
  const initRes = mockResponse();
  await handler(initReq, initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const initBody = initRes.jsonBody as { result: { publishSessionId: string; uploadPlan: { artifacts: Array<{ artifactId: string; storageKey: string; publicUrl?: string; checksumSha256: string; byteSize: number; contentType: string }> } } };

  const req = mockRequest("POST", ["publish-finalize"]);
  req.body = {
    publicationStatus: "published",
    reportId: reportBundle.reportId,
    publishSessionId: initBody.result.publishSessionId,
    uploadManifest: uploadManifestFromPlan(initBody.result.uploadPlan.artifacts),
    reportBundle,
    productionRelease,
    cardAssetId: "card-asset-1",
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { certId: string; publicReportUrl: string; labelPreviewUrl: string; uploadedAssetCount: number } };
  assert.equal(body.ok, true);
  assert.equal(body.result.certId, productionRelease.label.certId);
  assert.equal(body.result.publicReportUrl, "https://collect.tenkings.co/ai-grader/reports/sample-final-v0");
  assert.equal(body.result.labelPreviewUrl, "https://collect.tenkings.co/ai-grader/labels/sample-final-v0");
  assert.equal(body.result.uploadedAssetCount, 9);
  assert.equal(calls[0], "admin");
  assert.equal(calls.at(-1), "persist");
  assert.ok(calls.some((call) => call.startsWith("presign:ai-grader/reports/sample-final-v0/report-bundle.json")));
  assert.ok(calls.some((call) => call.startsWith("verify:ai-grader/reports/sample-final-v0/report-bundle.json")));
});

test("production publish init rejects published reports without image asset metadata", async () => {
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
    async presignUpload() {
      throw new Error("publish without image metadata should not presign");
    },
    async persist() {
      throw new Error("publish without image metadata should not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = {
    publicationStatus: "published",
    reportBundle: SAMPLE_AI_GRADER_REPORT_BUNDLE,
    productionRelease: buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE),
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  const body = res.jsonBody as { ok: boolean; code?: string; message?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "AI_GRADER_REPORT_IMAGES_REQUIRED");
  assert.match(body.message ?? "", /checksum and byte size/);
});

test("production publish init returns storage-backed public report bundle body only", async () => {
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
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
    async presignUpload(input) {
      return presignForTest(input);
    },
    async persist(input) {
      throw new Error("publish-init should not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = {
    publicationStatus: "published",
    reportBundle,
    productionRelease,
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { uploadPlan: { artifacts: Array<{ kind: string; body?: string; artifactClass: string }> } } };
  const reportBundleArtifact = body.result.uploadPlan.artifacts.find((artifact) => artifact.kind === "report-bundle.json");
  assert.ok(reportBundleArtifact?.body);
  const storedBundle = JSON.parse(reportBundleArtifact.body);
  assert.equal(storedBundle.assets[0].publicUrl, "https://cdn.tenkings.test/ai-grader/reports/sample-final-v0/assets/001-front-all-on-portrait-display.png");
  assert.equal(storedBundle.assets[0].bodyBase64, undefined);
  assert.equal(JSON.stringify(storedBundle).includes("C:\\TenKings"), false);
  assert.equal(JSON.stringify(storedBundle).includes("127.0.0.1"), false);
  assert.equal(reportImageAssets(storedBundle).length, 1);
  const imageArtifact = body.result.uploadPlan.artifacts.find((artifact) => artifact.artifactClass === "report_asset");
  assert.equal(imageArtifact?.body, undefined);
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
    async presignUpload() {
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
    async presignUpload() {
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

test("create-card-from-report action sends small storage-backed metadata and returns linked card identity", async () => {
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  let createCalled = false;
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
    async presignUpload() {
      throw new Error("create-card should not presign uploads");
    },
    async persist() {
      throw new Error("create-card should not finalize production publish");
    },
    async createCardFromReport(input) {
      createCalled = true;
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.identity.playerName, "Michael Jordan");
      assert.equal(input.identity.year, "1996");
      assert.equal(input.operatorUserId, "admin-1");
      assert.equal(input.storagePlan.artifacts.some((artifact) => "body" in artifact), false);
      assert.equal(input.storagePlan.storageKeyPrefix, "ai-grader/reports/sample-final-v0/");
      return {
        reportId: "sample-final-v0",
        cardAssetId: "card-asset-1",
        itemId: "item-1",
        batchId: "batch-1",
        title: "1996 Fleer Michael Jordan #23",
        set: "Fleer",
        publicImageUrl: "https://cdn.tenkings.test/ai-grader/reports/sample-final-v0/assets/001-front-all-on-portrait-display.png",
        cardIdentity: {
          source: "card_asset",
          cardAssetId: "card-asset-1",
          itemId: "item-1",
          title: "1996 Fleer Michael Jordan #23",
          set: "Fleer",
          cardNumber: "23",
          displayTitle: "1996 Fleer Michael Jordan #23",
        },
        productionRelease: {
          ...productionRelease,
          cardInventoryLinkage: {
            status: "linked",
            cardAssetId: "card-asset-1",
            itemId: "item-1",
            note: "linked",
          },
        },
        inventoryReady: {
          itemNumberConvention: "Item.number = CardAsset.id",
          labelPairId: "TKPAIR",
        },
      };
    },
  });

  const req = mockRequest("POST", ["create-card-from-report"]);
  req.body = {
    publicationStatus: "published",
    reportBundle,
    productionRelease,
    identity: {
      category: "sport",
      playerName: "Michael Jordan",
      year: "1996",
      manufacturer: "Fleer",
      sport: "Basketball",
      productSet: "Fleer",
      cardNumber: "23",
      autograph: false,
      memorabilia: false,
    },
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { cardAssetId: string; itemId: string; productionRelease: { cardInventoryLinkage: { status: string } } } };
  assert.equal(body.ok, true);
  assert.equal(body.result.cardAssetId, "card-asset-1");
  assert.equal(body.result.itemId, "item-1");
  assert.equal(body.result.productionRelease.cardInventoryLinkage.status, "linked");
  assert.equal(createCalled, true);
});

test("legacy slabbed photo body upload is rejected by the production API", async () => {
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
    async presignUpload() {
      throw new Error("slab upload should not use release artifact upload");
    },
    async persist() {
      throw new Error("slab upload should not persist production release");
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

  assert.equal(res.statusCodeValue, 400);
  const body = res.jsonBody as { ok: boolean; message: string };
  assert.equal(body.ok, false);
  assert.match(body.message, /Unsafe AI Grader publish payload field rejected/);
});

test("slabbed photo direct upload init/finalize persists through the env-gated production API", async () => {
  let finalized = false;
  const imageChecksum = sha256Hex("hello");
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
    async presignUpload(input) {
      assert.match(input.storageKey, /^ai-grader\/reports\/sample-final-v0\/slabbed\/front-/);
      assert.equal(input.contentType, "image/png");
      assert.equal(input.checksumSha256, imageChecksum);
      return presignForTest(input);
    },
    async verifyUploadedArtifact(input) {
      assert.equal(input.byteSize, 5);
      assert.equal(input.checksumSha256, imageChecksum);
      return { ok: true, byteSize: input.byteSize, checksumSha256: input.checksumSha256, contentType: input.contentType };
    },
    async persist() {
      throw new Error("slab upload should not persist production release");
    },
    async finalizeSlabbedPhotoUpload(input) {
      finalized = true;
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.reportId, "sample-final-v0");
      assert.equal(input.side, "front");
      assert.equal(input.mimeType, "image/png");
      assert.equal(input.byteSize, 5);
      assert.equal(input.checksumSha256, imageChecksum);
      assert.match(input.storageKey, /^ai-grader\/reports\/sample-final-v0\/slabbed\/front-/);
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
        storageKey: input.storageKey,
        publicUrl: input.publicUrl,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256,
        persisted: true,
      };
    },
  });

  const initReq = mockRequest("POST", ["slabbed-photo-init"]);
  initReq.body = {
    reportId: "sample-final-v0",
    side: "front",
    fileName: "front.png",
    mimeType: "image/png",
    byteSize: 5,
    checksumSha256: imageChecksum,
  };
  const initRes = mockResponse();
  await handler(initReq, initRes);

  assert.equal(initRes.statusCodeValue, 200);
  const initBody = initRes.jsonBody as { ok: boolean; result: { requiredFinalizeManifest: Record<string, unknown> } };
  assert.equal(initBody.ok, true);

  const finalizeReq = mockRequest("POST", ["slabbed-photo-finalize"]);
  finalizeReq.body = initBody.result.requiredFinalizeManifest;
  const res = mockResponse();
  await handler(finalizeReq, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { persisted: boolean; publicUrl: string } };
  assert.equal(body.ok, true);
  assert.equal(body.result.persisted, true);
  assert.match(body.result.publicUrl, /slabbed\/front-/);
  assert.equal(finalized, true);
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
    async presignUpload() {
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

test("eBay comps action returns candidates and selected comps persist separately", async () => {
  let selectedPersisted = false;
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
    async presignUpload() {
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
    async persistSelectedComps(input) {
      selectedPersisted = true;
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.reportId, "sample-final-v0");
      assert.equal(input.requestedByUserId, "admin-1");
      assert.equal(input.selectedComps.length, 1);
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
      return {
        reportId: input.reportId,
        cardAssetId: "card-asset-1",
        itemId: "item-1",
        evidenceItemCount: 1,
        valuationMinor: 10000,
        valuationCurrency: "USD",
        valuationStatus: "completed",
      };
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
  assert.equal(body.result.persisted, false);
  assert.equal(body.result.compsRefs.length, 1);

  const saveReq = mockRequest("POST", ["save-comps-selection"]);
  saveReq.body = {
    reportId: "sample-final-v0",
    selectedComps: body.result.compsRefs,
    searchQuery: "Michael Jordan",
    searchUrl: "https://www.ebay.com/sch/i.html?_nkw=Michael+Jordan",
  };
  const saveRes = mockResponse();
  await handler(saveReq, saveRes);

  assert.equal(saveRes.statusCodeValue, 200);
  const saveBody = saveRes.jsonBody as { ok: boolean; result: { evidenceItemCount: number; valuationMinor: number } };
  assert.equal(saveBody.ok, true);
  assert.equal(saveBody.result.evidenceItemCount, 1);
  assert.equal(saveBody.result.valuationMinor, 10000);
  assert.equal(selectedPersisted, true);
});

test("add-to-inventory action is publish-scoped and returns inventory-ready linkage", async () => {
  let addCalled = false;
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
    async presignUpload() {
      throw new Error("add-to-inventory should not upload");
    },
    async persist() {
      throw new Error("add-to-inventory should not publish-finalize");
    },
    async addToInventory(input) {
      addCalled = true;
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.reportId, "sample-final-v0");
      assert.equal(input.operatorUserId, "admin-1");
      assert.equal(input.actorAudit?.action, "publish");
      return {
        reportId: input.reportId,
        cardAssetId: "card-asset-1",
        itemId: "item-1",
        reviewStage: "INVENTORY_READY_FOR_SALE",
        labelPairId: "TKPAIR",
      };
    },
  });
  const req = mockRequest("POST", ["add-to-inventory"]);
  req.body = { reportId: "sample-final-v0" };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { reviewStage: string; itemId: string } };
  assert.equal(body.ok, true);
  assert.equal(body.result.reviewStage, "INVENTORY_READY_FOR_SALE");
  assert.equal(body.result.itemId, "item-1");
  assert.equal(addCalled, true);
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

test("AI Grader report image resolver keeps public URLs storage-backed and local bodies operator-only", () => {
  const bodyBase64 = Buffer.from("front-image").toString("base64");
  const bundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    assets: [
      {
        id: "front/front-all-on-portrait-display.png",
        kind: "image",
        fileName: "front-all-on-portrait-display.png",
        contentType: "image/png",
        publicUrl: "C:\\TenKings\\capture-data\\front.png",
        bodyEncoding: "base64",
        bodyBase64,
      },
      {
        id: "back/back-all-on-portrait-display.png",
        kind: "image",
        fileName: "back-all-on-portrait-display.png",
        contentType: "image/png",
        publicUrl: "https://cdn.tenkings.test/back.png",
      },
    ],
  };

  const publicImages = reportImageAssets(bundle);
  assert.equal(publicImages.length, 1);
  assert.equal(publicImages[0].renderUrl, "https://cdn.tenkings.test/back.png");
  assert.equal(publicImages[0].renderSource, "public_url");

  const localImages = reportImageAssets(bundle, { allowEmbeddedBodies: true });
  assert.equal(localImages.length, 2);
  assert.equal(localImages.some((image) => image.renderUrl === `data:image/png;base64,${bodyBase64}`), true);
  assert.equal(localImages.some((image) => image.renderUrl.includes("C:\\TenKings")), false);
});

test("AI Grader station source opens reports inline without popup dependency", () => {
  const stationPath =
    [path.join(process.cwd(), "pages", "ai-grader", "station.tsx"), path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "station.tsx")]
      .find((candidate) => fs.existsSync(candidate));
  assert.ok(stationPath);
  const stationSource = fs.readFileSync(stationPath, "utf8");
  assert.equal(stationSource.includes("window.open("), false);
  assert.equal(stationSource.includes("Allow pop-ups"), false);
  assert.equal(stationSource.includes("fetchAiGraderStationReportBundle"), true);
  assert.equal(stationSource.includes("fetchAiGraderStationReportAsset"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/create-card-from-report"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/publish-init"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/publish-finalize"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/slabbed-photo-init"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/slabbed-photo-finalize"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/save-comps-selection"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/add-to-inventory"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/upload-slab-photo"), false);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/publish\""), false);
  const publishFunctionSource = stationSource.slice(
    stationSource.indexOf("const publishToTenKingsSystem"),
    stationSource.indexOf("const uploadSlabbedPhoto")
  );
  assert.equal(publishFunctionSource.includes("includeAssetBodies"), false);
  assert.equal(stationSource.includes("readAsDataURL"), false);
  assert.equal(stationSource.includes("dataUrl"), false);
  assert.equal(stationSource.includes("Confirm + Create Card"), true);
  assert.equal(stationSource.includes("Mark Label Printed"), true);
  assert.equal(stationSource.includes("Save Selected Comps"), true);
  assert.equal(stationSource.includes("Add To Inventory"), true);
  assert.equal(stationSource.includes("Local Operator Report"), true);
  assert.equal(stationSource.includes("Grade Story"), true);
  assert.equal(stationSource.includes("Element Diagnostics"), true);
  assert.equal(stationSource.includes("Vision Lab"), true);
  assert.equal(stationSource.includes("Warnings and Gates"), true);
  assert.equal(stationSource.includes("localReportStory?.gates?.results"), true);
  assert.equal(stationSource.includes("Publish Readiness"), true);
  assert.equal(stationSource.includes("Calculate Final Grade\""), false);
  assert.equal(stationSource.includes("Finalize / Publish"), false);
  assert.equal(stationSource.includes("Publish to Ten Kings System"), false);
});

test("AI Grader public report source renders provisional evidence gates", () => {
  const reportPath =
    [
      path.join(process.cwd(), "pages", "ai-grader", "reports", "[reportId].tsx"),
      path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "reports", "[reportId].tsx"),
    ].find((candidate) => fs.existsSync(candidate));
  assert.ok(reportPath);
  const reportSource = fs.readFileSync(reportPath, "utf8");
  assert.equal(reportSource.includes("Evidence Gates"), true);
  assert.equal(reportSource.includes("provisionalGateRows"), true);
  assert.equal(reportSource.includes("Failed gates explain why"), true);
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

test("browser station bridge client fetches local report bundle bodies with station token only", async () => {
  const imageBody = Buffer.from("front-image").toString("base64");
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:47652/reports/report-123/bundle?includeAssetBodies=1");
    assert.equal(init?.method, "GET");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-ai-grader-station-token"], "browser-local-station-token");
    assert.equal(headers["x-ai-grader-service-token"], undefined);
    return new Response(JSON.stringify({
      ok: true,
      result: {
        reportId: "report-123",
        source: "history_generated_with_asset_bodies",
        bundle: {
          ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
          reportId: "report-123",
          assets: [
            {
              id: "front/front-all-on-portrait-display.png",
              kind: "image",
              fileName: "front-all-on-portrait-display.png",
              contentType: "image/png",
              bodyEncoding: "base64",
              bodyBase64: imageBody,
            },
          ],
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const bundle = await fetchAiGraderStationReportBundle({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    reportId: "report-123",
    includeAssetBodies: true,
  }, fetchImpl);

  const image = bundle.assets?.find((asset) => asset.fileName === "front-all-on-portrait-display.png");
  assert.equal(image?.bodyEncoding, "base64");
  assert.equal(Buffer.from(image?.bodyBase64 ?? "", "base64").toString("utf8"), "front-image");
});

test("browser station bridge client fetches one local asset for direct storage upload", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:47652/reports/report-123/asset?assetId=front%2Ffront-all-on-portrait-display.png");
    assert.equal(init?.method, "GET");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-ai-grader-station-token"], "browser-local-station-token");
    assert.equal(headers["x-ai-grader-service-token"], undefined);
    return new Response(Buffer.from("front-image"), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "x-ai-grader-sha256": sha256Hex(Buffer.from("front-image")),
      },
    });
  };

  const asset = await fetchAiGraderStationReportAsset({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    reportId: "report-123",
    assetId: "front/front-all-on-portrait-display.png",
  }, fetchImpl);

  assert.equal(Buffer.from(asset.bytes).toString("utf8"), "front-image");
  assert.equal(asset.contentType, "image/png");
  assert.equal(asset.byteSize, Buffer.byteLength("front-image"));
  assert.equal(asset.checksumSha256, sha256Hex(Buffer.from("front-image")));
});

test("browser station bridge preview status and stream use local station token only", async () => {
  const frameBytes = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  const lightingResult = {
    status: "on",
    mode: "browser_live_tuning",
    localOnly: true,
    tokenRequired: true,
    controlsEnabled: true,
    previewRequired: true,
    profile: {
      enabled: true,
      dutyPercent: 1.4,
      actualLeimacPwmStep: 14,
      channels: [1, 3, 5],
      source: "browser_live_tuning",
      acceptedForCapture: true,
    },
    applied: {
      enabled: true,
      dutyPercent: 1.4,
      actualLeimacPwmStep: 14,
      channels: [1, 3, 5],
      lastApplyLatencyMs: 24,
    },
    watchdog: { enabled: true, timeoutMs: 15000 },
    connection: { state: "mock", persistentLeimacSession: false },
    safety: {
      publicRouteExposed: false,
      requiresStationToken: true,
      bindsLoopbackOnly: true,
      productionServiceTokenUsed: false,
      lowDutyCapEnforced: true,
      maxDutyPercent: 5,
      safeOffOnAllOff: true,
      safeOffOnDisconnect: true,
      safeOffOnTimeout: true,
      safeOffOnCaptureStart: true,
      safeOffOnCaptureFailure: true,
      safeOffOnSessionEnd: true,
      persistentLeimacSaved: false,
      arbitraryWritesAllowed: false,
    },
    safetyEvents: [],
    note: "test",
  };
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
    if (String(input).includes("/lighting/")) {
      if (String(input).endsWith("/lighting/status")) {
        assert.equal(init?.method, "GET");
      } else {
        assert.equal(init?.method, "POST");
      }
      return new Response(JSON.stringify({
        ok: true,
        result: String(input).endsWith("/lighting/safe-off")
          ? {
              ...lightingResult,
              status: "safe_off",
              profile: { ...lightingResult.profile, enabled: false },
              applied: { ...lightingResult.applied, enabled: false, dutyPercent: 0, actualLeimacPwmStep: 0, channels: [] },
            }
          : lightingResult,
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

  const lightingStatus = await fetchAiGraderLiveLightingStatus({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
  }, fetchImpl);
  assert.equal(lightingStatus.localOnly, true);
  assert.equal(lightingStatus.tokenRequired, true);
  assert.equal(lightingStatus.safety.productionServiceTokenUsed, false);
  assert.equal(lightingStatus.safety.maxDutyPercent, 5);

  const appliedLighting = await applyAiGraderLiveLighting({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    enabled: true,
    dutyPercent: 1.4,
    channels: [1, 3, 5],
    reason: "test live tuning apply",
  }, fetchImpl);
  assert.deepEqual(appliedLighting.applied.channels, [1, 3, 5]);
  assert.equal(appliedLighting.applied.actualLeimacPwmStep, 14);

  const heartbeatLighting = await heartbeatAiGraderLiveLighting({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    reason: "test heartbeat",
  }, fetchImpl);
  assert.equal(heartbeatLighting.mode, "browser_live_tuning");

  const acceptedLighting = await acceptAiGraderLiveLightingProfile({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    dutyPercent: 1.4,
    channels: [1, 3, 5],
    exposureUs: 47000,
    gain: 0,
  }, fetchImpl);
  assert.equal(acceptedLighting.profile.acceptedForCapture, true);

  const safeOffLighting = await safeOffAiGraderLiveLighting({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    reason: "test all off",
  }, fetchImpl);
  assert.equal(safeOffLighting.applied.enabled, false);
  assert.equal(safeOffLighting.status, "safe_off");

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
  assert.equal(publicBundleText.includes("/lighting/"), false);
  assert.equal(publicBundleText.includes("lighting-apply"), false);
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
