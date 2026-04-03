import { prisma, type Prisma } from "@tenkings/database";
import { haversineDistance, isWithinGeofence } from "../geo";

export const kingsHuntLocationSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  address: true,
  mapsUrl: true,
  mediaUrl: true,
  locationType: true,
  locationStatus: true,
  latitude: true,
  longitude: true,
  venueCenterLat: true,
  venueCenterLng: true,
  geofenceRadiusM: true,
  city: true,
  state: true,
  zip: true,
  hours: true,
  hasIndoorMap: true,
  walkingDirections: true,
  walkingTimeMin: true,
  landmarks: true,
  machinePhotoUrl: true,
  venueMapData: true,
  checkpoints: true,
} satisfies Prisma.LocationSelect;

export type KingsHuntLocationRecord = Prisma.LocationGetPayload<{
  select: typeof kingsHuntLocationSelect;
}>;

export function isLocationActive(status: string | null | undefined): boolean {
  return !status || status === "active";
}

export function computeDistanceToMachine(location: Pick<KingsHuntLocationRecord, "latitude" | "longitude">, lat: number, lng: number) {
  if (typeof location.latitude !== "number" || typeof location.longitude !== "number") {
    return null;
  }

  return haversineDistance(lat, lng, location.latitude, location.longitude);
}

export function computeIsAtVenue(
  location: Pick<KingsHuntLocationRecord, "venueCenterLat" | "venueCenterLng" | "geofenceRadiusM">,
  lat: number,
  lng: number,
) {
  if (typeof location.venueCenterLat !== "number" || typeof location.venueCenterLng !== "number") {
    return false;
  }

  return isWithinGeofence(lat, lng, location.venueCenterLat, location.venueCenterLng, location.geofenceRadiusM ?? 500);
}

export async function getKingsHuntLocationBySlug(slug: string) {
  return prisma.location.findUnique({
    where: { slug },
    select: kingsHuntLocationSelect,
  });
}

export async function detectKingsHuntLocation(lat: number, lng: number) {
  const locations = await prisma.location.findMany({
    where: {
      latitude: { not: null },
      venueCenterLat: { not: null },
      venueCenterLng: { not: null },
    },
    select: kingsHuntLocationSelect,
  });

  let closest: KingsHuntLocationRecord | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const location of locations) {
    if (!isLocationActive(location.locationStatus)) {
      continue;
    }

    const distance = haversineDistance(lat, lng, location.venueCenterLat!, location.venueCenterLng!);
    if (distance <= (location.geofenceRadiusM ?? 500) && distance < closestDistance) {
      closest = location;
      closestDistance = distance;
    }
  }

  return {
    location: closest,
    distanceM: Number.isFinite(closestDistance) ? closestDistance : null,
  };
}

export function resolveEntryMethod(entry: string | null | undefined, qrCodeId: string | null) {
  if (qrCodeId) {
    return "qr_direct";
  }

  if (entry === "gps") {
    return "qr_gps_detect";
  }

  return "website_click";
}
