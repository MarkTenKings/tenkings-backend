import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import type { StaffInventoryResearchReviewCommand } from '@tenkings/shared';

const enabled = process.env.TEN_KINGS_RESEARCH_REVIEW_DISPOSABLE_VALIDATION === '1';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

test('real PostgreSQL staff review is current-bound, append-only, idempotent and concurrency-safe', { skip: !enabled, timeout: 120_000 }, async t => {
  assert.equal(process.version, 'v22.23.2');
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1'); assert.ok(url.port);
  assert.equal(url.pathname, '/tenkings_research_review_disposable'); assert.equal(url.username, 'postgres'); assert.ok(url.password);
  const ownershipPath = await realpath(process.env.TEN_KINGS_RESEARCH_REVIEW_OWNERSHIP_FILE ?? '');
  assert.equal(basename(ownershipPath), 'fixture-ownership.json'); assert.ok(basename(dirname(ownershipPath)).startsWith('tk-research-review-'));
  const ownership = JSON.parse(await readFile(ownershipPath, 'utf8'));
  assert.equal(ownership.schema_version, 1); assert.equal(ownership.database_url_sha256, digest(url.href));
  assert.equal(ownership.nonce, process.env.TEN_KINGS_RESEARCH_REVIEW_NONCE); assert.match(ownership.nonce, /^[a-f0-9]{48}$/);
  assert.equal(ownership.owner_uid, process.getuid!()); process.kill(ownership.postgres_pid, 0);
  for (const key of Object.keys(process.env)) assert.ok(!/^(OPENAI_API_KEY|SOLD_?COMPS_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|DIRECT_URL|SHADOW_DATABASE_URL)$/.test(key));
  const previousFetch = globalThis.fetch; globalThis.fetch = async () => assert.fail('No external HTTP is permitted.');
  const { PrismaClient } = await import('@prisma/client');
  const database = await import('@tenkings/database');
  const { StaffInventoryResearchResultSchema, projectStaffInventoryResearchReview } = await import('@tenkings/shared');
  const { marketResult } = await import('./fixtures/staffInventoryMarketValue');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const competitor = new PrismaClient({ datasources: { db: { url: url.href } } });
  const tx = <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => db.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 30_000 });
  const conflict = (error: unknown) => error instanceof database.CardInventoryErrorV2 && error.code === 'CONFLICT';
  const invalid = (error: unknown) => error instanceof database.CardInventoryErrorV2 && error.code === 'INVALID_INPUT';
  const review = (command: StaffInventoryResearchReviewCommand, actor = 'fixture-staff-a') => tx(client => database.recordStaffInventoryResearchReviewV2(client, command, actor));
  const state = async () => database.replayWorkflowEventsV2(await database.readWorkflowHistoryV2(db));
  const raw = async (jobId: string) => (await db.$queryRawUnsafe<Array<{ id: string; unitId: string; result: string; resultHash: string; inputHash: string; status: string }>>('SELECT * FROM "StaffInventoryResearchJobV2" WHERE id = $1', jobId))[0];
  const count = async () => (await db.$queryRawUnsafe<Array<{ count: bigint }>>('SELECT count(*) AS count FROM "StaffInventoryResearchReviewV2"'))[0].count;
  try {
    const identity = await db.$queryRawUnsafe("SELECT current_database() AS database, host(inet_server_addr()) AS host");
    assert.deepEqual(identity, [{ database: 'tenkings_research_review_disposable', host: '127.0.0.1' }]);
    assert.equal(await count(), 0n);
    const location = await db.location.create({ data: { name: 'DISPOSABLE REVIEW FIXTURE', slug: 'review-fixture', address: 'fixture', recentRips: [], locationType: 'hq' } });
    const add = (quantity = 1) => ({ action: 'add' as const, request_id: randomUUID(), effective_at: '2026-09-20T00:00:00.000Z', note: 'Disposable research review qualification.',
      origin: 'purchase' as const, quantity, total_cost_cents: 123, cost_method: quantity > 1 ? 'equal_card' as const : 'documented_unit' as const, expected_price_cents: 456,
      destination: { location_id: location.id, kind: 'hq' as const, machine_id: null, product_id: null, door_id: null }, stage: 'unprocessed' as const,
      description: { name: 'Fixture Runner', category: 'Sports cards', notes: '', photo_key: marketResult().photos.front!.key, back_photo_key: marketResult().photos.back!.key,
        card_details: { manufacturer: 'Fixture Cards', card_number: '007', year: '2024', set_name: 'Fixture Chrome', variant: 'Base', card_type: 'Baseball' }, planned_sales_channel: 'eBay' } });
    const seed = async (unknown = false) => {
      const command = add(); await tx(client => database.recordStaffInventoryV2(client, command, 'fixture-inventory-staff'));
      const claim = await tx(client => database.claimStaffInventoryResearchV2(client)); assert.ok(claim);
      assert.equal(claim.input.unit_id, `staff:${command.request_id}:card:0001`);
      const result = marketResult();
      Object.assign(result, { unit_id: claim.input.unit_id, description_event_id: claim.input.description_event_id, description_hash: claim.input.description_hash, researched_at: new Date().toISOString() });
      result.candidates[2].title = 'Fixture Runner Base Raw';
      result.selected_candidate_ids = result.candidates.map(candidate => candidate.id);
      result.estimate = { ...result.estimate, value_cents: 3968, low_cents: 1001, high_cents: 9900, count: 3 };
      const extra = structuredClone(result.candidates[2]); extra.id = 'ebay:111111111119'; extra.listing_url = `https://www.ebay.com/itm/${extra.id.slice(5)}`;
      result.candidates.push(extra); result.rejections = [{ candidate_id: extra.id, reason: 'Different fixture printing.' }];
      if (unknown) {
        result.selected_candidate_ids = []; result.rejections = result.candidates.map(candidate => ({ candidate_id: candidate.id, reason: 'Exact match unresolved.' }));
        result.estimate = { status: 'unknown', value_cents: null, low_cents: null, high_cents: null, currency: 'USD', count: 0, reason: 'No verified matching selections.' };
      }
      StaffInventoryResearchResultSchema.parse(result);
      assert.equal(await tx(client => database.completeStaffInventoryResearchV2(client, { jobId: claim.jobId, leaseToken: claim.leaseToken, result })), true);
      const binding = { jobId: claim.jobId, unitId: claim.input.unit_id, descriptionEventId: claim.input.description_event_id, inputHash: claim.inputHash, resultHash: database.inventoryHash(result) };
      const request = (expectedRevision: number, candidateId = result.selected_candidate_ids[2], decision: 'confirmed' | 'excluded' = 'excluded'): StaffInventoryResearchReviewCommand => ({ requestId: randomUUID(), ...binding, expectedRevision, candidateId, decision });
      return { command, claim, result, binding, request };
    };
    const main = await seed(), stale = await seed(), cancelled = await seed(), uncertain = await seed(), unknown = await seed(true);
    const snapshot = async (jobId = main.binding.jobId) => (await database.readStaffInventoryResearchReviewsV2(db, { jobIds: [jobId] }))[0];
    const immutable = await raw(main.binding.jobId), inventoryBefore = database.canonical(await database.readWorkflowHistoryV2(db));
    let first: StaffInventoryResearchReviewCommand;

    await t.test('the complete migration installs validated constraints, indexes and immutable triggers', async () => {
      const constraints = await db.$queryRawUnsafe<Array<{ convalidated: boolean }>>('SELECT convalidated FROM pg_constraint WHERE conrelid = \'"StaffInventoryResearchReviewV2"\'::regclass');
      assert.ok(constraints.length >= 18); assert.ok(constraints.every(value => value.convalidated));
      const triggers = await db.$queryRawUnsafe<Array<{ tgname: string }>>('SELECT tgname FROM pg_trigger WHERE tgname LIKE $1 AND NOT tgisinternal', 'StaffInventoryResearch%');
      for (const name of ['StaffInventoryResearchReviewV2_insert', 'StaffInventoryResearchReviewV2_preserve', 'StaffInventoryResearchReviewV2_no_truncate', 'StaffInventoryResearchJobV2_reviewed_result']) assert.ok(triggers.some(row => row.tgname === name));
      assert.equal((await snapshot()).revision, 0);
    });
    await t.test('exclusion durably recalculates and preserves original result, cost, price and journals', async () => {
      first = main.request(0); const saved = await review(first);
      assert.equal(saved.version, 1); assert.equal(saved.outcome, 'RECORDED'); assert.equal(saved.recorded_revision, 1); assert.equal(saved.review.revision, 1);
      assert.equal(saved.review.decisions[0].actor_id, 'fixture-staff-a');
      const projected = projectStaffInventoryResearchReview(main.result, await snapshot(), main.binding.resultHash)!;
      assert.equal(projected.value_cents, 1002); assert.equal(projected.count, 2); assert.deepEqual(projected.excluded_candidate_ids, [first.candidateId]);
      assert.deepEqual(await raw(main.binding.jobId), immutable); assert.equal(database.canonical(await database.readWorkflowHistoryV2(db)), inventoryBefore);
    });
    await t.test('uncertain response retries the exact request and remains acknowledged after later review', async () => {
      const replay = await review(first); assert.equal(replay.outcome, 'REPLAY'); assert.equal(replay.recorded_revision, 1); assert.equal(await count(), 1n);
      const next = await review(main.request(1, main.result.selected_candidate_ids[0], 'confirmed'), 'fixture-staff-b'); assert.equal(next.recorded_revision, 2);
      const laterReplay = await review(first); assert.equal(laterReplay.outcome, 'REPLAY'); assert.equal(laterReplay.recorded_revision, 1); assert.equal(laterReplay.review.revision, 2);
      await assert.rejects(review(first, 'different-staff'), conflict);
      await assert.rejects(review({ ...first, decision: 'confirmed' }), conflict);
      await assert.rejects(review({ ...first, requestId: randomUUID() }), conflict);
    });
    await t.test('two staff stale writes conflict and simultaneous exact retries append only once', async () => {
      const before = await count();
      const outcomes = await Promise.allSettled([review(main.request(2, main.result.selected_candidate_ids[0], 'excluded')), review(main.request(2, main.result.selected_candidate_ids[1], 'excluded'), 'fixture-staff-b')]);
      assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1); assert.ok(outcomes.some(value => value.status === 'rejected' && conflict(value.reason)));
      assert.equal(await count(), before + 1n);
      const exact = uncertain.request(0);
      const replayed = await Promise.all([review(exact), review(exact)]);
      assert.deepEqual(replayed.map(value => value.outcome).sort(), ['RECORDED', 'REPLAY']); assert.equal(await count(), before + 2n);
    });
    await t.test('all exact bindings, actor and strict command fields are enforced', async () => {
      const command = main.request(3), before = await count();
      for (const changed of [{ jobId: randomUUID() }, { unitId: 'another-unit' }, { descriptionEventId: 'another-description' }, { inputHash: '0'.repeat(64) }, { resultHash: '0'.repeat(64) }]) await assert.rejects(review({ ...command, ...changed }), conflict);
      await assert.rejects(review(command, ''), invalid);
      await assert.rejects(review({ ...command, actor: 'forged' } as StaffInventoryResearchReviewCommand), invalid);
      await assert.rejects(review({ ...command, candidateId: main.result.candidates[3].id }), invalid);
      assert.equal(await count(), before);
    });
    await t.test('restoring only originally selected comps recalculates; fewer than two stays unknown', async () => {
      let current = await snapshot();
      for (const id of main.result.selected_candidate_ids) { await review(main.request(current.revision, id, 'excluded')); current = await snapshot(); }
      let projection = projectStaffInventoryResearchReview(main.result, current, main.binding.resultHash)!;
      assert.equal(projection.status, 'unknown'); assert.equal(projection.value_cents, null); assert.equal(projection.count, 0);
      await review(main.request(current.revision, main.result.selected_candidate_ids[0], 'confirmed')); current = await snapshot();
      projection = projectStaffInventoryResearchReview(main.result, current, main.binding.resultHash)!;
      assert.equal(projection.count, 1); assert.equal(projection.value_cents, null); assert.equal(projection.selected_candidate_ids.length, 1);
      await review(main.request(current.revision, main.result.selected_candidate_ids[1], 'confirmed'));
      assert.equal(projectStaffInventoryResearchReview(main.result, await snapshot(), main.binding.resultHash)!.value_cents, 1002);
    });
    await t.test('SQL itself forbids ledger mutation, truncation, forged bindings and result replacement', async () => {
      for (const sql of ['UPDATE "StaffInventoryResearchReviewV2" SET decision = decision', 'DELETE FROM "StaffInventoryResearchReviewV2"', 'TRUNCATE "StaffInventoryResearchReviewV2"']) await assert.rejects(db.$executeRawUnsafe(sql), /append-only/);
      const changed = { ...main.result, warnings: ['Different bytes are forbidden after review.'] };
      await assert.rejects(db.$executeRawUnsafe('UPDATE "StaffInventoryResearchJobV2" SET result = $1, "resultHash" = $2 WHERE id = $3', database.canonical(changed), database.inventoryHash(changed), main.binding.jobId), /immutable/);
      const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM "StaffInventoryResearchReviewV2" WHERE "requestId" = $1', first.requestId);
      const row = rows[0], nextRevision = (await snapshot()).revision + 1;
      const malformed = { ...main.request(nextRevision - 1), candidateId: 'ebay:999999999999' };
      const request = database.canonical({ command: malformed, actor: 'fixture-staff-a' }), requestHash = database.inventoryHash(JSON.parse(request));
      const at = new Date(), content = database.canonical({ request_hash: requestHash, revision: nextRevision, reviewed_at: at.toISOString() });
      await assert.rejects(db.$executeRawUnsafe('INSERT INTO "StaffInventoryResearchReviewV2" ("requestId","jobId","unitId","descriptionEventId","inputHash","resultHash","expectedRevision","revision","candidateId","decision","actorId","reviewedAt","request","requestHash","content","contentHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', malformed.requestId, row.jobId, row.unitId, row.descriptionEventId, row.inputHash, row.resultHash, nextRevision - 1, nextRevision, malformed.candidateId, malformed.decision, 'fixture-staff-a', at, request, requestHash, content, database.inventoryHash(JSON.parse(content))), /unselected/);
      assert.deepEqual(await raw(main.binding.jobId), immutable);
    });
    await t.test('canonical description edits supersede the old review target and reject old request replay', async () => {
      const request = stale.request(0); await review(request);
      await tx(client => database.recordStaffInventoryV2(client, { action: 'edit', request_id: randomUUID(), effective_at: new Date().toISOString(), note: 'Changed description.', unit_ids: [stale.binding.unitId], description: { ...stale.command.description, name: 'Changed fixture card' }, expected_price_cents: 456 }, 'fixture-inventory-staff'));
      assert.equal((await raw(stale.binding.jobId)).status, 'superseded'); await assert.rejects(review(request), conflict);
      assert.deepEqual(await database.readStaffInventoryResearchReviewsV2(db, { jobIds: [stale.binding.jobId] }), []);
    });
    await t.test('canonical receipt cancellation rejects both new reviews and uncertain old replay', async () => {
      const request = cancelled.request(0); await review(request);
      const current = await state(), unit = current.units.get(cancelled.binding.unitId)!; const receipt = current.lots.get(unit.lot_id)!;
      await tx(client => database.recordInventoryWorkflowEventV2(client, { request_id: randomUUID(), effective_at: new Date().toISOString(), evidence_ref: 'Disposable cancellation.', event_kind: 'purchase_cancelled', data: { lot_id: unit.lot_id, purchase_event_id: receipt.source_event_id, reason: 'Fixture cancellation.' } }, 'fixture-inventory-staff'));
      await assert.rejects(review(request), conflict); await assert.rejects(review(cancelled.request(1)), conflict);
      assert.equal((await state()).units.has(cancelled.binding.unitId), false);
    });
    await t.test('unknown original research cannot be promoted by review', async () => {
      const before = await count();
      await assert.rejects(review(unknown.request(0, unknown.result.candidates[0].id, 'confirmed')), invalid);
      assert.equal(await count(), before);
    });
    await t.test('current roster replay refuses a forged individually researched job for a bulk receipt', async () => {
      const command = add(2); await tx(client => database.recordStaffInventoryV2(client, command, 'fixture-inventory-staff'));
      const current = await state(), unit = current.units.get(`staff:${command.request_id}:card:0001`)!;
      const input = { ...main.claim.input, unit_id: unit.unit_id, description_event_id: unit.description_event_id!, description_hash: database.inventoryHash(unit.description) };
      const result = { ...main.result, unit_id: input.unit_id, description_event_id: input.description_event_id, description_hash: input.description_hash };
      const jobId = randomUUID(), inputHash = database.inventoryHash(input), resultHash = database.inventoryHash(result);
      await db.$executeRawUnsafe('INSERT INTO "StaffInventoryResearchJobV2" (id,"unitId","descriptionEventId","descriptionHash","inputHash",input,status,"attemptCount","maxAttempts","nextAttemptAt","createdAt","updatedAt","startedAt","completedAt",result,"resultHash") VALUES ($1,$2,$3,$4,$5,$6,\'complete\',1,3,clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),$7,$8)', jobId, input.unit_id, input.description_event_id, input.description_hash, inputHash, database.canonical(input), database.canonical(result), resultHash);
      await assert.rejects(review({ ...main.request(0), jobId, unitId: input.unit_id, descriptionEventId: input.description_event_id, inputHash, resultHash }), conflict);
    });
    await t.test('the three canonical advisory locks serialize review without weakening existing writers', async () => {
      for (const lock of [20260907, 20260908, 20260911]) {
        await competitor.$transaction(async holder => {
          await holder.$queryRawUnsafe('SELECT true AS locked FROM pg_advisory_xact_lock($1::integer, $2::integer)', lock, lock === 20260911 ? 4202 : 4201);
          await assert.rejects(tx(async client => { await client.$executeRawUnsafe("SET LOCAL lock_timeout = '200ms'"); return database.recordStaffInventoryResearchReviewV2(client, main.request((await snapshot()).revision), 'fixture-staff-a'); }), /lock timeout/);
        }, { timeout: 5000 });
      }
    });
  } finally { await db.$disconnect(); await competitor.$disconnect(); globalThis.fetch = previousFetch; }
});
