import type { VaultDoorId, VaultMode } from "../types";

const CHECKOUT_INTENT_KEY = "ten-kings-vault:checkout-intent-v1";
const PAYMENT_INTENT_PREFIX = "ten-kings-vault:payment-intent-v1:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CheckoutIntentRecord {
  version: 1;
  fingerprint: string;
  idempotencyKey: string;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // The local service remains authoritative. Storage denial only removes browser-side retry convenience.
  }
}

function remove(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Best-effort cleanup of non-secret idempotency metadata.
  }
}

export function checkoutFingerprint(configVersion: number, mode: VaultMode, doorIds: readonly VaultDoorId[]): string {
  return `v1|${configVersion}|${mode}|${[...doorIds].sort().join(",")}`;
}

export function checkoutIdempotencyKey(
  fingerprint: string,
  storage: Storage | null = browserStorage(),
  createKey: () => string = () => crypto.randomUUID(),
): string {
  const existing = read(storage, CHECKOUT_INTENT_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as CheckoutIntentRecord;
      if (parsed.version === 1 && parsed.fingerprint === fingerprint && UUID_PATTERN.test(parsed.idempotencyKey)) {
        return parsed.idempotencyKey;
      }
    } catch {
      // Replace malformed browser metadata with a new exact-intent record.
    }
  }
  const idempotencyKey = createKey();
  write(storage, CHECKOUT_INTENT_KEY, JSON.stringify({ version: 1, fingerprint, idempotencyKey } satisfies CheckoutIntentRecord));
  return idempotencyKey;
}

export function clearCheckoutIdempotencyKey(storage: Storage | null = browserStorage()): void {
  remove(storage, CHECKOUT_INTENT_KEY);
}

export function paymentIdempotencyKey(
  saleId: string,
  storage: Storage | null = browserStorage(),
  createKey: () => string = () => crypto.randomUUID(),
): string {
  const key = `${PAYMENT_INTENT_PREFIX}${saleId}`;
  const existing = read(storage, key);
  if (existing && UUID_PATTERN.test(existing)) return existing;
  const created = createKey();
  write(storage, key, created);
  return created;
}

export function clearPaymentIdempotencyKey(saleId: string, storage: Storage | null = browserStorage()): void {
  remove(storage, `${PAYMENT_INTENT_PREFIX}${saleId}`);
}
