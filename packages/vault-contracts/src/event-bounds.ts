import { VAULT_MAX_PROFILE_DOORS } from "./doors-core";

/** Same bounded JSON vocabulary accepted by cloud event normalization. */
export function assertVaultEventPayloadBounds(payload: unknown): void {
  let keys = 0;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6) throw new RangeError("Vault event payload exceeds maximum depth");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "string") {
      if (value.length > 4000) throw new RangeError("Vault event payload string is too long");
      return;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) throw new RangeError("Vault event payload requires finite safe integers");
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > VAULT_MAX_PROFILE_DOORS) throw new RangeError("Vault event payload array is too large");
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("Vault event payload requires plain JSON values");
    for (const [key, item] of Object.entries(value)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) throw new RangeError("Vault event payload key is invalid");
      if (++keys > 4096) throw new RangeError("Vault event payload has too many keys");
      visit(item, depth + 1);
    }
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Vault event payload must be an object");
  visit(payload, 0);
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 1024 * 1024) throw new RangeError("Vault event payload exceeds 1048576 bytes");
}
