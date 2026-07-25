import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_DOMAIN_V1,
  canonicalJsonV1,
} from "@tenkings/shared";
import { issueAiGraderOperatorResolutionAuthenticationV1 } from
  "../lib/server/aiGraderOperatorResolutionAuthentication";

const HMAC_KEY = "operator-resolution-server-auth-test-key-0001";
const HMAC_KEY_ID = "operator-resolution-server-auth-test-v1";
const ENV = {
  NODE_ENV: "test",
  AI_GRADER_PRODUCTION_PUBLISH_ENABLED: "true",
  AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY: HMAC_KEY,
  AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID: HMAC_KEY_ID,
};

const actor = {
  type: "human_operator",
  role: "ai_grader_admin",
  user: {
    id: "owner-user-1",
    displayName: "Owner",
    phone: null,
  },
  sessionId: "hosted-session-1",
  tokenHash: "a".repeat(64),
  audit: {
    actorType: "human_operator",
    action: "publish",
    requestedAt: "2026-07-24T23:00:00.000Z",
    userId: "owner-user-1",
    role: "ai_grader_admin",
  },
} as const;

const exact = {
  queueItemId: "queue-item-1",
  gradingSessionId: "grading-session-1",
  reportId: "report-1",
  requestSha256: "a".repeat(64),
  submissionSha256: "b".repeat(64),
  idempotencyKey: "operator-resolution-idempotency-1",
};

test("server-issued operator authentication binds exact identity, time, and submission", () => {
  const authentication = issueAiGraderOperatorResolutionAuthenticationV1({
    actor: actor as any,
    ...exact,
    env: ENV,
  });
  assert.equal(authentication.payload.operatorId, actor.user.id);
  assert.equal(authentication.payload.operatorRole, actor.role);
  assert.equal(authentication.payload.issuedAt, actor.audit.requestedAt);
  assert.equal(
    Date.parse(authentication.payload.expiresAt) -
      Date.parse(authentication.payload.issuedAt),
    60_000,
  );
  const bytes = canonicalJsonV1(authentication.payload);
  assert.equal(
    authentication.payloadSha256,
    createHash("sha256").update(bytes, "utf8").digest("hex"),
  );
  assert.equal(
    authentication.authentication.signature,
    createHmac("sha256", HMAC_KEY)
      .update(AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_DOMAIN_V1 + "\n", "utf8")
      .update(bytes, "utf8")
      .digest("hex"),
  );
  assert.throws(
    () => issueAiGraderOperatorResolutionAuthenticationV1({
      actor: {
        type: "service_account",
        role: "ai_grader_service",
        serviceAccountId: "service-1",
        scopes: ["publish"],
        audit: {
          actorType: "service_account",
          action: "publish",
          requestedAt: actor.audit.requestedAt,
        },
      } as any,
      ...exact,
      env: ENV,
    }),
    /authenticated human operator/i,
  );
});

test("production API and browser client expose only the server-authenticated claim boundary", () => {
  const apiSource = readFileSync(
    new URL("../lib/server/aiGraderProductionApi.ts", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(
    new URL("../pages/api/admin/ai-grader/production/[...action].ts", import.meta.url),
    "utf8",
  );
  const clientSource = readFileSync(
    new URL("../lib/aiGraderStationBridgeClient.ts", import.meta.url),
    "utf8",
  );
  assert.match(apiSource, /"operator-resolution-authentication"/);
  assert.match(
    apiSource,
    /key === "operator-resolution-authentication"[\s\S]*?"publish"/,
  );
  assert.match(
    apiSource,
    /parseOperatorResolutionAuthenticationBody\(req\.body\)/,
  );
  assert.match(
    apiSource,
    /issueOperatorResolutionAuthentication\(\{[\s\S]*?actor: authorizedActor/,
  );
  assert.match(routeSource, /issueAiGraderOperatorResolutionAuthenticationV1/);
  assert.match(
    clientSource,
    /\/api\/admin\/ai-grader\/production\/operator-resolution-authentication/,
  );
  const parserBlock = apiSource.slice(
    apiSource.indexOf("function parseOperatorResolutionAuthenticationBody"),
    apiSource.indexOf("function dateString"),
  );
  assert.doesNotMatch(parserBlock, /operatorId/);
});
