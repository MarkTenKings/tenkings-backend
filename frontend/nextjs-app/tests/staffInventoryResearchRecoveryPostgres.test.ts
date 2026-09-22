import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import type { StaffInventoryResearchRecoveryAssessment } from '@tenkings/shared';
import type { StaffInventoryResearchRecoveryClaimV2 } from '@tenkings/database';

const enabled = process.env.TEN_KINGS_RESEARCH_RECOVERY_DISPOSABLE_VALIDATION === '1';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

test('real PostgreSQL automatic recovery is bounded, durable, exact-bound and concurrency-safe', { skip: !enabled, timeout: 120_000 }, async t => {
  assert.equal(process.version, 'v22.23.2');
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1'); assert.ok(url.port);
  assert.equal(url.pathname, '/tenkings_research_recovery_disposable'); assert.equal(url.username, 'postgres'); assert.ok(url.password);
  const ownershipPath = await realpath(process.env.TEN_KINGS_RESEARCH_RECOVERY_OWNERSHIP_FILE ?? '');
  assert.equal(basename(ownershipPath), 'fixture-ownership.json'); assert.ok(basename(dirname(ownershipPath)).startsWith('tk-research-recovery-'));
  const ownership = JSON.parse(await readFile(ownershipPath, 'utf8'));
  assert.equal(ownership.schema_version, 1); assert.equal(ownership.database_url_sha256, digest(url.href));
  assert.equal(ownership.nonce, process.env.TEN_KINGS_RESEARCH_RECOVERY_NONCE); assert.match(ownership.nonce, /^[a-f0-9]{48}$/);
  assert.equal(ownership.owner_uid, process.getuid!()); process.kill(ownership.postgres_pid, 0);
  for (const key of Object.keys(process.env)) assert.ok(!/^(OPENAI_API_KEY|SOLD_?COMPS_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|DIRECT_URL|SHADOW_DATABASE_URL)$/.test(key));
  const previousFetch = globalThis.fetch; globalThis.fetch = async () => assert.fail('No external HTTP is permitted.');
  const { PrismaClient } = await import('@prisma/client');
  const database = await import('@tenkings/database');
  const { StaffInventoryResearchResultSchema } = await import('@tenkings/shared');
  const { marketResult } = await import('./fixtures/staffInventoryMarketValue');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const competitor = new PrismaClient({ datasources: { db: { url: url.href } } });
  const tx = <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => db.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 30_000 });
  const raw = async (id: string) => (await db.$queryRawUnsafe<any[]>('SELECT * FROM "StaffInventoryResearchJobV2" WHERE id=$1', id))[0];
  const focus = async (id: string) => {
    await db.$executeRawUnsafe('UPDATE "StaffInventoryResearchJobV2" SET "recoveryNextCheckAt"=CASE WHEN id=$1 THEN clock_timestamp() ELSE clock_timestamp()+interval \'1 day\' END, "nextAttemptAt"=CASE WHEN id=$1 THEN clock_timestamp() ELSE clock_timestamp()+interval \'1 day\' END', id);
  };
  const recovery = async (id: string, leaseMs = 90000) => { await focus(id); const result = await tx(client => database.claimStaffInventoryResearchRecoveryV2(client, { leaseMs })); assert.ok(result); assert.equal(result.jobId, id); return result; };
  const assessment = (claim: StaffInventoryResearchRecoveryClaimV2, ready = false, digest = 'a'): StaffInventoryResearchRecoveryAssessment => ({
    schema_version: 1, resolver_version: 'staff-inventory-recovery-identity-v1', source_input_sha256: claim.inputHash,
    description_event_id: claim.input.description_event_id, description_hash: claim.input.description_hash, proposed_description: claim.input.description,
    added_fields: [], conflicts: [], missing_fields: [], recognition: { status: 'not_needed', evidence: null }, references: ready ? marketResult().references : [], catalog_context: null,
    need_codes: ready ? [] : ['MISSING_CATALOG_REFERENCE'], evidence_sha256: ready ? digest.repeat(64) : null, ready_for_research: ready,
  });
  const settle = (claim: StaffInventoryResearchRecoveryClaimV2, value = assessment(claim)) => tx(client => database.completeStaffInventoryResearchRecoveryV2(client, { claim, assessment: value }));
  const complete = async (claim: NonNullable<Awaited<ReturnType<typeof database.claimStaffInventoryResearchV2>>>, estimated = false) => {
    const result = marketResult(); Object.assign(result, { unit_id: claim.input.unit_id, description_event_id: claim.input.description_event_id, description_hash: claim.input.description_hash, researched_at: new Date().toISOString() });
    if (!estimated) { result.selected_candidate_ids = []; result.rejections = result.candidates.map(candidate => ({ candidate_id: candidate.id, reason: 'Unresolved exact match.' })); result.estimate = { status: 'unknown', value_cents: null, low_cents: null, high_cents: null, currency: 'USD', count: 0, reason: 'Unresolved fixture.' }; }
    StaffInventoryResearchResultSchema.parse(result);
    assert.equal(await tx(client => database.completeStaffInventoryResearchV2(client, { jobId: claim.jobId, leaseToken: claim.leaseToken, result })), true); return result;
  };
  try {
    const location = await db.location.create({ data: { name: 'DISPOSABLE RECOVERY FIXTURE', slug: 'recovery-fixture', address: 'fixture', recentRips: [], locationType: 'hq' } });
    const add = (quantity = 1, missing = false) => ({ action: 'add' as const, request_id: randomUUID(), effective_at: '2026-09-20T00:00:00.000Z', note: 'Disposable recovery fixture.', origin: 'purchase' as const,
      quantity, total_cost_cents: 123, cost_method: quantity === 1 ? 'documented_unit' as const : 'equal_card' as const, expected_price_cents: 456,
      destination: { location_id: location.id, kind: 'hq' as const, machine_id: null, product_id: null, door_id: null }, stage: 'unprocessed' as const,
      description: { name: 'Fixture Runner', category: 'Sports cards', notes: '', photo_key: marketResult().photos.front!.key, back_photo_key: marketResult().photos.back!.key,
        card_details: { manufacturer: 'Fixture Cards', card_number: '007', year: missing ? null : '2024', set_name: 'Fixture Chrome', variant: 'Base', card_type: 'Baseball' }, planned_sales_channel: 'eBay' } });
    const seed = async (queued = false, missing = false, estimated = false) => {
      const command = add(1, missing); await tx(client => database.recordStaffInventoryV2(client, command, 'fixture-staff'));
      const [job] = await database.readStaffInventoryResearchV2(db, { unitIds: [`staff:${command.request_id}:card:0001`] }); await focus(job.job_id);
      if (!queued) { const claim = await tx(client => database.claimStaffInventoryResearchV2(client)); assert.ok(claim); assert.equal(claim.jobId, job.job_id); assert.equal(claim.recoveryEvidenceHash, null); await complete(claim, estimated); }
      return { command, id: job.job_id, unitId: job.unit_id };
    };
    const nextPaid = () => tx(client => database.claimStaffInventoryResearchV2(client, { requireRecovery: true }));
    await t.test('new queued card waits for a current-bound recovery preflight', async () => {
      const card = await seed(true); assert.equal(await nextPaid(), null);
      assert.deepEqual(await database.readStaffInventoryResearchRecoveryV2(db, { jobIds: [card.id] }), []);
      const claim = await recovery(card.id); assert.equal(await settle(claim), 'waiting'); assert.equal(await nextPaid(), null);
      const [status] = await database.readStaffInventoryResearchRecoveryV2(db, { jobIds: [card.id] }); assert.equal(status.status, 'waiting_catalog_evidence'); assert.equal(status.automatic_refresh_count, 0);
      const ready = await recovery(card.id); assert.equal(await settle(ready, assessment(ready, true)), 'queued'); const paid = await nextPaid(); assert.ok(paid); assert.equal(paid.attempt, 1); await complete(paid);
    });
    await t.test('reviewed evidence queues exactly one same-input attempt and preserves financial journals', async () => {
      const card = await seed(), before = await raw(card.id), history = database.canonical(await database.readWorkflowHistoryV2(db));
      const claim = await recovery(card.id); assert.equal(await settle(claim, assessment(claim, true)), 'queued'); assert.equal(await settle(claim, assessment(claim, true)), 'stale');
      assert.equal(await tx(client => database.claimStaffInventoryResearchV2(client, { requireRecovery: false })), null);
      const queued = await raw(card.id); assert.equal(queued.input, before.input); assert.equal(queued.result, before.result); assert.deepEqual(queued.attempts, before.attempts); assert.deepEqual(queued.retries, before.retries);
      const paid = await nextPaid(); assert.ok(paid); assert.equal(paid.recoveryEvidenceHash, 'a'.repeat(64)); const enriched = await database.readStaffInventoryResearchRecoveryAssessmentV2(db, { jobId: paid.jobId, inputHash: paid.inputHash, attempt: paid.attempt }); assert.equal(enriched?.evidence_sha256, paid.recoveryEvidenceHash);
      await complete(paid); assert.equal(database.canonical(await database.readWorkflowHistoryV2(db)), history);
      const again = await recovery(card.id); assert.equal(await settle(again, assessment(again, true)), 'waiting'); assert.equal(await nextPaid(), null);
      assert.equal((await raw(card.id)).attempts.length, before.attempts.length + 1);
    });
    await t.test('two manual retries remain intact while new evidence receives a bounded recovery attempt', async () => {
      const card = await seed();
      for (let index = 0; index < 2; index++) { const [job] = await database.readStaffInventoryResearchV2(db, { unitIds: [card.unitId] }); await tx(client => database.retryStaffInventoryResearchV2(client, { requestId: randomUUID(), jobId: job.job_id, unitId: job.unit_id, descriptionEventId: job.description_event_id, inputHash: job.input_hash, expectedAttemptCount: job.attempt_count }, 'fixture-staff')); const paid = await nextPaid(); assert.ok(paid); await complete(paid); }
      const before = await raw(card.id), claim = await recovery(card.id); assert.equal(before.retries.length, 2); assert.equal(await settle(claim, assessment(claim, true)), 'queued');
      const paid = await nextPaid(); assert.ok(paid); await complete(paid); const after = await raw(card.id); assert.deepEqual(after.retries, before.retries); assert.equal(after.attempts.length, 4);
    });
    await t.test('intake pause and combined paid/recovery capacity apply across concurrent claims', async () => {
      const card = await seed(); const leases = await Promise.all(Array.from({ length: 3 }, () => tx(client => database.acquireStaffInventoryIntakeLeaseV2(client))));
      await focus(card.id); assert.equal(await tx(client => database.claimStaffInventoryResearchRecoveryV2(client)), null);
      for (const lease of leases) await tx(client => database.releaseStaffInventoryIntakeLeaseV2(client, lease.leaseId));
      const claims = await Promise.all([tx(client => database.claimStaffInventoryResearchRecoveryV2(client, { maxConcurrent: 1 })), tx(client => database.claimStaffInventoryResearchRecoveryV2(client, { maxConcurrent: 1 }))]);
      assert.equal(claims.filter(Boolean).length, 1); assert.equal(await tx(client => database.claimStaffInventoryResearchV2(client, { maxConcurrent: 1 })), null); await settle(claims.find(Boolean)!);
    });
    await t.test('original-photo attempts are reserved before dispatch and remain bounded after crashes', async () => {
      const card = await seed(false, true); const first = await recovery(card.id, 1000); assert.equal(first.allowRecognition, true);
      await new Promise(done => setTimeout(done, 1050)); const second = await recovery(card.id); assert.equal(second.allowRecognition, true);
      assert.equal(await settle(first), 'stale'); await tx(client => database.failStaffInventoryResearchRecoveryV2(client, { claim: second }));
      const third = await recovery(card.id); assert.equal(third.allowRecognition, false); await settle(third); assert.equal(JSON.parse((await raw(card.id)).recoveryState).photo_attempts.length, 2);
    });
    await t.test('canonical description edits revoke recovery tokens without altering the original job evidence', async () => {
      const card = await seed(), claim = await recovery(card.id), before = await raw(card.id);
      await tx(client => database.recordStaffInventoryV2(client, { action: 'edit', request_id: randomUUID(), effective_at: new Date().toISOString(), note: 'Fixture description changed.', unit_ids: [card.unitId], description: { ...card.command.description, name: 'Edited card' }, expected_price_cents: 456 }, 'fixture-staff'));
      assert.equal(await settle(claim, assessment(claim, true)), 'stale'); const after = await raw(card.id); assert.equal(after.status, 'superseded'); assert.equal(after.recoveryLeaseToken, null); assert.equal(after.result, before.result); assert.deepEqual(after.attempts, before.attempts);
    });
    await t.test('exact bindings and human saved values reject forged recovery results', async () => {
      const card = await seed(), claim = await recovery(card.id), value = assessment(claim, true);
      await assert.rejects(settle(claim, { ...value, added_fields: ['variant'] }), /optional variant/);
      await assert.rejects(settle(claim, { ...value, source_input_sha256: 'f'.repeat(64) }), /another input/);
      await assert.rejects(settle(claim, { ...value, proposed_description: { ...value.proposed_description, year: '2025' } }), /saved human/);
      assert.equal(await settle({ ...claim, expectedResultHash: 'f'.repeat(64) }, value), 'stale'); await settle(claim);
    });
    await t.test('superseded paid recovery retains its immutable claim discriminator when assessment lookup becomes unavailable', async () => {
      const card = await seed(), recoveryClaim = await recovery(card.id); await settle(recoveryClaim, assessment(recoveryClaim, true));
      const paid = await nextPaid(); assert.ok(paid); assert.equal(paid.recoveryEvidenceHash, 'a'.repeat(64));
      await tx(client => database.recordStaffInventoryV2(client, { action: 'edit', request_id: randomUUID(), effective_at: new Date().toISOString(), note: 'Superseded paid fixture.', unit_ids: [card.unitId], description: { ...card.command.description, name: 'Edited before paid work' }, expected_price_cents: 456 }, 'fixture-staff'));
      assert.equal(await database.readStaffInventoryResearchRecoveryAssessmentV2(db, { jobId: paid.jobId, inputHash: paid.inputHash, attempt: paid.attempt }), null);
      assert.equal(paid.recoveryEvidenceHash, 'a'.repeat(64)); assert.equal((await raw(card.id)).status, 'superseded');
    });
    await t.test('paid scope resolution requires a fresh persisted reservation and stops at two', async () => {
      const card = await seed();
      for (let count = 0; count < 3; count++) { const claim = await recovery(card.id); assert.equal(claim.allowScopeResolution, count < 2);
        assert.equal(await tx(client => database.reserveStaffInventoryResearchRecoveryScopeV2(client, { claim })), count < 2);
        assert.equal(await tx(client => database.reserveStaffInventoryResearchRecoveryScopeV2(client, { claim })), false); await settle(claim); }
      assert.equal(JSON.parse((await raw(card.id)).recoveryState).scope_attempts.length, 2);
    });
    await t.test('source discovery reserves one exact demand across jobs and reuses its immutable unreviewed receipt', async () => {
      const first = await seed(), second = await seed(), one = await recovery(first.id); await focus(second.id);
      const two = await tx(client => database.claimStaffInventoryResearchRecoveryV2(client)); assert.ok(two);
      const demandHash = 'f'.repeat(64), winners = await Promise.all([tx(client => database.reserveStaffInventoryResearchRecoverySourcesV2(client, { claim: one, demandHash })), tx(client => database.reserveStaffInventoryResearchRecoverySourcesV2(client, { claim: two, demandHash }))]);
      assert.equal(winners.filter(Boolean).length, 1); const winner = winners[0] ? one : two, other = winners[0] ? two : one;
      assert.equal(await tx(client => database.reserveStaffInventoryResearchRecoverySourcesV2(client, { claim: winner, demandHash: 'e'.repeat(64) })), false);
      const receipt = { schema_version: 1 as const, disposition: 'review_required' as const, demand_sha256: demandHash, query: 'Fixture Cards Fixture Chrome checklist', requested_at: new Date().toISOString(), status: 'candidates' as const,
        requests: [{ provider: 'bing_rss' as const, response_sha256: 'a'.repeat(64), status: 'completed' as const }], candidates: [{ title: 'Fixture manufacturer checklist', url: 'https://www.topps.com/checklists', domain: 'www.topps.com', provider: 'bing_rss' as const }] };
      await assert.rejects(settle(other, { ...assessment(other), source_discovery: receipt }), /reserved exact demand/);
      await settle(winner, { ...assessment(winner), source_discovery: receipt });
      assert.deepEqual(await database.readStaffInventoryResearchRecoverySourcesV2(db, { demandHash }), receipt);
      await settle(other, { ...assessment(other), source_discovery: receipt });
      const again = await recovery(winner.jobId); await assert.rejects(settle(again, assessment(again)), /cannot be replaced/); await settle(again, { ...assessment(again), source_discovery: receipt });
    });
    await t.test('transient evidence failure backs off thirty minutes without scheduling sold research', async () => {
      const card = await seed(), claim = await recovery(card.id), at = Date.now(); await settle(claim, { ...assessment(claim), need_codes: ['CATALOG_UNAVAILABLE'] });
      const [snapshot] = await database.readStaffInventoryResearchRecoveryV2(db, { jobIds: [card.id] }); assert.equal(snapshot.status, 'waiting_new_evidence'); assert.ok(Date.parse(snapshot.next_check_at!) >= at + 29 * 60 * 1000); assert.ok(Date.parse(snapshot.next_check_at!) < at + 31 * 60 * 1000); assert.equal(await nextPaid(), null);
    });
    await t.test('automatic provider failure consumes its single digest attempt even with spare manual allowance', async () => {
      const card = await seed(), claim = await recovery(card.id); await settle(claim, assessment(claim, true)); const paid = await nextPaid(); assert.ok(paid);
      await tx(client => database.failStaffInventoryResearchV2(client, { jobId: paid.jobId, leaseToken: paid.leaseToken, errorCode: 'PROVIDER_ERROR', errorMessage: 'Fixture failure.', retryable: true }));
      assert.equal((await raw(card.id)).status, 'failed'); const again = await recovery(card.id); assert.equal(await settle(again, assessment(again, true)), 'waiting'); assert.equal(await nextPaid(), null);
    });
    await t.test('three distinct digests terminate automatic refresh without resetting lifetime or manual counters', async () => {
      const card = await seed();
      for (const digest of ['a', 'b', 'c']) { const claim = await recovery(card.id); await settle(claim, assessment(claim, true, digest)); const paid = await nextPaid(); assert.ok(paid); await complete(paid); }
      await focus(card.id); assert.equal(await tx(client => database.claimStaffInventoryResearchRecoveryV2(client)), null); const row = await raw(card.id); assert.equal(row.attemptCount, 4); assert.equal(row.retries.length, 0); assert.equal(JSON.parse(row.recoveryState).status, 'limit_reached');
    });
    await t.test('database guards reject recovery authority removal and mutation', async () => {
      const card = await seed(), claim = await recovery(card.id); await settle(claim, assessment(claim, true)); const before = await raw(card.id), state = JSON.parse(before.recoveryState);
      await assert.rejects(db.$executeRawUnsafe('UPDATE "StaffInventoryResearchJobV2" SET "recoveryState"=NULL,"recoveryStateHash"=NULL WHERE id=$1', card.id), /removed/);
      state.refreshes = []; await assert.rejects(db.$executeRawUnsafe('UPDATE "StaffInventoryResearchJobV2" SET "recoveryState"=$1,"recoveryStateHash"=$2 WHERE id=$3', database.canonical(state), database.inventoryHash(state), card.id), /append-only/);
      const paid = await nextPaid(); assert.ok(paid); await complete(paid);
    });
    await t.test('a historical individual description with no job is discovered once through canonical replay', async () => {
      await focus(randomUUID());
      const unitId = `legacy-fixture:${randomUUID()}`, lotId = `legacy-lot:${randomUUID()}`;
      await tx(client => database.recordInventoryWorkflowEventV2(client, { request_id: randomUUID(), effective_at: '2026-09-20T00:00:00.000Z', evidence_ref: 'Historical fixture receipt.', event_kind: 'purchase_received',
        data: { lot_id: lotId, acquisition_cycle_id: randomUUID(), quantity: 1, total_cost_cents: 123, unknown_reason: null, purchase_evidence_ref: 'Historical fixture receipt.', unit_ids: [unitId], custody: { custody_id: `hq:${location.id}`, location_id: location.id } } }, 'fixture-staff'));
      // Exact historical fixture bytes represent a pre-research-hook description.
      // Preview constructs and verifies its canonical envelope; no existing
      // journal/job is edited, removed, or stripped of append-only protection.
      const command = database.parseWorkflowCommandV2({ request_id: randomUUID(), effective_at: '2026-09-20T00:00:00.000Z', evidence_ref: 'Historical description fixture.', event_kind: 'item_described', data: { unit_ids: [unitId], description: add().description } });
      await tx(async client => { const preview = await database.recordInventoryWorkflowEventV2(client, command, 'fixture-staff', { preview: true }); const content = { command, event: preview.event };
        await client.$executeRawUnsafe('INSERT INTO "InventoryWorkflowEventV2" (sequence,id,"recordedAt",content,"contentHash","requestHash") VALUES ($1,$2,$3,$4,$5,$6)', BigInt(preview.event.source_sequence), preview.event.source_event_id, new Date(preview.event.recorded_at), database.canonical(content), database.inventoryHash(content), database.inventoryHash({ command, actor: 'fixture-staff' })); });
      const before = database.canonical(await database.readWorkflowHistoryV2(db)); assert.deepEqual(await database.readStaffInventoryResearchV2(db, { unitIds: [unitId] }), []);
      const claim = await tx(client => database.claimStaffInventoryResearchRecoveryV2(client)); assert.ok(claim); assert.equal(claim.input.unit_id, unitId); await settle(claim);
      assert.equal((await database.readStaffInventoryResearchV2(db, { unitIds: [unitId] })).length, 1); assert.equal(database.canonical(await database.readWorkflowHistoryV2(db)), before);
      assert.equal(await tx(client => database.claimStaffInventoryResearchRecoveryV2(client)), null);
    });
    await t.test('receipt cancellation invalidates recovery and prevents rediscovery of cancelled units', async () => {
      const card = await seed(), claim = await recovery(card.id), before = await raw(card.id), state = database.replayWorkflowEventsV2(await database.readWorkflowHistoryV2(db));
      const unit = state.units.get(card.unitId)!, receipt = state.lots.get(unit.lot_id)!;
      await tx(client => database.recordInventoryWorkflowEventV2(client, { request_id: randomUUID(), effective_at: new Date().toISOString(), evidence_ref: 'Fixture cancellation.', event_kind: 'purchase_cancelled', data: { lot_id: unit.lot_id, purchase_event_id: receipt.source_event_id, reason: 'Unused fixture cancelled.' } }, 'fixture-staff'));
      assert.equal(await settle(claim, assessment(claim, true)), 'stale'); assert.equal((await raw(card.id)).result, before.result); assert.equal(await tx(client => database.claimStaffInventoryResearchRecoveryV2(client)), null);
    });
    await t.test('expired automatic paid work is terminal for its digest and rejects late completions', async () => {
      const card = await seed(), claim = await recovery(card.id); await settle(claim, assessment(claim, true));
      const paid = await tx(client => database.claimStaffInventoryResearchV2(client, { requireRecovery: true, leaseMs: 1000 })); assert.ok(paid);
      await new Promise(done => setTimeout(done, 1050)); assert.equal(await nextPaid(), null);
      const row = await raw(card.id); assert.equal(row.status, 'failed'); assert.equal(row.attempts.at(-1).outcome, 'expired');
      assert.equal(await tx(client => database.failStaffInventoryResearchV2(client, { jobId: paid.jobId, leaseToken: paid.leaseToken, errorCode: 'PROVIDER_ERROR', errorMessage: 'Late fixture.', retryable: true })), false);
    });
    await t.test('background claims yield immediately to every canonical writer lock', async () => {
      const card = await seed(); await focus(card.id);
      for (const key of [20260907, 20260908, 20260911]) await competitor.$transaction(async holder => {
        await holder.$queryRawUnsafe('SELECT true AS locked FROM pg_advisory_xact_lock($1::integer,$2::integer)', key, key === 20260911 ? 4202 : 4201);
        const started = performance.now(); assert.equal(await tx(client => database.claimStaffInventoryResearchRecoveryV2(client)), null); assert.ok(performance.now() - started < 1000);
      }, { timeout: 5000 });
    });
    await t.test('paired synthetic saves keep headroom under real due recovery scans', async () => {
      // Predeclared local smoke margins, not hosted/provider saturation proof:
      // median <= idle*2+25ms; p95 <= idle*2+50ms. Twenty sequential paired saves.
      const target = await seed(), idle: number[] = [], loaded: number[] = [];
      let fullReplayClaims = 0, writerLockContentions = 0, recoveryYields = 0;
      const save = async () => { const command = add(), at = performance.now(); await tx(client => database.recordStaffInventoryV2(client, command, 'fixture-staff')); return performance.now() - at; };
      for (let sample = 0; sample < 20; sample++) {
        await focus(target.id); idle.push(await save()); await focus(target.id);
        let entered!: () => void, releaseReplay!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; }), released = new Promise<void>(resolve => { releaseReplay = resolve; });
        const scan = tx(async client => {
          let acquired = 0;
          const observed = new Proxy(client, { get(object, key, receiver) {
            if (key !== '$queryRaw') return Reflect.get(object, key, receiver);
            return async (...args: Parameters<Prisma.TransactionClient['$queryRaw']>) => {
              const result = await object.$queryRaw(...args);
              if (typeof args[0] === 'object' && 'sql' in args[0] && String(args[0].sql).includes('pg_try_advisory_xact_lock') && (result as Array<{ acquired: boolean }>)[0]?.acquired && ++acquired === 3) {
                entered(); await released;
              }
              return result;
            };
          } });
          return database.claimStaffInventoryResearchRecoveryV2(observed);
        });
        try {
          await Promise.race([reached, scan.then(() => { throw Error('Recovery did not reach the full-replay lock barrier.'); })]);
          const command = add(), started = performance.now();
          await tx(async client => {
            const probe = await client.$queryRawUnsafe<Array<{ acquired: boolean }>>('SELECT pg_try_advisory_xact_lock(20260907,4201) AS acquired');
            assert.equal(probe[0].acquired, false, 'The actual intake writer must encounter the recovery lock.'); writerLockContentions++;
            releaseReplay();
            await database.recordStaffInventoryV2(client, command, 'fixture-staff');
          });
          loaded.push(performance.now() - started);
          const claim = await scan; if (claim) { fullReplayClaims++; await settle(claim); } else recoveryYields++;
        } finally { releaseReplay(); await scan; }
        assert.equal(fullReplayClaims, sample + 1); assert.equal(recoveryYields, 0);
      }
      const metrics = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { median_ms: sorted[9], p95_ms: sorted[18], maximum_ms: sorted[19] }; };
      const baseline = metrics(idle), concurrent = metrics(loaded);
      assert.ok(concurrent.median_ms <= baseline.median_ms * 2 + 25); assert.ok(concurrent.p95_ms <= baseline.p95_ms * 2 + 50);
      const schema = {
        columns: await db.$queryRawUnsafe(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='"StaffInventoryResearchJobV2"'::regclass AND a.attname LIKE 'recovery%' ORDER BY a.attname`),
        constraints: await db.$queryRawUnsafe(`SELECT conname AS name, convalidated AS validated, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='"StaffInventoryResearchJobV2"'::regclass AND conname LIKE 'StaffInventoryResearchRecovery%' ORDER BY conname`),
        indexes: await db.$queryRawUnsafe(`SELECT c.relname AS name, i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname LIKE 'StaffInventoryResearchRecovery%' ORDER BY c.relname`),
        triggers: await db.$queryRawUnsafe(`SELECT tgname AS name, tgenabled::text AS enabled, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname LIKE 'StaffInventoryResearchRecovery%' ORDER BY tgname`),
        functions: await db.$queryRawUnsafe(`SELECT proname AS name, pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname='staffInventoryResearchRecoveryV2Preserve' ORDER BY proname`),
      };
      await writeFile(ownership.result_file, JSON.stringify({ scope: 'local-synthetic-canonical-saves-with-real-recovery-scans', samples_per_arm: 20, full_replay_claims: fullReplayClaims, writer_lock_contentions: writerLockContentions, recovery_yields: recoveryYields, baseline, concurrent, margins: { median_multiplier: 2, median_add_ms: 25, p95_multiplier: 2, p95_add_ms: 50 }, passed: true, hosted_load_proven: false, schema }), { mode: 0o600, flag: 'wx' });
    });
    await t.test('valid estimates, reviewed results and bulk stock never enter automatic recovery', async () => {
      const card = await seed(false, false, true), before = await raw(card.id); await focus(card.id);
      assert.equal(await tx(client => database.claimStaffInventoryResearchRecoveryV2(client)), null);
      const result = JSON.parse(before.result); await tx(client => database.recordStaffInventoryResearchReviewV2(client, { requestId: randomUUID(), jobId: card.id, unitId: card.unitId, descriptionEventId: before.descriptionEventId, inputHash: before.inputHash, resultHash: before.resultHash, expectedRevision: 0, candidateId: result.selected_candidate_ids[0], decision: 'excluded' }, 'fixture-staff'));
      assert.equal(await tx(client => database.claimStaffInventoryResearchRecoveryV2(client)), null);
      const batch = add(11); await tx(client => database.recordStaffInventoryV2(client, batch, 'fixture-staff'));
      assert.deepEqual(await database.readStaffInventoryResearchV2(db, { unitIds: [`staff:${batch.request_id}:card:0001`] }), []); assert.equal((await raw(card.id)).result, before.result);
    });
  } finally { await db.$disconnect(); await competitor.$disconnect(); globalThis.fetch = previousFetch; }
});
