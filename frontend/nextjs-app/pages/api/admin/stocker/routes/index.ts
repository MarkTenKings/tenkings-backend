import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  getRouteLocations,
  methodNotAllowed,
  newId,
  optimizeRouteLocations,
  serializeRoute,
  StockerApiError,
} from "../../../../../lib/server/stocker";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);

  try {
    const admin = await requireAdminSession(req);

    if (req.method === "POST") {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const description = typeof req.body?.description === "string" ? req.body.description.trim() || null : null;
      const inputLocationIds = asStringArray(req.body?.locationIds);
      if (!name || inputLocationIds.length === 0) {
        throw new StockerApiError(400, "VALIDATION_ERROR", "Route name and at least one location are required");
      }
      const locations = await getRouteLocations(inputLocationIds);
      if (locations.length !== inputLocationIds.length) {
        throw new StockerApiError(400, "VALIDATION_ERROR", "One or more selected locations could not be found");
      }
      const optimized = await optimizeRouteLocations(locations, req.body?.optimize !== false);
      const route = await prisma.stockRoute.create({
        data: {
          id: newId(),
          name,
          description,
          locationIds: optimized.optimizedLocationIds,
          totalDistanceM: optimized.totalDistanceM,
          totalDurationS: optimized.totalDurationS,
          encodedPolyline: optimized.encodedPolyline,
          legsData: optimized.legsData as Prisma.InputJsonValue,
          isTemplate: Boolean(req.body?.isTemplate),
          createdBy: admin.user.id,
        },
      });
      const routeLocations = await getRouteLocations(route.locationIds);
      return res.status(201).json({
        success: true,
        data: {
          ...serializeRoute(route),
          locations: routeLocations,
          optimization: {
            originalOrder: inputLocationIds,
            optimizedOrder: route.locationIds,
            distanceSavedM: 0,
            timeSavedS: 0,
          },
        },
      });
    }

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const where: Prisma.StockRouteWhereInput = {
      ...(req.query.isTemplate === "true" ? { isTemplate: true } : req.query.isTemplate === "false" ? { isTemplate: false } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    };
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 50) || 50));
    const [routes, totalItems] = await Promise.all([
      prisma.stockRoute.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { shifts: true } } },
      }),
      prisma.stockRoute.count({ where }),
    ]);
    const data = await Promise.all(
      routes.map(async (route) => ({
        ...serializeRoute(route),
        locations: await getRouteLocations(route.locationIds),
        _count: route._count,
      })),
    );
    return res.status(200).json({
      success: true,
      data,
      pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) },
    });
  } catch (error) {
    if (error instanceof StockerApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
    const response = toErrorResponse(error);
    return res.status(response.status).json({ success: false, message: response.message });
  }
}
