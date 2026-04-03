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

export function isWithinGeofence(
  userLat: number,
  userLng: number,
  centerLat: number,
  centerLng: number,
  radiusM: number,
): boolean {
  return haversineDistance(userLat, userLng, centerLat, centerLng) <= radiusM;
}

export function metersToFeet(distanceM: number): number {
  return Math.round(distanceM * 3.28084);
}

export function estimateWalkingTimeMin(distanceM: number): number {
  return Math.max(1, Math.ceil(distanceM / 84));
}
