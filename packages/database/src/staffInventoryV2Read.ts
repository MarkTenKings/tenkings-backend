import { canonical, inventoryHash, type WorkflowEventV2 } from './inventoryWorkflowV2';
import { replayWorkflowEventsV2, type WorkflowUnitV2 } from './inventoryWorkflowV2State';
import { expectedInventoryValueV2 } from './staffInventoryV2';
import { isIndividuallyDescribedStaffInventoryUnitV2 } from './staffInventoryResearchV2';

export type InventoryLocationV2 = { id: string; name: string; slug: string; address: string; locationType: string | null };
export function staffInventoryWorkspaceV2(events: WorkflowEventV2[], locations: InventoryLocationV2[]) {
  const state = replayWorkflowEventsV2(events), groups = new Map<string, WorkflowUnitV2[]>();
  for (const u of state.units.values()) {
    const key = canonical([u.lot_id, u.description ?? null, u.custody, u.stage, u.product_id, u.batch_id, u.intended_sale_price_cents]);
    const group = groups.get(key) ?? []; group.push(u); groups.set(key, group);
  }
  const items = [...groups].map(([key, units]) => {
    const first = units[0], receipt = state.lots.get(first.lot_id)!;
    const scope = first.batch_id ? state.batches.get(first.batch_id)?.data.scope ?? null : null;
    const lastCount = scope ? [...state.events.values()].filter(e => e.event_kind === 'stock_counted' && canonical(e.data.scope) === canonical(scope)).at(-1) : null;
    const uncertain = units.some(u => u.possession !== 'recorded' || u.batch_id !== null);
    return {
      id: inventoryHash(key), lot_id: first.lot_id, name: first.description?.name ?? null, category: first.description?.category ?? null,
      notes: first.description?.notes ?? '', photo_key: first.description?.photo_key ?? null,
      back_photo_key: first.description?.back_photo_key ?? null, card_details: first.description?.card_details ?? null,
      planned_sales_channel: first.description?.planned_sales_channel ?? null,
      location_id: first.custody.location_id, custody_id: first.custody.custody_id,
      location_name: locations.find(l => l.id === first.custody.location_id)?.name ?? null,
      batch_id: first.batch_id, machine_scope: scope, last_count: lastCount && lastCount.event_kind === 'stock_counted' ? { quantity: lastCount.data.quantity, at: lastCount.effective_at, event_id: lastCount.source_event_id } : null,
      stage: first.stage, product_id: first.product_id, quantity: units.length, quantity_kind: uncertain ? 'loaded_roster' : 'on_hand',
      expected_price_cents: first.intended_sale_price_cents,
      ...expectedInventoryValueV2(units),
      unit_ids: units.map(u => u.unit_id),
      units: units.map((u, i) => ({ id: u.unit_id, number: receipt.data.unit_ids.indexOf(u.unit_id) + 1, cost_cents: u.cost?.cost_cents ?? null, expected_price_cents: u.intended_sale_price_cents, permanent_card_id: u.permanent_card_id, pack_id: u.pack_id, planned_location_name: locations.find(l => l.id === u.reservation?.location_id)?.name ?? null })),
      receipt_quantity: receipt.data.quantity, purchase_total_cents: state.costAuthorities.get(first.lot_id)?.data.total_cost_cents ?? null,
      ...(units.length === 1 && isIndividuallyDescribedStaffInventoryUnitV2(state, first.unit_id) ? { research_eligible: true as const } : {}),
      created_at: receipt.effective_at, origin: receipt.event_kind === 'purchase_received' ? 'purchase' : 'existing',
      provenance: { receipt: first.receipt_event_id, description: first.description_event_id ?? null, cost: first.cost_event_id, price: first.price_event_id, custody: first.state_event_id },
    };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const held = [...state.units.values()].filter(u => !u.batch_id && u.possession === 'recorded');
  const machines = [...state.batches.values()].map(b => ({ ...b.data.scope, location_id: b.data.to.location_id }));
  return {
    version: 1 as const, sequence: events.length, items, locations,
    machines: [...new Map(machines.map(m => [canonical(m), m])).values()],
    products: [...new Map([...state.units.values()].filter(u => u.product_id).map(u => [u.product_id!, { id: u.product_id!, name: u.description?.name ?? u.product_id! }])).values()],
    totals: { on_hand: held.length, machine_roster: state.units.size - held.length, groups: items.length, locations: new Set([...state.units.values()].map(u => u.custody.location_id).filter(Boolean)).size, ...expectedInventoryValueV2(held) },
    updated_at: events.at(-1)?.recorded_at ?? null,
  };
}
export type StaffInventoryWorkspace = ReturnType<typeof staffInventoryWorkspaceV2>;
