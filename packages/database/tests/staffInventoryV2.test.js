const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { WorkflowStateV2, replayWorkflowEventsV2, calculateWorkflowAllocationV2 } = require('../dist/database/src/inventoryWorkflowV2State');
const { workflowEventIdV2, parseWorkflowCommandV2, canonical, WORKFLOW_MAX_EVENT_BYTES_V2 } = require('../dist/database/src/inventoryWorkflowV2');
const { buildStaffInventoryCommandsV2 } = require('../dist/database/src/staffInventoryV2');
const { staffInventoryWorkspaceV2 } = require('../dist/database/src/staffInventoryV2Read');
const location = { id: '11111111-1111-4111-8111-111111111111', name: 'Disposable HQ', slug: 'fixture-hq', address: 'test fixture', locationType: 'hq' };
const meta = () => ({ request_id: randomUUID(), effective_at: '2026-01-01T00:00:00.000Z', note: 'disposable test evidence' });
const added = (overrides = {}) => ({ ...meta(), action: 'add', origin: 'existing', quantity: 3, description: { name: 'Fixture cards', category: 'Sports cards', notes: '', photo_key: null }, total_cost_cents: 1001, cost_method: 'equal_card', expected_price_cents: 1000, destination: { location_id: location.id, kind: 'hq', machine_id: null, product_id: null, door_id: null }, stage: 'unprocessed', ...overrides });
function fixture() {
  let state = new WorkflowStateV2();
  const events = [];
  const append = commands => {
    const pending = [];
    for (const raw of commands) {
      const c = parseWorkflowCommandV2(raw);
      const before = replayWorkflowEventsV2([...events, ...pending].filter(e => e.effective_at <= c.effective_at));
      const event = { schema_version: 2, source_event_id: workflowEventIdV2(c.request_id), source_sequence: events.length + pending.length + 1, event_kind: c.event_kind, effective_at: c.effective_at, recorded_at: '2026-02-01T00:00:00.000Z', recorded_by: 'fixture-admin', evidence_ref: c.evidence_ref, currency: 'USD', data: c.event_kind === 'cost_assigned' ? { ...c.data, allocation: calculateWorkflowAllocationV2(before, c.data) } : c.data };
      assert.ok(Buffer.byteLength(canonical({ command: c, event }), 'utf8') <= WORKFLOW_MAX_EVENT_BYTES_V2, 'every composed event fits the durable source byte limit');
      replayWorkflowEventsV2([...events, ...pending, event]); pending.push(event);
    }
    events.push(...pending); state = replayWorkflowEventsV2(events);
    return pending;
  };
  const save = command => append(buildStaffInventoryCommandsV2(command, state));
  return { get state() { return state; }, events, append, save, view: () => staffInventoryWorkspaceV2(events, [location]) };
}
test('current stock records description, exact cent allocation, expected margin and independent card edits', () => {
  const f = fixture(); f.save(added()); const before = f.view(), item = before.items[0];
  assert.equal(item.quantity, 3); assert.deepEqual(item.units.map(u => u.cost_cents), [334, 334, 333]);
  assert.equal(item.expected_profit_cents, 1999); assert.equal(item.expected_margin_pct, 1999 / 3000 * 100);
  f.save({ ...meta(), action: 'edit', unit_ids: [item.unit_ids[1]], description: { name: 'Individual fixture card', category: 'Sports cards', notes: 'identified card', photo_key: null }, expected_price_cents: 2000 });
  assert.equal(f.view().items.length, 2); assert.equal(f.view().totals.on_hand, 3); assert.equal(f.view().totals.cost_cents, 1001); assert.equal(f.view().totals.expected_profit_cents, 2999);
  assert.ok(f.events.every(e => !['sale_observed', 'sale'].includes(e.event_kind)));
});
test('receipt at HQ, store and kiosk preserves actual receiving location', () => {
  for (const kind of ['hq', 'store', 'kiosk']) { const f = fixture(); const c = added({ origin: 'purchase' }); c.destination.kind = kind; f.save(c); assert.equal(f.events[0].event_kind, 'purchase_received'); assert.equal(f.view().items[0].custody_id, `${kind}:${location.id}`); }
});
test('unknown and evidenced zero remain different, including expected profit', () => {
  const unknown = fixture(); unknown.save(added({ total_cost_cents: null, cost_method: 'unassigned', expected_price_cents: null })); assert.equal(unknown.view().totals.cost_cents, null); assert.equal(unknown.view().totals.expected_profit_cents, null);
  const zero = fixture(); zero.save(added({ total_cost_cents: 0, expected_price_cents: 0 })); assert.equal(zero.view().totals.cost_cents, 0); assert.equal(zero.view().totals.expected_profit_cents, 0); assert.equal(zero.view().totals.expected_margin_pct, null);
});
test('processing and machine loading preserve cost; machine count remains a dated aggregate observation', () => {
  const f = fixture(); f.save(added()); const unit_ids = f.view().items[0].unit_ids;
  f.save({ ...meta(), action: 'prepare', unit_ids, stage: 'packed', product_id: 'fixture-product' });
  f.save({ ...meta(), action: 'move', unit_ids, planned: true, destination: { location_id: location.id, kind: 'machine', machine_id: 'fixture-machine', product_id: 'fixture-product', door_id: null } });
  assert.equal(f.view().totals.on_hand, 3);
  f.save({ ...meta(), action: 'move', unit_ids, planned: false, destination: { location_id: location.id, kind: 'machine', machine_id: 'fixture-machine', product_id: 'fixture-product', door_id: null } });
  assert.equal(f.view().totals.on_hand, 0); assert.equal(f.view().totals.machine_roster, 3); assert.equal(f.view().items[0].cost_cents, 1001);
  f.save({ ...meta(), action: 'count', scope: f.view().items[0].machine_scope, quantity: 2 });
  assert.equal(f.view().items[0].last_count.quantity, 2); assert.equal(f.view().items[0].quantity, 3);
  assert.equal(f.events.at(-1).data.remaining_unit_ids, null);
});
test('explicit per-card costs conserve the whole purchase total and do not change prices', () => {
  const f = fixture(); f.save(added()); const item = f.view().items[0];
  f.save({ ...meta(), action: 'cost', lot_id: item.lot_id, total_cost_cents: 1001, cost_method: 'explicit_per_card', card_costs: item.unit_ids.map((unit_id, i) => ({ unit_id, cost_cents: [501, 300, 200][i] })) });
  assert.deepEqual(f.view().items[0].units.map(u => u.cost_cents), [501, 300, 200]); assert.equal(f.view().items[0].expected_price_cents, 1000);
  assert.throws(() => f.save({ ...meta(), action: 'cost', lot_id: item.lot_id, total_cost_cents: 1001, cost_method: 'explicit_per_card', card_costs: item.unit_ids.map(unit_id => ({ unit_id, cost_cents: 500 })) }), /equal/);
});
test('invalid historical dates, duplicate cards and fabricated photo paths are rejected', () => {
  assert.throws(() => buildStaffInventoryCommandsV2(added({ effective_at: '2026-02-30T00:00:00.000Z' }), new WorkflowStateV2()));
  assert.throws(() => buildStaffInventoryCommandsV2(added({ description: { name: 'fixture', category: 'fixture', notes: '', photo_key: 'https://example.com/photo.jpg' } }), new WorkflowStateV2()));
  const f = fixture(); f.save(added()); const id = f.view().items[0].unit_ids[0];
  assert.throws(() => f.save({ ...meta(), action: 'prepare', unit_ids: [id, id], stage: 'packed', product_id: 'fixture-product' }), /once/);
});
test('2,000-card batches preserve full notes while keeping known and unknown cost events bounded', () => {
  for (const unknown of [false, true]) {
    const f = fixture(), note = '長'.repeat(1600);
    f.save(added({ quantity: 2000, note, stage: 'packed', total_cost_cents: unknown ? null : 1000001, cost_method: unknown ? 'unassigned' : 'equal_card' }));
    assert.equal(f.view().totals.on_hand, 2000);
    assert.equal(f.view().totals.cost_cents, unknown ? null : 1000001);
    assert.ok(f.events.every(e => e.evidence_ref.endsWith(note)));
    assert.ok(f.events.find(e => e.event_kind === 'cost_assigned').data.allocation.units.every(u => u.evidence_ref.length < 250));
  }
});
test('arriving at the planned store clears only fulfilled plans and preserves every card and cent', () => {
  const f = fixture(); f.save(added()); const ids = f.view().items[0].unit_ids;
  const store = { location_id: '22222222-2222-4222-8222-222222222222', kind: 'store', machine_id: null, product_id: null, door_id: null };
  const kiosk = { ...store, location_id: '33333333-3333-4333-8333-333333333333', kind: 'kiosk' };
  f.save({ ...meta(), action: 'move', unit_ids: ids, destination: store, planned: true });
  f.save({ ...meta(), action: 'move', unit_ids: [ids[0]], destination: store, planned: false });
  assert.equal(f.state.units.get(ids[0]).reservation, null);
  f.save({ ...meta(), action: 'move', unit_ids: [ids[1]], destination: kiosk, planned: false });
  assert.equal(f.state.units.get(ids[1]).reservation.custody_id, `store:${store.location_id}`);
  assert.equal(f.view().totals.on_hand, 3); assert.equal(f.view().totals.cost_cents, 1001);
});
test('derived totals that exceed integer-cent precision are explicit without hiding valid stock', () => {
  const f = fixture(); f.save(added({ quantity: 2, expected_price_cents: Number.MAX_SAFE_INTEGER }));
  const item = f.view().items[0]; assert.equal(item.quantity, 2); assert.equal(item.value_overflow, true);
  assert.equal(item.expected_sales_cents, null); assert.equal(item.expected_profit_cents, null); assert.equal(item.cost_cents, 1001);
  assert.ok(item.units.every(u => u.expected_price_cents === Number.MAX_SAFE_INTEGER));
  const g = fixture(); g.save(added({ quantity: 1, total_cost_cents: Number.MAX_SAFE_INTEGER })); g.save(added({ quantity: 1, total_cost_cents: 1 }));
  assert.equal(g.view().totals.value_overflow, true); assert.equal(g.view().totals.cost_cents, null); assert.equal(g.view().totals.on_hand, 2);
});

test('packing honors the selected product with sourced corrections and retains every original pack', () => {
  const f = fixture(); f.save(added({ stage: 'processing' }));
  const ids = f.view().items[0].unit_ids, oldProduct = f.state.units.get(ids[0]).product_id;
  f.save({ ...meta(), action: 'prepare', unit_ids: [ids[1], ids[2]], stage: 'processed', product_id: oldProduct });
  f.save({ ...meta(), action: 'prepare', unit_ids: [ids[2]], stage: 'packed', product_id: oldProduct });
  const originalPack = f.state.units.get(ids[2]).pack_id;
  const recorded = f.save({ ...meta(), action: 'prepare', unit_ids: ids, stage: 'packed', product_id: 'fixture-explicit-product' });
  assert.deepEqual(recorded.filter(e => e.event_kind === 'stock_corrected').map(e => e.data.correction.stage), ['processing', 'processed', 'packed']);
  assert.ok(ids.every(id => f.state.units.get(id).product_id === 'fixture-explicit-product'));
  assert.ok(ids.every(id => f.state.units.get(id).stage === 'packed'));
  assert.equal(f.state.units.get(ids[2]).pack_id, originalPack);
  assert.equal(f.view().totals.on_hand, 3); assert.equal(f.view().totals.cost_cents, 1001);
});

test('historical descriptions and prices preserve later edits and cannot precede receipt', () => {
  const f = fixture(); f.save(added()); const ids = f.view().items[0].unit_ids;
  const description = name => ({ name, category: 'Sports cards', notes: 'dated fixture evidence', photo_key: null });
  f.save({ ...meta(), effective_at: '2026-01-10T00:00:00.000Z', action: 'edit', unit_ids: ids, description: description('Later fixture'), expected_price_cents: 3000 });
  const frozen = canonical(f.events);
  f.save({ ...meta(), effective_at: '2026-01-05T00:00:00.000Z', action: 'edit', unit_ids: ids, description: description('Historical fixture'), expected_price_cents: 2000 });
  const asOf = staffInventoryWorkspaceV2(f.events.filter(e => e.effective_at <= '2026-01-06T00:00:00.000Z'), [location]);
  assert.equal(asOf.items[0].name, 'Historical fixture'); assert.equal(asOf.items[0].expected_price_cents, 2000);
  assert.equal(f.view().items[0].name, 'Later fixture'); assert.equal(f.view().items[0].expected_price_cents, 3000);
  assert.equal(canonical(f.events.slice(0, -2)), frozen);
  const count = f.events.length;
  assert.throws(() => f.save({ ...meta(), effective_at: '2025-12-31T00:00:00.000Z', action: 'edit', unit_ids: ids, description: description('Before receipt'), expected_price_cents: 1 }), /roster/);
  assert.equal(f.events.length, count); assert.equal(f.view().totals.cost_cents, 1001);
});

test('description and price evidence permit unused receipt cancellation and later actions cannot recreate holdings', () => {
  const f = fixture(); f.save(added({ origin: 'purchase' })); const item = f.view().items[0], receipt = f.events[0];
  f.save({ ...meta(), action: 'edit', unit_ids: item.unit_ids, description: { name: 'Receipt typo', category: 'Sports cards', notes: '', photo_key: null }, expected_price_cents: 2000 });
  f.append([{ request_id: 'fixture-cancel', event_kind: 'purchase_cancelled', effective_at: '2026-01-02T00:00:00.000Z', evidence_ref: 'fixture:unused-receipt-entry-error', data: { lot_id: item.lot_id, purchase_event_id: receipt.source_event_id, reason: 'fixture:quantity-entry-error' } }]);
  assert.equal(f.view().totals.on_hand, 0); assert.equal(f.view().items.length, 0); assert.equal(f.state.lots.get(item.lot_id).source_event_id, receipt.source_event_id);
  const count = f.events.length;
  assert.throws(() => f.save({ ...meta(), action: 'edit', unit_ids: item.unit_ids, description: added().description, expected_price_cents: 1 }), /no longer available/);
  assert.throws(() => f.save({ ...meta(), action: 'cost', lot_id: item.lot_id, total_cost_cents: 1, cost_method: 'equal_card' }), /cancelled/);
  assert.equal(f.events.length, count);
});

test('explicit card-cost input must cover the exact unique roster even when its sum matches', () => {
  const f = fixture(); f.save(added()); const item = f.view().items[0];
  const command = { ...meta(), action: 'cost', lot_id: item.lot_id, total_cost_cents: 1200, cost_method: 'explicit_per_card' };
  const invalid = [
    [{ unit_id: item.unit_ids[0], cost_cents: 600 }, { unit_id: item.unit_ids[0], cost_cents: 600 }],
    [{ unit_id: item.unit_ids[0], cost_cents: 1200 }],
    item.unit_ids.map((unit_id, i) => ({ unit_id: i === 2 ? 'fixture-foreign-unit' : unit_id, cost_cents: 400 })),
  ];
  const frozen = canonical(f.events);
  for (const card_costs of invalid) {
    assert.throws(() => f.save({ ...command, card_costs }));
    assert.equal(canonical(f.events), frozen); assert.equal(f.view().totals.cost_cents, 1001);
  }
  assert.throws(() => f.save(added({ quantity: 2001 })), /2000/);
});

test('machine observations stay within their exact product and door without turning counts into stock or sales', () => {
  const f = fixture();
  f.save(added({ stage: 'packed', destination: { location_id: location.id, kind: 'machine', machine_id: 'fixture-machine', product_id: 'fixture-product', door_id: 'fixture-door' } }));
  const scope = f.view().items[0].machine_scope;
  f.save({ ...meta(), action: 'count', scope, quantity: 2 });
  f.save({ ...meta(), effective_at: '2026-01-03T00:00:00.000Z', action: 'count', scope: { ...scope, product_id: 'another-product' }, quantity: 20 });
  f.save({ ...meta(), effective_at: '2026-01-04T00:00:00.000Z', action: 'count', scope: { ...scope, door_id: 'another-door' }, quantity: 30 });
  f.save({ ...meta(), effective_at: '2026-01-02T00:00:00.000Z', action: 'count', scope, quantity: 1 });
  assert.equal(f.view().items[0].last_count.quantity, 1); assert.equal(f.view().items[0].quantity, 3);
  assert.equal(f.view().totals.on_hand, 0); assert.equal(f.view().totals.machine_roster, 3);
  assert.ok(f.events.filter(e => e.event_kind === 'stock_counted').every(e => e.data.remaining_unit_ids === null));
  assert.ok(!f.events.some(e => e.event_kind === 'sale_observed'));
});
