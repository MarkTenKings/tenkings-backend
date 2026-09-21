import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '../src/contract.mjs';
import { artifactRef, contextInputFixture, hash } from '../test/fixtures.mjs';
import { buildAstraContextBackgroundDefectRequest, restorePreparedRequest, validateRequestEvidence, INSPECTION_CONTEXT_CROP_LAYOUT } from '../src/index.mjs';

// Called only inside the existing owned native PostgreSQL fixture; all rows and
// provider responses are synthetic. No credentials, live URL or inference.
export async function runBackgroundFixtureChecks({ fixture, connection, reviewer, cardId, repository, input, receiptClient }) {
  const checks = [], binding = hash('owned exact provider binding');
  const unknown = { state: 'UNKNOWN', responseRef: null, resultRef: null, responseHash: null, providerRequestId: null,
    responseId: null, httpStatus: null, usage: null, code: 'DEFECT_ANALYSIS_OUTCOME_UNKNOWN' };
  const fresh = (extra = {}) => { const id = randomUUID(); return { ...input, analysisId: id, actionId: id,
    requestHash: hash(id), baseHash: hash(`body:${id}`), expiresAt: new Date(Date.now() + 180000).toISOString(),
    requestEvidence: { version: 'atlas-astra-defect-analysis-v2', model: 'gpt-6-astra', providerBindingHash: binding }, ...extra }; };
  const acceptance = (run, extra = {}) => { const received = Date.now(); return { analysisId: run.analysisId, requestHash: run.requestHash, providerBindingHash: binding,
    evidence: { responseId: `resp_${run.analysisId.replaceAll('-', '')}`, providerRequestId: 'req_owned_fixture', httpStatus: 200,
      providerStatus: 'queued', model: 'gpt-6-astra', responseHash: hash(`ack:${run.analysisId}`),
      receivedAt: new Date(received).toISOString(), pollUntil: new Date(received + 1800000).toISOString(), ...extra } }; };
  const terminal = (run, id) => ({ analysisId: run.analysisId, requestHash: run.requestHash, kind: 'RESPONSE', evidence: {
    state: 'REFUSED', responseRef: artifactRef(cardId, 'DEFECT_RESPONSE', hash('owned-source')), resultRef: null,
    responseHash: hash(`terminal:${run.analysisId}`), responseId: id, providerRequestId: 'req_terminal_fixture', httpStatus: 200,
    usage: null, code: 'DEFECT_ANALYSIS_PROVIDER_INCOMPLETE' } });
  const originalCard = (await connection.repository.load(reviewer.staff, cardId)).card;
  const first = fresh(); await repository.prepare(reviewer.staff, first);
  await assert.rejects(repository.appendAcceptance(acceptance(first)), /Exact dispatched background/);
  await repository.claim(reviewer.staff, { cardId, analysisId: first.analysisId, requestHash: first.requestHash });
  const ack = acceptance(first);
  await assert.rejects(repository.appendAcceptance({ ...ack, providerBindingHash: hash('wrong provider') }), /Invalid exact background/);
  await assert.rejects(repository.appendAcceptance({ ...ack, requestHash: hash('wrong request') }), /Exact dispatched/);
  await repository.appendAcceptance(ack); await repository.appendAcceptance(ack);
  await assert.rejects(repository.appendAcceptance({ ...ack, evidence: { ...ack.evidence, responseId: 'resp_different' } }), /Background event conflict/);
  assert.deepEqual((await repository.findAccepted({ analysisId: first.analysisId, providerBindingHash: binding })).acceptance, ack.evidence);
  assert.equal(await repository.findAccepted({ analysisId: first.analysisId, providerBindingHash: hash('other binding') }), null);
  const pending = await repository.listAcceptedPending({ providerBindingHash: binding, limit: 1 });
  assert.deepEqual(pending.items.map(value => value.run.analysisId), [first.analysisId]); assert.equal(pending.nextCursor, null);
  assert.equal((await repository.status(reviewer.staff, { cardId, analysisId: first.analysisId })).backgroundAccepted, true);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 240000;
    assert.equal((await repository.status(reviewer.staff, { cardId, analysisId: first.analysisId })).state, 'DISPATCHED');
  } finally { Date.now = realNow; }
  await assert.rejects(repository.prepare(reviewer.staff, fresh()), { code: 'DEFECT_ANALYSIS_PENDING' });
  const blockedAction = randomUUID();
  await repository.retireUndispatched(reviewer.staff, { cardId, actionId: blockedAction, baseHash: hash('blocked'), code: 'DEFECT_ANALYSIS_PENDING' });
  assert.equal((await repository.latest(reviewer.staff, { cardId })).analysisId, first.analysisId);
  assert.equal((await repository.status(reviewer.staff, { cardId, analysisId: blockedAction })).state, 'REFUSED');
  checks.push('ACK persists without artifact or human session; exact binding/replay and active-run anti-bypass remain durable');

  await repository.recordReply({ analysisId: first.analysisId, requestHash: first.requestHash, kind: 'OUTCOME', evidence: unknown });
  assert.equal((await repository.status(reviewer.staff, { cardId, analysisId: first.analysisId })).state, 'DISPATCHED');
  assert.equal(await repository.replacementEligibility(reviewer.staff, { cardId, analysisId: first.analysisId }), null);
  const ref = artifactRef(cardId, 'DEFECT_ACCEPTANCE', hash('owned-source'));
  await repository.appendAcceptanceArtifact({ analysisId: first.analysisId, requestHash: first.requestHash,
    responseId: ack.evidence.responseId, responseRef: ref, responseHash: ack.evidence.responseHash });
  await assert.rejects(repository.appendAcceptanceArtifact({ analysisId: first.analysisId, requestHash: first.requestHash,
    responseId: ack.evidence.responseId, responseRef: ref, responseHash: hash('different raw ACK') }), /Exact retained background/);
  await assert.rejects(repository.recordReply(terminal(first, 'resp_wrong_run')), /Terminal response differs/);
  await repository.recordReply(terminal(first, ack.evidence.responseId));
  assert.equal((await repository.latest(reviewer.staff, { cardId })).analysisId, first.analysisId);
  assert.equal(await repository.findAccepted({ analysisId: first.analysisId, providerBindingHash: binding }), null);
  assert.equal((await repository.listAcceptedPending({ providerBindingHash: binding })).items.length, 0);
  await assert.rejects(connection.manualClient.$executeRawUnsafe('DELETE FROM atlas_defect_analysis.provider_event WHERE analysis_id=$1::uuid', first.analysisId), /permission denied/);
  await assert.rejects(fixture.admin.$executeRawUnsafe("UPDATE atlas_defect_analysis.provider_event SET response_id='resp_tamper' WHERE analysis_id=$1::uuid", first.analysisId), /immutable/);
  await assert.rejects(receiptClient.$queryRawUnsafe('SELECT * FROM atlas_defect_analysis.run'), /permission denied/);
  await assert.rejects(receiptClient.$queryRawUnsafe("INSERT INTO atlas_defect_analysis.provider_event DEFAULT VALUES"), /permission denied/);
  checks.push('immutable ACK artifact and terminal ID binding; accounting-only capability cannot inspect arbitrary runs or edit events');

  // Exercise the exact complete new evidence through unchanged migration42 and
  // the same restricted SQL capabilities, retaining the legacy cases above.
  const contextInput = contextInputFixture();
  contextInput.analysisId = randomUUID(); contextInput.cardId = cardId; contextInput.binding = input.binding;
  const contextPrepared = buildAstraContextBackgroundDefectRequest(contextInput);
  const contextRun = fresh({ analysisId: contextInput.analysisId, actionId: contextInput.analysisId,
    requestHash: contextPrepared.requestHash, requestEvidence: { ...contextPrepared.evidence, providerBindingHash: binding } });
  await repository.prepare(reviewer.staff, contextRun);
  const contextSaved = await repository.find(reviewer.staff, { cardId, analysisId: contextRun.analysisId });
  assert.deepEqual(validateRequestEvidence(contextSaved.requestEvidence), contextRun.requestEvidence);
  assert.equal(contextSaved.requestEvidence.cropLayoutVersion, INSPECTION_CONTEXT_CROP_LAYOUT);
  const { providerBindingHash: _provider, ...retainedEvidence } = contextSaved.requestEvidence;
  assert.equal(restorePreparedRequest({ ...contextPrepared, evidence: retainedEvidence,
    evidenceHash: digest(canonical(retainedEvidence)) }).requestText, contextPrepared.requestText);
  const { cropLayoutVersion: _layout, ...strippedEvidence } = contextSaved.requestEvidence;
  await assert.rejects(fixture.admin.$executeRawUnsafe(`UPDATE atlas_defect_analysis.run
    SET request_evidence=$2,evidence_hash=$3,state='DISPATCHED',dispatched_at=clock_timestamp() WHERE id=$1::uuid`,
  contextRun.analysisId, canonical(strippedEvidence), digest(canonical(strippedEvidence))), /immutable evidence/);
  await repository.claim(reviewer.staff, { cardId, analysisId: contextRun.analysisId, requestHash: contextRun.requestHash });
  const contextAck = acceptance(contextRun); await repository.appendAcceptance(contextAck);
  const contextPending = await repository.findAccepted({ analysisId: contextRun.analysisId, providerBindingHash: binding });
  assert.deepEqual(contextPending.run.requestEvidence, contextSaved.requestEvidence);
  assert.deepEqual(contextPending.acceptance, contextAck.evidence);
  assert.deepEqual((await repository.listAcceptedPending({ providerBindingHash: binding })).items.map(x => x.run.analysisId), [contextRun.analysisId]);
  await repository.recordReply(terminal(contextRun, contextAck.evidence.responseId));
  assert.equal(await repository.findAccepted({ analysisId: contextRun.analysisId, providerBindingHash: binding }), null);
  assert.deepEqual((await connection.repository.load(reviewer.staff, cardId)).card, originalCard);
  checks.push('complete context-layout V2 evidence restores exactly, remains immutable and gains background custody under unchanged migration42');

  const expires = fresh(); await repository.prepare(reviewer.staff, expires);
  await repository.claim(reviewer.staff, { cardId, analysisId: expires.analysisId, requestHash: expires.requestHash });
  const shortAck = acceptance(expires); shortAck.evidence.pollUntil = new Date(Date.parse(shortAck.evidence.receivedAt) + 1).toISOString();
  await repository.appendAcceptance(shortAck);
  assert.deepEqual((await repository.listAcceptedPending({ providerBindingHash: binding, now: new Date(Date.now() + 1000) })).items.map(x => x.run.analysisId), [expires.analysisId]);
  await repository.recordReply({ analysisId: expires.analysisId, requestHash: expires.requestHash, kind: 'OUTCOME', evidence: {
    ...unknown, responseId: shortAck.evidence.responseId, code: 'DEFECT_ANALYSIS_POLL_WINDOW_EXHAUSTED' } });
  assert.equal((await repository.listAcceptedPending({ providerBindingHash: binding, now: new Date(Date.now() + 1000) })).items.length, 0);
  assert.equal((await repository.status(reviewer.staff, { cardId, analysisId: expires.analysisId })).state, 'UNKNOWN');
  assert.equal(await repository.replacementEligibility(reviewer.staff, { cardId, analysisId: expires.analysisId }), null);
  // A delayed provider terminal receipt can still be retained after the local
  // polling budget; it never borrows staff authority to adopt findings.
  await repository.recordReply(terminal(expires, shortAck.evidence.responseId));
  checks.push('polling exhaustion is UNKNOWN without cancellation claims; known IDs never enable replacement and late results remain retainable');

  const parent = fresh({ requestEvidence: { version: 'atlas-astra-defect-analysis-v1', model: 'gpt-6-astra' } });
  await repository.prepare(reviewer.staff, parent);
  await repository.claim(reviewer.staff, { cardId, analysisId: parent.analysisId, requestHash: parent.requestHash });
  await repository.recordReply({ analysisId: parent.analysisId, requestHash: parent.requestHash, kind: 'OUTCOME', evidence: unknown });
  const before = await fixture.admin.$queryRawUnsafe('SELECT to_jsonb(r) AS value FROM atlas_defect_analysis.run r WHERE id=$1::uuid', parent.analysisId);
  const beforeReceipt = await fixture.admin.$queryRawUnsafe('SELECT to_jsonb(r) AS value FROM atlas_defect_analysis.receipt r WHERE analysis_id=$1::uuid', parent.analysisId);
  const replacement = { analysisId: parent.analysisId, outcomeHash: digest(canonical(unknown)) };
  assert.deepEqual(await repository.replacementEligibility(reviewer.staff, { cardId, analysisId: parent.analysisId }), replacement);
  await assert.rejects(repository.prepare(reviewer.staff, fresh()), { code: 'DEFECT_ANALYSIS_PENDING' });
  await assert.rejects(repository.prepare(reviewer.staff, fresh({ replacement: { ...replacement, outcomeHash: hash('wrong proof') } })), { code: 'DEFECT_ANALYSIS_REPLACEMENT_INVALID' });
  const candidates = [fresh({ replacement }), fresh({ replacement })];
  const race = await Promise.allSettled(candidates.map(value => repository.prepare(reviewer.staff, value)));
  assert.equal(race.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(race.find(value => value.status === 'rejected').reason.code, 'DEFECT_ANALYSIS_REPLACEMENT_INVALID');
  const winner = candidates[race.findIndex(value => value.status === 'fulfilled')];
  assert.deepEqual(await repository.prepare(reviewer.staff, winner), race.find(value => value.status === 'fulfilled').value);
  assert.equal(await repository.replacementEligibility(reviewer.staff, { cardId, analysisId: parent.analysisId }), null);
  await assert.rejects(fixture.admin.$executeRawUnsafe(`UPDATE atlas_defect_analysis.run SET replaces_outcome_hash=$2,state='DISPATCHED',dispatched_at=clock_timestamp() WHERE id=$1::uuid`, winner.analysisId, hash('changed proof')), /replacement outcome|immutable evidence/);
  await repository.claim(reviewer.staff, { cardId, analysisId: winner.analysisId, requestHash: winner.requestHash });
  await repository.recordReply(terminal(winner, 'resp_owned_replacement_terminal'));
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT to_jsonb(r) AS value FROM atlas_defect_analysis.run r WHERE id=$1::uuid', parent.analysisId), before);
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT to_jsonb(r) AS value FROM atlas_defect_analysis.receipt r WHERE analysis_id=$1::uuid', parent.analysisId), beforeReceipt);
  assert.deepEqual((await connection.repository.load(reviewer.staff, cardId)).card, originalCard);
  checks.push('explicit no-ID replacement has one child under concurrent new actions, exact action replay, immutable original uncertainty and untouched manual card');

  async function otherOwnedCard() {
    const id = randomUUID();
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id)
      SELECT $1::uuid,revision,content,content_hash,owner_id FROM atlas_manual.card WHERE id=$2::uuid`, id, cardId);
    return id;
  }
  const known = fresh({ cardId: await otherOwnedCard() }); await repository.prepare(reviewer.staff, known);
  await repository.claim(reviewer.staff, { cardId: known.cardId, analysisId: known.analysisId, requestHash: known.requestHash });
  await repository.recordReply({ analysisId: known.analysisId, requestHash: known.requestHash, kind: 'OUTCOME', evidence: {
    ...unknown, responseId: 'resp_observed_before_database_failure', responseHash: hash('received but acceptance not durable') } });
  assert.equal(await repository.replacementEligibility(reviewer.staff, { cardId: known.cardId, analysisId: known.analysisId }), null);
  await assert.rejects(repository.prepare(reviewer.staff, fresh({ cardId: known.cardId, replacement: {
    analysisId: known.analysisId, outcomeHash: digest(canonical({ ...unknown, responseId: 'resp_observed_before_database_failure',
      responseHash: hash('received but acceptance not durable') })) } })), { code: 'DEFECT_ANALYSIS_REPLACEMENT_INVALID' });
  assert.equal(await repository.findAccepted({ analysisId: known.analysisId, providerBindingHash: binding }), null);
  checks.push('observed response ID without accepted transaction remains unknown and cannot authorize paid replacement');

  const pages = [];
  for (let i = 0; i < 3; i++) {
    const value = fresh({ cardId: await otherOwnedCard() }); await repository.prepare(reviewer.staff, value);
    await repository.claim(reviewer.staff, { cardId: value.cardId, analysisId: value.analysisId, requestHash: value.requestHash });
    await repository.appendAcceptance(acceptance(value)); pages.push(value.analysisId);
  }
  const firstPage = await repository.listAcceptedPending({ providerBindingHash: binding, limit: 2 });
  assert.equal(firstPage.items.length, 2); assert(firstPage.nextCursor);
  const nextPage = await repository.listAcceptedPending({ providerBindingHash: binding, limit: 2, cursor: firstPage.nextCursor });
  assert.equal(nextPage.items.length, 1); assert.equal(nextPage.nextCursor, null);
  assert.deepEqual([...firstPage.items, ...nextPage.items].map(value => value.run.analysisId), pages);
  assert.equal((await repository.listAcceptedPending({ providerBindingHash: hash('other provider'), limit: 2 })).items.length, 0);
  await assert.rejects(repository.listAcceptedPending({ providerBindingHash: binding, limit: 11 }));
  checks.push('bounded keyset pages preserve PostgreSQL timestamp precision, provider isolation and independent cards without new claims');
  return checks;
}
