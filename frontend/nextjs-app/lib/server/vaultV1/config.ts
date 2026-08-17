import { createPrivateKey, sign } from "node:crypto";
import { prisma, type Prisma } from "@tenkings/database";
import {
  canonicalJson,
  configDigest,
  SignedVaultConfigSchema,
  SIMULATOR_DOOR_MAPPING,
  VAULT_DOOR_MAP,
  VAULT_TAX_CALCULATION_VERSION,
  VaultConfigPayloadSchema,
  type SignedVaultConfig,
  type VaultConfigPayload,
} from "@tenkings/vault-contracts";
import { VaultApiError } from "./http";

type DraftOverrides = Partial<Pick<
  VaultConfigPayload,
  "minimumAppVersion" | "cloudFreshnessMs" | "retrievalSeconds" | "retryExtensionSeconds" | "expiresAt"
>> & {
  machineSettings?: Partial<Pick<VaultConfigPayload, "city" | "state" | "taxRateBasisPoints" | "support">>;
};
type VaultPrismaClient = typeof prisma | Prisma.TransactionClient;

function configPrivateKey(): { keyId: string; pem: string } {
  const keyId = String(process.env.VAULT_CONFIG_SIGNING_KEY_ID ?? "").trim();
  const pem = String(process.env.VAULT_CONFIG_SIGNING_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!keyId || !pem) {
    throw new VaultApiError(503, "CONFIG_SIGNING_UNAVAILABLE", "Vault config signing key is not configured");
  }
  return { keyId, pem };
}

export async function buildVaultConfigPayload(machineId: string, version: number, overrides: DraftOverrides = {}, client: VaultPrismaClient = prisma): Promise<VaultConfigPayload> {
  const [machine, products, doors] = await Promise.all([
    client.vaultMachine.findUnique({ where: { id: machineId } }),
    client.vaultProduct.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { priceCents: "asc" }, { name: "asc" }] }),
    client.vaultDoor.findMany({ where: { machineId }, orderBy: { controllerChannel: "asc" } }),
  ]);
  if (!machine) throw new VaultApiError(404, "MACHINE_NOT_FOUND", "Vault machine was not found");
  if (products.length < 1) throw new VaultApiError(409, "NO_ACTIVE_PRODUCTS", "At least one active Vault product is required");
  if (doors.length !== 150) throw new VaultApiError(409, "DOOR_MAP_INCOMPLETE", "Machine must have exactly 150 doors");
  const support = overrides.machineSettings?.support ?? {
    pageUrl: machine.supportPageUrl ?? "",
    email: machine.supportEmail ?? "",
    textNumber: machine.supportTextNumber ?? "",
    phoneNumber: machine.supportPhoneNumber ?? "",
    hours: machine.supportHours ?? "",
  };
  const createdAt = new Date();
  const expiresAt = overrides.expiresAt ? new Date(overrides.expiresAt) : new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const assignments = Object.fromEntries(doors.map((door) => [door.doorId, door.plannedProductId ?? door.activeProductId ?? null]));
  const controllerMapping = doors.every((door) => door.controllerChannel > 0)
    ? doors.map((door) => ({ doorId: door.doorId as (typeof SIMULATOR_DOOR_MAPPING)[number]["doorId"], controllerChannel: door.controllerChannel }))
    : SIMULATOR_DOOR_MAPPING;
  return VaultConfigPayloadSchema.parse({
    schemaVersion: 1,
    version,
    machineId,
    timezone: machine.timezone,
    city: overrides.machineSettings?.city ?? machine.city,
    state: overrides.machineSettings?.state ?? machine.state,
    taxRateBasisPoints: overrides.machineSettings?.taxRateBasisPoints ?? machine.taxRateBasisPoints,
    taxCalculationVersion: VAULT_TAX_CALCULATION_VERSION,
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      photoUrl: product.photoUrl,
      description: product.description,
      priceCents: product.priceCents,
      category: product.category,
      taxClass: product.taxClass,
      active: product.active,
    })),
    doorMapping: controllerMapping,
    assignments,
    support,
    minimumAppVersion: overrides.minimumAppVersion ?? "0.1.0",
    cloudFreshnessMs: overrides.cloudFreshnessMs,
    retrievalSeconds: overrides.retrievalSeconds,
    retryExtensionSeconds: overrides.retryExtensionSeconds,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
}

export function validateVaultConfigPayload(payload: unknown): { payload: VaultConfigPayload; digest: string; summary: Record<string, unknown> } {
  const parsed = VaultConfigPayloadSchema.parse(payload);
  const assignmentKeys = Object.keys(parsed.assignments);
  const canonicalIds = new Set<string>(VAULT_DOOR_MAP.map((door) => door.doorId));
  if (assignmentKeys.length !== 150 || assignmentKeys.some((id) => !canonicalIds.has(id))) {
    throw new VaultApiError(400, "INVALID_ASSIGNMENTS", "Config assignments must contain every canonical door exactly once");
  }
  const productIds = new Set(parsed.products.map((product) => product.id));
  const unknownProduct = Object.entries(parsed.assignments).find(([, productId]) => productId !== null && !productIds.has(productId));
  if (unknownProduct) throw new VaultApiError(400, "UNKNOWN_ASSIGNED_PRODUCT", `Door ${unknownProduct[0]} references an unknown product`);
  const digest = configDigest(parsed);
  return {
    payload: parsed,
    digest,
    summary: {
      valid: true,
      productCount: parsed.products.length,
      assignedDoorCount: Object.values(parsed.assignments).filter(Boolean).length,
      emptyDoorCount: Object.values(parsed.assignments).filter((value) => value === null).length,
      taxRateBasisPoints: parsed.taxRateBasisPoints,
      expiresAt: parsed.expiresAt,
    },
  };
}

export function vaultConfigImpact(currentPayload: unknown, proposedPayload: unknown): Record<string, unknown> {
  const proposed = VaultConfigPayloadSchema.parse(proposedPayload);
  const current = currentPayload ? VaultConfigPayloadSchema.safeParse(currentPayload) : null;
  const currentPayloadValue = current?.success ? current.data : null;
  const changedDoors = VAULT_DOOR_MAP.filter(({ doorId }) => currentPayloadValue?.assignments[doorId] !== proposed.assignments[doorId]).map(({ doorId }) => doorId);
  const currentProducts = new Map(currentPayloadValue?.products.map((product) => [product.id, product]) ?? []);
  const changedProducts = proposed.products.filter((product) => {
    const prior = currentProducts.get(product.id);
    return !prior || canonicalJson(prior) !== canonicalJson(product);
  }).map((product) => product.id);
  return {
    changedDoorCount: changedDoors.length,
    changedDoorIds: changedDoors,
    changedProductIds: changedProducts,
    taxChanged: currentPayloadValue ? currentPayloadValue.taxRateBasisPoints !== proposed.taxRateBasisPoints : true,
    supportChanged: currentPayloadValue ? canonicalJson(currentPayloadValue.support) !== canonicalJson(proposed.support) : true,
    minimumAppVersionChanged: currentPayloadValue ? currentPayloadValue.minimumAppVersion !== proposed.minimumAppVersion : true,
    safeBoundaryRequired: true,
  };
}

export function signVaultConfigPayload(payload: unknown): SignedVaultConfig {
  const { payload: parsed, digest } = validateVaultConfigPayload(payload);
  const signing = configPrivateKey();
  const signature = sign(null, Buffer.from(canonicalJson(parsed)), createPrivateKey(signing.pem)).toString("base64");
  return SignedVaultConfigSchema.parse({ payload: parsed, digest, keyId: signing.keyId, algorithm: "Ed25519", signature });
}

export async function createVaultConfigDraft(machineId: string, adminId: string, overrides: DraftOverrides = {}, tx?: Prisma.TransactionClient) {
  const run = async (client: Prisma.TransactionClient) => {
    await client.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${machineId} FOR UPDATE`;
    const latest = await client.vaultConfigVersion.findFirst({ where: { machineId }, orderBy: { version: "desc" }, select: { version: true } });
    const payload = await buildVaultConfigPayload(machineId, (latest?.version ?? 0) + 1, overrides, client);
    const validated = validateVaultConfigPayload(payload);
    return client.vaultConfigVersion.create({
    data: {
      machineId,
      version: payload.version,
      schemaVersion: payload.schemaVersion,
      status: "DRAFT",
      canonicalPayload: payload as unknown as Prisma.InputJsonValue,
      digest: validated.digest,
      minimumAppVersion: payload.minimumAppVersion,
      createdByAdminId: adminId,
      expiresAt: new Date(payload.expiresAt),
    },
  });
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export async function publishVaultConfig(configId: string, adminId: string, transaction?: Prisma.TransactionClient) {
  const run = async (tx: Prisma.TransactionClient) => {
    const configIdentity = await tx.vaultConfigVersion.findUnique({ where: { id: configId }, select: { machineId: true } });
    if (!configIdentity) throw new VaultApiError(404, "CONFIG_NOT_FOUND", "Config draft was not found");
    await tx.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${configIdentity.machineId} FOR UPDATE`;
    const config = await tx.vaultConfigVersion.findUnique({ where: { id: configId }, include: { machine: { select: { activeConfigId: true, pendingConfigId: true } } } });
    if (!config) throw new VaultApiError(404, "CONFIG_NOT_FOUND", "Config draft was not found");
    if (config.status !== "DRAFT" && config.status !== "VALIDATED") {
      throw new VaultApiError(409, "CONFIG_NOT_PUBLISHABLE", "Only draft or validated config can be published");
    }
    const signed = signVaultConfigPayload(config.canonicalPayload);
    if (config.machine.pendingConfigId && config.machine.pendingConfigId !== config.machine.activeConfigId) {
      await tx.vaultConfigVersion.updateMany({ where: { id: config.machine.pendingConfigId, status: "PUBLISHED" }, data: { status: "SUPERSEDED" } });
    }
    const published = await tx.vaultConfigVersion.update({
      where: { id: config.id },
      data: {
        status: "PUBLISHED",
        digest: signed.digest,
        signingKeyId: signed.keyId,
        signingAlgorithm: signed.algorithm,
        detachedSignature: signed.signature,
        publishedByAdminId: adminId,
        publishedAt: new Date(),
      },
    });
    await tx.vaultMachine.update({ where: { id: config.machineId }, data: { pendingConfigId: config.id } });
    return { published, signed };
  };
  return transaction ? run(transaction) : prisma.$transaction(run);
}
