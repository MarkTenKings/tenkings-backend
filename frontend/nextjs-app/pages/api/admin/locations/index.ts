import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { toErrorResponse } from "../../../../lib/server/admin";
import { requireInventoryAdminSession } from "../../../../lib/server/inventoryAdmin";
import { slugify } from "../../../../lib/slugify";
import { buildLocationMapsUrl, geocodeLocationAddress } from "../../../../lib/server/locationGeocoding";

type LocationRow = {
  id: string;
  name: string;
  slug: string;
};

const createLocationSchema = z.object({
  action: z.literal("location").optional(),
  request_id: z.string().uuid().optional(),
  inventoryKind: z.enum(["hq", "store", "kiosk"]).optional(),
  inventoryRequestId: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(160),
  slug: z.string().trim().min(1).max(160).optional(),
  address: z.string().trim().min(1, "Address is required").max(500),
  latitude: z.number().finite().nullable().optional(),
  longitude: z.number().finite().nullable().optional(),
  venueCenterLat: z.number().finite().nullable().optional(),
  venueCenterLng: z.number().finite().nullable().optional(),
  geofenceRadiusM: z.number().int().nullable().optional(),
  machineLat: z.number().finite().nullable().optional(),
  machineLng: z.number().finite().nullable().optional(),
  machineGeofenceM: z.number().int().nullable().optional(),
}).superRefine((value, ctx) => {
  if ((value.action || value.request_id || value.inventoryRequestId || value.inventoryKind) && (!value.inventoryKind || !value.inventoryRequestId)) ctx.addIssue({ code: "custom", message: "Inventory locations need a type and request ID." });
  if (value.request_id && value.request_id !== value.inventoryRequestId) ctx.addIssue({ code: "custom", message: "The location request IDs do not match." });
  if (value.inventoryRequestId && ["latitude", "longitude", "venueCenterLat", "venueCenterLng", "geofenceRadiusM", "machineLat", "machineLng", "machineGeofenceM"].some(key => value[key as keyof typeof value] !== undefined)) ctx.addIssue({ code: "custom", message: "Use the location editor to change coordinates after adding a location." });
});

type ResponseBody =
  | { locations: LocationRow[] }
  | { location: LocationRow & { address: string }; request_id?: string; outcome?: "RECORDED" | "REPLAY" }
  | { message: string };

export function createAdminLocationsHandler(deps: {
  requireAdmin: typeof requireInventoryAdminSession;
  locations: Pick<typeof prisma.location, "findUnique" | "findMany" | "create">;
  geocode: typeof geocodeLocationAddress;
}) {
return async (req: NextApiRequest, res: NextApiResponse<ResponseBody>) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await deps.requireAdmin(req);

    if (req.method === "POST") {
      const parsed = createLocationSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid payload" });
      }

      const trimmedName = parsed.data.name.trim();
      const trimmedAddress = parsed.data.address.trim();
      const normalizedSlug = slugify(parsed.data.slug || parsed.data.name);
      if (!normalizedSlug) {
        return res.status(400).json({ message: "Unable to derive slug from location name" });
      }

      if (!trimmedAddress) return res.status(400).json({ message: "Address is required" });
      const replay = async () => {
        if (!parsed.data.inventoryRequestId) return false;
        const previous = await deps.locations.findUnique({ where: { id: parsed.data.inventoryRequestId } });
        if (!previous) return false;
        if (previous.name !== trimmedName || previous.address !== trimmedAddress || previous.slug !== normalizedSlug || previous.locationType !== parsed.data.inventoryKind) {
          res.status(409).json({ message: "This location request was already saved with different details." });
        } else {
          res.status(200).json({ location: { id: previous.id, name: previous.name, slug: previous.slug, address: previous.address }, request_id: previous.id, outcome: "REPLAY" });
        }
        return true;
      };
      if (await replay()) return;
      const internal = parsed.data.inventoryKind === "hq";
      const geocoded = internal ? null : await deps.geocode(trimmedAddress);
      const latitude = parsed.data.latitude ?? geocoded?.latitude ?? null;
      const longitude = parsed.data.longitude ?? geocoded?.longitude ?? null;
      const venueCenterLat = parsed.data.venueCenterLat ?? latitude;
      const venueCenterLng = parsed.data.venueCenterLng ?? longitude;

      let location;
      try { location = await deps.locations.create({
        data: {
          id: parsed.data.inventoryRequestId,
          name: trimmedName,
          slug: normalizedSlug,
          address: trimmedAddress,
          locationStatus: internal ? "internal" : "active",
          locationType: parsed.data.inventoryKind ?? null,
          mapsUrl: geocoded?.mapsUrl ?? buildLocationMapsUrl({ address: trimmedAddress, latitude, longitude }),
          latitude,
          longitude,
          venueCenterLat,
          venueCenterLng,
          geofenceRadiusM: internal ? null : parsed.data.geofenceRadiusM ?? 500,
          machineLat: parsed.data.machineLat ?? null,
          machineLng: parsed.data.machineLng ?? null,
          machineGeofenceM: internal ? null : parsed.data.machineGeofenceM ?? 20,
          city: geocoded?.city ?? null,
          state: geocoded?.state ?? null,
          zip: geocoded?.zip ?? null,
          recentRips: [],
        },
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
        },
      }); } catch (error) {
        // PostgreSQL waits for the competing unique-ID insert to commit before P2002.
        // Re-read outside that failed statement so simultaneous exact retries replay once.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && await replay()) return;
        throw error;
      }

      return res.status(201).json({ location, ...(parsed.data.inventoryRequestId ? { request_id: parsed.data.inventoryRequestId, outcome: "RECORDED" as const } : {}) });
    }

    const locations = await deps.locations.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    });

    return res.status(200).json({ locations });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "A location with that slug already exists." });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.status < 500 ? response.message : "Locations could not be loaded or saved. Your entry is preserved; please retry." });
  }
};
}

export default createAdminLocationsHandler({ requireAdmin: requireInventoryAdminSession, locations: prisma.location, geocode: geocodeLocationAddress });
