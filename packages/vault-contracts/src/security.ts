const DEFAULT_REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(?:authorization|bearer|token|secret|password|pin|pan|cvv|track|credential|private.?key|transfer.?data)/i;

export function redactVaultValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactVaultValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    SENSITIVE_KEY.test(key) ? DEFAULT_REDACTED : redactVaultValue(nested),
  ]));
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
