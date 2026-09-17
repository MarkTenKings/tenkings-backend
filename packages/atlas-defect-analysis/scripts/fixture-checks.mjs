import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAnalysisRepository, analysisGrantSQL, analysisReceiptGrantSQL } from '../src/repository.mjs';
import { check, digest, canonical } from '../src/contract.mjs';
import { inputFixture, artifactRef, hash } from '../test/fixtures.mjs';

/** Invoked only by the existing owned loopback PostgreSQL fixture. Does not
 * start a database, accept a live URL, access storage or call a provider. */
export async function runAnalysisFixtureChecks({ fixture, connection, reviewer, cardId, actorId }) {
  const checks = [];
  await fixture.cluster.sql(analysisGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  await fixture.cluster.sql('CREATE ROLE atlas_fixture_analysis_receipt NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', [], fixture.database.name);
  await fixture.cluster.sql(analysisReceiptGrantSQL('atlas_fixture_analysis_receipt'), [], fixture.database.name);
  const receiptClient = { $queryRawUnsafe: (...args) => fixture.admin.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE atlas_fixture_analysis_receipt'); return tx.$queryRawUnsafe(...args);
  }) };
  const current = (await connection.repository.load(reviewer.staff, cardId)).card;
  const binding = { ...inputFixture().binding, manualRevision: current.revision, manualContentHash: current.contentHash,
    sourceHash: current.draft.source.sourceHash };
  let stale = false;
  const authorize = async ({ tx, principal, cardId, edit }) => {
    const [row] = await tx.$queryRawUnsafe('SELECT owner_id FROM atlas_manual.card WHERE id=$1::uuid', cardId);
    check(row?.owner_id === principal.id && (!edit || principal.role === 'REVIEWER'), 'DEFECT_ANALYSIS_NOT_FOUND', 404);
  };
  const assertCurrent = async ({ tx, cardId, binding: expected }) => {
    const [row] = await tx.$queryRawUnsafe('SELECT revision,content_hash FROM atlas_manual.card WHERE id=$1::uuid FOR SHARE', cardId);
    check(!stale && row.revision === expected.manualRevision && row.content_hash === expected.manualContentHash,
      'DEFECT_ANALYSIS_STALE', 409);
  };
  const repository = createAnalysisRepository({ boundary: connection.boundary, authorize, assertCurrent, receiptClient });
  const analysisId = randomUUID(), actionId = randomUUID(), requestHash = hash('owned-request');
  const input = { analysisId, cardId, actionId, baseHash: hash('original-body'), binding, requestHash,
    requestRef: artifactRef(cardId, 'DEFECT_REQUEST', hash('request-source')),
    requestEvidence: { version: 1, model: 'gpt-6-astra', knowledgeRevision: `m1:0:${hash('no-memory')}` },
    expiresAt: new Date(Date.now() + 120000).toISOString() };
  const saved = await repository.prepare(reviewer.staff, input);
  assert.equal(saved.actorId, actorId); assert.equal(saved.state, 'PREPARED');
  assert.deepEqual(await repository.prepare(reviewer.staff, input), saved);
  await assert.rejects(repository.prepare(reviewer.staff, { ...input, requestHash: hash('different') }), { code: 'DEFECT_ANALYSIS_ACTION_CONFLICT' });
  await assert.rejects(repository.find({ ...reviewer.staff }, { cardId, analysisId }), { code: 'SIGN_IN_REQUIRED' });
  const unknown = { state: 'UNKNOWN', responseRef: null, resultRef: null, responseHash: null, providerRequestId: null,
    responseId: null, httpStatus: null, usage: null, code: 'DEFECT_ANALYSIS_OUTCOME_UNKNOWN' };
  await assert.rejects(repository.recordReply({ analysisId, requestHash, kind: 'OUTCOME', evidence: unknown }), /Exact dispatched/);
  stale = true; await assert.rejects(repository.claim(reviewer.staff, { cardId, analysisId, requestHash }), { code: 'DEFECT_ANALYSIS_STALE' });
  stale = false;
  const claims = await Promise.all([repository.claim(reviewer.staff, { cardId, analysisId, requestHash }), repository.claim(reviewer.staff, { cardId, analysisId, requestHash })]);
  assert.equal(claims.filter(x => x.claimed).length, 1);
  assert.equal((await repository.claim(reviewer.staff, { cardId, analysisId, requestHash })).claimed, false);
  checks.push('exact action replay; stale source/auth refusals; concurrent claims grant one provider dispatch');

  await repository.recordReply({ analysisId, requestHash, kind: 'OUTCOME', evidence: unknown });
  await repository.recordReply({ analysisId, requestHash, kind: 'OUTCOME', evidence: unknown });
  await assert.rejects(repository.recordReply({ analysisId, requestHash, kind: 'OUTCOME', evidence: { ...unknown, code: 'DIFFERENT' } }), /receipt conflict/);
  assert.equal((await repository.status(reviewer.staff, { cardId, analysisId })).state, 'UNKNOWN');
  const response = { state: 'READY', responseRef: artifactRef(cardId, 'DEFECT_RESPONSE', hash('source')),
    resultRef: artifactRef(cardId, 'DEFECT_RESULT', hash('source')), responseHash: hash('response'), providerRequestId: 'req_fixture',
    responseId: 'resp_fixture', httpStatus: 200, usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30,
      cached_input_tokens: 2, reasoning_output_tokens: 5 }, code: null };
  // No initiating staff handle enters this durable late-receipt capability.
  await repository.recordReply({ analysisId, requestHash, kind: 'RESPONSE', evidence: response });
  await repository.recordReply({ analysisId, requestHash, kind: 'RESPONSE', evidence: response });
  const ready = await repository.latest(reviewer.staff, { cardId });
  assert.equal(ready.state, 'READY'); assert.equal(ready.receipts.length, 2);
  assert.deepEqual((await connection.repository.load(reviewer.staff, cardId)).card, current);
  checks.push('UNKNOWN retains accounting; exact receipt replay and later response preserve history without changing manual card');

  await assert.rejects(connection.manualClient.$executeRawUnsafe('UPDATE atlas_defect_analysis.run SET request_hash=$1 WHERE id=$2::uuid', hash('tamper'), analysisId), /permission denied/);
  await assert.rejects(fixture.admin.$executeRawUnsafe('UPDATE atlas_defect_analysis.run SET request_hash=$1 WHERE id=$2::uuid', hash('tamper'), analysisId), /immutable evidence conflict/);
  await assert.rejects(fixture.admin.$executeRawUnsafe('DELETE FROM atlas_defect_analysis.run WHERE id=$1::uuid', analysisId), /history is retained/);
  await assert.rejects(fixture.admin.$executeRawUnsafe('DELETE FROM atlas_defect_analysis.receipt WHERE analysis_id=$1::uuid', analysisId), /immutable/);
  await assert.rejects(receiptClient.$queryRawUnsafe('SELECT * FROM atlas_manual.card'), /permission denied/);
  await assert.rejects(connection.manualClient.$queryRawUnsafe('SELECT atlas_defect_analysis.append_receipt($1::uuid,$2,$3,$4)', analysisId, requestHash, 'OUTCOME', canonical(unknown)), /permission denied/);
  const stored = (await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_defect_analysis.run WHERE id=$1::uuid', analysisId))[0];
  assert.equal(stored.binding_hash, digest(stored.binding));
  assert(!JSON.stringify(stored).includes('data:image')); assert(!JSON.stringify(stored).includes('base64'));
  checks.push('immutable run/receipt guards and separate serving/receipt privileges; SQL stores compact references only');

  const absentAction = randomUUID(), absentInput = { ...input, analysisId: absentAction, actionId: absentAction };
  const retired = await repository.retireUndispatched(reviewer.staff, { cardId, actionId: absentAction, baseHash: input.baseHash, code: 'DEFECT_ANALYSIS_STALE' });
  assert.equal(retired.retired, true); assert.equal(retired.dispatched, false); assert.deepEqual(retired.receipts, []);
  assert.deepEqual(await repository.retireUndispatched(reviewer.staff, { cardId, actionId: absentAction, baseHash: input.baseHash, code: 'DEFECT_ANALYSIS_STALE' }), retired);
  await assert.rejects(repository.retireUndispatched(reviewer.staff, { cardId, actionId: absentAction, baseHash: hash('new body'), code: 'DEFECT_ANALYSIS_STALE' }), { code: 'DEFECT_ANALYSIS_ACTION_CONFLICT' });
  await assert.rejects(repository.prepare(reviewer.staff, absentInput), { code: 'DEFECT_ANALYSIS_REQUEST_RETIRED' });
  assert.equal((await repository.claim(reviewer.staff, { cardId, analysisId: absentAction, requestHash })).claimed, false);
  await assert.rejects(repository.recordReply({ analysisId: absentAction, requestHash, kind: 'OUTCOME', evidence: unknown }), /Exact dispatched/);

  const preparedAction = randomUUID(); await repository.prepare(reviewer.staff, { ...input, analysisId: preparedAction, actionId: preparedAction });
  const preparedRefusal = await repository.retireUndispatched(reviewer.staff, { cardId, actionId: preparedAction, baseHash: input.baseHash, code: 'DEFECT_ANALYSIS_REQUEST_EXPIRED' });
  assert.equal(preparedRefusal.retired, true);
  const restarted = createAnalysisRepository({ boundary: connection.boundary, authorize, assertCurrent, receiptClient });
  assert.deepEqual(await restarted.find(reviewer.staff, { cardId, analysisId: preparedAction }), preparedRefusal);
  assert.deepEqual(await restarted.status(reviewer.staff, { cardId, analysisId: preparedAction }), preparedRefusal);
  assert.equal((await restarted.latest(reviewer.staff, { cardId })).analysisId, preparedAction);
  assert.equal((await restarted.claim(reviewer.staff, { cardId, analysisId: preparedAction, requestHash })).claimed, false);
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT state FROM atlas_defect_analysis.run WHERE id=$1::uuid', preparedAction))[0].state, 'PREPARED');
  await assert.rejects(fixture.admin.$executeRawUnsafe(`UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=clock_timestamp() WHERE id=$1::uuid`, preparedAction), /retired before dispatch/);
  await assert.rejects(fixture.admin.$executeRawUnsafe('DELETE FROM atlas_defect_analysis.request_refusal WHERE action_id=$1::uuid', preparedAction), /immutable/);
  const notRetired = await restarted.retireUndispatched(reviewer.staff, { cardId, actionId, baseHash: input.baseHash, code: 'DEFECT_ANALYSIS_STALE' });
  assert.equal(notRetired.state, 'DISPATCHED'); assert.equal(notRetired.retired, undefined);
  checks.push('absent and PREPARED refusal survives restart; exact body conflicts fail; existing evidence remains; DISPATCHED work cannot retire');

  const racingAction = randomUUID();
  const race = await Promise.allSettled([
    repository.prepare(reviewer.staff, { ...input, analysisId: racingAction, actionId: racingAction }),
    repository.retireUndispatched(reviewer.staff, { cardId, actionId: racingAction, baseHash: input.baseHash, code: 'DEFECT_ANALYSIS_STALE' }),
  ]);
  assert.equal(race[1].status, 'fulfilled'); if (race[0].status === 'rejected') assert.equal(race[0].reason.code, 'DEFECT_ANALYSIS_REQUEST_RETIRED');
  assert.equal((await restarted.status(reviewer.staff, { cardId, analysisId: racingAction })).retired, true);
  assert.equal((await restarted.claim(reviewer.staff, { cardId, analysisId: racingAction, requestHash })).claimed, false);
  const competingAction = randomUUID(); await repository.prepare(reviewer.staff, { ...input, analysisId: competingAction, actionId: competingAction });
  const [claimed, canceled] = await Promise.all([
    repository.claim(reviewer.staff, { cardId, analysisId: competingAction, requestHash }),
    repository.retireUndispatched(reviewer.staff, { cardId, actionId: competingAction, baseHash: input.baseHash, code: 'DEFECT_ANALYSIS_STALE' }),
  ]);
  assert.equal(claimed.claimed, canceled.retired !== true);
  const final = await restarted.status(reviewer.staff, { cardId, analysisId: competingAction });
  assert.equal(final.retired === true, !claimed.claimed);
  assert.deepEqual((await connection.repository.load(reviewer.staff, cardId)).card, current);
  checks.push('prepare/retire and claim/retire races use one card-first order; no canceled command can later gain dispatch');
  return checks;
}
