import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import type { KioskSessionStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { kioskSessionInclude, serializeKioskSession } from "../../../../../lib/server/kioskSession";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

const stageSchema = z.object({
  stage: z.enum(["COUNTDOWN", "LIVE", "REVEAL", "COMPLETE", "CANCELLED"]),
});
const DEFAULT_REVEAL_SECONDS = Number(process.env.KIOSK_REVEAL_SECONDS ?? 10);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { sessionId } = req.query;
  if (typeof sessionId !== "string") {
    return res.status(400).json({ message: "sessionId is required" });
  }

  try {
    await requireAdminSession(req);

    const payload = stageSchema.parse(req.body ?? {});
    const existing = await prisma.kioskSession.findUnique({
      where: { id: sessionId },
      include: kioskSessionInclude,
    });

    if (!existing) {
      return res.status(404).json({ message: "Session not found" });
    }

    const now = new Date();
    const updateData: Prisma.KioskSessionUpdateInput = {
      status: payload.stage as KioskSessionStatus,
    };

    switch (payload.stage) {
      case "COUNTDOWN":
        updateData.countdownStartedAt = now;
        updateData.liveStartedAt = null;
        updateData.completedAt = null;
        break;
      case "LIVE":
        updateData.liveStartedAt = now;
        updateData.completedAt = null;
        break;
      case "REVEAL":
        updateData.revealStartedAt = now;
        updateData.revealSeconds = existing.revealSeconds ?? DEFAULT_REVEAL_SECONDS;
        if (!existing.liveStartedAt) {
          updateData.liveStartedAt = now;
        }
        updateData.completedAt = null;
        break;
      case "COMPLETE":
      case "CANCELLED":
        updateData.completedAt = now;
        if (!existing.liveStartedAt) {
          updateData.liveStartedAt = now;
        }
        break;
      default:
        break;
    }

    const updated = await prisma.kioskSession.update({
      where: { id: sessionId },
      data: updateData,
      include: kioskSessionInclude,
    });

    return res.status(200).json({ session: serializeKioskSession(updated) });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
