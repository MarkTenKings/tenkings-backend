import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import {
  assertStopForStocker,
  getWalkingGuidance,
  methodNotAllowed,
  requireStockerSession,
  sendError,
  serializeLocation,
  serializeStop,
  StockerApiError,
} from "../../../../../lib/server/stocker";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const stocker = await requireStockerSession(req);
    const stopId = String(req.query.stopId ?? "");
    const latitude = finiteNumber(req.body?.latitude);
    const longitude = finiteNumber(req.body?.longitude);
    if (!stopId || latitude == null || longitude == null) {
      throw new StockerApiError(400, "VALIDATION_ERROR", "stopId, latitude, and longitude are required");
    }

    const stop = await assertStopForStocker(stocker.stockerId, stopId);
    const departure = stop.departedPreviousAt ?? stop.shift.clockInAt ?? new Date();
    const driveTimeMin = Math.max(0, Math.round((Date.now() - departure.getTime()) / 60000));

    const updated = await prisma.stockerStop.update({
      where: { id: stop.id },
      data: {
        status: stop.status === "restocking" ? "restocking" : "arrived",
        arrivedAt: stop.arrivedAt ?? new Date(),
        driveTimeMin: stop.driveTimeMin ?? driveTimeMin,
      },
      include: { location: true },
    });
    await prisma.stockerPosition.updateMany({
      where: { stockerId: stocker.stockerId },
      data: { status: "at_location", currentLocationName: stop.location.name },
    });

    const guidance = await getWalkingGuidance({ lat: latitude, lng: longitude }, serializeLocation(updated.location));
    return res.status(200).json({ success: true, data: { stop: serializeStop(updated), guidance } });
  } catch (error) {
    return sendError(res, error);
  }
}
