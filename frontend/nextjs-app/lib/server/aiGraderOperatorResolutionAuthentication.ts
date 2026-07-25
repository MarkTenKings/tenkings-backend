import { createHash, createHmac } from "node:crypto";
import {
  AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_DOMAIN_V1,
  AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_V1,
  aiGraderOperatorResolutionAuthenticationV1Schema,
  canonicalJsonV1,
  type AiGraderOperatorResolutionAuthenticationV1,
} from "@tenkings/shared";
import type { AiGraderProductionActor } from "./aiGraderProductionAuth";
import {
  AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ENV,
  AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID_ENV,
} from "./aiGraderTrustedCardFormatAuthority";

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const LIFETIME_MS = 60_000;

function exactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new Error(label + " must be one exact bounded identifier.");
  }
  return value;
}

function exactSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(label + " must be one exact SHA-256.");
  }
  return value;
}

export function issueAiGraderOperatorResolutionAuthenticationV1(input: {
  actor: AiGraderProductionActor;
  queueItemId: unknown;
  gradingSessionId: unknown;
  reportId: unknown;
  requestSha256: unknown;
  submissionSha256: unknown;
  idempotencyKey: unknown;
  env?: NodeJS.ProcessEnv;
}): AiGraderOperatorResolutionAuthenticationV1 {
  if (input.actor.type !== "human_operator") {
    throw new Error("Element resolution requires one authenticated human operator.");
  }
  const env = input.env ?? process.env;
  const key = env[AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ENV]?.trim() ?? "";
  const keyId = env[AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID_ENV]?.trim() ?? "";
  if (Buffer.byteLength(key, "utf8") < 32 || !ID.test(keyId)) {
    throw new Error("Operator-resolution authentication signing is not configured.");
  }
  const issuedAtMs = Date.parse(input.actor.audit.requestedAt);
  if (!Number.isFinite(issuedAtMs)) {
    throw new Error("Authenticated operator request time is invalid.");
  }
  const payload = {
    schemaVersion: AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_V1,
    operatorId: exactId(input.actor.user.id, "Authenticated operator ID"),
    operatorRole: input.actor.role,
    queueItemId: exactId(input.queueItemId, "Queue item ID"),
    gradingSessionId: exactId(input.gradingSessionId, "Grading session ID"),
    reportId: exactId(input.reportId, "Report ID"),
    requestSha256: exactSha(input.requestSha256, "Resolution request SHA-256"),
    submissionSha256: exactSha(input.submissionSha256, "Resolution submission SHA-256"),
    idempotencyKey: exactId(input.idempotencyKey, "Resolution idempotency key"),
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + LIFETIME_MS).toISOString(),
  };
  const payloadBytes = canonicalJsonV1(payload);
  return aiGraderOperatorResolutionAuthenticationV1Schema.parse({
    schemaVersion: AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_V1,
    payload,
    payloadSha256: createHash("sha256").update(payloadBytes, "utf8").digest("hex"),
    authentication: {
      algorithm: "hmac-sha256",
      keyId,
      signature: createHmac("sha256", key)
        .update(AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_DOMAIN_V1 + "\n", "utf8")
        .update(payloadBytes, "utf8")
        .digest("hex"),
    },
  });
}
