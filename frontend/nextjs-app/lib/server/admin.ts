import { NextApiRequest } from "next";
import { createHash } from "node:crypto";
import { prisma } from "@tenkings/database";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import {
  HttpError,
  parseRemoteAdminSession,
  validateFreshAdminSession,
  type AdminSession,
} from "./adminSessionAuthority";
import {
  matchesServerOperatorKey,
  resolveServerOperatorAuthority,
  type ServerOperatorCapability,
} from "./serverOperatorAuthority";

export type { AdminSession } from "./adminSessionAuthority";

const trimTrailingSlash = (value: string) => value.replace(/\/$/, "");

const resolveAuthServiceUrl = (): string | null => {
  const explicit = process.env.AUTH_SERVICE_URL ?? process.env.NEXT_PUBLIC_AUTH_SERVICE_URL;
  if (explicit && explicit.trim()) {
    return trimTrailingSlash(explicit.trim());
  }

  const apiBase = process.env.TENKINGS_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (apiBase && apiBase.trim()) {
    return `${trimTrailingSlash(apiBase.trim())}/auth`;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  if (siteUrl && siteUrl.trim()) {
    return `${trimTrailingSlash(siteUrl.trim())}/auth`;
  }

  return null;
};

const AUTH_SERVICE_URL = resolveAuthServiceUrl();

const extractToken = (req: NextApiRequest): string => {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }
  return token.trim();
};

export async function lookupViaAuthService(
  token: string,
  options: {
    authServiceUrl?: string | null;
    fetchImpl?: typeof fetch;
    nowMs?: number;
  } = {},
): Promise<AdminSession | null> {
  const authServiceUrl =
    options.authServiceUrl === undefined
      ? AUTH_SERVICE_URL
      : options.authServiceUrl
        ? trimTrailingSlash(options.authServiceUrl)
        : null;
  const url = authServiceUrl ? `${authServiceUrl}/session` : null;
  if (!url) {
    return null;
  }

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    console.warn("[admin] auth service lookup unavailable", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }

  if (response.status === 401 || response.status === 404) {
    throw new HttpError(401, "Session not found");
  }
  if (!response.ok) {
    console.warn("[admin] auth service returned non-ok status", { status: response.status });
    throw new HttpError(response.status >= 500 ? 503 : 502, "Auth service session lookup failed");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, "Auth service returned an invalid session response");
  }
  return parseRemoteAdminSession(payload, token, options.nowMs);
}

export async function requireAdminSession(req: NextApiRequest): Promise<AdminSession> {
  const token = extractToken(req);
  return requireAdminSessionForToken(token);
}

async function requireAdminSessionForToken(token: string): Promise<AdminSession> {
  const viaAuthService = await lookupViaAuthService(token);
  if (viaAuthService) {
    const adminById = hasAdminAccess(viaAuthService.user.id);
    const adminByPhone = hasAdminPhoneAccess(viaAuthService.user.phone);

    if (!adminById && !adminByPhone) {
      throw new HttpError(403, "Admin privileges required");
    }

    return viaAuthService;
  }
  const hash = createHash("sha256").update(token).digest("hex");

  const session = await prisma.session.findUnique({
    where: { tokenHash: hash },
    include: { user: true },
  });

  if (!session || !session.user) {
    throw new HttpError(401, "Session not found");
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, "Session expired");
  }

  const { user } = session;
  const adminById = hasAdminAccess(user.id);
  const adminByPhone = hasAdminPhoneAccess(user.phone);

  if (!adminById && !adminByPhone) {
    throw new HttpError(403, "Admin privileges required");
  }

  return {
    sessionId: session.id,
    tokenHash: session.tokenHash,
    authority: "local-database",
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
    },
  };
}

export async function requireAdminSessionOrOperatorCapability(
  req: NextApiRequest,
  requiredCapability: ServerOperatorCapability,
): Promise<AdminSession> {
  const operatorKeyHeader = req.headers["x-operator-key"];
  if (operatorKeyHeader !== undefined) {
    const operatorAuthority = resolveServerOperatorAuthority();
    if (!operatorAuthority
      || !operatorAuthority.capabilities.includes(requiredCapability)
      || typeof operatorKeyHeader !== "string"
      || !matchesServerOperatorKey(operatorKeyHeader, operatorAuthority.operatorKey)) {
      throw new HttpError(401, "Invalid operator authority");
    }
    const operatorUser = await prisma.user.findUnique({
      where: { id: operatorAuthority.operatorUserId },
    });
    if (!operatorUser
      || (!hasAdminAccess(operatorUser.id) && !hasAdminPhoneAccess(operatorUser.phone))) {
      throw new HttpError(403, "Configured operator authority is not an admin");
    }
    return {
      sessionId: `operator-key:${operatorUser.id}`,
      tokenHash: "operator-key",
      authority: "operator-key",
      user: {
        id: operatorUser.id,
        phone: operatorUser.phone,
        displayName: operatorUser.displayName,
      },
    };
  }
  return requireAdminSession(req);
}
export const FRESH_HUMAN_ADMIN_SESSION_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Step-up authority for calibration trust/lifecycle actions. Static operator keys,
 * service accounts, expired sessions, and sessions older than the short freshness
 * window are denied even when they otherwise have admin access.
 */
export async function requireFreshHumanAdminSession(
  req: NextApiRequest,
  maximumAgeMs = FRESH_HUMAN_ADMIN_SESSION_MAX_AGE_MS,
): Promise<AdminSession> {
  const admin = await requireAdminSession(req);
  return validateFreshAdminSession(admin, {
    maximumAgeMs,
    async findLocalSession(id) {
      return prisma.session.findUnique({
        where: { id },
        include: { user: true },
      });
    },
  });
}


export function toErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return { status: error.statusCode, message: error.message } as const;
  }
  if (error instanceof Error) {
    return { status: 500, message: error.message } as const;
  }
  return { status: 500, message: "Unexpected error" } as const;
}
