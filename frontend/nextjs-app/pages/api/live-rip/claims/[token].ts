import type { NextApiRequest, NextApiResponse } from "next";
import {
  claimLiveRipForUser,
  toLiveRipClaimError,
} from "../../../../lib/server/liveRipClaim";
import { requireUserSession } from "../../../../lib/server/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const token = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;
  if (!token) {
    return res.status(400).json({ success: false, message: "Claim token is required" });
  }

  try {
    const session = await requireUserSession(req);
    const claim = await claimLiveRipForUser({
      token,
      userId: session.user.id,
      userPhone: session.user.phone,
    });

    return res.status(200).json({
      success: true,
      message: "Live Rip claimed",
      claim,
    });
  } catch (error) {
    const result = toLiveRipClaimError(error);
    return res.status(result.status).json({ success: false, message: result.message });
  }
}
