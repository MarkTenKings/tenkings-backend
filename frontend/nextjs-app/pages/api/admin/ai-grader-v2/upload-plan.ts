import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { getStorageMode, presignReadUrl, presignUploadUrl } from "../../../../lib/server/storage";

const SESSION_ID = /^[a-z0-9-]{20,40}$/i;
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { sessionId, side, kind, contentType } = req.body as {
      sessionId?: string;
      side?: string;
      kind?: string;
      contentType?: string;
    };
    if (!sessionId || !SESSION_ID.test(sessionId)) {
      return res.status(400).json({ message: "Invalid Speedster session ID" });
    }
    const session = await prisma.aiGraderV2Session.findFirst({
      where: { id: sessionId, createdByUserId: admin.user.id },
      select: { id: true },
    });
    if (!session) return res.status(404).json({ message: "Speedster session not found" });
    if (side !== "FRONT" && side !== "BACK") {
      return res.status(400).json({ message: "Card side must be FRONT or BACK" });
    }
    if (getStorageMode() !== "s3") {
      throw new Error("Speedster uploads require configured object storage");
    }

    if (kind === "PREPARED") {
      const artifacts = ["RECTIFIED", "NORMALIZED", "MICRO_DEFECT", "DIRECTIONAL"] as const;
      const entries = await Promise.all(artifacts.map(async (artifact) => {
        const fileName = `${artifact.toLowerCase()}.webp`;
        const storageKey = `ai-grader-v2/${admin.user.id}/${sessionId}/prepared/${side.toLowerCase()}/${fileName}`;
        return [artifact, {
          storageKey,
          uploadUrl: await presignUploadUrl(storageKey, "image/webp"),
          readUrl: await presignReadUrl(storageKey),
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

    const storageKey = `ai-grader-v2/${admin.user.id}/${sessionId}/original/${side.toLowerCase()}.${extension}`;
    return res.status(200).json({
      storageKey,
      uploadUrl: await presignUploadUrl(storageKey, contentType),
      readUrl: await presignReadUrl(storageKey),
    });
  } catch (error) {
    const mapped = toErrorResponse(error);
    return res.status(mapped.status).json({ message: mapped.message });
  }
}
