import type { NextApiRequest, NextApiResponse } from "next";
import { loadRecentPulls } from "../../lib/server/recentPulls";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;

  try {
    const pulls = await loadRecentPulls(parsedLimit);
    res.status(200).json({ pulls });
  } catch (error) {
    console.error("recent pulls fetch failed", error);
    res.status(500).json({ message: "Failed to load recent pulls" });
  }
}
