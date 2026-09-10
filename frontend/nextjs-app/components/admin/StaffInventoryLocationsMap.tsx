'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useGoogleMaps } from '../../hooks/useGoogleMaps';
import {
  groupInventoryMapPoints, hasInventoryMapPoint, summarizeInventoryLocations,
  type InventoryLocationSummary, type InventoryMapGroup, type StaffInventoryMapItem, type StaffInventoryMapLocation,
} from '../../lib/staffInventoryLocationsMap';
import { ONLINE_LOCATION_SLUG } from '../../lib/locationUtils';
import styles from './StaffInventoryLocationsMap.module.css';

export type { StaffInventoryMapLocation } from '../../lib/staffInventoryLocationsMap';
export type StaffInventoryLocationsMapProps = {
  locations: StaffInventoryMapLocation[];
  items: StaffInventoryMapItem[];
  onViewInventory: (locationId: string) => void;
  resolvingLocationIds?: string[];
  locationErrors?: Record<string, string>;
};

const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
const count = (value: number | null) => value === null ? '—' : value.toLocaleString();
const locationKind = (location: StaffInventoryMapLocation) => location.slug === ONLINE_LOCATION_SLUG ? 'Online' :
  ({ hq: 'HQ / storage', store: 'Store', kiosk: 'Kiosk', machine: 'Vending machine' }[location.locationType ?? ''] ?? 'Location');

function MapIcon({ name = 'pin' }: { name?: 'pin' | 'fit' | 'arrow' | 'layers' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'fit' ? <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5M9 12h6m-3-3v6" /> : name === 'arrow' ? <path d="M4 12h16m-6-6 6 6-6 6" /> : name === 'layers' ? <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></> : <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>}
  </svg>;
}

function fitLocations(map: google.maps.Map, locations: StaffInventoryMapLocation[]) {
  const points = locations.filter(hasInventoryMapPoint);
  if (!points.length) return;
  if (points.every(location => location.latitude === points[0].latitude && location.longitude === points[0].longitude)) {
    map.setCenter({ lat: points[0].latitude, lng: points[0].longitude });
    map.setZoom(13);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  points.forEach(location => bounds.extend({ lat: location.latitude, lng: location.longitude }));
  map.fitBounds(bounds, 72);
}

function markerContent(group: InventoryMapGroup) {
  const node = document.createElement('div');
  node.className = group.locations.length > 1 ? styles.clusterPin : styles.pin;
  node.dataset.selected = 'false';
  const glyph = document.createElement('span');
  glyph.textContent = group.locations.length > 1 ? String(group.locations.length) : 'TK';
  node.appendChild(glyph);
  return node;
}

function InventoryMapCanvas({ locations, selectedId, focusRequest, onSelect, onGroup }: {
  locations: StaffInventoryMapLocation[];
  selectedId: string | null;
  focusRequest: { id: string } | null;
  onSelect: (id: string) => void;
  onGroup: (ids: string[]) => void;
}) {
  const { isLoaded, libraries, loadError } = useGoogleMaps();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef<{ marker: google.maps.marker.AdvancedMarkerElement; node: HTMLDivElement; ids: string[] }[]>([]);
  const callbacks = useRef({ onSelect, onGroup });
  const [mapError, setMapError] = useState(false);
  const [zoom, setZoom] = useState(4);
  const groups = useMemo(() => groupInventoryMapPoints(locations, zoom), [locations, zoom]);
  const pointSignature = JSON.stringify(locations.filter(hasInventoryMapPoint).map(location => [location.id, location.latitude, location.longitude]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

  useEffect(() => { callbacks.current = { onSelect, onGroup }; }, [onSelect, onGroup]);

  useEffect(() => {
    if (!isLoaded || !libraries || !container.current) return;
    let instance: google.maps.Map;
    try {
      if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID) throw new Error('Map configuration unavailable');
      instance = new libraries.mapsLibrary.Map(container.current, {
        center: { lat: 39.8283, lng: -98.5795 }, zoom: 4, minZoom: 2, maxZoom: 19,
        mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID,
        colorScheme: 'LIGHT', disableDefaultUI: true, zoomControl: true,
        streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
        gestureHandling: 'cooperative', tilt: 0, heading: 0, clickableIcons: false,
      });
      map.current = instance;
      instance.addListener('zoom_changed', () => setZoom(instance.getZoom() ?? 4));
    } catch {
      setMapError(true);
      return;
    }
    return () => {
      google.maps.event.clearInstanceListeners(instance);
      map.current = null;
    };
  }, [isLoaded, libraries]);

  useEffect(() => {
    if (map.current) fitLocations(map.current, locations);
    // Only coordinate changes refit. Inventory refreshes and marker selections preserve the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, libraries, pointSignature]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !libraries || mapError) return;
    const created: typeof markers.current = [];
    try {
      for (const group of groups) {
        const node = markerContent(group);
        const marker = new libraries.markerLibrary.AdvancedMarkerElement({
          map: instance, position: group.position, content: node, gmpClickable: true,
          title: group.locations.length === 1 ? `${group.locations[0].name}. View inventory summary.` :
            `${group.locations.length} nearby locations: ${group.locations.map(location => location.name).join(', ')}. Choose a location.`,
        });
        marker.addListener('click', () => {
          if (group.locations.length === 1) {
            callbacks.current.onSelect(group.locations[0].id);
          } else {
            callbacks.current.onGroup(group.locations.map(location => location.id));
            const first = group.locations[0];
            const sharedPoint = group.locations.every(location => location.latitude === first.latitude && location.longitude === first.longitude);
            if (!sharedPoint) {
              instance.panTo(group.position);
              instance.setZoom(Math.min(19, (instance.getZoom() ?? 4) + 2));
            }
          }
        });
        created.push({ marker, node, ids: group.locations.map(location => location.id) });
      }
      markers.current = created;
    } catch {
      setMapError(true);
    }
    return () => {
      created.forEach(({ marker }) => { google.maps.event.clearInstanceListeners(marker); marker.map = null; });
      if (markers.current === created) markers.current = [];
    };
  }, [groups, libraries, isLoaded, mapError]);

  useEffect(() => {
    markers.current.forEach(({ node, marker, ids }) => {
      const selected = selectedId !== null && ids.includes(selectedId);
      node.dataset.selected = String(selected);
      marker.zIndex = selected ? 1000 : 1;
    });
  }, [selectedId, groups, libraries, isLoaded]);

  useEffect(() => {
    if (!focusRequest || !map.current) return;
    const location = locations.find(candidate => candidate.id === focusRequest.id);
    if (!location || !hasInventoryMapPoint(location)) return;
    map.current.panTo({ lat: location.latitude, lng: location.longitude });
    if ((map.current.getZoom() ?? 4) < 13) map.current.setZoom(13);
    // A fresh inventory read with unchanged coordinates must not move the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, pointSignature, isLoaded, libraries]);

  return <div className={styles.mapFrame}>
    <div ref={container} className={styles.canvas} aria-label="Inventory locations map" />
    {(loadError || mapError || !isLoaded) && <div className={styles.mapMessage} role="status">
      <span className={styles.messageIcon}><MapIcon /></span>
      <strong>{loadError || mapError ? 'Map temporarily unavailable' : 'Finding your locations'}</strong>
      <p>{loadError || mapError ? 'Choose any location above to see its inventory.' : 'Loading the location map…'}</p>
    </div>}
    {isLoaded && !loadError && !mapError && <>
      <button type="button" className={styles.fitButton} onClick={() => map.current && fitLocations(map.current, locations)}><MapIcon name="fit" />Fit all locations</button>
      <div className={styles.legend}><span className={styles.legendDot} />Location<span className={styles.legendCluster}>2</span>Nearby locations</div>
    </>}
  </div>;
}

function LocationSummary({ summary, onViewInventory, resolving, error }: {
  summary: InventoryLocationSummary; onViewInventory: (id: string) => void; resolving: boolean; error?: string;
}) {
  const { location } = summary;
  const hasOnHand = summary.onHandQuantity !== null && summary.onHandQuantity > 0;
  const hasRoster = summary.machineRosterQuantity !== null && summary.machineRosterQuantity > 0;
  return <section className={styles.details} aria-label={`${location.name} inventory summary`}>
    <div className={styles.detailHeading}>
      <span className={styles.eyebrow}>{locationKind(location)}{location.locationType === 'hq' ? ' · Team only' : ''}</span>
      <h3>{location.name}</h3><p>{location.address}</p>
      {location.coordinateSource === 'address_lookup' && hasInventoryMapPoint(location) && <p className={styles.pointProvenance}>Pin placed from saved address</p>}
      {!hasInventoryMapPoint(location) && location.slug !== ONLINE_LOCATION_SLUG && <p className={styles.pointStatus} role="status">{resolving ? 'Finding this address on the map…' : error || 'Map point unavailable. Inventory is still available below.'}</p>}
    </div>
    {summary.groupCount ? <>
      <div className={styles.quantity}>
        <span>Recorded on hand</span><strong>{hasOnHand ? count(summary.onHandQuantity) : '—'}<small>{hasOnHand ? 'cards' : 'No held-stock records'}</small></strong>
      </div>
      {hasRoster && <div className={styles.machineNote}><MapIcon name="layers" /><div><strong>{count(summary.machineRosterQuantity)} in machine loading rosters</strong><p>Loading records do not establish what remains. Physical counts are listed separately.</p></div></div>}
      {hasOnHand && <>
        <div className={styles.valueHeader}>Recorded on-hand value</div>
        <dl className={styles.values}>
          <div><dt>Acquisition cost</dt><dd>{money(summary.costCents)}</dd></div>
          <div><dt>Expected sales</dt><dd>{money(summary.expectedSalesCents)}</dd></div>
          <div className={styles.profitRow}><dt>Expected gross profit</dt><dd data-negative={summary.expectedProfitCents !== null && summary.expectedProfitCents < 0}>{money(summary.expectedProfitCents)}</dd></div>
          <div><dt>Expected margin</dt><dd>{summary.expectedMarginPct === null ? '—' : `${summary.expectedMarginPct.toFixed(1)}%`}</dd></div>
        </dl>
        <p className={styles.valueNote}>Before fees and overhead. Based on recorded on-hand cards only.</p>
        {(summary.costCents === null || summary.expectedSalesCents === null) && <p className={styles.coverage}>Cost entered for {count(summary.costedQuantity)} of {count(summary.onHandQuantity)} cards · price entered for {count(summary.pricedQuantity)} of {count(summary.onHandQuantity)}.</p>}
      </>}
      {!!summary.counts.length && <details className={styles.counts}><summary>Latest physical counts <span>{summary.counts.length}</span></summary><ul>{summary.counts.map(observation => <li key={observation.event_id}><strong>{count(observation.quantity)} cards <span>{new Date(observation.at).toLocaleDateString()}</span></strong><p>Machine {observation.scope.machine_id} · Product {observation.scope.product_id}{observation.scope.door_id ? ` · Slot ${observation.scope.door_id}` : ' · All slots'}</p></li>)}</ul></details>}
    </> : <div className={styles.noInventory}><MapIcon name="layers" /><h4>No stock recorded here yet</h4><p>Add inventory or move recorded stock to this location to see it here.</p></div>}
    <button type="button" className={styles.viewButton} onClick={() => onViewInventory(location.id)}>View inventory<MapIcon name="arrow" /></button>
  </section>;
}

export default function StaffInventoryLocationsMap({ locations, items, onViewInventory, resolvingLocationIds = [], locationErrors = {} }: StaffInventoryLocationsMapProps) {
  const selectorId = useId();
  const summaries = useMemo(() => summarizeInventoryLocations(locations, items), [locations, items]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  const selected = summaries.find(summary => summary.location.id === selectedId) ?? summaries.find(summary => (summary.onHandQuantity ?? 0) > 0) ?? summaries[0];
  const selectedGroup = summaries.filter(summary => groupIds.includes(summary.location.id));
  const mappedLocations = useMemo(() => locations.filter(hasInventoryMapPoint), [locations]);
  const choose = (id: string) => { setSelectedId(id); setGroupIds([]); setFocusRequest({ id }); };
  const unavailableCount = locations.filter(location => location.slug !== ONLINE_LOCATION_SLUG && !hasInventoryMapPoint(location)).length;

  return <div className={styles.workspace}>
    <div className={styles.toolbar}>
      <div><span className={styles.eyebrow}>Inventory across your locations</span><p>{mappedLocations.length} mapped{unavailableCount ? ` · ${unavailableCount} ${resolvingLocationIds.length ? 'awaiting a map point' : 'without a map point'}` : ''}</p></div>
      {!!locations.length && <label className={styles.selector} htmlFor={selectorId}><span>Explore a location</span><select id={selectorId} value={selectedGroup.length > 1 ? '' : selected?.location.id ?? ''} onChange={event => choose(event.target.value)}>
        {selectedGroup.length > 1 && <option value="" disabled>Choose a nearby location</option>}
        {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select></label>}
    </div>
    <div className={styles.layout}>
      {mappedLocations.length ? <InventoryMapCanvas locations={mappedLocations} selectedId={selectedGroup.length > 1 ? null : selected?.location.id ?? null} focusRequest={focusRequest} onSelect={choose} onGroup={setGroupIds} /> : <div className={`${styles.mapFrame} ${styles.emptyMap}`} role="status"><span className={styles.messageIcon}><MapIcon /></span><h3>{resolvingLocationIds.length ? 'Finding your locations' : 'Your location map starts here'}</h3><p>{resolvingLocationIds.length ? 'Matching recorded addresses to map points…' : locations.length ? 'Locations with a map point will appear here. Choose a location to view its inventory.' : 'Add a location to see your inventory on the map.'}</p></div>}
      <div className={styles.inspector} aria-live="polite">
        {selectedGroup.length > 1 ? <section className={styles.groupDetails} aria-label="Nearby locations"><span className={styles.eyebrow}>Explore this area</span><h3>{selectedGroup.length} nearby locations</h3><p>Choose a location to view its stock.</p><ul>{selectedGroup.map(summary => <li key={summary.location.id}><button type="button" onClick={() => choose(summary.location.id)}><span className={styles.smallPin}><MapIcon /></span><span><strong>{summary.location.name}</strong><small>{summary.location.address}</small><span className={styles.groupQuantity}>{(summary.onHandQuantity ?? 0) > 0 ? `${count(summary.onHandQuantity)} recorded on hand` : summary.groupCount ? 'Machine loading records' : 'No stock recorded'}</span></span><MapIcon name="arrow" /></button></li>)}</ul></section> : selected ? <LocationSummary summary={selected} onViewInventory={onViewInventory} resolving={resolvingLocationIds.includes(selected.location.id)} error={locationErrors[selected.location.id]} /> : <section className={styles.details}><span className={styles.eyebrow}>Your network</span><h3>Every location. One inventory.</h3><p className={styles.valueNote}>Stores, kiosks and private storage will appear here as you add them.</p></section>}
      </div>
    </div>
    <p className={styles.footnote}>Select a pin or choose a location above. Recorded inventory may not include all physical stock.</p>
  </div>;
}
