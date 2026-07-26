import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession } from "../../../../../lib/server/admin";
import {
  assignLiveRipAndSend,
  assignLiveRipSchema,
  toLiveRipClaimError,
} from "../../../../../lib/server/liveRipClaim";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const clipId = Array.isArray(req.query.clipId) ? req.query.clipId[0] : req.query.clipId;
  if (!clipId) {
    return res.status(400).json({ success: false, message: "Live Rip video id is required" });
  }

  try {
    const admin = await requireAdminSession(req);
    const payload = assignLiveRipSchema.parse(req.body ?? {});
    const assignment = await assignLiveRipAndSend({
      liveRipId: clipId,
      name: payload.name,
      phone: payload.phone,
      assignedByUserId: admin.user.id,
    });

    return res.status(200).json({
      success: true,
      message: "Live Rip assigned and claim text sent",
      assignment,
    });
  } catch (error) {
    const result = toLiveRipClaimError(error);
    return res.status(result.status).json({ success: false, message: result.message });
  }
}
