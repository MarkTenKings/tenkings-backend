const test = require('node:test');
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { PrismaClient } = require('@prisma/client');
const { recordInventoryWorkflowEventV2, recordCardInventoryEventV2, createCardFromSpeedster, voidCard } = require('../dist/database/src/cardPlatformV2');
const { readWorkflowWorkspaceV2, exportInventoryWorkflowPageV2 } = require('../dist/database/src/inventoryWorkflowV2Read');
const { createFinancialWorkflowReadHandlerV2 } = require('../dist/database/src/inventoryWorkflowV2Http');
const { createHash } = require('node:crypto');
const enabled = process.env.TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION === '1';
test('purchased-lot PostgreSQL workflow and authenticated export', { skip: !enabled }, async t => {
  const url = new URL(process.env.DATABASE_URL); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/tenkings_inventory_v2_disposable');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const location = await db.location.create({ data: { name: 'DISPOSABLE RAW WORKFLOW FIXTURE', slug: 'workflow-fixture', address: 'fixture', recentRips: [] } });
  const hq = { custody_id: 'hq:workflow-fixture', location_id: location.id }, transit = { custody_id: 'transit:workflow-fixture-staffer', location_id: null };
  let n = 0;
  const at = '2026-01-01T00:00:00.000Z', until = '2026-01-02T00:00:00.000Z', returnedAt = '2026-01-03T00:00:00.000Z';
  const command = (event_kind, data, effective_at = at) => ({ request_id: 'workflow-pg-fixture-' + (++n), event_kind, data, effective_at, evidence_ref: 'fixture:workflow-evidence' });
  const record = (c, preview = false) => db.$transaction(tx => recordInventoryWorkflowEventV2(tx, c, 'fixture-workflow-admin', { preview }), { isolationLevel: 'ReadCommitted', timeout: 30000 });
  const maximum = async () => Number((await db.$queryRawUnsafe('SELECT COALESCE(MAX("sequence"), 0)::bigint AS n FROM "InventoryWorkflowEventV2"'))[0].n);
  const exportPages = async () => {
    const token = 'isolated-workflow-read-capability-1234567890', hash = createHash('sha256').update(token).digest('hex');
    const handler = createFinancialWorkflowReadHandlerV2({ tokenHash: () => hash, readPage: input => exportInventoryWorkflowPageV2(db, input) });
    const pages = []; let after_sequence = 0, snapshot_through_sequence;
    do {
      const response = { statusCode: null, headers: {}, body: null, status(code) { this.statusCode = code; return this; }, setHeader(key, value) { this.headers[key] = value; }, json(body) { this.body = body; } };
      await handler({ method: 'GET', headers: { authorization: 'Bearer ' + token }, query: { after_sequence: String(after_sequence), limit: '5', ...(snapshot_through_sequence === undefined ? {} : { snapshot_through_sequence: String(snapshot_through_sequence) }) } }, response);
      assert.equal(response.statusCode, 200); assert.equal(response.headers['Cache-Control'], 'private, no-store');
      pages.push(response.body); after_sequence = response.body.page.through_sequence; snapshot_through_sequence = response.body.snapshot_through_sequence;
    } while (after_sequence < snapshot_through_sequence);
    assert.equal(pages[0].page.schema_version, 2); assert.equal(pages[0].page.snapshot_id, 'v2-inventory-workflow:' + snapshot_through_sequence);
    assert.equal(pages.reduce((n, p) => n + p.page.events.length, 0), await maximum());
    return pages;
  };
  const cases = [
    { lot: 'workflow-fixture-lot-a', product: 'workflow-fixture-product-a', machine: 'workflow-fixture-machine-a', qty: 2, cost: 1001 },
    { lot: 'workflow-fixture-lot-b', product: 'workflow-fixture-product-b', machine: 'workflow-fixture-machine-a', qty: 1, cost: 125 },
    { lot: 'workflow-fixture-lot-c', product: 'workflow-fixture-product-c', machine: 'workflow-fixture-machine-b', qty: 1, cost: null },
  ].map(c => ({ ...c, scope: { machine_id: c.machine, product_id: c.product, door_id: 'door:' + c.product }, ids: Array.from({ length: c.qty }, (_, i) => c.lot + ':unit:' + i), batch: c.lot + ':batch' }));
  let historicalCase;
  try {
    await t.test('raw receipt previews are zero-write, retries exact, and concurrent receipts contiguous', async () => {
      const requests = cases.map(c => command('purchase_received', { lot_id: c.lot, acquisition_cycle_id: c.lot + ':cycle', quantity: c.qty, total_cost_cents: c.cost, unknown_reason: c.cost === null ? 'fixture:missing-cost' : null, purchase_evidence_ref: 'fixture:invoice:' + c.lot, unit_ids: c.ids, custody: hq }));
      const preview = await record(requests[0], true); assert.equal(preview.outcome, 'PREVIEW'); assert.equal(await maximum(), 0);
      const out = await Promise.all(requests.map(c => record(c))); assert.deepEqual(out.map(e => e.event.source_sequence).sort(), [1, 2, 3]);
      assert.equal((await record(requests[0])).outcome, 'REPLAY'); await assert.rejects(record({ ...requests[0], evidence_ref: 'fixture:changed' }), /Retry changed/);
      cases.forEach((c, i) => { c.receipt = out[i].event; });
    });
    await t.test('cost assignments conserve purchase cents, unknown stays null and prices remain independent', async () => {
      for (const c of cases) {
        const assignment = c.cost === null ? { method: 'unassigned', basis: 'unknown', unknown_reason: 'fixture:no-unit-cost' } : c.qty === 1 ? { method: 'documented_unit', basis: 'documented_unit', costs: [{ unit_id: c.ids[0], cost_cents: c.cost, evidence_ref: 'fixture:line-item-invoice' }] } : { method: 'equal_card', basis: 'allocated_acquisition', evidence_ref: 'fixture:explicit-equal-choice' };
        c.assignment = (await record(command('cost_assigned', { lot_id: c.lot, assignment, supersedes_event_id: null }))).event;
        await record(command('price_set', { unit_ids: c.ids, intended_sale_price_cents: 5000 }));
      }
      const view = await db.$transaction(tx => readWorkflowWorkspaceV2(tx, { lot_id: cases[0].lot }), { isolationLevel: 'RepeatableRead' });
      assert.equal(view.units.reduce((n, u) => n + u.cost.cost_cents, 0), 1001); assert.ok(view.units.every(u => u.intended_sale_price_cents === 5000));
      const raw = await db.$queryRawUnsafe('SELECT COUNT(*)::bigint AS n FROM "CollectibleCardV2" WHERE "createdByAdminId" = $1', 'fixture-workflow-admin'); assert.equal(raw[0].n, 0n);
    });
    await t.test('processing, single-card packs, reservation, dispatch and machine loads preserve roster custody', async () => {
      for (const c of cases) {
        await record(command('processed', { unit_ids: c.ids, stage: 'processing', product_id: c.product, permanent_card_links: [] }));
        await record(command('processed', { unit_ids: c.ids, stage: 'processed', product_id: c.product, permanent_card_links: [] }));
        await record(command('packed', { packs: c.ids.map(unit_id => ({ unit_id, pack_id: unit_id + ':pack' })) }));
        await record(command('reserved', { unit_ids: c.ids, destination: { custody_id: 'machine:' + c.machine, location_id: location.id } }));
        await record(command('custody_moved', { unit_ids: c.ids, from_custody_id: hq.custody_id, to: transit, movement: 'dispatch' }));
        c.opening = (await record(command('stock_counted', { scope: c.scope, quantity: 0, remaining_unit_ids: [] }))).event;
        c.load = (await record(command('batch_loaded', { batch_id: c.batch, scope: c.scope, unit_ids: c.ids, from_custody_id: transit.custody_id, to: { custody_id: 'machine:' + c.machine, location_id: location.id } }))).event;
      }
      const view = await db.$transaction(tx => readWorkflowWorkspaceV2(tx, { batch_id: cases[0].batch }), { isolationLevel: 'RepeatableRead' });
      assert.ok(view.units.every(u => u.stage === 'packed' && u.batch_id === cases[0].batch && u.possession === 'batch_identity_uncertain'));
    });
    await t.test('aggregate sell-through retains observations and referenced completeness without unit sales', async () => {
      for (const c of cases) {
        c.sale = (await record(command('sale_observed', { scope: c.scope, from_at: at, until_at: until, quantity: c.qty, actual_revenue_cents: c.qty * 5000 }, until))).event;
        c.closing = (await record(command('stock_counted', { scope: c.scope, quantity: 0, remaining_unit_ids: [] }, until))).event;
        c.reconciliation = (await record(command('batch_reconciled', { batch_id: c.batch, opening_count_event_id: c.opening.source_event_id, closing_count_event_id: c.closing.source_event_id, sales_event_ids: [c.sale.source_event_id], movement_event_ids: [], scope_complete: true, sales_attributed: true, scope_evidence_ref: 'fixture:stock-completeness', attribution_evidence_ref: 'fixture:batch-attribution', supersedes_event_id: null }, until))).event;
      }
      assert.equal((await db.$queryRawUnsafe('SELECT COUNT(*)::bigint AS n FROM "InventoryWorkflowEventV2" WHERE "content"::jsonb -> \'event\' ->> \'event_kind\' = \'sale\''))[0].n, 0n);
    });
    await t.test('known physical return and partial refund reference original observation independently', async () => {
      const c = cases[1];
      c.returned = (await record(command('physical_return_observed', { batch_id: c.batch, scope: c.scope, original_sales_observation_id: c.sale.source_event_id, quantity: 1, unit_ids: c.ids, to: hq }, returnedAt))).event;
      c.refund = (await record(command('refund_observed', { original_sales_observation_id: c.sale.source_event_id, amount_cents: 1000, refund_reference: 'fixture:completed-partial-refund' }, returnedAt))).event;
      const before = await maximum();
      await assert.rejects(record(command('refund_observed', { original_sales_observation_id: c.sale.source_event_id, amount_cents: 4001, refund_reference: 'fixture:over-refund' }, returnedAt)), /exceed/);
      await assert.rejects(record(command('physical_return_observed', { batch_id: c.batch, scope: c.scope, original_sales_observation_id: c.sale.source_event_id, quantity: 1, unit_ids: null, to: hq }, returnedAt)), /exceed/);
      assert.equal(await maximum(), before);
      for (const selection of [{ batch_id: c.batch }, { lot_id: c.lot }]) {
        const view = await db.$transaction(tx => readWorkflowWorkspaceV2(tx, selection), { isolationLevel: 'RepeatableRead' });
        assert.ok(view.events.some(e => e.source_event_id === c.refund.source_event_id));
        assert.ok(view.events.some(e => e.source_event_id === c.returned.source_event_id));
      }
    });
    await t.test('historical preview rejects broken causal stock and transaction rollback consumes no sequence', async () => {
      const before = await maximum(), c = cases[0];
      await assert.rejects(record(command('custody_moved', { unit_ids: c.ids, from_custody_id: hq.custody_id, to: transit, movement: 'dispatch' }, '2025-12-31T00:00:00.000Z'), true), /roster/);
      await assert.rejects(db.$transaction(async tx => { await recordInventoryWorkflowEventV2(tx, command('price_set', { unit_ids: c.ids, intended_sale_price_cents: 5100 }, returnedAt), 'fixture-workflow-admin'); throw new Error('fixture rollback'); }, { isolationLevel: 'ReadCommitted' }), /fixture rollback/);
      assert.equal(await maximum(), before);
    });
    await t.test('SQL append-only, gap, content hash and actor/request identity guards fail closed', async () => {
      await assert.rejects(db.$executeRawUnsafe('UPDATE "InventoryWorkflowEventV2" SET "content" = "content"'), /append-only/);
      await assert.rejects(db.$executeRawUnsafe('DELETE FROM "InventoryWorkflowEventV2"'), /append-only/);
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE "InventoryWorkflowEventV2"'), /append-only/);
      await assert.rejects(db.$transaction(async tx => { await tx.$executeRawUnsafe('ALTER TABLE "InventoryWorkflowEventV2" DISABLE TRIGGER "InventoryWorkflowEventV2_no_update_delete"'); await tx.$executeRawUnsafe('DELETE FROM "InventoryWorkflowEventV2" WHERE "sequence" = 2'); await exportInventoryWorkflowPageV2(tx, { after_sequence: 0, limit: 1000 }); }), /integrity/);
      await assert.rejects(db.$transaction(async tx => { await tx.$executeRawUnsafe('ALTER TABLE "InventoryWorkflowEventV2" DISABLE TRIGGER "InventoryWorkflowEventV2_no_update_delete"'); await tx.$executeRawUnsafe('UPDATE "InventoryWorkflowEventV2" SET "requestHash" = repeat(\'0\', 64) WHERE "sequence" = 1'); await exportInventoryWorkflowPageV2(tx, { after_sequence: 0, limit: 1000 }); }), /integrity/);
    });
    await t.test('scoped authenticated export pins snapshot and writes source-generated fixture pages for mirror proof', async () => {
      const pages = await exportPages();
      if (process.env.INVENTORY_WORKFLOW_TEST_EXPORT_PATH) await writeFile(process.env.INVENTORY_WORKFLOW_TEST_EXPORT_PATH, JSON.stringify({ test_only: true, source_system: 'ten-kings-card-platform-v2', cases, pages }), { mode: 0o600 });
    });
    await t.test('historical machine opening records actual counted stock without prior HQ or fabricated load', async () => {
      const scope = { machine_id: 'fixture-opening-machine', product_id: 'fixture-opening-product', door_id: 'fixture-opening-door' };
      const opening = command('opening_stock_recorded', { lot_id: 'fixture-opening-lot', acquisition_cycle_id: 'fixture-opening-cycle', quantity: 1, total_cost_cents: null, unknown_reason: 'fixture:prior-cost-unavailable', purchase_evidence_ref: 'fixture:opening-count-document', unit_ids: ['fixture-opening-unit'], custody: { custody_id: 'machine:' + scope.machine_id, location_id: location.id }, stage: 'packed', product_id: scope.product_id, packs: [{ unit_id: 'fixture-opening-unit', pack_id: 'fixture-opening-pack' }], machine_scope: scope, loading_batch_id: 'fixture-opening-batch' });
      const out = await record(opening);
      const view = await db.$transaction(tx => readWorkflowWorkspaceV2(tx, { batch_id: 'fixture-opening-batch' }), { isolationLevel: 'RepeatableRead' });
      assert.equal(view.selected_batch.origin_kind, 'opening_stock_recorded'); assert.equal(view.selected_batch.data.from_custody_id, null); assert.equal(view.selected_batch.source_event_id, out.event.source_event_id);
      assert.equal(view.units[0].custody.custody_id, 'machine:' + scope.machine_id);
      await assert.rejects(record({ ...opening, request_id: 'fixture-duplicate-opening', effective_at: '2025-12-31T00:00:00.000Z', data: { ...opening.data, lot_id: 'fixture-another-opening', acquisition_cycle_id: 'fixture-another-opening-cycle', unit_ids: ['fixture-another-opening-unit'], packs: [{ unit_id: 'fixture-another-opening-unit', pack_id: 'fixture-another-opening-pack' }] } }), /only before any accepted history/);
      const correction = await record(command('purchase_cost_documented', { lot_id: opening.data.lot_id, total_cost_cents: 200, unknown_reason: null, purchase_evidence_ref: 'fixture:found-opening-invoice', supersedes_event_id: out.event.source_event_id }, until));
      const assigned = await record(command('cost_assigned', { lot_id: opening.data.lot_id, assignment: { method: 'documented_unit', basis: 'documented_unit', costs: [{ unit_id: 'fixture-opening-unit', cost_cents: 200, evidence_ref: 'fixture:found-opening-invoice-line' }] }, supersedes_event_id: null }, until));
      assert.equal(assigned.event.data.allocation.units[0].cost_cents, 200); assert.ok(correction.event.source_sequence > out.event.source_sequence);
      const historicalPrice = command('price_set', { unit_ids: opening.data.unit_ids, intended_sale_price_cents: 1500 }, '2026-01-01T12:00:00.000Z');
      assert.equal((await record(historicalPrice, true)).impact.backdated, true);
      const backfill = await record(historicalPrice);
      const amended = await record(command('purchase_cost_documented', { lot_id: opening.data.lot_id, total_cost_cents: 250, unknown_reason: null, purchase_evidence_ref: 'fixture:corrected-opening-invoice', supersedes_event_id: correction.event.source_event_id }, '2026-01-04T00:00:00.000Z'));
      const awaitingAssignment = await db.$transaction(tx => readWorkflowWorkspaceV2(tx, { lot_id: opening.data.lot_id }), { isolationLevel: 'RepeatableRead' });
      assert.equal(awaitingAssignment.units[0].cost, null);
      const reassigned = await record(command('cost_assigned', { lot_id: opening.data.lot_id, assignment: { method: 'documented_unit', basis: 'documented_unit', costs: [{ unit_id: 'fixture-opening-unit', cost_cents: 250, evidence_ref: 'fixture:corrected-opening-invoice-line' }] }, supersedes_event_id: assigned.event.source_event_id }, '2026-01-04T00:00:00.000Z'));
      assert.equal(reassigned.event.data.allocation.units[0].cost_cents, 250);
      const soldAt = '2026-01-05T00:00:00.000Z';
      const sale = await record(command('sale_observed', { scope, from_at: at, until_at: soldAt, quantity: 1, actual_revenue_cents: 1500 }, soldAt));
      const closing = await record(command('stock_counted', { scope, quantity: 0, remaining_unit_ids: [] }, soldAt));
      const reconciled = await record(command('batch_reconciled', { batch_id: opening.data.loading_batch_id, opening_count_event_id: null, closing_count_event_id: closing.event.source_event_id, sales_event_ids: [sale.event.source_event_id], movement_event_ids: [], scope_complete: true, sales_attributed: true, scope_evidence_ref: 'fixture:opening-through-closing-complete', attribution_evidence_ref: 'fixture:opening-batch-sell-through', supersedes_event_id: null }, soldAt));
      assert.equal(reconciled.event.data.opening_count_event_id, null);
      const pages = await exportPages();
      historicalCase = { lot: opening.data.lot_id, product: scope.product_id, machine: scope.machine_id, qty: 1, cost: 250, scope, ids: opening.data.unit_ids, batch: opening.data.loading_batch_id, receipt: out.event, supplement: correction.event, assignment: assigned.event, backfill: backfill.event, correction: amended.event, reassignment: reassigned.event, sale: sale.event, closing: closing.event, reconciliation: reconciled.event };
      if (process.env.INVENTORY_WORKFLOW_EXTENDED_TEST_EXPORT_PATH) await writeFile(process.env.INVENTORY_WORKFLOW_EXTENDED_TEST_EXPORT_PATH, JSON.stringify({ test_only: true, source_system: 'ten-kings-card-platform-v2', cases, historical_case: historicalCase, pages }), { mode: 0o600 });
    });
    await t.test('unused receipt cancellation is append-only, removes holdings, binds the original and rejects downstream or backdated evasion', async () => {
      const receiptAt = '2026-01-06T00:00:00.000Z', cancelAt = '2026-01-07T00:00:00.000Z';
      const receiptCommand = command('purchase_received', { lot_id: 'fixture-erroneous-lot', acquisition_cycle_id: 'fixture-erroneous-cycle', quantity: 2, total_cost_cents: 90, unknown_reason: null, purchase_evidence_ref: 'fixture:purchase-document', unit_ids: ['fixture-erroneous-unit-a', 'fixture-erroneous-unit-b'], custody: hq }, receiptAt);
      const receipt = await record(receiptCommand);
      const assignment = await record(command('cost_assigned', { lot_id: receiptCommand.data.lot_id, assignment: { method: 'equal_card', basis: 'allocated_acquisition', evidence_ref: 'fixture:explicit-allocation' }, supersedes_event_id: null }, receiptAt));
      const price = await record(command('price_set', { unit_ids: receiptCommand.data.unit_ids, intended_sale_price_cents: 5000 }, receiptAt));
      const cancelCommand = command('purchase_cancelled', { lot_id: receiptCommand.data.lot_id, purchase_event_id: receipt.event.source_event_id, reason: 'fixture:quantity-entry-was-two-but-document-shows-one' }, cancelAt);
      const before = await maximum();
      assert.equal((await record(cancelCommand, true)).outcome, 'PREVIEW'); assert.equal(await maximum(), before);
      await assert.rejects(record({ ...cancelCommand, request_id: 'fixture-cancel-wrong-receipt', data: { ...cancelCommand.data, purchase_event_id: cases[0].receipt.source_event_id } }), /original purchase receipt/);
      await assert.rejects(record(command('purchase_cancelled', { lot_id: cases[0].lot, purchase_event_id: cases[0].receipt.source_event_id, reason: 'fixture:cannot-hide-loaded-stock' }, at)), /unavailable after/);
      await assert.rejects(record(command('purchase_cancelled', { lot_id: historicalCase.lot, purchase_event_id: historicalCase.receipt.source_event_id, reason: 'fixture:cannot-cancel-opening' }, cancelAt)), /Historical opening/);
      const cancelled = await record(cancelCommand); assert.equal((await record(cancelCommand)).outcome, 'REPLAY');
      await assert.rejects(record({ ...cancelCommand, data: { ...cancelCommand.data, reason: 'fixture:changed' } }), /Retry changed/);
      const view = await db.$transaction(tx => readWorkflowWorkspaceV2(tx, { lot_id: receiptCommand.data.lot_id }), { isolationLevel: 'RepeatableRead' });
      assert.equal(view.units.length, 0); assert.equal(view.lots.find(l => l.lot_id === receiptCommand.data.lot_id).cancelled_event_id, cancelled.event.source_event_id);
      assert.equal(view.events.length, 4); assert.ok(view.events.some(e => e.source_event_id === receipt.event.source_event_id)); assert.ok(view.events.some(e => e.source_event_id === cancelled.event.source_event_id));
      await assert.rejects(record(command('cost_assigned', { lot_id: receiptCommand.data.lot_id, assignment: assignment.event.data.assignment, supersedes_event_id: assignment.event.source_event_id }, cancelAt)), /Cancelled/);
      await assert.rejects(record(command('price_set', { unit_ids: receiptCommand.data.unit_ids, intended_sale_price_cents: 6000 }, cancelAt)), /roster/);
      await assert.rejects(record({ ...receiptCommand, request_id: 'fixture-reused-cancelled-ids', effective_at: cancelAt, data: { ...receiptCommand.data, lot_id: 'fixture-corrected-lot', acquisition_cycle_id: 'fixture-corrected-cycle' } }), /new unique roster/);
      const replacement = await record(command('purchase_received', { ...receiptCommand.data, lot_id: 'fixture-corrected-lot', acquisition_cycle_id: 'fixture-corrected-cycle', quantity: 1, unit_ids: ['fixture-corrected-unit'] }, cancelAt));
      const pages = await exportPages();
      const cancellation_case = { lot: receiptCommand.data.lot_id, receipt: receipt.event, assignment: assignment.event, price: price.event, cancellation: cancelled.event, replacement: replacement.event };
      if (process.env.INVENTORY_WORKFLOW_CANCELLATION_TEST_EXPORT_PATH) await writeFile(process.env.INVENTORY_WORKFLOW_CANCELLATION_TEST_EXPORT_PATH, JSON.stringify({ test_only: true, source_system: 'ten-kings-card-platform-v2', cases, historical_case: historicalCase, cancellation_case, pages }), { mode: 0o600 });
    });
    await t.test('linked permanent cards cannot enter ordinary commerce, ownership, location or void transitions', async () => {
      async function cardFixture(name) {
        const identity = { playerName: null, cardName: name, year: '2026', manufacturer: null, productSet: 'DISPOSABLE', parallel: null, insert: null, cardNumber: '1' };
        const sheet = await db.humanGradeLabelSheet.create({ data: {} });
        const session = await db.aiGraderV2Session.create({ data: { id: 'workflow-link-session-' + name, createdByUserId: 'fixture-link-admin', cardProfile: 'POKEMON', workflowState: 'COMPLETED', ruleVersion: 'speedster-v2-test', publicReportSlug: 'workflow-link-' + name, identity, capture: {}, reviewedDefects: [], gradeReport: {} } });
        const label = await db.humanGradeLabel.create({ data: { ...identity, sheetId: sheet.id, slot: 1, cardType: 'POKEMON', source: 'SPEEDSTER', sourceSessionId: session.id, gradingFormulaVersion: 'EQUAL_25', centeringGrade: '9', cornersGrade: '9', edgesGrade: '9', surfaceGrade: '9', grade: '9', certificateNumber: 'TEST-WORKFLOW-LINK-' + name, createdByUserId: 'fixture-link-admin' } });
        return db.$transaction(tx => createCardFromSpeedster(tx, session.id, label.id));
      }
      async function unprocessedFixture(name) {
        const card = await cardFixture(name), unit = 'fixture-link-unit-' + name;
        await record(command('purchase_received', { lot_id: 'fixture-link-lot-' + name, acquisition_cycle_id: 'fixture-link-cycle-' + name, quantity: 1, total_cost_cents: null, unknown_reason: 'fixture:unassigned', purchase_evidence_ref: 'fixture:purchase', unit_ids: [unit], custody: hq }));
        return { card, command: command('processed', { unit_ids: [unit], stage: 'processed', product_id: 'fixture-linked-product', permanent_card_links: [{ unit_id: unit, card_id: card.id }] }) };
      }
      const bindingCard = await cardFixture('cross-domain-binding');
      const otherLocation = await db.location.create({ data: { name: 'DISPOSABLE CONFLICTING LOCATION', slug: 'workflow-conflicting-location', address: 'fixture', recentRips: [] } });
      const custody_id = 'machine:' + cases[0].machine;
      const exactCommand = { request_id: 'fixture-cross-domain-binding', card_id: bindingCard.id, product_identity_ref: 'fixture:binding-product', custody_bindings: [{ custody_id, location_id: otherLocation.id, evidence_ref: 'fixture:conflicting-binding' }], ownership_evidence_ref: 'fixture:house-title', fulfilment: null, event: {
        event_kind: 'opening', effective_at: at, correction_reason: null, external_product_id: 'fixture-binding-product', stock_id: null, unit_or_pack_id: bindingCard.id, lot_id: 'fixture-binding-lot', acquisition_cycle_id: 'fixture-binding-cycle', quantity: 1, from_custody_id: null, to_custody_id: custody_id, external_sale_id: null, reverses_source_event_id: null, currency: 'USD', evidence_ref: 'fixture:count', sale_gross_cents: null, inputs: [], components: [{ unit_id: bindingCard.id, lot_id: 'fixture-binding-lot', acquisition_cycle_id: 'fixture-binding-cycle', acquisition_event_id: 'fixture-binding-acquisition', quantity: 1, cost_cents: null, basis: 'unknown', purchase_ledger_line_id: null, evidence_ref: 'fixture:missing-invoice', unknown_reason: 'fixture:unknown' }],
      } };
      await assert.rejects(db.$transaction(tx => recordCardInventoryEventV2(tx, exactCommand, 'fixture-admin'), { isolationLevel: 'ReadCommitted' }), /purchased-lot Location authority/);
      const fixture = await unprocessedFixture('sequential'); await record(fixture.command);
      for (const lifecycleState of ['IN_INVENTORY', 'ASSIGNED_TO_PACK', 'AT_LOCATION', 'LISTED_DIRECT', 'VAULTED', 'SHIP_REQUESTED', 'SHIPPED', 'EXTERNAL', 'VOID']) await assert.rejects(db.collectibleCardV2.update({ where: { id: fixture.card.id }, data: { lifecycleState } }), /purchased-lot workflow/);
      for (const data of [{ currentOwnerType: 'EXTERNAL' }, { saleMode: 'DIRECT' }, { locationId: location.id }]) await assert.rejects(db.collectibleCardV2.update({ where: { id: fixture.card.id }, data }), /purchased-lot workflow/);
      await assert.rejects(db.$transaction(tx => voidCard(tx, fixture.card.id, 'fixture:void', 'fixture-admin')), /purchased-lot workflow/);
      await assert.rejects(db.collectibleCardV2.delete({ where: { id: fixture.card.id } }), /purchased-lot workflow/);
      await db.collectibleCardV2.update({ where: { id: fixture.card.id }, data: { compsPublic: true } });
      const waitForLock = async name => {
        for (let attempt = 0; attempt < 200; attempt++) {
          const rows = await db.$queryRawUnsafe("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock') AS waiting", name);
          if (rows[0].waiting) return;
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw new Error('Expected competing transaction did not wait on its row lock');
      };
      const forward = await unprocessedFixture('link-first'); let releaseLink, linked;
      const linkReady = new Promise(resolve => { linked = resolve; }), linkRelease = new Promise(resolve => { releaseLink = resolve; });
      const linkTx = db.$transaction(async tx => { await recordInventoryWorkflowEventV2(tx, forward.command, 'fixture-workflow-admin'); linked(); await linkRelease; }, { isolationLevel: 'ReadCommitted', timeout: 15000 });
      await linkReady;
      const commercialTx = db.$transaction(async tx => { await tx.$executeRawUnsafe("SET LOCAL application_name = 'workflow-fixture-commercial-forward'"); return tx.collectibleCardV2.update({ where: { id: forward.card.id }, data: { lifecycleState: 'LISTED_DIRECT' } }); }, { isolationLevel: 'ReadCommitted', timeout: 15000 }).then(() => null, error => error);
      try { await waitForLock('workflow-fixture-commercial-forward'); } finally { releaseLink(); }
      await linkTx; assert.match(String(await commercialTx), /purchased-lot workflow/);
      const reverse = await unprocessedFixture('commerce-first'); let releaseCommercial, commercialReady;
      const ready = new Promise(resolve => { commercialReady = resolve; }), released = new Promise(resolve => { releaseCommercial = resolve; });
      const first = db.$transaction(async tx => { await tx.collectibleCardV2.update({ where: { id: reverse.card.id }, data: { lifecycleState: 'LISTED_DIRECT' } }); commercialReady(); await released; }, { isolationLevel: 'ReadCommitted', timeout: 15000 });
      await ready;
      const competing = db.$transaction(async tx => { await tx.$executeRawUnsafe("SET LOCAL application_name = 'workflow-fixture-link-reverse'"); return recordInventoryWorkflowEventV2(tx, reverse.command, 'fixture-workflow-admin'); }, { isolationLevel: 'ReadCommitted', timeout: 15000 }).then(() => null, error => error);
      try { await waitForLock('workflow-fixture-link-reverse'); } finally { releaseCommercial(); }
      await first; assert.match(String(await competing), /eligible house-owned permanent/);
    });
  } finally { await db.$disconnect(); }
});
