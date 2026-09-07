import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import type { SpeedsterCardSide } from "../../../../../../lib/ai-grader-v2/contracts";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { headStorageObject, presignReadUrl } from "../../../../../../lib/server/storage";
import { isAuthorizedSpeedsterOriginalStorageKey } from "../../../../../../lib/server/aiGraderV2IphoneCapture";

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findOwnedDraft: (sessionId: string, createdByUserId: string) => Promise<{ id: string } | null>;
  headOriginalObject: (storageKey: string) => Promise<{ byteSize?: number; contentType?: string }>;
  presignRead: (storageKey: string) => Promise<string>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findOwnedDraft: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId, workflowState: "DRAFT" },
    select: { id: true },
  }),
  headOriginalObject: headStorageObject,
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

function storageObjectNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.$metadata?.httpStatusCode === 404
    || candidate.name === "NotFound"
    || candidate.name === "NoSuchKey";
}

export function createSpeedsterOriginalImageHandler(deps: Dependencies = dependencies) {
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
      const requestedStorageKey = Array.isArray(req.query.storageKey)
        ? req.query.storageKey[0]
        : req.query.storageKey;
      if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });
      if (!side) return res.status(400).json({ message: "Card side must be FRONT or BACK" });
      if (typeof requestedStorageKey !== "string" || !isAuthorizedSpeedsterOriginalStorageKey({
        storageKey: requestedStorageKey,
        userId: admin.user.id,
        sessionId,
        side,
      })) return res.status(400).json({ message: "Original image storage key is invalid" });
      const session = await deps.findOwnedDraft(sessionId, admin.user.id);
      if (!session) return res.status(404).json({ message: "Speedster DRAFT session not found" });

      let object: Awaited<ReturnType<Dependencies["headOriginalObject"]>>;
      try {
        object = await deps.headOriginalObject(requestedStorageKey);
      } catch (error) {
        if (storageObjectNotFound(error)) {
          return res.status(409).json({ message: `The exact ${side.toLowerCase()} original image is not ready.` });
        }
        throw error;
      }
      const contentType = object.contentType?.split(";", 1)[0]?.trim().toLowerCase();
      if (!Number.isFinite(object.byteSize) || (object.byteSize ?? 0) <= 0
        || !contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
        return res.status(409).json({ message: `The exact ${side.toLowerCase()} original image is not ready.` });
      }

      return res.status(200).json({
        side,
        storageKey: requestedStorageKey,
        imageUrl: await deps.presignRead(requestedStorageKey),
      });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterOriginalImageHandler();
