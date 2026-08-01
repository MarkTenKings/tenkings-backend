import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { getStorageMode, presignReadUrl, presignUploadUrl } from "../../../../lib/server/storage";

const SESSION_ID = /^[a-f0-9-]{36}$/i;
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
    const { sessionId, side, contentType } = req.body as {
      sessionId?: string;
      side?: string;
      contentType?: string;
    };
    if (!sessionId || !SESSION_ID.test(sessionId)) {
      return res.status(400).json({ message: "Invalid Speedster session ID" });
    }
    if (side !== "FRONT" && side !== "BACK") {
      return res.status(400).json({ message: "Card side must be FRONT or BACK" });
    }
    const extension = contentType ? EXTENSIONS[contentType] : undefined;
    if (!contentType || !extension) {
      return res.status(400).json({ message: "Speedster accepts JPEG, PNG, or WebP images" });
    }
    if (getStorageMode() !== "s3") {
      throw new Error("Speedster original uploads require configured object storage");
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
