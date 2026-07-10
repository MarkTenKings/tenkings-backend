import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV,
  assertAiGraderPublishBundleBoundary,
  createAiGraderProductionApiHandler,
} from "../lib/server/aiGraderProductionApi";
import { SAMPLE_AI_GRADER_REPORT_BUNDLE } from "../lib/aiGraderReportBundle";
import { buildSampleAiGraderProductionRelease } from "../lib/aiGraderProductionRelease";

function request(body: unknown) {
  return {
    method: "POST",
    query: { action: ["publish-init"] },
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
