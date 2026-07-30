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

test("Production handler admits the current 2.71 MiB create-card-from-report envelope through the 4 MiB guard", async () => {
  assert.equal(AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, 4 * MEBIBYTE);

  const reportBundle = buildStrictAiGraderReportBundleV03Fixture();
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

  let createCardActionReached = false;
  const handler = createAiGraderProductionApiHandler({
    env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async createCardFromReport(input) {
      createCardActionReached = true;
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

  assert.equal(createCardActionReached, true);
  assert.equal(state.statusCode, 200, JSON.stringify(state.body));
  assert.equal(state.body.result.queueItemId, body.queueItemId);
  assert.equal(state.body.result.reportId, productionRelease.reportId);
  assert.doesNotMatch(String(state.body.message), /must be 1 MB or smaller/i);
});
