import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import {
  SPEEDSTER_IPHONE_CONTENT_TYPE,
  speedsterIphoneStorageKey,
} from "../../../lib/server/aiGraderV2IphoneCapture";
import { getStorageMode, presignUploadUrl } from "../../../lib/server/storage";

const deviceId = z.string().min(20).max(80);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PLAN"), deviceId }).strict(),
  z.object({
    action: z.literal("COMPLETE"),
    deviceId,
    uploadVersion: z.number().int().positive(),
  }).strict(),
]);

type UploadPair = {
  userId: string;
  sessionId: string;
  uploadVersion: number;
};

type Dependencies = {
  storageReady: () => boolean;
  beginUpload: (deviceId: string) => Promise<UploadPair | null>;
  completeUpload: (deviceId: string, uploadVersion: number) => Promise<number | null>;
  presignUploadUrl: (storageKey: string, contentType: string) => Promise<string>;
};

const dependencies: Dependencies = {
  storageReady: () => getStorageMode() === "s3",
  beginUpload: (id) => prisma.$transaction(async (tx) => {
    const device = await tx.aiGraderV2CaptureDevice.findUnique({ where: { id } });
    if (!device?.activeSessionId) return null;
    const session = await tx.aiGraderV2Session.findUnique({
      where: { id: device.activeSessionId },
      select: { createdByUserId: true, workflowState: true },
    });
    if (session?.createdByUserId !== device.createdByUserId || session.workflowState !== "DRAFT") {
      return null;
    }
    const updated = await tx.aiGraderV2CaptureDevice.update({
      where: { id },
      data: { uploadVersion: { increment: 1 } },
    });
    return {
      userId: device.createdByUserId,
      sessionId: device.activeSessionId,
      uploadVersion: updated.uploadVersion,
    };
  }),
  completeUpload: (id, uploadVersion) => prisma.$transaction(async (tx) => {
    const device = await tx.aiGraderV2CaptureDevice.findUnique({ where: { id } });
    if (!device?.activeSessionId) return null;
    const session = await tx.aiGraderV2Session.findUnique({
      where: { id: device.activeSessionId },
      select: { createdByUserId: true, workflowState: true },
    });
    if (session?.createdByUserId !== device.createdByUserId || session.workflowState !== "DRAFT") {
      return null;
    }
    const completed = await tx.aiGraderV2CaptureDevice.updateMany({
      where: { id, activeSessionId: device.activeSessionId, uploadVersion },
      data: { readyVersion: uploadVersion },
    });
    return completed.count === 1 ? uploadVersion : null;
  }),
  presignUploadUrl,
};

export function createAiGraderV2IphoneCaptureHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    const parsed = requestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid iPhone capture request" });
    }
    if (!deps.storageReady()) {
      return res.status(503).json({ message: "Speedster object storage is unavailable" });
    }

    try {
      if (parsed.data.action === "COMPLETE") {
        const readyVersion = await deps.completeUpload(parsed.data.deviceId, parsed.data.uploadVersion);
        return readyVersion
          ? res.status(200).json({ readyVersion })
          : res.status(409).json({ message: "This capture is no longer active" });
      }

      const pair = await deps.beginUpload(parsed.data.deviceId);
      if (!pair) return res.status(404).json({ message: "Pair this iPhone with Speedster" });
      const frontStorageKey = speedsterIphoneStorageKey(pair.userId, pair.sessionId, "FRONT");
      const backStorageKey = speedsterIphoneStorageKey(pair.userId, pair.sessionId, "BACK");
      const [frontUploadUrl, backUploadUrl] = await Promise.all([
        deps.presignUploadUrl(frontStorageKey, SPEEDSTER_IPHONE_CONTENT_TYPE),
        deps.presignUploadUrl(backStorageKey, SPEEDSTER_IPHONE_CONTENT_TYPE),
      ]);
      return res.status(200).json({
        uploadVersion: pair.uploadVersion,
        contentType: SPEEDSTER_IPHONE_CONTENT_TYPE,
        front: { storageKey: frontStorageKey, uploadUrl: frontUploadUrl },
        back: { storageKey: backStorageKey, uploadUrl: backUploadUrl },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "iPhone capture failed";
      return res.status(500).json({ message });
    }
  };
}

export default createAiGraderV2IphoneCaptureHandler();
