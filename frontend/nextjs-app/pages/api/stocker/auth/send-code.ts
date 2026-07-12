import type { NextApiRequest, NextApiResponse } from "next";
import {
  findStockerAccessUser,
  hasStockerPortalAccess,
  methodNotAllowed,
  normalizePhoneInput,
  proxyAuthService,
  sendError,
  StockerApiError,
} from "../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const phone = normalizePhoneInput(req.body?.phone);
    if (!phone) throw new StockerApiError(400, "VALIDATION_ERROR", "Phone number is required");
    const turnstileToken = typeof req.body?.turnstileToken === "string" ? req.body.turnstileToken.trim() : "";
    if (!turnstileToken || turnstileToken.length > 2_048) {
      throw new StockerApiError(400, "VALIDATION_ERROR", "Human verification is required");
    }

    const user = await findStockerAccessUser({ phone });
    if (!user || !hasStockerPortalAccess(user)) {
      throw new StockerApiError(404, "USER_NOT_FOUND", "No active stocker exists for that phone number");
    }

    await proxyAuthService("send-code", { phone, turnstileToken });
    return res.status(200).json({ success: true, data: { codeSent: true } });
  } catch (error) {
    return sendError(res, error);
  }
}
