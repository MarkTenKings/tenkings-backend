import { z } from 'zod';
import { CardInventoryErrorV2 } from './cardInventoryV2';
import { InventoryItemDescriptionV2, inventoryHash, WorkflowTimeV2, WorkflowScopeInputV2, type WorkflowCommandV2 } from './inventoryWorkflowV2';
import { type WorkflowStateV2, type WorkflowUnitV2 } from './inventoryWorkflowV2State';

const identity = z.string().trim().min(1).max(200).refine(v => !/[\u0000-\u001f\u007f]/.test(v), 'Use an identity without control characters');
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const destination = z.object({ location_id: z.string().uuid(), kind: z.enum(['hq', 'store', 'kiosk', 'machine']), machine_id: identity.nullable(), product_id: identity.nullable(), door_id: identity.nullable() }).strict();
const selected = z.array(identity).min(1).max(2000).refine(v => new Set(v).size === v.length, 'Select each card once');
const meta = { request_id: z.string().uuid(), effective_at: WorkflowTimeV2, note: z.string().trim().max(1600) };
export const StaffInventoryCommandV2 = z.discriminatedUnion('action', [
  z.object({ ...meta, action: z.literal('add'), origin: z.enum(['existing', 'purchase']), description: InventoryItemDescriptionV2, quantity: z.number().int().min(1).max(2000), total_cost_cents: cents.nullable(), cost_method: z.enum(['equal_card', 'documented_unit', 'unassigned']), expected_price_cents: cents.nullable(), destination, stage: z.enum(['unprocessed', 'processing', 'processed', 'packed']) }).strict(),
  z.object({ ...meta, action: z.literal('count'), scope: WorkflowScopeInputV2, quantity: z.number().int().min(0).max(1000000) }).strict(),
  z.object({ ...meta, action: z.literal('edit'), unit_ids: selected, description: InventoryItemDescriptionV2, expected_price_cents: cents.nullable() }).strict(),
  z.object({ ...meta, action: z.literal('move'), unit_ids: selected, destination, planned: z.boolean() }).strict(),
  z.object({ ...meta, action: z.literal('prepare'), unit_ids: selected, stage: z.enum(['processing', 'processed', 'packed']), product_id: identity }).strict(),
  z.object({ ...meta, action: z.literal('cost'), lot_id: identity, total_cost_cents: cents.nullable(), cost_method: z.enum(['equal_card', 'documented_unit', 'unassigned', 'explicit_per_card']), card_costs: z.array(z.object({ unit_id: identity, cost_cents: cents }).strict()).min(1).max(2000).nullable().optional() }).strict(),
]);
export type StaffInventoryCommand = z.infer<typeof StaffInventoryCommandV2>;
const staffInventoryReferenceV2 = (d: StaffInventoryCommand) => `Staff inventory ${d.request_id} [${inventoryHash(d)}]`;
export const staffInventoryProofV2 = (d: StaffInventoryCommand) => `${staffInventoryReferenceV2(d)}${d.note ? ': ' + d.note : ''}`;
const fail = (message: string): never => { throw new CardInventoryErrorV2('INVALID_INPUT', message); };
const sum = (values: number[]) => { const n = Number(values.reduce((a, b) => a + BigInt(b), 0n)); return Number.isSafeInteger(n) ? n : null; };
export function expectedInventoryValueV2(units: WorkflowUnitV2[]) {
  const costs = units.flatMap(u => u.cost?.cost_cents == null ? [] : [u.cost.cost_cents]);
  const prices = units.flatMap(u => u.intended_sale_price_cents === null ? [] : [u.intended_sale_price_cents]);
  const knownCost = sum(costs), knownPrices = sum(prices);
  const cost = costs.length === units.length && units.length ? knownCost : null;
  const expected = prices.length === units.length && units.length ? knownPrices : null;
  const profit = cost !== null && expected !== null ? sum([expected, -cost]) : null;
  return { cost_cents: cost, expected_sales_cents: expected, expected_profit_cents: profit, expected_margin_pct: profit !== null && expected !== null && expected > 0 ? profit / expected * 100 : null, costed_units: costs.length, priced_units: prices.length, known_cost_subtotal_cents: costs.length ? knownCost : null, value_overflow: knownCost === null || knownPrices === null };
}

/** Pure translation of staff-entered facts. The sole writer persists the resulting steps atomically. */
export function buildStaffInventoryCommandsV2(input: unknown, state: WorkflowStateV2): WorkflowCommandV2[] {
  const parsed = StaffInventoryCommandV2.safeParse(input);
  if (!parsed.success) fail(parsed.error.issues[0].message);
  const d = parsed.data!, prefix = `staff:${d.request_id}`, commands: WorkflowCommandV2[] = [];
  const proof = staffInventoryProofV2(d), reference = staffInventoryReferenceV2(d);
  // The full staff note lives once in each immutable event envelope. Allocation
  // rows use its exact request reference, so 2,000 cards never repeat a long note.
  const unknownCost = d.note ? `Purchase cost is unknown; see staff inventory ${d.request_id}` : 'Purchase cost has not been entered by staff';
  const add = (event_kind: WorkflowCommandV2['event_kind'], data: unknown) => commands.push({ request_id: `${prefix}:${commands.length}`, effective_at: d.effective_at, evidence_ref: proof, event_kind, data } as WorkflowCommandV2);
  const custody = (to: z.infer<typeof destination>) => ({ custody_id: `${to.kind}:${to.kind === 'machine' ? to.machine_id ?? fail('Choose the vending machine') : to.location_id}`, location_id: to.location_id });
  const scope = (to: z.infer<typeof destination>) => ({ machine_id: to.machine_id ?? fail('Choose the vending machine'), product_id: to.product_id ?? fail('Choose the product loaded in this machine'), door_id: to.door_id });
  const assignment = (lot: string, ids: string[], total: number | null, method: 'equal_card' | 'documented_unit' | 'unassigned' | 'explicit_per_card', supersedes: string | null, cardCosts?: { unit_id: string; cost_cents: number }[] | null) => {
    if (total === null && method !== 'unassigned' || total !== null && method === 'unassigned') fail('Choose how to assign the purchase cost, or leave it unknown');
    if (method === 'documented_unit' && ids.length !== 1) fail('For a batch, choose total batch cost divided across its cards');
    add('cost_assigned', { lot_id: lot, supersedes_event_id: supersedes, assignment: method === 'explicit_per_card' ? { method, basis: 'allocated_acquisition', evidence_ref: reference + '; staff entered each card cost', costs: cardCosts ?? fail('Enter every card’s cost') } : method === 'unassigned' ? { method, basis: 'unknown', unknown_reason: unknownCost } : method === 'equal_card' ? { method, basis: 'allocated_acquisition', evidence_ref: reference + '; staff selected equal cost per card' } : { method, basis: 'documented_unit', costs: [{ unit_id: ids[0], cost_cents: total, evidence_ref: reference }] } });
  };
  if (d.action === 'add') {
    const lot = `${prefix}:lot`, ids = Array.from({ length: d.quantity }, (_, i) => `${prefix}:card:${String(i + 1).padStart(4, '0')}`);
    const product = d.destination.product_id ?? `inventory-product:${inventoryHash({ name: d.description.name, category: d.description.category })}`;
    const at = custody(d.destination), packed = d.stage === 'packed';
    if (d.destination.kind === 'machine' && (!packed || d.origin !== 'existing')) fail('For stock already in a machine, choose Current stock and Packed. For a new delivery, add the purchase at its receiving location, then move it.');
    const receipt = { lot_id: lot, acquisition_cycle_id: `${prefix}:purchase`, quantity: d.quantity, total_cost_cents: d.total_cost_cents, unknown_reason: d.total_cost_cents === null ? d.note || unknownCost : null, purchase_evidence_ref: reference, unit_ids: ids, custody: at };
    if (d.origin === 'existing') add('opening_stock_recorded', { ...receipt, stage: d.stage, product_id: d.stage === 'unprocessed' ? null : product, packs: packed ? ids.map((unit_id, i) => ({ unit_id, pack_id: `${prefix}:pack:${i + 1}` })) : [], machine_scope: d.destination.kind === 'machine' ? scope(d.destination) : null, loading_batch_id: d.destination.kind === 'machine' ? `${prefix}:load` : null });
    else {
      add('purchase_received', receipt);
      if (d.stage !== 'unprocessed') add('processed', { unit_ids: ids, stage: d.stage === 'processing' ? 'processing' : 'processed', product_id: product, permanent_card_links: [] });
      if (packed) add('packed', { packs: ids.map((unit_id, i) => ({ unit_id, pack_id: `${prefix}:pack:${i + 1}` })) });
    }
    assignment(lot, ids, d.total_cost_cents, d.cost_method, null);
    add('item_described', { unit_ids: ids, description: d.description });
    add('price_set', { unit_ids: ids, intended_sale_price_cents: d.expected_price_cents });
    return commands;
  }
  if (d.action === 'cost') {
    const receipt = state.lots.get(d.lot_id) ?? fail('This purchase is no longer available');
    if (state.cancellations.has(d.lot_id)) fail('This purchase entry was cancelled');
    add('purchase_cost_documented', { lot_id: d.lot_id, total_cost_cents: d.total_cost_cents, unknown_reason: d.total_cost_cents === null ? d.note || unknownCost : null, purchase_evidence_ref: reference, supersedes_event_id: state.costAuthorities.get(d.lot_id)!.source_event_id });
    assignment(d.lot_id, receipt.data.unit_ids, d.total_cost_cents, d.cost_method, state.assignments.get(d.lot_id)?.source_event_id ?? null, d.card_costs);
    return commands;
  }
  if (d.action === 'count') { add('stock_counted', { scope: d.scope, quantity: d.quantity, remaining_unit_ids: null }); return commands; }
  const units = d.unit_ids.map(id => state.units.get(id) ?? fail('A selected card is no longer available. Refresh inventory.'));
  if (d.action === 'edit') {
    add('item_described', { unit_ids: d.unit_ids, description: d.description });
    add('price_set', { unit_ids: d.unit_ids, intended_sale_price_cents: d.expected_price_cents });
  } else if (d.action === 'prepare') {
    if (units.some(u => u.batch_id || u.possession !== 'recorded')) fail('Select cards currently held outside a vending machine');
    if (d.stage === 'packed') {
      const unpacked = units.filter(u => u.stage !== 'packed');
      if (!unpacked.length) fail('These cards are already packed');
      // A selected product is an explicit correction of previously processed
      // stock. Keep its stage and pack identity until the normal next step.
      for (const stage of ['processing', 'processed', 'packed'] as const) {
        const changed = units.filter(u => u.stage === stage && u.product_id !== d.product_id);
        if (changed.length) add('stock_corrected', { unit_ids: changed.map(u => u.unit_id), expected_states: changed.map(u => ({ unit_id: u.unit_id, state_event_id: u.state_event_id })), reason: reference + '; staff assigned the selected product before packing', correction: { kind: 'processing', stage, product_id: d.product_id } });
      }
      const needsProcessing = units.filter(u => ['unprocessed', 'processing'].includes(u.stage));
      if (needsProcessing.length) add('processed', { unit_ids: needsProcessing.map(u => u.unit_id), stage: 'processed', product_id: d.product_id, permanent_card_links: [] });
      add('packed', { packs: unpacked.map((u, i) => ({ unit_id: u.unit_id, pack_id: `${prefix}:pack:${i + 1}` })) });
    } else add('processed', { unit_ids: d.unit_ids, stage: d.stage, product_id: d.product_id, permanent_card_links: [] });
  } else if (d.action === 'move') {
    if (units.some(u => u.batch_id || u.possession !== 'recorded')) fail('Machine stock needs a physical count and identified removal before it can be moved. Open Advanced records for that step.');
    const to = custody(d.destination);
    if (d.planned) add('reserved', { unit_ids: d.unit_ids, destination: to });
    else {
      if (d.destination.kind === 'machine') {
        if (units.some(u => u.stage !== 'packed')) fail('Update the condition to Packed before loading these cards into a machine.');
        const target = scope(d.destination), changed = units.filter(u => u.product_id !== target.product_id);
        if (changed.length) add('stock_corrected', { unit_ids: changed.map(u => u.unit_id), expected_states: changed.map(u => ({ unit_id: u.unit_id, state_event_id: u.state_event_id })), reason: proof + '; staff assigned the actual machine product', correction: { kind: 'processing', stage: 'packed', product_id: target.product_id } });
      }
      const groups = new Map<string, WorkflowUnitV2[]>();
      for (const u of units) { const list = groups.get(u.custody.custody_id) ?? []; list.push(u); groups.set(u.custody.custody_id, list); }
      for (const [from, group] of groups) {
        if (d.destination.kind === 'machine') add('batch_loaded', { batch_id: `${prefix}:load:${commands.length}`, scope: scope(d.destination), unit_ids: group.map(u => u.unit_id), from_custody_id: from, to });
        else add('custody_moved', { unit_ids: group.map(u => u.unit_id), from_custody_id: from, to, movement: 'transfer' });
      }
      const arrived = units.filter(u => u.reservation?.custody_id === to.custody_id);
      if (d.destination.kind !== 'machine' && arrived.length) add('reserved', { unit_ids: arrived.map(u => u.unit_id), destination: null });
    }
  }
  return commands;
}
