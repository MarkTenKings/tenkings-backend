import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma as DatabasePrisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { slugify } from "../../../lib/slugify";
import { requireAdminSession, toErrorResponse } from "../../../lib/server/admin";

const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().finite().nullable().optional();
const nullableInteger = z.number().int().nullable().optional();

const locationUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  slug: z.string().min(1, "Slug is required").optional(),
  address: z.string().min(1, "Address is required").optional(),
  city: nullableString,
  state: nullableString,
  zip: nullableString,
  description: nullableString,
  hours: nullableString,
  mapsUrl: nullableString,
  machinePhotoUrl: nullableString,
  mediaUrl: nullableString,
  locationType: nullableString,
  locationStatus: nullableString,
  latitude: nullableNumber,
  longitude: nullableNumber,
  venueCenterLat: nullableNumber,
  venueCenterLng: nullableNumber,
  geofenceRadiusM: nullableInteger,
  walkingTimeMin: nullableInteger,
  landmarks: z.array(z.string()).optional(),
  hasIndoorMap: z.boolean().optional(),
});

type LocationApiResponse = Record<string, unknown> | { message: string };

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRequiredText(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return value.trim();
}

function serializeLocation(location: NonNullable<Awaited<ReturnType<typeof findLocationByIdentifier>>>) {
  return {
    ...location,
    recentRips: Array.isArray(location.recentRips) ? (location.recentRips as Array<Record<string, unknown>>) : [],
    landmarks: Array.isArray(location.landmarks) ? location.landmarks : [],
  };
}

async function findLocationByIdentifier(identifier: string) {
  return prisma.location.findFirst({
    where: {
      OR: [{ slug: identifier }, { id: identifier }],
    },
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<LocationApiResponse>) {
  const locationId = Array.isArray(req.query.locationId) ? req.query.locationId[0] : req.query.locationId;
  const identifier = typeof locationId === "string" ? locationId.trim() : "";
  if (!identifier) {
    return res.status(400).json({ message: "Missing location id" });
  }

  if (req.method === "GET") {
    const location = await findLocationByIdentifier(identifier);
    if (!location) {
      return res.status(404).json({ message: "Location not found" });
    }
    return res.status(200).json(serializeLocation(location));
  }

  if (req.method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const parsed = locationUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid payload" });
    }

    const currentLocation = await findLocationByIdentifier(identifier);
    if (!currentLocation) {
      return res.status(404).json({ message: "Location not found" });
    }

    const updateData: Record<string, unknown> = {};
    const data = parsed.data;

    const name = normalizeRequiredText(data.name);
    if (name !== undefined) {
      updateData.name = name;
    }

    if (data.slug !== undefined) {
      const nextSlug = slugify(data.slug);
      if (!nextSlug) {
        return res.status(400).json({ message: "Unable to derive slug" });
      }
      updateData.slug = nextSlug;
    }

    const address = normalizeRequiredText(data.address);
    if (address !== undefined) {
      updateData.address = address;
    }

    const optionalTextFields = [
      "city",
      "state",
      "zip",
      "description",
      "hours",
      "mapsUrl",
      "machinePhotoUrl",
      "mediaUrl",
      "locationType",
      "locationStatus",
    ] as const;

    for (const field of optionalTextFields) {
      if (data[field] !== undefined) {
        updateData[field] = normalizeOptionalText(data[field]);
      }
    }

    const numericFields = [
      "latitude",
      "longitude",
      "venueCenterLat",
      "venueCenterLng",
      "geofenceRadiusM",
      "walkingTimeMin",
    ] as const;

    for (const field of numericFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    if (data.hasIndoorMap !== undefined) {
      updateData.hasIndoorMap = data.hasIndoorMap;
    }

    if (data.landmarks !== undefined) {
      updateData.landmarks = data.landmarks.map((landmark) => landmark.trim()).filter(Boolean);
    }

    if (data.latitude !== undefined && data.venueCenterLat === undefined) {
      updateData.venueCenterLat = data.latitude;
    }
    if (data.longitude !== undefined && data.venueCenterLng === undefined) {
      updateData.venueCenterLng = data.longitude;
    }

    const updated = await prisma.location.update({
      where: { id: currentLocation.id },
      data: updateData as DatabasePrisma.LocationUpdateInput,
    });

    return res.status(200).json(serializeLocation(updated));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return res.status(409).json({ message: "A location with that slug already exists." });
      }
      if (error.code === "P2025") {
        return res.status(404).json({ message: "Location not found" });
      }
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
