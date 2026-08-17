import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalJson, redactVaultValue } from "../../vault-contracts/dist";

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
