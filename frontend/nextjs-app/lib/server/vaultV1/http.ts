import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeVaultEventPayload, prisma, type Prisma, VaultAuditOutcome } from "@tenkings/database";
import {
  roleMay,
  type VaultPermission,
  type VaultRole,
} from "@tenkings/vault-contracts";
import {
  hashVaultSecret,
  VAULT_CONTRACT_VERSION,
} from "@tenkings/database";
import {
  requireAdminSession,
  requireFreshHumanAdminSession,
  type AdminSession,
} from "../admin";

const VAULT_REQUEST_ID = Symbol.for("tenkings.vault.request-id");
type RequestWithVaultId = NextApiRequest & { [VAULT_REQUEST_ID]?: string };

export type VaultErrorBody = {
  requestId: string;
  error: { code: string; message: string; details?: unknown };
};

export class VaultApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "VaultApiError";
  }
}

export function vaultRequestId(req: NextApiRequest): string {
  const cached = (req as RequestWithVaultId)[VAULT_REQUEST_ID];
  if (cached) return cached;
  const supplied = req.headers["x-request-id"];
  const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
  const requestId = candidate && /^[A-Za-z0-9_.:-]{8,128}$/.test(candidate) ? candidate : randomUUID();
  (req as RequestWithVaultId)[VAULT_REQUEST_ID] = requestId;
  return requestId;
}

export function requireVaultContract(req: NextApiRequest): void {
  const raw = req.headers["x-vault-contract-version"];
  const version = Array.isArray(raw) ? raw[0] : raw;
  if (version !== String(VAULT_CONTRACT_VERSION)) {
    throw new VaultApiError(426, "UNSUPPORTED_CONTRACT_VERSION", `X-Vault-Contract-Version must be ${VAULT_CONTRACT_VERSION}`);
  }
}

export function requireVaultJson(req: NextApiRequest, maximumBytes: number): void {
  requireVaultContract(req);
  const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new VaultApiError(415, "UNSUPPORTED_CONTENT_TYPE", "Content-Type must be application/json");
  }
  const length = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(length) && length > maximumBytes) {
    throw new VaultApiError(413, "BODY_TOO_LARGE", `Request body exceeds ${maximumBytes} bytes`);
  }
}

export function requireVaultGet(req: NextApiRequest): void {
  requireVaultContract(req);
}

export function sendVaultError(res: NextApiResponse, requestId: string, error: unknown): void {
  if (error instanceof VaultApiError) {
    res.status(error.statusCode).json({ requestId, error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error && typeof error === "object" && "issues" in error) {
    res.status(400).json({ requestId, error: { code: "INVALID_REQUEST", message: "Request validation failed", details: (error as { issues: unknown }).issues } });
    return;
  }
  console.error("[vault-v1] request failed", {
    requestId,
    name: error instanceof Error ? error.name : "UnknownError",
  });
  res.status(500).json({ requestId, error: { code: "INTERNAL_ERROR", message: "Vault request failed" } });
}

function authorizationValue(req: NextApiRequest): string {
  const header = String(req.headers.authorization ?? "").trim();
  const [scheme, secret, ...rest] = header.split(/\s+/);
  if (scheme !== "VaultMachine" || !secret || rest.length) {
    throw new VaultApiError(401, "MACHINE_AUTH_REQUIRED", "A VaultMachine credential is required");
  }
  return secret;
}

export type VaultMachineAuthority = {
  machine: { id: string; status: string; currentCredentialVersion: number };
  credentialId: string;
  credentialVersion: number;
};

export async function requireVaultMachine(req: NextApiRequest, pathMachineId: string): Promise<VaultMachineAuthority> {
  requireVaultContract(req);
  const secret = authorizationValue(req);
  let credentialHash: string;
  try {
    credentialHash = hashVaultSecret(secret);
  } catch {
    throw new VaultApiError(401, "INVALID_MACHINE_CREDENTIAL", "Machine credential is invalid");
  }
  const credential = await prisma.vaultMachineCredential.findUnique({
    where: { credentialHash },
    include: { machine: { select: { id: true, status: true, currentCredentialVersion: true } } },
  });
  if (!credential || credential.status !== "ACTIVE" || credential.machineId !== pathMachineId) {
    throw new VaultApiError(403, "MACHINE_PATH_BINDING_FAILED", "Machine credential is inactive or does not match this path");
  }
  if (credential.version !== credential.machine.currentCredentialVersion) {
    throw new VaultApiError(403, "MACHINE_CREDENTIAL_VERSION_STALE", "Machine credential has been rotated");
  }
  if (credential.machine.status === "DISABLED" || credential.machine.status === "DECOMMISSIONED") {
    throw new VaultApiError(403, "MACHINE_DISABLED", "Machine is not permitted to synchronize");
  }
  await prisma.vaultMachineCredential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } });
  return {
    machine: credential.machine,
    credentialId: credential.id,
    credentialVersion: credential.version,
  };
}

function envAdminIds(): Set<string> {
  return new Set(String(process.env.VAULT_OWNER_ADMIN_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

const VAULT_ROLE_RANK: Readonly<Record<VaultRole, number>> = { RESTOCKER: 1, TECHNICIAN: 2, ADMIN: 3 };

async function resolveVaultRole(admin: AdminSession, machineId?: string): Promise<{ role: VaultRole; owner: boolean } | null> {
  if (envAdminIds().has(admin.user.id)) return { role: "ADMIN", owner: true };
  if (!machineId) return null;
  const stream = await prisma.vaultStaffMachineAccess.findMany({
    where: {
      userId: admin.user.id,
      machineId,
    },
    orderBy: { grantVersion: "desc" },
    select: { grantId: true, role: true, status: true, validFrom: true, expiresAt: true },
  });
  const now = new Date();
  const latestByGrant = new Map<string, (typeof stream)[number]>();
  for (const record of stream) if (!latestByGrant.has(record.grantId)) latestByGrant.set(record.grantId, record);
  const roles = [...latestByGrant.values()]
    .filter((record) => record.status === "ACTIVE" && record.validFrom <= now && record.expiresAt > now)
    .map((record) => record.role as VaultRole)
    .sort((left, right) => VAULT_ROLE_RANK[right] - VAULT_ROLE_RANK[left]);
  return roles[0] ? { role: roles[0], owner: false } : null;
}

export type VaultAdminAuthority = { admin: AdminSession; role: VaultRole; reason: string | null; owner: boolean };

export async function requireVaultAdmin(
  req: NextApiRequest,
  options: { permission: VaultPermission; machineId?: string; fresh?: boolean; reason?: string | null },
): Promise<VaultAdminAuthority> {
  requireVaultContract(req);
  const admin = options.fresh ? await requireFreshHumanAdminSession(req) : await requireAdminSession(req);
  const resolved = await resolveVaultRole(admin, options.machineId);
  if (!resolved) {
    throw new VaultApiError(403, options.machineId ? "VAULT_PERMISSION_REQUIRED" : "VAULT_OWNER_REQUIRED", options.machineId ? `${options.permission} permission is required` : "A Vault owner session is required for global access");
  }
  if (!roleMay(resolved.role, options.permission)) {
    throw new VaultApiError(403, "VAULT_PERMISSION_REQUIRED", `${options.permission} permission is required`);
  }
  const reason = (options.reason ?? String(req.headers["x-vault-action-reason"] ?? "")).trim() || null;
  if (options.fresh && (!reason || reason.length < 8 || reason.length > 500)) {
    throw new VaultApiError(400, "ACTION_REASON_REQUIRED", "Sensitive Vault actions require an 8-500 character reason");
  }
  return { admin, role: resolved.role, reason, owner: resolved.owner };
}

function firstHeader(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function writeVaultAdminAudit(input: {
  req: NextApiRequest;
  authority?: VaultAdminAuthority | null;
  machineId?: string | null;
  action: string;
  outcome: "SUCCESS" | "DENIED" | "FAILURE";
  targetType?: string | null;
  targetId?: string | null;
  payloadDigest?: string | null;
  metadata?: Record<string, unknown> | null;
  reason?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const forwarded = firstHeader(input.req.headers["x-forwarded-for"]);
  const ipAddress = forwarded?.split(",")[0]?.trim() || input.req.socket.remoteAddress || null;
  const metadata = input.metadata ? normalizeVaultEventPayload(input.metadata) : undefined;
  await (input.tx ?? prisma).vaultAdminAuditEvent.create({
    data: {
      machineId: input.machineId ?? null,
      actorAdminId: input.authority?.admin.user.id ?? null,
      actorRole: input.authority?.role ?? null,
      action: input.action,
      outcome: VaultAuditOutcome[input.outcome],
      reason: input.reason ?? input.authority?.reason ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      requestId: vaultRequestId(input.req),
      ipAddress,
      userAgent: firstHeader(input.req.headers["user-agent"]),
      payloadDigest: input.payloadDigest ?? null,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

export function methodNotAllowed(res: NextApiResponse, methods: readonly string[], requestId: string): void {
  res.setHeader("Allow", methods.join(", "));
  res.status(405).json({ requestId, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}
