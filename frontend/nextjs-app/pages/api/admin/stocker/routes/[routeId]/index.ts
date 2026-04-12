import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { methodNotAllowed, serializeRoute, StockerApiError } from "../../../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PUT" && req.method !== "DELETE") return methodNotAllowed(res, ["PUT", "DELETE"]);

  try {
    await requireAdminSession(req);
    const routeId = String(req.query.routeId ?? "");
    const route = await prisma.stockRoute.findUnique({ where: { id: routeId }, include: { shifts: true } });
    if (!route) throw new StockerApiError(404, "ROUTE_NOT_FOUND", "Route not found");

    if (req.method === "DELETE") {
      if (route.shifts.some((shift) => shift.status === "pending" || shift.status === "active")) {
        throw new StockerApiError(409, "HAS_ACTIVE_SHIFTS", "Route has active or pending shifts");
      }
      await prisma.stockRoute.delete({ where: { id: route.id } });
      return res.status(200).json({ success: true, data: { deleted: true } });
    }

    const updated = await prisma.stockRoute.update({
      where: { id: route.id },
      data: {
        ...(typeof req.body?.name === "string" && req.body.name.trim() ? { name: req.body.name.trim() } : {}),
        ...(typeof req.body?.description === "string" ? { description: req.body.description.trim() || null } : {}),
        ...(typeof req.body?.isTemplate === "boolean" ? { isTemplate: req.body.isTemplate } : {}),
      },
    });
    return res.status(200).json({ success: true, data: serializeRoute(updated) });
  } catch (error) {
    if (error instanceof StockerApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
    const response = toErrorResponse(error);
    return res.status(response.status).json({ success: false, message: response.message });
  }
}
