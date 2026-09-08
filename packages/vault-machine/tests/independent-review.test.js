const test = require('node:test');
const assert = require('node:assert/strict');
const { createRig, makeDoorAvailable, grant, makeConfig, crypto } = require('./helpers');

async function reserve(rig, door = 'X-01') {
  rig.machine.selectCartDoor(door, 'sports-25', true);
  return (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'PRODUCTION', configVersion: 1, doorIds: [door] })).sale;
}

test('concurrent checkouts recheck active authority and cart cannot mutate after reservation', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig, ['X-01', 'K-01']);
    for (const door of ['X-01', 'K-01']) rig.machine.selectCartDoor(door, 'sports-25', true);
    const results = await Promise.allSettled(['X-01', 'K-01'].map(door => rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'PRODUCTION', configVersion: 1, doorIds: [door] })));
    assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.sale).length, 1);
    assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM sale').count, 1);
    assert.throws(() => rig.machine.selectCartDoor('K-01', 'sports-25', true), /existing transaction/i);
  } finally { rig.store.close(); }
});

test('in-flight dispatch cannot be acknowledged by Done, staff entry, or a restock observation', async () => {
  const rig = await createRig(); let release;
  try {
    makeDoorAvailable(rig); const sale = await reserve(rig);
    const send = rig.controller.sendOpenCommand.bind(rig.controller);
    rig.controller.sendOpenCommand = async command => { await new Promise(resolve => { release = resolve; }); return send(command); };
    const payment = rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rig.machine.publicSale(sale.saleId).retryAvailable, false);
    assert.throws(() => rig.machine.markPresentationDone(sale.saleId), /cannot be cleared/i);
    assert.throws(() => grant(rig, 'ADMIN'), /active transaction/i);
    release(); release = null; await payment;
    assert.equal(rig.machine.publicSale(sale.saleId).retryAvailable, true);
  } finally { if (release) release(); rig.store.close(); }
});

test('grant revocation and inactivity lock the active service session when state is read', async () => {
  const rig = await createRig();
  try {
    const session = grant(rig, 'ADMIN');
    rig.store.run('UPDATE staff_grant SET revoked_at=?', rig.clock.now().toISOString());
    assert.equal((await rig.machine.publicState()).activeStaff.locked, true);
    assert.throws(() => rig.machine.staff.requireSession(session.sessionId, 'CERTIFICATION_COLLECT'), /locked or expired/i);
    const next = grant(rig, 'TECHNICIAN', '654321', 'second-tech');
    rig.clock.advance(120_001);
    assert.equal((await rig.machine.publicState()).activeStaff.locked, true);
    assert.throws(() => rig.machine.staff.requireSession(next.sessionId), /locked or expired/i);
  } finally { rig.store.close(); }
});

test('grant versions reject replayed content and cannot un-revoke prior authority', async () => {
  const rig = await createRig();
  try {
    const input = { grantId: crypto.randomUUID(), userId: 'operator', machineId: rig.machineId, role: 'ADMIN', verifierVersion: 1, grantVersion: 1, verifier: rig.vault.createScryptPinVerifier('123456'), hashAlgorithm: 'scrypt', hashParameters: { N: 16384, r: 8, p: 1 }, validFrom: '2026-08-16T00:00:00.000Z', expiresAt: '2027-08-16T00:00:00.000Z', revokedAt: null };
    rig.machine.staff.importGrant(input); rig.machine.staff.importGrant(input);
    assert.throws(() => rig.machine.staff.importGrant({ ...input, role: 'RESTOCKER' }), /different content/i);
    rig.machine.staff.importGrant({ ...input, grantVersion: 2, revokedAt: rig.clock.now().toISOString() });
    assert.throws(() => rig.machine.staff.importGrant(input), /cannot regress/i);
  } finally { rig.store.close(); }
});

test('clock rollback and storage pressure block checkout but preserve a paid local retry', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); const sale = await reserve(rig); await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    rig.clock.value = new Date(rig.clock.value.getTime() - 86_400_000);
    rig.store.storageStatus = () => ({ ready: false, availableBytes: 0 });
    const readiness = await rig.machine.readiness();
    assert.ok(readiness.reasons.includes('CLOCK_UNSAFE')); assert.ok(readiness.reasons.includes('STORAGE_PRESSURE'));
    await rig.machine.openPaidDoorsAgain(sale.saleId, crypto.randomUUID());
    assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM command_intent WHERE sale_id=?', sale.saleId).count, 2);
  } finally { rig.store.close(); }
});

test('cart pins configuration and expired pending config cannot activate later', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); rig.machine.selectCartDoor('X-01', 'sports-25', true);
    rig.machine.stageConfig(makeConfig(rig.machineId, 2, rig.keyPair.privateKey, 'test-config-key', { expiresAt: '2026-08-16T12:00:01.000Z' }));
    assert.deepEqual(rig.machine.activatePendingConfig().reasons, ['ACTIVE_CART']);
    rig.machine.selectCartDoor('X-01', 'sports-25', false); rig.clock.advance(1001);
    assert.throws(() => rig.machine.activatePendingConfig(), /expired/i);
  } finally { rig.store.close(); }
});

test('mock customer mode is server-derived and payment progresses vend intent to mock settlement', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); const sale = await reserve(rig);
    assert.equal(sale.mode, 'CERTIFICATION'); assert.equal((await rig.machine.publicState()).adapterMode, 'MOCK');
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    await Promise.all([rig.machine.advancePayments(), rig.machine.advancePayments()]);
    assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'SETTLED');
    assert.equal(rig.store.one("SELECT COUNT(*) AS count FROM machine_event WHERE type='VEND_RESULT_INTENT_RECORDED'").count, 1);
    assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM command_intent').count, 1);
  } finally { rig.store.close(); }
});

test('cancelled or settled payment cannot regress through a later callback', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); const sale = await reserve(rig); await rig.machine.startPayment(sale.saleId, crypto.randomUUID()); await rig.machine.advancePayments();
    const row = rig.store.one('SELECT * FROM sale WHERE sale_id=?', sale.saleId);
    const result = await rig.machine.handleProviderCallback({ callbackId: 'late-regression', saleId: sale.saleId, providerSessionId: row.provider_session_id, sequence: row.provider_sequence + 1, state: 'REQUESTED', occurredAt: rig.clock.now().toISOString(), evidence: {} });
    assert.equal(result.disposition, 'STATE_CONFLICT'); assert.equal(result.sale.paymentState, 'SETTLED');
  } finally { rig.store.close(); }
});

test('pre-payment cancellation releases exact reservations without invoking provider', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); const sale = await reserve(rig);
    const key = crypto.randomUUID(); await rig.machine.cancelPayment(sale.saleId, key); await rig.machine.cancelPayment(sale.saleId, key);
    assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'CANCELLED');
    assert.equal(rig.store.one("SELECT state FROM door WHERE door_id='X-01'").state, 'AVAILABLE');
    assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM command_intent').count, 0);
  } finally { rig.store.close(); }
});

test('persisted sale snapshots and audit facts cannot be rewritten', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); const sale = await reserve(rig);
    assert.throws(() => rig.store.run('UPDATE sale SET total_cents=1 WHERE sale_id=?', sale.saleId), /immutable/i);
    assert.throws(() => rig.store.run("UPDATE config_snapshot SET payload_json='{}'"), /immutable/i);
    assert.throws(() => rig.store.run('DELETE FROM machine_event'), /append-only/i);
    assert.throws(() => rig.store.run('DELETE FROM sale_item'), /immutable/i);
    assert.throws(() => rig.store.run('DELETE FROM config_snapshot'), /immutable/i);
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    assert.throws(() => rig.store.run("UPDATE command_intent SET door_id='K-01'"), /immutable/i);
    assert.throws(() => rig.store.run('DELETE FROM command_intent'), /immutable/i);
  } finally { rig.store.close(); }
});

test('certification purchase and restock use canonical business paths and restore only mock inventory', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig, ['S-25']);
    const inventoryBefore = rig.store.all('SELECT door_id,state,product_id,owning_sale_id,owning_restock_id FROM door ORDER BY door_id');
    let actor = grant(rig, 'TECHNICIAN');
    const cert = await rig.operations.startCertification(actor.sessionId);
    const observe = () => {
      const command = rig.store.one('SELECT ci.* FROM command_intent ci LEFT JOIN certification_evidence ce ON ce.command_id=ci.command_id WHERE ci.certification_session_id=? AND ce.command_id IS NULL ORDER BY ci.created_at LIMIT 1', cert.sessionId);
      const evidence = { evidenceId: crypto.randomUUID(), sessionId: cert.sessionId, doorId: command.door_id, evidenceClass: 'AUTOMATED', outcome: 'PASS', expectedDoorIds: [command.door_id], observedDoorIds: [command.door_id], notes: 'Reviewed deterministic simulator outcome', artifactDigest: 'b'.repeat(64), observedAt: rig.clock.now().toISOString() };
      assert.throws(() => rig.operations.recordCertificationEvidence(actor.sessionId, { ...evidence, evidenceClass: 'FULL_MACHINE' }), /cannot produce physical/i);
      rig.operations.recordCertificationEvidence(actor.sessionId, evidence);
      return command;
    };
    observe();
    const purchase = await rig.operations.startCertificationCycle(actor.sessionId, cert.sessionId, 'PURCHASE');
    assert.equal(rig.machine.publicSale(purchase.saleId).paymentState, 'SETTLED');
    assert.equal((await rig.machine.publicState()).activeCertification.nextUnderTestedDoorId, purchase.doorId);
    const purchaseCommand = observe(); assert.equal(purchaseCommand.authority, 'PAID_SALE');
    const restock = await rig.operations.startCertificationCycle(actor.sessionId, cert.sessionId, 'RESTOCK');
    rig.machine.staff.lock(actor.sessionId);
    const restocker = grant(rig, 'RESTOCKER', '654321', 'restocker-cannot-certify');
    await assert.rejects(() => rig.operations.startOrResumeRestock(restocker.sessionId), /does not permit/);
    actor = grant(rig, 'TECHNICIAN', '234567', 'new-certification-shift');
    await rig.operations.startOrResumeRestock(actor.sessionId);
    assert.equal(rig.store.one('SELECT actor_session_id FROM certification_session WHERE session_id=?', cert.sessionId).actor_session_id, actor.sessionId);
    assert.equal((await rig.machine.publicState()).activeCertification.nextUnderTestedDoorId, restock.doorId);
    const restockCommand = observe(); assert.equal(restockCommand.authority, 'RESTOCK');
    rig.operations.recordRestockOutcome(actor.sessionId, restock.restockSessionId, restock.doorId, 'FILLED', 'Simulated product loaded');
    rig.operations.finalizeRestock(actor.sessionId, restock.restockSessionId, true);
    rig.operations.submitCertification(actor.sessionId, cert.sessionId, true);
    assert.deepEqual(rig.store.all('SELECT door_id,state,product_id,owning_sale_id,owning_restock_id FROM door ORDER BY door_id'), inventoryBefore);
    const facts = rig.store.all("SELECT payload_json FROM machine_event WHERE type='CERTIFICATION_EVIDENCE_RECORDED'").map(row => JSON.parse(row.payload_json));
    assert.deepEqual(facts.map(row => row.cycleType), ['DIAGNOSTIC', 'PURCHASE', 'RESTOCK']);
    assert.equal(facts[1].saleId, purchase.saleId); assert.equal(facts[2].restockSessionId, restock.restockSessionId);
  } finally { rig.store.close(); }
});

test('concurrent exact checkout retries return one durable sale rather than conflict', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); rig.machine.selectCartDoor('X-01', 'sports-25', true);
    const request = { idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: ['X-01'] };
    const results = await Promise.all([rig.machine.checkout(request), rig.machine.checkout(request)]);
    assert.equal(results[0].sale.saleId, results[1].sale.saleId);
    assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM sale').count, 1);
  } finally { rig.store.close(); }
});

test('Technician shift recovery preserves the restock plan and never repeats an observed command', async () => {
  const rig = await createRig();
  try {
    const first = grant(rig, 'RESTOCKER', '123456', 'first-restocker');
    const restock = await rig.operations.startOrResumeRestock(first.sessionId, ['X-01', 'K-01']);
    rig.operations.recordRestockOutcome(first.sessionId, restock.sessionId, 'X-01', 'FILLED', 'First shift observation');
    const second = grant(rig, 'RESTOCKER', '654321', 'other-restocker');
    await assert.rejects(() => rig.operations.startOrResumeRestock(second.sessionId), /Technician or Admin/);
    const technician = grant(rig, 'TECHNICIAN', '234567', 'recovery-technician');
    const resumed = await rig.operations.startOrResumeRestock(technician.sessionId);
    assert.deepEqual(resumed, restock);
    assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM command_intent WHERE door_id=?', 'X-01').count, 1);
    rig.operations.recordRestockOutcome(technician.sessionId, restock.sessionId, 'K-01', 'LEFT_EMPTY', 'Shortage verified');
    assert.deepEqual(rig.operations.finalizeRestock(technician.sessionId, restock.sessionId, true), { filled: 1, leftEmpty: 1, exceptions: 0 });
    const resume = JSON.parse(rig.store.one("SELECT payload_json FROM machine_event WHERE type='RESTOCK_SESSION_RESUMED'").payload_json);
    assert.equal(resume.previousActorUserId, 'first-restocker');
    assert.equal(rig.controller.receipts.length, 2);
  } finally { rig.store.close(); }
});

test('cancellation during a pending start remains durable and the runtime honors it without re-starting payment', async () => {
  const rig = await createRig(); let release; let starts = 0;
  try {
    makeDoorAvailable(rig); const sale = await reserve(rig);
    rig.payment.scriptStart({ outcome: 'UNKNOWN' });
    const start = rig.payment.startSession.bind(rig.payment);
    rig.payment.startSession = async request => { starts += 1; await new Promise(resolve => { release = resolve; }); return start(request); };
    const paymentKey = crypto.randomUUID(); const starting = rig.machine.startPayment(sale.saleId, paymentKey);
    await new Promise(resolve => setImmediate(resolve));
    const cancelKey = crypto.randomUUID();
    await Promise.all([rig.machine.cancelPayment(sale.saleId, cancelKey), rig.machine.cancelPayment(sale.saleId, cancelKey)]);
    await rig.machine.advancePayments();
    assert.equal(starts, 1); assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'REQUESTED');
    release(); await starting; await rig.machine.advancePayments();
    assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'CANCELLED');
    assert.equal(rig.store.one('SELECT cancel_intent_key FROM sale WHERE sale_id=?', sale.saleId).cancel_intent_key, cancelKey);
    assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM command_intent').count, 0);
    assert.equal(rig.store.one("SELECT state FROM door WHERE door_id='X-01'").state, 'AVAILABLE');
    assert.equal(starts, 1);
  } finally { rig.store.close(); }
});

test('restart honors a persisted cancellation only after proving provider absence', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); const sale = await reserve(rig); let starts = 0;
    rig.payment.startSession = async () => { starts += 1; throw new Error('Transport lost before effect'); };
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    await rig.machine.cancelPayment(sale.saleId, crypto.randomUUID());
    await rig.machine.initialize();
    assert.equal(starts, 1);
    assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'CANCELLED');
    assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM command_intent').count, 0);
  } finally { rig.store.close(); }
});

test('concurrent certification starts create only one evidence session and require an exact commit', async () => {
  const invalid = await createRig({ sourceCommit: 'codex/some-branch' });
  try { const actor = grant(invalid, 'TECHNICIAN'); await assert.rejects(() => invalid.operations.startCertification(actor.sessionId), /trusted service source-commit/); } finally { invalid.store.close(); }
  const rig = await createRig();
  try {
    const actor = grant(rig, 'TECHNICIAN');
    const results = await Promise.allSettled([rig.operations.startCertification(actor.sessionId), rig.operations.startCertification(actor.sessionId)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM certification_session').count, 1);
    assert.equal(rig.controller.receipts.length, 1);
  } finally { rig.store.close(); }
});

test('presentation Done cannot start a second payment while the first provider session is finalizing', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig, ['X-01', 'K-01']); const sale = await reserve(rig);
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    rig.machine.markPresentationDone(sale.saleId);
    rig.machine.selectCartDoor('K-01', 'sports-25', true);
    assert.ok((await rig.machine.readiness()).reasons.includes('PAYMENT_FINALIZATION_PENDING'));
    await assert.rejects(() => rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: ['K-01'] }), /not ready/i);
    await rig.machine.advancePayments();
    assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'SETTLED');
    assert.equal((await rig.machine.readiness()).ready, true);
  } finally { rig.store.close(); }
});

test('checkout rechecks cloud loss after the final asynchronous adapter probe', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); rig.machine.selectCartDoor('X-01', 'sports-25', true);
    const capabilities = rig.payment.capabilities.bind(rig.payment); let probes = 0;
    rig.payment.capabilities = async () => {
      if (++probes === 3) rig.store.run('UPDATE machine_meta SET last_cloud_success_at=NULL WHERE singleton=1');
      return capabilities();
    };
    await assert.rejects(() => rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: ['X-01'] }), /readiness changed/i);
    assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM sale').count, 0);
  } finally { rig.store.close(); }
});
