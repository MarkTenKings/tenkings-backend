import { prisma, type Prisma } from "@tenkings/database";
import { checkGeofence, haversineDistance } from "../geo";
import {
  getMachinePosition,
  isLocationActive,
  parseCachedDirections,
  parseCheckpoints,
  type DetectVenue,
  type KingsHuntLocation,
} from "../kingsHunt";

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
  machineLat: true,
  machineLng: true,
  machineGeofenceM: true,
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

export function mapLocationRecordToDTO(location: KingsHuntLocationRecord): KingsHuntLocation {
  return {
    id: location.id,
    slug: location.slug,
    name: location.name,
    description: location.description ?? null,
    address: location.address,
    mapsUrl: location.mapsUrl ?? null,
    mediaUrl: location.mediaUrl ?? null,
    locationType: location.locationType ?? null,
    locationStatus: location.locationStatus ?? null,
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    venueCenterLat: location.venueCenterLat ?? null,
    venueCenterLng: location.venueCenterLng ?? null,
    geofenceRadiusM: location.geofenceRadiusM ?? null,
    machineLat: location.machineLat ?? null,
    machineLng: location.machineLng ?? null,
    machineGeofenceM: location.machineGeofenceM ?? null,
    city: location.city ?? null,
    state: location.state ?? null,
    zip: location.zip ?? null,
    hours: location.hours ?? null,
    hasIndoorMap: location.hasIndoorMap,
    walkingDirections: parseCachedDirections(location.walkingDirections),
    walkingTimeMin: location.walkingTimeMin ?? null,
    landmarks: Array.isArray(location.landmarks) ? location.landmarks : [],
    machinePhotoUrl: location.machinePhotoUrl ?? null,
    venueMapData: location.venueMapData ?? null,
    checkpoints: parseCheckpoints(location.checkpoints),
  };
}

export async function listActiveKingsHuntLocations(): Promise<KingsHuntLocation[]> {
  const locations = await prisma.location.findMany({
    where: {
      OR: [{ locationStatus: "active" }, { locationStatus: null }],
      NOT: { locationType: "online" },
    },
    orderBy: { name: "asc" },
    select: kingsHuntLocationSelect,
  });

  return locations
    .filter((location: KingsHuntLocationRecord) => isLocationActive(location.locationStatus))
    .map(mapLocationRecordToDTO);
}

export async function getKingsHuntLocationBySlug(slug: string): Promise<KingsHuntLocation | null> {
  const location = await prisma.location.findUnique({
    where: { slug },
    select: kingsHuntLocationSelect,
  });

  return location ? mapLocationRecordToDTO(location) : null;
}

export async function detectKingsHuntLocations(lat: number, lng: number): Promise<{
  nearest: DetectVenue | null;
  detected: DetectVenue[];
}> {
  const locations = await prisma.location.findMany({
    where: {
      OR: [{ locationStatus: "active" }, { locationStatus: null }],
      NOT: { locationType: "online" },
      venueCenterLat: { not: null },
      venueCenterLng: { not: null },
      latitude: { not: null },
      longitude: { not: null },
    },
    orderBy: { name: "asc" },
    select: kingsHuntLocationSelect,
  });

  const detected = locations
    .filter((location: KingsHuntLocationRecord) => isLocationActive(location.locationStatus))
    .map((location: KingsHuntLocationRecord) => {
      const geofence = checkGeofence(
        {
          venueCenterLat: location.venueCenterLat,
          venueCenterLng: location.venueCenterLng,
          geofenceRadiusM: location.geofenceRadiusM,
        },
        { lat, lng },
      );

      const distanceM =
        geofence?.distanceM ??
        haversineDistance(lat, lng, location.venueCenterLat ?? lat, location.venueCenterLng ?? lng);

      return {
        locationId: location.id,
        slug: location.slug,
        name: location.name,
        distanceM,
        withinGeofence: geofence?.isInside ?? false,
      } satisfies DetectVenue;
    })
    .sort((left: DetectVenue, right: DetectVenue) => left.distanceM - right.distanceM);

  return {
    nearest: detected.find((entry: DetectVenue) => entry.withinGeofence) ?? null,
    detected,
  };
}

export function computeDistanceToMachine(
  location: Pick<KingsHuntLocation, "latitude" | "longitude" | "machineLat" | "machineLng">,
  lat: number,
  lng: number,
): number | null {
  const destination = getMachinePosition(location);
  if (!destination) {
    return null;
  }

  return haversineDistance(lat, lng, destination.lat, destination.lng);
}

export function resolveEntryMethod(entry: string | null | undefined, qrCodeId: string | null | undefined): string {
  if (qrCodeId) {
    return "qr_direct";
  }

  if (entry === "gps") {
    return "gps_detect";
  }

  return "manual";
}

export function resolveVisitSource(entry: string | null | undefined, qrCodeId: string | null | undefined): "qr" | "gps" | "manual" {
  if (qrCodeId) {
    return "qr";
  }

  if (entry === "gps") {
    return "gps";
  }

  return "manual";
}
