import { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../lib/server/admin";
import { getLocalRoot, getPublicPrefix, getStorageMode } from "../../../lib/server/storage";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);

    if (req.method !== "GET") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const mode = getStorageMode();

    return res.status(200).json({
      mode,
      publicPrefix: getPublicPrefix(),
      localRoot: mode === "local" ? getLocalRoot() : undefined,
      s3: {
        bucket: process.env.CARD_STORAGE_BUCKET ?? null,
        region: process.env.CARD_STORAGE_REGION ?? null,
        endpoint: process.env.CARD_STORAGE_ENDPOINT ?? null,
        publicBaseUrl: process.env.CARD_STORAGE_PUBLIC_BASE_URL ?? null,
        forcePathStyle: process.env.CARD_STORAGE_FORCE_PATH_STYLE ?? null,
        acl: process.env.CARD_STORAGE_ACL ?? null,
        hasAccessKey: Boolean(process.env.CARD_STORAGE_ACCESS_KEY_ID),
        hasSecret: Boolean(process.env.CARD_STORAGE_SECRET_ACCESS_KEY),
      },
    });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
