import type { NextApiRequest, NextApiResponse } from "next";
import { getGoldenTicketHallStats, toGoldenTicketError } from "../../../lib/server/goldenClaim";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const stats = await getGoldenTicketHallStats();
    return res.status(200).json(stats);
  } catch (error) {
    const result = toGoldenTicketError(error);
    return res.status(result.status).json({ message: result.message });
  }
}
