const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRig, makeDoorAvailable, makeConfig, grant, tempDatabase, crypto, vault } = require('./helpers');

async function reserve(rig) {
  makeDoorAvailable(rig); rig.machine.selectCartDoor('X-01', 'sports-25', true);
  return (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: ['X-01'] })).sale;
}

test('a late reconciliation exception cannot overwrite a concurrently observed terminal settlement', async () => {
  const rig = await createRig(); let rejectReconciliation;
  try {
    const sale = await reserve(rig); await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    const row = rig.store.one('SELECT provider_session_id,provider_sequence FROM sale WHERE sale_id=?', sale.saleId);
    const callback = state => ({ callbackId: crypto.randomUUID(), saleId: sale.saleId, providerSessionId: row.provider_session_id, sequence: rig.store.one('SELECT provider_sequence FROM sale WHERE sale_id=?', sale.saleId).provider_sequence + 1, state, occurredAt: rig.clock.now().toISOString(), evidence: {} });
    await rig.machine.handleProviderCallback(callback('SETTLEMENT_PENDING'));
    rig.payment.reconcile = async () => new Promise((_, reject) => { rejectReconciliation = reject; });
    const recovery = rig.machine.advancePayments(); await new Promise(resolve => setImmediate(resolve));
    assert.ok(rejectReconciliation);
    await rig.machine.handleProviderCallback(callback('SETTLED'));
    rejectReconciliation(new Error('late network failure')); await recovery;
    assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'SETTLED');
  } finally { rig.store.close(); }
});

test('dispatch rejects live adapters even when their mode changes after checkout', async () => {
  const rig = await createRig();
  try {
    const sale = await reserve(rig); const capabilities = await rig.payment.capabilities(); let calls = 0;
    rig.payment.capabilities = async () => ({ ...capabilities, mode: 'LIVE' });
    rig.payment.startSession = async () => { calls += 1; throw new Error('must never be called'); };
    await assert.rejects(() => rig.machine.startPayment(sale.saleId, crypto.randomUUID()), error => error.code === 'LIVE_PAYMENT_NOT_AUTHORIZED_IN_THIS_BUILD');
    assert.equal(calls, 0); assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'NOT_REQUESTED');
  } finally { rig.store.close(); }
  const controllerRig = await createRig();
  try {
    const sale = await reserve(controllerRig); const identity = await controllerRig.controller.identity(); let calls = 0;
    controllerRig.controller.identity = async () => ({ ...identity, mode: 'LIVE' });
    controllerRig.controller.sendOpenCommand = async () => { calls += 1; throw new Error('must never be called'); };
    await controllerRig.machine.startPayment(sale.saleId, crypto.randomUUID());
    assert.equal(calls, 0); assert.equal(controllerRig.store.one('SELECT automation_halted FROM machine_meta').automation_halted, 1);
    assert.equal(controllerRig.machine.publicSale(sale.saleId).retryAvailable, false);
  } finally { controllerRig.store.close(); }
});

test('restart records terminal unknown command evidence once without repeating the effect', async () => {
  const rig = await createRig();
  try {
    const sale = await reserve(rig); await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    rig.store.run("UPDATE command_intent SET state='SENT_UNKNOWN',completed_at=NULL WHERE sale_id=?", sale.saleId);
    await rig.machine.initialize(); await rig.machine.initialize();
    const events = rig.store.all("SELECT payload_json FROM machine_event WHERE type='CONTROLLER_EFFECT_REMAINS_UNKNOWN'").map(row => JSON.parse(row.payload_json));
    assert.equal(events.filter(event => event.errorClass === 'SERVICE_RESTART').length, 1);
    assert.equal(rig.controller.receipts.length, 1); assert.equal(rig.machine.publicSale(sale.saleId).retryAvailable, true);
  } finally { rig.store.close(); }
});

test('clock rollback locks staff authority and prevents pending configuration activation', async () => {
  const rig = await createRig();
  try {
    const actor = grant(rig, 'TECHNICIAN'); rig.machine.stageConfig(makeConfig(rig.machineId, 2, rig.keyPair.privateKey));
    rig.clock.value = new Date(rig.clock.now().getTime() - 60_000);
    assert.throws(() => rig.machine.staff.requireSession(actor.sessionId), /locked or expired/);
    assert.throws(() => rig.machine.staff.authenticate(actor.userId, '123456'), /safe local clock/);
    assert.ok(rig.machine.activatePendingConfig().reasons.includes('CLOCK_UNSAFE'));
    assert.equal(rig.machine.config.active().payload.version, 1);
  } finally { rig.store.close(); }
});

test('certification can reauthenticate for pending payment recovery without admitting public staff takeover', async () => {
  const rig = await createRig();
  try {
    const actor = grant(rig, 'TECHNICIAN'); const cert = await rig.operations.startCertification(actor.sessionId);
    rig.operations.recordCertificationEvidence(actor.sessionId, { evidenceId: crypto.randomUUID(), sessionId: cert.sessionId, doorId: cert.scheduledDoorId, evidenceClass: 'AUTOMATED', outcome: 'PASS', expectedDoorIds: [cert.scheduledDoorId], observedDoorIds: [cert.scheduledDoorId], notes: 'Simulator only', artifactDigest: 'b'.repeat(64), observedAt: rig.clock.now().toISOString() });
    rig.payment.scriptStart({ outcome: 'UNKNOWN' }); const cycle = await rig.operations.startCertificationCycle(actor.sessionId, cert.sessionId, 'PURCHASE');
    assert.equal(rig.machine.publicSale(cycle.saleId).paymentState, 'UNKNOWN');
    rig.machine.staff.lock(actor.sessionId);
    const resumed = rig.machine.staff.authenticate(actor.userId, '123456');
    assert.equal(resumed.role, 'TECHNICIAN'); assert.equal(rig.store.one('SELECT service_locked FROM machine_meta').service_locked, 1);
    assert.throws(() => rig.machine.staff.safeExit(resumed.sessionId, true), /must finish/);
  } finally { rig.store.close(); }
});

test('malformed simulated-provider snapshots cannot erase or partially replace durable request authority', async () => {
  const mock = new vault.DeterministicNayaxMock();
  const request = { idempotencyKey: 'same-key', saleId: crypto.randomUUID(), mode: 'CERTIFICATION', currency: 'USD', totalCents: 2500, items: [{ lineId: crypto.randomUUID(), name: 'Test', priceCents: 2500 }] };
  const result = await mock.startSession(request); const snapshot = mock.snapshot();
  assert.throws(() => mock.restore({}), /snapshot/i);
  assert.throws(() => mock.restore({ ...snapshot, startSteps: [{ outcome: 'SETTLE' }] }), /snapshot/i);
  assert.throws(() => mock.restore({ ...snapshot, sessions: [...snapshot.sessions, snapshot.sessions[0]] }), /snapshot/i);
  assert.deepEqual(mock.snapshot(), snapshot); assert.deepEqual(await mock.startSession(request), result);
});

test('backup rejects broken retained references and rotation preserves a replaced backup file', async () => {
  const temporary = tempDatabase(); const rig = await createRig({ databasePath: temporary.path, acquireProcessLock: true });
  try {
    const output = path.join(temporary.directory, 'backups'); const key = crypto.randomBytes(32);
    const first = rig.store.rotateEncryptedBackup(output, key, 2);
    rig.store.rotateEncryptedBackup(output, key, 2);
    fs.writeFileSync(first.path, 'replacement must remain unchanged');
    // Make this exact replaced entry the oldest without rewriting any business fact.
    rig.store.run("UPDATE backup_metadata SET created_at='2000-01-01T00:00:00.000Z' WHERE backup_id=?", first.backupId);
    assert.throws(() => rig.store.rotateEncryptedBackup(output, key, 2), /preserve it for inspection/);
    assert.equal(fs.readFileSync(first.path, 'utf8'), 'replacement must remain unchanged');
    assert.equal(rig.store.one('SELECT removed_at FROM backup_metadata WHERE backup_id=?', first.backupId).removed_at, null);
    rig.store.db.pragma('foreign_keys=OFF'); rig.store.run("INSERT INTO cart_item VALUES('missing-door','sports-25','2026-08-16T00:00:00.000Z')"); rig.store.db.pragma('foreign_keys=ON');
    const badBackup = path.join(temporary.directory, 'invalid.tkvault');
    assert.throws(() => rig.store.encryptedBackup(badBackup, key), /integrity verification/);
    assert.equal(fs.existsSync(badBackup), false); assert.equal(fs.readdirSync(temporary.directory).some(name => /^invalid\.tkvault\..*\.sqlite$/.test(name)), false);
  } finally { rig.store.close(); fs.rmSync(temporary.directory, { recursive: true, force: true }); }
});
