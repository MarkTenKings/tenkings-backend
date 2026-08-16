import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { getStorageMode, headStorageObject, presignReadUrl, presignUploadUrl } from "../../../../lib/server/storage";
import {
  isAuthorizedSpeedsterOriginalStorageKey,
  speedsterPreparedStorageKeys,
  speedsterRecaptureOriginalStorageKey,
  speedsterOriginalStorageGeneration,
} from "../../../../lib/server/aiGraderV2IphoneCapture";

const SESSION_ID = /^[a-z0-9-]{20,40}$/i;
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function storageObjectNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.$metadata?.httpStatusCode === 404
    || candidate.name === "NotFound"
    || candidate.name === "NoSuchKey";
}

type Dependencies = Readonly<{
  requireAdminSession: typeof requireAdminSession;
  findOwnedSession: (sessionId: string, createdByUserId: string) => Promise<{
    id: string;
    workflowState: string;
  } | null>;
  storageReady: () => boolean;
  presignUpload: typeof presignUploadUrl;
  presignRead: typeof presignReadUrl;
  headObject: typeof headStorageObject;
  randomUuid: () => string;
}>;

const dependencies: Dependencies = {
  requireAdminSession,
  findOwnedSession: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: { id: true, workflowState: true },
  }),
  storageReady: () => getStorageMode() === "s3",
  presignUpload: presignUploadUrl,
  presignRead: presignReadUrl,
  headObject: headStorageObject,
  randomUuid: randomUUID,
};

export function createSpeedsterUploadPlanHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await deps.requireAdminSession(req);
    const { sessionId, side, kind, contentType, targetedRecapture, sourceImageStorageKey } = req.body as {
      sessionId?: string;
      side?: string;
      kind?: string;
      contentType?: string;
      targetedRecapture?: boolean;
      sourceImageStorageKey?: string;
    };
    if (!sessionId || !SESSION_ID.test(sessionId)) {
      return res.status(400).json({ message: "Invalid Speedster session ID" });
    }
    const session = await deps.findOwnedSession(sessionId, admin.user.id);
    if (!session) return res.status(404).json({ message: "Speedster session not found" });
    if (session.workflowState !== "DRAFT") {
      return res.status(409).json({ message: "Only a DRAFT Speedster session can issue image upload plans" });
    }
    if (side !== "FRONT" && side !== "BACK") {
      return res.status(400).json({ message: "Card side must be FRONT or BACK" });
    }
    if (!deps.storageReady()) {
      throw new Error("Speedster uploads require configured object storage");
    }

    if (kind === "PREPARED") {
      if (!sourceImageStorageKey || !isAuthorizedSpeedsterOriginalStorageKey({
          storageKey: sourceImageStorageKey,
          userId: admin.user.id,
          sessionId,
          side,
        })) return res.status(400).json({ message: "Invalid Speedster prepared source image" });
      const generation = speedsterOriginalStorageGeneration({
          storageKey: sourceImageStorageKey,
          userId: admin.user.id,
          sessionId,
          side,
        });
      if (generation === undefined) return res.status(400).json({ message: "Invalid Speedster prepared source generation" });
      try {
        await deps.headObject(sourceImageStorageKey);
      } catch (error) {
        if (storageObjectNotFound(error)) {
          return res.status(409).json({ message: "Speedster prepared source image is not ready" });
        }
        throw error;
      }
      const keys = speedsterPreparedStorageKeys(
        admin.user.id,
        sessionId,
        side,
        generation ?? undefined,
      );
      const artifacts = ["RECTIFIED", "INSPECTION", "NORMALIZED", "MICRO_DEFECT", "DIRECTIONAL"] as const;
      const entries = await Promise.all(artifacts.map(async (artifact) => {
        const storageKey = keys[artifact];
        return [artifact, {
          storageKey,
          readUrl: await deps.presignRead(storageKey),
        }] as const;
      }));
      return res.status(200).json({ outputs: Object.fromEntries(entries) });
    }

    if (kind !== "ORIGINAL") {
      return res.status(400).json({ message: "Unknown Speedster upload kind" });
    }
    const extension = contentType ? EXTENSIONS[contentType] : undefined;
    if (!contentType || !extension) {
      return res.status(400).json({ message: "Speedster accepts JPEG, PNG, or WebP images" });
    }

    if (targetedRecapture !== undefined && targetedRecapture !== true) {
      return res.status(400).json({ message: "Invalid Speedster targeted recapture flag" });
    }
    const storageKey = targetedRecapture
      ? speedsterRecaptureOriginalStorageKey(admin.user.id, sessionId, side, deps.randomUuid(), extension as "jpg" | "png" | "webp")
      : `ai-grader-v2/${admin.user.id}/${sessionId}/original/${side.toLowerCase()}.${extension}`;
    return res.status(200).json({
      storageKey,
      uploadUrl: await deps.presignUpload(storageKey, contentType),
      readUrl: await deps.presignRead(storageKey),
    });
  } catch (error) {
    const mapped = toErrorResponse(error);
    return res.status(mapped.status).json({ message: mapped.message });
  }
  };
}

export default createSpeedsterUploadPlanHandler();
