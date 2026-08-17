import { createHash, createPrivateKey, randomBytes, randomUUID, sign } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { createVaultScryptPinVerifier, prisma, type Prisma, vaultPayloadDigest } from "@tenkings/database";
import {
  canonicalJson,
  calculateTaxCents,
  parseTaxPercentageToBasisPoints,
  SIMULATOR_DOOR_MAPPING,
  VAULT_ALLOWED_PRICE_CENTS,
  VaultDoorIdSchema,
  VaultProductConfigSchema,
} from "@tenkings/vault-contracts";
import { z } from "zod";
import {
  createVaultConfigDraft,
  publishVaultConfig,
  validateVaultConfigPayload,
  vaultConfigImpact,
} from "../../../../../lib/server/vaultV1/config";
import {
  methodNotAllowed,
  requireVaultAdmin,
  requireVaultContract,
  requireVaultJson,
  sendVaultError,
  vaultRequestId,
  VaultApiError,
  writeVaultAdminAudit,
  type VaultAdminAuthority,
} from "../../../../../lib/server/vaultV1/http";
import {
  evaluateVaultCertificationApproval,
  VaultCertificationEvidenceManifestSchema,
} from "../../../../../lib/server/vaultV1/certification";
import { VaultFinancialResolutionSchema, vaultSaleAdminDto, vaultSupportCaseAdminDto } from "../../../../../lib/server/vaultV1/support";

const productInputSchema = VaultProductConfigSchema.omit({ id: true }).extend({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), reason: z.string().min(8).max(500).optional() });
const machineInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  serialNumber: z.string().trim().min(3).max(120),
  displayName: z.string().trim().min(1).max(120),
  locationLabel: z.string().trim().max(160).nullable().optional(),
  timezone: z.string().trim().min(1).max(80),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(2).max(64),
  taxPercentage: z.string(),
  support: z.object({
    pageUrl: z.string().url(), email: z.string().email(), textNumber: z.string().min(7).max(32),
    phoneNumber: z.string().min(7).max(32), hours: z.string().min(1).max(160),
  }),
  reason: z.string().min(8).max(500),
});
const configDraftSchema = z.object({
  minimumAppVersion: z.string().min(1).max(64).optional(),
  cloudFreshnessMs: z.number().int().min(15_000).max(900_000).optional(),
  retrievalSeconds: z.number().int().min(10).max(300).optional(),
  retryExtensionSeconds: z.number().int().min(10).max(300).optional(),
  expiresAt: z.string().datetime().optional(),
  machineSettings: machineInputSchema.pick({ city: true, state: true, taxPercentage: true, support: true }).partial().optional(),
  reason: z.string().min(8).max(500),
});
const doorPlanSchema = z.object({
  dryRun: z.boolean().default(true),
  confirmPhrase: z.string().optional(),
  reason: z.string().min(8).max(500).optional(),
  assignments: z.array(z.object({ doorId: VaultDoorIdSchema, productId: z.string().uuid().nullable() })).min(1).max(150),
});
const staffAccessSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant"), userId: z.string().min(1).max(128), role: z.enum(["RESTOCKER", "TECHNICIAN", "ADMIN"]), pin: z.string().regex(/^\d{6}$/), validFrom: z.string().datetime(), expiresAt: z.string().datetime(), reason: z.string().min(8).max(500) }),
  z.object({ action: z.literal("revoke"), grantId: z.string().uuid(), reason: z.string().min(8).max(500) }),
]);
const enrollmentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), expiresInMinutes: z.number().int().min(5).max(1440).default(60), reason: z.string().min(8).max(500) }),
  z.object({ action: z.literal("revoke-credential"), credentialId: z.string().uuid(), reason: z.string().min(8).max(500) }),
  z.object({ action: z.literal("decommission"), confirmPhrase: z.string().max(200), reason: z.string().min(8).max(500) }),
]);
const supportMutationSchema = z.object({
  caseId: z.string().uuid(), status: z.enum(["INVESTIGATING", "RESOLVED", "CLOSED"]),
  resolutionReason: z.string().min(8).max(2000), financialResolution: VaultFinancialResolutionSchema.optional(),
});
const certificationMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), certificationId: z.string().uuid(), reason: z.string().min(8).max(1000) }).strict(),
  z.object({ action: z.literal("invalidate"), certificationId: z.string().uuid(), reason: z.string().min(8).max(1000) }).strict(),
  VaultCertificationEvidenceManifestSchema.extend({ action: z.literal("attach-manifest") }),
]);

function pathParts(req: NextApiRequest): string[] {
  const value = req.query.path;
  return (Array.isArray(value) ? value : [String(value ?? "")]).filter(Boolean);
}

function queryBoolean(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === "true";
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function listMachines() {
  return prisma.vaultMachine.findMany({
    orderBy: { displayName: "asc" },
    include: {
      _count: { select: { doors: true, sales: true, supportCases: true, certificationSessions: true } },
      activeConfig: { select: { id: true, version: true, digest: true, status: true, publishedAt: true } },
      pendingConfig: { select: { id: true, version: true, digest: true, status: true, publishedAt: true } },
    },
  });
}

function signingKey() {
  const keyId = String(process.env.VAULT_CONFIG_SIGNING_KEY_ID ?? "").trim();
  const pem = String(process.env.VAULT_CONFIG_SIGNING_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!keyId || !pem) throw new VaultApiError(503, "CERTIFICATE_SIGNING_UNAVAILABLE", "Vault signing key is not configured");
  return { keyId, key: createPrivateKey(pem) };
}

async function handleProducts(req: NextApiRequest, res: NextApiResponse, requestId: string) {
  if (req.method === "GET") {
    await requireVaultAdmin(req, { permission: "PRODUCT_MANAGE" });
    return res.status(200).json({ requestId, products: await prisma.vaultProduct.findMany({ orderBy: [{ active: "desc" }, { category: "asc" }, { priceCents: "asc" }] }) });
  }
  if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"], requestId);
  requireVaultJson(req, 64 * 1024);
  const input = productInputSchema.parse(req.body);
  const authority = await requireVaultAdmin(req, { permission: "PRODUCT_MANAGE", fresh: true, reason: input.reason });
  const { reason: _reason, ...productInput } = input;
  const product = await prisma.$transaction(async (tx) => {
    const updated = await tx.vaultProduct.upsert({
      where: { slug: input.slug },
      create: { ...productInput, createdByAdminId: authority.admin.user.id },
      update: { ...productInput, deactivatedAt: input.active ? null : new Date(), deactivatedByAdminId: input.active ? null : authority.admin.user.id },
    });
    await writeVaultAdminAudit({ req, authority, tx, action: "vault.product.upsert", outcome: "SUCCESS", targetType: "VaultProduct", targetId: updated.id, payloadDigest: vaultPayloadDigest(productInput) });
    return updated;
  });
  return res.status(200).json({ requestId, product });
}

async function handleMachines(req: NextApiRequest, res: NextApiResponse, requestId: string) {
  if (req.method === "GET") {
    await requireVaultAdmin(req, { permission: "DIAGNOSTICS_VIEW" });
    return res.status(200).json({ requestId, machines: await listMachines() });
  }
  if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"], requestId);
  requireVaultJson(req, 64 * 1024);
  const input = machineInputSchema.parse(req.body);
  const authority = await requireVaultAdmin(req, { permission: "ENROLLMENT_MANAGE", fresh: true, reason: input.reason });
  const taxRateBasisPoints = parseTaxPercentageToBasisPoints(input.taxPercentage);
  const machine = await prisma.$transaction(async (tx) => {
    const created = await tx.vaultMachine.create({
      data: {
        slug: input.slug, serialNumber: input.serialNumber, displayName: input.displayName, locationLabel: input.locationLabel,
        timezone: input.timezone, city: input.city, state: input.state, taxRateBasisPoints,
        supportPageUrl: input.support.pageUrl, supportEmail: input.support.email, supportTextNumber: input.support.textNumber,
        supportPhoneNumber: input.support.phoneNumber, supportHours: input.support.hours,
      },
    });
    await tx.vaultDoor.createMany({ data: SIMULATOR_DOOR_MAPPING.map((door) => ({ machineId: created.id, doorId: door.doorId, controllerChannel: door.controllerChannel })) });
    await writeVaultAdminAudit({ req, authority, tx, machineId: created.id, action: "vault.machine.create", outcome: "SUCCESS", targetType: "VaultMachine", targetId: created.id });
    return created;
  });
  return res.status(201).json({ requestId, machine, doorCount: 150 });
}

async function handleMachineConfig(req: NextApiRequest, res: NextApiResponse, requestId: string, machineId: string, action: string) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"], requestId);
  requireVaultJson(req, 256 * 1024);
  const reason = String(req.body?.reason ?? "");
  if (action === "draft") {
    const input = configDraftSchema.parse(req.body);
    const authority = await requireVaultAdmin(req, { permission: "CONFIG_PUBLISH", machineId, fresh: true, reason: input.reason });
    const draft = await prisma.$transaction(async (tx) => {
      const created = await createVaultConfigDraft(machineId, authority.admin.user.id, {
        minimumAppVersion: input.minimumAppVersion,
        cloudFreshnessMs: input.cloudFreshnessMs,
        retrievalSeconds: input.retrievalSeconds,
        retryExtensionSeconds: input.retryExtensionSeconds,
        expiresAt: input.expiresAt,
        machineSettings: input.machineSettings ? {
          city: input.machineSettings.city,
          state: input.machineSettings.state,
          taxRateBasisPoints: input.machineSettings.taxPercentage === undefined
            ? undefined
            : parseTaxPercentageToBasisPoints(input.machineSettings.taxPercentage),
          support: input.machineSettings.support,
        } : undefined,
      }, tx);
      await writeVaultAdminAudit({ req, authority, tx, machineId, action: "vault.config.draft", outcome: "SUCCESS", targetType: "VaultConfigVersion", targetId: created.id, payloadDigest: created.digest });
      return created;
    });
    return res.status(201).json({ requestId, config: draft });
  }
  const configId = z.string().uuid().parse(req.body?.configId);
  const config = await prisma.vaultConfigVersion.findUnique({ where: { id: configId } });
  if (!config || config.machineId !== machineId) throw new VaultApiError(404, "CONFIG_NOT_FOUND", "Config version was not found for this machine");
  if (action === "validate") {
    const authority = await requireVaultAdmin(req, { permission: "CONFIG_PUBLISH", machineId });
    const validated = validateVaultConfigPayload(config.canonicalPayload);
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.vaultConfigVersion.update({ where: { id: config.id }, data: { status: "VALIDATED", digest: validated.digest, validationSummary: jsonValue(validated.summary), validatedByAdminId: authority.admin.user.id, validatedAt: new Date() } });
      await writeVaultAdminAudit({ req, authority, tx, machineId, action: "vault.config.validate", outcome: "SUCCESS", targetType: "VaultConfigVersion", targetId: config.id, payloadDigest: validated.digest });
      return value;
    });
    return res.status(200).json({ requestId, config: updated, validation: validated.summary });
  }
  if (action === "impact") {
    await requireVaultAdmin(req, { permission: "CONFIG_PUBLISH", machineId });
    const machine = await prisma.vaultMachine.findUnique({ where: { id: machineId }, include: { activeConfig: true } });
    const impact = vaultConfigImpact(machine?.activeConfig?.canonicalPayload ?? null, config.canonicalPayload);
    await prisma.vaultConfigVersion.update({ where: { id: config.id }, data: { impactSummary: jsonValue(impact) } });
    return res.status(200).json({ requestId, impact });
  }
  if (action === "publish") {
    const authority = await requireVaultAdmin(req, { permission: "CONFIG_PUBLISH", machineId, fresh: true, reason });
    const result = await prisma.$transaction(async (tx) => {
      const published = await publishVaultConfig(config.id, authority.admin.user.id, tx);
      await writeVaultAdminAudit({ req, authority, tx, machineId, action: "vault.config.publish", outcome: "SUCCESS", targetType: "VaultConfigVersion", targetId: config.id, payloadDigest: published.signed.digest });
      return published;
    });
    return res.status(200).json({ requestId, config: result.published, signed: result.signed });
  }
  throw new VaultApiError(404, "ADMIN_ROUTE_NOT_FOUND", "Unknown config action");
}

async function handleDoorPlan(req: NextApiRequest, res: NextApiResponse, requestId: string, machineId: string) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"], requestId);
  requireVaultJson(req, 128 * 1024);
  const input = doorPlanSchema.parse(req.body);
  let authority = await requireVaultAdmin(req, { permission: "DOOR_PLAN_MANAGE", machineId });
  const machine = await prisma.vaultMachine.findUnique({ where: { id: machineId }, select: { slug: true } });
  if (!machine) throw new VaultApiError(404, "MACHINE_NOT_FOUND", "Vault machine was not found");
  const duplicate = input.assignments.find((entry, index) => input.assignments.findIndex((candidate) => candidate.doorId === entry.doorId) !== index);
  if (duplicate) throw new VaultApiError(400, "DUPLICATE_DOOR", `Door ${duplicate.doorId} appears more than once`);
  const current = await prisma.vaultDoor.findMany({ where: { machineId, doorId: { in: input.assignments.map((entry) => entry.doorId) } }, select: { doorId: true, plannedProductId: true, state: true } });
  const impact = input.assignments.map((entry) => ({ ...entry, fromProductId: current.find((door) => door.doorId === entry.doorId)?.plannedProductId ?? null }));
  if (input.dryRun) return res.status(200).json({ requestId, dryRun: true, changed: impact.filter((row) => row.fromProductId !== row.productId) });
  authority = await requireVaultAdmin(req, { permission: "DOOR_PLAN_MANAGE", machineId, fresh: true, reason: input.reason });
  if (input.confirmPhrase !== `PLAN ${machine.slug}`) throw new VaultApiError(400, "CONFIRMATION_REQUIRED", `Type PLAN ${machine.slug} to apply this planned assignment`);
  await prisma.$transaction(async (tx) => {
    for (const entry of input.assignments) await tx.vaultDoor.update({ where: { machineId_doorId: { machineId, doorId: entry.doorId } }, data: { plannedProductId: entry.productId } });
    await writeVaultAdminAudit({ req, authority, tx, machineId, action: "vault.doors.plan", outcome: "SUCCESS", targetType: "VaultDoor", payloadDigest: vaultPayloadDigest(input.assignments), metadata: { changedDoorCount: impact.length } });
  });
  return res.status(200).json({ requestId, applied: true, changedDoorCount: impact.length });
}

async function handleStaffAccess(req: NextApiRequest, res: NextApiResponse, requestId: string, machineId: string) {
  if (req.method === "GET") {
    await requireVaultAdmin(req, { permission: "STAFF_MANAGE", machineId });
    const grants = await prisma.vaultStaffMachineAccess.findMany({ where: { machineId }, orderBy: { grantVersion: "desc" }, select: { id: true, grantId: true, userId: true, role: true, status: true, grantVersion: true, verifierVersion: true, validFrom: true, expiresAt: true, revokedAt: true, createdAt: true } });
    return res.status(200).json({ requestId, grants });
  }
  if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"], requestId);
  requireVaultJson(req, 32 * 1024);
  const input = staffAccessSchema.parse(req.body);
  const authority = await requireVaultAdmin(req, { permission: "STAFF_MANAGE", machineId, fresh: true, reason: input.reason });
  if (input.action === "revoke") {
    const grant = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${machineId} FOR UPDATE`;
      const current = await tx.vaultStaffMachineAccess.findFirst({ where: { machineId, grantId: input.grantId }, orderBy: { grantVersion: "desc" } });
      if (!current) throw new VaultApiError(404, "GRANT_NOT_FOUND", "Grant was not found for this machine");
      if (current.status === "REVOKED") throw new VaultApiError(409, "GRANT_ALREADY_REVOKED", "Grant is already revoked");
      const latest = await tx.vaultStaffMachineAccess.findFirst({ where: { machineId }, orderBy: { grantVersion: "desc" }, select: { grantVersion: true } });
      const revoked = await tx.vaultStaffMachineAccess.create({
        data: {
          grantId: current.grantId,
          machineId,
          userId: current.userId,
          role: current.role,
          status: "REVOKED",
          grantVersion: (latest?.grantVersion ?? 0) + 1,
          verifierVersion: current.verifierVersion,
          verifierHash: current.verifierHash,
          verifierAlgorithm: current.verifierAlgorithm,
          verifierParameters: current.verifierParameters as Prisma.InputJsonValue,
          validFrom: current.validFrom,
          expiresAt: current.expiresAt,
          revokedAt: new Date(),
          revokedByAdminId: authority.admin.user.id,
          createdByAdminId: authority.admin.user.id,
        },
      });
      await writeVaultAdminAudit({ req, authority, tx, machineId, action: "vault.staff.revoke", outcome: "SUCCESS", targetType: "VaultStaffMachineAccess", targetId: current.grantId, metadata: { grantVersion: revoked.grantVersion } });
      return revoked;
    });
    return res.status(200).json({ requestId, grant: { grantId: grant.grantId, status: grant.status, grantVersion: grant.grantVersion } });
  }
  const grant = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${machineId} FOR UPDATE`;
    const [latest, latestForUser] = await Promise.all([
      tx.vaultStaffMachineAccess.findFirst({ where: { machineId }, orderBy: { grantVersion: "desc" }, select: { grantVersion: true } }),
      tx.vaultStaffMachineAccess.findFirst({ where: { machineId, userId: input.userId }, orderBy: [{ verifierVersion: "desc" }, { grantVersion: "desc" }], select: { verifierVersion: true } }),
    ]);
    const verifier = createVaultScryptPinVerifier(input.pin);
    const created = await tx.vaultStaffMachineAccess.create({
      data: {
        grantId: randomUUID(),
        machineId, userId: input.userId, role: input.role, grantVersion: (latest?.grantVersion ?? 0) + 1,
        verifierVersion: (latestForUser?.verifierVersion ?? 0) + 1, verifierHash: verifier.verifier, verifierAlgorithm: "scrypt",
        verifierParameters: verifier.parameters as Prisma.InputJsonValue,
        validFrom: new Date(input.validFrom), expiresAt: new Date(input.expiresAt), createdByAdminId: authority.admin.user.id,
      },
    });
    await writeVaultAdminAudit({ req, authority, tx, machineId, action: "vault.staff.grant", outcome: "SUCCESS", targetType: "VaultStaffMachineAccess", targetId: created.grantId, metadata: { userId: input.userId, role: input.role, grantVersion: created.grantVersion, verifierVersion: created.verifierVersion } });
    return created;
  });
  return res.status(201).json({ requestId, grant: { grantId: grant.grantId, userId: grant.userId, role: grant.role, status: grant.status, grantVersion: grant.grantVersion, verifierVersion: grant.verifierVersion } });
}

async function handleEnrollment(req: NextApiRequest, res: NextApiResponse, requestId: string, machineId: string) {
  if (req.method === "GET") {
    await requireVaultAdmin(req, { permission: "ENROLLMENT_MANAGE", machineId });
    const [tokens, credentials] = await Promise.all([
      prisma.vaultEnrollmentToken.findMany({ where: { machineId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, expiresAt: true, approvedAt: true, consumedAt: true, revokedAt: true, createdAt: true } }),
      prisma.vaultMachineCredential.findMany({ where: { machineId }, orderBy: { version: "desc" }, select: { id: true, version: true, status: true, activatedAt: true, lastUsedAt: true, rotatedAt: true, revokedAt: true, createdAt: true } }),
    ]);
    return res.status(200).json({ requestId, tokens, credentials });
  }
  if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"], requestId);
  requireVaultJson(req, 32 * 1024);
  const input = enrollmentSchema.parse(req.body);
  const authority = await requireVaultAdmin(req, { permission: "ENROLLMENT_MANAGE", machineId, fresh: true, reason: input.reason });
  if (input.action === "create") {
    const rawToken = `vault_enroll_${randomBytes(32).toString("base64url")}`;
    const token = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${machineId} FOR UPDATE`;
      const machine = await tx.vaultMachine.findUnique({ where: { id: machineId }, select: { status: true } });
      if (!machine) throw new VaultApiError(404, "MACHINE_NOT_FOUND", "Vault machine was not found");
      if (machine.status === "DISABLED" || machine.status === "DECOMMISSIONED") throw new VaultApiError(409, "MACHINE_ENROLLMENT_DISABLED", "Disabled or decommissioned machines cannot receive enrollment tokens");
      const created = await tx.vaultEnrollmentToken.create({
        data: { machineId, tokenHash: createHash("sha256").update(rawToken).digest("hex"), status: "APPROVED", createdByAdminId: authority.admin.user.id, approvedByAdminId: authority.admin.user.id, approvedAt: new Date(), expiresAt: new Date(Date.now() + input.expiresInMinutes * 60_000) },
      });
      await writeVaultAdminAudit({ req, authority, tx, machineId, action: "vault.enrollment.token.create", outcome: "SUCCESS", targetType: "VaultEnrollmentToken", targetId: created.id });
      return created;
    });
    return res.status(201).json({ requestId, enrollmentToken: rawToken, tokenReturnedOnce: true, expiresAt: token.expiresAt });
  }
  if (input.action === "revoke-credential") {
    const credential = await prisma.$transaction(async (tx) => {
      const current = await tx.vaultMachineCredential.findUnique({ where: { id: input.credentialId } });
      if (!current || current.machineId !== machineId) throw new VaultApiError(404, "CREDENTIAL_NOT_FOUND", "Credential was not found for this machine");
      const updated = await tx.vaultMachineCredential.update({ where: { id: input.credentialId }, data: { status: "REVOKED", revokedAt: new Date(), revokedByAdminId: authority.admin.user.id, revocationReason: input.reason } });
      await writeVaultAdminAudit({ req, authority, tx, machineId, action: "vault.credential.revoke", outcome: "SUCCESS", targetType: "VaultMachineCredential", targetId: updated.id });
      return updated;
    });
    return res.status(200).json({ requestId, credential: { id: credential.id, status: credential.status } });
  }
  const endedAt = new Date();
  const machine = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${machineId} FOR UPDATE`;
    const current = await tx.vaultMachine.findUnique({ where: { id: machineId }, select: { status: true, slug: true } });
    if (!current) throw new VaultApiError(404, "MACHINE_NOT_FOUND", "Vault machine was not found");
    if (current.status === "DECOMMISSIONED") throw new VaultApiError(409, "MACHINE_ALREADY_DECOMMISSIONED", "Machine is already decommissioned");
    if (input.confirmPhrase !== `DECOMMISSION ${current.slug}`) throw new VaultApiError(400, "CONFIRMATION_REQUIRED", `Type DECOMMISSION ${current.slug} to decommission this machine`);
    await tx.vaultMachineCredential.updateMany({ where: { machineId, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: endedAt, revokedByAdminId: authority.admin.user.id, revocationReason: input.reason } });
    await tx.vaultEnrollmentToken.updateMany({ where: { machineId, status: { in: ["PENDING_APPROVAL", "APPROVED"] } }, data: { status: "REVOKED", revokedAt: endedAt } });
    const retainUntil = new Date(Date.UTC(endedAt.getUTCFullYear() + 3, endedAt.getUTCMonth(), endedAt.getUTCDate(), endedAt.getUTCHours(), endedAt.getUTCMinutes(), endedAt.getUTCSeconds(), endedAt.getUTCMilliseconds()));
    await tx.vaultCertificationSession.updateMany({ where: { machineId, retainUntil: null }, data: { retainUntil } });
    await tx.vaultCertificationEvidence.updateMany({ where: { certification: { machineId }, retainUntil: null }, data: { retainUntil } });
    await tx.vaultCertificate.updateMany({ where: { certification: { machineId }, retainUntil: null }, data: { retainUntil } });
    const updated = await tx.vaultMachine.update({ where: { id: machineId }, data: { status: "DECOMMISSIONED", serviceEndedAt: endedAt } });
    await writeVaultAdminAudit({ req, authority, tx, machineId, action: "vault.machine.decommission", outcome: "SUCCESS", targetType: "VaultMachine", targetId: updated.id });
    return updated;
  });
  return res.status(200).json({ requestId, machine });
}

async function handleFleet(req: NextApiRequest, res: NextApiResponse, requestId: string) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"], requestId);
  await requireVaultAdmin(req, { permission: "DIAGNOSTICS_VIEW" });
  const machines = await listMachines();
  return res.status(200).json({ requestId, machines, summary: { total: machines.length, online: machines.filter((machine) => machine.lastHeartbeatAt && Date.now() - machine.lastHeartbeatAt.getTime() <= 120_000).length, salesReady: machines.filter((machine) => machine.health === "READY").length, serviceLocked: machines.filter((machine) => machine.serviceLocked).length } });
}

async function handleSales(req: NextApiRequest, res: NextApiResponse, requestId: string) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"], requestId);
  const includeCertification = queryBoolean(req.query.includeCertification);
  const machineId = typeof req.query.machineId === "string" ? req.query.machineId : undefined;
  await requireVaultAdmin(req, { permission: "FINANCIAL_RESOLVE", machineId });
  const sales = await prisma.vaultSale.findMany({ where: { ...(includeCertification ? {} : { mode: "PRODUCTION" }), ...(machineId ? { machineId } : {}) }, orderBy: { createdAt: "desc" }, take: 250, include: { items: true, machine: { select: { displayName: true, slug: true } } } });
  const totals = sales.reduce((result, sale) => ({ authorizedCents: result.authorizedCents + (sale.paymentState === "AUTHORIZED" || sale.paymentState === "SETTLED" ? sale.totalCents : 0), settledCents: result.settledCents + (sale.settlementState === "SETTLED" ? sale.totalCents : 0), taxCents: result.taxCents + (sale.settlementState === "SETTLED" ? sale.taxCents : 0) }), { authorizedCents: 0, settledCents: 0, taxCents: 0 });
  return res.status(200).json({ requestId, includeCertification, sales: sales.map((sale) => vaultSaleAdminDto(sale as unknown as Record<string, unknown> & { items: Array<Record<string, unknown>> })), totals });
}

async function handleRestocks(req: NextApiRequest, res: NextApiResponse, requestId: string) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"], requestId);
  const machineId = typeof req.query.machineId === "string" ? req.query.machineId : undefined;
  await requireVaultAdmin(req, { permission: "RESTOCK_RUN", machineId });
  const restocks = await prisma.vaultRestockSession.findMany({ where: machineId ? { machineId } : {}, orderBy: { startedAt: "desc" }, take: 250, include: { items: true, machine: { select: { displayName: true, slug: true } } } });
  return res.status(200).json({ requestId, restocks });
}

async function handleCertification(req: NextApiRequest, res: NextApiResponse, requestId: string) {
  if (req.method === "GET") {
    const machineId = typeof req.query.machineId === "string" ? req.query.machineId : undefined;
    await requireVaultAdmin(req, { permission: "CERTIFICATION_COLLECT", machineId });
    const sessions = await prisma.vaultCertificationSession.findMany({ where: machineId ? { machineId } : {}, orderBy: { createdAt: "desc" }, take: 200, include: { evidence: true, certificate: true, machine: { select: { displayName: true, serviceEndedAt: true } } } });
    return res.status(200).json({ requestId, sessions });
  }
  if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"], requestId);
  requireVaultJson(req, 2 * 1024 * 1024);
  const input = certificationMutationSchema.parse(req.body);
  const identity = await prisma.vaultCertificationSession.findUnique({ where: { id: input.certificationId }, select: { machineId: true } });
  if (!identity) throw new VaultApiError(404, "CERTIFICATION_NOT_FOUND", "Certification session was not found");
  const authority = await requireVaultAdmin(req, { permission: "CERTIFICATION_APPROVE", machineId: identity.machineId, fresh: true, reason: input.reason });
  if (input.action === "attach-manifest") {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VaultCertificationSession" WHERE "id" = ${input.certificationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "VaultCertificationEvidence" WHERE "certificationId" = ${input.certificationId} FOR UPDATE`;
      const session = await tx.vaultCertificationSession.findUnique({
        where: { id: input.certificationId },
        include: { evidence: { orderBy: [{ observedAt: "asc" }, { evidenceId: "asc" }] }, configVersion: true, certificate: true },
      });
      if (!session) throw new VaultApiError(404, "CERTIFICATION_NOT_FOUND", "Certification session was not found");
      if (session.machineId !== identity.machineId) throw new VaultApiError(409, "CERTIFICATION_SCOPE_CHANGED", "Certification machine scope changed during manifest attachment");
      if (session.status !== "REVIEW_REQUIRED" || session.approvedAt || session.invalidatedAt || session.certificate) {
        throw new VaultApiError(409, "CERTIFICATION_NOT_REVIEWABLE", "Evidence manifests can only be attached to an unapproved REVIEW_REQUIRED certification");
      }
      const bindings = new Map(input.evidenceBindings.map((binding) => [binding.evidenceId, binding]));
      const expectedIds = new Set(session.evidence.map((evidence) => evidence.evidenceId));
      const unknownIds = input.evidenceBindings.filter((binding) => !expectedIds.has(binding.evidenceId)).map((binding) => binding.evidenceId);
      const missingIds = session.evidence.filter((evidence) => !bindings.has(evidence.evidenceId)).map((evidence) => evidence.evidenceId);
      if (unknownIds.length || missingIds.length) {
        throw new VaultApiError(400, "CERTIFICATION_MANIFEST_EVIDENCE_MISMATCH", "Manifest bindings must exactly match the immutable machine evidence set", {
          unknownEvidenceIds: unknownIds.slice(0, 25),
          missingEvidenceIds: missingIds.slice(0, 25),
          unknownCount: unknownIds.length,
          missingCount: missingIds.length,
        });
      }
      const storagePrefix = `vault-certification/${session.id}/`;
      const wrongStorageKeys = input.evidenceBindings.filter((binding) => !binding.artifactStorageKey.startsWith(storagePrefix));
      if (wrongStorageKeys.length) throw new VaultApiError(400, "CERTIFICATION_ARTIFACT_SCOPE_INVALID", `Artifact storage keys must begin with ${storagePrefix}`);
      const attachedAt = new Date();
      for (const evidence of session.evidence) {
        const binding = bindings.get(evidence.evidenceId)!;
        await tx.vaultCertificationEvidence.update({
          where: { id: evidence.id },
          data: {
            artifactStorageKey: binding.artifactStorageKey,
            metadata: jsonValue({
              ...jsonRecord(evidence.metadata),
              cycleType: binding.cycleType,
              manifestVersion: 1,
              manifestAttachedAt: attachedAt.toISOString(),
              manifestAttachedBy: authority.admin.user.id,
            }),
          },
        });
      }
      await tx.vaultCertificationSession.update({
        where: { id: session.id },
        data: {
          evidenceSummary: jsonValue({ automatedTransactions: input.automatedTransactions, observedSessions: input.observedSessions, manifestVersion: 1 }),
          hardwareIdentity: jsonValue(input.hardwareIdentity),
          unresolvedDeviations: jsonValue(input.unresolvedDeviations),
        },
      });
      const updated = await tx.vaultCertificationSession.findUnique({
        where: { id: session.id },
        include: { evidence: { orderBy: [{ observedAt: "asc" }, { evidenceId: "asc" }] }, configVersion: true },
      });
      if (!updated) throw new VaultApiError(409, "CERTIFICATION_STATE_CHANGED", "Certification disappeared while attaching evidence manifest");
      const approval = evaluateVaultCertificationApproval(updated);
      await writeVaultAdminAudit({
        req,
        authority,
        tx,
        machineId: session.machineId,
        action: "vault.certification.manifest.attach",
        outcome: "SUCCESS",
        targetType: "VaultCertificationSession",
        targetId: session.id,
        payloadDigest: vaultPayloadDigest({
          automatedTransactions: input.automatedTransactions,
          observedSessions: input.observedSessions,
          hardwareIdentity: input.hardwareIdentity,
          unresolvedDeviations: input.unresolvedDeviations,
          evidenceBindings: input.evidenceBindings,
        }),
        metadata: { evidenceCount: session.evidence.length, eligible: approval.eligible, reasons: approval.reasons, counts: approval.counts },
      });
      return { certification: updated, approval };
    });
    return res.status(200).json({ requestId, ...result });
  }
  if (input.action === "invalidate") {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VaultCertificationSession" WHERE "id" = ${input.certificationId} FOR UPDATE`;
      const now = new Date();
      const value = await tx.vaultCertificationSession.update({ where: { id: input.certificationId }, data: { status: "INVALIDATED", invalidatedAt: now, invalidationReason: input.reason } });
      await tx.vaultCertificate.updateMany({ where: { certificationId: input.certificationId }, data: { invalidatedAt: now, invalidationReason: input.reason } });
      await writeVaultAdminAudit({ req, authority, tx, machineId: identity.machineId, action: "vault.certification.invalidate", outcome: "SUCCESS", targetType: "VaultCertificationSession", targetId: input.certificationId });
      return value;
    });
    return res.status(200).json({ requestId, certification: updated });
  }
  const key = signingKey();
  const certificate = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "VaultCertificationSession" WHERE "id" = ${input.certificationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "VaultCertificationEvidence" WHERE "certificationId" = ${input.certificationId} FOR UPDATE`;
    const session = await tx.vaultCertificationSession.findUnique({ where: { id: input.certificationId }, include: { evidence: { orderBy: [{ observedAt: "asc" }, { evidenceId: "asc" }] }, configVersion: true, certificate: true } });
    if (!session) throw new VaultApiError(404, "CERTIFICATION_NOT_FOUND", "Certification session was not found");
    if (session.certificate) throw new VaultApiError(409, "CERTIFICATION_ALREADY_APPROVED", "Certification already has a certificate");
    const approval = evaluateVaultCertificationApproval(session);
    if (!approval.eligible) throw new VaultApiError(409, "CERTIFICATION_INCOMPLETE", "Certification does not satisfy the complete approval predicate", { reasons: approval.reasons, counts: approval.counts });
    const issuedAt = new Date();
    const payload = {
      schemaVersion: 1,
      certificationId: session.id,
      machineId: session.machineId,
      sourceBuildConfig: {
        sourceCommit: session.sourceCommit,
        appBuild: session.appBuild,
        localSchemaVersion: session.localSchemaVersion,
        contractVersion: session.contractVersion,
        configVersion: session.configVersion.version,
        configDigest: session.configVersion.digest,
      },
      qualifiedIdentity: {
        nayaxAdapterVersion: session.nayaxAdapterVersion,
        nayaxSdkVersion: session.nayaxSdkVersion,
        nayaxFlowConfig: session.nayaxFlowConfig,
        controllerIdentity: session.controllerIdentity,
        hardwareIdentity: session.hardwareIdentity,
      },
      evidenceSummary: session.evidenceSummary,
      unresolvedDeviations: session.unresolvedDeviations,
      evidence: session.evidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        doorId: evidence.doorId,
        evidenceClass: evidence.evidenceClass,
        outcome: evidence.outcome,
        expectedDoorIds: evidence.expectedDoorIds,
        observedDoorIds: evidence.observedDoorIds,
        artifactDigest: evidence.artifactDigest,
        artifactStorageKey: evidence.artifactStorageKey,
        cycleType: jsonRecord(evidence.metadata).cycleType,
      })),
      approvalCounts: approval.counts,
      approvedBy: authority.admin.user.id,
      approvedByRole: authority.role,
      issuedAt: issuedAt.toISOString(),
    };
    const digest = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    const signature = sign(null, Buffer.from(canonicalJson(payload)), key.key).toString("base64");
    const transitioned = await tx.vaultCertificationSession.updateMany({ where: { id: session.id, status: "REVIEW_REQUIRED", approvedAt: null, invalidatedAt: null }, data: { status: "PASSED", approvedByUserId: authority.admin.user.id, approvedByRole: authority.role, approvedAt: issuedAt, completedAt: issuedAt } });
    if (transitioned.count !== 1) throw new VaultApiError(409, "CERTIFICATION_STATE_CHANGED", "Certification changed while approval was being evaluated");
    const cert = await tx.vaultCertificate.create({ data: { certificationId: session.id, schemaVersion: 1, certificatePayload: jsonValue(payload), digest, signingKeyId: key.keyId, signingAlgorithm: "Ed25519", detachedSignature: signature, approvedByUserId: authority.admin.user.id, approvedByRole: authority.role, issuedAt, retainUntil: session.retainUntil } });
    await writeVaultAdminAudit({ req, authority, tx, machineId: session.machineId, action: "vault.certification.approve", outcome: "SUCCESS", targetType: "VaultCertificate", targetId: cert.id, payloadDigest: digest, metadata: approval.counts });
    return cert;
  });
  return res.status(201).json({ requestId, certificate });
}

async function handleSupportCases(req: NextApiRequest, res: NextApiResponse, requestId: string) {
  if (req.method === "GET") {
    const machineId = typeof req.query.machineId === "string" ? req.query.machineId : undefined;
    await requireVaultAdmin(req, { permission: "FINANCIAL_RESOLVE", machineId });
    const status = typeof req.query.status === "string" ? z.enum(["OPEN", "INVESTIGATING", "RESOLVED", "CLOSED"]).parse(req.query.status) : undefined;
    const cases = await prisma.vaultSupportCase.findMany({ where: { ...(machineId ? { machineId } : {}), ...(status ? { status } : {}) }, orderBy: { openedAt: "desc" }, take: 250, include: { sale: { include: { items: true } }, machine: { select: { displayName: true, slug: true } } } });
    return res.status(200).json({ requestId, cases: cases.map((supportCase) => vaultSupportCaseAdminDto(supportCase as unknown as Record<string, unknown>)) });
  }
  if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"], requestId);
  requireVaultJson(req, 64 * 1024);
  const input = supportMutationSchema.parse(req.body);
  const supportCase = await prisma.vaultSupportCase.findUnique({ where: { id: input.caseId } });
  if (!supportCase) throw new VaultApiError(404, "SUPPORT_CASE_NOT_FOUND", "Support case was not found");
  const authority = await requireVaultAdmin(req, { permission: "FINANCIAL_RESOLVE", machineId: supportCase.machineId, fresh: true, reason: input.resolutionReason });
  const updated = await prisma.$transaction(async (tx) => {
    const value = await tx.vaultSupportCase.update({ where: { id: supportCase.id }, data: { status: input.status, financialResolution: input.financialResolution ? jsonValue(input.financialResolution) : undefined, resolutionReason: input.resolutionReason, assignedAdminId: authority.admin.user.id, resolvedByAdminId: input.status === "RESOLVED" || input.status === "CLOSED" ? authority.admin.user.id : null, resolvedAt: input.status === "RESOLVED" || input.status === "CLOSED" ? new Date() : null, closedAt: input.status === "CLOSED" ? new Date() : null } });
    await writeVaultAdminAudit({ req, authority, tx, machineId: supportCase.machineId, action: "vault.support.resolve", outcome: "SUCCESS", targetType: "VaultSupportCase", targetId: supportCase.id, metadata: { status: input.status, recordsFinancialResolutionOnly: true } });
    return value;
  });
  return res.status(200).json({ requestId, supportCase: vaultSupportCaseAdminDto(updated as unknown as Record<string, unknown>), externalPaymentActionExecuted: false });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = vaultRequestId(req);
  const parts = pathParts(req);
  let authority: VaultAdminAuthority | null = null;
  try {
    requireVaultContract(req);
    if (parts[0] === "products" && parts.length === 1) return await handleProducts(req, res, requestId);
    if (parts[0] === "machines" && parts.length === 1) return await handleMachines(req, res, requestId);
    if (parts[0] === "machines" && parts[2] === "config" && parts.length === 4) return await handleMachineConfig(req, res, requestId, parts[1], parts[3]);
    if (parts[0] === "machines" && parts[2] === "doors" && parts[3] === "plan") return await handleDoorPlan(req, res, requestId, parts[1]);
    if (parts[0] === "machines" && parts[2] === "staff-access") return await handleStaffAccess(req, res, requestId, parts[1]);
    if (parts[0] === "machines" && parts[2] === "enrollment") return await handleEnrollment(req, res, requestId, parts[1]);
    if (parts[0] === "fleet" && parts.length === 1) return await handleFleet(req, res, requestId);
    if (parts[0] === "sales" && parts.length === 1) return await handleSales(req, res, requestId);
    if (parts[0] === "restocks" && parts.length === 1) return await handleRestocks(req, res, requestId);
    if (parts[0] === "certification" && parts.length === 1) return await handleCertification(req, res, requestId);
    if (parts[0] === "support-cases" && parts.length === 1) return await handleSupportCases(req, res, requestId);
    throw new VaultApiError(404, "ADMIN_ROUTE_NOT_FOUND", "Vault admin route was not found");
  } catch (error) {
    if (req.method && req.method !== "GET") {
      try {
        await writeVaultAdminAudit({ req, authority, machineId: parts[0] === "machines" ? parts[1] : null, action: `vault.admin.${parts.join(".") || "unknown"}`, outcome: error instanceof VaultApiError && error.statusCode < 500 ? "DENIED" : "FAILURE", reason: error instanceof Error ? error.message : "Unknown failure" });
      } catch {
        // The original error remains authoritative; audit persistence failure is logged by sendVaultError.
      }
    }
    sendVaultError(res, requestId, error);
  }
}

export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

export { calculateTaxCents, parseTaxPercentageToBasisPoints, VAULT_ALLOWED_PRICE_CENTS };
