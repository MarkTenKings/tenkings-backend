import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import type { KioskSessionStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { hasKioskControl } from "../../../../lib/server/kioskAuth";
import { kioskSessionInclude, serializeKioskSession } from "../../../../lib/server/kioskSession";

const stageSchema = z.object({
  stage: z.enum(["COUNTDOWN", "LIVE", "REVEAL", "COMPLETE", "CANCELLED"]),
});

const transitionMap: Record<string, string[]> = {
  COUNTDOWN: ["LIVE", "CANCELLED"],
  LIVE: ["REVEAL", "COMPLETE", "CANCELLED", "COUNTDOWN"],
  REVEAL: ["COMPLETE", "CANCELLED", "COUNTDOWN"],
  COMPLETE: ["COUNTDOWN"],
  CANCELLED: ["COUNTDOWN"],
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { sessionId } = req.query;
  if (typeof sessionId !== "string") {
    return res.status(400).json({ message: "sessionId is required" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await prisma.kioskSession.findUnique({
    where: { id: sessionId },
    include: kioskSessionInclude,
  });

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (!hasKioskControl(req, session.controlTokenHash)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const payload = stageSchema.parse(req.body ?? {});
    const allowedTargets = transitionMap[session.status] ?? [];
    if (!allowedTargets.includes(payload.stage)) {
      return res.status(400).json({ message: `Cannot transition from ${session.status} to ${payload.stage}` });
    }

    const now = new Date();

    const updateData: Prisma.KioskSessionUpdateInput = {
      status: payload.stage as KioskSessionStatus,
    };

    if (payload.stage === "LIVE") {
      updateData.liveStartedAt = now;
    }
    if (payload.stage === "COMPLETE" || payload.stage === "CANCELLED") {
      updateData.completedAt = now;
    }
    if (payload.stage === "COUNTDOWN") {
      updateData.countdownStartedAt = now;
      updateData.liveStartedAt = null;
      updateData.completedAt = null;
    }

    const updated = await prisma.kioskSession.update({
      where: { id: sessionId },
      data: updateData,
      include: kioskSessionInclude,
    });

    return res.status(200).json({ session: serializeKioskSession(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    console.error("kiosk stage error", error);
    return res.status(500).json({ message: "Failed to update stage" });
  }
}
