import { createHash, verify } from "node:crypto";
import { z } from "zod";
import { VaultDoorMappingSchema } from "./doors";
import { VAULT_ALLOWED_PRICE_CENTS, VaultProductCategorySchema } from "./domain";
import {
  DEFAULT_CLOUD_FRESHNESS_MS,
  DEFAULT_RETRIEVAL_SECONDS,
  DEFAULT_RETRY_EXTENSION_SECONDS,
  VAULT_TAX_CALCULATION_VERSION,
} from "./money";

export * from "./money";

export const VaultProductConfigSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  photoUrl: z.string().url().max(2048),
  description: z.string().min(1).max(1000),
  priceCents: z.number().int().refine((value) => (VAULT_ALLOWED_PRICE_CENTS as readonly number[]).includes(value)),
  category: VaultProductCategorySchema,
  taxClass: z.string().min(1).max(64),
  active: z.boolean(),
});

export const VaultSupportConfigSchema = z.object({
  pageUrl: z.string().url(),
  email: z.string().email(),
  textNumber: z.string().min(7).max(32),
  phoneNumber: z.string().min(7).max(32),
  hours: z.string().min(1).max(160),
});

export const VaultConfigPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.number().int().positive(),
  machineId: z.string().uuid(),
  timezone: z.string().min(1).max(80),
  city: z.string().min(1).max(100),
  state: z.string().min(2).max(64),
  taxRateBasisPoints: z.number().int().min(0).max(10_000),
  taxCalculationVersion: z.literal(VAULT_TAX_CALCULATION_VERSION),
  products: z.array(VaultProductConfigSchema).min(1),
  doorMapping: VaultDoorMappingSchema,
  assignments: z.record(z.string(), z.string().min(1).max(128).nullable()),
  support: VaultSupportConfigSchema,
  minimumAppVersion: z.string().min(1).max(64),
  cloudFreshnessMs: z.number().int().min(15_000).max(900_000).default(DEFAULT_CLOUD_FRESHNESS_MS),
  retrievalSeconds: z.number().int().min(10).max(300).default(DEFAULT_RETRIEVAL_SECONDS),
  retryExtensionSeconds: z.number().int().min(10).max(300).default(DEFAULT_RETRY_EXTENSION_SECONDS),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type VaultConfigPayload = z.infer<typeof VaultConfigPayloadSchema>;

export const SignedVaultConfigSchema = z.object({
  payload: VaultConfigPayloadSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  keyId: z.string().min(1).max(128),
  algorithm: z.literal("Ed25519"),
  signature: z.string().base64(),
});
export type SignedVaultConfig = z.infer<typeof SignedVaultConfigSchema>;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function configDigest(payload: VaultConfigPayload): string {
  return createHash("sha256").update(canonicalJson(VaultConfigPayloadSchema.parse(payload))).digest("hex");
}

export function verifySignedConfig(config: SignedVaultConfig, publicKeyPem: string): boolean {
  const parsed = SignedVaultConfigSchema.parse(config);
  const canonical = canonicalJson(parsed.payload);
  return parsed.digest === createHash("sha256").update(canonical).digest("hex")
    && verify(null, Buffer.from(canonical), publicKeyPem, Buffer.from(parsed.signature, "base64"));
}
