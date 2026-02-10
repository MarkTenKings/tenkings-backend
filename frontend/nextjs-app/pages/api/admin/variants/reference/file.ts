import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { getStorageMode, publicUrlFor, writeLocalFile } from "../../../../../lib/server/storage";
import { MAX_UPLOAD_BYTES } from "../../../../../lib/server/uploads";
import { withAdminCors } from "../../../../../lib/server/cors";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "25mb",
  },
};

type ResponseBody = { message: string; publicUrl?: string };

const handler: NextApiHandler<ResponseBody> = async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>
) {
  if (req.method !== "PUT") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const { storageKey } = req.query;
    if (typeof storageKey !== "string" || !storageKey.trim()) {
      return res.status(400).json({ message: "storageKey query param is required" });
    }

    const mode = getStorageMode();
    if (mode === "s3") {
      return res.status(400).json({ message: "Direct uploads are only supported in local or mock storage modes" });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    if (buffer.length === 0) {
      return res.status(400).json({ message: "Upload payload was empty" });
    }

    if (buffer.length > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ message: "Uploaded file exceeds limit" });
    }

    await writeLocalFile(storageKey, buffer);

    return res.status(200).json({ message: "File stored", publicUrl: publicUrlFor(storageKey) });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
};

export default withAdminCors(handler);
