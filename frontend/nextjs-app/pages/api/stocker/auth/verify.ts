import type { NextApiRequest, NextApiResponse } from "next";
import {
  findStockerAccessUser,
  hasStockerPortalAccess,
  methodNotAllowed,
  normalizePhoneInput,
  proxyAuthService,
  sendError,
  serializeProfile,
  StockerApiError,
} from "../../../../lib/server/stocker";

type AuthVerifyPayload = {
  token?: string;
  expiresAt?: string;
  user?: { id?: string; phone?: string | null; displayName?: string | null; avatarUrl?: string | null };
  wallet?: { id?: string; balance?: number };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const phone = normalizePhoneInput(req.body?.phone);
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!phone || !code) throw new StockerApiError(400, "VALIDATION_ERROR", "Phone and code are required");

    const authPayload = (await proxyAuthService("verify", { phone, code })) as AuthVerifyPayload;
    const user = await findStockerAccessUser({
      id: authPayload.user?.id,
      phone,
    });

    if (!user || !hasStockerPortalAccess(user)) {
      throw new StockerApiError(403, "NOT_A_STOCKER", "Access denied. Contact your manager.");
    }

    return res.status(200).json({
      success: true,
      data: {
        token: authPayload.token,
        expiresAt: authPayload.expiresAt,
        user: {
          id: user.id,
          phone: user.phone,
          displayName: user.displayName ?? authPayload.user?.displayName ?? null,
          avatarUrl: authPayload.user?.avatarUrl ?? null,
        },
        wallet: authPayload.wallet,
        profile: user.stockerProfile ? serializeProfile(user.stockerProfile) : null,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}
