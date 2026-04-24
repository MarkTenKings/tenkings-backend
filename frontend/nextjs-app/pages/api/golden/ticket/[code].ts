import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeQrInput } from "../../../../lib/qrInput";
import {
  getGoldenTicketLookupRecord,
  resolveOptionalGoldenTicketViewer,
  toGoldenTicketError,
} from "../../../../lib/server/goldenClaim";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const rawCode = Array.isArray(req.query.code) ? req.query.code[0] : req.query.code;
  const code = normalizeQrInput(rawCode);
  if (!code) {
    return res.status(400).json({ message: "Golden ticket code is required" });
  }

  try {
    const [ticket, viewer] = await Promise.all([
      getGoldenTicketLookupRecord(code),
      resolveOptionalGoldenTicketViewer(req),
    ]);

    if (!ticket) {
      return res.status(404).json({ message: "Golden ticket not found" });
    }

    return res.status(200).json({ ticket, viewer });
  } catch (error) {
    const result = toGoldenTicketError(error);
    return res.status(result.status).json({ message: result.message });
  }
}
