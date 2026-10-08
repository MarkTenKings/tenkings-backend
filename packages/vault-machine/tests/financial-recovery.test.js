const test = require('node:test');
const assert = require('node:assert/strict');
const { createRig, makeDoorAvailable, crypto } = require('./helpers');
const { digest } = require('../dist/util');

async function fixture(t) {
  const rig = await createRig(); t.after(() => rig.store.close());
  const state = { notices: [], providerDigest: 'b'.repeat(64), blockers: [], retirements: [], failRetirement: false };
  const oldCaps = await rig.payment.capabilities();
  rig.payment.financialRecoveryEvidence = async () => ({ bindingDigest: 'a'.repeat(64), evidenceDigest: state.providerDigest, blockers: state.blockers });
  rig.payment.pollEvidence = async () => state.notices;
  rig.payment.acknowledgeEvidence = async () => {};
  rig.payment.retireVoidAction = async (actionId, actionDigest, reason) => { state.retirements.push({ actionId, actionDigest, reason }); if (state.failRetirement) throw Error('simulated interruption'); return { actionId, actionDigest, reason, proofDigest: 'c'.repeat(64) }; };
  const notice = (code = 'SPARK_ORPHAN_RECEIPT') => ({ noticeId: 'sha256:' + crypto.randomBytes(32).toString('hex'), saleId: null, provider: 'NAYAX_SPARK', bindingDigest: 'a'.repeat(64), providerSessionId: null, providerTransactionId: null, amountCents: null, currency: 'USD', captureConfirmed: false, code });
  const observe = async code => { const value = notice(code); state.notices.push(value); await rig.machine.paymentOperations.pollEvidence(); return value; };
  const decision = snapshot => ({ decisionId: crypto.randomUUID(), machineId: rig.machineId, snapshotId: snapshot.snapshotId, generation: snapshot.generation, stateDigest: snapshot.stateDigest,
    noticeIds: snapshot.noticeIds, unknownActionIds: snapshot.unknownActionIds, evidenceReference: 'external-case-review-123', evidenceDigest: 'd'.repeat(64), reason: 'Reviewed the exact financial evidence',
    approvedByAdminId: 'human-admin', approvedAt: rig.clock.now().toISOString(), expiresAt: new Date(rig.clock.now().getTime() + 300000).toISOString() });
  const paid = async () => {
    makeDoorAvailable(rig, ['X-01']); rig.machine.selectCartDoor('X-01', 'sports-25', true);
    const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: ['X-01'] })).sale;
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID()); await rig.machine.advancePayments(); rig.machine.markPresentationDone(sale.saleId);
    const row = rig.store.one('SELECT * FROM sale WHERE sale_id=?', sale.saleId);
    const reference = value => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
    const action = { actionId: crypto.randomUUID(), machineId: rig.machineId, saleId: sale.saleId, provider: 'NAYAX_SPARK', paymentBindingDigest: 'a'.repeat(64),
      providerSessionReference: reference(String(row.provider_session_id)), providerTransactionReference: reference(String(row.provider_transaction_id)), amountCents: row.total_cents,
      currency: 'USD', reviewedNoticeIds: [], reason: 'Exact original provider compensation review', approvedByAdminId: 'human-admin',
      approvedAt: rig.clock.now().toISOString(), expiresAt: new Date(rig.clock.now().getTime() + 300000).toISOString() };
    rig.payment.capabilities = async () => ({ ...oldCaps, mode: 'OFFICIAL_TEST', provider: 'NAYAX_SPARK', bindingDigest: 'a'.repeat(64) });
    return action;
  };
  return { ...rig, state, observe, decision, paid, recovery: rig.machine.paymentOperations.recovery };
}

test('exact fresh review resolves only its separate financial hold and preserves all original facts', async t => {
  const f = await fixture(t); const notice = await f.observe();
  assert.equal(f.recovery.held(), true);
  assert.equal(f.store.one('SELECT automation_halted,recovery_required FROM machine_meta').automation_halted, 0);
  assert.ok((await f.machine.readiness()).reasons.includes('FINANCIAL_RECOVERY_REQUIRED'));
  assert.throws(() => f.machine.selectCartDoor('X-01', 'sports-25', true), { code: 'PUBLIC_SESSION_BLOCKED' });
  const doors = f.store.all('SELECT * FROM door'), sales = f.store.all('SELECT * FROM sale');
  const snapshot = await f.recovery.snapshot(); assert.deepEqual(snapshot.blockers, []);
  const decision = f.decision(snapshot); await f.recovery.apply(decision); await f.recovery.apply(decision);
  assert.equal(f.recovery.held(), false); assert.deepEqual(f.store.all('SELECT * FROM door'), doors); assert.deepEqual(f.store.all('SELECT * FROM sale'), sales);
  assert.equal(f.store.one('SELECT notice_id FROM payment_evidence_notice').notice_id, notice.noticeId);
  assert.equal(f.store.one("SELECT count(*) AS n FROM machine_event WHERE type='FINANCIAL_RECOVERY_APPLIED'").n, 1);
  const event = JSON.parse(f.store.one("SELECT payload_json FROM machine_event WHERE type='FINANCIAL_RECOVERY_APPLIED'").payload_json);
  assert.equal(event.source, 'EXTERNAL_HUMAN_REVIEW'); assert.equal(event.verifiedFinancialAdjustmentCents, 0);
  assert.equal(f.state.retirements.length, 0); assert.throws(() => f.store.run('DELETE FROM financial_notice_resolution'), /retained/);
});

test('technical, restore, clock and provider-proof blockers cannot be removed by financial review', async t => {
  for (const blocker of ['technical', 'journal', 'unavailable', 'wrong-binding']) {
    const f = await fixture(t); await f.observe(blocker === 'journal' ? 'SPARK_VOID_INTENT_UNBOUND' : undefined);
    if (blocker === 'technical') f.store.run('UPDATE machine_meta SET automation_halted=1,recovery_required=1');
    if (blocker === 'unavailable') f.state.blockers = ['SPARK_RECEIPT_FEED_UNAVAILABLE'];
    if (blocker === 'wrong-binding') f.payment.financialRecoveryEvidence = async () => ({ bindingDigest: 'f'.repeat(64), evidenceDigest: f.state.providerDigest, blockers: [] });
    const snapshot = await f.recovery.snapshot(); assert.ok(snapshot.blockers.length);
    await assert.rejects(f.recovery.apply(f.decision(snapshot)), { code: 'FINANCIAL_RECOVERY_SNAPSHOT_CHANGED_OR_BLOCKED' });
    assert.equal(f.recovery.held(), true); assert.equal(f.store.one('SELECT count(*) AS n FROM financial_notice_resolution').n, 0);
    if (blocker === 'technical') assert.deepEqual({ ...f.store.one('SELECT automation_halted,recovery_required FROM machine_meta') }, { automation_halted: 1, recovery_required: 1 });
  }
});

test('new receipts, changed provider facts, incomplete review and expired authority reject a stale decision', async t => {
  for (const change of ['notice', 'provider', 'partial', 'expired']) {
    const f = await fixture(t); await f.observe(); const snapshot = await f.recovery.snapshot(), decision = f.decision(snapshot);
    if (change === 'notice') await f.observe();
    if (change === 'provider') f.state.providerDigest = 'e'.repeat(64);
    if (change === 'partial') decision.noticeIds = [];
    if (change === 'expired') f.clock.advance(300001);
    await assert.rejects(f.recovery.apply(decision)); assert.equal(f.recovery.held(), true);
    assert.equal(f.store.one('SELECT count(*) AS n FROM financial_notice_resolution').n, 0);
  }
});

test('expired approval retires only with main and provider no-intent proof; replay never executes it', async t => {
  const f = await fixture(t), action = await f.paid(); f.clock.advance(300001);
  await f.recovery.retireExpired(action); await f.recovery.retireExpired(action);
  assert.equal(f.state.retirements.length, 1); assert.equal(f.state.retirements[0].reason, 'EXPIRED_UNSTARTED');
  assert.equal(f.store.one('SELECT count(*) AS n FROM payment_void').n, 0);
  const event = JSON.parse(f.store.one("SELECT payload_json FROM machine_event WHERE type='PAYMENT_VOID_RETIRED_UNSTARTED'").payload_json);
  assert.equal(event.providerTransportAbsent, true); assert.equal(event.actionDigest, digest(action));
  f.payment.voidPaidTransaction = async () => { throw Error('provider transport must not be called'); };
  await assert.rejects(f.machine.paymentOperations.executeApprovedVoid(action), { code: 'PAYMENT_VOID_RETIRED_OR_REVIEWING' });
});

test('UNKNOWN review keeps identity and monetary state, blocks replay, and resumes exact local intent after interruption', async t => {
  const f = await fixture(t), action = await f.paid();
  f.store.run("INSERT INTO payment_void VALUES(?,?,?,?,?,'UNKNOWN',NULL,?,?)", action.actionId, action.saleId, digest(action), JSON.stringify(action), '{}', f.clock.now().toISOString(), f.clock.now().toISOString());
  const snapshot = await f.recovery.snapshot(); assert.deepEqual(snapshot.unknownActionIds, [action.actionId]); assert.deepEqual(snapshot.blockers, []);
  const decision = f.decision(snapshot); const original = f.store.all('SELECT * FROM sale'), doors = f.store.all('SELECT * FROM door');
  f.state.failRetirement = true; await assert.rejects(f.recovery.apply(decision));
  assert.equal(f.store.one('SELECT state FROM financial_recovery_decision').state, 'INTENT'); assert.equal(f.recovery.held(), true);
  await assert.rejects(f.recovery.apply({ ...decision, decisionId: crypto.randomUUID() }), { code: 'FINANCIAL_RECOVERY_OTHER_DECISION_ACTIVE' });
  f.state.failRetirement = false; f.clock.advance(300001); await f.recovery.resumeIntents();
  assert.equal(f.store.one('SELECT state FROM payment_void').state, 'UNKNOWN'); assert.equal(f.store.one('SELECT action_id FROM payment_void_external_review').action_id, action.actionId);
  assert.equal(f.recovery.held(), false); assert.deepEqual(f.store.all('SELECT * FROM sale'), original); assert.deepEqual(f.store.all('SELECT * FROM door'), doors);
  f.payment.voidPaidTransaction = async () => { throw Error('must never transport reviewed action'); };
  await assert.rejects(f.machine.paymentOperations.executeApprovedVoid(action), { code: 'PAYMENT_VOID_RETIRED_OR_REVIEWING' });
  await assert.rejects(f.recovery.retireExpired(action), { code: 'FINANCIAL_RECOVERY_RETIREMENT_INTENT_PRESENT' });
});

test('restored state and incomplete provider evidence cannot certify an expired approval as unstarted', async t => {
  for (const blocker of ['restore', 'provider']) {
    const f = await fixture(t), action = await f.paid(); f.clock.advance(300001);
    if (blocker === 'restore') f.store.run('UPDATE machine_meta SET automation_halted=1,recovery_required=1');
    else f.state.blockers = ['SPARK_VOID_RECOVERY_BLOCKED'];
    await assert.rejects(f.recovery.retireExpired(action), { code: 'FINANCIAL_RECOVERY_RETIREMENT_RECOVERY_BLOCKED' });
    assert.equal(f.state.retirements.length, 0); assert.equal(f.store.one('SELECT count(*) AS n FROM payment_void_retirement').n, 0);
  }
});

test('authority that expires while refreshing evidence cannot start a local review intent', async t => {
  const f = await fixture(t); await f.observe(); const snapshot = await f.recovery.snapshot(), decision = f.decision(snapshot);
  const original = f.payment.financialRecoveryEvidence;
  f.payment.financialRecoveryEvidence = async () => { f.clock.advance(300001); return original(); };
  await assert.rejects(f.recovery.apply(decision), { code: 'FINANCIAL_RECOVERY_APPROVAL_EXPIRED' });
  assert.equal(f.store.one('SELECT count(*) AS n FROM financial_recovery_decision').n, 0); assert.equal(f.recovery.held(), true);
});

test('new evidence after a durable provider tombstone supersedes stale approval and permits exact fresh review', async t => {
  const f = await fixture(t), action = await f.paid();
  f.store.run("INSERT INTO payment_void VALUES(?,?,?,?,?,'UNKNOWN',NULL,?,?)", action.actionId, action.saleId, digest(action), JSON.stringify(action), '{}', f.clock.now().toISOString(), f.clock.now().toISOString());
  const snapshot = await f.recovery.snapshot(), decision = f.decision(snapshot);
  const retire = f.payment.retireVoidAction;
  f.payment.retireVoidAction = async (...args) => { const proof = await retire(...args); throw Error('crash after durable provider tombstone'); };
  await assert.rejects(f.recovery.apply(decision));
  assert.equal(f.store.one('SELECT state FROM financial_recovery_decision').state, 'INTENT');
  f.payment.retireVoidAction = retire; await f.observe();
  await assert.rejects(f.recovery.resumeIntents(), { code: 'FINANCIAL_RECOVERY_SNAPSHOT_CHANGED_OR_BLOCKED' });
  assert.equal(f.store.one('SELECT state FROM financial_recovery_decision').state, 'SUPERSEDED');
  assert.equal(f.recovery.held(), true); assert.equal(f.store.one('SELECT count(*) AS n FROM payment_void_external_review').n, 0);
  const priorCalls = f.state.retirements.length; await f.recovery.apply(decision); assert.equal(f.state.retirements.length, priorCalls);
  const current = await f.recovery.snapshot(); assert.ok(current.generation > snapshot.generation);
  await f.recovery.apply(f.decision(current)); assert.equal(f.recovery.held(), false);
  assert.equal(f.store.one('SELECT state FROM payment_void').state, 'UNKNOWN');
  assert.equal(f.store.one("SELECT count(*) AS n FROM machine_event WHERE type='FINANCIAL_RECOVERY_SUPERSEDED'").n, 1);
  assert.throws(() => f.store.run("UPDATE financial_recovery_decision SET state='INTENT' WHERE decision_id=?", decision.decisionId), /immutable/);
});
