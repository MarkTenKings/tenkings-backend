const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { writeFile } = require('node:fs/promises');
const { PrismaClient, Prisma } = require('@prisma/client');
const { recordStaffInventoryV2, recordInventoryWorkflowEventV2 } = require('../dist/database/src/cardPlatformV2');
const { readWorkflowHistoryV2, exportInventoryWorkflowPageV2 } = require('../dist/database/src/inventoryWorkflowV2Read');
const { staffInventoryWorkspaceV2 } = require('../dist/database/src/staffInventoryV2Read');
const { buildStaffInventoryCommandsV2 } = require('../dist/database/src/staffInventoryV2');
const { replayWorkflowEventsV2 } = require('../dist/database/src/inventoryWorkflowV2State');
const { WORKFLOW_MAX_EVENT_BYTES_V2 } = require('../dist/database/src/inventoryWorkflowV2');
test('staff inventory PostgreSQL atomic commands and exact retries', { skip: process.env.TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION !== '1' }, async t => {
  const url = new URL(process.env.DATABASE_URL); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/tenkings_inventory_v2_disposable');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const location = await db.location.create({ data: { name: 'DISPOSABLE STAFF FIXTURE', slug: 'staff-fixture', address: 'test only', recentRips: [], locationType: 'hq' } });
  const at = '2026-06-01T00:00:00.000Z', meta = () => ({ request_id: randomUUID(), effective_at: at, note: 'disposable staff fixture' });
  const command = { ...meta(), action: 'add', origin: 'existing', quantity: 3, total_cost_cents: 1001, cost_method: 'equal_card', expected_price_cents: 1000, description: { name: 'Disposable staff cards', category: 'Sports cards', notes: '', photo_key: null }, stage: 'packed', destination: { location_id: location.id, kind: 'hq', machine_id: null, product_id: null, door_id: null } };
  const save = (c, actor = 'fixture-staff') => db.$transaction(tx => recordStaffInventoryV2(tx, c, actor), { isolationLevel: 'ReadCommitted', timeout: 30000 });
  const advanced = c => db.$transaction(tx => recordInventoryWorkflowEventV2(tx, c, 'fixture-staff'), { isolationLevel: 'ReadCommitted', timeout: 30000 });
  const count = async () => (await readWorkflowHistoryV2(db)).length;
  const workspace = async () => staffInventoryWorkspaceV2(await readWorkflowHistoryV2(db), [location]);
  try {
    await t.test('a failed transaction leaves no partial receipt, cost, photo metadata or sequence', async () => {
      const before = await count();
      await assert.rejects(db.$transaction(async tx => { await recordStaffInventoryV2(tx, command, 'fixture-staff'); throw Error('fixture transaction interruption'); }, { timeout: 30000 }), /interruption/);
      assert.equal(await count(), before);
    });
    await t.test('two concurrent submissions and a later retry produce exactly one complete entry', async () => {
      const before = await count(); const results = await Promise.all([save(command), save(command)]);
      assert.deepEqual(results.map(r => r.outcome).sort(), ['RECORDED', 'REPLAY']); assert.equal(await count(), before + 4);
      assert.equal((await save(command)).outcome, 'REPLAY');
      await assert.rejects(save({ ...command, expected_price_cents: 1100 }), /different inventory/);
      await assert.rejects(save(command, 'another-fixture-admin'), /different inventory/); assert.equal(await count(), before + 4);
    });
    const initial = staffInventoryWorkspaceV2(await readWorkflowHistoryV2(db), [location]).items.find(i => i.name === command.description.name);
    await t.test('unequal cost allocation is atomic when amounts fail to conserve purchase cents', async () => {
      const before = await count(); const c = { ...meta(), action: 'cost', lot_id: initial.lot_id, total_cost_cents: 1200, cost_method: 'explicit_per_card', card_costs: initial.unit_ids.map(unit_id => ({ unit_id, cost_cents: 500 })) };
      await assert.rejects(save(c), /equal/); assert.equal(await count(), before);
      const after = staffInventoryWorkspaceV2(await readWorkflowHistoryV2(db), [location]).items.find(i => i.lot_id === initial.lot_id); assert.equal(after.cost_cents, 1001); assert.equal(after.purchase_total_cents, 1001);
    });
    await t.test('moving prepared stock records the chosen machine product and retains acquisition cost', async () => {
      const c = { ...meta(), action: 'move', unit_ids: initial.unit_ids, planned: false, destination: { location_id: location.id, kind: 'machine', machine_id: 'staff-fixture-machine', product_id: 'staff-fixture-product', door_id: 'fixture-slot' } };
      await save(c); assert.equal((await save(c)).outcome, 'REPLAY');
      const after = staffInventoryWorkspaceV2(await readWorkflowHistoryV2(db), [location]).items.find(i => i.lot_id === initial.lot_id);
      assert.equal(after.product_id, 'staff-fixture-product'); assert.equal(after.quantity_kind, 'loaded_roster'); assert.equal(after.cost_cents, 1001);
      assert.equal((await save(command)).outcome, 'REPLAY', 'the original add stays replayable after later physical use');
      assert.equal((await save(command, ' fixture-staff ')).outcome, 'REPLAY', 'actor identity uses the same normalization as the event writer');
      const beforeCount = await count();
      await save({ ...meta(), action: 'count', scope: after.machine_scope, quantity: 1 });
      const counted = (await workspace()).items.find(i => i.lot_id === initial.lot_id);
      assert.equal(counted.quantity, 3); assert.equal(counted.last_count.quantity, 1); assert.equal(await count(), beforeCount + 1);
      const observed = (await readWorkflowHistoryV2(db)).at(-1);
      assert.equal(observed.data.remaining_unit_ids, null); assert.equal(observed.event_kind, 'stock_counted');
    });
    await t.test('historical description edits preserve later values and pre-receipt edits roll back', async () => {
      const later = { ...meta(), effective_at: '2026-06-10T00:00:00.000Z', action: 'edit', unit_ids: initial.unit_ids, description: { ...command.description, name: 'Disposable later description' }, expected_price_cents: 2000 };
      await save(later);
      const historical = { ...later, request_id: randomUUID(), effective_at: '2026-06-05T00:00:00.000Z', description: { ...command.description, name: 'Disposable historical description' }, expected_price_cents: 1500 };
      await save(historical);
      const history = await readWorkflowHistoryV2(db);
      const asOf = staffInventoryWorkspaceV2(history.filter(e => e.effective_at <= '2026-06-06T00:00:00.000Z'), [location]).items.find(i => i.lot_id === initial.lot_id);
      assert.equal(asOf.name, historical.description.name); assert.equal(asOf.expected_price_cents, 1500);
      const current = (await workspace()).items.find(i => i.lot_id === initial.lot_id);
      assert.equal(current.name, later.description.name); assert.equal(current.expected_price_cents, 2000);
      const before = await count();
      await assert.rejects(save({ ...historical, request_id: randomUUID(), effective_at: '2026-05-31T00:00:00.000Z' }), /roster/);
      assert.equal(await count(), before); assert.equal((await save(historical)).outcome, 'REPLAY');
    });
    await t.test('a first step created through advanced records is not mistaken for a complete staff save', async () => {
      const partial = { ...command, ...meta(), origin: 'purchase', stage: 'unprocessed', description: { ...command.description, name: 'Disposable partial request' } };
      const first = buildStaffInventoryCommandsV2(partial, replayWorkflowEventsV2(await readWorkflowHistoryV2(db)))[0];
      const receipt = await advanced(first), before = await count();
      await assert.rejects(save(partial), /incomplete/);
      assert.equal(await count(), before);
      await advanced({ request_id: randomUUID(), event_kind: 'purchase_cancelled', effective_at: at, evidence_ref: 'fixture:cancel-unused-partial-entry', data: { lot_id: first.data.lot_id, purchase_event_id: receipt.event.source_event_id, reason: 'fixture:unused-partial-entry' } });
    });
    await t.test('unused staff metadata permits cancellation while later edits and cost writes cannot restore it', async () => {
      const unused = { ...command, ...meta(), origin: 'purchase', stage: 'unprocessed', quantity: 1, description: { ...command.description, name: 'Disposable unused receipt' } };
      await save(unused); const item = (await workspace()).items.find(i => i.name === unused.description.name);
      await advanced({ request_id: randomUUID(), event_kind: 'purchase_cancelled', effective_at: at, evidence_ref: 'fixture:cancel-unused-staff-entry', data: { lot_id: item.lot_id, purchase_event_id: item.provenance.receipt, reason: 'fixture:quantity-entry-error' } });
      const before = await count();
      assert.ok(!(await workspace()).items.some(i => i.lot_id === item.lot_id));
      await assert.rejects(save({ ...meta(), action: 'edit', unit_ids: item.unit_ids, description: command.description, expected_price_cents: 1 }), /no longer available/);
      await assert.rejects(save({ ...meta(), action: 'cost', lot_id: item.lot_id, total_cost_cents: 1, cost_method: 'equal_card' }), /cancelled/);
      assert.equal((await save(unused)).outcome, 'REPLAY'); assert.equal(await count(), before);
    });
    await t.test('packing changed products and moving only selected cards preserve their exact packs and cents', async () => {
      const prepared = { ...command, ...meta(), stage: 'processed', description: { ...command.description, name: 'Disposable partial movement' } };
      await save(prepared); const item = (await workspace()).items.find(i => i.name === prepared.description.name);
      await save({ ...meta(), action: 'prepare', unit_ids: item.unit_ids, stage: 'packed', product_id: 'fixture-prepared-product' });
      const packed = (await workspace()).items.find(i => i.lot_id === item.lot_id);
      assert.equal(packed.product_id, 'fixture-prepared-product'); const originalPacks = packed.units.map(u => u.pack_id);
      const store = await db.location.create({ data: { name: 'DISPOSABLE STAFF STORE', slug: 'staff-fixture-store', address: 'test only', recentRips: [], locationType: 'store' } });
      const destination = { location_id: store.id, kind: 'store', machine_id: null, product_id: null, door_id: null };
      await save({ ...meta(), action: 'move', unit_ids: item.unit_ids, planned: true, destination });
      const move = { ...meta(), action: 'move', unit_ids: [item.unit_ids[0]], planned: false, destination };
      await save(move); assert.equal((await save(move)).outcome, 'REPLAY');
      const state = replayWorkflowEventsV2(await readWorkflowHistoryV2(db));
      assert.equal(state.units.get(item.unit_ids[0]).custody.location_id, store.id); assert.equal(state.units.get(item.unit_ids[0]).reservation, null);
      assert.equal(state.units.get(item.unit_ids[1]).custody.location_id, location.id); assert.equal(state.units.get(item.unit_ids[1]).reservation.location_id, store.id);
      assert.deepEqual(item.unit_ids.map(id => state.units.get(id).pack_id), originalPacks);
      assert.equal(item.unit_ids.reduce((n, id) => n + state.units.get(id).cost.cost_cents, 0), 1001);
      const before = await count();
      await assert.rejects(save({ ...move, request_id: randomUUID(), unit_ids: [item.unit_ids[1], 'fixture-missing-unit'] }), /no longer available/);
      assert.equal(await count(), before);
    });
    await t.test('2,000-card known and unknown receipts remain atomic with full notes and exact per-card corrections', async () => {
      const beforeLimit = await count(); await assert.rejects(save({ ...command, ...meta(), quantity: 2001 }), /2000/); assert.equal(await count(), beforeLimit);
      for (const unknown of [false, true]) {
        const bulk = { ...command, ...meta(), quantity: 2000, note: '長'.repeat(1600), total_cost_cents: unknown ? null : 1000001, cost_method: unknown ? 'unassigned' : 'equal_card', expected_price_cents: Number.MAX_SAFE_INTEGER, description: { ...command.description, name: 'Disposable bulk ' + (unknown ? 'unknown' : 'known'), notes: '長'.repeat(2000) } };
        const before = await count();
        const results = await Promise.all([save(bulk), save(bulk)]);
        assert.deepEqual(results.map(r => r.outcome).sort(), ['RECORDED', 'REPLAY']); assert.equal(await count(), before + 4);
        const history = await readWorkflowHistoryV2(db), recorded = history.slice(before);
        assert.ok(recorded.every(e => e.evidence_ref.endsWith(bulk.note)));
        const allocation = recorded.find(e => e.event_kind === 'cost_assigned').data.allocation;
        assert.equal(allocation.units.length, 2000); assert.ok(allocation.units.every(u => u.evidence_ref.length < 250));
        const item = (await workspace()).items.find(i => i.name === bulk.description.name);
        assert.equal(item.quantity, 2000); assert.equal(item.cost_cents, bulk.total_cost_cents); assert.equal(item.notes, bulk.description.notes);
        assert.equal(item.value_overflow, true); assert.equal(item.expected_sales_cents, null); assert.equal(item.expected_profit_cents, null);
        if (!unknown) {
          const card_costs = item.unit_ids.map((unit_id, i) => ({ unit_id, cost_cents: i + 1 })), total = 2000 * 2001 / 2;
          const cost = { ...meta(), action: 'cost', lot_id: item.lot_id, total_cost_cents: total, cost_method: 'explicit_per_card', card_costs, note: bulk.note };
          const correctionBefore = await count();
          const retries = await Promise.all([save(cost), save(cost)]);
          assert.deepEqual(retries.map(r => r.outcome).sort(), ['RECORDED', 'REPLAY']); assert.equal(await count(), correctionBefore + 2);
          const corrected = (await workspace()).items.find(i => i.lot_id === item.lot_id);
          assert.equal(corrected.cost_cents, total); assert.equal(corrected.purchase_total_cents, total);
          assert.deepEqual(corrected.units.map(u => u.cost_cents), card_costs.map(c => c.cost_cents));
          assert.equal(corrected.expected_price_cents, Number.MAX_SAFE_INTEGER);
        }
      }
      const [size] = await db.$queryRaw(Prisma.sql`SELECT max(octet_length("content")) AS bytes FROM "InventoryWorkflowEventV2"`);
      assert.ok(size.bytes <= WORKFLOW_MAX_EVENT_BYTES_V2);
      const history = await readWorkflowHistoryV2(db); assert.deepEqual(history.map(e => e.source_sequence), history.map((_, i) => i + 1));
    });
    if (process.env.STAFF_INVENTORY_TEST_EXPORT_PATH) {
      const pages = []; let after_sequence = 0, snapshot_through_sequence;
      do { const page = await exportInventoryWorkflowPageV2(db, { after_sequence, limit: 1000, ...(snapshot_through_sequence === undefined ? {} : { snapshot_through_sequence }) }); pages.push(page); after_sequence = page.page.through_sequence; snapshot_through_sequence = page.snapshot_through_sequence; } while (after_sequence < snapshot_through_sequence);
      await writeFile(process.env.STAFF_INVENTORY_TEST_EXPORT_PATH, JSON.stringify({ test_only: true, pages, source_workspace: staffInventoryWorkspaceV2(await readWorkflowHistoryV2(db), [location]) }), { mode: 0o600 });
    }
  } finally { await db.$disconnect(); }
});
