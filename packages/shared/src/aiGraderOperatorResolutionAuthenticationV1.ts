import { z } from "zod";

export const AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_V1 =
  "ten-kings-operator-resolution-authentication-v1" as const;
export const AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_DOMAIN_V1 =
  "ten-kings:operator-resolution-authentication:v1" as const;

const exactId = z.string().trim().min(1).max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);
const exactSha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const aiGraderOperatorResolutionAuthenticationPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_V1),
  operatorId: exactId,
  operatorRole: z.enum(["ai_grader_operator", "ai_grader_admin"]),
  queueItemId: exactId,
  gradingSessionId: exactId,
  reportId: exactId,
  requestSha256: exactSha256,
  submissionSha256: exactSha256,
  idempotencyKey: exactId,
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});

export const aiGraderOperatorResolutionAuthenticationV1Schema = z.strictObject({
  schemaVersion: z.literal(AI_GRADER_OPERATOR_RESOLUTION_AUTHENTICATION_V1),
  payload: aiGraderOperatorResolutionAuthenticationPayloadV1Schema,
  payloadSha256: exactSha256,
  authentication: z.strictObject({
    algorithm: z.literal("hmac-sha256"),
    keyId: exactId,
    signature: exactSha256,
  }),
});

export type AiGraderOperatorResolutionAuthenticationPayloadV1 =
  z.infer<typeof aiGraderOperatorResolutionAuthenticationPayloadV1Schema>;
export type AiGraderOperatorResolutionAuthenticationV1 =
  z.infer<typeof aiGraderOperatorResolutionAuthenticationV1Schema>;
