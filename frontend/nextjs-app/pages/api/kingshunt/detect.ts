import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { detectKingsHuntLocation } from "../../../lib/server/kingsHunt";

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
    const result = await detectKingsHuntLocation(payload.lat, payload.lng);

    return res.status(200).json({
      location: result.location
        ? {
            slug: result.location.slug,
            name: result.location.name,
          }
        : null,
      distance: result.distanceM,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "lat and lng required" });
    }

    console.error("kingshunt detect failed", error);
    return res.status(500).json({ message: "Unable to detect venue" });
  }
}
