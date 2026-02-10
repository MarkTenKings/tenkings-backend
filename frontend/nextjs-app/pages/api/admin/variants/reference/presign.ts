import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import {
  getStorageMode,
  presignUploadUrl,
  publicUrlFor,
  writeLocalFile,
} from "../../../../../lib/server/storage";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { withAdminCors } from "../../../../../lib/server/cors";

export const config = {
  api: {
    bodyParser: true,
    sizeLimit: "1mb",
  },
};

type ResponseBody =
  | {
      uploadUrl: string;
      storageKey: string;
      publicUrl: string;
      mode: string;
    }
  | { message: string };

function sanitizeFileName(input: string) {
  const normalized = input.trim().toLowerCase();
  const base = normalized.replace(/[^a-z0-9_.-]+/g, "-");
  const collapsed = base.replace(/-+/g, "-");
  return collapsed.replace(/^-|-$/g, "") || "reference";
}

export default withAdminCors(async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>
) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const { setId, parallelId, fileName, contentType } = req.body ?? {};
    if (!setId || !parallelId || !fileName) {
      return res.status(400).json({ message: "Missing setId, parallelId, or fileName." });
    }

    const safeName = sanitizeFileName(String(fileName));
    const keySuffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const storageKey = `variants/${String(setId).trim()}/${String(parallelId).trim()}/${keySuffix}`;
    const mode = getStorageMode();
    const publicUrl = publicUrlFor(storageKey);

    if (mode === "s3") {
      const uploadUrl = await presignUploadUrl(storageKey, contentType || "application/octet-stream");
      return res.status(200).json({ uploadUrl, storageKey, publicUrl, mode });
    }

    const uploadUrl = `/api/admin/variants/reference/file?storageKey=${encodeURIComponent(storageKey)}`;
    return res.status(200).json({ uploadUrl, storageKey, publicUrl, mode });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
});
