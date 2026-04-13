import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import {
  getRouteLocations,
  methodNotAllowed,
  optimizeRouteLocations,
  serializeRoute,
  StockerApiError,
} from "../../../../../../lib/server/stocker";

const DELETED_ROUTE_MARKER = "[stocker-route-deleted]";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function withDeletedMarker(description: string | null) {
  if (description?.includes(DELETED_ROUTE_MARKER)) return description;
  const marker = `${DELETED_ROUTE_MARKER} ${new Date().toISOString()}`;
  return description?.trim() ? `${description.trim()}\n\n${marker}` : marker;
}

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
      if (route.shifts.length > 0) {
        await prisma.stockRoute.update({ where: { id: route.id }, data: { description: withDeletedMarker(route.description) } });
        return res.status(200).json({ success: true, data: { deleted: true, softDeleted: true } });
      }
      await prisma.stockRoute.delete({ where: { id: route.id } });
      return res.status(200).json({ success: true, data: { deleted: true } });
    }

    const nextName = typeof req.body?.name === "string" ? req.body.name.trim() : route.name;
    const nextDescription = typeof req.body?.description === "string" ? req.body.description.trim() || null : route.description;
    const nextLocationIds = req.body?.locationIds !== undefined ? asStringArray(req.body.locationIds) : route.locationIds;
    if (!nextName || nextLocationIds.length === 0) {
      throw new StockerApiError(400, "VALIDATION_ERROR", "Route name and at least one location are required");
    }

    const locations = await getRouteLocations(nextLocationIds);
    if (locations.length !== nextLocationIds.length) {
      throw new StockerApiError(400, "VALIDATION_ERROR", "One or more selected locations could not be found");
    }
    const optimized = await optimizeRouteLocations(locations, req.body?.optimize !== false);

    const updated = await prisma.stockRoute.update({
      where: { id: route.id },
      data: {
        name: nextName,
        description: nextDescription,
        locationIds: optimized.optimizedLocationIds,
        totalDistanceM: optimized.totalDistanceM,
        totalDurationS: optimized.totalDurationS,
        encodedPolyline: optimized.encodedPolyline,
        legsData: optimized.legsData as Prisma.InputJsonValue,
        ...(typeof req.body?.isTemplate === "boolean" ? { isTemplate: req.body.isTemplate } : {}),
      },
    });
    return res.status(200).json({
      success: true,
      data: {
        ...serializeRoute(updated),
        locations: await getRouteLocations(updated.locationIds),
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
