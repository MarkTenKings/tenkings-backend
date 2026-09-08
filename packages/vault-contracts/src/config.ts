import { createHash, verify } from "node:crypto";
import { z } from "zod";
import { LegacyVaultDoorMappingSchema, VaultDoorMappingSchema, VAULT_DOOR_MAP } from "./doors";
import { VaultMachineProfileSchema, type VaultMachineProfile } from "./profiles";
import { VAULT_ALLOWED_PRICE_CENTS, VaultProductCategorySchema } from "./domain";
import {
  DEFAULT_CLOUD_FRESHNESS_MS,
  DEFAULT_RETRIEVAL_SECONDS,
  DEFAULT_RETRY_EXTENSION_SECONDS,
  VAULT_TAX_CALCULATION_VERSION,
} from "./money";

export * from "./money";

const httpsUrl = z.string().url().max(2048).refine((value) => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}, "An HTTPS URL without embedded credentials is required");

export const VaultProductConfigSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  photoUrl: httpsUrl,
  description: z.string().min(1).max(1000),
  priceCents: z.number().int().refine((value) => (VAULT_ALLOWED_PRICE_CENTS as readonly number[]).includes(value)),
  category: VaultProductCategorySchema,
  taxClass: z.string().min(1).max(64),
  active: z.boolean(),
});

export const VaultSupportConfigSchema = z.object({
  pageUrl: httpsUrl,
  email: z.string().email(),
  textNumber: z.string().regex(/^\+?[0-9 ()-]{7,32}$/),
  phoneNumber: z.string().regex(/^\+?[0-9 ()-]{7,32}$/),
  hours: z.string().min(1).max(160),
});

const configFields = {
  version: z.number().int().positive(),
  machineId: z.string().uuid(),
  timezone: z.string().min(1).max(80).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "A valid IANA timezone is required"),
  city: z.string().min(1).max(100),
  state: z.string().min(2).max(64),
  taxRateBasisPoints: z.number().int().min(0).max(10_000),
  taxCalculationVersion: z.literal(VAULT_TAX_CALCULATION_VERSION),
  products: z.array(VaultProductConfigSchema).min(1).max(500),
  assignments: z.record(z.string(), z.string().min(1).max(128).nullable()),
  support: VaultSupportConfigSchema,
  minimumAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/).max(64),
  cloudFreshnessMs: z.number().int().min(15_000).max(900_000).default(DEFAULT_CLOUD_FRESHNESS_MS),
  retrievalSeconds: z.number().int().min(10).max(300).default(DEFAULT_RETRIEVAL_SECONDS),
  retryExtensionSeconds: z.number().int().min(10).max(300).default(DEFAULT_RETRY_EXTENSION_SECONDS),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
};

const payloadVersions = z.discriminatedUnion("schemaVersion", [
  z.object({ ...configFields, schemaVersion: z.literal(1), doorMapping: LegacyVaultDoorMappingSchema }),
  z.object({ ...configFields, schemaVersion: z.literal(2), machineProfile: VaultMachineProfileSchema, doorMapping: VaultDoorMappingSchema }).strict(),
]);
export const VaultConfigPayloadSchema = payloadVersions.superRefine((payload, context) => {
  const productIds = new Set(payload.products.map((product) => product.id));
  if (productIds.size !== payload.products.length) context.addIssue({ code: "custom", path: ["products"], message: "Product IDs must be unique" });
  const doors = new Set((payload.schemaVersion === 1 ? VAULT_DOOR_MAP : payload.machineProfile.doors).map((door) => door.doorId as string));
  if (Object.keys(payload.assignments).length !== doors.size || Object.entries(payload.assignments).some(([doorId, productId]) => !doors.has(doorId) || (productId !== null && !productIds.has(productId)))) context.addIssue({ code: "custom", path: ["assignments"], message: "Assignments must contain exactly the profile doors and reference configured products" });
  if (payload.schemaVersion === 2) {
    const endpoints = new Map(payload.machineProfile.controller.endpoints.map((entry) => [entry.endpointId, entry.channelCount]));
    if (payload.doorMapping.length !== doors.size || payload.doorMapping.some((entry) => !doors.has(entry.doorId))) context.addIssue({ code: "custom", path: ["doorMapping"], message: "Mapping must contain exactly the profile doors" });
    if (payload.doorMapping.some((entry) => !entry.controllerEndpointId || !endpoints.has(entry.controllerEndpointId) || entry.controllerChannel > endpoints.get(entry.controllerEndpointId)!)) context.addIssue({ code: "custom", path: ["doorMapping"], message: "Every address must belong to an explicit profile controller endpoint and channel range" });
  }
  if (Date.parse(payload.expiresAt) <= Date.parse(payload.createdAt)) context.addIssue({ code: "custom", path: ["expiresAt"], message: "Configuration expiry must follow creation" });
});
export type VaultConfigPayload = z.infer<typeof VaultConfigPayloadSchema>;

export function configDoorIds(payload: VaultConfigPayload): string[] {
  return (payload.schemaVersion === 1 ? VAULT_DOOR_MAP : payload.machineProfile.doors).map((door) => door.doorId);
}

export function configMachineProfile(payload: VaultConfigPayload): VaultMachineProfile | null {
  return payload.schemaVersion === 2 ? payload.machineProfile : null;
}

export function machineProfileDigest(profile: VaultMachineProfile): string {
  return createHash("sha256").update(canonicalJson(VaultMachineProfileSchema.parse(profile))).digest("hex");
}

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
