import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { z } from "zod";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { buildLocationMapsUrl, geocodeLocationAddress } from "../../../lib/server/locationGeocoding";
import { requireUserSession, toUserErrorResponse } from "../../../lib/server/session";

const ripSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    videoUrl: z.string().url("Video URL must be a valid URL"),
  })
  .array()
  .max(6)
  .optional();

const locationPayloadSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  address: z.string().min(1, "Address is required"),
  mapsUrl: z.string().url().optional().or(z.literal("")),
  mediaUrl: z.string().url().optional().or(z.literal("")),
  recentRips: ripSchema,
  latitude: z.number().finite().nullable().optional(),
  longitude: z.number().finite().nullable().optional(),
  venueCenterLat: z.number().finite().nullable().optional(),
  venueCenterLng: z.number().finite().nullable().optional(),
  geofenceRadiusM: z.number().int().nullable().optional(),
  machineLat: z.number().finite().nullable().optional(),
  machineLng: z.number().finite().nullable().optional(),
  machineGeofenceM: z.number().int().nullable().optional(),
});

const normalizedRips = (value: z.infer<typeof ripSchema>) => {
  if (!value || value.length === 0) {
    return [];
  }
  return value.map((entry) => ({
    title: entry.title,
    videoUrl: entry.videoUrl,
  }));
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try {
      const mapOnly = req.query.mapOnly === "true";
      const includeInactive = req.query.includeInactive === "true";
      const stateFilter = typeof req.query.state === "string" ? req.query.state.trim().toUpperCase() : null;
      const locationTypeFilter =
        typeof req.query.locationType === "string" ? req.query.locationType.trim().toLowerCase() : null;

      const where: Prisma.LocationWhereInput = {
        ...(stateFilter ? { state: stateFilter } : {}),
        ...(locationTypeFilter ? { locationType: locationTypeFilter } : {}),
        ...(includeInactive
          ? {}
          : {
              OR: [{ locationStatus: "active" }, { locationStatus: "coming_soon" }, { locationStatus: null }],
            }),
      };

      const locations = await prisma.location.findMany({
        where,
        orderBy: { name: "asc" },
        include: {
          liveRips: {
            orderBy: { createdAt: "desc" },
            take: 6,
          },
        },
      });

      const enrichedLocations = await Promise.all(
        locations.map(async (location) => {
          const needsGeocodeFallback =
            location.locationType !== "online" &&
            Boolean(location.address?.trim()) &&
            (
              location.latitude == null ||
              location.longitude == null ||
              !location.city ||
              !location.state ||
              !location.zip ||
              !location.mapsUrl
            );

          const geocoded = needsGeocodeFallback ? await geocodeLocationAddress(location.address) : null;
          const latitude = location.latitude ?? geocoded?.latitude ?? null;
          const longitude = location.longitude ?? geocoded?.longitude ?? null;
          const city = location.city ?? geocoded?.city ?? null;
          const state = location.state ?? geocoded?.state ?? null;
          const zip = location.zip ?? geocoded?.zip ?? null;
          const mapsUrl =
            location.mapsUrl ??
            geocoded?.mapsUrl ??
            buildLocationMapsUrl({
              address: location.address,
              latitude,
              longitude,
            });

          return {
            ...location,
            latitude,
            longitude,
            city,
            state,
            zip,
            mapsUrl,
            recentRips: Array.isArray(location.recentRips) ? (location.recentRips as Array<Record<string, unknown>>) : [],
            landmarks: Array.isArray(location.landmarks) ? location.landmarks : [],
            liveRips: Array.isArray(location.liveRips)
              ? location.liveRips.map((liveRip) => ({
                  id: liveRip.id,
                  slug: liveRip.slug,
                  title: liveRip.title,
                  videoUrl: liveRip.videoUrl,
                  muxPlaybackId: liveRip.muxPlaybackId ?? null,
                  thumbnailUrl: liveRip.thumbnailUrl,
                  viewCount: liveRip.viewCount,
                  createdAt: liveRip.createdAt.toISOString(),
                }))
              : [],
          };
        }),
      );

      const publicLocations = mapOnly
        ? enrichedLocations.filter(
            (location) => typeof location.latitude === "number" && typeof location.longitude === "number",
          )
        : enrichedLocations;

      res.status(200).json({
        locations: publicLocations,
      });
    } catch (error) {
      const result = toUserErrorResponse(error);
      res.status(result.status).json({ message: result.message });
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const session = await requireUserSession(req);
      const isAdmin = hasAdminAccess(session.user.id) || hasAdminPhoneAccess(session.user.phone);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const payload = locationPayloadSchema.parse(req.body ?? {});
      const slug = payload.slug ? slugify(payload.slug) : slugify(payload.name);

      if (!slug) {
        return res.status(400).json({ message: "Unable to derive slug from location name" });
      }

      const location = await prisma.location.create({
        data: {
          slug,
          name: payload.name,
          description: payload.description,
          address: payload.address,
          mapsUrl: payload.mapsUrl || null,
          mediaUrl: payload.mediaUrl || null,
          latitude: payload.latitude ?? null,
          longitude: payload.longitude ?? null,
          venueCenterLat: payload.venueCenterLat ?? payload.latitude ?? null,
          venueCenterLng: payload.venueCenterLng ?? payload.longitude ?? null,
          geofenceRadiusM: payload.geofenceRadiusM ?? 500,
          machineLat: payload.machineLat ?? null,
          machineLng: payload.machineLng ?? null,
          machineGeofenceM: payload.machineGeofenceM ?? 20,
          recentRips: normalizedRips(payload.recentRips),
        },
      });

      res.status(201).json({
        location: {
          ...location,
          recentRips: Array.isArray(location.recentRips) ? (location.recentRips as Array<Record<string, unknown>>) : [],
          landmarks: Array.isArray(location.landmarks) ? location.landmarks : [],
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
      }
      const result = toUserErrorResponse(error);
      res.status(result.status).json({ message: result.message });
    }
    return;
  }

  res.status(405).json({ message: "Method not allowed" });
}
