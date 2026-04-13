import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import {
  loadCurrentShift,
  methodNotAllowed,
  newId,
  requireStockerSession,
  sendError,
  StockerApiError,
} from "../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const stocker = await requireStockerSession(req);
    const shiftId = typeof req.body?.shiftId === "string" ? req.body.shiftId : "";
    if (!shiftId) throw new StockerApiError(400, "VALIDATION_ERROR", "shiftId is required");

    const shift = await prisma.stockerShift.findFirst({
      where: { id: shiftId, stockerId: stocker.stockerId },
      include: { stops: { orderBy: { stopOrder: "asc" } } },
    });
    if (!shift) throw new StockerApiError(404, "SHIFT_NOT_FOUND", "Shift not found");
    if (shift.status !== "pending") throw new StockerApiError(400, "SHIFT_NOT_PENDING", "Shift is not pending");

    const now = new Date();
    await prisma.$transaction([
      prisma.stockerShift.update({ where: { id: shift.id }, data: { status: "active", clockInAt: now } }),
      ...(shift.stops[0]
        ? [
            prisma.stockerStop.update({
              where: { id: shift.stops[0].id },
              data: { status: "in_transit", departedPreviousAt: now },
            }),
          ]
        : []),
      prisma.stockerPosition.upsert({
        where: { stockerId: stocker.stockerId },
        create: {
          id: newId(),
          stockerId: stocker.stockerId,
          latitude: 0,
          longitude: 0,
          shiftId: shift.id,
          status: "driving",
        },
        update: { shiftId: shift.id, status: "driving", currentLocationName: null },
      }),
    ]);

    const current = await loadCurrentShift(stocker.stockerId, shift.assignedDate, shift.id);
    return res.status(200).json({ success: true, data: { shift: current, stops: current?.stops ?? [] } });
  } catch (error) {
    return sendError(res, error);
  }
}
