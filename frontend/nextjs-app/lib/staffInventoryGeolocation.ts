import { ONLINE_LOCATION_SLUG } from './locationUtils';
import { haversineDistance } from './geo';
import { createStaffInventoryPointCache, hasInventoryMapPoint, type StaffInventoryMapLocation, type StaffInventoryMapPoint, type StaffInventoryPointCache } from './staffInventoryLocationsMap';

export type StaffIntakeLocation = StaffInventoryMapLocation & { geofenceRadiusM?: number | null };
export type StaffLocationFix = { latitude: number; longitude: number; accuracy: number; timestamp: number };
export type StaffLocationStatus = 'matched' | 'inaccurate' | 'stale' | 'invalid' | 'ambiguous' | 'no_nearby' | 'unmapped' | 'denied' | 'unavailable' | 'cancelled';
export type StaffLocationMatch = {
  location: StaffIntakeLocation | null;
  message: string;
  status: StaffLocationStatus;
  confidence: 'contained' | 'nearby' | null;
  accuracyM: number | null;
  distanceM: number | null;
  unresolvedLocations: number;
};
export type StaffLocationProgress = {
  phase: 'locating' | 'checking_locations' | 'matching';
  accuracyM: number | null;
  checkedLocations: number;
  totalLocations: number;
  message: string;
};

const emptyMatch = (status: StaffLocationStatus, message: string): StaffLocationMatch => ({ location: null, message, status, confidence: null, accuracyM: null, distanceM: null, unresolvedLocations: 0 });
const radiusFor = (location: StaffIntakeLocation) => typeof location.geofenceRadiusM === 'number' && Number.isFinite(location.geofenceRadiusM) && location.geofenceRadiusM > 0 ? Math.min(1000, location.geofenceRadiusM) : 150;

export function matchStaffInventoryLocation(fix: StaffLocationFix, locations: StaffIntakeLocation[], now = Date.now()): StaffLocationMatch {
  const physical = locations.filter(location => location.slug !== ONLINE_LOCATION_SLUG);
  const mapped = physical.filter(hasInventoryMapPoint);
  const base = { ...emptyMatch('no_nearby', ''), accuracyM: Number.isFinite(fix.accuracy) && fix.accuracy >= 0 ? Math.ceil(fix.accuracy) : null, unresolvedLocations: physical.length - mapped.length };
  if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90 || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180 || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || !Number.isFinite(fix.timestamp)) return { ...base, status: 'invalid', message: 'Your phone returned an unusable position. Try Use my location again or choose a location below.' };
  if (now - fix.timestamp > 300_000 || fix.timestamp > now + 30_000) return { ...base, status: 'stale', message: 'Your phone position is out of date. Try Use my location again or choose a location below.' };
  if (!mapped.length) return { ...base, status: 'unmapped', message: 'No location map points are available yet. Choose your location below.' };
  const entries = mapped.map(location => ({ location, distance: haversineDistance(fix.latitude, fix.longitude, location.latitude, location.longitude), radius: radiusFor(location) }));
  const nearby = entries.filter(entry => entry.distance - fix.accuracy <= entry.radius);
  const candidates = nearby.filter(entry => entry.distance <= entry.radius && fix.accuracy <= entry.radius);
  if (!candidates.length && (nearby.some(entry => fix.accuracy > entry.radius) || entries.every(entry => fix.accuracy > entry.radius))) return { ...base, status: 'inaccurate', message: `Your phone position is accurate to about ${base.accuracyM} m, which is too broad for a nearby location. Enable precise location or choose your location below.` };
  if (nearby.length > 1) return { ...base, status: 'ambiguous', message: `You are near more than one location (phone accuracy about ${base.accuracyM} m). Choose the right one below.` };
  const candidate = candidates[0];
  if (!candidate) return { ...base, message: `No clear nearby location match (phone accuracy about ${base.accuracyM} m). Choose your location below.` };
  const confidence = base.unresolvedLocations === 0 && candidate.distance + fix.accuracy <= candidate.radius ? 'contained' : 'nearby';
  const coverage = base.unresolvedLocations > 0 ? ` ${base.unresolvedLocations} other ${base.unresolvedLocations === 1 ? 'location could' : 'locations could'} not be checked.` : '';
  return { ...base, location: candidate.location, status: 'matched', confidence, distanceM: Math.round(candidate.distance), message: `${confidence === 'contained' ? 'Near' : 'Suggested nearby location:'} ${candidate.location.name} (phone accuracy about ${base.accuracyM} m).${coverage} Check this is where you are adding stock before saving.` };
}

export function staffInventoryLocationKind(location: StaffIntakeLocation, items: { location_id: string | null; custody_id: string | null; quantity_kind: string }[]) {
  if (['hq', 'store', 'kiosk'].includes(location.locationType ?? '')) return location.locationType!;
  const kinds = [...new Set(items.filter(item => item.location_id === location.id && item.quantity_kind === 'on_hand').map(item => item.custody_id?.split(':')[0]).filter(kind => ['hq', 'store', 'kiosk'].includes(kind ?? '')))];
  return kinds.length === 1 ? kinds[0]! : '';
}

/** One entry-session locator; raw phone positions and address matches remain in memory. */
export function createStaffInventoryLocator(deps: {
  getPosition: (signal: AbortSignal) => Promise<StaffLocationFix>;
  resolvePoint: (id: string, signal: AbortSignal) => Promise<StaffInventoryMapPoint | null>;
  pointCache?: StaffInventoryPointCache;
  now?: () => number;
  resolutionBudgetMs?: number;
}) {
  let cachedFix: StaffLocationFix | null = null;
  let permissionDenied = false;
  const pointCache = deps.pointCache ?? createStaffInventoryPointCache();
  return async (locations: StaffIntakeLocation[], signal: AbortSignal, retryPermission = false, onProgress?: (progress: StaffLocationProgress) => void): Promise<StaffLocationMatch> => {
    if (signal.aborted) return emptyMatch('cancelled', '');
    if (permissionDenied && !retryPermission) return emptyMatch('denied', 'Location access is off. Choose your location once below.');
    const now = deps.now?.() ?? Date.now();
    let position = !retryPermission && cachedFix && now - cachedFix.timestamp <= 300_000 && cachedFix.timestamp <= now + 30_000 ? cachedFix : null;
    const resolved = locations.map(location => ({ ...location, ...pointCache.get(location) }));
    const totalLocations = resolved.filter(location => location.slug !== ONLINE_LOCATION_SLUG).length;
    let checkedLocations = resolved.filter(hasInventoryMapPoint).length;
    const notify = (phase: StaffLocationProgress['phase'], message: string) => {
      if (!signal.aborted) onProgress?.({ phase, accuracyM: position && Number.isFinite(position.accuracy) && position.accuracy >= 0 ? Math.ceil(position.accuracy) : null, checkedLocations, totalLocations, message });
    };
    notify(position ? 'checking_locations' : 'locating', position ? 'Checking nearby inventory locations…' : 'Finding your phone position…');
    // Lookup order never changes the matching policy; a known HQ should not wait behind distant address reads.
    const pending = resolved.filter(location => location.slug !== ONLINE_LOCATION_SLUG && !hasInventoryMapPoint(location) && location.address?.trim()).sort((a, b) => Number(b.locationType === 'hq') - Number(a.locationType === 'hq'));
    const controller = new AbortController();
    let stop!: () => void;
    const stopped = new Promise<void>(resolve => { stop = () => { controller.abort(); resolve(); }; });
    signal.addEventListener('abort', stop, { once: true });
    const budget = typeof deps.resolutionBudgetMs === 'number' && Number.isFinite(deps.resolutionBudgetMs) ? Math.max(1, Math.min(8000, deps.resolutionBudgetMs)) : 8000;
    const timer = setTimeout(stop, budget);
    let next = 0;
    const work = async () => {
      while (next < pending.length && !controller.signal.aborted) {
        const location = pending[next++];
        let point: StaffInventoryMapPoint | null = null;
        try { point = await deps.resolvePoint(location.id, controller.signal); } catch { /* Failed reads remain unmapped. Provider details never enter the UI. */ }
        if (controller.signal.aborted) return;
        if (point && hasInventoryMapPoint({ ...location, ...point })) {
          pointCache.set(location, point);
          Object.assign(location, point);
        }
        checkedLocations++;
        if (position) notify('checking_locations', `Checking inventory locations (${checkedLocations}/${totalLocations})…`);
      }
    };
    // Address reads run alongside phone refinement and share one deadline, including an unresponsive resolver.
    const resolving = Promise.race([Promise.all(Array.from({ length: Math.min(3, pending.length) }, work)), stopped]).finally(() => { clearTimeout(timer); controller.abort(); });
    let cancelPosition!: () => void;
    const cancelledPosition = new Promise<null>(resolve => { cancelPosition = () => resolve(null); });
    signal.addEventListener('abort', cancelPosition, { once: true });
    try {
      if (!position) {
        try {
          position = await Promise.race([deps.getPosition(signal), cancelledPosition]);
          if (signal.aborted || !position) return emptyMatch('cancelled', '');
          permissionDenied = false;
        } catch (error) {
          if (signal.aborted) return emptyMatch('cancelled', '');
          permissionDenied = !!error && typeof error === 'object' && 'code' in error && error.code === 1;
          return emptyMatch(permissionDenied ? 'denied' : 'unavailable', permissionDenied ? 'Location access is off. Choose your location once below.' : 'Your phone could not find its position. Choose your location below.');
        }
      }
      if (signal.aborted) return emptyMatch('cancelled', '');
      notify('checking_locations', 'Checking nearby inventory locations…');
      await resolving;
      if (signal.aborted) return emptyMatch('cancelled', '');
      const match = matchStaffInventoryLocation(position, resolved, deps.now?.() ?? Date.now());
      cachedFix = ['matched', 'ambiguous', 'no_nearby'].includes(match.status) ? position : null;
      notify('matching', match.message);
      return match;
    } finally {
      stop(); clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      signal.removeEventListener('abort', cancelPosition);
    }
  };
}
