export function requireValidationProof(condition, code) {
  if (!condition) throw new Error(`AI_GRADER_NFC_VALIDATION_${code}`);
}

export function assertDisposableDatabaseTarget({ acknowledgement, databaseUrl, expectedUser, expectedDatabase }) {
  requireValidationProof(acknowledgement === "1", "DISPOSABLE_ACK_REQUIRED");
  requireValidationProof(typeof databaseUrl === "string" && databaseUrl.length > 0, "DATABASE_URL_REQUIRED");
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("AI_GRADER_NFC_VALIDATION_DATABASE_URL_INVALID");
  }
  requireValidationProof(parsed.protocol === "postgresql:" || parsed.protocol === "postgres:", "DATABASE_PROTOCOL_REFUSED");
  requireValidationProof(parsed.hostname === "127.0.0.1", "DATABASE_HOST_REFUSED");
  requireValidationProof(decodeURIComponent(parsed.username) === expectedUser, "DATABASE_USER_REFUSED");
  requireValidationProof(decodeURIComponent(parsed.pathname.slice(1)) === expectedDatabase, "DATABASE_NAME_REFUSED");
  return parsed;
}

export function isLocalDockerEndpoint(endpoint) {
  if (typeof endpoint !== "string") return false;
  if (endpoint.startsWith("npipe://") || endpoint.startsWith("unix://")) return true;
  if (!endpoint.startsWith("tcp://")) return false;
  try {
    const parsed = new URL(endpoint);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

export function buildDisposableCleanupArgs(composeArgs) {
  requireValidationProof(Array.isArray(composeArgs) && composeArgs.length > 0, "CLEANUP_SCOPE_REQUIRED");
  return [...composeArgs, "down", "--volumes", "--remove-orphans"];
}

export function createDisposableCleanupPlan(composeArgs) {
  const cleanupArgs = buildDisposableCleanupArgs(composeArgs);
  let claimed = false;
  return {
    claim() {
      if (claimed) return null;
      claimed = true;
      return [...cleanupArgs];
    },
  };
}
