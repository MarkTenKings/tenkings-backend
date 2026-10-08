import { createHash, randomUUID } from "node:crypto";
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
import { lookupViaAuthService, FRESH_HUMAN_ADMIN_SESSION_MAX_AGE_MS, type AdminSession } from "../admin";
import { HttpError, validateFreshAdminSession } from "../adminSessionAuthority";

const VAULT_REQUEST_ID = Symbol.for("tenkings.vault.request-id");
const VAULT_BODY_BYTES = Symbol.for("tenkings.vault.body-bytes");
type RequestWithVaultId = NextApiRequest & { [VAULT_REQUEST_ID]?: string; [VAULT_BODY_BYTES]?: number };

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
  // A chunked request has no Content-Length. The shared catch-all parser has a
  // larger ceiling, so enforce the specific action's limit after parsing too.
  if (((req as RequestWithVaultId)[VAULT_BODY_BYTES] ?? 0) > maximumBytes || req.body !== undefined && Buffer.byteLength(JSON.stringify(req.body), "utf8") > maximumBytes) {
    throw new VaultApiError(413, "BODY_TOO_LARGE", `Request body exceeds ${maximumBytes} bytes`);
  }
}

/** Next's default parser responds before the route can produce its contract
 * envelope. Read once with a byte bound, including chunked and whitespace-heavy
 * bodies; each action still applies its smaller route-specific byte ceiling. */
export function withVaultJsonBody(handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>, maximumBytes: number) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (!["POST", "PUT", "PATCH"].includes(req.method ?? "") || req.body !== undefined) return handler(req, res);
    const requestId = vaultRequestId(req);
    try {
      requireVaultJson(req, maximumBytes);
      const bytes = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let ended = false;
        const fail = (error: Error) => { if (!ended) { ended = true; chunks.length = 0; reject(error); } };
        req.on("data", (chunk: Buffer | string) => {
          if (ended) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > maximumBytes) return fail(new VaultApiError(413, "BODY_TOO_LARGE", `Request body exceeds ${maximumBytes} bytes`));
          chunks.push(bytes);
        });
        req.once("aborted", () => fail(new VaultApiError(400, "INVALID_JSON", "Request body was interrupted")));
        req.once("error", () => fail(new VaultApiError(400, "INVALID_JSON", "Request body could not be read")));
        req.once("end", () => { if (!ended) { ended = true; (req as RequestWithVaultId)[VAULT_BODY_BYTES] = size; resolve(Buffer.concat(chunks)); } });
      });
      try { req.body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw new VaultApiError(400, "INVALID_JSON", "Request body must be valid UTF-8 JSON"); }
      return handler(req, res);
    } catch (error) { sendVaultError(res, requestId, error); }
  };
}

export function requireVaultGet(req: NextApiRequest): void {
  requireVaultContract(req);
}

export function sendVaultError(res: NextApiResponse, requestId: string, error: unknown): void {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ requestId, error: { code: "HUMAN_AUTH_REQUIRED", message: error.message } });
    return;
  }
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

export async function assertVaultMachineAuthorityCurrent(tx: Prisma.TransactionClient, authority: VaultMachineAuthority, machineId: string): Promise<void> {
  const credential = await tx.vaultMachineCredential.findUnique({ where: { id: authority.credentialId }, include: { machine: { select: { status: true, currentCredentialVersion: true } } } });
  if (!credential || credential.machineId !== machineId || credential.status !== "ACTIVE" || credential.version !== authority.credentialVersion || credential.version !== credential.machine.currentCredentialVersion || ["DISABLED", "DECOMMISSIONED"].includes(credential.machine.status)) throw new VaultApiError(403, "MACHINE_AUTHORITY_CHANGED", "Machine credential changed before synchronization could commit");
}

function envAdminIds(): Set<string> {
  return new Set(String(process.env.VAULT_OWNER_ADMIN_USER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

/** Reuse verified human identity, without conferring unrelated platform-admin authority. */
export async function requireVaultHumanSession(req: NextApiRequest, fresh = false): Promise<AdminSession> {
  const match = /^Bearer ([^\s]+)$/i.exec(String(req.headers.authorization ?? ""));
  if (!match) throw new VaultApiError(401, "HUMAN_AUTH_REQUIRED", "A human sign-in session is required");
  const token = match[1]!;
  let session = await lookupViaAuthService(token);
  if (!session) {
    const local = await prisma.session.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") }, include: { user: true } });
    if (!local?.user || local.expiresAt.getTime() <= Date.now() || local.createdAt.getTime() > Date.now()) throw new VaultApiError(401, "HUMAN_AUTH_REQUIRED", "Human session is missing or expired");
    session = { sessionId: local.id, tokenHash: local.tokenHash, authority: "local-database", createdAt: local.createdAt, expiresAt: local.expiresAt, user: local.user };
  }
  if (fresh) await validateFreshAdminSession(session, { maximumAgeMs: FRESH_HUMAN_ADMIN_SESSION_MAX_AGE_MS, findLocalSession: (id) => prisma.session.findUnique({ where: { id }, include: { user: true } }) });
  return session;
}

export async function vaultHumanAccess(req: NextApiRequest) {
  requireVaultContract(req);
  const admin = await requireVaultHumanSession(req);
  const owner = envAdminIds().has(admin.user.id);
  const records = await prisma.vaultStaffMachineAccess.findMany({ where: { userId: admin.user.id }, orderBy: [{ verifierVersion: "desc" }, { grantVersion: "desc" }] });
  const latest = new Map<string, (typeof records)[number]>();
  for (const record of records) if (!latest.has(record.machineId)) latest.set(record.machineId, record);
  const machines = new Map<string, VaultRole>();
  const now = new Date();
  for (const grant of latest.values()) {
    if (grant.status !== "ACTIVE" || grant.validFrom > now || grant.expiresAt <= now) continue;
    const prior = machines.get(grant.machineId);
    if (!prior || VAULT_ROLE_RANK[grant.role] > VAULT_ROLE_RANK[prior]) machines.set(grant.machineId, grant.role);
  }
  return { admin, owner, machines };
}

export async function vaultListScope(req: NextApiRequest, permission: VaultPermission, machineId?: string): Promise<Prisma.VaultMachineWhereInput> {
  if (machineId) {
    await requireVaultAdmin(req, { permission, machineId });
    return { id: machineId };
  }
  const access = await vaultHumanAccess(req);
  if (access.owner) return {};
  const ids = [...access.machines].filter(([, role]) => roleMay(role, permission)).map(([id]) => id);
  if (!ids.length) throw new VaultApiError(403, "VAULT_PERMISSION_REQUIRED", `${permission} permission is required`);
  return { id: { in: ids } };
}

const VAULT_ROLE_RANK: Readonly<Record<VaultRole, number>> = { RESTOCKER: 1, TECHNICIAN: 2, ADMIN: 3 };

async function resolveVaultRole(admin: AdminSession, machineId?: string, client: typeof prisma | Prisma.TransactionClient = prisma): Promise<{ role: VaultRole; owner: boolean } | null> {
  if (envAdminIds().has(admin.user.id)) return { role: "ADMIN", owner: true };
  if (!machineId) return null;
  const stream = await client.vaultStaffMachineAccess.findMany({
    where: {
      userId: admin.user.id,
      machineId,
    },
    orderBy: [{ verifierVersion: "desc" }, { grantVersion: "desc" }],
    select: { grantId: true, role: true, status: true, validFrom: true, expiresAt: true },
  });
  const now = new Date();
  const roles = stream.slice(0, 1)
    .filter((record) => record.status === "ACTIVE" && record.validFrom <= now && record.expiresAt > now)
    .map((record) => record.role as VaultRole)
    .sort((left, right) => VAULT_ROLE_RANK[right] - VAULT_ROLE_RANK[left]);
  return roles[0] ? { role: roles[0], owner: false } : null;
}

export type VaultAdminAuthority = { admin: AdminSession; role: VaultRole; reason: string | null; owner: boolean; permission: VaultPermission; machineId?: string; fresh: boolean };

export async function requireVaultAdmin(
  req: NextApiRequest,
  options: { permission: VaultPermission; machineId?: string; fresh?: boolean; reason?: string | null },
): Promise<VaultAdminAuthority> {
  requireVaultContract(req);
  const admin = await requireVaultHumanSession(req, options.fresh);
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
  return { admin, role: resolved.role, reason, owner: resolved.owner, permission: options.permission, machineId: options.machineId, fresh: options.fresh ?? false };
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
  if (input.tx && input.authority && input.outcome === "SUCCESS") {
    // Recheck at the commit boundary under the same machine lock used by grant
    // rotation/revocation; a stale role cannot finish an already-running write.
    if (input.machineId) await input.tx.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${input.machineId} FOR UPDATE`;
    const current = await resolveVaultRole(input.authority.admin, input.authority.machineId, input.tx);
    if (!current || !roleMay(current.role, input.authority.permission)) throw new VaultApiError(403, "HUMAN_AUTHORITY_CHANGED", "Vault permission changed before this action could commit");
    if (input.authority.fresh) await validateFreshAdminSession(input.authority.admin, { maximumAgeMs: FRESH_HUMAN_ADMIN_SESSION_MAX_AGE_MS, findLocalSession: (id) => input.tx!.session.findUnique({ where: { id }, include: { user: true } }) });
  }
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
