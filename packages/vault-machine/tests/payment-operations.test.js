const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRig, makeDoorAvailable, crypto, vault, tempDatabase, contracts } = require('./helpers');
const ref = value => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');

async function paidRig(t, options = {}) {
  const payment = new vault.DeterministicPaymentMock();
  const caps = await payment.capabilities();
  payment.capabilities = async () => ({ ...caps, provider: 'NAYAX_SPARK', mode: 'OFFICIAL_TEST', bindingDigest: 'a'.repeat(64), captureBeforeFulfillment: true });
  const requestDigests = new Map(), start = payment.startSession.bind(payment), reconcile = payment.reconcile.bind(payment);
  payment.startSession = async request => { const { fulfillment, ...legacy } = request; const result = await start(legacy); requestDigests.set(result.providerSessionId, require('../dist/util').digest(request)); return { ...result, providerTransactionId: '7000000000000001', originalRequestDigest: requestDigests.get(result.providerSessionId) }; };
  payment.reconcile = async id => ({ ...await reconcile(id), providerTransactionId: '7000000000000001', originalRequestDigest: requestDigests.get(id) });
  const rig = await createRig({ ...options, payment, configure: false }); t.after(() => rig.store.close());
  const signed = require('../../vault-contracts/tests/profile-fixtures').makeSyntheticConfig(rig.machineId, 1, rig.keyPair.privateKey, 1);
  signed.keyId = 'test-config-key';
  rig.controller = new vault.DeterministicControllerSimulator(signed.payload.doorMapping);
  rig.machine = new vault.VaultMachine(rig.store, payment, rig.controller, { pinnedConfigKeys: { 'test-config-key': rig.keyPair.publicKey.export({ type: 'spki', format: 'pem' }) }, appVersion: '0.1.0', clock: rig.clock });
  rig.machine.stageConfig(signed); rig.machine.activatePendingConfig(); rig.machine.markCloudContact();
  makeDoorAvailable(rig, ['door-0001']); rig.machine.selectCartDoor('door-0001', 'sports-25', true);
  const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: ['door-0001'] })).sale;
  await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
  const row = rig.store.one('SELECT * FROM sale WHERE sale_id=?', sale.saleId);
  assert.equal(row.payment_state, 'SETTLED');
  const action = { actionId: crypto.randomUUID(), machineId: rig.machineId, saleId: sale.saleId, provider: 'NAYAX_SPARK', paymentBindingDigest: 'a'.repeat(64),
    providerSessionReference: ref(row.provider_session_id), providerTransactionReference: ref(row.provider_transaction_id), amountCents: row.total_cents,
    currency: 'USD', reason: 'Reviewed customer support resolution', approvedByAdminId: 'admin-fixture', approvedAt: rig.clock.now().toISOString(), expiresAt: new Date(rig.clock.now().getTime() + 300000).toISOString() };
  let calls = 0;
  payment.voidPaidTransaction = async request => { calls++; return { ...request, state: 'VOIDED', evidenceReference: ref('provider-void-evidence') }; };
  return { ...rig, saleId: sale.saleId, action, calls: () => calls };
}

test('fresh exact approval requires finished presentation and records compensation without changing capture or stock', async t => {
  const rig = await paidRig(t);
  await assert.rejects(rig.machine.paymentOperations.executeApprovedVoid(rig.action), { code: 'PAYMENT_VOID_FULFILLMENT_ACTIVE' });
  assert.equal(rig.calls(), 0);
  rig.machine.markPresentationDone(rig.saleId);
  const before = rig.store.all('SELECT * FROM door'); const commands = rig.controller.receipts.length;
  const result = await rig.machine.paymentOperations.executeApprovedVoid(rig.action);
  assert.equal(result.state, 'VOIDED'); assert.equal(rig.calls(), 1);
  assert.equal(rig.machine.publicSale(rig.saleId).paymentState, 'SETTLED');
  assert.deepEqual(rig.store.all('SELECT * FROM door'), before);
  assert.equal(rig.controller.receipts.length, commands);
  await rig.machine.paymentOperations.executeApprovedVoid(rig.action); assert.equal(rig.calls(), 1);
  await assert.rejects(rig.machine.openPaidDoorsAgain(rig.saleId, 'after-void'), { code: 'GROUP_RETRY_NOT_AVAILABLE' });
  await assert.rejects(rig.machine.paymentOperations.executeApprovedVoid({ ...rig.action, actionId: crypto.randomUUID() }), { code: 'PAYMENT_VOID_ALREADY_RECORDED' });
  assert.equal(rig.store.one("SELECT count(*) AS n FROM machine_event WHERE type='PAYMENT_VOID_INTENT_RECORDED'").n, 1);
  assert.equal(rig.store.one("SELECT count(*) AS n FROM machine_event WHERE type='PAYMENT_VOID_OUTCOME_RECORDED'").n, 1);
  assert.throws(() => rig.store.run("UPDATE payment_void SET state='UNKNOWN'"), /immutable/);
});

test('wrong machine, amount, provider identifiers, expired and future approvals never create an intent', async t => {
  const rig = await paidRig(t); rig.machine.markPresentationDone(rig.saleId);
  for (const changes of [{ machineId: crypto.randomUUID() }, { amountCents: rig.action.amountCents + 1 }, { providerTransactionReference: ref('other') }, { providerSessionReference: ref('other') },
    { approvedAt: new Date(rig.clock.now().getTime() - 600000).toISOString(), expiresAt: new Date(rig.clock.now().getTime() - 300000).toISOString() },
    { approvedAt: new Date(rig.clock.now().getTime() + 1000).toISOString() }]) {
    await assert.rejects(rig.machine.paymentOperations.executeApprovedVoid({ ...rig.action, ...changes }));
  }
  assert.equal(rig.calls(), 0); assert.equal(rig.store.one('SELECT count(*) AS n FROM payment_void').n, 0);
});

test('concurrent approval delivery shares one effect; unknown response persists and maintenance refuses restart', async t => {
  const rig = await paidRig(t); rig.machine.markPresentationDone(rig.saleId);
  let release; let calls = 0;
  rig.payment.voidPaidTransaction = async () => { calls++; await new Promise(resolve => { release = resolve; }); throw new Error('secret provider failure'); };
  const first = rig.machine.paymentOperations.executeApprovedVoid(rig.action);
  const second = rig.machine.paymentOperations.executeApprovedVoid(rig.action);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rig.store.one('SELECT state FROM payment_void').state, 'INTENT');
  await assert.rejects(rig.machine.paymentOperations.executeApprovedVoid({ ...rig.action, reason: 'Different approval body' }), { code: 'PAYMENT_VOID_ACTION_CONFLICT' });
  release(); assert.equal((await first).state, 'UNKNOWN'); assert.equal((await second).state, 'UNKNOWN'); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(rig.store.all('SELECT payload_json FROM machine_event')).includes('secret provider failure'));
  const { VaultMaintenance } = require('../dist/maintenance');
  const maintenance = new VaultMaintenance(rig.machine, { quiesce: async () => {}, resume: async () => {} });
  assert.ok((await maintenance.status()).blockers.includes('UNRESOLVED_PAYMENT_VOID'));
  rig.clock.advance(301000);
  rig.payment.voidPaidTransaction = async request => ({ ...request, state: 'VOIDED', evidenceReference: ref('same-original-action') });
  assert.equal((await rig.machine.paymentOperations.executeApprovedVoid(rig.action)).state, 'VOIDED', 'existing uncertain intent can reconcile after original approval expires');
});

test('late capture anomaly commits before ACK, deduplicates after crash, and never changes sold doors', async t => {
  const rig = await paidRig(t); rig.machine.markPresentationDone(rig.saleId);
  const notice = { noticeId: ref('late-conflict'), saleId: rig.saleId, provider: 'NAYAX_SPARK', bindingDigest: 'a'.repeat(64), providerSessionId: 'original', providerTransactionId: 'late-other', amountCents: rig.action.amountCents, currency: 'USD', captureConfirmed: true, code: 'SPARK_CONFLICTING_CAPTURE' };
  const before = rig.store.all('SELECT * FROM door'); let acknowledgments = 0;
  rig.payment.pollEvidence = async () => [notice];
  rig.payment.acknowledgeEvidence = async () => { assert.equal(rig.store.one('SELECT count(*) AS n FROM payment_evidence_notice').n, 1); if (++acknowledgments === 1) throw Error('crash before provider ACK'); };
  await rig.machine.advancePayments(); await rig.machine.advancePayments();
  assert.equal(acknowledgments, 2); assert.equal(rig.store.one("SELECT count(*) AS n FROM machine_event WHERE type='PAYMENT_EVIDENCE_ANOMALY'").n, 1);
  assert.equal(rig.store.one('SELECT recovery_required FROM machine_meta').recovery_required, 1);
  assert.deepEqual(rig.store.all('SELECT * FROM door'), before);
  const payload = JSON.parse(rig.store.one("SELECT payload_json FROM machine_event WHERE type='PAYMENT_EVIDENCE_ANOMALY'").payload_json);
  assert.equal(payload.providerTransactionReference, ref('late-other')); assert.ok(!JSON.stringify(payload).includes('late-other'));
});

test('provider recovery audit runs before recovery and can stop queued effects', async t => {
  const rig = await paidRig(t);
  let snapshot;
  rig.payment.auditRecovery = async value => { snapshot = value; return [{ noticeId: ref('missing-proof'), saleId: rig.saleId, provider: 'NAYAX_SPARK', bindingDigest: 'a'.repeat(64), providerSessionId: null, providerTransactionId: null, amountCents: null, currency: 'USD', captureConfirmed: false, code: 'SPARK_MAIN_CAPTURE_MISSING' }]; };
  const count = rig.controller.receipts.length;
  await rig.machine.initialize();
  assert.equal(snapshot.sales[0].hasCommittedFulfillment, true);
  assert.equal(rig.store.one('SELECT automation_halted FROM machine_meta').automation_halted, 0);
  assert.equal(rig.machine.paymentOperations.recovery.held(), true);
  assert.equal(rig.controller.receipts.length, count);
});

test('restoring a main-only encrypted Spark backup requires recovery review', async t => {
  const tmp = tempDatabase(); t.after(() => fs.rmSync(tmp.directory, { recursive: true, force: true }));
  const rig = await paidRig(t, { databasePath: tmp.path }); rig.machine.markPresentationDone(rig.saleId);
  const backup = path.join(tmp.directory, 'main.tkvault'), restored = path.join(tmp.directory, 'restored.sqlite'), key = crypto.randomBytes(32);
  rig.store.encryptedBackup(backup, key); vault.VaultStore.restoreEncrypted(backup, restored, key);
  const store = new vault.VaultStore(restored, { machineId: rig.machineId, appVersion: '0.1.0', sourceCommit: 'a'.repeat(40), acquireProcessLock: false }); t.after(() => store.close());
  assert.equal(store.one('SELECT recovery_required FROM machine_meta').recovery_required, 1);
  assert.equal(store.one('SELECT automation_halted FROM machine_meta').automation_halted, 1);
});

test('authenticated runtime pulls approved financial actions only for a capable provider', async t => {
  const rig = await paidRig(t); rig.machine.markPresentationDone(rig.saleId); let pulls = 0;
  const cloud = { machineId: rig.machineId, config: async () => ({ config: null, unchanged: true }),
    staffGrants: async after => ({ grants: [], latestGrantVersion: after, hasMore: false }), heartbeat: async () => rig.clock.now(),
    send: async events => ({ acknowledgedEventIds: events.map(event => event.eventId), rejected: [] }), paymentActions: async () => { pulls++; return [rig.action]; } };
  const runtime = new vault.VaultRuntime(rig.machine, cloud, { clock: rig.clock, broadcast: async () => {} });
  await runtime.synchronize(); await runtime.synchronize();
  assert.equal(pulls, 2); assert.equal(rig.calls(), 1); assert.equal(rig.store.one('SELECT state FROM payment_void').state, 'VOIDED');
  assert.equal(rig.store.one('SELECT last_error_code FROM cloud_sync_state').last_error_code, null);
});

test('a newly arrived local discrepancy blocks a new void until that exact notice was reviewed', async t => {
  const rig = await paidRig(t); rig.machine.markPresentationDone(rig.saleId);
  const noticeId = ref('new-local-discrepancy');
  rig.payment.pollEvidence = async () => [{ noticeId, saleId: rig.saleId, provider: 'NAYAX_SPARK', bindingDigest: 'a'.repeat(64), providerSessionId: null, providerTransactionId: null, amountCents: null, currency: 'USD', captureConfirmed: false, code: 'SPARK_REVIEW_REQUIRED' }];
  await rig.machine.advancePayments();
  await assert.rejects(rig.machine.paymentOperations.executeApprovedVoid(rig.action), { code: 'PAYMENT_VOID_EVIDENCE_REVIEW_REQUIRED' });
  assert.equal(rig.calls(), 0);
  assert.equal((await rig.machine.paymentOperations.executeApprovedVoid({ ...rig.action, reviewedNoticeIds: [noticeId] })).state, 'VOIDED');
});

test('evidence integrity failures hold recovery and retries without consuming a door retry', async t => {
  const rig = await paidRig(t); const count = rig.controller.receipts.length;
  rig.payment.pollEvidence = async () => { throw Error('invalid feed'); };
  await rig.machine.advancePayments();
  assert.equal(rig.store.one('SELECT recovery_required FROM machine_meta').recovery_required, 1);
  assert.equal(rig.machine.publicSale(rig.saleId).retryAvailable, false);
  await assert.rejects(rig.machine.openPaidDoorsAgain(rig.saleId, 'held-retry'), { code: 'GROUP_RETRY_RECOVERY_REQUIRED' });
  assert.equal(rig.store.one('SELECT retry_used_at FROM sale').retry_used_at, null);
  assert.equal(rig.controller.receipts.length, count);
  let options;
  const original = rig.payment.reconcile;
  rig.payment.reconcile = async (id, supplied) => { options = supplied; return original(id); };
  await rig.machine.reconcileSale(rig.saleId);
  assert.equal(options.allowReplay, false);
});

test('technical and unsafe-clock holds block both new voids and original UNKNOWN replay without changing money', async t => {
  for (const phase of ['new', 'UNKNOWN']) for (const hold of ['automation', 'restore', 'clock']) {
    const rig = await paidRig(t); rig.machine.markPresentationDone(rig.saleId); let calls = 0;
    rig.payment.voidPaidTransaction = async (request, options) => { options.beforeTransport(); calls++; return { ...request, state: 'UNKNOWN', evidenceReference: ref('uncertain-original') }; };
    if (phase === 'UNKNOWN') await rig.machine.paymentOperations.executeApprovedVoid(rig.action);
    if (hold === 'automation') rig.store.run('UPDATE machine_meta SET automation_halted=1');
    if (hold === 'restore') rig.store.run('UPDATE machine_meta SET automation_halted=1,recovery_required=1');
    if (hold === 'clock') rig.clock.value = new Date(rig.clock.now().getTime() + 6000);
    const rows = rig.store.all('SELECT * FROM payment_void'), sales = rig.store.all('SELECT * FROM sale'), doors = rig.store.all('SELECT * FROM door');
    const beforeCalls = calls;
    await assert.rejects(rig.machine.paymentOperations.executeApprovedVoid(rig.action), { code: 'PAYMENT_VOID_TECHNICAL_RECOVERY_REQUIRED' });
    assert.equal(calls, beforeCalls); assert.deepEqual(rig.store.all('SELECT * FROM payment_void'), rows);
    assert.deepEqual(rig.store.all('SELECT * FROM sale'), sales); assert.deepEqual(rig.store.all('SELECT * FROM door'), doors);
  }
});

test('new discrepancy or in-progress human review blocks UNKNOWN replay while preserving its identity', async t => {
  for (const hold of ['notice', 'review']) {
    const rig = await paidRig(t); rig.machine.markPresentationDone(rig.saleId); let calls = 0;
    rig.payment.voidPaidTransaction = async request => { calls++; return { ...request, state: 'UNKNOWN', evidenceReference: ref('uncertain-original') }; };
    await rig.machine.paymentOperations.executeApprovedVoid(rig.action);
    if (hold === 'notice') {
      rig.payment.pollEvidence = async () => [{ noticeId: ref('new-uncertain-evidence'), saleId: null, provider: 'NAYAX_SPARK', bindingDigest: 'a'.repeat(64), providerSessionId: null, providerTransactionId: null, amountCents: null, currency: 'USD', captureConfirmed: false, code: 'SPARK_ORPHAN_RECEIPT' }];
      await rig.machine.paymentOperations.pollEvidence();
    } else rig.store.run("INSERT INTO financial_recovery_decision VALUES(?,?,?,'INTENT',?,NULL)", crypto.randomUUID(), 'a'.repeat(64), '{}', rig.clock.now().toISOString());
    await assert.rejects(rig.machine.paymentOperations.executeApprovedVoid(rig.action), { code: hold === 'notice' ? 'PAYMENT_VOID_EVIDENCE_REVIEW_REQUIRED' : 'PAYMENT_VOID_RETIRED_OR_REVIEWING' });
    assert.equal(calls, 1); assert.equal(rig.store.one('SELECT action_id,state FROM payment_void').action_id, rig.action.actionId);
    assert.equal(rig.store.one('SELECT state FROM payment_void').state, 'UNKNOWN');
  }
});

test('hold acquired after durable main intent is rechecked by queued provider work and retains the untransported intent', async t => {
  const rig = await paidRig(t); rig.machine.markPresentationDone(rig.saleId); let enter, release, calls = 0;
  const queued = new Promise(resolve => { enter = resolve; });
  rig.payment.voidPaidTransaction = async (request, options) => { enter(); await new Promise(resolve => { release = resolve; }); options.beforeTransport(); calls++; return { ...request, state: 'VOIDED', evidenceReference: ref('must-not-transport') }; };
  const result = rig.machine.paymentOperations.executeApprovedVoid(rig.action); await queued;
  rig.store.run('UPDATE machine_meta SET automation_halted=1,recovery_required=1'); release();
  await assert.rejects(result, { code: 'PAYMENT_VOID_TECHNICAL_RECOVERY_REQUIRED' });
  assert.equal(calls, 0); assert.equal(rig.store.one('SELECT state FROM payment_void').state, 'INTENT');
  await assert.rejects(rig.machine.paymentOperations.executeApprovedVoid(rig.action), { code: 'PAYMENT_VOID_TECHNICAL_RECOVERY_REQUIRED' });
  assert.equal(calls, 0);
  assert.equal(rig.store.one("SELECT count(*) AS n FROM machine_event WHERE type='PAYMENT_VOID_OUTCOME_RECORDED'").n, 0);
});

test('already recorded terminal void remains a read-only result during technical recovery', async t => {
  const rig = await paidRig(t); rig.machine.markPresentationDone(rig.saleId);
  const result = await rig.machine.paymentOperations.executeApprovedVoid(rig.action);
  rig.store.run('UPDATE machine_meta SET automation_halted=1,recovery_required=1');
  assert.deepEqual(await rig.machine.paymentOperations.executeApprovedVoid(rig.action), result); assert.equal(rig.calls(), 1);
});
