const SENSITIVE_FIELD_VALUE =
  /((?:attemptToken|tokenSecret|tokenHash|attestationChallenge|attestationChallengeHash|signature|uidFingerprintSha256|readbackPayloadSha256|workstationKeyId|publicSpkiDerBase64|privateKey)\s*[:=]\s*)(?:["']?)[A-Za-z0-9_+\/-]{16,}={0,2}(?:["']?)/gi;
const OPAQUE_SENSITIVE_VALUE =
  /(?<![A-Za-z0-9_+\/-])(?:[a-f0-9]{64}|[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{64}|[A-Za-z0-9_-]{86}|[A-Za-z0-9+/]{80,}={0,2})(?![A-Za-z0-9_+\/-])/g;

export function sanitizeAiGraderNfcValidationOutput(value, options = {}) {
  let sanitized = String(value ?? "");
  const databasePassword = typeof options.databasePassword === "string" ? options.databasePassword : "";
  if (databasePassword) sanitized = sanitized.replaceAll(databasePassword, "<redacted>");
  return sanitized
    .replace(/postgres(?:ql)?:\/\/[^\s'"\]]+/gi, "<redacted-database-url>")
    .replace(/DATABASE_URL\s*=\s*[^\s]+/gi, "DATABASE_URL=<redacted>")
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gi, "<redacted-private-key>")
    .replace(SENSITIVE_FIELD_VALUE, "$1<redacted-sensitive-value>")
    .replace(OPAQUE_SENSITIVE_VALUE, "<redacted-sensitive-value>");
}
