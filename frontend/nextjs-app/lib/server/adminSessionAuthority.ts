import { createHash, timingSafeEqual } from "node:crypto";

export type AdminSessionAuthority = "operator-key" | "auth-service" | "local-database";

export interface AdminSession {
  sessionId: string;
  tokenHash: string;
  authority?: AdminSessionAuthority;
  createdAt?: Date;
  expiresAt?: Date;
  user: {
    id: string;
    phone: string | null;
    displayName: string | null;
  };
}

export interface LocalAdminSessionRecord {
  id: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  user: {
    id: string;
  } | null;
}

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const canonicalIdentity = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value !== value.trim()) {
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  return value;
};

const nullableText = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 512) return undefined;
  return value;
};

const canonicalTimestamp = (value: unknown): Date | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) return null;
  const parsed = new Date(epochMs);
  return parsed.toISOString() === value ? parsed : null;
};

const tokenHashesEqual = (presentedToken: string, authoritativeHash: string): boolean => {
  if (!SHA256_HEX.test(authoritativeHash)) return false;
  const presentedHash = createHash("sha256").update(presentedToken).digest("hex");
  return timingSafeEqual(Buffer.from(presentedHash, "hex"), Buffer.from(authoritativeHash, "hex"));
};

export function parseRemoteAdminSession(
  payload: unknown,
  presentedToken: string,
  nowMs = Date.now(),
): AdminSession {
  if (!Number.isFinite(nowMs)) {
    throw new HttpError(500, "Session validation clock is invalid");
  }
  if (!isRecord(payload) || !isRecord(payload.session) || !isRecord(payload.session.user)) {
    throw new HttpError(502, "Auth service returned an invalid session response");
  }

  const sessionId = canonicalIdentity(payload.session.id);
  const userId = canonicalIdentity(payload.session.user.id);
  const tokenHash = typeof payload.session.tokenHash === "string" ? payload.session.tokenHash : "";
  const createdAt = canonicalTimestamp(payload.session.createdAt);
  const expiresAt = canonicalTimestamp(payload.session.expiresAt);
  const phone = nullableText(payload.session.user.phone);
  const displayName = nullableText(payload.session.user.displayName);

  if (!sessionId || !userId || !createdAt || !expiresAt || phone === undefined || displayName === undefined) {
    throw new HttpError(502, "Auth service returned an invalid session response");
  }
  if (!tokenHashesEqual(presentedToken, tokenHash)) {
    throw new HttpError(401, "Session token integrity check failed");
  }
  if (createdAt.getTime() > nowMs || expiresAt.getTime() <= createdAt.getTime()) {
    throw new HttpError(502, "Auth service returned invalid session timestamps");
  }
  if (expiresAt.getTime() <= nowMs) {
    throw new HttpError(401, "Session expired");
  }

  return {
    sessionId,
    tokenHash,
    authority: "auth-service",
    createdAt,
    expiresAt,
    user: {
      id: userId,
      phone,
      displayName,
    },
  };
}

export async function validateFreshAdminSession(
  admin: AdminSession,
  options: {
    maximumAgeMs: number;
    nowMs?: number;
    findLocalSession(id: string): Promise<LocalAdminSessionRecord | null>;
  },
): Promise<AdminSession> {
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new HttpError(500, "Session validation clock is invalid");
  }
  if (!Number.isSafeInteger(options.maximumAgeMs) || options.maximumAgeMs < 60_000) {
    throw new HttpError(403, "Fresh human-admin authentication required");
  }
  if (
    admin.authority === "operator-key" ||
    admin.sessionId.startsWith("operator-key:") ||
    admin.tokenHash === "operator-key"
  ) {
    throw new HttpError(403, "Fresh human-admin authentication required");
  }

  if (admin.authority === "auth-service") {
    const createdAtMs = admin.createdAt?.getTime();
    const expiresAtMs = admin.expiresAt?.getTime();
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)) {
      throw new HttpError(401, "Fresh human-admin session could not be verified");
    }
    if ((expiresAtMs as number) <= nowMs) {
      throw new HttpError(401, "Session expired");
    }
    const ageMs = nowMs - (createdAtMs as number);
    if (ageMs < 0 || ageMs > options.maximumAgeMs) {
      throw new HttpError(403, "Fresh human-admin authentication required");
    }
    return admin;
  }

  if (admin.authority !== "local-database") {
    throw new HttpError(401, "Fresh human-admin session authority could not be verified");
  }

  const session = await options.findLocalSession(admin.sessionId);
  if (!session?.user || session.user.id !== admin.user.id || session.tokenHash !== admin.tokenHash) {
    throw new HttpError(401, "Fresh human-admin session could not be verified");
  }
  const createdAtMs = session.createdAt.getTime();
  const expiresAtMs = session.expiresAt.getTime();
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)) {
    throw new HttpError(401, "Fresh human-admin session could not be verified");
  }
  if (expiresAtMs <= nowMs) {
    throw new HttpError(401, "Session expired");
  }
  const ageMs = nowMs - createdAtMs;
  if (ageMs < 0 || ageMs > options.maximumAgeMs) {
    throw new HttpError(403, "Fresh human-admin authentication required");
  }
  return admin;
}
