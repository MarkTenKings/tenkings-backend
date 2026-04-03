import type { Prisma } from "@prisma/client";

export type WalkingDirection = {
  step: number;
  instruction: string;
  landmark?: string;
  distanceFt?: number;
};

export type Checkpoint = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  tkdReward: number;
  message: string;
};

export type KingsHuntLocation = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  address: string;
  mapsUrl: string | null;
  mediaUrl: string | null;
  locationType: string | null;
  locationStatus: string | null;
  latitude: number | null;
  longitude: number | null;
  venueCenterLat: number | null;
  venueCenterLng: number | null;
  geofenceRadiusM: number | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  hours: string | null;
  hasIndoorMap: boolean;
  walkingDirections: Prisma.JsonValue | null;
  walkingTimeMin: number | null;
  landmarks: string[];
  machinePhotoUrl: string | null;
  venueMapData: Prisma.JsonValue | null;
  checkpoints: Prisma.JsonValue | null;
};

export type VenueMapPoint = {
  x: number;
  y: number;
};

export const FOLSOM_ROUTE_POINTS = {
  entrance: { x: 188, y: 134 },
  checkpoints: {
    1: { x: 186, y: 204 },
    2: { x: 404, y: 204 },
    3: { x: 602, y: 280 },
  } as Record<number, VenueMapPoint>,
  machine: { x: 628, y: 302 },
} as const;

export function parseWalkingDirections(value: Prisma.JsonValue | null | undefined): WalkingDirection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const directions: WalkingDirection[] = [];

  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const record = entry as Record<string, unknown>;
    const step = typeof record.step === "number" ? record.step : Number(record.step);
    const instruction = typeof record.instruction === "string" ? record.instruction.trim() : "";
    const landmark = typeof record.landmark === "string" ? record.landmark.trim() : undefined;
    const distanceFt =
      typeof record.distanceFt === "number"
        ? record.distanceFt
        : Number.isFinite(Number(record.distanceFt))
          ? Number(record.distanceFt)
          : undefined;

    if (!Number.isFinite(step) || !instruction) {
      return;
    }

    directions.push({
      step,
      instruction,
      landmark: landmark || undefined,
      distanceFt,
    });
  });

  return directions.sort((left, right) => left.step - right.step);
}

export function parseCheckpoints(value: Prisma.JsonValue | null | undefined): Checkpoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "number" ? record.id : Number(record.id);
      const lat = typeof record.lat === "number" ? record.lat : Number(record.lat);
      const lng = typeof record.lng === "number" ? record.lng : Number(record.lng);
      const radiusM = typeof record.radiusM === "number" ? record.radiusM : Number(record.radiusM);
      const tkdReward = typeof record.tkdReward === "number" ? record.tkdReward : Number(record.tkdReward);
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const message = typeof record.message === "string" ? record.message.trim() : "";

      if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusM) || !Number.isFinite(tkdReward) || !name) {
        return null;
      }

      return {
        id,
        name,
        lat,
        lng,
        radiusM,
        tkdReward,
        message,
      } satisfies Checkpoint;
    })
    .filter((entry): entry is Checkpoint => entry !== null)
    .sort((left, right) => left.id - right.id);
}

export function getLocationTypeLabel(locationType: string | null | undefined): string {
  switch (locationType) {
    case "mall":
      return "Mall";
    case "stadium":
      return "Stadium";
    case "arena":
      return "Arena";
    case "casino":
      return "Casino";
    default:
      return "Location";
  }
}

export function buildDirectionsHref(location: Pick<KingsHuntLocation, "latitude" | "longitude" | "address" | "mapsUrl">): string {
  if (location.mapsUrl) {
    return location.mapsUrl;
  }

  if (typeof location.latitude === "number" && typeof location.longitude === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`;
}

export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function interpolatePoint(start: VenueMapPoint, end: VenueMapPoint, progress: number): VenueMapPoint {
  const safeProgress = clamp01(progress);
  return {
    x: start.x + (end.x - start.x) * safeProgress,
    y: start.y + (end.y - start.y) * safeProgress,
  };
}
