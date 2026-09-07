import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import {
  SPEEDSTER_IPHONE_CONTENT_TYPE,
  speedsterIphoneStorageKey,
} from "../../../lib/server/aiGraderV2IphoneCapture";
import {
  AI_GRADER_STORAGE_MAX_OBJECT_BYTES,
  getStorageMode,
  presignPrivateSpeedsterUploadUrl,
  sha256HexToBase64,
  verifyStorageObjectIntegrity,
} from "../../../lib/server/storage";

const deviceId = z.string().min(20).max(80);
const captureObject = z.object({
  byteSize: z.number().int().positive().max(AI_GRADER_STORAGE_MAX_OBJECT_BYTES),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const captureManifest = z.object({ front: captureObject, back: captureObject }).strict();
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PLAN"), deviceId, ...captureManifest.shape }).strict(),
  z.object({
    action: z.literal("COMPLETE"),
    deviceId,
    uploadVersion: z.number().int().positive(),
    ...captureManifest.shape,
  }).strict(),
]);

type CaptureManifest = z.infer<typeof captureManifest>;
type UploadPair = {
  userId: string;
  sessionId: string;
  uploadVersion: number;
};

type Dependencies = {
  storageReady: () => boolean;
  beginUpload: (deviceId: string, manifest: CaptureManifest) => Promise<UploadPair | null>;
  findPlannedUpload: (deviceId: string, uploadVersion: number, manifest: CaptureManifest) => Promise<UploadPair | null>;
  completeUpload: (deviceId: string, uploadVersion: number, manifest: CaptureManifest) => Promise<number | null>;
  presignUploadUrl: (input: { storageKey: string; checksumSha256: string }) => Promise<string>;
  verifyObject: typeof verifyStorageObjectIntegrity;
};

function exactManifest(value: unknown): CaptureManifest | null {
  const parsed = captureManifest.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function sameManifest(left: unknown, right: CaptureManifest) {
  const parsed = exactManifest(left);
  return parsed !== null
    && parsed.front.byteSize === right.front.byteSize
    && parsed.front.checksumSha256 === right.front.checksumSha256
    && parsed.back.byteSize === right.back.byteSize
    && parsed.back.checksumSha256 === right.back.checksumSha256;
}

async function activePair(id: string) {
  const device = await prisma.aiGraderV2CaptureDevice.findUnique({ where: { id } });
  if (!device?.activeSessionId) return null;
  const session = await prisma.aiGraderV2Session.findUnique({
    where: { id: device.activeSessionId },
    select: { createdByUserId: true, workflowState: true },
  });
  if (session?.createdByUserId !== device.createdByUserId || session.workflowState !== "DRAFT") return null;
  return { device, sessionId: device.activeSessionId };
}

const dependencies: Dependencies = {
  storageReady: () => getStorageMode() === "s3",
  beginUpload: (id, manifest) => prisma.$transaction(async (tx) => {
    const device = await tx.aiGraderV2CaptureDevice.findUnique({ where: { id } });
    if (!device?.activeSessionId) return null;
    const session = await tx.aiGraderV2Session.findUnique({
      where: { id: device.activeSessionId },
      select: { createdByUserId: true, workflowState: true },
    });
    if (session?.createdByUserId !== device.createdByUserId || session.workflowState !== "DRAFT") return null;
    const updated = await tx.aiGraderV2CaptureDevice.update({
      where: { id },
      data: { uploadVersion: { increment: 1 }, uploadManifest: manifest },
    });
    return { userId: device.createdByUserId, sessionId: device.activeSessionId, uploadVersion: updated.uploadVersion };
  }),
  findPlannedUpload: async (id, uploadVersion, manifest) => {
    const active = await activePair(id);
    if (!active || active.device.uploadVersion !== uploadVersion || !sameManifest(active.device.uploadManifest, manifest)) return null;
    return { userId: active.device.createdByUserId, sessionId: active.sessionId, uploadVersion };
  },
  completeUpload: (id, uploadVersion, manifest) => prisma.$transaction(async (tx) => {
    const device = await tx.aiGraderV2CaptureDevice.findUnique({ where: { id } });
    if (!device?.activeSessionId || device.uploadVersion !== uploadVersion || !sameManifest(device.uploadManifest, manifest)) return null;
    const session = await tx.aiGraderV2Session.findUnique({
      where: { id: device.activeSessionId },
      select: { createdByUserId: true, workflowState: true },
    });
    if (session?.createdByUserId !== device.createdByUserId || session.workflowState !== "DRAFT") return null;
    const completed = await tx.aiGraderV2CaptureDevice.updateMany({
      where: { id, activeSessionId: device.activeSessionId, uploadVersion },
      data: { readyVersion: uploadVersion, readyManifest: manifest },
    });
    return completed.count === 1 ? uploadVersion : null;
  }),
  presignUploadUrl: ({ storageKey, checksumSha256 }) => presignPrivateSpeedsterUploadUrl({
    storageKey,
    contentType: SPEEDSTER_IPHONE_CONTENT_TYPE,
    checksumSha256,
    requireAclHeader: true,
  }),
  verifyObject: verifyStorageObjectIntegrity,
};

function storageKeys(pair: UploadPair, manifest: CaptureManifest) {
  return {
    front: speedsterIphoneStorageKey(pair.userId, pair.sessionId, "FRONT", pair.uploadVersion, manifest.front.checksumSha256),
    back: speedsterIphoneStorageKey(pair.userId, pair.sessionId, "BACK", pair.uploadVersion, manifest.back.checksumSha256),
  };
}

export function createAiGraderV2IphoneCaptureHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    const parsed = requestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid iPhone capture request" });
    if (!deps.storageReady()) return res.status(503).json({ message: "Speedster object storage is unavailable" });

    try {
      const manifest = { front: parsed.data.front, back: parsed.data.back };
      if (parsed.data.action === "COMPLETE") {
        const pair = await deps.findPlannedUpload(parsed.data.deviceId, parsed.data.uploadVersion, manifest);
        if (!pair) return res.status(409).json({ message: "This capture plan is no longer active" });
        const keys = storageKeys(pair, manifest);
        const [front, back] = await Promise.all([
          deps.verifyObject({ storageKey: keys.front, expectedByteSize: manifest.front.byteSize, expectedChecksumSha256: manifest.front.checksumSha256 }),
          deps.verifyObject({ storageKey: keys.back, expectedByteSize: manifest.back.byteSize, expectedChecksumSha256: manifest.back.checksumSha256 }),
        ]);
        if (!front.ok || !back.ok
          || front.contentType?.trim().toLowerCase() !== SPEEDSTER_IPHONE_CONTENT_TYPE
          || back.contentType?.trim().toLowerCase() !== SPEEDSTER_IPHONE_CONTENT_TYPE) {
          return res.status(409).json({ message: "The iPhone capture pair did not match its exact upload plan" });
        }
        const readyVersion = await deps.completeUpload(parsed.data.deviceId, parsed.data.uploadVersion, manifest);
        return readyVersion
          ? res.status(200).json({ readyVersion })
          : res.status(409).json({ message: "This capture is no longer active" });
      }

      const pair = await deps.beginUpload(parsed.data.deviceId, manifest);
      if (!pair) return res.status(404).json({ message: "Pair this iPhone with Speedster" });
      const keys = storageKeys(pair, manifest);
      const [frontUploadUrl, backUploadUrl] = await Promise.all([
        deps.presignUploadUrl({ storageKey: keys.front, checksumSha256: manifest.front.checksumSha256 }),
        deps.presignUploadUrl({ storageKey: keys.back, checksumSha256: manifest.back.checksumSha256 }),
      ]);
      const headers = (checksumSha256: string) => ({
        "Content-Type": SPEEDSTER_IPHONE_CONTENT_TYPE,
        "x-amz-acl": "private",
        "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
      });
      return res.status(200).json({
        uploadVersion: pair.uploadVersion,
        contentType: SPEEDSTER_IPHONE_CONTENT_TYPE,
        frontUploadUrl,
        backUploadUrl,
        frontUploadHeaders: headers(manifest.front.checksumSha256),
        backUploadHeaders: headers(manifest.back.checksumSha256),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "iPhone capture failed";
      return res.status(500).json({ message });
    }
  };
}

export default createAiGraderV2IphoneCaptureHandler();
