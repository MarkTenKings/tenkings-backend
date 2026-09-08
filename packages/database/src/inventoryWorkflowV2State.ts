import { CardInventoryErrorV2 } from './cardInventoryV2';
import { previewCardAcquisitionCostV2 } from './cardAcquisitionCostV2';
import { canonical, WorkflowEventInputV2, type WorkflowCommandV2, type WorkflowEventV2, type WorkflowAllocationV2, type WorkflowScopeV2 } from './inventoryWorkflowV2';

type Event<K extends WorkflowEventV2['event_kind']> = Extract<WorkflowEventV2, { event_kind: K }>;
export type WorkflowUnitV2 = {
  unit_id: string; lot_id: string; receipt_event_id: string; stage: 'unprocessed' | 'processing' | 'processed' | 'packed';
  product_id: string | null; pack_id: string | null; permanent_card_id: string | null;
  custody: { custody_id: string; location_id: string | null }; reservation: { custody_id: string; location_id: string | null } | null;
  intended_sale_price_cents: number | null; price_event_id: string | null; cost: WorkflowAllocationV2['units'][number] | null; cost_event_id: string | null;
  batch_id: string | null; possession: 'recorded' | 'batch_identity_uncertain';
};
export type WorkflowBatchV2 = Omit<Event<'batch_loaded'>, 'event_kind' | 'data'> & { event_kind: 'batch_loaded' | 'opening_stock_recorded'; origin_kind: 'batch_loaded' | 'opening_stock_recorded'; data: Omit<Event<'batch_loaded'>['data'], 'from_custody_id'> & { from_custody_id: string | null } };
export class WorkflowStateV2 {
  events = new Map<string, WorkflowEventV2>();
  lots = new Map<string, Event<'purchase_received'> | Event<'opening_stock_recorded'>>();
  cancellations = new Map<string, Event<'purchase_cancelled'>>();
  receivedUnitIds = new Set<string>();
  units = new Map<string, WorkflowUnitV2>();
  batches = new Map<string, WorkflowBatchV2>();
  reconciliations = new Map<string, Event<'batch_reconciled'>>();
  custodyBindings = new Map<string, string | null>();
  costAuthorities = new Map<string, Event<'purchase_received'> | Event<'opening_stock_recorded'> | Event<'purchase_cost_documented'>>();
  assignments = new Map<string, Event<'cost_assigned'>>();
  packIds = new Set<string>();
  permanentCards = new Set<string>();
  returned = new Map<string, number>();
  removedByBatch = new Map<string, number>();
  machineReturnsByBatch = new Map<string, number>();
  refunded = new Map<string, number>();
  refundReferences = new Set<string>();
  returnedUnits = new Set<string>();
}
const conflict = (message: string): never => { throw new CardInventoryErrorV2('CONFLICT', message); };
const exactScope = (a: WorkflowScopeV2, b: WorkflowScopeV2) => a.machine_id === b.machine_id && a.product_id === b.product_id && a.door_id === b.door_id;
export const overlapsWorkflowScopeV2 = (a: WorkflowScopeV2, b: WorkflowScopeV2) => a.machine_id === b.machine_id && a.product_id === b.product_id && (a.door_id === null || b.door_id === null || a.door_id === b.door_id);
const sum = (a: number, b: number) => { const v = Number(BigInt(a) + BigInt(b)); if (!Number.isSafeInteger(v)) conflict('Quantity or amount exceeds supported precision'); return v; };
function selected(state: WorkflowStateV2, ids: string[]) {
  if (new Set(ids).size !== ids.length) conflict('A unit can appear only once');
  return ids.map(id => state.units.get(id) ?? conflict('Unit is not in the received roster: ' + id));
}
function available(units: WorkflowUnitV2[]) {
  if (units.some(u => u.batch_id !== null || u.possession !== 'recorded')) conflict('Loaded membership does not identify currently held units; record an evidenced physical removal or return first');
}
function bind(state: WorkflowStateV2, custody: WorkflowUnitV2['custody']) {
  if (state.custodyBindings.has(custody.custody_id) && state.custodyBindings.get(custody.custody_id) !== custody.location_id) conflict('Custody identity is already bound to another Location');
  state.custodyBindings.set(custody.custody_id, custody.location_id);
}
export function workflowPurchaseCancellationBlockV2(state: WorkflowStateV2, lotId: string): string | null {
  const receipt = state.lots.get(lotId);
  if (!receipt) return 'Select a recorded purchase receipt';
  if (receipt.event_kind !== 'purchase_received') return 'Historical opening stock cannot be cancelled as a receipt typo';
  if (state.cancellations.has(lotId)) return 'This purchase receipt is already cancelled';
  const ids = new Set(receipt.data.unit_ids);
  for (const row of state.events.values()) {
    if (['purchase_received', 'cost_assigned', 'purchase_cost_documented', 'price_set'].includes(row.event_kind)) continue;
    if ('lot_id' in row.data && row.data.lot_id === lotId ||
      'unit_ids' in row.data && row.data.unit_ids?.some(id => ids.has(id)) ||
      row.event_kind === 'packed' && row.data.packs.some(p => ids.has(p.unit_id)) ||
      row.event_kind === 'stock_counted' && row.data.remaining_unit_ids?.some(id => ids.has(id))) return 'Receipt cancellation is unavailable after reservation, processing, packing, custody or physical use';
  }
  if (receipt.data.unit_ids.some(id => { const unit = state.units.get(id); return !unit || unit.stage !== 'unprocessed' || unit.batch_id !== null || unit.permanent_card_id !== null || unit.pack_id !== null || unit.custody.custody_id !== receipt.data.custody.custody_id; })) return 'Receipt cancellation requires the entire unused unprocessed roster in its original custody';
  return null;
}
export function calculateWorkflowAllocationV2(state: WorkflowStateV2, data: Extract<WorkflowCommandV2, { event_kind: 'cost_assigned' }>['data']): WorkflowAllocationV2 {
  const receipt = state.lots.get(data.lot_id) ?? conflict('Receive this purchase before assigning its cost');
  if (state.cancellations.has(data.lot_id)) conflict('Cancelled receipts cannot receive further cost assignments');
  const authority = state.costAuthorities.get(data.lot_id)!;
  if (authority.data.total_cost_cents === null) {
    if (data.assignment.method !== 'unassigned') conflict('The documented purchase total is unknown; known unit costs cannot be assigned');
    return { method_version: 'unassigned_v1', residual_rule: null, residual_cent_unit_ids: [], units: [...receipt.data.unit_ids].sort().map(unit_id => ({ unit_id, cost_cents: null, basis: 'unknown', evidence_ref: authority.data.purchase_evidence_ref, unknown_reason: data.assignment.method === 'unassigned' ? data.assignment.unknown_reason : null })) };
  }
  let result;
  try { result = previewCardAcquisitionCostV2({ schema_version: 1, lot: {
    lot_id: receipt.data.lot_id, acquisition_cycle_id: receipt.data.acquisition_cycle_id, acquisition_event_id: receipt.source_event_id,
    quantity: receipt.data.quantity, total_cost_cents: authority.data.total_cost_cents, currency: 'USD', evidence_ref: authority.data.purchase_evidence_ref, purchase_ledger_line_id: null,
  }, units: receipt.data.unit_ids.map(unit_id => ({ unit_id })), assignment: data.assignment }); } catch (error) { throw new CardInventoryErrorV2('INVALID_INPUT', error instanceof Error ? error.message : 'Invalid acquisition assignment'); }
  return { method_version: result.assignment.method_version, residual_rule: result.assignment.residual_rule, residual_cent_unit_ids: result.assignment.residual_cent_unit_ids,
    units: result.units.map(u => ({ unit_id: u.unit_id, cost_cents: u.component.cost_cents, basis: u.component.basis as WorkflowAllocationV2['units'][number]['basis'], evidence_ref: u.component.evidence_ref, unknown_reason: u.component.unknown_reason })) };
}

export function applyWorkflowEventV2(state: WorkflowStateV2, supplied: WorkflowEventV2) {
  const e = WorkflowEventInputV2.parse(supplied);
  if (e.effective_at > e.recorded_at) conflict('Effective time cannot be after recording time');
  if (state.events.has(e.source_event_id)) conflict('Duplicate workflow event identity');
  const prior = <K extends WorkflowEventV2['event_kind']>(id: string, kind: K): Event<K> => {
    const row = state.events.get(id);
    if (!row || row.event_kind !== kind) return conflict('Referenced evidence is absent or causally later: ' + id);
    return row as Event<K>;
  };
  switch (e.event_kind) {
    case 'purchase_received':
    case 'opening_stock_recorded': {
      const d = e.data;
      if (state.lots.has(d.lot_id) || [...state.lots.values()].some(l => l.data.acquisition_cycle_id === d.acquisition_cycle_id)) conflict('Lot or acquisition cycle is already received');
      if (d.unit_ids.length !== d.quantity || d.unit_ids.some(id => state.receivedUnitIds.has(id))) conflict('Receipt requires a complete new unique roster');
      if (d.total_cost_cents === null ? d.unknown_reason === null : d.unknown_reason !== null) conflict('Unknown total requires a reason; known total cannot carry an unknown reason');
      if (e.event_kind === 'purchase_received' && (!d.custody.custody_id.startsWith('hq:') || d.custody.location_id === null)) conflict('New purchases must be received as unprocessed HQ stock at an existing Location');
      bind(state, d.custody); state.lots.set(d.lot_id, e); state.costAuthorities.set(d.lot_id, e);
      for (const unit_id of d.unit_ids) { state.receivedUnitIds.add(unit_id); state.units.set(unit_id, { unit_id, lot_id: d.lot_id, receipt_event_id: e.source_event_id, stage: 'unprocessed', product_id: null, pack_id: null, permanent_card_id: null, custody: { ...d.custody }, reservation: null, intended_sale_price_cents: null, price_event_id: null, cost: null, cost_event_id: null, batch_id: null, possession: 'recorded' }); }
      if (e.event_kind === 'opening_stock_recorded') {
        const d = e.data;
        if (d.custody.location_id === null) conflict('Historical opening needs an existing physical Location');
        if ((d.stage === 'unprocessed') !== (d.product_id === null)) conflict('Opening processing state and product identity must agree');
        if (d.stage === 'packed' ? d.packs.length !== d.quantity : d.packs.length !== 0) conflict('Packed opening requires one recorded pack per roster unit');
        if (new Set(d.packs.map(p => p.unit_id)).size !== d.packs.length || new Set(d.packs.map(p => p.pack_id)).size !== d.packs.length || d.packs.some(p => !d.unit_ids.includes(p.unit_id) || state.packIds.has(p.pack_id))) conflict('Opening pack identities must be complete, unique and new');
        if (d.custody.custody_id.startsWith('machine:')) {
          if (!d.machine_scope || !d.loading_batch_id || d.stage !== 'packed' || d.machine_scope.product_id !== d.product_id || d.custody.custody_id !== 'machine:' + d.machine_scope.machine_id) conflict('Machine opening needs an explicit packed product/door scope and opening-batch identity');
          const openingBatchId = d.loading_batch_id ?? conflict('Opening batch identity is required');
          if (state.batches.has(openingBatchId) || [...state.events.values()].some(row => 'scope' in row.data && overlapsWorkflowScopeV2(row.data.scope, d.machine_scope!))) conflict('Historical opening cannot duplicate existing scope history');
          state.batches.set(openingBatchId, { ...e, origin_kind: 'opening_stock_recorded', data: { batch_id: openingBatchId, scope: d.machine_scope!, unit_ids: d.unit_ids, from_custody_id: null, to: d.custody } });
        } else if (d.machine_scope !== null || d.loading_batch_id !== null) conflict('Non-machine opening cannot assert a machine loading batch');
        for (const unit_id of d.unit_ids) { const u = state.units.get(unit_id)!; u.stage = d.stage; u.product_id = d.product_id; u.pack_id = d.packs.find(p => p.unit_id === unit_id)?.pack_id ?? null; if (u.pack_id) state.packIds.add(u.pack_id); u.batch_id = d.loading_batch_id; if (u.batch_id) u.possession = 'batch_identity_uncertain'; }
      }
      break;
    }
    case 'purchase_cancelled': {
      const receipt = state.lots.get(e.data.lot_id);
      if (!receipt || receipt.event_kind !== 'purchase_received' || receipt.source_event_id !== e.data.purchase_event_id) conflict('Cancellation must cite the original purchase receipt for this lot');
      const blocked = workflowPurchaseCancellationBlockV2(state, e.data.lot_id); if (blocked) conflict(blocked);
      state.cancellations.set(e.data.lot_id, e);
      for (const id of receipt!.data.unit_ids) state.units.delete(id);
      break;
    }
    case 'purchase_cost_documented': {
      const d = e.data, prior = state.costAuthorities.get(d.lot_id);
      if (state.cancellations.has(d.lot_id)) conflict('Cancelled receipts cannot receive further purchase-cost documents');
      if (!prior || prior.source_event_id !== d.supersedes_event_id) conflict('Cost correction must cite the current purchase-cost authority');
      if (d.total_cost_cents === null ? d.unknown_reason === null : d.unknown_reason !== null) conflict('Unknown total needs a reason; known total cannot carry one');
      state.costAuthorities.set(d.lot_id, e);
      for (const unit of state.units.values()) if (unit.lot_id === d.lot_id) { unit.cost = null; unit.cost_event_id = null; }
      break;
    }
    case 'cost_assigned': {
      if ((state.assignments.get(e.data.lot_id)?.source_event_id ?? null) !== e.data.supersedes_event_id) conflict('Cost assignment must explicitly supersede the current assignment');
      const computed = calculateWorkflowAllocationV2(state, e.data);
      if (canonical(computed) !== canonical(e.data.allocation)) conflict('Saved allocation does not match the purchase, complete roster and explicit method');
      for (const row of computed.units) { const u = state.units.get(row.unit_id)!; u.cost = row; u.cost_event_id = e.source_event_id; }
      state.assignments.set(e.data.lot_id, e);
      break;
    }
    case 'processed': {
      const units = selected(state, e.data.unit_ids); available(units);
      if (e.data.permanent_card_links.length && e.data.stage !== 'processed') conflict('A permanent-card link requires completed processing');
      const linked = new Set<string>();
      for (const link of e.data.permanent_card_links) {
        if (!e.data.unit_ids.includes(link.unit_id) || linked.has(link.unit_id) || state.permanentCards.has(link.card_id)) conflict('Permanent card linkage is duplicate or unrelated to this processing roster');
        linked.add(link.unit_id); state.permanentCards.add(link.card_id);
      }
      for (const u of units) {
        if (e.data.stage === 'processing' ? u.stage !== 'unprocessed' : !['unprocessed', 'processing'].includes(u.stage)) conflict('Processing transition conflicts with accepted work');
        if (u.product_id !== null && u.product_id !== e.data.product_id) conflict('Processing cannot silently change product identity');
        u.stage = e.data.stage; u.product_id = e.data.product_id;
        u.permanent_card_id = e.data.permanent_card_links.find(l => l.unit_id === u.unit_id)?.card_id ?? u.permanent_card_id;
      }
      break;
    }
    case 'packed': {
      const units = selected(state, e.data.packs.map(p => p.unit_id)); available(units);
      if (new Set(e.data.packs.map(p => p.pack_id)).size !== e.data.packs.length || e.data.packs.some(p => state.packIds.has(p.pack_id))) conflict('Pack identities are permanent and cannot be reused');
      e.data.packs.forEach((p, i) => { if (units[i].stage !== 'processed') conflict('Only processed units can enter a one-card pack'); state.packIds.add(p.pack_id); units[i].stage = 'packed'; units[i].pack_id = p.pack_id; });
      break;
    }
    case 'custody_moved': {
      const units = selected(state, e.data.unit_ids); available(units);
      if (e.data.to.custody_id.startsWith('machine:')) conflict('Machine delivery must record an explicit loading batch');
      if (e.data.from_custody_id === e.data.to.custody_id || units.some(u => u.custody.custody_id !== e.data.from_custody_id)) conflict('Physical transfer must match current custody');
      if (e.data.movement === 'dispatch' && !e.data.to.custody_id.startsWith('transit:')) conflict('Dispatch records a named transit custody');
      bind(state, e.data.to); for (const u of units) u.custody = { ...e.data.to }; break;
    }
    case 'reserved': {
      const units = selected(state, e.data.unit_ids); available(units);
      if (e.data.destination) bind(state, e.data.destination);
      for (const u of units) u.reservation = e.data.destination ? { ...e.data.destination } : null;
      break;
    }
    case 'price_set':
      for (const u of selected(state, e.data.unit_ids)) { u.intended_sale_price_cents = e.data.intended_sale_price_cents; u.price_event_id = e.source_event_id; }
      break;
    case 'batch_loaded': {
      const units = selected(state, e.data.unit_ids); available(units);
      if (state.batches.has(e.data.batch_id)) conflict('Loading batch identity is already used');
      if (e.data.to.custody_id !== 'machine:' + e.data.scope.machine_id || !e.data.to.location_id) conflict('Machine loading needs exact device custody and an existing Location');
      if (units.some(u => u.stage !== 'packed' || u.product_id !== e.data.scope.product_id || u.custody.custody_id !== e.data.from_custody_id)) conflict('Loading requires packed units of the stated product in the stated custody');
      bind(state, e.data.to); state.batches.set(e.data.batch_id, { ...e, origin_kind: 'batch_loaded' });
      for (const u of units) { u.custody = { ...e.data.to }; u.batch_id = e.data.batch_id; u.possession = 'batch_identity_uncertain'; u.reservation = null; }
      break;
    }
    case 'sale_observed': {
      if (e.data.from_at >= e.data.until_at || e.data.until_at > e.effective_at || Date.parse(e.data.until_at) - Date.parse(e.data.from_at) > 3660 * 86400000) conflict('Sales observation needs an ordered completed interval of at most ten years');
      if (!e.data.quantity && e.data.actual_revenue_cents !== null && e.data.actual_revenue_cents !== 0) conflict('Zero observed sales cannot carry positive revenue');
      for (const previous of state.events.values()) if (previous.event_kind === 'sale_observed' && overlapsWorkflowScopeV2(previous.data.scope, e.data.scope) && previous.data.from_at < e.data.until_at && e.data.from_at < previous.data.until_at) conflict('Sales observations overlap; distinct IDs cannot establish disjoint sales');
      break;
    }
    case 'stock_counted': {
      if (e.data.remaining_unit_ids !== null) {
        if (e.data.remaining_unit_ids.length !== e.data.quantity) conflict('Identified count roster must equal the physical count');
        for (const u of selected(state, e.data.remaining_unit_ids)) if (u.custody.custody_id !== 'machine:' + e.data.scope.machine_id || u.product_id !== e.data.scope.product_id || !u.batch_id || !overlapsWorkflowScopeV2(state.batches.get(u.batch_id)!.data.scope, e.data.scope)) conflict('Counted unit is not a member of this machine/product scope');
      }
      break;
    }
    case 'batch_removed':
    case 'physical_return_observed': {
      const d = e.data;
      const batch = state.batches.get(d.batch_id) ?? conflict('Movement references an unknown loading batch');
      if (!exactScope(batch.data.scope, d.scope)) conflict('Movement scope must match its explicit loading batch');
      if (d.unit_ids !== null && d.unit_ids.length !== d.quantity) conflict('Identified movement roster must equal the physical quantity');
      if (e.event_kind === 'batch_removed') {
        const removed = sum(state.removedByBatch.get(d.batch_id) ?? 0, d.quantity);
        if (removed > sum(batch.data.unit_ids.length, state.machineReturnsByBatch.get(d.batch_id) ?? 0)) conflict('Batch removals exceed loaded stock and documented returns to this machine');
        state.removedByBatch.set(d.batch_id, removed);
      }
      if (e.event_kind === 'physical_return_observed') {
        const sale = prior(e.data.original_sales_observation_id, 'sale_observed');
        if (!overlapsWorkflowScopeV2(sale.data.scope, d.scope)) conflict('Return is outside its original sales scope');
        const returned = sum(state.returned.get(sale.source_event_id) ?? 0, d.quantity);
        if (returned > sale.data.quantity) conflict('Physical returns exceed original observed sales');
        state.returned.set(sale.source_event_id, returned);
        if (d.to.custody_id === batch.data.to.custody_id) state.machineReturnsByBatch.set(d.batch_id, sum(state.machineReturnsByBatch.get(d.batch_id) ?? 0, d.quantity));
        if (d.unit_ids?.some(id => state.returnedUnits.has(sale.source_event_id + '\n' + id))) conflict('This unit has already been returned against the same sale observation');
        for (const id of d.unit_ids ?? []) state.returnedUnits.add(sale.source_event_id + '\n' + id);
      }
      if (d.to.custody_id.startsWith('machine:') && d.to.custody_id !== batch.data.to.custody_id) conflict('A movement into another machine requires a separate loading batch');
      bind(state, d.to);
      if (d.unit_ids !== null) for (const u of selected(state, d.unit_ids)) {
        if (u.batch_id !== d.batch_id || !batch.data.unit_ids.includes(u.unit_id)) conflict('Movement unit is not currently associated with this batch');
        if (e.event_kind === 'batch_removed' && d.to.custody_id === u.custody.custody_id) conflict('Removal must leave machine custody');
        u.custody = { ...d.to };
        if (!d.to.custody_id.startsWith('machine:')) { u.batch_id = null; u.possession = 'recorded'; }
      }
      // Unknown unit identities remain aggregate observations, never a guessed unit roster.
      break;
    }
    case 'refund_observed': {
      const sale = prior(e.data.original_sales_observation_id, 'sale_observed');
      const saleRevenue = sale.data.actual_revenue_cents ?? conflict('Refund limit is unknown until original revenue is documented');
      const refunded = sum(state.refunded.get(sale.source_event_id) ?? 0, e.data.amount_cents);
      if (refunded > saleRevenue) conflict('Refunds exceed the original observed revenue');
      if (state.refundReferences.has(e.data.refund_reference)) conflict('Refund reference is already recorded');
      state.refundReferences.add(e.data.refund_reference); state.refunded.set(sale.source_event_id, refunded); break;
    }
    case 'batch_reconciled': {
      const d = e.data, batch = state.batches.get(d.batch_id) ?? conflict('Unknown loading batch');
      const previous = state.reconciliations.get(d.batch_id);
      if ((previous?.source_event_id ?? null) !== d.supersedes_event_id) conflict('Reconciliation must supersede the current assertion explicitly');
      if (d.scope_complete !== (d.scope_evidence_ref !== null) || d.sales_attributed !== (d.attribution_evidence_ref !== null)) conflict('Each asserted conclusion needs its own explicit evidence reference');
      const opening = d.opening_count_event_id ? prior(d.opening_count_event_id, 'stock_counted') : null;
      const closing = d.closing_count_event_id ? prior(d.closing_count_event_id, 'stock_counted') : null;
      if (opening && (opening.effective_at > batch.effective_at || !exactScope(opening.data.scope, batch.data.scope))) conflict('Opening count must cover the exact scope before loading');
      if (opening && batch.origin_kind === 'opening_stock_recorded' && (opening.effective_at !== batch.effective_at || opening.data.quantity !== batch.data.unit_ids.length)) conflict('A separate historical opening count must match the recorded opening date and quantity');
      if (closing && (closing.effective_at < batch.effective_at || !exactScope(closing.data.scope, batch.data.scope))) conflict('Closing count must cover the exact scope after loading');
      for (const id of d.sales_event_ids) { const sale = prior(id, 'sale_observed'); if (!overlapsWorkflowScopeV2(sale.data.scope, batch.data.scope)) conflict('Referenced sale belongs to another scope'); }
      for (const id of d.movement_event_ids) { const movement = state.events.get(id); if (!movement || !['batch_loaded', 'batch_removed', 'physical_return_observed'].includes(movement.event_kind) || movement.source_event_id === batch.source_event_id || !('scope' in movement.data) || !overlapsWorkflowScopeV2(movement.data.scope, batch.data.scope)) conflict('Referenced movement is absent, unrelated or is the batch load itself'); }
      if (d.sales_attributed) for (const assertion of state.reconciliations.values()) {
        if (assertion.data.batch_id !== d.batch_id && assertion.data.sales_attributed && assertion.data.sales_event_ids.some(id => d.sales_event_ids.includes(id))) conflict('A sales observation cannot be attributed to two active loading-batch assertions');
      }
      if (d.scope_complete) {
        if ((!opening && batch.origin_kind !== 'opening_stock_recorded') || !closing || !d.sales_event_ids.length) conflict('Complete scope needs opening, closing and explicit sales observations, including evidenced zero');
        const closingAt = closing?.effective_at ?? conflict('Closing count is required');
        for (const row of state.events.values()) {
          if (row.event_kind === 'sale_observed' && overlapsWorkflowScopeV2(row.data.scope, batch.data.scope) && row.data.until_at > batch.effective_at && row.data.from_at < closingAt && !d.sales_event_ids.includes(row.source_event_id)) conflict('Completeness assertion omits a recorded overlapping sales observation');
          if (['batch_loaded', 'batch_removed', 'physical_return_observed'].includes(row.event_kind) && 'scope' in row.data && row.source_event_id !== batch.source_event_id && overlapsWorkflowScopeV2(row.data.scope, batch.data.scope) && row.effective_at >= batch.effective_at && row.effective_at <= closingAt && !d.movement_event_ids.includes(row.source_event_id)) conflict('Completeness assertion omits a recorded load or physical movement');
        }
      }
      state.reconciliations.set(d.batch_id, e); break;
    }
  }
  state.events.set(e.source_event_id, e);
}
export function replayWorkflowEventsV2(events: WorkflowEventV2[]): WorkflowStateV2 {
  const state = new WorkflowStateV2();
  for (const event of [...events].sort((a, b) => a.effective_at < b.effective_at ? -1 : a.effective_at > b.effective_at ? 1 : a.source_sequence - b.source_sequence)) applyWorkflowEventV2(state, event);
  return state;
}
export function workflowStateViewV2(state: WorkflowStateV2) {
  return { cost_authorities: [...state.costAuthorities.values()], assignments: [...state.assignments.values()], cancellations: [...state.cancellations.values()], lots: [...state.lots.values()], units: [...state.units.values()], batches: [...state.batches.values()], reconciliations: [...state.reconciliations.values()], events: [...state.events.values()].sort((a, b) => a.source_sequence - b.source_sequence),
    notice: 'Unit IDs are receipt roster identities. Loaded membership is historical; aggregate sales do not identify sold or remaining units. Missing counts and costs remain unknown.' };
}
