import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ONLINE_LOCATION_SLUG } from '../../lib/locationUtils';
import { createStaffInventoryPointCache, hasInventoryMapPoint, parseStaffInventoryMapPointResponse, summarizeInventoryLocations, type StaffInventoryMapItem, type StaffInventoryMapLocation, type StaffInventoryPointCache } from '../../lib/staffInventoryLocationsMap';
import styles from './StaffInventoryLocationBrowser.module.css';

const LocationsMap = dynamic(() => import('./StaffInventoryLocationsMap'), { ssr: false, loading: () => <div className={styles.loading} role="status">Opening your map…</div> });
type Point = Pick<StaffInventoryMapLocation, 'latitude' | 'longitude' | 'coordinateSource'>;
type Lookup = { point?: Point; message?: string };

export default function StaffInventoryLocationBrowser({ locations, items, token, pointCache: sharedPointCache, onViewInventory }: {
  locations: StaffInventoryMapLocation[];
  items: StaffInventoryMapItem[];
  token: string;
  pointCache?: StaffInventoryPointCache;
  onViewInventory(locationId: string): void;
}) {
  const [view, setView] = useState<'list' | 'map'>('list');
  const [lookups, setLookups] = useState<Record<string, Lookup>>({});
  const [resolving, setResolving] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const cache = useRef<Record<string, Lookup>>({});
  const localPointCache = useRef<StaffInventoryPointCache>();
  if (!localPointCache.current) localPointCache.current = createStaffInventoryPointCache();
  const pointCache = sharedPointCache ?? localPointCache.current;
  const lookupKey = (location: StaffInventoryMapLocation) => JSON.stringify([location.id, location.address]);
  // Only location/address changes restart lookups; inventory refreshes do not repeat provider calls.
  const candidateSignature = JSON.stringify(locations.filter(location => !hasInventoryMapPoint(location) && location.slug !== ONLINE_LOCATION_SLUG && location.address?.trim()).map(location => [location.id, location.address]));

  useEffect(() => {
    if (view !== 'map') return;
    const controller = new AbortController();
    const entries = JSON.parse(candidateSignature) as [string, string][];
    const reused: Record<string, Lookup> = {};
    for (const [id, address] of entries) {
      const point = pointCache.get({ id, address, name: '', slug: '', locationType: null });
      if (point) { const key = JSON.stringify([id, address]); cache.current[key] = { point }; reused[key] = { point }; }
    }
    if (Object.keys(reused).length) setLookups(previous => ({ ...previous, ...reused }));
    const candidates = entries.filter(entry => !cache.current[JSON.stringify(entry)]);
    setResolving(candidates.map(([id]) => id));
    let next = 0;
    const work = async () => {
      while (!controller.signal.aborted && next < candidates.length) {
        const [id, address] = candidates[next++];
        const key = JSON.stringify([id, address]);
        let result: Lookup;
        try {
          const response = await fetch(`/api/v2/admin/inventory/location-map?location_id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' });
          const body = await response.json();
          if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Sign in again to view this map point.' : 'Map point unavailable. Please try again.');
          const point = parseStaffInventoryMapPointResponse(id, body);
          result = point
            ? { point }
            : { message: typeof body.message === 'string' ? body.message : 'Map point unavailable. Check the saved address.' };
        } catch (error) {
          if (controller.signal.aborted) return;
          result = { message: error instanceof Error ? error.message : 'Map point unavailable. Please try again.' };
        }
        if (controller.signal.aborted) return;
        if (result.point && typeof result.point.latitude === 'number' && typeof result.point.longitude === 'number') pointCache.set({ id, address, name: '', slug: '', locationType: null }, { latitude: result.point.latitude, longitude: result.point.longitude, coordinateSource: result.point.coordinateSource });
        cache.current[key] = result;
        setLookups(previous => ({ ...previous, [key]: result }));
        setResolving(previous => previous.filter(locationId => locationId !== id));
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, candidates.length) }, work));
    return () => controller.abort();
  }, [view, candidateSignature, token, retry, pointCache]);

  const merged = locations.map(location => hasInventoryMapPoint(location) ? { ...location, coordinateSource: 'saved' as const } : { ...location, ...(pointCache.get(location) ?? lookups[lookupKey(location)]?.point) });
  const errors = Object.fromEntries(locations.flatMap(location => {
    const message = lookups[lookupKey(location)]?.message;
    return !hasInventoryMapPoint(location) && !pointCache.get(location) && message ? [[location.id, message]] : [];
  }));
  const summaries = useMemo(() => summarizeInventoryLocations(locations, items), [locations, items]);

  return <section className={styles.browser} aria-label="Browse inventory locations">
    <div className={styles.toolbar}>
      <div><strong>All locations</strong><span className={styles.count}>{locations.length}</span></div>
      <div className={styles.switcher} role="group" aria-label="Location view">
        <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z" /></svg>List</button>
        <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16" /></svg>Map</button>
      </div>
    </div>
    {view === 'map' ? <>
      <LocationsMap locations={merged} items={items} onViewInventory={onViewInventory} resolvingLocationIds={resolving} locationErrors={errors} />
      {Object.keys(errors).length > 0 && <div className={styles.retry}><span>Some locations could not be placed on the map.</span><button type="button" disabled={resolving.length > 0} onClick={() => {
        for (const location of locations) if (errors[location.id]) delete cache.current[lookupKey(location)];
        setRetry(value => value + 1);
      }}>Retry map points</button></div>}
    </> : summaries.length ? <div className={styles.grid}>{summaries.map(summary => <button key={summary.location.id} className={styles.card} onClick={() => onViewInventory(summary.location.id)}>
      <span className={styles.pin}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>
      <h3>{summary.location.name}</h3><p>{summary.location.address || 'Address not added'}</p>
      <div className={styles.cardFoot}><strong>{summary.onHandQuantity?.toLocaleString() ?? '—'}</strong><span>recorded on hand</span><span aria-hidden="true">→</span></div>
      {(summary.machineRosterQuantity ?? 0) > 0 && <small>Also has machine loading records</small>}
    </button>)}</div> : <p className={styles.loading}>Add your first location to give your inventory a home.</p>}
  </section>;
}
