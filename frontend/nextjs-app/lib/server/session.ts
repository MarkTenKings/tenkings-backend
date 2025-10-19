import type { NextApiRequest } from "next";
import { createHash } from "node:crypto";
import { prisma } from "@tenkings/database";

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
  };
}

export async function requireUserSession(req: NextApiRequest): Promise<UserSession> {
  const token = extractBearer(req);
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
    },
  };
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
