import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV,
  assertAuthoritativeConfirmReleaseIdentity,
  assertAiGraderPublishBundleBoundary,
  createAiGraderProductionApiHandler,
} from "../lib/server/aiGraderProductionApi";
import { SAMPLE_AI_GRADER_REPORT_BUNDLE } from "../lib/aiGraderReportBundle";
import { embedAiGraderAuthoritativeProductionRelease } from "../lib/aiGraderLocalStation";
import { buildSampleAiGraderProductionRelease } from "../lib/aiGraderProductionRelease";

function request(body: unknown, action = "publish-init") {
  return {
    method: "POST",
    query: { action: [action] },
    body,
    headers: {},
  } as unknown as NextApiRequest;
}

function response() {
  const state: { statusCode: number; body?: any } = { statusCode: 200 };
  const res = {
    setHeader() {
      return res;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  } as unknown as NextApiResponse;
  return { state, res };
}

function boundaryHandler(onPresign: () => void) {
  return createAiGraderProductionApiHandler({
    env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      onPresign();
      throw new Error("publish boundary must reject before storage planning");
    },
    async persist() {
      throw new Error("publish boundary must reject before persistence");
    },
  });
}

test("publish boundary accepts only report bundle v0.1 and v0.2", async () => {
  const productionRelease = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  assert.doesNotThrow(() => assertAiGraderPublishBundleBoundary(SAMPLE_AI_GRADER_REPORT_BUNDLE, productionRelease));
  assert.doesNotThrow(() =>
    assertAiGraderPublishBundleBoundary(
      { ...SAMPLE_AI_GRADER_REPORT_BUNDLE, schemaVersion: "ai-grader-report-bundle-v0.2" } as any,
      productionRelease,
    ),
  );

  let presignCalled = false;
  const handler = boundaryHandler(() => {
    presignCalled = true;
  });
  const { state, res } = response();
  await handler(
    request({
      publicationStatus: "published",
      reportBundle: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE, schemaVersion: "ai-grader-report-bundle-v9" },
      productionRelease,
    }),
    res,
  );

  assert.equal(state.statusCode, 400);
  assert.equal(state.body.code, "AI_GRADER_UNSUPPORTED_REPORT_BUNDLE_VERSION");
  assert.equal(presignCalled, false);
});

test("publish boundary rejects any true certification claim flag before storage planning", async () => {
  const baseRelease = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  const cases = [
    {
      reportBundle: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE, certifiedClaim: true },
      productionRelease: baseRelease,
    },
    {
      reportBundle: SAMPLE_AI_GRADER_REPORT_BUNDLE,
      productionRelease: { ...baseRelease, certificateGenerated: true },
    },
    {
      reportBundle: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE, certificationClaim: true },
      productionRelease: baseRelease,
    },
    {
      reportBundle: SAMPLE_AI_GRADER_REPORT_BUNDLE,
      productionRelease: { ...baseRelease, certifiedClaim: "true" },
    },
  ];

  for (const payload of cases) {
    let presignCalled = false;
    const handler = boundaryHandler(() => {
      presignCalled = true;
    });
    const { state, res } = response();
    await handler(request({ publicationStatus: "published", ...payload }), res);
    assert.equal(state.statusCode, 400);
    assert.equal(state.body.code, "AI_GRADER_CERTIFIED_CLAIM_REJECTED");
    assert.equal(presignCalled, false);
  }
});

test("publish package re-embeds the exact submitted authoritative production release", () => {
  const originalRelease = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  const linkedRelease = {
    ...originalRelease,
    cardInventoryLinkage: {
      ...originalRelease.cardInventoryLinkage,
      status: "linked" as const,
      cardAssetId: "card-asset-1",
      itemId: "item-1",
      note: "AI Grader report is linked to the exact Ten Kings card and item identity.",
    },
  };
  const staleBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: originalRelease.reportId,
    productionRelease: originalRelease,
  };
  assert.throws(
    () => assertAuthoritativeConfirmReleaseIdentity(staleBundle, linkedRelease),
    /authoritative release exactly as returned/i,
  );

  const authoritativeBundle = embedAiGraderAuthoritativeProductionRelease(staleBundle, linkedRelease);
  assert.equal(authoritativeBundle.productionRelease, linkedRelease);
  assert.deepEqual(authoritativeBundle.productionRelease, linkedRelease);
  assert.doesNotThrow(() => assertAuthoritativeConfirmReleaseIdentity(authoritativeBundle, linkedRelease));
});

test("hosted publish requires the exact queue identity before authority or storage work", async () => {
  const productionRelease = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  let presignCalled = false;
  const handler = boundaryHandler(() => {
    presignCalled = true;
  });
  const { state, res } = response();
  await handler(request({
    publicationStatus: "published",
    reportBundle: SAMPLE_AI_GRADER_REPORT_BUNDLE,
    productionRelease,
  }), res);

  assert.equal(state.statusCode, 400);
  assert.match(String(state.body.message), /queueItemId is required/i);
  assert.equal(presignCalled, false);
});

test("prepublication CardAsset linkage carries one exact triple and performs no publish persistence", async () => {
  const reportId = "prepublication-report-1";
  const gradingSessionId = "prepublication-session-1";
  const queueItemId = "prepublication-queue-1";
  const assets = (["front", "back"] as const).map((side) => ({
    id: `${reportId}/${side}/${side}-normalized-card.png`,
    kind: "image",
    fileName: `${side}-normalized-card.png`,
    contentType: "image/png",
    checksumSha256: side === "front" ? "a".repeat(64) : "b".repeat(64),
    byteSize: side === "front" ? 2048 : 3072,
    widthPx: 1200,
    heightPx: 1680,
    side,
    evidenceRole: "normalized_card",
  }));
  const baseBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId,
    gradingSessionId,
    reportProducer: {
      contractVersion: "ai-grader-report-producer-v0.2",
      capabilities: ["finding-validation-v1", "capture-profile-provenance-v1", "raster-dimensions-v1"],
    },
    visionLab: {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE.visionLab,
      findingValidation: {
        status: "valid" as const,
        sourceCandidateCount: 0,
        publishedFindingCount: 0,
        issues: [],
      },
    },
    assets,
  };
  const productionRelease = buildSampleAiGraderProductionRelease(baseBundle as any);
  const reportBundle = { ...baseBundle, productionRelease };
  const identity = {
    category: "sport",
    playerName: "Michael Jordan",
    year: "1996",
    manufacturer: "Topps",
    sport: "basketball",
    productSet: "Topps",
    cardNumber: "23",
  } as const;
  let persistCalls = 0;
  let linkedInput: any;
  const handler = createAiGraderProductionApiHandler({
    env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async createCardFromReport(input) {
      linkedInput = input;
      return {
        queueItemId,
        gradingSessionId,
        reportId,
        cardAssetId: "card-asset-1",
        itemId: "item-1",
        batchId: "batch-1",
        title: "1996 Topps Michael Jordan #23",
        set: "Topps",
        publicImageUrl: "",
        cardIdentity: {} as any,
        productionRelease,
        itemLinkage: { itemNumberConvention: "Item.number = CardAsset.id" },
      };
    },
    async persist() {
      persistCalls += 1;
      throw new Error("prepublication linkage must not publish");
    },
  });
  const { state, res } = response();
  await handler(request({
    queueItemId,
    publicationStatus: "finalized",
    reportBundle,
    productionRelease,
    identity,
  }, "create-card-from-report"), res);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(
    {
      queueItemId: linkedInput.queueItemId,
      gradingSessionId: linkedInput.reportBundle.gradingSessionId,
      reportId: linkedInput.productionRelease.reportId,
    },
    { queueItemId, gradingSessionId, reportId },
  );
  assert.equal(persistCalls, 0);
  assert.equal(state.body.result.queueItemId, queueItemId);
});
