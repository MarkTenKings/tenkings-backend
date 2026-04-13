import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@tenkings/database";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { requireUserSession } from "./session";
import type {
  GeofenceEvent,
  DrivingNavigationData,
  LiveStockerPosition,
  LocationSummary,
  RouteLegData,
  StockRouteData,
  StockerProfileData,
  StockerShiftData,
  StockerStopData,
  WalkingGuidanceData,
} from "../../types/stocker";

export class StockerApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export type StockerSession = {
  userId: string;
  stockerId: string;
  name: string;
  phone: string;
  token: string | null;
  isAdmin: boolean;
  hasStockerProfile: boolean;
};

const ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const DRIVE_FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.polyline.encodedPolyline",
  "routes.legs.duration",
  "routes.legs.distanceMeters",
  "routes.legs.polyline.encodedPolyline",
  "routes.optimizedIntermediateWaypointIndex",
].join(",");
const WALK_FIELD_MASK = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline";

export function normalizePhoneInput(input: unknown): string {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/[^0-9]/g, "");
    return digits ? `+${digits}` : "";
  }
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function extractBearerToken(req: NextApiRequest): string | null {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() === "bearer" && token) return token;
  return null;
}

export function isStockerAdminUser(user: { id: string; phone: string | null; role?: string | null }) {
  return user.role === "admin" || hasAdminAccess(user.id) || hasAdminPhoneAccess(user.phone);
}

export function hasStockerPortalAccess(user: {
  id: string;
  phone: string | null;
  role?: string | null;
  stockerProfile?: { id: string; isActive: boolean } | null;
}) {
  return Boolean(user.stockerProfile) || isStockerAdminUser(user);
}

const STOCKER_ACCESS_USER_SELECT = {
  id: true,
  phone: true,
  role: true,
  displayName: true,
  stockerProfile: true,
} satisfies Prisma.UserSelect;

export async function findStockerAccessUser(params: { id?: string | null; phone?: string | null }) {
  const normalizedPhone = normalizePhoneInput(params.phone ?? "");
  if (normalizedPhone) {
    const byPhone = await prisma.user.findUnique({
      where: { phone: normalizedPhone },
      select: STOCKER_ACCESS_USER_SELECT,
    });
    if (byPhone) return byPhone;
  }

  if (params.id) {
    return prisma.user.findUnique({
      where: { id: params.id },
      select: STOCKER_ACCESS_USER_SELECT,
    });
  }

  return null;
}

export async function requireStockerSession(req: NextApiRequest): Promise<StockerSession> {
  const session = await requireUserSession(req);
  const user = await findStockerAccessUser({
    id: session.user.id,
    phone: session.user.phone,
  });

  if (!user) {
    throw new StockerApiError(401, "UNAUTHORIZED", "Session user not found");
  }

  const isAdmin = isStockerAdminUser(user);
  if (!hasStockerPortalAccess(user)) {
    throw new StockerApiError(403, "NOT_A_STOCKER", "Stocker access required");
  }

  const profile = user.stockerProfile;

  return {
    userId: user.id,
    stockerId: profile?.id ?? "",
    name: profile?.name ?? user.displayName ?? "Admin",
    phone: profile?.phone ?? user.phone ?? "",
    token: extractBearerToken(req),
    isAdmin,
    hasStockerProfile: Boolean(profile),
  };
}

export function sendError(res: NextApiResponse, error: unknown) {
  if (error instanceof StockerApiError) {
    return res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message },
      message: error.message,
    });
  }
  if (error instanceof Error) {
    console.error("[stocker] api error", error);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: error.message },
      message: error.message,
    });
  }
  return res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Unexpected error" },
    message: "Unexpected error",
  });
}

export function methodNotAllowed(res: NextApiResponse, allowed: string[]) {
  res.setHeader("Allow", allowed.join(", "));
  return res.status(405).json({ success: false, message: "Method not allowed" });
}

export function parseDateOnly(value?: string | string[] | null): Date {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : getPacificDateString();
  return new Date(`${normalized}T00:00:00.000Z`);
}

export function getPacificDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function serializeProfile(profile: {
  id: string;
  userId: string;
  name: string;
  phone: string;
  language: string;
  isActive: boolean;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StockerProfileData {
  return {
    id: profile.id,
    userId: profile.userId,
    name: profile.name,
    phone: profile.phone,
    language: profile.language === "es" ? "es" : "en",
    isActive: profile.isActive,
    avatarUrl: profile.avatarUrl,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function serializeLocation(location: {
  id: string;
  slug: string;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  venueCenterLat: number | null;
  venueCenterLng: number | null;
  geofenceRadiusM: number | null;
  description: string | null;
  landmarks: string[];
}): LocationSummary {
  return {
    id: location.id,
    slug: location.slug,
    name: location.name,
    address: location.address,
    city: location.city,
    state: location.state,
    latitude: location.latitude,
    longitude: location.longitude,
    venueCenterLat: location.venueCenterLat,
    venueCenterLng: location.venueCenterLng,
    geofenceRadiusM: location.geofenceRadiusM ?? 500,
    description: location.description,
    landmarks: Array.isArray(location.landmarks) ? location.landmarks : [],
  };
}

function normalizeLegsData(value: Prisma.JsonValue | null): RouteLegData[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      distanceM: typeof row.distanceM === "number" ? row.distanceM : 0,
      durationS: typeof row.durationS === "number" ? row.durationS : 0,
      encodedPolyline: typeof row.encodedPolyline === "string" ? row.encodedPolyline : null,
    };
  });
}

export function serializeRoute(route: {
  id: string;
  name: string;
  description: string | null;
  locationIds: string[];
  totalDistanceM: number | null;
  totalDurationS: number | null;
  encodedPolyline: string | null;
  legsData: Prisma.JsonValue | null;
  isTemplate: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}): StockRouteData {
  return {
    id: route.id,
    name: route.name,
    description: route.description,
    locationIds: route.locationIds,
    totalDistanceM: route.totalDistanceM,
    totalDurationS: route.totalDurationS,
    encodedPolyline: route.encodedPolyline,
    legsData: normalizeLegsData(route.legsData),
    isTemplate: route.isTemplate,
    createdBy: route.createdBy,
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
  };
}

export function serializeStop(stop: {
  id: string;
  shiftId: string;
  locationId: string;
  stopOrder: number;
  status: string;
  departedPreviousAt: Date | null;
  arrivedAt: Date | null;
  taskStartedAt: Date | null;
  taskCompletedAt: Date | null;
  departedAt: Date | null;
  driveTimeMin: number | null;
  driveDistanceM: number | null;
  onSiteTimeMin: number | null;
  skipReason: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  location?: Parameters<typeof serializeLocation>[0];
}): StockerStopData {
  return {
    id: stop.id,
    shiftId: stop.shiftId,
    locationId: stop.locationId,
    stopOrder: stop.stopOrder,
    status: stop.status as StockerStopData["status"],
    departedPreviousAt: stop.departedPreviousAt?.toISOString() ?? null,
    arrivedAt: stop.arrivedAt?.toISOString() ?? null,
    taskStartedAt: stop.taskStartedAt?.toISOString() ?? null,
    taskCompletedAt: stop.taskCompletedAt?.toISOString() ?? null,
    departedAt: stop.departedAt?.toISOString() ?? null,
    driveTimeMin: stop.driveTimeMin,
    driveDistanceM: stop.driveDistanceM,
    onSiteTimeMin: stop.onSiteTimeMin,
    skipReason: stop.skipReason,
    notes: stop.notes,
    createdAt: stop.createdAt.toISOString(),
    updatedAt: stop.updatedAt.toISOString(),
    location: stop.location ? serializeLocation(stop.location) : undefined,
  };
}

export function serializeShift(shift: {
  id: string;
  stockerId: string;
  routeId: string;
  assignedDate: Date;
  status: string;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  totalDriveTimeMin: number | null;
  totalOnSiteTimeMin: number | null;
  totalIdleTimeMin: number | null;
  totalDistanceM: number | null;
  createdAt: Date;
  updatedAt: Date;
  route?: Parameters<typeof serializeRoute>[0];
  stops?: Array<Parameters<typeof serializeStop>[0]>;
  stocker?: Parameters<typeof serializeProfile>[0];
}): StockerShiftData {
  return {
    id: shift.id,
    stockerId: shift.stockerId,
    routeId: shift.routeId,
    assignedDate: shift.assignedDate.toISOString().slice(0, 10),
    status: shift.status as StockerShiftData["status"],
    clockInAt: shift.clockInAt?.toISOString() ?? null,
    clockOutAt: shift.clockOutAt?.toISOString() ?? null,
    totalDriveTimeMin: shift.totalDriveTimeMin,
    totalOnSiteTimeMin: shift.totalOnSiteTimeMin,
    totalIdleTimeMin: shift.totalIdleTimeMin,
    totalDistanceM: shift.totalDistanceM,
    createdAt: shift.createdAt.toISOString(),
    updatedAt: shift.updatedAt.toISOString(),
    route: shift.route ? serializeRoute(shift.route) : undefined,
    stops: shift.stops ? shift.stops.map(serializeStop) : undefined,
    stocker: shift.stocker ? serializeProfile(shift.stocker) : undefined,
  };
}

export async function getRouteLocations(locationIds: string[]): Promise<LocationSummary[]> {
  if (locationIds.length === 0) return [];
  const locations = await prisma.location.findMany({
    where: { id: { in: locationIds } },
    select: {
      id: true,
      slug: true,
      name: true,
      address: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      venueCenterLat: true,
      venueCenterLng: true,
      geofenceRadiusM: true,
      description: true,
      landmarks: true,
    },
  });
  const lookup = new Map(locations.map((location) => [location.id, serializeLocation(location)]));
  return locationIds.map((id) => lookup.get(id)).filter((location): location is LocationSummary => Boolean(location));
}

export function haversineDistanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const earthRadiusM = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function parseDurationS(value: unknown): number {
  if (typeof value === "string" && value.endsWith("s")) {
    const parsed = Number(value.slice(0, -1));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toWaypoint(location: { latitude: number; longitude: number }) {
  return {
    location: {
      latLng: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
    },
  };
}

type RouteApiLocation = LocationSummary & { latitude: number; longitude: number };
type RouteApiPoint = { latitude: number; longitude: number };

function assertRouteLocations(locations: LocationSummary[]): RouteApiLocation[] {
  const missing = locations.find((location) => location.latitude == null || location.longitude == null);
  if (missing) {
    throw new StockerApiError(400, "LOCATION_MISSING_COORDINATES", `${missing.name} is missing coordinates`);
  }
  return locations as RouteApiLocation[];
}

function drivingPointForLocation(location: LocationSummary): RouteApiPoint | null {
  const latitude = location.venueCenterLat ?? location.latitude;
  const longitude = location.venueCenterLng ?? location.longitude;
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

function estimateDriveDurationS(distanceM: number) {
  return Math.round(distanceM / 13.4);
}

export async function getDrivingNavigation(
  from: { lat: number; lng: number },
  stops: LocationSummary[],
): Promise<DrivingNavigationData> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const routeStops = stops.map((stop) => ({ stop, point: drivingPointForLocation(stop) }));
  const missing = routeStops.find((entry) => !entry.point);
  if (missing) {
    throw new StockerApiError(400, "LOCATION_MISSING_COORDINATES", `${missing.stop.name} is missing driving coordinates`);
  }
  const points = routeStops.map((entry) => entry.point as RouteApiPoint);
  if (points.length === 0) {
    return {
      encodedPolyline: null,
      totalDistanceM: 0,
      totalDurationS: 0,
      nextDistanceM: 0,
      nextDurationS: 0,
      generatedAt: new Date().toISOString(),
    };
  }
  if (points.length > 26) {
    throw new StockerApiError(400, "ROUTE_TOO_MANY_STOPS", "Google live navigation supports up to 26 remaining stops");
  }

  if (!apiKey) {
    const segmentDistances = points.map((point, index) => {
      const origin = index === 0 ? from : { lat: points[index - 1].latitude, lng: points[index - 1].longitude };
      return Math.round(haversineDistanceM(origin, { lat: point.latitude, lng: point.longitude }));
    });
    const totalDistanceM = segmentDistances.reduce((sum, distance) => sum + distance, 0);
    const totalDurationS = estimateDriveDurationS(totalDistanceM);
    return {
      encodedPolyline: null,
      totalDistanceM,
      totalDurationS,
      nextDistanceM: segmentDistances[0] ?? 0,
      nextDurationS: estimateDriveDurationS(segmentDistances[0] ?? 0),
      generatedAt: new Date().toISOString(),
    };
  }

  const destination = points[points.length - 1];
  const intermediates = points.slice(0, -1);
  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters",
      "X-Server-Timeout": "10",
    },
    body: JSON.stringify({
      origin: toWaypoint({ latitude: from.lat, longitude: from.lng }),
      destination: toWaypoint(destination),
      intermediates: intermediates.map(toWaypoint),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      polylineQuality: "HIGH_QUALITY",
      polylineEncoding: "ENCODED_POLYLINE",
      units: "IMPERIAL",
    }),
  });

  const data = (await response.json().catch(() => null)) as
    | {
        routes?: Array<{
          duration?: string;
          distanceMeters?: number;
          polyline?: { encodedPolyline?: string };
          legs?: Array<{ duration?: string; distanceMeters?: number }>;
        }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    throw new StockerApiError(502, "DRIVING_NAVIGATION_FAILED", data?.error?.message ?? "Google Routes API failed");
  }

  const route = data?.routes?.[0];
  if (!route) {
    throw new StockerApiError(502, "DRIVING_NAVIGATION_FAILED", "Google Routes API returned no route");
  }
  const firstLeg = route.legs?.[0];
  return {
    encodedPolyline: route.polyline?.encodedPolyline ?? null,
    totalDistanceM: route.distanceMeters ?? null,
    totalDurationS: parseDurationS(route.duration),
    nextDistanceM: firstLeg?.distanceMeters ?? null,
    nextDurationS: parseDurationS(firstLeg?.duration),
    generatedAt: new Date().toISOString(),
  };
}

export async function optimizeRouteLocations(locations: LocationSummary[], shouldOptimize = true) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const routeLocations = assertRouteLocations(locations);
  if (routeLocations.length < 1) {
    throw new StockerApiError(400, "ROUTE_NO_LOCATIONS", "Select at least one location");
  }
  if (routeLocations.length === 1 || !apiKey) {
    return {
      optimizedLocationIds: routeLocations.map((location) => location.id),
      totalDistanceM: routeLocations.length === 1 ? 0 : null,
      totalDurationS: routeLocations.length === 1 ? 0 : null,
      encodedPolyline: null,
      legsData: null,
    };
  }

  const origin = routeLocations[0];
  const destination = routeLocations[routeLocations.length - 1];
  const intermediates = routeLocations.slice(1, -1);
  if (intermediates.length > 25) {
    throw new StockerApiError(400, "ROUTE_TOO_MANY_STOPS", "Google route optimization supports up to 25 intermediate stops");
  }

  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DRIVE_FIELD_MASK,
      "X-Server-Timeout": "10",
    },
    body: JSON.stringify({
      origin: toWaypoint(origin),
      destination: toWaypoint(destination),
      intermediates: intermediates.map(toWaypoint),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      optimizeWaypointOrder: shouldOptimize && intermediates.length > 0,
      polylineQuality: "HIGH_QUALITY",
      polylineEncoding: "ENCODED_POLYLINE",
      units: "IMPERIAL",
    }),
  });

  const data = (await response.json().catch(() => null)) as
    | {
        routes?: Array<{
          duration?: string;
          distanceMeters?: number;
          polyline?: { encodedPolyline?: string };
          optimizedIntermediateWaypointIndex?: number[];
          legs?: Array<{
            duration?: string;
            distanceMeters?: number;
            polyline?: { encodedPolyline?: string };
          }>;
        }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    throw new StockerApiError(502, "ROUTE_OPTIMIZATION_FAILED", data?.error?.message ?? "Google Routes API failed");
  }

  const route = data?.routes?.[0];
  if (!route) {
    throw new StockerApiError(502, "ROUTE_OPTIMIZATION_FAILED", "Google Routes API returned no route");
  }

  const optimizedLocationIds = [origin.id];
  if (shouldOptimize && route.optimizedIntermediateWaypointIndex?.length) {
    for (const index of route.optimizedIntermediateWaypointIndex) {
      const location = intermediates[index];
      if (location) optimizedLocationIds.push(location.id);
    }
  } else {
    optimizedLocationIds.push(...intermediates.map((location) => location.id));
  }
  optimizedLocationIds.push(destination.id);

  return {
    optimizedLocationIds,
    totalDistanceM: route.distanceMeters ?? null,
    totalDurationS: parseDurationS(route.duration),
    encodedPolyline: route.polyline?.encodedPolyline ?? null,
    legsData:
      route.legs?.map((leg) => ({
        distanceM: leg.distanceMeters ?? 0,
        durationS: parseDurationS(leg.duration),
        encodedPolyline: leg.polyline?.encodedPolyline ?? null,
      })) ?? null,
  };
}

export async function getWalkingGuidance(
  from: { lat: number; lng: number },
  location: LocationSummary,
): Promise<WalkingGuidanceData> {
  if (location.latitude == null || location.longitude == null) {
    throw new StockerApiError(400, "LOCATION_MISSING_COORDINATES", "Location is missing machine coordinates");
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  let walkingDistanceM = Math.round(haversineDistanceM(from, { lat: location.latitude, lng: location.longitude }));
  let walkingDurationS = 0;
  let encodedPolyline: string | null = null;

  if (apiKey) {
    const response = await fetch(ROUTES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": WALK_FIELD_MASK,
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: location.latitude, longitude: location.longitude } } },
        travelMode: "WALK",
        polylineQuality: "HIGH_QUALITY",
        polylineEncoding: "ENCODED_POLYLINE",
        units: "IMPERIAL",
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | {
          routes?: Array<{
            duration?: string;
            distanceMeters?: number;
            polyline?: { encodedPolyline?: string };
          }>;
        }
      | null;
    const route = response.ok ? data?.routes?.[0] : null;
    if (route) {
      walkingDistanceM = route.distanceMeters ?? walkingDistanceM;
      walkingDurationS = parseDurationS(route.duration);
      encodedPolyline = route.polyline?.encodedPolyline ?? null;
    }
  }

  return {
    walkingDistanceM,
    walkingDurationS,
    encodedPolyline,
    locationName: location.name,
    locationDescription: location.description,
    landmarks: location.landmarks,
    machineLocation: { lat: location.latitude, lng: location.longitude },
  };
}

export async function loadCurrentShift(stockerId: string, assignedDate: Date) {
  const shift = await prisma.stockerShift.findFirst({
    where: {
      stockerId,
      assignedDate,
      status: { in: ["pending", "active", "completed"] },
    },
    include: {
      route: true,
      stops: {
        include: {
          location: {
            select: {
              id: true,
              slug: true,
              name: true,
              address: true,
              city: true,
              state: true,
              latitude: true,
              longitude: true,
              venueCenterLat: true,
              venueCenterLng: true,
              geofenceRadiusM: true,
              description: true,
              landmarks: true,
            },
          },
        },
        orderBy: { stopOrder: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!shift) return null;
  const serialized = serializeShift(shift);
  const routeLocations = await getRouteLocations(shift.route.locationIds);
  serialized.route = { ...serializeRoute(shift.route), locations: routeLocations };
  serialized.stops = shift.stops.map(serializeStop);
  return serialized;
}

export async function assertStopForStocker(stockerId: string, stopId: string) {
  const stop = await prisma.stockerStop.findFirst({
    where: {
      id: stopId,
      shift: {
        stockerId,
        status: "active",
      },
    },
    include: {
      shift: true,
      location: {
        select: {
          id: true,
          slug: true,
          name: true,
          address: true,
          city: true,
          state: true,
          latitude: true,
          longitude: true,
          venueCenterLat: true,
          venueCenterLng: true,
          geofenceRadiusM: true,
          description: true,
          landmarks: true,
        },
      },
    },
  });
  if (!stop) {
    throw new StockerApiError(404, "STOP_NOT_FOUND", "Stop not found for active shift");
  }
  return stop;
}

export async function advanceToNextStop(shiftId: string, completedOrder: number, stockerId: string) {
  const nextStop = await prisma.stockerStop.findFirst({
    where: { shiftId, stopOrder: { gt: completedOrder }, status: { in: ["pending", "skipped"] } },
    orderBy: { stopOrder: "asc" },
    include: {
      location: {
        select: {
          id: true,
          slug: true,
          name: true,
          address: true,
          city: true,
          state: true,
          latitude: true,
          longitude: true,
          venueCenterLat: true,
          venueCenterLng: true,
          geofenceRadiusM: true,
          description: true,
          landmarks: true,
        },
      },
    },
  });
  if (!nextStop) {
    await prisma.stockerPosition.updateMany({
      where: { stockerId },
      data: { status: "idle", currentLocationName: null },
    });
    return null;
  }
  const updatedNext = await prisma.stockerStop.update({
    where: { id: nextStop.id },
    data: { status: "in_transit", departedPreviousAt: new Date() },
    include: { location: true },
  });
  await prisma.stockerPosition.updateMany({
    where: { stockerId },
    data: { status: "driving", currentLocationName: null },
  });
  return serializeStop(updatedNext);
}

export async function runPositionGeofenceChecks(params: {
  stockerId: string;
  shiftId: string;
  latitude: number;
  longitude: number;
}): Promise<{ status: string; currentLocationName: string | null; events: GeofenceEvent[] }> {
  const position = { lat: params.latitude, lng: params.longitude };
  const stops = await prisma.stockerStop.findMany({
    where: {
      shiftId: params.shiftId,
      status: { in: ["in_transit", "arrived"] },
    },
    include: { location: true },
    orderBy: { stopOrder: "asc" },
  });
  const events: GeofenceEvent[] = [];
  let status = "driving";
  let currentLocationName: string | null = null;

  for (const stop of stops) {
    if (stop.location.latitude == null || stop.location.longitude == null) continue;
    const distance = haversineDistanceM(position, { lat: stop.location.latitude, lng: stop.location.longitude });
    const venueLat = stop.location.venueCenterLat ?? stop.location.latitude;
    const venueLng = stop.location.venueCenterLng ?? stop.location.longitude;
    const venueDistance = haversineDistanceM(position, { lat: venueLat, lng: venueLng });
    const locationRadius = stop.location.geofenceRadiusM ?? 500;

    if (stop.status === "in_transit" && venueDistance <= locationRadius) {
      await prisma.stockerStop.update({
        where: { id: stop.id },
        data: { status: "arrived", arrivedAt: stop.arrivedAt ?? new Date() },
      });
      status = "at_location";
      currentLocationName = stop.location.name;
      events.push({
        type: "location_entered",
        stopId: stop.id,
        locationId: stop.locationId,
        locationName: stop.location.name,
      });
    }

    if ((stop.status === "arrived" || events.some((event) => event.stopId === stop.id)) && distance <= 15) {
      await prisma.stockerStop.update({
        where: { id: stop.id },
        data: { status: "restocking", taskStartedAt: stop.taskStartedAt ?? new Date() },
      });
      status = "restocking";
      currentLocationName = stop.location.name;
      events.push({
        type: "machine_reached",
        stopId: stop.id,
        locationId: stop.locationId,
        locationName: stop.location.name,
      });
    }
  }

  const activeStop = stops.find((stop) => stop.status === "arrived");
  if (activeStop && events.length === 0) {
    status = "at_location";
    currentLocationName = activeStop.location.name;
  }

  return { status, currentLocationName, events };
}

export function newId() {
  return randomUUID();
}

export function resolveAuthServiceUrl(): string | null {
  const explicit = process.env.AUTH_SERVICE_URL ?? process.env.NEXT_PUBLIC_AUTH_SERVICE_URL;
  if (explicit?.trim()) return explicit.trim().replace(/\/$/, "");
  const apiBase = process.env.TENKINGS_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (apiBase?.trim()) return `${apiBase.trim().replace(/\/$/, "")}/auth`;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  if (siteUrl?.trim()) return `${siteUrl.trim().replace(/\/$/, "")}/auth`;
  return null;
}

export async function proxyAuthService(path: string, body: unknown) {
  const authUrl = resolveAuthServiceUrl();
  if (!authUrl) {
    throw new StockerApiError(500, "AUTH_SERVICE_UNAVAILABLE", "Auth service URL is not configured");
  }
  const response = await fetch(`${authUrl}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new StockerApiError(response.status, "AUTH_SERVICE_ERROR", typeof payload === "string" ? payload : "Auth service request failed");
  }
  return payload;
}

export async function buildLiveStockerPositions(): Promise<LiveStockerPosition[]> {
  const positions = await prisma.stockerPosition.findMany({
    where: { status: { not: "idle" }, shiftId: { not: null } },
    include: {
      stocker: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const shiftIds = positions.map((position) => position.shiftId).filter((id): id is string => Boolean(id));
  const shifts = await prisma.stockerShift.findMany({
    where: { id: { in: shiftIds } },
    include: {
      route: true,
      stops: {
        include: {
          location: {
            select: {
              id: true,
              slug: true,
              name: true,
              address: true,
              city: true,
              state: true,
              latitude: true,
              longitude: true,
              venueCenterLat: true,
              venueCenterLng: true,
              geofenceRadiusM: true,
              description: true,
              landmarks: true,
            },
          },
        },
        orderBy: { stopOrder: "asc" },
      },
    },
  });
  const shiftLookup = new Map(shifts.map((shift) => [shift.id, shift]));

  return positions.map((position) => {
    const shift = position.shiftId ? shiftLookup.get(position.shiftId) : null;
    const stops = shift?.stops.map((stop) => ({ ...serializeStop(stop), location: serializeLocation(stop.location) })) ?? [];
    return {
      stockerId: position.stockerId,
      name: position.stocker.name,
      phone: position.stocker.phone,
      lat: position.latitude,
      lng: position.longitude,
      speed: position.speed,
      heading: position.heading,
      accuracy: position.accuracy,
      status: position.status as LiveStockerPosition["status"],
      shiftId: position.shiftId,
      currentLocationName: position.currentLocationName,
      updatedAt: position.updatedAt.toISOString(),
      shift: shift
        ? {
            id: shift.id,
            routeName: shift.route.name,
            clockInAt: shift.clockInAt?.toISOString() ?? null,
            totalStops: shift.stops.length,
            completedStops: shift.stops.filter((stop) => stop.status === "completed" || stop.status === "skipped").length,
            routePolyline: shift.route.encodedPolyline,
            stops,
          }
        : null,
    };
  });
}
