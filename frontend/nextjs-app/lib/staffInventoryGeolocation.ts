import { ONLINE_LOCATION_SLUG } from './locationUtils';
import { haversineDistance } from './geo';
import { hasInventoryMapPoint, type StaffInventoryMapLocation } from './staffInventoryLocationsMap';

export type StaffIntakeLocation = StaffInventoryMapLocation & { geofenceRadiusM?: number | null };
export type StaffLocationFix = { latitude: number; longitude: number; accuracy: number; timestamp: number };
export type StaffLocationMatch = { location: StaffIntakeLocation | null; message: string };

export function matchStaffInventoryLocation(fix: StaffLocationFix, locations: StaffIntakeLocation[], now = Date.now()): StaffLocationMatch {
  if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90 || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180 || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 100 || !Number.isFinite(fix.timestamp) || now - fix.timestamp > 300_000 || fix.timestamp > now + 30_000) {
    return { location: null, message: 'Your position is not precise enough. Choose your location once below.' };
  }
  const nearby = locations.filter((location): location is StaffIntakeLocation & { latitude: number; longitude: number } => hasInventoryMapPoint(location)).map(location => ({ location, distance: haversineDistance(fix.latitude, fix.longitude, location.latitude, location.longitude), radius: typeof location.geofenceRadiusM === 'number' && location.geofenceRadiusM > 0 ? Math.min(1000, location.geofenceRadiusM) : 150 }))
    .filter(entry => entry.distance - fix.accuracy <= entry.radius);
  if (nearby.length === 1 && nearby[0].distance + fix.accuracy <= nearby[0].radius) return { location: nearby[0].location, message: `Near ${nearby[0].location.name}. Check this is where you are adding stock.` };
  return { location: null, message: nearby.length > 1 ? 'You are near more than one location. Choose the right one below.' : 'No clear location match. Choose your location once below.' };
}

export function staffInventoryLocationKind(location: StaffIntakeLocation, items: { location_id: string | null; custody_id: string | null; quantity_kind: string }[]) {
  if (['hq', 'store', 'kiosk'].includes(location.locationType ?? '')) return location.locationType!;
  const kinds = [...new Set(items.filter(item => item.location_id === location.id && item.quantity_kind === 'on_hand').map(item => item.custody_id?.split(':')[0]).filter(kind => ['hq', 'store', 'kiosk'].includes(kind ?? '')))];
  return kinds.length === 1 ? kinds[0]! : '';
}

/** One entry-session locator; raw phone positions and address matches remain in memory. */
export function createStaffInventoryLocator(deps: {
  getPosition: () => Promise<StaffLocationFix>;
  resolvePoint: (id: string, signal: AbortSignal) => Promise<{ latitude: number; longitude: number; coordinateSource?: 'saved' | 'address_lookup' } | null>;
  now?: () => number;
}) {
  let cachedFix: StaffLocationFix | null = null;
  let permissionDenied = false;
  const points = new Map<string, { latitude: number; longitude: number; coordinateSource?: 'saved' | 'address_lookup' }>();
  return async (locations: StaffIntakeLocation[], signal: AbortSignal, retryPermission = false): Promise<StaffLocationMatch> => {
    if (signal.aborted) return { location: null, message: '' };
    if (permissionDenied && !retryPermission) return { location: null, message: 'Location access is off. Choose your location once below.' };
    const now = deps.now?.() ?? Date.now();
    if (retryPermission || !cachedFix || now - cachedFix.timestamp > 300_000) {
      try {
        const position = await deps.getPosition();
        if (signal.aborted) return { location: null, message: '' };
        cachedFix = position; permissionDenied = false;
      }
      catch (error) {
        if (signal.aborted) return { location: null, message: '' };
        permissionDenied = !!error && typeof error === 'object' && 'code' in error && error.code === 1;
        return { location: null, message: permissionDenied ? 'Location access is off. Choose your location once below.' : 'Your phone could not find its position. Choose your location below.' };
      }
    }
    if (signal.aborted) return { location: null, message: '' };
    const resolved = locations.map(location => ({ ...location }));
    let next = 0;
    const work = async () => {
      while (next < resolved.length && !signal.aborted) {
        const location = resolved[next++];
        if (location.slug === ONLINE_LOCATION_SLUG || hasInventoryMapPoint(location) || !location.address?.trim()) continue;
        const key = JSON.stringify([location.id, location.address]);
        let point = points.get(key);
        if (!point) {
          try { point = await deps.resolvePoint(location.id, signal) ?? undefined; } catch { /* A failed lookup stays unmapped and never becomes an invented point. */ }
          if (point && !signal.aborted && hasInventoryMapPoint({ ...location, ...point })) points.set(key, point);
        }
        if (point) Object.assign(location, point);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, resolved.length) }, work));
    if (signal.aborted) return { location: null, message: '' };
    if (resolved.some(location => location.slug !== ONLINE_LOCATION_SLUG && !hasInventoryMapPoint(location))) return { location: null, message: 'Some location addresses could not be checked. Choose your location below.' };
    return matchStaffInventoryLocation(cachedFix, resolved, deps.now?.() ?? Date.now());
  };
}
