import type { NextApiRequest, NextApiResponse } from "next";
import { getKingsHuntLocationBySlug } from "../../../lib/server/kingsHunt";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const slug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  if (!slug) {
    return res.status(400).json({ message: "Location slug is required" });
  }

  try {
    const location = await getKingsHuntLocationBySlug(slug);
    if (!location) {
      return res.status(404).json({ message: "Location not found" });
    }

    return res.status(200).json({ location });
  } catch (error) {
    console.error("kingshunt location lookup failed", error);
    return res.status(500).json({ message: "Unable to load Kings Hunt location" });
  }
}
