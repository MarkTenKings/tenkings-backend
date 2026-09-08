import { createPrivateKey, sign } from "node:crypto";
import { prisma, type Prisma } from "@tenkings/database";
import {
  canonicalJson,
  configDigest,
  SignedVaultConfigSchema,
  configDoorIds,
  machineProfileDigest,
  VaultMachineProfileSchema,
  VaultDoorMappingSchema,
  type VaultMachineProfile,
  VAULT_TAX_CALCULATION_VERSION,
  VaultConfigPayloadSchema,
  type SignedVaultConfig,
  type VaultConfigPayload,
} from "@tenkings/vault-contracts";
import { VaultApiError } from "./http";
import { z } from "zod";
import { vaultArtifactKey, verifyVaultArtifact } from "./certification";

export const VaultProfileEvidenceBindingsSchema = z.object({
  confirmPhrase: z.string().min(1).max(160),
  bindings: z.array(z.object({ kind: z.enum(["geometryDigest", "wiringDigest", "capabilityDigest", "hardwareDigest"]), artifactStorageKey: vaultArtifactKey }).strict()).length(4).refine((value) => new Set(value.map((entry) => entry.kind)).size === 4 && new Set(value.map((entry) => entry.artifactStorageKey)).size === 4),
}).strict();

export async function verifyVaultProfileEvidence(payload: VaultConfigPayload, input: z.infer<typeof VaultProfileEvidenceBindingsSchema>, adminId: string, read = verifyVaultArtifact) {
  input = VaultProfileEvidenceBindingsSchema.parse(input);
  if (payload.schemaVersion !== 2 || payload.machineProfile.provenance !== "QUALIFIED" || !payload.machineProfile.evidence) throw new VaultApiError(409, "QUALIFIED_PROFILE_REQUIRED", "Qualification verification requires a complete physical profile");
  const profile = payload.machineProfile;
  if (input.confirmPhrase !== `QUALIFY ${profile.profileId} r${profile.revision}`) throw new VaultApiError(400, "PROFILE_CONFIRMATION_REQUIRED", "Confirm the reviewed physical qualification reports for this exact profile revision");
  const prefix = `vault-certification/profiles/${payload.machineId}/${profile.profileId}/${profile.revision}/`;
  const bindings = await Promise.all(input.bindings.map(async (entry) => {
    if (!entry.artifactStorageKey.startsWith(prefix)) throw new VaultApiError(400, "PROFILE_EVIDENCE_SCOPE_INVALID", "Profile artifact must bind this machine, profile and revision");
    const digest = profile.evidence![entry.kind];
    await read(entry.artifactStorageKey, digest);
    return { ...entry, digest };
  }));
  return { profileDigest: machineProfileDigest(profile), bindings, verifiedByAdminId: adminId, verifiedAt: new Date().toISOString(), physicalReportsReviewed: true };
}

export function assertVaultProfilePublicationEvidence(payload: VaultConfigPayload, validationSummary: unknown): void {
  if (payload.schemaVersion !== 2 || payload.machineProfile.provenance !== "QUALIFIED") return;
  const summary = validationSummary as { profileEvidence?: Awaited<ReturnType<typeof verifyVaultProfileEvidence>> } | null;
  const evidence = summary?.profileEvidence;
  if (!evidence || evidence.profileDigest !== machineProfileDigest(payload.machineProfile) || evidence.physicalReportsReviewed !== true || !evidence.verifiedByAdminId || !Number.isFinite(Date.parse(evidence.verifiedAt)) || !VaultProfileEvidenceBindingsSchema.safeParse({ confirmPhrase: "verified", bindings: evidence.bindings?.map(({ kind, artifactStorageKey }) => ({ kind, artifactStorageKey })) }).success || evidence.bindings.some((entry) => entry.digest !== payload.machineProfile.evidence?.[entry.kind] || !entry.artifactStorageKey.startsWith(`vault-certification/profiles/${payload.machineId}/${payload.machineProfile.profileId}/${payload.machineProfile.revision}/`))) throw new VaultApiError(409, "PROFILE_EVIDENCE_UNVERIFIED", "Verify and attest the four stored physical qualification reports before publishing this profile");
}

type DraftOverrides = Partial<Pick<
  VaultConfigPayload,
  "minimumAppVersion" | "cloudFreshnessMs" | "retrievalSeconds" | "retryExtensionSeconds" | "expiresAt"
>> & {
  machineProfile?: VaultMachineProfile;
  doorMapping?: ReturnType<typeof VaultDoorMappingSchema.parse>;
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
    client.vaultProduct.findMany({ orderBy: [{ category: "asc" }, { priceCents: "asc" }, { name: "asc" }] }),
    client.vaultDoor.findMany({ where: { machineId }, orderBy: { controllerChannel: "asc" } }),
  ]);
  if (!machine) throw new VaultApiError(404, "MACHINE_NOT_FOUND", "Vault machine was not found");
  if (!products.some((product) => product.active)) throw new VaultApiError(409, "NO_ACTIVE_PRODUCTS", "At least one active Vault product is required");
  const profileInput = overrides.machineProfile ?? machine.draftMachineProfile;
  const profileResult = profileInput === null || profileInput === undefined ? null : VaultMachineProfileSchema.safeParse(profileInput);
  if (profileResult && !profileResult.success) throw new VaultApiError(409, "PROFILE_INCOMPLETE", "Complete the provisional physical profile and explicit mapping before creating an executable configuration");
  const profile = profileResult?.success ? profileResult.data : null;
  const profileIds = profile?.doors.map((door) => door.doorId) ?? doors.filter((door) => !door.retiredAt).map((door) => door.doorId);
  const controllerMapping = profile
    ? VaultDoorMappingSchema.parse(overrides.doorMapping ?? machine.draftDoorMapping)
    : doors.filter((door) => !door.retiredAt).map((door) => ({ doorId: door.doorId, controllerChannel: door.controllerChannel }));
  const support = overrides.machineSettings?.support ?? {
    pageUrl: machine.supportPageUrl ?? "",
    email: machine.supportEmail ?? "",
    textNumber: machine.supportTextNumber ?? "",
    phoneNumber: machine.supportPhoneNumber ?? "",
    hours: machine.supportHours ?? "",
  };
  const createdAt = new Date();
  const expiresAt = overrides.expiresAt ? new Date(overrides.expiresAt) : new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const assignments = Object.fromEntries(profileIds.map((doorId) => [doorId, doors.find((door) => door.doorId === doorId)?.plannedProductId ?? null]));
  return VaultConfigPayloadSchema.parse({
    schemaVersion: profile ? 2 : 1,
    ...(profile ? { machineProfile: profile } : {}),
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
  const canonicalIds = new Set(configDoorIds(parsed));
  if (assignmentKeys.length !== canonicalIds.size || assignmentKeys.some((id) => !canonicalIds.has(id))) {
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
      doorCount: canonicalIds.size,
      profileDigest: parsed.schemaVersion === 2 ? machineProfileDigest(parsed.machineProfile) : null,
      profileProvenance: parsed.schemaVersion === 2 ? parsed.machineProfile.provenance : "LEGACY_V1",
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
  const allIds = [...new Set([...(currentPayloadValue ? configDoorIds(currentPayloadValue) : []), ...configDoorIds(proposed)])];
  const changedDoors = allIds.filter((doorId) => currentPayloadValue?.assignments[doorId] !== proposed.assignments[doorId]);
  const mappingById = new Map<string, unknown>(currentPayloadValue?.doorMapping.map((entry) => [entry.doorId, entry]) ?? []);
  const changedMappingDoorIds = allIds.filter((doorId) => canonicalJson(mappingById.get(doorId) ?? null) !== canonicalJson(proposed.doorMapping.find((entry) => entry.doorId === doorId) ?? null));
  const currentProducts = new Map(currentPayloadValue?.products.map((product) => [product.id, product]) ?? []);
  const changedProducts = proposed.products.filter((product) => {
    const prior = currentProducts.get(product.id);
    return !prior || canonicalJson(prior) !== canonicalJson(product);
  }).map((product) => product.id);
  return {
    profileChanged: canonicalJson(currentPayloadValue?.schemaVersion === 2 ? currentPayloadValue.machineProfile : null) !== canonicalJson(proposed.schemaVersion === 2 ? proposed.machineProfile : null),
    changedMappingDoorIds,
    addedDoorIds: configDoorIds(proposed).filter((doorId) => !currentPayloadValue || !configDoorIds(currentPayloadValue).includes(doorId)),
    retiredDoorIds: (currentPayloadValue ? configDoorIds(currentPayloadValue) : []).filter((doorId) => !configDoorIds(proposed).includes(doorId)),
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
    if (overrides.machineProfile) await client.vaultMachine.update({ where: { id: machineId }, data: { draftMachineProfile: overrides.machineProfile as Prisma.InputJsonValue, draftDoorMapping: payload.doorMapping as Prisma.InputJsonValue } });
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
    const config = await tx.vaultConfigVersion.findUnique({ where: { id: configId }, include: { machine: { select: { activeConfigId: true, pendingConfigId: true, activeConfig: { select: { version: true } }, pendingConfig: { select: { version: true } } } } } });
    if (!config) throw new VaultApiError(404, "CONFIG_NOT_FOUND", "Config draft was not found");
    if (config.status !== "DRAFT" && config.status !== "VALIDATED") {
      throw new VaultApiError(409, "CONFIG_NOT_PUBLISHABLE", "Only draft or validated config can be published");
    }
    if (config.version <= Math.max(config.machine.activeConfig?.version ?? 0, config.machine.pendingConfig?.version ?? 0)) throw new VaultApiError(409, "CONFIG_VERSION_STALE", "Publication must advance both active and pending configuration versions");
    if (config.expiresAt <= new Date()) throw new VaultApiError(409, "CONFIG_EXPIRED", "An expired configuration cannot be published");
    const validated = validateVaultConfigPayload(config.canonicalPayload);
    if (validated.payload.machineId !== config.machineId || validated.payload.version !== config.version || validated.payload.schemaVersion !== config.schemaVersion || validated.digest !== config.digest) throw new VaultApiError(409, "CONFIG_IDENTITY_MISMATCH", "Stored config identity and digest must match its immutable payload");
    assertVaultProfilePublicationEvidence(validated.payload, config.validationSummary);
    const signed = signVaultConfigPayload(validated.payload);
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

/** Reporting membership follows a machine's observed activation. Door records
 * stay addressable forever; historical work reads its own immutable config. */
export async function activateVaultProfileProjection(tx: Prisma.TransactionClient, machineId: string, payload: VaultConfigPayload) {
  const doors = await tx.vaultDoor.findMany({ where: { machineId } });
  const mapping = new Map(payload.doorMapping.map((entry) => [entry.doorId as string, { ...entry, controllerEndpointId: "controllerEndpointId" in entry ? entry.controllerEndpointId! : "legacy" }]));
  const labels = new Map((payload.schemaVersion === 2 ? payload.machineProfile.doors : configDoorIds(payload).map((doorId) => ({ doorId, label: doorId }))).map((door) => [door.doorId as string, door.label]));
  const changed = doors.filter((door) => {
    const next = mapping.get(door.doorId);
    return !door.retiredAt && (!next || next.controllerEndpointId !== door.controllerEndpointId || next.controllerChannel !== door.controllerChannel);
  });
  if (changed.some((door) => !["EMPTY", "DISABLED"].includes(door.state) || door.activeProductId || door.owningSaleId || door.owningRestockId)) throw new VaultApiError(409, "PROFILE_RECONCILIATION_REQUIRED", "Empty and reconcile affected stocked or owned doors before changing their physical profile");
  // Temporarily retire all changed addresses together so an explicit address
  // permutation cannot collide with another address being replaced.
  if (changed.length) await tx.vaultDoor.updateMany({ where: { id: { in: changed.map((door) => door.id) } }, data: { retiredAt: new Date() } });
  for (const [doorId, address] of mapping) {
    const existing = doors.find((door) => door.doorId === doorId);
    await tx.vaultDoor.upsert({
      where: { machineId_doorId: { machineId, doorId } },
      create: { machineId, doorId, controllerChannel: address.controllerChannel, controllerEndpointId: address.controllerEndpointId, doorLabel: labels.get(doorId), plannedProductId: payload.assignments[doorId] },
      update: { controllerChannel: address.controllerChannel, controllerEndpointId: address.controllerEndpointId, doorLabel: labels.get(doorId), retiredAt: null, ...(!existing || existing.retiredAt ? { plannedProductId: payload.assignments[doorId] } : {}) },
    });
  }
}
