import type { NextApiRequest, NextApiResponse } from "next";
import {
  goldenTicketConsentSchema,
  recordGoldenTicketConsent,
  toGoldenTicketError,
} from "../../../lib/server/goldenClaim";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const payload = goldenTicketConsentSchema.parse(req.body ?? {});
    const result = await recordGoldenTicketConsent(req, payload);
    return res.status(201).json(result);
  } catch (error) {
    const result = toGoldenTicketError(error);
    return res.status(result.status).json({ message: result.message });
  }
}
