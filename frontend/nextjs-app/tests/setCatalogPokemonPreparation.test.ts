import assert from 'node:assert/strict';
import test from 'node:test';
import { StalePokemonPreparationSnapshotError } from '../lib/server/setCatalogPokemonPreparation';
import { actor, clone, enabled, harness, type Row } from './setCatalogPokemonPreparationFixture';

test('exact 138-row pending source is preserved while only two markers, two scopes and one receipt are added', () => enabled(async () => {
  const f = harness(), before = clone(f.state()), request = await f.request();
  assert.deepEqual(f.calls, []);
  const result = await f.service.stage(request, actor), after = f.state();
  assert.equal(result.outcome, 'recorded'); assert.equal(result.receipt.applicability, 'unknown');
  assert.equal(result.receipt.approved, false); assert.equal(result.receipt.publication, null);
  assert.deepEqual(f.calls, ['setParallel.create','setParallel.create','setParallelScope.create','setParallelScope.create','setAuditEvent.create']);
  for (const key of Object.keys(before).filter(key => !['setParallel','setParallelScope','setAuditEvent'].includes(key))) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(after.setParallel.map(r => r.label), ['standard set','parallel set']);
  for (const row of after.setParallel) { assert.equal(row.serialDenominator, null); assert.equal(row.finishFamily, null); assert.equal(row.visualCuesJson, null); assert.equal(row.sourceId, before.setTaxonomySource[0].id); }
  for (const row of after.setParallelScope) { assert.equal(row.variationId, null); assert.equal(row.formatKey, null); assert.equal(row.channelKey, null); assert.equal(row.sourceId, before.setTaxonomySource[0].id); }
  assert.equal(after.setIngestionJob[0].status, 'REVIEW_REQUIRED');
  assert(f.sql.some(s => s.startsWith('LOCK TABLE') && s.includes('"SetCard"') && s.includes('"SetDraftVersion"')));
}));

test('same-key simulated concurrent and lost-response retries return one unchanged receipt', () => enabled(async () => {
  const f = harness(), request = await f.request();
  const results = await Promise.all([f.service.stage(request, actor), f.service.stage(request, actor)]);
  assert.deepEqual(results.map(r => r.outcome).sort(), ['recorded','replay']); assert.equal(results[0].receiptSha256, results[1].receiptSha256);
  assert.equal(f.state().setAuditEvent.length, 1);
  const lost = harness(), retry = await lost.request(); lost.controls.loseResponse = true;
  await assert.rejects(lost.service.stage(retry, actor), /response lost/);
  assert.equal((await lost.service.stage(retry, actor)).outcome, 'replay'); assert.equal(lost.state().setParallel.length, 2);
}));

test('every insertion or receipt failure rolls back all rows', () => enabled(async () => {
  for (let position = 1; position <= 5; position++) {
    const f = harness(), before = clone(f.state()), request = await f.request(); f.controls.failCreateNumber = position;
    await assert.rejects(f.service.stage(request, actor), /insert failure/); assert.deepEqual(f.state(), before);
  }
}));

test('missing, edited, unbound or approved source/card/version states cannot be staged', () => enabled(async () => {
  const changes: Array<(state: ReturnType<ReturnType<typeof harness>['state']>) => void> = [
    s => { s.setCard.pop(); }, s => { s.setCard[0].id = s.setCard[1].id; }, s => { s.setCard[0].playerName = 'Wrong name'; },
    s => { (s.setCard[0].metadataJson as Row).physicalFinish = 'Invented'; }, s => { s.setCard[0].isRookie = false; },
    s => { s.setProgram[0].label = 'Radiant Collection'; }, s => { s.setProgram[0].sourceId = 'another-source'; },
    s => { s.setTaxonomySource[0].ingestionJobId = null; }, s => { s.setTaxonomySource[0].sourceKind = 'TRUSTED_SECONDARY'; },
    s => { (s.setTaxonomySource[0].metadataJson as Row).humanReviewed = true; }, s => { s.setIngestionJob[0].status = 'APPROVED'; },
    s => { ((s.setIngestionJob[0].parseSummaryJson as Row).taxonomyIngest as Row).applied = false; },
    s => { s.setIngestionJob[0].rawPayload = {}; }, s => { s.setDraft[0].status = 'APPROVED'; },
    s => { s.setDraftVersion[0].versionHash = 'f'.repeat(64); }, s => { s.setDraftVersion[0].dataJson = {}; },
    s => { s.setSeedJob.push({ id: 'active', draftId: s.setDraft[0].id, status: 'IN_PROGRESS' }); },
  ];
  for (const change of changes) {
    const f = harness(), request = await f.request(); change(f.state()); const before = clone(f.state());
    await assert.rejects(f.service.stage(request, actor)); assert.deepEqual(f.state(), before); assert.equal(f.calls.length, 0);
  }
}));

test('count mismatch, occupied mappings and in-transaction drift fail without writes', () => enabled(async () => {
  for (const mode of ['count','occupied','during','lock']) {
    const f = harness(), request = await f.request();
    if (mode === 'count') f.controls.badCount = 'setCard';
    if (mode === 'occupied') f.state().setParallel.push({ id: 'occupied', setId: f.state().setDraft[0].setId });
    if (mode === 'during') f.controls.mutateCardDuringCreate = true;
    if (mode === 'lock') f.controls.denyLock = true;
    const before = clone(f.state()); await assert.rejects(f.service.stage(request, actor)); assert.deepEqual(f.state(), before);
  }
}));

test('typed stale rejection is write-free and exact-bound; unknown receipt failures retain ambiguity', () => enabled(async () => {
  const f = harness(), request = await f.request();
  // Extra descriptive job metadata changes a valid baseline without altering
  // the exact pinned source facts. Preview must be redone deliberately.
  (f.state().setIngestionJob[0].parseSummaryJson as Row).extraReviewNote = 'Changed after preview';
  await assert.rejects(f.service.stage(request, actor), error => error instanceof StalePokemonPreparationSnapshotError
    && error.idempotencyKey === request.idempotencyKey && error.expectedSnapshotSha256 === request.expectedSnapshotSha256);
  assert.equal(f.calls.length, 0);
  const recorded = harness(), r = await recorded.request(); await recorded.service.stage(r, actor);
  await assert.rejects(recorded.service.stage({ ...r, expectedSnapshotSha256: '0'.repeat(64) }, actor), error => error instanceof Error
    && /different evidence/.test(error.message) && !(error instanceof StalePokemonPreparationSnapshotError));
}));

test('source byte pins, request shape and real human authority are mandatory', () => enabled(async () => {
  const f = harness(), r = await f.request();
  for (const patch of [{ proposalSha256: '0'.repeat(64) }, { approved: true }, { schemaVersion: 'unknown' }]) await assert.rejects(f.service.stage({ ...r, ...patch }, actor));
  await assert.rejects(f.service.stage(r, { ...actor, authority: 'operator-key' }), /human admin/);
  f.controls.badBytes = true; await assert.rejects(f.service.stage(r, actor), /source bytes differ/); assert.equal(f.calls.length, 0);
}));

test('replay cannot repair tampering or approve the source; different keys cannot duplicate mappings', () => enabled(async () => {
  const f = harness(), r = await f.request(); await f.service.stage(r, actor);
  const before = clone(f.state());
  await assert.rejects(f.service.stage(r, { ...actor, user: { ...actor.user, id: 'another-human' } }), /different evidence/);
  await assert.rejects(f.service.stage({ ...r, idempotencyKey: '00000000-0000-4000-8000-000000000001' }, actor), /already exist/);
  assert.deepEqual(f.state(), before);
  f.state().setParallel[0].finishFamily = 'Invented foil'; const tampered = clone(f.state());
  await assert.rejects(f.service.stage(r, actor), /changed or are missing/); assert.deepEqual(f.state(), tampered);
}));

test('every original row binding and the actual build timestamp are bound to the exact preview', () => enabled(async () => {
  const f = harness(), request = await f.request();
  for (const key of Object.keys(request.binding)) {
    await assert.rejects(f.service.stage({ ...request, binding: { ...request.binding, [key]: 'wrong-existing-row' } }, actor),
      error => error instanceof StalePokemonPreparationSnapshotError);
  }
  (f.state().setDraftVersion[0].dataJson as Row).generatedAt = '2026-09-20T01:00:00.000Z';
  await assert.rejects(f.service.stage(request, actor), error => error instanceof StalePokemonPreparationSnapshotError);
  assert.equal(f.calls.length, 0);
  const refreshed = await f.request();
  assert.equal((await f.service.stage(refreshed, actor)).outcome, 'recorded');
}));
