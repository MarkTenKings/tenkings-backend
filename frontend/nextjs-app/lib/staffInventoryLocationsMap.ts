import type { StaffInventoryWorkspace } from '@tenkings/database';
import { ONLINE_LOCATION_SLUG } from './locationUtils';

export type StaffInventoryMapLocation = StaffInventoryWorkspace['locations'][number] & {
  latitude?: number | null;
  longitude?: number | null;
  coordinateSource?: 'saved' | 'address_lookup';
};

export type StaffInventoryMapItem = Pick<StaffInventoryWorkspace['items'][number],
  'location_id' | 'quantity' | 'quantity_kind' | 'cost_cents' | 'expected_sales_cents' |
  'costed_units' | 'priced_units' | 'machine_scope' | 'last_count'>;

export type MappedInventoryLocation = StaffInventoryMapLocation & { latitude: number; longitude: number };

export function hasInventoryMapPoint(location: StaffInventoryMapLocation): location is MappedInventoryLocation {
  return location.slug !== ONLINE_LOCATION_SLUG &&
    typeof location.latitude === 'number' && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 &&
    typeof location.longitude === 'number' && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180;
}

function safeSum(values: (number | null)[]): number | null {
  if (values.some(value => value === null || !Number.isSafeInteger(value))) return null;
  const result = Number(values.reduce<bigint>((sum, value) => sum + BigInt(value!), 0n));
  return Number.isSafeInteger(result) ? result : null;
}

/** Display totals never mix held inventory with a machine's original loading roster. */
export function summarizeInventoryLocations(locations: readonly StaffInventoryMapLocation[], items: readonly StaffInventoryMapItem[]) {
  const byLocation = new Map<string, StaffInventoryMapItem[]>();
  for (const item of items) {
    if (!item.location_id) continue;
    const group = byLocation.get(item.location_id) ?? [];
    group.push(item);
    byLocation.set(item.location_id, group);
  }
  return locations.map(location => {
    const records = byLocation.get(location.id) ?? [];
    const held = records.filter(item => item.quantity_kind === 'on_hand');
    const loaded = records.filter(item => item.quantity_kind === 'loaded_roster');
    const cost = held.length ? safeSum(held.map(item => item.cost_cents)) : null;
    const expectedSales = held.length ? safeSum(held.map(item => item.expected_sales_cents)) : null;
    const profit = cost !== null && expectedSales !== null ? safeSum([expectedSales, -cost]) : null;
    const counts = [...new Map(loaded.flatMap(item => item.last_count && item.machine_scope
      ? [[item.last_count.event_id, { ...item.last_count, scope: item.machine_scope }] as const]
      : [])).values()].sort((a, b) => b.at.localeCompare(a.at));
    return {
      location,
      groupCount: records.length,
      onHandQuantity: safeSum(held.map(item => item.quantity)),
      machineRosterQuantity: safeSum(loaded.map(item => item.quantity)),
      machineCount: new Set(loaded.flatMap(item => item.machine_scope ? [item.machine_scope.machine_id] : [])).size,
      costCents: cost,
      expectedSalesCents: expectedSales,
      expectedProfitCents: profit,
      expectedMarginPct: profit !== null && expectedSales !== null && expectedSales > 0 ? profit / expectedSales * 100 : null,
      costedQuantity: safeSum(held.map(item => item.costed_units)),
      pricedQuantity: safeSum(held.map(item => item.priced_units)),
      counts,
    };
  });
}

export type InventoryLocationSummary = ReturnType<typeof summarizeInventoryLocations>[number];
export type InventoryMapGroup = { id: string; position: { lat: number; lng: number }; locations: MappedInventoryLocation[] };

/** Group overlapping screen positions. The displayed anchor is always an actual member's coordinates. */
export function groupInventoryMapPoints(locations: readonly StaffInventoryMapLocation[], zoom: number): InventoryMapGroup[] {
  const scale = 256 * 2 ** Math.max(0, Math.min(22, Number.isFinite(zoom) ? zoom : 4));
  const groups: (InventoryMapGroup & { x: number; y: number })[] = [];
  for (const location of locations.filter(hasInventoryMapPoint).sort((a, b) => a.id.localeCompare(b.id))) {
    const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, location.latitude)) * Math.PI / 180);
    const x = (location.longitude + 180) / 360 * scale;
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    const group = groups.find(candidate => {
      const dx = Math.abs(x - candidate.x);
      return Math.hypot(Math.min(dx, scale - dx), y - candidate.y) < 64;
    });
    if (group) {
      group.locations.push(location);
      group.id = JSON.stringify(group.locations.map(member => member.id));
    } else {
      groups.push({ id: JSON.stringify([location.id]), position: { lat: location.latitude, lng: location.longitude }, locations: [location], x, y });
    }
  }
  return groups.map(({ x: _x, y: _y, ...group }) => group);
}
