import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { methodNotAllowed, requireStockerSession, sendError, serializeShift, StockerApiError } from "../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const stocker = await requireStockerSession(req);
    const shiftId = typeof req.body?.shiftId === "string" ? req.body.shiftId : "";
    if (!shiftId) throw new StockerApiError(400, "VALIDATION_ERROR", "shiftId is required");

    const shift = await prisma.stockerShift.findFirst({
      where: { id: shiftId, stockerId: stocker.stockerId, status: "active" },
      include: { stops: true },
    });
    if (!shift || !shift.clockInAt) throw new StockerApiError(404, "SHIFT_NOT_ACTIVE", "Active shift not found");

    const now = new Date();
    const totalTimeMin = Math.max(0, Math.round((now.getTime() - shift.clockInAt.getTime()) / 60000));
    const totalDriveTimeMin = shift.stops.reduce((sum, stop) => sum + (stop.driveTimeMin ?? 0), 0);
    const totalOnSiteTimeMin = shift.stops.reduce((sum, stop) => sum + (stop.onSiteTimeMin ?? 0), 0);
    const totalIdleTimeMin = Math.max(0, totalTimeMin - totalDriveTimeMin - totalOnSiteTimeMin);

    await prisma.$transaction([
      prisma.stockerStop.updateMany({
        where: { shiftId: shift.id, status: { in: ["pending", "in_transit", "arrived", "restocking"] } },
        data: { status: "skipped", skipReason: "Shift ended" },
      }),
      prisma.stockerShift.update({
        where: { id: shift.id },
        data: { status: "completed", clockOutAt: now, totalDriveTimeMin, totalOnSiteTimeMin, totalIdleTimeMin },
      }),
      prisma.stockerPosition.updateMany({
        where: { stockerId: stocker.stockerId },
        data: { status: "idle", shiftId: null, currentLocationName: null },
      }),
    ]);

    const updated = await prisma.stockerShift.findUniqueOrThrow({ where: { id: shift.id } });
    const completedStops = shift.stops.filter((stop) => stop.status === "completed").length;
    const skippedStops = shift.stops.length - completedStops;
    return res.status(200).json({
      success: true,
      data: {
        shift: serializeShift(updated),
        summary: {
          totalTimeMin,
          totalDriveTimeMin,
          totalOnSiteTimeMin,
          totalIdleTimeMin,
          stopsCompleted: completedStops,
          stopsSkipped: skippedStops,
          totalStops: shift.stops.length,
        },
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}
