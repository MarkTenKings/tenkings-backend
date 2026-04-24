import type { NextApiRequest, NextApiResponse } from "next";
import { getGoldenLiveSnapshot } from "../../../lib/server/goldenLive";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const snapshot = await getGoldenLiveSnapshot();
    return res.status(200).json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load live snapshot";
    return res.status(500).json({ message });
  }
}
