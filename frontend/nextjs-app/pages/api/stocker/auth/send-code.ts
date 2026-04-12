import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { methodNotAllowed, normalizePhoneInput, proxyAuthService, sendError, StockerApiError } from "../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const phone = normalizePhoneInput(req.body?.phone);
    if (!phone) throw new StockerApiError(400, "VALIDATION_ERROR", "Phone number is required");

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { stockerProfile: true },
    });
    if (!user || user.role !== "stocker" || !user.stockerProfile?.isActive) {
      throw new StockerApiError(404, "USER_NOT_FOUND", "No active stocker exists for that phone number");
    }

    await proxyAuthService("send-code", { phone });
    return res.status(200).json({ success: true, data: { codeSent: true } });
  } catch (error) {
    return sendError(res, error);
  }
}
