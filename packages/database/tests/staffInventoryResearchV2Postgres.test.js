const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient, Prisma } = require('@prisma/client');
const { recordStaffInventoryV2, recordInventoryWorkflowEventV2, startStaffInventoryResearchV2 } = require('../dist/database/src/cardPlatformV2');
const { readWorkflowHistoryV2 } = require('../dist/database/src/inventoryWorkflowV2Read');
const { staffInventoryWorkspaceV2 } = require('../dist/database/src/staffInventoryV2Read');
const store = require('../dist/database/src/staffInventoryResearchV2');

test('durable staff research shares successful inventory transactions and never writes financial evidence', { skip: process.env.TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION !== '1' }, async t => {
  const url = new URL(process.env.DATABASE_URL); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/tenkings_inventory_v2_disposable');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const tx = callback => db.$transaction(callback, { isolationLevel: 'ReadCommitted', timeout: 30000 });
  const location = await db.location.create({ data: { name: 'DISPOSABLE RESEARCH FIXTURE', slug: 'research-fixture', address: 'fixture', recentRips: [], locationType: 'hq' } });
  const actor = 'fixture-research-staff', at = '2026-07-01T00:00:00.000Z';
  const photo = letter => `inventory-photos/11111111-1111-4111-8111-111111111111/${letter.repeat(64)}.jpg`;
  const description = { name: 'Disposable research card', category: 'Sports cards', notes: '', photo_key: photo('a'), back_photo_key: photo('b'), card_details: { manufacturer: 'Fixture', card_number: '1', year: '2026', set_name: 'Fixture set', variant: null, card_type: 'Trading card' }, planned_sales_channel: 'eBay' };
  const add = (changes = {}) => ({ action: 'add', request_id: randomUUID(), effective_at: at, note: 'Disposable research fixture', origin: 'purchase', quantity: 1, total_cost_cents: 123, cost_method: 'documented_unit', expected_price_cents: 456, destination: { location_id: location.id, kind: 'hq', machine_id: null, product_id: null, door_id: null }, stage: 'unprocessed', description, ...changes });
  const unit = command => `staff:${command.request_id}:card:0001`;
  const save = command => tx(client => recordStaffInventoryV2(client, command, actor));
  const read = async command => (await store.readStaffInventoryResearchV2(db, { unitIds: [unit(command)] }))[0];
  const claim = options => tx(client => store.claimStaffInventoryResearchV2(client, options));
  const fail = (c, changes = {}) => tx(client => store.failStaffInventoryResearchV2(client, { jobId: c.jobId, leaseToken: c.leaseToken, errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'Research provider is unavailable.', retryable: false, ...changes }));
  const complete = (c, result) => tx(client => store.completeStaffInventoryResearchV2(client, { jobId: c.jobId, leaseToken: c.leaseToken, result }));
  const unknown = c => ({ schema_version: 1, unit_id: c.input.unit_id, description_event_id: c.input.description_event_id, description_hash: c.input.description_hash,
    engine_version: 'staff-inventory-research-v1', model: 'gpt-6-astra', researched_at: new Date().toISOString(), timings_ms: { photos: 0, sources: 0, images: 0, model: 0, total: 0 },
    photos: { front: c.input.front_photo_key ? { key: c.input.front_photo_key, sha256: c.input.front_photo_key.split('/').at(-1).slice(0, -4) } : null, back: c.input.back_photo_key ? { key: c.input.back_photo_key, sha256: c.input.back_photo_key.split('/').at(-1).slice(0, -4) } : null },
    query: 'Fixture card', identity: { status: 'unresolved', variant_name: null, suggestion: null, reason: 'No reliable checklist evidence.', reference_ids: [], photo_features: [] },
    target_condition: { status: 'unresolved', grader: null, numeric_grade: null, photo_evidence: null }, references: [], candidates: [], selected_candidate_ids: [], rejections: [],
    estimate: { status: 'unknown', value_cents: null, low_cents: null, high_cents: null, currency: 'USD', count: 0, reason: 'No reliable sales for the exact card.' }, warnings: [] });
  const historyBytes = async () => JSON.stringify(await readWorkflowHistoryV2(db));
  const rows = () => db.$queryRaw(Prisma.sql`SELECT * FROM "StaffInventoryResearchJobV2" ORDER BY "createdAt", "id"`);
  const edit = (command, changed, effective_at = at) => ({ action: 'edit', request_id: randomUUID(), effective_at, note: 'Disposable staff correction', unit_ids: [unit(command)], description: changed, expected_price_cents: 456 });
  const first = add(), noPhotos = add({ description: { ...description, name: 'Disposable no photos', photo_key: null, back_photo_key: null } });
  try {
    await t.test('an interrupted save leaves neither inventory nor a research job', async () => {
      const before = await historyBytes(), jobs = (await rows()).length;
      await assert.rejects(tx(async client => { await recordStaffInventoryV2(client, first, actor); throw Error('fixture interruption'); }), /interruption/);
      assert.equal(await historyBytes(), before); assert.equal((await rows()).length, jobs);
    });
    await t.test('concurrent individual saves and replay create one exact job; blank variants and missing photos still enqueue', async () => {
      const result = await Promise.all([save(first), save(first)]);
      assert.deepEqual(result.map(r => r.outcome).sort(), ['RECORDED', 'REPLAY']);
      await save(noPhotos); await save(first);
      const current = await read(first); assert.equal(current.status, 'queued'); assert.equal(current.attempt_count, 0);
      assert.equal((await rows()).filter(row => row.unitId === unit(first)).length, 1);
      assert.equal((await read(noPhotos)).status, 'queued');
      const batch = add({ quantity: 2, cost_method: 'equal_card' }); await save(batch); assert.equal(await read(batch), undefined);
    });
    await t.test('database-wide capacity and exact active intake leases preserve headroom without starving research', async () => {
      const [a, b, c] = await Promise.all([claim({ maxConcurrent: 2 }), claim({ maxConcurrent: 2 }), claim({ maxConcurrent: 2 })]);
      const claims = [a, b, c].filter(Boolean); assert.equal(claims.length, 2); assert.notEqual(claims[0].leaseToken, claims[1].leaseToken);
      assert.equal(await fail(claims[0]), true); assert.equal(await fail(claims[1]), true);
      const another = add(); await save(another);
      const leases = await Promise.all(Array.from({ length: 3 }, () => tx(client => store.acquireStaffInventoryIntakeLeaseV2(client))));
      assert.equal(await claim({ maxConcurrent: 2 }), null);
      await tx(client => store.releaseStaffInventoryIntakeLeaseV2(client, leases[0].leaseId));
      const allowed = await claim({ maxConcurrent: 2 }); assert.ok(allowed, 'two interactive requests still allow background progress'); await fail(allowed);
      for (const lease of leases) await tx(client => store.releaseStaffInventoryIntakeLeaseV2(client, lease.leaseId));
      const crashed = await tx(client => store.acquireStaffInventoryIntakeLeaseV2(client, { leaseMs: 1000 }));
      await delay(1050);
      await tx(client => store.acquireStaffInventoryIntakeLeaseV2(client, { leaseMs: 1000 }));
      assert.equal((await db.$queryRaw(Prisma.sql`SELECT count(*) AS n FROM "StaffInventoryIntakeLeaseV2" WHERE "id" = ${crashed.leaseId}`))[0].n, 0n);
    });
    await t.test('only the exact lease can record a result and unsupported identity stays an unknown estimate', async () => {
      const retry = await read(noPhotos);
      const d = { requestId: randomUUID(), jobId: retry.job_id, unitId: retry.unit_id, descriptionEventId: retry.description_event_id, inputHash: retry.input_hash, expectedAttemptCount: retry.attempt_count };
      const before = await historyBytes();
      await tx(client => store.retryStaffInventoryResearchV2(client, d, actor));
      const c = await claim(); assert.equal(c.input.unit_id, unit(noPhotos));
      assert.equal(await complete({ ...c, leaseToken: randomUUID() }, unknown(c)), false);
      assert.equal(await fail({ ...c, leaseToken: randomUUID() }), false);
      await assert.rejects(complete(c, { ...unknown(c), description_hash: 'f'.repeat(64) }), /different inventory revision/);
      assert.equal(await complete(c, unknown(c)), true); assert.equal(await complete(c, unknown(c)), false);
      const after = await read(noPhotos); assert.equal(after.status, 'complete'); assert.equal(after.result.estimate.value_cents, null); assert.equal(after.can_retry, true);
      assert.deepEqual(after.result.photos, { front: null, back: null }); assert.equal(await historyBytes(), before);
    });
    await t.test('human retries are exact, preserve old evidence and remain lifetime-bounded', async () => {
      const current = await read(noPhotos), d = { requestId: randomUUID(), jobId: current.job_id, unitId: current.unit_id, descriptionEventId: current.description_event_id, inputHash: current.input_hash, expectedAttemptCount: current.attempt_count };
      const outcomes = await Promise.all([tx(client => store.retryStaffInventoryResearchV2(client, d, actor)), tx(client => store.retryStaffInventoryResearchV2(client, d, actor))]);
      assert.deepEqual(outcomes.map(r => r.outcome).sort(), ['QUEUED', 'REPLAY']);
      await assert.rejects(tx(client => store.retryStaffInventoryResearchV2(client, d, 'other-fixture-staff')), /differs/);
      await assert.rejects(tx(client => store.retryStaffInventoryResearchV2(client, { ...d, requestId: randomUUID(), expectedAttemptCount: d.expectedAttemptCount + 1 }, actor)), /changed/);
      const c = await claim(); assert.equal(c.input.unit_id, unit(noPhotos)); await complete(c, unknown(c));
      const done = await read(noPhotos); assert.equal(done.can_retry, false, 'two explicit retries bound further paid research');
      const raw = (await rows()).find(row => row.id === c.jobId); assert.equal(raw.retries.length, 2); assert.equal(raw.attempts.filter(a => a.outcome === 'complete').length, 2);
      await assert.rejects(tx(client => store.retryStaffInventoryResearchV2(client, { ...d, requestId: randomUUID(), expectedAttemptCount: done.attempt_count }, actor)), /retry limit/);
    });
    await t.test('crashed workers are reclaimed with a fresh token and terminate at the automatic attempt limit', async () => {
      const command = add(); await save(command); let previous;
      for (let i = 0; i < 3; i++) {
        const c = await claim({ leaseMs: 1000 }); assert.equal(c.input.unit_id, unit(command)); assert.equal(c.attempt, i + 1);
        if (previous) { assert.notEqual(c.leaseToken, previous.leaseToken); assert.equal(await fail(previous), false); assert.equal(await complete(previous, unknown(previous)), false); }
        previous = c; await delay(1050);
      }
      assert.equal(await claim(), null);
      const terminal = await read(command); assert.equal(terminal.status, 'failed'); assert.equal(terminal.attempt_count, 3); assert.equal(terminal.error.code, 'LEASE_EXPIRED');
      assert.equal((await rows()).find(row => row.id === terminal.job_id).attempts.length, 3);
    });
    await t.test('transient provider failures back off between bounded attempts and cannot be claimed early', async () => {
      const command = add(); await save(command);
      for (let i = 0; i < 3; i++) {
        const c = await claim(); assert.equal(c.input.unit_id, unit(command));
        const before = Date.now(); await fail(c, { retryable: true });
        const current = await read(command);
        if (i < 2) {
          assert.equal(current.status, 'queued'); assert.ok(Date.parse(current.next_attempt_at) >= before + 30000 * 2 ** i - 1000); assert.equal(await claim(), null);
          // Advance only this disposable job's availability to avoid waiting
          // minutes in a regression; no inventory or source evidence is edited.
          await db.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "nextAttemptAt" = clock_timestamp() WHERE "id" = ${c.jobId}`);
        } else { assert.equal(current.status, 'failed'); assert.equal(current.attempt_count, 3); }
      }
    });
    await t.test('staff/advanced photo edits supersede in-flight evidence and original receipt replay cannot duplicate or resurrect it', async () => {
      const command = add(); await save(command); const old = await claim();
      const correction = edit(command, { ...description, name: 'Disposable revised card', back_photo_key: photo('c') }, '2026-07-03T00:00:00.000Z');
      await save(correction); const changed = await read(command); assert.notEqual(changed.job_id, old.jobId);
      assert.equal(await complete(old, unknown(old)), false); assert.equal(await fail(old), false);
      await save(command); assert.equal((await read(command)).job_id, changed.job_id);
      const jobs = (await rows()).filter(row => row.unitId === unit(command)); assert.equal(jobs.length, 2); assert.equal(jobs[0].status, 'superseded'); assert.equal(jobs[0].attempts[0].outcome, 'superseded');
      await save(edit(command, { ...description, name: 'Disposable historical note' }, '2026-07-02T00:00:00.000Z'));
      assert.equal((await read(command)).job_id, changed.job_id, 'backdated description does not displace current staff revision');
      const current = await claim(); assert.equal(current.input.back_photo_key, photo('c'));
      const wrongPhoto = unknown(current); wrongPhoto.photos.back = { key: photo('d'), sha256: 'd'.repeat(64) };
      await assert.rejects(complete(current, wrongPhoto), /different inventory input/); await complete(current, unknown(current));
      await tx(client => recordInventoryWorkflowEventV2(client, { request_id: randomUUID(), effective_at: '2026-07-04T00:00:00.000Z', evidence_ref: 'fixture:advanced-description', event_kind: 'item_described', data: { unit_ids: [unit(command)], description: { ...correction.description, notes: 'Staff corrected its notes.' } } }, actor));
      assert.notEqual((await read(command)).job_id, current.jobId); await fail(await claim());
    });
    await t.test('receipt cancellation removes current research while preserving all previous results', async () => {
      const workspace = staffInventoryWorkspaceV2(await readWorkflowHistoryV2(db), [location]);
      const item = workspace.items.find(item => item.unit_ids.includes(unit(noPhotos)));
      await tx(client => recordInventoryWorkflowEventV2(client, { request_id: randomUUID(), effective_at: at, evidence_ref: 'fixture:cancel-research-entry', event_kind: 'purchase_cancelled', data: { lot_id: item.lot_id, purchase_event_id: item.provenance.receipt, reason: 'Disposable cancelled receipt.' } }, actor));
      assert.equal(await read(noPhotos), undefined);
      const stored = (await rows()).find(row => row.unitId === unit(noPhotos)); assert.equal(stored.status, 'superseded'); assert.ok(stored.result); assert.equal(stored.attempts.filter(a => a.outcome === 'complete').length, 2);
      await save(noPhotos); assert.equal(await read(noPhotos), undefined);
    });
    await t.test('backdated inherited metadata returning to identical input reuses its original exact job and invalidates its old token', async () => {
      const command = add(); await save(command); await fail(await claim());
      const { planned_sales_channel: _channel, ...legacy } = description;
      await save(edit(command, legacy, '2026-07-04T00:00:00.000Z'));
      const original = await claim(); await complete(original, unknown(original));
      const restoredId = (await read(command)).job_id;
      await save(edit(command, { ...description, planned_sales_channel: 'Whatnot' }, '2026-07-02T00:00:00.000Z'));
      const changed = await claim(); assert.notEqual(changed.jobId, restoredId);
      await save(edit(command, { ...description, planned_sales_channel: 'eBay' }, '2026-07-03T00:00:00.000Z'));
      const restored = await read(command); assert.equal(restored.job_id, restoredId); assert.equal(restored.status, 'complete'); assert.equal(restored.input_hash, original.inputHash);
      assert.equal(await complete(changed, unknown(changed)), false); assert.equal(await complete(original, unknown(original)), false);
      const relevant = (await rows()).filter(row => row.unitId === unit(command)); assert.equal(relevant.length, 3); assert.equal(relevant.filter(row => row.status !== 'superseded').length, 1);
      assert.ok(restored.result); assert.equal(await claim(), null);
    });
    await t.test('research enqueue does not reject staff text accepted by the inventory description contract', async () => {
      const command = add({ description: { ...description, name: 'https://fixture.invalid/Card name', photo_key: null, back_photo_key: null } });
      await save(command); const c = await claim(); assert.equal(c.input.description.name, command.description.name); await complete(c, unknown(c));
      assert.equal((await read(command)).result.estimate.status, 'unknown');
    });
    await t.test('manual research starts a pre-existing exact individual card once without altering inventory and rejects stale/cancelled/batch targets', async () => {
      const command = add(); await save(command); const automatic = await read(command);
      // This disposable-only setup models a valid description saved before the
      // research migration existed. It removes exactly its unclaimed test job;
      // the verified inventory journal remains byte-for-byte unchanged.
      await tx(async client => {
        await client.$executeRaw(Prisma.sql`ALTER TABLE "StaffInventoryResearchJobV2" DISABLE TRIGGER "StaffInventoryResearchJobV2_preserve"`);
        await client.$executeRaw(Prisma.sql`DELETE FROM "StaffInventoryResearchJobV2" WHERE "id" = ${automatic.job_id} AND "attemptCount" = 0`);
        await client.$executeRaw(Prisma.sql`ALTER TABLE "StaffInventoryResearchJobV2" ENABLE TRIGGER "StaffInventoryResearchJobV2_preserve"`);
      });
      const before = await historyBytes(), d = { action: 'start', requestId: randomUUID(), unitId: unit(command), descriptionEventId: automatic.description_event_id };
      const start = (input = d, who = actor) => tx(client => startStaffInventoryResearchV2(client, input, who));
      const concurrent = await Promise.all([start(), start()]); assert.deepEqual(concurrent.map(result => result.outcome).sort(), ['QUEUED', 'REPLAY']);
      assert.equal(concurrent[0].job.job_id, concurrent[1].job.job_id); assert.equal(await historyBytes(), before);
      const raw = (await rows()).find(row => row.unitId === unit(command)); assert.equal(raw.startRequestId, d.requestId); assert.equal(raw.requestedBy, actor);
      assert.equal((await start()).outcome, 'REPLAY'); await assert.rejects(start(d, 'another-fixture-staff'), /recording actor/);
      await assert.rejects(start({ ...d, descriptionEventId: 'workflow:stale-description' }), /description changed/);
      await assert.rejects(start({ ...d, unitId: 'fixture-missing-unit' }), /description changed/);
      const c = await claim(); assert.equal(c.input.unit_id, unit(command)); await complete(c, unknown(c));
      assert.equal((await start()).outcome, 'REPLAY'); assert.equal((await read(command)).attempt_count, 1);
      await assert.rejects(db.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "requestedBy" = 'another-fixture-staff' WHERE "id" = ${raw.id}`), /immutable/);
      const batch = add({ quantity: 2, cost_method: 'equal_card' }); await save(batch);
      const items = staffInventoryWorkspaceV2(await readWorkflowHistoryV2(db), [location]).items;
      const batchItem = items.find(item => item.unit_ids.includes(unit(batch))), individual = items.find(item => item.unit_ids.includes(unit(command)));
      await assert.rejects(start({ ...d, requestId: randomUUID(), unitId: unit(batch), descriptionEventId: batchItem.provenance.description }), /individually received/);
      await tx(client => recordInventoryWorkflowEventV2(client, { request_id: randomUUID(), effective_at: at, evidence_ref: 'fixture:cancel-manual-research', event_kind: 'purchase_cancelled', data: { lot_id: individual.lot_id, purchase_event_id: individual.provenance.receipt, reason: 'Disposable cancelled receipt.' } }, actor));
      await assert.rejects(start(), /description changed/); assert.equal(await read(command), undefined);
    });
    await t.test('database guards preserve immutable input/attempt evidence and API helpers enforce bounded reads/claims', async () => {
      const stored = (await rows()).find(row => row.attempts.length > 0);
      await assert.rejects(db.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "input" = '{}' WHERE "id" = ${stored.id}`), /immutable/);
      await assert.rejects(db.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "attempts" = '[]'::jsonb WHERE "id" = ${stored.id}`), /append-only/);
      await assert.rejects(db.$executeRaw(Prisma.sql`UPDATE "StaffInventoryResearchJobV2" SET "attempts" = jsonb_set("attempts", '{0,outcome}', '"complete"'::jsonb) WHERE "id" = ${stored.id}`), /immutable/);
      await assert.rejects(db.$executeRaw(Prisma.sql`DELETE FROM "StaffInventoryResearchJobV2" WHERE "id" = ${stored.id}`), /cannot be deleted/);
      await assert.rejects(db.$executeRaw(Prisma.sql`TRUNCATE "StaffInventoryResearchJobV2"`), /cannot be deleted/);
      await assert.rejects(claim({ maxConcurrent: 3 })); await assert.rejects(claim({ leaseMs: 300001 }));
      await assert.rejects(store.readStaffInventoryResearchV2(db, { unitIds: Array.from({ length: 51 }, (_, i) => `fixture:${i}`) }));
      await assert.rejects(store.readStaffInventoryResearchV2(db, { unitIds: [unit(first), unit(first)] }));
      const workspace = staffInventoryWorkspaceV2(await readWorkflowHistoryV2(db), [location]);
      const current = workspace.items.find(item => item.unit_ids.includes(unit(first)));
      assert.equal(current.cost_cents, 123); assert.equal(current.expected_price_cents, 456); assert.equal(current.planned_sales_channel, 'eBay');
    });
  } finally { await db.$disconnect(); }
});
