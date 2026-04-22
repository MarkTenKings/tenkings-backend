import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeQrInput } from "../../../../lib/qrInput";
import {
  finalizeGoldenTicketClaim,
  goldenTicketClaimSchema,
  toGoldenTicketError,
} from "../../../../lib/server/goldenClaim";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const rawCode = Array.isArray(req.query.code) ? req.query.code[0] : req.query.code;
  const code = normalizeQrInput(rawCode);
  if (!code) {
    return res.status(400).json({ message: "Golden ticket code is required" });
  }

  try {
    const payload = goldenTicketClaimSchema.parse(req.body ?? {});
    const result = await finalizeGoldenTicketClaim(req, code, payload);
    return res.status(200).json(result);
  } catch (error) {
    const result = toGoldenTicketError(error);
    return res.status(result.status).json({ message: result.message });
  }
}
