const test = require('node:test');
const assert = require('node:assert/strict');
const { replayWorkflowEventsV2, calculateWorkflowAllocationV2 } = require('../dist/database/src/inventoryWorkflowV2State');
const { WorkflowEventInputV2, parseWorkflowCommandV2, canonical, inventoryHash, workflowEventIdV2 } = require('../dist/database/src/inventoryWorkflowV2');
const { verifyWorkflowRowV2 } = require('../dist/database/src/inventoryWorkflowV2Read');
const hq = { custody_id: 'hq:correction-fixture', location_id: '11111111-1111-4111-8111-111111111111' };
const transit = { custody_id: 'transit:correction-fixture', location_id: null };
const scope = { machine_id: 'correction-fixture-machine', product_id: 'product', door_id: 'door' };
function fixture() {
  const events = []; let seq = 0;
  const state = () => replayWorkflowEventsV2(events);
  const put = (event_kind, data, at = '2026-01-02T00:00:00.000Z') => {
    const command = parseWorkflowCommandV2({ request_id: 'correction-fixture-' + (++seq), event_kind, data, effective_at: at, evidence_ref: 'fixture:physical-document' });
    const event = WorkflowEventInputV2.parse({ schema_version: 2, source_event_id: workflowEventIdV2(command.request_id), source_sequence: events.length + 1, event_kind, data: event_kind === 'cost_assigned' ? { ...data, allocation: calculateWorkflowAllocationV2(state(), data) } : data, effective_at: at, recorded_at: '2026-04-01T00:00:00.000Z', recorded_by: 'fixture-admin', evidence_ref: command.evidence_ref, currency: 'USD' });
    replayWorkflowEventsV2([...events, event]); events.push(event); return { event, command };
  };
  const correction = (c, overrides = {}) => ({ unit_ids: ['a', 'b'], expected_states: ['a', 'b'].map(unit_id => ({ unit_id, state_event_id: state().units.get(unit_id).state_event_id })), reason: 'fixture:verified-entry-error', correction: c, ...overrides });
  put('purchase_received', { lot_id: 'lot', acquisition_cycle_id: 'cycle', quantity: 2, total_cost_cents: 101, unknown_reason: null, purchase_evidence_ref: 'fixture:invoice', unit_ids: ['a', 'b'], custody: hq }, '2026-01-01T00:00:00.000Z');
  put('cost_assigned', { lot_id: 'lot', assignment: { method: 'equal_card', basis: 'allocated_acquisition', evidence_ref: 'fixture:chosen-policy' }, supersedes_event_id: null });
  return { events, state, put, correction };
}
const process = h => h.put('processed', { unit_ids: ['a', 'b'], stage: 'processed', product_id: 'wrong-product', permanent_card_links: [] });
const pack = h => h.put('packed', { packs: [{ unit_id: 'a', pack_id: 'pack-a' }, { unit_id: 'b', pack_id: 'pack-b' }] });

test('processed and moved stock can be corrected while exact acquisition cents, original events and as-of custody remain', () => {
  const h = fixture(); const processed = process(h); const original = JSON.stringify(h.events);
  h.put('stock_corrected', h.correction({ kind: 'processing', stage: 'processed', product_id: 'product' }));
  h.put('custody_moved', { unit_ids: ['a', 'b'], from_custody_id: hq.custody_id, to: transit, movement: 'dispatch' });
  h.put('stock_corrected', h.correction({ kind: 'custody', to: hq }), '2026-02-01T00:00:00.000Z');
  assert.equal(JSON.stringify(h.events.slice(0, 3)), original);
  assert.equal(h.state().events.get(processed.event.source_event_id).data.product_id, 'wrong-product');
  assert.deepEqual([...h.state().units.values()].map(u => [u.product_id, u.custody, u.cost.cost_cents]), [['product', hq, 51], ['product', hq, 50]]);
  assert.ok([...replayWorkflowEventsV2(h.events.filter(e => e.effective_at < '2026-02')).units.values()].every(u => u.custody.custody_id === transit.custody_id));
});
test('pack correction retires prior IDs, supports unpack and preserves one-card membership', () => {
  const h = fixture(); process(h); pack(h);
  h.put('stock_corrected', h.correction({ kind: 'packing', packs: [{ unit_id: 'a', pack_id: 'replacement-a' }, { unit_id: 'b', pack_id: 'replacement-b' }] }));
  h.put('stock_corrected', h.correction({ kind: 'packing', packs: [] }));
  assert.ok([...h.state().units.values()].every(u => u.stage === 'processed' && u.pack_id === null));
  assert.equal(h.state().packIds.size, 4);
  assert.throws(() => h.put('stock_corrected', h.correction({ kind: 'packing', packs: [{ unit_id: 'a', pack_id: 'pack-a' }, { unit_id: 'b', pack_id: 'pack-b' }] })), /cannot be reused/);
  assert.throws(() => h.put('stock_corrected', h.correction({ kind: 'packing', packs: [{ unit_id: 'a', pack_id: 'fresh-a' }] })), /one unique pack/);
});
test('packed product correction preserves exact existing pack identity and cannot create a pack by changing stage', () => {
  const h = fixture(); process(h);
  assert.throws(() => h.put('stock_corrected', h.correction({ kind: 'processing', stage: 'packed', product_id: 'product' })), /packing correction/);
  pack(h); h.put('stock_corrected', h.correction({ kind: 'processing', stage: 'packed', product_id: 'product' }));
  assert.deepEqual([...h.state().units.values()].map(u => [u.stage, u.product_id, u.pack_id, u.cost.cost_cents]), [['packed', 'product', 'pack-a', 51], ['packed', 'product', 'pack-b', 50]]);
  assert.throws(() => h.put('stock_corrected', h.correction({ kind: 'processing', stage: 'processed', product_id: 'product' })), /packing correction/);
});
test('stale or incomplete physical anchors reject the entire correction without changing history', () => {
  const h = fixture(); process(h); const stale = h.correction({ kind: 'custody', to: transit }); pack(h);
  const before = JSON.stringify(h.events);
  assert.throws(() => h.put('stock_corrected', stale), /exact current physical-state/);
  assert.throws(() => h.put('stock_corrected', h.correction({ kind: 'custody', to: transit }, { expected_states: [] })), /Too small/);
  assert.equal(JSON.stringify(h.events), before);
});
test('ambiguous loaded stock cannot be corrected or rescued by a backdated correction', () => {
  const h = fixture(); process(h); h.put('stock_corrected', h.correction({ kind: 'processing', stage: 'processed', product_id: 'product' })); pack(h);
  const beforeLoad = h.correction({ kind: 'packing', packs: [{ unit_id: 'a', pack_id: 'fresh-a' }, { unit_id: 'b', pack_id: 'fresh-b' }] });
  h.put('batch_loaded', { batch_id: 'batch', scope, unit_ids: ['a', 'b'], from_custody_id: hq.custody_id, to: { custody_id: 'machine:' + scope.machine_id, location_id: hq.location_id } }, '2026-02-01T00:00:00.000Z');
  assert.throws(() => h.put('stock_corrected', h.correction({ kind: 'packing', packs: [] }), '2026-02-02T00:00:00.000Z'), /does not prove/);
  assert.throws(() => h.put('stock_corrected', beforeLoad, '2026-01-03T00:00:00.000Z'), /cannot be backdated/);
});
test('identified actual removal permits correction; unidentified return does not invent held units', () => {
  const h = fixture(); process(h); h.put('stock_corrected', h.correction({ kind: 'processing', stage: 'processed', product_id: 'product' })); pack(h);
  h.put('batch_loaded', { batch_id: 'batch', scope, unit_ids: ['a', 'b'], from_custody_id: hq.custody_id, to: { custody_id: 'machine:' + scope.machine_id, location_id: hq.location_id } });
  h.put('batch_removed', { batch_id: 'batch', scope, quantity: 1, unit_ids: ['a'], to: hq });
  h.put('stock_corrected', h.correction({ kind: 'packing', packs: [] }, { unit_ids: ['a'], expected_states: [{ unit_id: 'a', state_event_id: h.state().units.get('a').state_event_id }] }));
  assert.equal(h.state().units.get('a').cost.cost_cents, 51); assert.equal(h.state().units.get('b').batch_id, 'batch');
});
test('linked permanent card identity cannot be cleared or demoted by correction', () => {
  const h = fixture(); h.put('processed', { unit_ids: ['a', 'b'], stage: 'processed', product_id: 'product', permanent_card_links: [{ unit_id: 'a', card_id: 'real-fixture-card' }] });
  assert.throws(() => h.put('stock_corrected', h.correction({ kind: 'processing', stage: 'processing', product_id: 'product' })), /cannot be demoted/);
  assert.throws(() => h.put('stock_corrected', h.correction({ kind: 'custody', to: { custody_id: hq.custody_id, location_id: '22222222-2222-4222-8222-222222222222' } })), /already bound/);
  assert.throws(() => h.put('stock_corrected', h.correction({ kind: 'custody', to: { custody_id: 'machine:other', location_id: hq.location_id } })), /loading batch/);
});
test('correction wire integrity binds exact command, original anchors, actor and evidence', () => {
  const h = fixture(); process(h); const saved = h.put('stock_corrected', h.correction({ kind: 'processing', stage: 'processed', product_id: 'product' }));
  const row = { sequence: BigInt(saved.event.source_sequence), id: saved.event.source_event_id, recordedAt: new Date(saved.event.recorded_at), content: canonical(saved), contentHash: inventoryHash(saved), requestHash: inventoryHash({ command: saved.command, actor: saved.event.recorded_by }) };
  assert.deepEqual(verifyWorkflowRowV2(row), saved);
  assert.throws(() => verifyWorkflowRowV2({ ...row, content: canonical({ ...saved, event: { ...saved.event, data: { ...saved.event.data, reason: 'tampered' } } }) }), /integrity/);
});
