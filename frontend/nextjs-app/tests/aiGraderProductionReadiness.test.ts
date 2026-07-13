import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  AI_GRADER_EBAY_COMPS_ENABLED_ENV,
  aiGraderProductionReadiness,
  createAiGraderProductionApiHandler,
} from "../lib/server/aiGraderProductionApi";

test("redacted AI Grader readiness reports booleans and the effective dedicated model only", () => {
  const readiness = aiGraderProductionReadiness({
    GOOGLE_VISION_API_KEY: "secret-google-sentinel",
    OPENAI_API_KEY: "secret-openai-sentinel",
    AI_GRADER_OCR_MODEL: "gpt-5.6-sol",
    [AI_GRADER_EBAY_COMPS_ENABLED_ENV]: "true",
    SERPAPI_KEY: "secret-serp-sentinel",
  });
  assert.deepEqual(readiness, {
    googleVisionConfigured: true,
    openAiConfigured: true,
    effectiveAiGraderModel: "gpt-5.6-sol",
    ebayCompsEnabled: true,
    serpApiConfigured: true,
    nfcProgrammingEnabled: false,
    nfcRequired: false,
    nfcAttemptTokenConfigured: false,
    nfcWorkstationAttestationConfigured: false,
    nfcWorkstationKeyCount: 0,
    expectedNfcHelperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
  });
  assert.equal(/secret-.*sentinel/i.test(JSON.stringify(readiness)), false);

  assert.deepEqual(aiGraderProductionReadiness({}), {
    googleVisionConfigured: false,
    openAiConfigured: false,
    effectiveAiGraderModel: "gpt-5.6-sol",
    ebayCompsEnabled: false,
    serpApiConfigured: false,
    nfcProgrammingEnabled: false,
    nfcRequired: false,
    nfcAttemptTokenConfigured: false,
    nfcWorkstationAttestationConfigured: false,
    nfcWorkstationKeyCount: 0,
    expectedNfcHelperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
  });
  assert.equal(aiGraderProductionReadiness({ AI_GRADER_OCR_MODEL: "unsafe model value" }).effectiveAiGraderModel,
    "invalid_configuration");
  assert.equal(aiGraderProductionReadiness({
    AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET: ` ${"x".repeat(31)} `,
  }).nfcAttemptTokenConfigured, false);
  assert.equal(aiGraderProductionReadiness({
    AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET: ` ${"x".repeat(32)} `,
  }).nfcAttemptTokenConfigured, true);
});

test("readiness is authenticated and remains available when writes are disabled", async () => {
  let authCalls = 0;
  const handler = createAiGraderProductionApiHandler({
    env: {
      GOOGLE_VISION_API_KEY: "secret-google-sentinel",
      OPENAI_API_KEY: "secret-openai-sentinel",
      SERPAPI_KEY: "secret-serp-sentinel",
    },
    async requireAdminSession() {
      throw new Error("not used");
    },
    async requireProductionActor(_req, action) {
      authCalls += 1;
      return {
        type: "human_operator",
        role: "operator",
        user: { id: "operator-1", displayName: "Operator", phone: null },
        scopes: ["publish"],
        audit: { actorType: "human_operator", action, requestedAt: "2026-07-11T12:00:00.000Z" },
      } as any;
    },
    publicUrlFor() {
      return "https://cdn.tenkings.test/redacted";
    },
    async persist() {
      throw new Error("not used");
    },
  });
  const req = {
    method: "GET",
    query: { action: ["auth-check"] },
    headers: {},
  } as unknown as NextApiRequest;
  const response: { statusCode: number; body: any } = { statusCode: 0, body: null };
  const res = {
    setHeader() { return this; },
    status(code: number) { response.statusCode = code; return this; },
    json(body: unknown) { response.body = body; return this; },
  } as unknown as NextApiResponse;
  await handler(req, res);
  assert.equal(response.statusCode, 200);
  assert.equal(authCalls, 1);
  assert.equal(response.body.result.readiness.googleVisionConfigured, true);
  assert.equal(response.body.result.readiness.openAiConfigured, true);
  assert.equal(response.body.result.readiness.serpApiConfigured, true);
  assert.equal(/secret-.*sentinel/.test(JSON.stringify(response.body)), false);
});
