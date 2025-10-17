import { NextApiRequest } from "next";
import { createHash } from "node:crypto";
import { prisma } from "@tenkings/database";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";

export interface AdminSession {
  sessionId: string;
  tokenHash: string;
  user: {
    id: string;
    phone: string | null;
    displayName: string | null;
  };
}

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const extractToken = (req: NextApiRequest): string => {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }
  return token.trim();
};

export async function requireAdminSession(req: NextApiRequest): Promise<AdminSession> {
  const operatorKeyHeader = req.headers["x-operator-key"];
  const operatorKey = process.env.OPERATOR_API_KEY ?? process.env.NEXT_PUBLIC_OPERATOR_KEY;
  if (operatorKey && typeof operatorKeyHeader === "string" && operatorKeyHeader === operatorKey) {
    const operatorUserId = process.env.OPERATOR_USER_ID;
    const operatorUserPhone = process.env.OPERATOR_USER_PHONE ?? process.env.NEXT_PUBLIC_ADMIN_PHONES;

    let operatorUser = null;

    if (operatorUserId) {
      operatorUser = await prisma.user.findUnique({ where: { id: operatorUserId } });
    }

    if (!operatorUser && operatorUserPhone) {
      const normalizedPhone = operatorUserPhone
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => (value.startsWith("+") ? value : `+1${value}`))[0];

      if (normalizedPhone) {
        operatorUser = await prisma.user.findFirst({ where: { phone: normalizedPhone } });
      }
    }

    if (!operatorUser) {
      throw new HttpError(403, "Configured operator user not found");
    }

    return {
      sessionId: `operator-key:${operatorUser.id}`,
      tokenHash: "operator-key",
      user: {
        id: operatorUser.id,
        phone: operatorUser.phone,
        displayName: operatorUser.displayName,
      },
    };
  }

  const token = extractToken(req);
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
    user: {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
    },
  };
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
