import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalJson, redactVaultValue } from "../../vault-contracts/dist";
import type { VaultStore } from "./store";
import type { Clock } from "./types";

/** Remember safe wall-clock progress even offline, so a reboot cannot revive
 * authority whose expiry was already observed after the last cloud contact. */
export function isVaultClockUnsafe(store: VaultStore, clock: Clock, bootWall: number, bootMonotonic: number): boolean {
  const now = clock.now(); const monotonic = clock.monotonicMs();
  const trusted = store.one("SELECT last_trusted_wall_at FROM machine_meta WHERE singleton=1").last_trusted_wall_at;
  const unsafe = monotonic < bootMonotonic || Math.abs((now.getTime() - bootWall) - (monotonic - bootMonotonic)) > 5_000
    || Boolean(trusted && Date.parse(String(trusted)) > now.getTime() + 5_000);
  if (!unsafe && (!trusted || String(trusted) < iso(now))) store.run("UPDATE machine_meta SET last_trusted_wall_at=? WHERE singleton=1", iso(now));
  return unsafe;
}

export function iso(date = new Date()): string { return date.toISOString(); }
export function json(value: unknown): string { return canonicalJson(value); }
export function digest(value: unknown): string { return createHash("sha256").update(json(value)).digest("hex"); }
export function eventId(): string { return randomUUID(); }
export function deterministicId(namespace: string, ...parts: string[]): string {
  return `${namespace}_${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 40)}`;
}
export function supportReference(id: string): string {
  return createHash("sha256").update(id).digest("base64url").replace(/[-_]/g, "A").slice(0, 8).toUpperCase();
}
export function parseJson<T>(value: unknown): T { return JSON.parse(String(value)) as T; }
export function secureToken(bytes = 32): string { return randomBytes(bytes).toString("base64url"); }
export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function redactedJson(value: unknown): string { return JSON.stringify(redactVaultValue(value)); }
export function asNumber(value: unknown): number { return Number(value); }
export function asBoolean(value: unknown): boolean { return Number(value) === 1; }
