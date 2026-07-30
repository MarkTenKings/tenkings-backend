import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { aiGraderReportBundleV03Schema } from "@tenkings/shared";
import {
  AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV,
  AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES,
  createAiGraderProductionApiHandler,
} from "../lib/server/aiGraderProductionApi";
import {
  buildStrictAiGraderMathematicalReleaseV1Fixture,
  buildStrictAiGraderReportBundleV03Fixture,
} from "./fixtures/strictAiGraderReportBundleV03";

const MEBIBYTE = 1024 * 1024;
const PRODUCTION_REQUEST_BYTES = Math.round(2.71 * MEBIBYTE);

function request(body: unknown) {
  return {
    method: "POST",
    query: { action: ["create-card-from-report"] },
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

test("Production handler projects private capture timing before scanning the current 2.71 MiB create-card-from-report envelope", async () => {
  assert.equal(AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, 4 * MEBIBYTE);

  const reportBundle = buildStrictAiGraderReportBundleV03Fixture();
  const leimacHost = "169.254.191.156";
  reportBundle.captureTiming = {
    schemaVersion: "ten-kings-ai-grader-capture-timing-v1",
    captureProfile: "production_fast",
    front: {
      lightingProfileChanges: {
        writes: [{ host: leimacHost, port: 1000, frame: "W1100" }],
      },
    },
    events: [],
    phases: [],
    summary: {
      frontProcessingOverlappedFlip: true,
      totalFrontMs: 4200,
      totalBackMs: 4300,
    },
  };
  reportBundle.geometry = {
    ...(reportBundle.geometry ?? {}),
    productionTransportPadding: "",
  };
  const productionRelease =
    buildStrictAiGraderMathematicalReleaseV1Fixture(reportBundle);
  const body = {
    queueItemId: "production-payload-limit-rapid-card",
    publicationStatus: "finalized",
    reportBundle,
    productionRelease,
    identity: {
      category: "tcg",
      cardName: "Blastoise",
      year: "2022",
      manufacturer: "The Pokemon Company",
      game: "Pokemon",
      productSet: "Pokemon GO",
      cardNumber: "017/078",
    },
  };
  const unpaddedBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  const paddingBytes = PRODUCTION_REQUEST_BYTES - unpaddedBytes;
  assert.ok(paddingBytes > 0);
  reportBundle.geometry.productionTransportPadding = "x".repeat(paddingBytes);

  assert.equal(aiGraderReportBundleV03Schema.safeParse(reportBundle).success, true);
  const bodyBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  assert.equal(bodyBytes, PRODUCTION_REQUEST_BYTES);
  assert.ok(bodyBytes > MEBIBYTE);
  assert.ok(bodyBytes < AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES);

  let createCardActionCalls = 0;
  let projectedReportBundle: any;
  const handler = createAiGraderProductionApiHandler({
    env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async createCardFromReport(input) {
      createCardActionCalls += 1;
      projectedReportBundle = input.reportBundle;
      return {
        queueItemId: input.queueItemId,
        gradingSessionId: input.reportBundle.gradingSessionId,
        reportId: input.productionRelease.reportId,
        cardAssetId: "card-asset-payload-limit",
        itemId: "item-payload-limit",
        batchId: "batch-payload-limit",
        title: "2022 Pokemon GO Blastoise #017/078",
        set: "Pokemon GO",
        publicImageUrl: "",
        cardIdentity: input.identity as any,
        productionRelease: input.productionRelease,
        itemLinkage: { itemNumberConvention: "Item.number = CardAsset.id" },
      };
    },
    async persist() {
      throw new Error("publish persistence must not run");
    },
  });
  const { state, res } = response();
  await handler(request(body), res);

  assert.equal(createCardActionCalls, 1);
  assert.equal(state.statusCode, 200, JSON.stringify(state.body));
  assert.equal(state.body.result.queueItemId, body.queueItemId);
  assert.equal(state.body.result.reportId, productionRelease.reportId);
  assert.doesNotMatch(String(state.body.message), /must be 1 MB or smaller/i);
  assert.equal(projectedReportBundle.captureTiming.schemaVersion, "ten-kings-ai-grader-capture-timing-v1");
  assert.equal(projectedReportBundle.captureTiming.captureProfile, "production_fast");
  assert.deepEqual(projectedReportBundle.captureTiming.summary, reportBundle.captureTiming.summary);
  assert.equal("front" in projectedReportBundle.captureTiming, false);
  assert.doesNotMatch(JSON.stringify(projectedReportBundle), new RegExp(leimacHost.replaceAll(".", "\\.")));
  assert.equal((reportBundle.captureTiming as any).front.lightingProfileChanges.writes[0].host, leimacHost);

  const unsafeBody = structuredClone(body);
  (unsafeBody.reportBundle.geometry as any).stationToken = "must-still-be-rejected";
  const unsafeResponse = response();
  await handler(request(unsafeBody), unsafeResponse.res);

  assert.equal(unsafeResponse.state.statusCode, 400);
  assert.match(
    String(unsafeResponse.state.body?.message),
    /body\.reportBundle\.geometry\.stationToken/,
  );
  assert.equal(createCardActionCalls, 1);
});
