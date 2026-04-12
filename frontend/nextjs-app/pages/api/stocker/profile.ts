import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { methodNotAllowed, requireStockerSession, sendError, serializeProfile, StockerApiError } from "../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "PUT") return methodNotAllowed(res, ["GET", "PUT"]);

  try {
    const stocker = await requireStockerSession(req);
    if (req.method === "PUT") {
      const language = req.body?.language;
      if (language !== undefined && language !== "en" && language !== "es") {
        throw new StockerApiError(400, "VALIDATION_ERROR", "language must be en or es");
      }
      const profile = await prisma.stockerProfile.update({
        where: { id: stocker.stockerId },
        data: language ? { language } : {},
      });
      return res.status(200).json({ success: true, data: serializeProfile(profile) });
    }

    const profile = await prisma.stockerProfile.findUniqueOrThrow({ where: { id: stocker.stockerId } });
    return res.status(200).json({ success: true, data: serializeProfile(profile) });
  } catch (error) {
    return sendError(res, error);
  }
}
