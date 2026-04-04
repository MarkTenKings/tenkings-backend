import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";

const payloadSchema = z.object({
  sessionId: z.string().min(1),
  checkpointId: z.string().min(1),
  checkpointsReached: z.number().int().min(0),
  tkdReward: z.number().int().min(0),
  tkdEarned: z.number().int().min(0),
  journeyCompletedAt: z.string().datetime().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const payload = payloadSchema.parse(req.body ?? {});

    const session = await prisma.navigationSession.update({
      where: { id: payload.sessionId },
      data: {
        checkpointsReached: payload.checkpointsReached,
        tkdEarned: payload.tkdEarned,
        journeyCompletedAt: payload.journeyCompletedAt ? new Date(payload.journeyCompletedAt) : undefined,
      },
    });

    return res.status(200).json({
      success: true,
      checkpointId: payload.checkpointId,
      checkpointsReached: session.checkpointsReached,
      tkdEarned: session.tkdEarned,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid checkpoint payload" });
    }

    console.error("kingshunt checkpoint failed", error);
    return res.status(500).json({ message: "Unable to log checkpoint" });
  }
}
