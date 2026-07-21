import type { NextApiRequest } from "next";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AdminSession } from "./admin";
import { requireUserSession as defaultRequireUserSession, type UserSession } from "./session";

export const AI_GRADER_OPERATOR_USER_IDS_ENV = "AI_GRADER_OPERATOR_USER_IDS";
export const AI_GRADER_OPERATOR_PHONES_ENV = "AI_GRADER_OPERATOR_PHONES";
export const AI_GRADER_ADMIN_USER_IDS_ENV = "AI_GRADER_ADMIN_USER_IDS";
export const AI_GRADER_ADMIN_PHONES_ENV = "AI_GRADER_ADMIN_PHONES";
export const AI_GRADER_SERVICE_ACCOUNT_ID_ENV = "AI_GRADER_SERVICE_ACCOUNT_ID";
export const AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV = "AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256";
export const AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV = "AI_GRADER_SERVICE_ACCOUNT_SCOPES";

export type AiGraderProductionAction =
  | "publish"
  | "history"
  | "card-search"
  | "calibration-status"
  | "upload-slab-photo"
  | "run-comps"
  | "nfc-program"
  | "nfc-admin";
export type AiGraderHumanRole = "ai_grader_operator" | "ai_grader_admin";
export type AiGraderProductionActorType = "human_operator" | "service_account";

export type AiGraderProductionActorAudit = {
  actorType: AiGraderProductionActorType;
  action: AiGraderProductionAction;
  requestedAt: string;
  userId?: string | null;
  serviceAccountId?: string | null;
  role?: AiGraderHumanRole | "ai_grader_service" | null;
};

export type AiGraderProductionHumanActor = {
  type: "human_operator";
  role: AiGraderHumanRole;
  user: {
    id: string;
    phone: string | null;
    displayName: string | null;
  };
  sessionId: string;
  tokenHash: string;
  adminSession?: AdminSession;
  audit: AiGraderProductionActorAudit;
};

export type AiGraderProductionServiceActor = {
  type: "service_account";
  role: "ai_grader_service";
  serviceAccountId: string;
  scopes: AiGraderProductionAction[];
  audit: AiGraderProductionActorAudit;
};

export type AiGraderProductionActor = AiGraderProductionHumanActor | AiGraderProductionServiceActor;

type EnvLike = Record<string, string | undefined>;

export type AiGraderProductionAuthDependencies = {
  env?: EnvLike;
  requireUserSession?: (req: NextApiRequest) => Promise<UserSession>;
  requireAdminSession?: (req: NextApiRequest) => Promise<AdminSession>;
};

type RoleConfig = {
  ids: Set<string>;
  phones: Set<string>;
  configured: boolean;
};

class AiGraderProductionAuthError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AiGraderProductionAuthError";
    this.statusCode = statusCode;
  }
}

const ALLOWED_ACTIONS: AiGraderProductionAction[] = [
  "publish",
  "calibration-status",
  "history",
  "card-search",
  "upload-slab-photo",
  "run-comps",
  "nfc-program",
  "nfc-admin",
];
const ACTION_SET = new Set<string>(ALLOWED_ACTIONS);

function normalizePhone(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function csv(value: string | undefined) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function csvSet(value: string | undefined) {
  return new Set(csv(value));
}

function csvPhoneSet(value: string | undefined) {
  return new Set(csv(value).map(normalizePhone).filter(Boolean));
}

function firstDefined(env: EnvLike, names: string[]) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function buildRoleConfig(env: EnvLike, role: "operator" | "admin"): RoleConfig {
  const ids =
    role === "operator"
      ? firstDefined(env, [AI_GRADER_OPERATOR_USER_IDS_ENV, "NEXT_PUBLIC_AI_GRADER_OPERATOR_USER_IDS"])
      : firstDefined(env, [AI_GRADER_ADMIN_USER_IDS_ENV, "NEXT_PUBLIC_AI_GRADER_ADMIN_USER_IDS"]);
  const phones =
    role === "operator"
      ? firstDefined(env, [AI_GRADER_OPERATOR_PHONES_ENV, "NEXT_PUBLIC_AI_GRADER_OPERATOR_PHONES"])
      : firstDefined(env, [AI_GRADER_ADMIN_PHONES_ENV, "NEXT_PUBLIC_AI_GRADER_ADMIN_PHONES"]);
  const idSet = csvSet(ids);
  const phoneSet = csvPhoneSet(phones);
  return {
    ids: idSet,
    phones: phoneSet,
    configured: idSet.size > 0 || phoneSet.size > 0,
  };
}

function buildGlobalAdminConfig(env: EnvLike): RoleConfig {
  const ids = firstDefined(env, ["ADMIN_USER_IDS", "NEXT_PUBLIC_ADMIN_USER_IDS"]);
  const phones = firstDefined(env, ["ADMIN_PHONES", "NEXT_PUBLIC_ADMIN_PHONES"]);
  const idSet = csvSet(ids);
  const phoneSet = csvPhoneSet(phones);
  return {
    ids: idSet,
    phones: phoneSet,
    configured: idSet.size > 0 || phoneSet.size > 0,
  };
}

function roleMatches(user: { id: string; phone: string | null }, config: RoleConfig) {
  if (config.ids.has(user.id)) return true;
  const phone = normalizePhone(user.phone ?? "");
  return Boolean(phone && config.phones.has(phone));
}

function resolveHumanRole(user: { id: string; phone: string | null }, env: EnvLike): AiGraderHumanRole | null {
  const aiAdmin = buildRoleConfig(env, "admin");
  const aiOperator = buildRoleConfig(env, "operator");
  const globalAdmin = buildGlobalAdminConfig(env);

  if (roleMatches(user, aiAdmin) || roleMatches(user, globalAdmin)) return "ai_grader_admin";
  if (roleMatches(user, aiOperator)) return "ai_grader_operator";
  return null;
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function serviceToken(req: NextApiRequest) {
  return firstHeaderValue(req.headers["x-ai-grader-service-token"]).trim();
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256Hex(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

function timingSafeEqualHex(left: string, right: string) {
  if (!isSha256Hex(left) || !isSha256Hex(right)) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseServiceScopes(env: EnvLike): AiGraderProductionAction[] {
  return csv(env[AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV]).filter((scope): scope is AiGraderProductionAction =>
    ACTION_SET.has(scope)
  );
}

function serviceTokenHashes(env: EnvLike) {
  return csv(env[AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV]).filter(isSha256Hex);
}

export function aiGraderProductionAuthStatus(env: EnvLike = process.env) {
  const aiAdmin = buildRoleConfig(env, "admin");
  const aiOperator = buildRoleConfig(env, "operator");
  const globalAdmin = buildGlobalAdminConfig(env);
  const serviceAccountId = env[AI_GRADER_SERVICE_ACCOUNT_ID_ENV]?.trim() ?? "";
  const tokenHashCount = serviceTokenHashes(env).length;
  const serviceScopes = parseServiceScopes(env);
  return {
    humanOperatorRolesConfigured: aiOperator.configured,
    humanAdminRolesConfigured: aiAdmin.configured,
    globalAdminFallbackConfigured: globalAdmin.configured,
    serviceAccountConfigured: Boolean(serviceAccountId && tokenHashCount > 0 && serviceScopes.length > 0),
    serviceAccountScopeCount: serviceScopes.length,
  };
}

function buildAudit(input: {
  actorType: AiGraderProductionActorType;
  action: AiGraderProductionAction;
  userId?: string | null;
  serviceAccountId?: string | null;
  role?: AiGraderProductionActorAudit["role"];
}): AiGraderProductionActorAudit {
  return {
    actorType: input.actorType,
    action: input.action,
    requestedAt: new Date().toISOString(),
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.serviceAccountId ? { serviceAccountId: input.serviceAccountId } : {}),
    ...(input.role ? { role: input.role } : {}),
  };
}

function serviceActorForRequest(
  req: NextApiRequest,
  action: AiGraderProductionAction,
  env: EnvLike
): AiGraderProductionServiceActor | null {
  const token = serviceToken(req);
  if (!token) return null;

  const serviceAccountId = env[AI_GRADER_SERVICE_ACCOUNT_ID_ENV]?.trim() ?? "";
  const hashes = serviceTokenHashes(env);
  const scopes = parseServiceScopes(env);
  if (!serviceAccountId || hashes.length < 1 || scopes.length < 1) {
    throw new AiGraderProductionAuthError(403, "AI Grader service account is not configured");
  }

  const presentedHash = sha256Hex(token);
  if (!hashes.some((expectedHash) => timingSafeEqualHex(presentedHash, expectedHash))) {
    throw new AiGraderProductionAuthError(401, "AI Grader service account credentials rejected");
  }

  if (!scopes.includes(action)) {
    throw new AiGraderProductionAuthError(403, "AI Grader service account scope denied");
  }

  return {
    type: "service_account",
    role: "ai_grader_service",
    serviceAccountId,
    scopes,
    audit: buildAudit({
      actorType: "service_account",
      action,
      serviceAccountId,
      role: "ai_grader_service",
    }),
  };
}

function humanActorFromAdminSession(
  admin: AdminSession,
  action: AiGraderProductionAction,
  env: EnvLike
): AiGraderProductionHumanActor {
  const role = resolveHumanRole(admin.user, env) ?? "ai_grader_admin";
  return {
    type: "human_operator",
    role,
    user: {
      id: admin.user.id,
      phone: admin.user.phone,
      displayName: admin.user.displayName,
    },
    sessionId: admin.sessionId,
    tokenHash: admin.tokenHash,
    adminSession: admin,
    audit: buildAudit({ actorType: "human_operator", action, userId: admin.user.id, role }),
  };
}

async function humanActorForRequest(
  req: NextApiRequest,
  action: AiGraderProductionAction,
  deps: AiGraderProductionAuthDependencies,
  env: EnvLike
): Promise<AiGraderProductionHumanActor> {
  if (!deps.requireUserSession && deps.requireAdminSession) {
    const admin = await deps.requireAdminSession(req);
    return humanActorFromAdminSession(admin, action, env);
  }

  const requireUserSession = deps.requireUserSession ?? defaultRequireUserSession;
  const session = await requireUserSession(req);
  const role = resolveHumanRole(session.user, env);
  if (!role) {
    throw new AiGraderProductionAuthError(403, "AI Grader operator role required");
  }

  return {
    type: "human_operator",
    role,
    user: {
      id: session.user.id,
      phone: session.user.phone,
      displayName: session.user.displayName,
    },
    sessionId: session.id,
    tokenHash: session.tokenHash,
    audit: buildAudit({ actorType: "human_operator", action, userId: session.user.id, role }),
  };
}

export async function requireAiGraderProductionActor(
  req: NextApiRequest,
  action: AiGraderProductionAction,
  deps: AiGraderProductionAuthDependencies = {}
): Promise<AiGraderProductionActor> {
  const env = deps.env ?? process.env;
  const serviceActor = serviceActorForRequest(req, action, env);
  if (serviceActor) return serviceActor;
  return humanActorForRequest(req, action, deps, env);
}
