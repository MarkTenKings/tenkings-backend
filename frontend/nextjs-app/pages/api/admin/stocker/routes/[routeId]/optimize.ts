import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { getRouteLocations, methodNotAllowed, optimizeRouteLocations, serializeRoute, StockerApiError } from "../../../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    await requireAdminSession(req);
    const routeId = String(req.query.routeId ?? "");
    const route = await prisma.stockRoute.findUnique({ where: { id: routeId } });
    if (!route) throw new StockerApiError(404, "ROUTE_NOT_FOUND", "Route not found");
    const locations = await getRouteLocations(route.locationIds);
    const optimized = await optimizeRouteLocations(locations, true);
    const updated = await prisma.stockRoute.update({
      where: { id: route.id },
      data: {
        locationIds: optimized.optimizedLocationIds,
        totalDistanceM: optimized.totalDistanceM,
        totalDurationS: optimized.totalDurationS,
        encodedPolyline: optimized.encodedPolyline,
        legsData: optimized.legsData as Prisma.InputJsonValue,
      },
    });
    return res.status(200).json({
      success: true,
      data: {
        route: { ...serializeRoute(updated), locations: await getRouteLocations(updated.locationIds) },
        optimization: {
          originalOrder: route.locationIds,
          optimizedOrder: updated.locationIds,
          distanceSavedM: 0,
          timeSavedS: 0,
        },
      },
    });
  } catch (error) {
    if (error instanceof StockerApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
    const response = toErrorResponse(error);
    return res.status(response.status).json({ success: false, message: response.message });
  }
}
