import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { methodNotAllowed, serializeShift, StockerApiError } from "../../../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    await requireAdminSession(req);
    const stockerId = String(req.query.stockerId ?? "");
    const shiftId = typeof req.query.shiftId === "string" ? req.query.shiftId : "";
    if (!shiftId) throw new StockerApiError(400, "VALIDATION_ERROR", "shiftId is required");

    const [positions, shift] = await Promise.all([
      prisma.positionLog.findMany({
        where: { stockerId, shiftId },
        orderBy: { timestamp: "asc" },
        take: 5000,
      }),
      prisma.stockerShift.findFirst({
        where: { id: shiftId, stockerId },
        include: {
          route: true,
          stops: { include: { location: true }, orderBy: { stopOrder: "asc" } },
        },
      }),
    ]);
    if (!shift) throw new StockerApiError(404, "SHIFT_NOT_FOUND", "Shift not found");

    return res.status(200).json({
      success: true,
      data: {
        positions: positions.map((position) => ({
          id: position.id,
          stockerId: position.stockerId,
          shiftId: position.shiftId,
          latitude: position.latitude,
          longitude: position.longitude,
          speed: position.speed,
          heading: position.heading,
          accuracy: position.accuracy,
          timestamp: position.timestamp.toISOString(),
        })),
        shift: serializeShift(shift),
      },
    });
  } catch (error) {
    if (error instanceof StockerApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
    const response = toErrorResponse(error);
    return res.status(response.status).json({ success: false, message: response.message });
  }
}
