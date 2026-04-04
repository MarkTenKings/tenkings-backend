export const DEFAULT_GEOFENCE_RADIUS_M = 500;
export const DEFAULT_CHECKPOINT_RADIUS_M = 15;
export const DEFAULT_CHECKPOINT_REWARD = 5;
export const DEFAULT_ARRIVAL_RADIUS_M = 20;
export const DEFAULT_ARRIVAL_REWARD = 25;
export const DEFAULT_ROUTE_RECALC_THRESHOLD_M = 15;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface DirectionStep {
  instruction: string;
  distanceM: number;
  durationSec: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

export interface CachedDirections {
  polyline: string;
  distanceM: number;
  durationSec: number;
  steps: DirectionStep[];
  cachedAt: string | null;
  warnings: string[];
}

export interface Checkpoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  tkdReward: number;
  order: number;
  landmark?: string;
}

export interface KingsHuntLocation {
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
  walkingDirections: CachedDirections | null;
  walkingTimeMin: number | null;
  landmarks: string[];
  machinePhotoUrl: string | null;
  venueMapData: unknown | null;
  checkpoints: Checkpoint[] | null;
}

export interface DetectVenue {
  locationId: string;
  slug: string;
  name: string;
  distanceM: number;
  withinGeofence: boolean;
}

export interface ComputeRouteRequest {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  locationSlug?: string;
}

export interface ComputeRouteResponse {
  polyline: string;
  distanceM: number;
  durationSec: number;
  steps: DirectionStep[];
  warnings: string[];
}

export interface KingsHuntSessionResponse {
  sessionId: string;
  checkpointsReached: number;
  tkdEarned: number;
  journeyCompletedAt: string | null;
}

export type HuntState =
  | "LOADING"
  | "LOCATING"
  | "STATIC_MAP"
  | "AT_VENUE"
  | "NOT_AT_VENUE"
  | "NAVIGATING"
  | "ARRIVED";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function parseDirectionSteps(value: unknown): DirectionStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }

      const instruction = asString(record.instruction) ?? "";
      const distanceM = asNumber(record.distanceM) ?? 0;
      const durationSec = asNumber(record.durationSec) ?? 0;
      const startLat = asNumber(record.startLat) ?? 0;
      const startLng = asNumber(record.startLng) ?? 0;
      const endLat = asNumber(record.endLat) ?? 0;
      const endLng = asNumber(record.endLng) ?? 0;

      if (!instruction) {
        return null;
      }

      return {
        instruction,
        distanceM,
        durationSec,
        startLat,
        startLng,
        endLat,
        endLng,
      } satisfies DirectionStep;
    })
    .filter((entry): entry is DirectionStep => entry !== null);
}

export function parseCachedDirections(value: unknown): CachedDirections | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const polyline = asString(record.polyline);
  if (!polyline) {
    return null;
  }

  return {
    polyline,
    distanceM: asNumber(record.distanceM) ?? 0,
    durationSec: asNumber(record.durationSec) ?? 0,
    steps: parseDirectionSteps(record.steps),
    cachedAt: asString(record.cachedAt),
    warnings: Array.isArray(record.warnings) ? record.warnings.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry)) : [],
  };
}

export function parseCheckpoints(value: unknown): Checkpoint[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const checkpoints: Checkpoint[] = [];

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      return;
    }

    const lat = asNumber(record.lat);
    const lng = asNumber(record.lng);
    const name = asString(record.name);

    if (lat == null || lng == null || !name) {
      return;
    }

    const order = asNumber(record.order) ?? index + 1;
    const id = asString(record.id) ?? String(order);

    checkpoints.push({
      id,
      name,
      lat,
      lng,
      radiusM: asNumber(record.radiusM) ?? DEFAULT_CHECKPOINT_RADIUS_M,
      tkdReward: asNumber(record.tkdReward) ?? DEFAULT_CHECKPOINT_REWARD,
      order,
      landmark: asString(record.landmark) ?? undefined,
    });
  });

  checkpoints.sort((left, right) => left.order - right.order);

  return checkpoints.length > 0 ? checkpoints : null;
}

export function getLocationTypeLabel(locationType: string | null | undefined): string {
  switch ((locationType ?? "").toLowerCase()) {
    case "mall":
      return "Mall";
    case "arena":
      return "Arena";
    case "stadium":
      return "Stadium";
    case "casino":
      return "Casino";
    case "park":
      return "Park";
    case "online":
      return "Online";
    default:
      return "Venue";
  }
}

export function isLocationActive(status: string | null | undefined): boolean {
  return !status || status === "active";
}

export function getMachinePosition(location: Pick<KingsHuntLocation, "latitude" | "longitude">): LatLng | null {
  if (typeof location.latitude !== "number" || typeof location.longitude !== "number") {
    return null;
  }

  return { lat: location.latitude, lng: location.longitude };
}

export function getVenueCenterPosition(
  location: Pick<KingsHuntLocation, "venueCenterLat" | "venueCenterLng" | "latitude" | "longitude">,
): LatLng | null {
  if (typeof location.venueCenterLat === "number" && typeof location.venueCenterLng === "number") {
    return { lat: location.venueCenterLat, lng: location.venueCenterLng };
  }

  return getMachinePosition(location);
}

export function buildDirectionsHref(
  location: Pick<KingsHuntLocation, "latitude" | "longitude" | "address" | "mapsUrl">,
  origin?: LatLng | null,
): string {
  if (origin && typeof location.latitude === "number" && typeof location.longitude === "number") {
    const originValue = `${origin.lat},${origin.lng}`;
    const destinationValue = `${location.latitude},${location.longitude}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originValue)}&destination=${encodeURIComponent(destinationValue)}&travelmode=walking`;
  }

  if (location.mapsUrl) {
    return location.mapsUrl;
  }

  if (typeof location.latitude === "number" && typeof location.longitude === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`;
}

export function formatLocationHours(hours: string | null | undefined): string | null {
  const rawHours = asString(hours);
  if (!rawHours) {
    return null;
  }

  if (!rawHours.startsWith("{")) {
    return rawHours;
  }

  try {
    const parsed = JSON.parse(rawHours) as Record<string, unknown>;
    const entries = Object.entries(parsed)
      .map(([day, value]) => {
        const label = asString(value);
        if (!label) {
          return null;
        }

        return `${day.slice(0, 3)} ${label}`;
      })
      .filter((entry): entry is string => entry !== null);

    return entries.length > 0 ? entries.join(" · ") : rawHours;
  } catch {
    return rawHours;
  }
}

export function formatDistance(distanceM: number | null | undefined): string {
  if (distanceM == null || !Number.isFinite(distanceM)) {
    return "Distance unavailable";
  }

  if (distanceM < 1000) {
    return `${Math.round(distanceM)} m`;
  }

  const miles = distanceM / 1609.344;
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

export function formatDuration(durationSec: number | null | undefined): string {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) {
    return "ETA unavailable";
  }

  const minutes = Math.round(durationSec / 60);
  if (minutes < 60) {
    return `${Math.max(1, minutes)} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

export function getCheckpointRewardTotal(checkpoints: Checkpoint[], checkpointIds: string[]): number {
  const hitIds = new Set(checkpointIds);

  return checkpoints.reduce((sum, checkpoint) => {
    return hitIds.has(checkpoint.id) ? sum + checkpoint.tkdReward : sum;
  }, 0);
}
