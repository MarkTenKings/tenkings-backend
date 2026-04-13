import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { methodNotAllowed, newId, parseDateOnly, serializeShift, StockerApiError } from "../../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);

  try {
    await requireAdminSession(req);

    if (req.method === "POST") {
      const stockerId = typeof req.body?.stockerId === "string" ? req.body.stockerId : "";
      const routeId = typeof req.body?.routeId === "string" ? req.body.routeId : "";
      const assignedDate = parseDateOnly(typeof req.body?.assignedDate === "string" ? req.body.assignedDate : undefined);
      if (!stockerId || !routeId) throw new StockerApiError(400, "VALIDATION_ERROR", "stockerId and routeId are required");

      const [stocker, route] = await Promise.all([
        prisma.stockerProfile.findUnique({ where: { id: stockerId } }),
        prisma.stockRoute.findUnique({ where: { id: routeId } }),
      ]);
      if (!stocker?.isActive) throw new StockerApiError(404, "STOCKER_NOT_FOUND", "Active stocker not found");
      if (!route) throw new StockerApiError(404, "ROUTE_NOT_FOUND", "Route not found");

      const shift = await prisma.$transaction(async (tx) => {
        const created = await tx.stockerShift.create({
          data: { id: newId(), stockerId, routeId, assignedDate, status: "pending" },
        });
        await tx.stockerStop.createMany({
          data: route.locationIds.map((locationId, index) => ({
            id: newId(),
            shiftId: created.id,
            locationId,
            stopOrder: index,
            status: "pending",
          })),
        });
        return tx.stockerShift.findUniqueOrThrow({
          where: { id: created.id },
          include: { stocker: true, route: true, stops: { include: { location: true }, orderBy: { stopOrder: "asc" } } },
        });
      });
      return res.status(201).json({ success: true, data: serializeShift(shift) });
    }

    const where: Prisma.StockerShiftWhereInput = {
      ...(typeof req.query.stockerId === "string" && req.query.stockerId ? { stockerId: req.query.stockerId } : {}),
      ...(typeof req.query.status === "string" && req.query.status ? { status: { in: req.query.status.split(",") } } : {}),
      ...(typeof req.query.date === "string" && req.query.date ? { assignedDate: parseDateOnly(req.query.date) } : {}),
    };
    const shifts = await prisma.stockerShift.findMany({
      where,
      include: {
        stocker: true,
        route: true,
        stops: { include: { location: true }, orderBy: { stopOrder: "asc" } },
      },
      orderBy: [{ assignedDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    return res.status(200).json({
      success: true,
      data: shifts.map((shift) => ({
        ...serializeShift(shift),
        stopsCompleted: shift.stops.filter((stop) => stop.status === "completed").length,
        _count: { stops: shift.stops.length },
      })),
    });
  } catch (error) {
    if (error instanceof StockerApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
    const response = toErrorResponse(error);
    return res.status(response.status).json({ success: false, message: response.message });
  }
}
