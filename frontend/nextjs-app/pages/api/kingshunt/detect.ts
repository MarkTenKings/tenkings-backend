import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { detectKingsHuntLocations } from "../../../lib/server/kingsHunt";

const payloadSchema = z.object({
  lat: z.number().finite(),
  lng: z.number().finite(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const payload = payloadSchema.parse(req.body ?? {});
    const result = await detectKingsHuntLocations(payload.lat, payload.lng);

    return res.status(200).json({
      location: result.nearest,
      detected: result.detected,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "lat and lng are required" });
    }

    console.error("kingshunt detect failed", error);
    return res.status(500).json({ message: "Unable to detect nearby Kings Hunt venue" });
  }
}
