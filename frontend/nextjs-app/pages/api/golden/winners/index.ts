import type { NextApiRequest, NextApiResponse } from "next";
import { listGoldenTicketWinners, toGoldenTicketError } from "../../../../lib/server/goldenClaim";

function parsePositiveInt(value: string | string[] | undefined, fallback: number) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const page = parsePositiveInt(req.query.page, 1);
  const limit = parsePositiveInt(req.query.limit, 12);
  const sort = req.query.sort === "recent" ? "recent" : "featured";

  try {
    const result = await listGoldenTicketWinners({ page, limit, order: sort });
    return res.status(200).json(result);
  } catch (error) {
    const result = toGoldenTicketError(error);
    return res.status(result.status).json({ message: result.message });
  }
}
