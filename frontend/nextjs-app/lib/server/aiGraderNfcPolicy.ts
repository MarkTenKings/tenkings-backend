import {
  AI_GRADER_NFC_EXPECTED_HELPER_PROTOCOL_VERSION,
  AI_GRADER_NFC_FEIJU_F8215_ENABLED_ENV,
  AI_GRADER_NFC_PROGRAMMING_ENABLED_ENV,
  AI_GRADER_NFC_WORKSTATION_PUBLIC_KEYS_ENV,
  getAiGraderNfcWorkstationKeyReadiness,
} from "@tenkings/database";

export const AI_GRADER_NFC_REQUIRED_ENV = "AI_GRADER_NFC_REQUIRED" as const;
export const AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET_ENV = "AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET" as const;

type EnvLike = Record<string, string | undefined>;

/**
 * NFC is an additive inventory policy and remains disabled unless production
 * operators explicitly enable the exact server-side flag.
 */
export function aiGraderNfcRequired(env: EnvLike = process.env) {
  return env[AI_GRADER_NFC_REQUIRED_ENV] === "true";
}

export type AiGraderNfcProgrammingReadiness = {
  nfcSchemaReady: boolean;
  nfcProgrammingEnabled: boolean;
  nfcFeijuF8215Enabled: boolean;
  nfcRequired: boolean;
  nfcAttemptTokenConfigured: boolean;
  nfcWorkstationAttestationConfigured: boolean;
  nfcWorkstationKeyCount: number;
  expectedNfcHelperProtocolVersion: string;
};

/**
 * Redacted hosted readiness. Malformed key configuration is represented only
 * as not configured; public-key bodies and key identifiers never cross this
 * authenticated status boundary.
 */
export function aiGraderNfcProgrammingReadiness(
  env: EnvLike = process.env,
  tenantId = env.AI_GRADER_PRODUCTION_TENANT_ID?.trim() || "ten-kings",
  nfcSchemaReady = false,
): AiGraderNfcProgrammingReadiness {
  const secret = String(env[AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET_ENV] ?? "").trim();
  let workstation = { configured: false, keyCount: 0 };
  try {
    workstation = getAiGraderNfcWorkstationKeyReadiness(
      env[AI_GRADER_NFC_WORKSTATION_PUBLIC_KEYS_ENV],
      tenantId,
    );
  } catch {
    // Mutating endpoints still fail with a fixed configuration error. Status
    // intentionally does not disclose why key material was rejected.
  }
  return {
    nfcSchemaReady,
    nfcProgrammingEnabled: env[AI_GRADER_NFC_PROGRAMMING_ENABLED_ENV] === "true",
    nfcFeijuF8215Enabled: env[AI_GRADER_NFC_FEIJU_F8215_ENABLED_ENV] === "true",
    nfcRequired: aiGraderNfcRequired(env),
    nfcAttemptTokenConfigured: Buffer.byteLength(secret, "utf8") >= 32,
    nfcWorkstationAttestationConfigured: workstation.configured,
    nfcWorkstationKeyCount: workstation.keyCount,
    expectedNfcHelperProtocolVersion: AI_GRADER_NFC_EXPECTED_HELPER_PROTOCOL_VERSION,
  };
}
