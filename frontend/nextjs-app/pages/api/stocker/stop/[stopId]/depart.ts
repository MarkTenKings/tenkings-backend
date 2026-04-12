import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import {
  advanceToNextStop,
  assertStopForStocker,
  methodNotAllowed,
  requireStockerSession,
  sendError,
  serializeStop,
} from "../../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const stocker = await requireStockerSession(req);
    const stopId = String(req.query.stopId ?? "");
    const stop = await assertStopForStocker(stocker.stockerId, stopId);
    const now = new Date();
    const arrivedAt = stop.arrivedAt ?? now;
    const onSiteTimeMin = Math.max(0, Math.round((now.getTime() - arrivedAt.getTime()) / 60000));

    const updated = await prisma.stockerStop.update({
      where: { id: stop.id },
      data: {
        status: "completed",
        taskCompletedAt: stop.taskCompletedAt ?? now,
        departedAt: now,
        onSiteTimeMin,
      },
      include: { location: true },
    });
    const nextStop = await advanceToNextStop(stop.shiftId, stop.stopOrder, stocker.stockerId);
    return res.status(200).json({
      success: true,
      data: {
        departedStop: serializeStop(updated),
        nextStop,
        isRouteComplete: !nextStop,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}
