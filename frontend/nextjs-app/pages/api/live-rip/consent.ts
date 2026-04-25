import type { NextApiRequest, NextApiResponse } from "next";
import {
  LIVE_RIP_CONSENT_TEXT,
  LIVE_RIP_CONSENT_TEXT_VERSION,
} from "../../../lib/server/liveRip";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  return res.status(200).json({
    consentText: LIVE_RIP_CONSENT_TEXT,
    consentTextVersion: LIVE_RIP_CONSENT_TEXT_VERSION,
  });
}
