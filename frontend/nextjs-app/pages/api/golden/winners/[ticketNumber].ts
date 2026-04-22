import type { NextApiRequest, NextApiResponse } from "next";
import { getGoldenTicketWinnerByTicketNumber, toGoldenTicketError } from "../../../../lib/server/goldenClaim";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const rawTicketNumber = Array.isArray(req.query.ticketNumber) ? req.query.ticketNumber[0] : req.query.ticketNumber;
  const ticketNumber = Number.parseInt(rawTicketNumber ?? "", 10);
  if (!Number.isFinite(ticketNumber) || ticketNumber <= 0) {
    return res.status(400).json({ message: "ticketNumber must be a positive integer" });
  }

  try {
    const winner = await getGoldenTicketWinnerByTicketNumber(ticketNumber);
    if (!winner) {
      return res.status(404).json({ message: "Winner profile not found" });
    }
    return res.status(200).json({ winner });
  } catch (error) {
    const result = toGoldenTicketError(error);
    return res.status(result.status).json({ message: result.message });
  }
}
