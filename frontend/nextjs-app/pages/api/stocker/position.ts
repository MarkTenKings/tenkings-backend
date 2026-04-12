import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import {
  methodNotAllowed,
  newId,
  requireStockerSession,
  runPositionGeofenceChecks,
  sendError,
  StockerApiError,
} from "../../../lib/server/stocker";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const stocker = await requireStockerSession(req);
    const latitude = finiteNumber(req.body?.latitude);
    const longitude = finiteNumber(req.body?.longitude);
    const shiftId = typeof req.body?.shiftId === "string" ? req.body.shiftId : "";
    if (latitude == null || longitude == null || !shiftId) {
      throw new StockerApiError(400, "INVALID_COORDINATES", "latitude, longitude, and shiftId are required");
    }

    const shift = await prisma.stockerShift.findFirst({
      where: { id: shiftId, stockerId: stocker.stockerId, status: "active" },
    });
    if (!shift) throw new StockerApiError(403, "SHIFT_NOT_ACTIVE", "Position does not match an active shift");

    const geofence = await runPositionGeofenceChecks({ stockerId: stocker.stockerId, shiftId, latitude, longitude });
    const speed = finiteNumber(req.body?.speed);
    const heading = finiteNumber(req.body?.heading);
    const accuracy = finiteNumber(req.body?.accuracy);
    const timestamp = typeof req.body?.timestamp === "number" ? new Date(req.body.timestamp) : new Date();

    await prisma.$transaction([
      prisma.stockerPosition.upsert({
        where: { stockerId: stocker.stockerId },
        create: {
          id: newId(),
          stockerId: stocker.stockerId,
          latitude,
          longitude,
          speed,
          heading,
          accuracy,
          shiftId,
          status: geofence.status,
          currentLocationName: geofence.currentLocationName,
        },
        update: {
          latitude,
          longitude,
          speed,
          heading,
          accuracy,
          shiftId,
          status: geofence.status,
          currentLocationName: geofence.currentLocationName,
        },
      }),
      prisma.positionLog.create({
        data: {
          id: newId(),
          stockerId: stocker.stockerId,
          shiftId,
          latitude,
          longitude,
          speed,
          heading,
          accuracy,
          timestamp,
        },
      }),
    ]);

    return res.status(200).json({ success: true, data: { recorded: true, geofence: geofence.events } });
  } catch (error) {
    return sendError(res, error);
  }
}
