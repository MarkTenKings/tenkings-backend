import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import {
  advanceToNextStop,
  assertStopForStocker,
  methodNotAllowed,
  requireStockerSession,
  sendError,
  serializeStop,
  StockerApiError,
} from "../../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const stocker = await requireStockerSession(req);
    const stopId = String(req.query.stopId ?? "");
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) throw new StockerApiError(400, "VALIDATION_ERROR", "Skip reason is required");

    const stop = await assertStopForStocker(stocker.stockerId, stopId);
    const updated = await prisma.stockerStop.update({
      where: { id: stop.id },
      data: { status: "skipped", skipReason: reason, notes: reason },
      include: { location: true },
    });
    const nextStop = await advanceToNextStop(stop.shiftId, stop.stopOrder, stocker.stockerId);
    return res.status(200).json({
      success: true,
      data: {
        skippedStop: serializeStop(updated),
        nextStop,
        isRouteComplete: !nextStop,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}
