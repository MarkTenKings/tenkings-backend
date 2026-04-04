import type { KingsHuntLocation, LatLng } from "./kingsHunt";

export interface GeofenceCheck {
  isInside: boolean;
  distanceM: number;
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusM = 6_371_000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;

  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function distanceBetween(start: LatLng, end: LatLng): number {
  return haversineDistance(start.lat, start.lng, end.lat, end.lng);
}

export function isWithinRadius(
  userLat: number,
  userLng: number,
  centerLat: number,
  centerLng: number,
  radiusM: number,
): boolean {
  return haversineDistance(userLat, userLng, centerLat, centerLng) <= radiusM;
}

export function checkGeofence(
  location: Pick<KingsHuntLocation, "venueCenterLat" | "venueCenterLng" | "geofenceRadiusM">,
  position: LatLng,
): GeofenceCheck | null {
  if (typeof location.venueCenterLat !== "number" || typeof location.venueCenterLng !== "number") {
    return null;
  }

  const distanceM = haversineDistance(position.lat, position.lng, location.venueCenterLat, location.venueCenterLng);
  return {
    isInside: distanceM <= (location.geofenceRadiusM ?? 500),
    distanceM,
  };
}

export function checkArrival(position: LatLng, destination: LatLng, arrivalRadiusM = 20): boolean {
  return distanceBetween(position, destination) <= arrivalRadiusM;
}

export function estimateWalkingTimeMin(distanceM: number): number {
  return Math.max(1, Math.ceil(distanceM / 84));
}
