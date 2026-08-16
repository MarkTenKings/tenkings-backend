import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import {
  SPEEDSTER_REVIEW_VIEW_TYPES,
  type SpeedsterReviewImageUrls,
} from "../../../../../../lib/ai-grader-v2/review-image-urls";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { isAuthorizedSpeedsterPreparedStorageKeys } from "../../../../../../lib/server/aiGraderV2IphoneCapture";
import { presignReadUrl } from "../../../../../../lib/server/storage";

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findOwnedCapture: (sessionId: string, createdByUserId: string) => Promise<{ capture: unknown } | null>;
  presignRead: (storageKey: string) => Promise<string>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findOwnedCapture: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: { capture: true },
  }),
  presignRead: presignReadUrl,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

type ReviewStorageKeys = Readonly<Record<typeof SPEEDSTER_REVIEW_VIEW_TYPES[number], string>>;

function sideStorageKeys(input: {
  capture: Record<string, unknown>;
  side: "FRONT" | "BACK";
  sessionId: string;
  createdByUserId: string;
}) {
  const persisted = input.capture[input.side.toLowerCase()];
  if (!isRecord(persisted) || !isRecord(persisted.viewStorageKeys)) return null;
  if (typeof persisted.rectifiedStorageKey !== "string"
    || typeof persisted.inspectionStorageKey !== "string"
    || typeof persisted.viewStorageKeys.NORMALIZED !== "string"
    || typeof persisted.viewStorageKeys.MICRO_DEFECT !== "string"
    || typeof persisted.viewStorageKeys.DIRECTIONAL !== "string") return null;
  const viewStorageKeys = {
    NORMALIZED: persisted.viewStorageKeys.NORMALIZED,
    MICRO_DEFECT: persisted.viewStorageKeys.MICRO_DEFECT,
    DIRECTIONAL: persisted.viewStorageKeys.DIRECTIONAL,
  };
  if (!isAuthorizedSpeedsterPreparedStorageKeys({
    userId: input.createdByUserId,
    sessionId: input.sessionId,
    side: input.side,
    rectifiedStorageKey: persisted.rectifiedStorageKey,
    inspectionStorageKey: persisted.inspectionStorageKey,
    viewStorageKeys,
  })) return null;
  const persistedKeys = {
    ORIGINAL: persisted.inspectionStorageKey,
    ...viewStorageKeys,
  } satisfies ReviewStorageKeys;
  return persistedKeys;
}

async function signSideUrls(
  storageKeys: ReviewStorageKeys,
  presignRead: Dependencies["presignRead"],
) {
  const signed = await Promise.all(SPEEDSTER_REVIEW_VIEW_TYPES.map((view) => presignRead(storageKeys[view])));
  const views = Object.fromEntries(
    SPEEDSTER_REVIEW_VIEW_TYPES.map((view, index) => [view, signed[index]]),
  ) as Record<typeof SPEEDSTER_REVIEW_VIEW_TYPES[number], string>;
  return { master: views.ORIGINAL, views };
}

export function createSpeedsterReviewImagesHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }
    res.setHeader("Cache-Control", "private, no-store");

    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Session ID is required" });
      const session = await deps.findOwnedCapture(sessionId, admin.user.id);
      if (!session) return res.status(404).json({ message: "Speedster session not found" });
      if (!isRecord(session.capture)) {
        return res.status(409).json({ message: "Speedster review images are not ready" });
      }
      const frontKeys = sideStorageKeys({
        capture: session.capture as Record<string, unknown>,
        side: "FRONT",
        sessionId,
        createdByUserId: admin.user.id,
      });
      const backKeys = sideStorageKeys({
        capture: session.capture as Record<string, unknown>,
        side: "BACK",
        sessionId,
        createdByUserId: admin.user.id,
      });
      if (!frontKeys || !backKeys) {
        return res.status(409).json({ message: "Speedster review image keys are incomplete" });
      }
      const [front, back] = await Promise.all([
        signSideUrls(frontKeys, deps.presignRead),
        signSideUrls(backKeys, deps.presignRead),
      ]);
      const urls: SpeedsterReviewImageUrls = { FRONT: front, BACK: back };
      return res.status(200).json({ urls });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterReviewImagesHandler();
