import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import {
  getDrivingNavigation,
  methodNotAllowed,
  requireStockerSession,
  sendError,
  serializeLocation,
  StockerApiError,
} from "../../../../lib/server/stocker";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const stocker = await requireStockerSession(req);
    if (!stocker.hasStockerProfile) {
      throw new StockerApiError(403, "PROFILE_REQUIRED", "Stocker profile required");
    }

    const latitude = finiteNumber(req.body?.latitude);
    const longitude = finiteNumber(req.body?.longitude);
    const shiftId = typeof req.body?.shiftId === "string" ? req.body.shiftId : "";
    if (latitude == null || longitude == null || !shiftId) {
      throw new StockerApiError(400, "INVALID_COORDINATES", "latitude, longitude, and shiftId are required");
    }

    const shift = await prisma.stockerShift.findFirst({
      where: { id: shiftId, stockerId: stocker.stockerId, status: "active" },
      include: {
        stops: {
          where: { status: { in: ["in_transit", "arrived", "restocking", "pending"] } },
          include: { location: true },
          orderBy: { stopOrder: "asc" },
        },
      },
    });
    if (!shift) throw new StockerApiError(404, "SHIFT_NOT_ACTIVE", "Active shift not found");

    const remainingLocations = shift.stops.map((stop) => serializeLocation(stop.location));
    const navigation = await getDrivingNavigation({ lat: latitude, lng: longitude }, remainingLocations);

    return res.status(200).json({
      success: true,
      data: {
        navigation,
        remainingStopIds: shift.stops.map((stop) => stop.id),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}
