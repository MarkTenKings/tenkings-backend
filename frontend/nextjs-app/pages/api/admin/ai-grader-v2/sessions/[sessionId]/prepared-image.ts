import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import type { SpeedsterCardSide } from "../../../../../../lib/ai-grader-v2/contracts";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { headStorageObject, presignReadUrl } from "../../../../../../lib/server/storage";

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findOwnedSession: (sessionId: string, createdByUserId: string) => Promise<{ id: string } | null>;
  headPreparedObject: (storageKey: string) => Promise<{ byteSize?: number; contentType?: string }>;
  presignRead: (storageKey: string) => Promise<string>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findOwnedSession: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: { id: true },
  }),
  headPreparedObject: headStorageObject,
  presignRead: presignReadUrl,
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && /^[a-z0-9-]{20,40}$/i.test(value) ? value : null;
};

const sideFrom = (req: NextApiRequest): SpeedsterCardSide | null => {
  const value = Array.isArray(req.query.side) ? req.query.side[0] : req.query.side;
  return value === "FRONT" || value === "BACK" ? value : null;
};

const preparedRectifiedStorageKey = (
  createdByUserId: string,
  sessionId: string,
  side: SpeedsterCardSide,
) => `ai-grader-v2/${createdByUserId}/${sessionId}/prepared/${side.toLowerCase()}/rectified.webp`;

export function createSpeedsterPreparedImageHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }
    res.setHeader("Cache-Control", "private, no-store");

    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      const side = sideFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });
      if (!side) return res.status(400).json({ message: "Card side must be FRONT or BACK" });
      const session = await deps.findOwnedSession(sessionId, admin.user.id);
      if (!session) return res.status(404).json({ message: "Speedster session not found" });

      const storageKey = preparedRectifiedStorageKey(admin.user.id, session.id, side);
      let object: Awaited<ReturnType<Dependencies["headPreparedObject"]>>;
      try {
        object = await deps.headPreparedObject(storageKey);
      } catch {
        return res.status(409).json({ message: `The ${side.toLowerCase()} prepared card image is not ready.` });
      }
      const contentType = object.contentType?.split(";", 1)[0]?.trim().toLowerCase();
      if (!Number.isFinite(object.byteSize) || (object.byteSize ?? 0) <= 0 || (contentType && contentType !== "image/webp")) {
        return res.status(409).json({ message: `The ${side.toLowerCase()} prepared card image is not ready.` });
      }

      return res.status(200).json({
        side,
        imageUrl: await deps.presignRead(storageKey),
      });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterPreparedImageHandler();
