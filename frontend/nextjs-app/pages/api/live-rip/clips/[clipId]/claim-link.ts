import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession } from "../../../../../lib/server/admin";
import {
  createLiveRipQrClaim,
  getLiveRipQrClaimStatus,
  toLiveRipClaimError,
} from "../../../../../lib/server/liveRipClaim";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const clipId = Array.isArray(req.query.clipId) ? req.query.clipId[0] : req.query.clipId;
  if (!clipId) {
    return res.status(400).json({ success: false, message: "Live Rip video id is required" });
  }

  try {
    const admin = await requireAdminSession(req);

    if (req.method === "GET") {
      const claim = await getLiveRipQrClaimStatus(clipId);
      return res.status(200).json({ success: true, claim });
    }

    const claim = await createLiveRipQrClaim({
      liveRipId: clipId,
      assignedByUserId: admin.user.id,
    });
    return res.status(201).json({
      success: true,
      message: "Customer claim QR is ready",
      claim,
    });
  } catch (error) {
    const result = toLiveRipClaimError(error);
    return res.status(result.status).json({ success: false, message: result.message });
  }
}
