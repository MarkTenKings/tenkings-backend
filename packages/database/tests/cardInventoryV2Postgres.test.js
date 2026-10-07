const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { recordCardInventoryEventV2, createCardFromSpeedster } = require('../dist/database/src/cardPlatformV2');
const { exportCardInventoryPageV2, readCardInventoryCardHistoryV2 } = require('../dist/database/src/cardInventoryV2Read');
const { canonical, inventoryHash } = require('../dist/database/src/cardInventoryV2');

const enabled = process.env.TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION === '1';
test('physical inventory PostgreSQL transactions, conservation, and fixed snapshots', { skip: !enabled }, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/tenkings_inventory_v2_disposable');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  let counter = 0;
  const effective = new Date(Date.now() - 60000).toISOString();
  const location = await db.location.create({ data: { name: 'DISPOSABLE INVENTORY FIXTURE', slug: 'inventory-test', address: 'fixture', recentRips: [] } });
  const warehouse = 'warehouse:fixture-warehouse', machineA = 'machine:fixture-device-A', machineB = 'machine:fixture-device-B';
  const max = async () => Number((await db.$queryRawUnsafe('SELECT COALESCE(MAX("sequence"), 0)::bigint AS n FROM "CardInventoryEventV2"'))[0].n);
  const record = c => db.$transaction(tx => recordCardInventoryEventV2(tx, c, 'fixture-human-admin'), { isolationLevel: 'ReadCommitted', timeout: 15000 });
  async function fixture(name) {
    const sheet = await db.humanGradeLabelSheet.create({ data: {} });
    const identity = { playerName: null, cardName: name, year: '2026', manufacturer: null, productSet: 'DISPOSABLE', parallel: null, insert: null, cardNumber: '1' };
    const session = await db.aiGraderV2Session.create({ data: { id: 'inventory-session-' + name,
      createdByUserId: 'fixture-human-admin', cardProfile: 'POKEMON', workflowState: 'COMPLETED',
      ruleVersion: 'speedster-v2-test', publicReportSlug: 'inventory-test-' + name, identity,
      capture: {}, reviewedDefects: [], gradeReport: {} } });
    const label = await db.humanGradeLabel.create({ data: { ...identity, sheetId: sheet.id, slot: 1,
      cardType: 'POKEMON', source: 'SPEEDSTER', sourceSessionId: session.id, gradingFormulaVersion: 'EQUAL_25',
      centeringGrade: '9', cornersGrade: '9', edgesGrade: '9', surfaceGrade: '9', grade: '9',
      certificateNumber: 'TEST-INVENTORY-' + name, createdByUserId: 'fixture-human-admin' } });
    return db.$transaction(tx => createCardFromSpeedster(tx, session.id, label.id));
  }
  const [a, b, c] = await Promise.all([fixture('alpha'), fixture('beta'), fixture('gamma')]);
  function component(card, cost = null) {
    return { unit_id: card.id, lot_id: 'fixture-lot-' + card.id, acquisition_cycle_id: 'fixture-cycle-1',
      acquisition_event_id: 'fixture-acquisition-' + card.id, quantity: 1, cost_cents: cost,
      basis: cost === null ? 'unknown' : 'documented_unit', purchase_ledger_line_id: null,
      evidence_ref: 'fixture:acquisition-document', unknown_reason: cost === null ? 'Fixture missing acquisition invoice' : null };
  }
  function command(card, kind, fields = {}, extra = {}) {
    const event = { event_kind: kind, effective_at: effective, correction_reason: null, external_product_id: 'fixture-loose-product',
      stock_id: null, unit_or_pack_id: card.id, lot_id: 'fixture-lot-' + card.id, acquisition_cycle_id: 'fixture-cycle-1',
      quantity: 1, from_custody_id: null, to_custody_id: warehouse, external_sale_id: null,
      reverses_source_event_id: null, currency: 'USD', evidence_ref: 'fixture:physical-operation',
      sale_gross_cents: null, components: [component(card)], inputs: [], ...fields };
    return { request_id: 'fixture-request-' + (++counter), card_id: card.id,
      product_identity_ref: 'fixture:product-identity:' + event.external_product_id,
      custody_bindings: [...new Set([event.from_custody_id, event.to_custody_id].filter(Boolean))].map(custody_id => ({
        custody_id, location_id: location.id, evidence_ref: 'fixture:exact-device-roster:' + custody_id })),
      ownership_evidence_ref: ['opening', 'receipt', 'return', 'reversal'].includes(kind) ? 'fixture:documented-house-title' : null,
      fulfilment: kind === 'sale' ? { payment_status: 'SUCCEEDED', payment_reference: 'fixture-payment-' + counter,
        physical_status: 'DISPATCHED', dispatch_reference: event.external_sale_id, evidence_ref: 'fixture:successful-payment-and-delivery' } : null,
      event, ...extra };
  }
  const fromEvent = (card, kind, event, fields = {}, extra = {}) => {
    const { source_event_id, source_sequence, recorded_at, recorded_by, event_kind, ...body } = event;
    return command(card, kind, { ...body, inputs: [], ...fields }, extra);
  };
  let receiptA, receiptB, packed, restocked, sold, returned, openingCommand;
  try {
    await t.test('server owns metadata; canonical retries preserve the exact immutable event', async () => {
      const cmd = command(a, 'opening'); openingCommand = cmd;
      const out = await record(cmd); receiptA = out.event;
      assert.equal(receiptA.source_sequence, 1); assert.equal(receiptA.recorded_by, 'fixture-human-admin');
      assert.equal(receiptA.stock_id, receiptA.source_event_id);
      assert.ok(receiptA.recorded_at >= receiptA.effective_at);
      assert.equal((await record(JSON.parse(JSON.stringify(cmd)))).outcome, 'REPLAY');
      assert.equal(await max(), 1);
      await assert.rejects(record({ ...cmd, product_identity_ref: 'fixture:changed' }), /retry conflicts/);
      await assert.rejects(record({ ...command(b, 'receipt'), event: { ...command(b, 'receipt').event, recorded_by: 'forged' } }), /Invalid physical inventory evidence/);
      assert.equal(await max(), 1);
    });
    await t.test('parallel acquisitions serialize without sequence gaps and preserve explicit known/unknown costs', async () => {
      const results = await Promise.all([record(command(b, 'receipt', { components: [component(b, 125)] })),
        record(command(c, 'receipt', { external_product_id: 'fixture-loose-product-c', components: [component(c, 275)] }))]);
      receiptB = results[0].event;
      assert.deepEqual(results.map(r => r.event.source_sequence).sort(), [2, 3]);
      assert.equal(receiptA.components[0].cost_cents, null);
      assert.equal(receiptB.components[0].cost_cents, 125);
      await assert.rejects(record(command(a, 'receipt')), /already received|more than one/);
    });
    await t.test('one-card packing captures actual inputs; changed cost and multi-card packs are rejected', async () => {
      const fields = { unit_or_pack_id: 'fixture-physical-pack-A', external_product_id: 'fixture-pack-product',
        from_custody_id: warehouse, inputs: [{ stock_id: receiptA.stock_id, quantity: 1 }] };
      await assert.rejects(record(command(a, 'pack', { ...fields, components: [component(a), component(b, 125)] })), /exactly one/);
      await assert.rejects(record(command(a, 'pack', { ...fields, unit_or_pack_id: b.id })), /impersonate a permanent card/);
      await assert.rejects(record(command(a, 'pack', { ...fields, components: [component(a, 999)] })), /contents\/costs/);
      packed = (await record(command(a, 'pack', fields))).event;
      assert.deepEqual(packed.components, receiptA.components);
      assert.equal(packed.stock_id, packed.source_event_id);
      assert.equal((await db.collectibleCardV2.findUnique({ where: { id: a.id } })).lifecycleState, 'ASSIGNED_TO_PACK');
    });
    await t.test('multiple products and machines share one Location without conflating device identity', async () => {
      restocked = (await record(fromEvent(a, 'restock', packed, { from_custody_id: warehouse, to_custody_id: machineA }))).event;
      await record(fromEvent(b, 'restock', receiptB, { from_custody_id: warehouse, to_custody_id: machineA }));
      await record(fromEvent(b, 'transfer', receiptB, { from_custody_id: machineA, to_custody_id: machineB }));
      const history = await readCardInventoryCardHistoryV2(db, b.id);
      assert.equal(history.at(-1).event.to_custody_id, machineB);
      assert.equal(history.at(-1).card_after.locationId, location.id);
      const drift = fromEvent(b, 'transfer', receiptB, { from_custody_id: machineB, to_custody_id: warehouse });
      drift.custody_bindings[0].evidence_ref = 'fixture:guessed-roster';
      await assert.rejects(record(drift), /Custody identity conflicts/);
    });
    await t.test('future dates, ambiguous fulfilments, and a rolled-back transaction consume no sequence', async () => {
      const before = await max();
      await assert.rejects(record(fromEvent(b, 'transfer', receiptB, { from_custody_id: machineB, to_custody_id: warehouse,
        effective_at: new Date(Date.now() + 3600000).toISOString() })), /future dated/);
      await assert.rejects(record(fromEvent(a, 'sale', restocked, { from_custody_id: machineA, to_custody_id: null, external_sale_id: 'fixture-dispatch-bad' }, { fulfilment: null })), /completed-dispatch/);
      await assert.rejects(db.$transaction(async tx => {
        await recordCardInventoryEventV2(tx, fromEvent(b, 'transfer', receiptB, { from_custody_id: machineB, to_custody_id: warehouse }), 'fixture-human-admin');
        throw new Error('deliberate disposable rollback');
      }), /deliberate disposable rollback/);
      assert.equal(await max(), before);
      assert.equal((await readCardInventoryCardHistoryV2(db, b.id)).at(-1).event.to_custody_id, machineB);
    });
    await t.test('two simultaneous physical sales yield one stock withdrawal and one ownership transfer', async () => {
      const attempts = [1, 2].map(n => fromEvent(a, 'sale', restocked, { from_custody_id: machineA, to_custody_id: null,
        external_sale_id: 'fixture-dispatch-' + n, sale_gross_cents: 2500 }));
      const before = await max();
      const results = await Promise.allSettled(attempts.map(record));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      sold = results.find(r => r.status === 'fulfilled').value.event;
      assert.equal(await max(), before + 1);
      const card = await db.collectibleCardV2.findUnique({ where: { id: a.id } });
      assert.equal(card.currentOwnerType, 'EXTERNAL'); assert.equal(card.lifecycleState, 'EXTERNAL'); assert.equal(card.locationId, null);
      assert.equal(await db.cardOwnershipEventV2.count({ where: { cardId: a.id, referenceType: 'PHYSICAL_INVENTORY_V2' } }), 1);
      assert.equal(sold.components[0].cost_cents, null); // sale/market value never becomes acquisition cost
      assert.equal((await record(openingCommand)).outcome, 'REPLAY');
      assert.equal((await db.collectibleCardV2.findUnique({ where: { id: a.id } })).currentOwnerType, 'EXTERNAL');
      assert.equal(await max(), before + 1);
    });
    await t.test('dispatch and physical pack identities are globally unique across permanent cards', async () => {
      const before = await max();
      await assert.rejects(record(fromEvent(b, 'sale', receiptB, { from_custody_id: machineB, to_custody_id: null,
        external_sale_id: sold.external_sale_id, sale_gross_cents: 2500 })), /unique|duplicate|already exists/i);
      const cOrigin = (await readCardInventoryCardHistoryV2(db, c.id))[0].event;
      await assert.rejects(record(command(c, 'pack', { unit_or_pack_id: packed.unit_or_pack_id,
        external_product_id: packed.external_product_id, from_custody_id: warehouse,
        components: cOrigin.components,
        inputs: [{ stock_id: cOrigin.stock_id, quantity: 1 }] })), /unique|duplicate|already exists/i);
      assert.equal(await max(), before);
      assert.equal((await db.collectibleCardV2.findUnique({ where: { id: b.id } })).currentOwnerType, 'HOUSE');
    });
    await t.test('fixed snapshots exclude later writes and pages remain contiguous', async () => {
      await record(fromEvent(b, 'transfer', receiptB, { from_custody_id: machineB, to_custody_id: machineA }));
      const first = await exportCardInventoryPageV2(db, { after_sequence: 0, limit: 2 });
      const bound = first.snapshot_through_sequence;
      await record(fromEvent(b, 'sale', receiptB, { from_custody_id: machineA, to_custody_id: null,
        external_sale_id: 'fixture-dispatch-beta', sale_gross_cents: 4000 }));
      const cOrigin = (await readCardInventoryCardHistoryV2(db, c.id))[0].event;
      await record(fromEvent(c, 'restock', cOrigin, { from_custody_id: warehouse, to_custody_id: machineA }));
      const cSale = await record(fromEvent(c, 'sale', cOrigin, { from_custody_id: machineA, to_custody_id: null,
        external_sale_id: 'fixture-dispatch-gamma', sale_gross_cents: 5000 }));
      assert.equal(cSale.event.components[0].cost_cents, 275);
      assert.equal(cSale.event.from_custody_id, machineA);
      const events = [...first.page.events];
      let after = first.page.through_sequence;
      while (after < bound) {
        const result = await exportCardInventoryPageV2(db, { after_sequence: after, limit: 2, snapshot_through_sequence: bound });
        assert.equal(result.page.snapshot_id, first.page.snapshot_id);
        events.push(...result.page.events); after = result.page.through_sequence;
      }
      assert.equal(events.length, bound); assert.ok(events.every((e, i) => e.source_sequence === i + 1));
      assert.deepEqual((await exportCardInventoryPageV2(db, { after_sequence: bound, limit: 2, snapshot_through_sequence: bound })).page.events, []);
      await assert.rejects(exportCardInventoryPageV2(db, { after_sequence: 0, limit: 2, snapshot_through_sequence: (await max()) + 1 }), /beyond/);
    });
    await t.test('title-evidenced return restores the acquired card, refund moves only money, and unpack restores its original stock', async () => {
      returned = (await record(fromEvent(a, 'return', sold, { from_custody_id: null, to_custody_id: warehouse,
        external_sale_id: null, sale_gross_cents: null, reverses_source_event_id: sold.source_event_id, correction_reason: 'Fixture documented returned title' }))).event;
      assert.deepEqual(returned.components, receiptA.components);
      await record(command(a, 'refund', { external_product_id: sold.external_product_id, stock_id: null, unit_or_pack_id: null, lot_id: null,
        acquisition_cycle_id: null, quantity: 0, from_custody_id: null, to_custody_id: null, components: [],
        external_sale_id: 'fixture-refund-A', sale_gross_cents: 1000, reverses_source_event_id: sold.source_event_id, correction_reason: 'Fixture documented partial refund' }));
      await assert.rejects(record(command(a, 'refund', { external_product_id: sold.external_product_id, stock_id: null, unit_or_pack_id: null, lot_id: null,
        acquisition_cycle_id: null, quantity: 0, from_custody_id: null, to_custody_id: null, components: [],
        external_sale_id: 'fixture-refund-over', sale_gross_cents: 2000, reverses_source_event_id: sold.source_event_id, correction_reason: 'Fixture over-refund' })), /exceeds/);
      await record(fromEvent(a, 'unpack', packed, { from_custody_id: warehouse, to_custody_id: warehouse }));
      assert.equal((await db.collectibleCardV2.findUnique({ where: { id: a.id } })).lifecycleState, 'IN_INVENTORY');
    });
    await t.test('append-only SQL and lifecycle projection guards resist direct edits while grading facts remain editable', async () => {
      await assert.rejects(db.$executeRawUnsafe('UPDATE "CardInventoryEventV2" SET "content" = "content"'), /append-only/);
      await assert.rejects(db.$executeRawUnsafe('DELETE FROM "CardInventoryEventV2"'), /append-only/);
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE "CardInventoryEventV2"'), /append-only/);
      await assert.rejects(db.collectibleCardV2.update({ where: { id: a.id }, data: { lifecycleState: 'VOID' } }), /lifecycle/);
      await db.collectibleCardV2.update({ where: { id: a.id }, data: { compsPublic: true } });
      assert.equal((await db.collectibleCardV2.findUnique({ where: { id: a.id } })).compsPublic, true);
    });
    await t.test('export rejects persisted hash drift and a sequence gap instead of silently skipping records', async () => {
      await assert.rejects(db.$transaction(async tx => {
        await tx.$executeRawUnsafe('ALTER TABLE "CardInventoryEventV2" DISABLE TRIGGER "CardInventoryEventV2_no_update_delete"');
        await tx.$executeRawUnsafe('DELETE FROM "CardInventoryEventV2" WHERE "sequence" = 2');
        await exportCardInventoryPageV2(tx, { after_sequence: 0, limit: 1000 });
      }), /sequence gap/);
      await assert.rejects(db.$transaction(async tx => {
        await tx.$executeRawUnsafe('ALTER TABLE "CardInventoryEventV2" DISABLE TRIGGER "CardInventoryEventV2_no_update_delete"');
        await tx.$executeRawUnsafe('UPDATE "CardInventoryEventV2" SET "requestHash" = repeat(\'0\', 64) WHERE "sequence" = 1');
        await exportCardInventoryPageV2(tx, { after_sequence: 0, limit: 1000 });
      }), /integrity verification/);
    });
    await t.test('raw sequence jumps and unpaired projection changes roll back at the database boundary', async () => {
      const [row] = await db.$queryRawUnsafe('SELECT * FROM "CardInventoryEventV2" ORDER BY "sequence" LIMIT 1');
      const insert = async (tx, data) => {
        const content = canonical(data);
        await tx.$executeRawUnsafe('INSERT INTO "CardInventoryEventV2" ("sequence", "id", "cardId", "recordedAt", "content", "contentHash", "requestHash") VALUES ($1,$2,$3,$4,$5,$6,$7)',
          BigInt(data.event.source_sequence), data.event.source_event_id, row.cardId, row.recordedAt, content, inventoryHash(data), row.requestHash);
      };
      const content = JSON.parse(row.content); content.command.request_id = 'fixture-raw-sequence'; content.event.source_event_id = 'fixture-raw-event';
      content.event.source_sequence = (await max()) + 2;
      await assert.rejects(db.$transaction(tx => insert(tx, content)), /contiguous/);
      content.event.source_sequence -= 1; content.card_after.lifecycleState = 'GRADED';
      await assert.rejects(db.$transaction(async tx => {
        await insert(tx, content);
        await tx.$executeRawUnsafe('SET CONSTRAINTS "CardInventoryEventV2_projection_at_commit" IMMEDIATE');
      }), /lifecycle/);
    });
  } finally { await db.$disconnect(); }
});
