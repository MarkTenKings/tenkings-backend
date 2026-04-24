import type { NextApiRequest, NextApiResponse } from "next";
import { getLiveState } from "../../../lib/server/liveRip";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const state = await getLiveState();
    return res.status(200).json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load live state";
    return res.status(500).json({ message });
  }
}
