const DEFAULT_REDACTED = "[REDACTED]";
const MAX_REDACTION_DEPTH = 16;
const DURABLE_BUSINESS_SESSION_IDS = new Set(["restocksessionid", "certificationsessionid"]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  const tokens = new Set(key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean));
  return ["authorization", "auth", "bearer", "token", "secret", "password", "pin", "pan", "cvv", "credential", "cookie", "iban", "magstripe", "cardholder"].some((token) => tokens.has(token))
    || (tokens.has("private") && tokens.has("key"))
    || (tokens.has("transfer") && tokens.has("data"))
    || (tokens.has("track") && (tokens.has("data") || tokens.has("1") || tokens.has("2")))
    || tokens.has("verifier")
    || /(?:verifier.*hash|hash.*verifier)/.test(normalized)
    || (/session(?:id|identifier|key)$/.test(normalized) && !DURABLE_BUSINESS_SESSION_IDS.has(normalized))
    || normalized === "bankaccount"
    || /(?:bank)?account(?:number|num|no)(?:last\d+)?$/.test(normalized)
    || /routing(?:number|num|no)(?:last\d+)?$/.test(normalized)
    || /(?:abanumber|swiftcode)$/.test(normalized)
    || /(?:primaryaccountnumber|cardnumber|cardexpiry|cardexpiration)$/.test(normalized);
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function redactVaultValue(value: unknown): unknown {
  const visited = new WeakSet<object>();
  const visit = (nested: unknown, depth: number): unknown => {
    if (depth >= MAX_REDACTION_DEPTH) return DEFAULT_REDACTED;
    if (typeof nested === "function") return DEFAULT_REDACTED;
    if (!nested || typeof nested !== "object") return nested;
    if (visited.has(nested)) return DEFAULT_REDACTED;
    visited.add(nested);
    if (Array.isArray(nested)) return nested.map((entry) => visit(entry, depth + 1));
    if (!isPlainRecord(nested)) return DEFAULT_REDACTED;
    return Object.fromEntries(Object.entries(nested).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? DEFAULT_REDACTED : visit(entry, depth + 1),
    ]));
  };
  return visit(value, 0);
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
