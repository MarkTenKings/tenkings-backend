import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const VAULT_CONTRACT_VERSION = 1;
export const VAULT_EVENT_BATCH_LIMIT = 250;
// A 150-door SALE_RESERVED snapshot repeats bounded product descriptions and
// photo URLs for every paid line, so the envelope must accommodate the frozen
// maximum cardinality while still imposing a hard cloud boundary.
export const VAULT_EVENT_PAYLOAD_MAX_BYTES = 1024 * 1024;
export const VAULT_EVENT_PAYLOAD_MAX_DEPTH = 6;
export const VAULT_EVENT_PAYLOAD_MAX_KEYS = 4096;
export const VAULT_CERTIFICATION_RETENTION_YEARS = 3;
export const VAULT_ALLOWED_PRICE_CENTS = Object.freeze([2500, 5000, 10_000, 25_000] as const);
export const VAULT_DOOR_ID_PATTERN = /^(X|K|I|N|G|S)-(0[1-9]|1[0-9]|2[0-5])$/;

export type VaultEventSequenceInput = Readonly<{ eventId: string; sequence: number }>;
export type VaultJsonPrimitive = string | number | boolean | null;
export type VaultJsonValue = VaultJsonPrimitive | VaultJsonValue[] | { [key: string]: VaultJsonValue };

const VAULT_SECRET_KEY = /(?:pin|pan|cvv|track|bearer|token|secret|password|private.?key|authorization|credential)|^(?:sessionId|providerSessionId|providerTransactionId)$/i;
const VAULT_REDACTED = "[REDACTED]";
const VAULT_SCRYPT = Object.freeze({ N: 16_384, r: 8, p: 1, keyLength: 64 });

export function hashVaultSecret(secret: string): string {
  if (secret.length < 32) throw new RangeError("Vault secrets must contain at least 32 characters");
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifyVaultSecret(secret: string, expectedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  let actual: Buffer;
  try {
    actual = Buffer.from(hashVaultSecret(secret), "hex");
  } catch {
    return false;
  }
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Exact verifier format consumed by packages/vault-machine/src/auth.ts. */
export function createVaultScryptPinVerifier(pin: string, salt = randomBytes(16)): {
  verifier: string;
  parameters: Readonly<{ N: number; r: number; p: number; keyLength: number }>;
} {
  if (!/^\d{6}$/.test(pin)) throw new RangeError("Vault PIN must contain exactly six digits");
  if (salt.length < 16) throw new RangeError("Vault PIN salt must contain at least 16 bytes");
  const hash = scryptSync(pin, salt, VAULT_SCRYPT.keyLength, {
    N: VAULT_SCRYPT.N,
    r: VAULT_SCRYPT.r,
    p: VAULT_SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return {
    verifier: `scrypt$v=1$N=${VAULT_SCRYPT.N},r=${VAULT_SCRYPT.r},p=${VAULT_SCRYPT.p},l=${VAULT_SCRYPT.keyLength}$${salt.toString("base64")}$${hash.toString("base64")}`,
    parameters: { ...VAULT_SCRYPT },
  };
}

export function verifyVaultScryptPin(pin: string, verifier: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  const pieces = verifier.split("$");
  if (pieces.length !== 5 || pieces[0] !== "scrypt" || pieces[1] !== "v=1") return false;
  const parameters = Object.fromEntries((pieces[2] ?? "").split(",").map((entry) => entry.split("=")));
  if (
    Number(parameters.N) !== VAULT_SCRYPT.N
    || Number(parameters.r) !== VAULT_SCRYPT.r
    || Number(parameters.p) !== VAULT_SCRYPT.p
    || Number(parameters.l) !== VAULT_SCRYPT.keyLength
  ) return false;
  try {
    const salt = Buffer.from(pieces[3] ?? "", "base64");
    const expected = Buffer.from(pieces[4] ?? "", "base64");
    if (salt.length < 16 || expected.length !== VAULT_SCRYPT.keyLength) return false;
    const actual = scryptSync(pin, salt, VAULT_SCRYPT.keyLength, {
      N: VAULT_SCRYPT.N,
      r: VAULT_SCRYPT.r,
      p: VAULT_SCRYPT.p,
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function normalizeEventValue(value: unknown, depth: number, keyBudget: { remaining: number }): VaultJsonValue {
  if (depth > VAULT_EVENT_PAYLOAD_MAX_DEPTH) throw new RangeError("Vault event payload exceeds maximum depth");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 4_000) throw new RangeError("Vault event payload string is too long");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new RangeError("Vault event payload numbers must be finite safe integers");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 150) throw new RangeError("Vault event payload array is too large");
    return value.map((entry) => normalizeEventValue(entry, depth + 1, keyBudget));
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Vault event payload must contain JSON values only");
  }
  const output: Record<string, VaultJsonValue> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) throw new RangeError("Vault event payload contains an invalid key");
    keyBudget.remaining -= 1;
    if (keyBudget.remaining < 0) throw new RangeError("Vault event payload contains too many keys");
    output[key] = VAULT_SECRET_KEY.test(key) ? VAULT_REDACTED : normalizeEventValue(entry, depth + 1, keyBudget);
  }
  return output;
}

/** Revalidates and redacts the cloud-bound payload even though the machine also redacts locally. */
export function normalizeVaultEventPayload(payload: unknown): Record<string, VaultJsonValue> {
  const normalized = normalizeEventValue(payload, 0, { remaining: VAULT_EVENT_PAYLOAD_MAX_KEYS });
  if (!normalized || Array.isArray(normalized) || typeof normalized !== "object") {
    throw new TypeError("Vault event payload must be an object");
  }
  if (Buffer.byteLength(canonicalize(normalized), "utf8") > VAULT_EVENT_PAYLOAD_MAX_BYTES) {
    throw new RangeError(`Vault event payload exceeds ${VAULT_EVENT_PAYLOAD_MAX_BYTES} bytes`);
  }
  return normalized as Record<string, VaultJsonValue>;
}

export function vaultPayloadDigest(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

export function assertVaultEventOrder(events: readonly VaultEventSequenceInput[]): void {
  if (events.length < 1 || events.length > VAULT_EVENT_BATCH_LIMIT) {
    throw new RangeError(`Vault event batches must contain 1-${VAULT_EVENT_BATCH_LIMIT} events`);
  }
  const eventIds = new Set<string>();
  let prior: number | null = null;
  for (const event of events) {
    if (!event.eventId || eventIds.has(event.eventId)) throw new Error("Vault event IDs must be unique within a batch");
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0 || (prior !== null && event.sequence !== prior + 1)) {
      throw new Error("Vault event sequences must be positive and contiguous");
    }
    eventIds.add(event.eventId);
    prior = event.sequence;
  }
}

export function vaultAcknowledgedContiguousPrefix<T extends { eventId: string }>(
  events: readonly T[],
  acceptedIds: ReadonlySet<string>,
): string[] {
  const acknowledged: string[] = [];
  for (const event of events) {
    if (!acceptedIds.has(event.eventId)) break;
    acknowledged.push(event.eventId);
  }
  return acknowledged;
}

export function assertVaultMachinePathBinding(authenticatedMachineId: string, pathMachineId: string): void {
  if (!authenticatedMachineId || authenticatedMachineId !== pathMachineId) {
    throw new Error("Vault machine credential is not authorized for this path");
  }
}

export function vaultProductionSalesFilter(includeCertification = false): Readonly<Record<string, unknown>> {
  return includeCertification ? {} : { mode: "PRODUCTION" };
}

/**
 * A null retention date means the machine is still in service and evidence is
 * retained indefinitely. On decommission, all evidence is assigned the exact
 * service-end date plus three calendar years.
 */
export function vaultCertificationRetainUntil(serviceEndedAt: Date | null): Date | null {
  if (!serviceEndedAt) return null;
  const retained = new Date(serviceEndedAt.getTime());
  retained.setUTCFullYear(retained.getUTCFullYear() + VAULT_CERTIFICATION_RETENTION_YEARS);
  return retained;
}
