import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import {
  AI_GRADER_STORAGE_MAX_OBJECT_BYTES,
  getStorageMode,
  headStorageObject,
  presignPrivateSpeedsterUploadUrl,
  presignReadUrl,
  sha256HexToBase64,
  verifyStorageObjectIntegrity,
} from "../../../../lib/server/storage";
import {
  isAuthorizedSpeedsterOriginalStorageKey,
  speedsterContentAddressedOriginalStorageKey,
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
const SHA256 = /^[a-f0-9]{64}$/;

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
  presignUpload: (storageKey: string, contentType: string, checksumSha256?: string) => Promise<string>;
  presignRead: typeof presignReadUrl;
  headObject: typeof headStorageObject;
  verifyObject: typeof verifyStorageObjectIntegrity;
  randomUuid: () => string;
}>;

const dependencies: Dependencies = {
  requireAdminSession,
  findOwnedSession: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: { id: true, workflowState: true },
  }),
  storageReady: () => getStorageMode() === "s3",
  presignUpload: (storageKey, contentType, checksumSha256) => presignPrivateSpeedsterUploadUrl({
    storageKey,
    contentType,
    ...(checksumSha256 ? { checksumSha256 } : {}),
    requireAclHeader: true,
  }),
  presignRead: presignReadUrl,
  headObject: headStorageObject,
  verifyObject: verifyStorageObjectIntegrity,
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
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    const {
      sessionId,
      side,
      kind,
      contentType,
      targetedRecapture,
      sourceImageStorageKey,
      storageKey: requestedStorageKey,
      checksumSha256: requestedChecksumSha256,
      byteSize: requestedByteSize,
    } = req.body as {
      sessionId?: string;
      side?: string;
      kind?: string;
      contentType?: string;
      targetedRecapture?: boolean;
      sourceImageStorageKey?: string;
      storageKey?: string;
      checksumSha256?: string;
      byteSize?: number;
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

    if (kind === "ORIGINAL_VERIFY") {
      const checksumSha256 = String(requestedChecksumSha256 ?? "").trim().toLowerCase();
      if (!contentType || !EXTENSIONS[contentType]
        || !SHA256.test(checksumSha256)
        || !Number.isSafeInteger(requestedByteSize)
        || (requestedByteSize ?? 0) < 1
        || (requestedByteSize ?? 0) > AI_GRADER_STORAGE_MAX_OBJECT_BYTES
        || !requestedStorageKey
        || !isAuthorizedSpeedsterOriginalStorageKey({
          storageKey: requestedStorageKey,
          userId: admin.user.id,
          sessionId,
          side,
        })) {
        return res.status(400).json({ message: "Invalid Speedster original verification request" });
      }
      const integrity = await deps.verifyObject({
        storageKey: requestedStorageKey,
        expectedByteSize: requestedByteSize as number,
        expectedChecksumSha256: checksumSha256,
      });
      if (!integrity.ok || integrity.contentType?.trim().toLowerCase() !== contentType.toLowerCase()) {
        return res.status(409).json({ message: "Speedster original upload did not match its exact plan" });
      }
      return res.status(200).json({
        storageKey: requestedStorageKey,
        readUrl: await deps.presignRead(requestedStorageKey),
      });
    }

    if (kind !== "ORIGINAL") {
      return res.status(400).json({ message: "Unknown Speedster upload kind" });
    }
    const extension = contentType ? EXTENSIONS[contentType] : undefined;
    if (!contentType || !extension) {
      return res.status(400).json({ message: "Speedster accepts JPEG, PNG, or WebP images" });
    }
    const checksumSha256 = String(requestedChecksumSha256 ?? "").trim().toLowerCase();
    if (!SHA256.test(checksumSha256)
      || !Number.isSafeInteger(requestedByteSize)
      || (requestedByteSize ?? 0) < 1
      || (requestedByteSize ?? 0) > AI_GRADER_STORAGE_MAX_OBJECT_BYTES) {
      return res.status(400).json({ message: "Speedster upload requires exact byte size and SHA-256" });
    }

    if (targetedRecapture !== undefined && targetedRecapture !== true) {
      return res.status(400).json({ message: "Invalid Speedster targeted recapture flag" });
    }
    const storageKey = targetedRecapture
      ? speedsterRecaptureOriginalStorageKey(admin.user.id, sessionId, side, deps.randomUuid(), extension as "jpg" | "png" | "webp")
      : speedsterContentAddressedOriginalStorageKey(
          admin.user.id,
          sessionId,
          side,
          checksumSha256,
          extension as "jpg" | "png" | "webp",
        );
    return res.status(200).json({
      storageKey,
      uploadUrl: await deps.presignUpload(storageKey, contentType, checksumSha256),
      uploadMethod: "PUT",
      uploadHeaders: {
        "Content-Type": contentType,
        "x-amz-acl": "private",
        "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
      },
      byteSize: requestedByteSize,
      checksumSha256,
    });
  } catch (error) {
    const mapped = toErrorResponse(error);
    return res.status(mapped.status).json({ message: mapped.message });
  }
  };
}

export default createSpeedsterUploadPlanHandler();
