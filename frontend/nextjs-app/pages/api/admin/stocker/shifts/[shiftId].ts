import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { methodNotAllowed, serializeShift, StockerApiError } from "../../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);

  try {
    await requireAdminSession(req);
    const shiftId = String(req.query.shiftId ?? "");
    const shift = await prisma.stockerShift.findUnique({
      where: { id: shiftId },
      include: { stocker: true, route: true, stops: { include: { location: true }, orderBy: { stopOrder: "asc" } } },
    });
    if (!shift) throw new StockerApiError(404, "SHIFT_NOT_FOUND", "Shift not found");

    const data: Prisma.StockerShiftUncheckedUpdateInput = {};

    if (req.body?.status !== undefined) {
      if (req.body.status !== "cancelled") {
        throw new StockerApiError(400, "INVALID_STATUS_TRANSITION", "Only pending shifts can be cancelled here");
      }
      if (shift.status !== "pending") {
        throw new StockerApiError(409, "SHIFT_NOT_PENDING", "Only pending shifts can be cancelled");
      }
      data.status = "cancelled";
    }

    if (req.body?.stockerId !== undefined) {
      const stockerId = typeof req.body.stockerId === "string" ? req.body.stockerId : "";
      if (!stockerId) throw new StockerApiError(400, "VALIDATION_ERROR", "stockerId is required");
      if (shift.status !== "pending") {
        throw new StockerApiError(409, "SHIFT_NOT_PENDING", "Only pending shifts can be reassigned");
      }
      const stocker = await prisma.stockerProfile.findUnique({ where: { id: stockerId } });
      if (!stocker?.isActive) throw new StockerApiError(404, "STOCKER_NOT_FOUND", "Active stocker not found");
      data.stockerId = stockerId;
    }

    if (Object.keys(data).length === 0) {
      throw new StockerApiError(400, "VALIDATION_ERROR", "No shift update was provided");
    }

    const updated = await prisma.stockerShift.update({
      where: { id: shift.id },
      data,
      include: { stocker: true, route: true, stops: { include: { location: true }, orderBy: { stopOrder: "asc" } } },
    });

    return res.status(200).json({
      success: true,
      data: {
        ...serializeShift(updated),
        stopsCompleted: updated.stops.filter((stop) => stop.status === "completed").length,
        _count: { stops: updated.stops.length },
      },
    });
  } catch (error) {
    if (error instanceof StockerApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
    const response = toErrorResponse(error);
    return res.status(response.status).json({ success: false, message: response.message });
  }
}
