const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkflowStateV2, applyWorkflowEventV2, replayWorkflowEventsV2, calculateWorkflowAllocationV2 } = require('../dist/database/src/inventoryWorkflowV2State.js');
const { parseWorkflowCommandV2, WorkflowPageInputV2, workflowEventIdV2, inventoryHash, canonical } = require('../dist/database/src/inventoryWorkflowV2.js');
const { verifyWorkflowRowV2 } = require('../dist/database/src/inventoryWorkflowV2Read.js');
const location = '11111111-1111-4111-8111-111111111111', hq = { custody_id: 'hq:fixture', location_id: location }, machine = { custody_id: 'machine:fixture-device', location_id: location }, scope = { machine_id: 'fixture-device', product_id: 'fixture-product', door_id: 'fixture-door' };
function harness(quantity = 2, total = 101, historicalOpening = false) {
  const state = new WorkflowStateV2(); let sequence = 0;
  const unit_ids = Array.from({ length: quantity }, (_, i) => 'fixture-unit-' + String(i).padStart(4, '0'));
  function put(event_kind, data, effective_at = '2026-01-01T00:00:00.000Z') {
    const request_id = 'fixture-request-' + (++sequence);
    const command = parseWorkflowCommandV2({ request_id, event_kind, data, effective_at, evidence_ref: 'fixture:physical-evidence' });
    const event = { schema_version: 2, source_event_id: workflowEventIdV2(request_id), source_sequence: sequence, event_kind, data: event_kind === 'cost_assigned' ? { ...data, allocation: calculateWorkflowAllocationV2(state, data) } : data, effective_at, recorded_at: '2026-02-01T00:00:00.000Z', recorded_by: 'fixture-admin', evidence_ref: command.evidence_ref, currency: 'USD' };
    applyWorkflowEventV2(state, event); return { command, event };
  }
  const receipt = put(historicalOpening ? 'opening_stock_recorded' : 'purchase_received', { lot_id: 'fixture-lot', acquisition_cycle_id: 'fixture-cycle', quantity, total_cost_cents: total, unknown_reason: total === null ? 'fixture:missing-invoice' : null, purchase_evidence_ref: 'fixture:invoice', unit_ids, custody: historicalOpening ? machine : hq, ...(historicalOpening ? { stage: 'packed', product_id: scope.product_id, packs: unit_ids.map((unit_id, i) => ({ unit_id, pack_id: 'fixture-opening-pack-' + i })), machine_scope: scope, loading_batch_id: 'fixture-batch' } : {}) });
  const assign = (assignment = { method: 'equal_card', basis: 'allocated_acquisition', evidence_ref: 'fixture:explicit-choice' }) => put('cost_assigned', { lot_id: 'fixture-lot', assignment, supersedes_event_id: state.assignments.get('fixture-lot')?.source_event_id ?? null });
  const load = () => {
    put('processed', { unit_ids, stage: 'processed', product_id: scope.product_id, permanent_card_links: [] });
    put('packed', { packs: unit_ids.map((unit_id, i) => ({ unit_id, pack_id: 'fixture-pack-' + i })) });
    return put('batch_loaded', { batch_id: 'fixture-batch', scope, unit_ids, from_custody_id: hq.custody_id, to: machine });
  };
  const sale = (qty = quantity, actual_revenue_cents = 1000) => put('sale_observed', { scope, from_at: '2026-01-01T00:00:00.000Z', until_at: '2026-01-02T00:00:00.000Z', quantity: qty, actual_revenue_cents }, '2026-01-02T00:00:00.000Z');
  return { state, put, receipt, assign, load, sale, unit_ids };
}
test('bulk receipt persists a complete unprocessed roster and preserves unassigned cost', () => {
  const h = harness(2000, 200003); assert.equal(h.state.units.size, 2000); assert.ok([...h.state.units.values()].every(u => u.stage === 'unprocessed' && u.cost === null && u.permanent_card_id === null));
  h.assign(); assert.equal([...h.state.units.values()].reduce((sum, u) => sum + u.cost.cost_cents, 0), 200003); assert.equal(h.state.units.get(h.unit_ids[0]).cost.cost_cents, 101); assert.equal(h.state.units.get(h.unit_ids[3]).cost.cost_cents, 100);
});
test('known zero and unknown purchase amounts remain different', () => { const h = harness(1, 0); h.assign(); assert.equal(h.state.units.get(h.unit_ids[0]).cost.cost_cents, 0); const u = harness(1, null); assert.throws(() => u.assign(), /unknown/); u.assign({ method: 'unassigned', basis: 'unknown', unknown_reason: 'fixture:no-cost' }); assert.equal(u.state.units.get(u.unit_ids[0]).cost.cost_cents, null); });
test('cost correction preserves receipt and invalidates current cost until explicitly reassigned', () => {
  const h = harness(); const first = h.assign(); const correction = h.put('purchase_cost_documented', { lot_id: 'fixture-lot', total_cost_cents: 203, unknown_reason: null, purchase_evidence_ref: 'fixture:correct-invoice', supersedes_event_id: h.receipt.event.source_event_id });
  assert.equal(h.state.lots.get('fixture-lot').data.total_cost_cents, 101); assert.equal(h.state.units.get(h.unit_ids[0]).cost, null);
  assert.throws(() => h.put('cost_assigned', { lot_id: 'fixture-lot', assignment: first.command.data.assignment, supersedes_event_id: null }), /supersede/);
  h.assign(); assert.equal([...h.state.units.values()].reduce((n, u) => n + u.cost.cost_cents, 0), 203); assert.ok(h.state.events.has(correction.event.source_event_id));
});
test('unknown receipt can later obtain documented cost without a second receipt', () => { const h = harness(1, null); h.put('purchase_cost_documented', { lot_id: 'fixture-lot', total_cost_cents: 77, unknown_reason: null, purchase_evidence_ref: 'fixture:found-invoice', supersedes_event_id: h.receipt.event.source_event_id }); h.assign({ method: 'documented_unit', basis: 'documented_unit', costs: [{ unit_id: h.unit_ids[0], cost_cents: 77, evidence_ref: 'fixture:invoice-line' }] }); assert.equal(h.state.units.get(h.unit_ids[0]).cost.basis, 'documented_unit'); });
test('individual prices cannot be replaced by an over-assigned allocation', () => { const h = harness(); assert.throws(() => h.assign({ method: 'explicit_per_card', basis: 'allocated_acquisition', evidence_ref: 'fixture:choice', costs: h.unit_ids.map(unit_id => ({ unit_id, cost_cents: 101 })) }), /equal/); });
test('asking price never changes acquisition basis and a reservation never moves custody', () => { const h = harness(); h.assign(); h.put('price_set', { unit_ids: h.unit_ids, intended_sale_price_cents: 9900 }); h.put('reserved', { unit_ids: h.unit_ids, destination: machine }); const u = h.state.units.get(h.unit_ids[0]); assert.equal(u.cost.cost_cents, 51); assert.deepEqual(u.custody, hq); assert.deepEqual(u.reservation, machine); });
test('one-card packing, processing stage, permanent pack identities and product are enforced', () => { const h = harness(); assert.throws(() => h.put('packed', { packs: [{ unit_id: h.unit_ids[0], pack_id: 'fixture-pack' }] }), /processed/); h.load(); assert.throws(() => h.put('processed', { unit_ids: h.unit_ids, stage: 'processed', product_id: 'different', permanent_card_links: [] }), /Loaded/); });
test('aggregate sales never create unit sale identity or release uncertain batch members', () => { const h = harness(); h.assign(); h.load(); h.sale(1); assert.ok([...h.state.units.values()].every(u => u.batch_id === 'fixture-batch' && u.possession === 'batch_identity_uncertain')); assert.equal([...h.state.events.values()].filter(e => e.event_kind === 'sale').length, 0); assert.throws(() => h.put('custody_moved', { unit_ids: [h.unit_ids[0]], from_custody_id: machine.custody_id, to: hq, movement: 'transfer' }, '2026-01-03T00:00:00.000Z'), /identify/); });
test('dispatch is physical transit and generic moves cannot impersonate machine loading', () => { const h = harness(); assert.throws(() => h.put('custody_moved', { unit_ids: h.unit_ids, from_custody_id: hq.custody_id, to: machine, movement: 'transfer' }), /loading batch/); h.put('custody_moved', { unit_ids: h.unit_ids, from_custody_id: hq.custody_id, to: { custody_id: 'transit:fixture-staffer', location_id: null }, movement: 'dispatch' }); assert.equal(h.state.units.get(h.unit_ids[0]).stage, 'unprocessed'); });
test('sales overlap across broad and door scopes is rejected', () => { const h = harness(); h.sale(); assert.throws(() => h.put('sale_observed', { ...[...h.state.events.values()].at(-1).data, scope: { ...scope, door_id: null } }, '2026-01-02T00:00:00.000Z'), /overlap/); });
test('physical return and refund have separate original-sale remaining limits', () => { const h = harness(); h.load(); const sale = h.sale(); h.put('refund_observed', { original_sales_observation_id: sale.event.source_event_id, amount_cents: 600, refund_reference: 'fixture-refund-1' }, '2026-01-03T00:00:00.000Z'); assert.ok([...h.state.units.values()].every(u => u.batch_id !== null)); assert.throws(() => h.put('refund_observed', { original_sales_observation_id: sale.event.source_event_id, amount_cents: 401, refund_reference: 'fixture-refund-2' }, '2026-01-03T00:00:00.000Z'), /exceed/); h.put('physical_return_observed', { batch_id: 'fixture-batch', scope, original_sales_observation_id: sale.event.source_event_id, quantity: 1, unit_ids: [h.unit_ids[0]], to: hq }, '2026-01-03T00:00:00.000Z'); assert.equal(h.state.units.get(h.unit_ids[0]).batch_id, null); assert.equal(h.state.refunded.get(sale.event.source_event_id), 600); assert.throws(() => h.put('physical_return_observed', { batch_id: 'fixture-batch', scope, original_sales_observation_id: sale.event.source_event_id, quantity: 2, unit_ids: null, to: hq }, '2026-01-03T00:00:00.000Z'), /exceed/); });
test('unknown physical returns do not manufacture receipt identities', () => { const h = harness(); h.load(); const sale = h.sale(); h.put('physical_return_observed', { batch_id: 'fixture-batch', scope, original_sales_observation_id: sale.event.source_event_id, quantity: 1, unit_ids: null, to: hq }, '2026-01-03T00:00:00.000Z'); assert.equal(h.state.units.size, 2); assert.ok([...h.state.units.values()].every(u => u.batch_id !== null)); });
test('historical replay rejects a backdated load preceding actual receipt', () => { const h = harness(); const load = h.load(); assert.throws(() => replayWorkflowEventsV2([...h.state.events.values()].map(e => e.source_event_id === load.event.source_event_id ? { ...e, effective_at: '2025-12-31T00:00:00.000Z' } : e)), /roster/); });
test('future/invalid calendar evidence and receipt roster drift fail', () => { const h = harness(); assert.throws(() => parseWorkflowCommandV2({ ...h.receipt.command, effective_at: '2026-02-30T00:00:00.000Z' }), /timestamp/); assert.throws(() => replayWorkflowEventsV2([{ ...h.receipt.event, data: { ...h.receipt.event.data, quantity: 1 } }]), /roster/); });
test('complete batch assertion cites actual count and sale observations', () => { const h = harness(); const opening = h.put('stock_counted', { scope, quantity: 0, remaining_unit_ids: [] }); h.load(); const sale = h.sale(); const closing = h.put('stock_counted', { scope, quantity: 0, remaining_unit_ids: [] }, '2026-01-02T00:00:00.000Z'); h.put('batch_reconciled', { batch_id: 'fixture-batch', opening_count_event_id: opening.event.source_event_id, closing_count_event_id: closing.event.source_event_id, sales_event_ids: [sale.event.source_event_id], movement_event_ids: [], scope_complete: true, sales_attributed: true, scope_evidence_ref: 'fixture:count-reconciliation', attribution_evidence_ref: 'fixture:batch-attribution', supersedes_event_id: null }, '2026-01-02T00:00:00.000Z'); assert.equal(h.state.reconciliations.size, 1); });
test('a complete assertion cannot omit an overlapping recorded sale', () => { const h = harness(); const opening = h.put('stock_counted', { scope, quantity: 0, remaining_unit_ids: [] }); h.load(); const sale = h.sale(); const closing = h.put('stock_counted', { scope, quantity: 0, remaining_unit_ids: [] }, '2026-01-03T00:00:00.000Z'); h.put('sale_observed', { scope, from_at: '2026-01-02T00:00:00.000Z', until_at: '2026-01-03T00:00:00.000Z', quantity: 0, actual_revenue_cents: 0 }, '2026-01-03T00:00:00.000Z'); assert.throws(() => h.put('batch_reconciled', { batch_id: 'fixture-batch', opening_count_event_id: opening.event.source_event_id, closing_count_event_id: closing.event.source_event_id, sales_event_ids: [sale.event.source_event_id], movement_event_ids: [], scope_complete: true, sales_attributed: true, scope_evidence_ref: 'fixture:complete', attribution_evidence_ref: 'fixture:attribution', supersedes_event_id: null }, '2026-01-03T00:00:00.000Z'), /omits/); });
test('canonical row verifies command, actor, identity, hash and contiguous page namespace', () => { const h = harness(); const c = h.receipt; const content = canonical(c); const row = { sequence: 1n, id: c.event.source_event_id, recordedAt: new Date(c.event.recorded_at), content, contentHash: inventoryHash(c), requestHash: inventoryHash({ command: c.command, actor: c.event.recorded_by }) }; assert.deepEqual(verifyWorkflowRowV2(row), c); assert.throws(() => verifyWorkflowRowV2({ ...row, requestHash: 'a'.repeat(64) }), /integrity/); assert.throws(() => WorkflowPageInputV2.parse({ schema_version: 2, source_system: 'ten-kings-card-platform-v2', snapshot_id: 'v2-inventory:1', after_sequence: 0, through_sequence: 1, events: [c.event] })); });
test('aggregate removals cannot exceed physically loaded stock without documented machine returns', () => { const h = harness(); h.load(); h.put('batch_removed', { batch_id: 'fixture-batch', scope, quantity: 2, unit_ids: null, to: hq }); assert.throws(() => h.put('batch_removed', { batch_id: 'fixture-batch', scope, quantity: 1, unit_ids: null, to: hq }), /removals exceed/); });
test('historical opening itself supplies the counted stock for complete sell-through', () => {
  const h = harness(2, 101, true), sale = h.sale();
  const closing = h.put('stock_counted', { scope, quantity: 0, remaining_unit_ids: [] }, '2026-01-02T00:00:00.000Z');
  const assertion = { batch_id: 'fixture-batch', opening_count_event_id: null, closing_count_event_id: closing.event.source_event_id, sales_event_ids: [sale.event.source_event_id], movement_event_ids: [], scope_complete: true, sales_attributed: true, scope_evidence_ref: 'fixture:complete', attribution_evidence_ref: 'fixture:attributed', supersedes_event_id: null };
  const result = h.put('batch_reconciled', assertion, '2026-01-02T00:00:00.000Z');
  assert.equal(h.state.reconciliations.get('fixture-batch').source_event_id, result.event.source_event_id);
  const wrongCount = h.put('stock_counted', { scope, quantity: 0, remaining_unit_ids: [] });
  assert.throws(() => h.put('batch_reconciled', { ...assertion, opening_count_event_id: wrongCount.event.source_event_id, supersedes_event_id: result.event.source_event_id }, '2026-01-02T00:00:00.000Z'), /match the recorded opening/);
});
test('completeness accounts for globally overlapping loads and one sale cannot feed two active attributions', () => {
  const h = harness();
  const opening = h.put('stock_counted', { scope, quantity: 0, remaining_unit_ids: [] });
  h.put('processed', { unit_ids: h.unit_ids, stage: 'processed', product_id: scope.product_id, permanent_card_links: [] });
  h.put('packed', { packs: h.unit_ids.map((unit_id, i) => ({ unit_id, pack_id: 'fixture-overlap-pack-' + i })) });
  const loads = h.unit_ids.map((unit_id, i) => h.put('batch_loaded', { batch_id: 'fixture-overlap-' + i, scope, unit_ids: [unit_id], from_custody_id: hq.custody_id, to: machine }));
  const sale = h.sale(), closing = h.put('stock_counted', { scope, quantity: 0, remaining_unit_ids: [] }, '2026-01-02T00:00:00.000Z');
  const assertion = { batch_id: 'fixture-overlap-0', opening_count_event_id: opening.event.source_event_id, closing_count_event_id: closing.event.source_event_id, sales_event_ids: [sale.event.source_event_id], movement_event_ids: [], scope_complete: true, sales_attributed: true, scope_evidence_ref: 'fixture:complete', attribution_evidence_ref: 'fixture:attributed', supersedes_event_id: null };
  assert.throws(() => h.put('batch_reconciled', assertion, '2026-01-02T00:00:00.000Z'), /omits a recorded load/);
  h.put('batch_reconciled', { ...assertion, movement_event_ids: [loads[1].event.source_event_id] }, '2026-01-02T00:00:00.000Z');
  assert.throws(() => h.put('batch_reconciled', { ...assertion, batch_id: 'fixture-overlap-1', movement_event_ids: [loads[0].event.source_event_id] }, '2026-01-02T00:00:00.000Z'), /two active/);
});
test('unused receipt cancellation preserves cost/price history and permanently reserves all original identities', () => {
  const h = harness(); h.assign(); h.put('price_set', { unit_ids: h.unit_ids, intended_sale_price_cents: 5000 });
  const cancelled = h.put('purchase_cancelled', { lot_id: 'fixture-lot', purchase_event_id: h.receipt.event.source_event_id, reason: 'fixture:quantity-entry-error' });
  assert.equal(h.state.units.size, 0); assert.equal(h.state.lots.size, 1); assert.equal(h.state.receivedUnitIds.size, 2); assert.equal(h.state.cancellations.get('fixture-lot').source_event_id, cancelled.event.source_event_id);
  assert.equal(h.state.assignments.size, 1); assert.equal(h.state.events.size, 4);
  assert.throws(() => h.assign(), /Cancelled/);
  assert.throws(() => h.put('price_set', { unit_ids: h.unit_ids, intended_sale_price_cents: 5000 }), /roster/);
  assert.throws(() => h.put('purchase_cost_documented', { lot_id: 'fixture-lot', total_cost_cents: 99, unknown_reason: null, purchase_evidence_ref: 'fixture:invoice', supersedes_event_id: h.receipt.event.source_event_id }), /Cancelled/);
  const replacement = { ...h.receipt.command.data, lot_id: 'fixture-corrected-lot', acquisition_cycle_id: 'fixture-corrected-cycle' };
  assert.throws(() => h.put('purchase_received', replacement), /new unique roster/);
  assert.throws(() => h.put('purchase_received', { ...replacement, acquisition_cycle_id: 'fixture-cycle', unit_ids: ['fixture-new-a', 'fixture-new-b'] }), /already received/);
  h.put('purchase_received', { ...replacement, quantity: 1, unit_ids: ['fixture-correct-unit'] });
  assert.equal(h.state.units.size, 1); assert.equal(h.state.receivedUnitIds.size, 3);
});
test('cancellation rejects wrong original receipt, historical openings and all downstream physical or reserved use', () => {
  const wrong = harness(); assert.throws(() => wrong.put('purchase_cancelled', { lot_id: 'fixture-lot', purchase_event_id: 'fixture-wrong-receipt', reason: 'fixture:typo' }), /original purchase receipt/);
  const opening = harness(1, null, true); assert.throws(() => opening.put('purchase_cancelled', { lot_id: 'fixture-lot', purchase_event_id: opening.receipt.event.source_event_id, reason: 'fixture:typo' }), /original purchase receipt/);
  for (const used of ['reserved', 'processed', 'custody_moved', 'batch_loaded']) {
    const h = harness();
    if (used === 'reserved') h.put('reserved', { unit_ids: h.unit_ids, destination: machine });
    else if (used === 'processed') h.put('processed', { unit_ids: h.unit_ids, stage: 'processing', product_id: scope.product_id, permanent_card_links: [] });
    else if (used === 'custody_moved') h.put('custody_moved', { unit_ids: h.unit_ids, from_custody_id: hq.custody_id, to: { custody_id: 'transit:fixture-cancel', location_id: null }, movement: 'dispatch' });
    else h.load();
    assert.throws(() => h.put('purchase_cancelled', { lot_id: 'fixture-lot', purchase_event_id: h.receipt.event.source_event_id, reason: 'fixture:typo' }), /unavailable after/);
  }
});
