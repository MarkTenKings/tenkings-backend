import type { NextApiRequest } from "next";
import { createHash } from "node:crypto";
import { prisma } from "@tenkings/database";

const AUTH_SERVICE_URL = (process.env.AUTH_SERVICE_URL ?? process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "").replace(/\/$/, "");

const buildAuthUrl = (path: string) => {
  if (!AUTH_SERVICE_URL) {
    return null;
  }
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${AUTH_SERVICE_URL}${suffix}`;
};

class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const extractBearer = (req: NextApiRequest) => {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }
  return token;
};

export interface UserSession {
  id: string;
  tokenHash: string;
  user: {
    id: string;
    phone: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export async function requireUserSession(req: NextApiRequest): Promise<UserSession> {
  const token = extractBearer(req);

  const viaAuthService = await lookupViaAuthService(token);
  if (viaAuthService) {
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

  return {
    id: session.id,
    tokenHash: session.tokenHash,
    user: {
      id: session.user.id,
      phone: session.user.phone,
      displayName: session.user.displayName,
      avatarUrl: session.user.avatarUrl,
    },
  };
}

async function lookupViaAuthService(token: string): Promise<UserSession | null> {
  const url = buildAuthUrl("/session");
  if (!url) {
    return null;
  }

  try {
    console.log("[session] contacting auth service", { url });
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log("[session] auth service response", { status: response.status });

    if (response.status === 401 || response.status === 404) {
      console.warn("[session] auth service reported missing session", { status: response.status });
      return null;
    }

    if (!response.ok) {
      const message = await response.text().catch(() => "Auth service error");
      console.warn("[session] auth service returned non-ok status", {
        status: response.status,
        message,
      });
      return null;
    }

    const payload = (await response.json()) as {
      session: {
        id: string;
        tokenHash: string;
        user: { id: string; phone: string | null; displayName: string | null; avatarUrl: string | null };
      };
    };

    if (!payload?.session?.id) {
      console.warn("[session] auth service returned invalid payload", payload);
      return null;
    }

    return {
      id: payload.session.id,
      tokenHash: payload.session.tokenHash,
      user: payload.session.user,
    };
  } catch (error) {
    console.warn("[session] auth service lookup threw", error);
    return null;
  }
}

export function toUserErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return { status: error.statusCode, message: error.message } as const;
  }
  if (error instanceof Error) {
    return { status: 500, message: error.message } as const;
  }
  return { status: 500, message: "Unexpected error" } as const;
}
