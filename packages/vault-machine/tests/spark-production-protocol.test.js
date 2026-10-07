const test = require('node:test'), assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path'), { tmpdir } = require('node:os');
const { NayaxSparkClient } = require('../dist/nayax-spark-client');
const { NayaxSparkAdapter } = require('../dist/nayax-spark-test-adapter');
const { buildSparkProvisioning, checkSparkSecretPresence } = require('../dist/spark-provisioning');
const { input } = require('./spark-provisioning-fixture');
function production() {
  const value = input(); value.stage = value.profile.environment = 'PRODUCTION';
  value.profile.sandboxConfirmed = false; value.profile.productionConfirmed = true; value.profile.credentialGeneration = randomUUID();
  return value;
}
function fixture(t, profileChanges = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vault-production-protocol-'));
  const value = production(); Object.assign(value.profile, profileChanges);
  const plan = buildSparkProvisioning(value);
  const state = { calls: [], rows: [], allowed: true, guardCalls: 0, now: Date.parse('2026-10-07T20:00:00Z'), loseTrigger: false, loseVoid: false, afterAuth: null, read: null, feed: null };
  const options = { ...plan.localProfile, machineId: plan.machineId, journalPath: join(root, 'production.sqlite'),
    tokenSecret: 'fixture-token-0123456789abcdefghijklmnopqrstuvwxyz', signKey: 'fixture-sign-key-0123456789', now: () => state.now,
    beforeEffect: () => { state.guardCalls++; if (!state.allowed) throw Error('synthetic authority revoked'); },
    readObservations: async () => { if (state.read) await state.read(); return state.rows; },
    readReceiptFeed: async after => { if (state.feed) await state.feed(); return { observations: [], nextCursor: after, hasMore: false }; },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body); state.calls.push({ url, body, raw: init.body });
      if (url.endsWith('/StartAuthentication')) { state.afterAuth?.(); return Response.json({ HashedSparkTransactionId: createHash('sha256').update(body.SparkTransactionId).digest('hex'), Status: { Verdict: 'Approved' } }); }
      if (url.endsWith('/TriggerTransaction') && state.loseTrigger || url.endsWith('/CancelTransaction') && state.loseVoid) throw Error('synthetic lost response');
      assert.ok(url.endsWith('/TriggerTransaction') || url.endsWith('/CancelTransaction'));
      return Response.json({ SparkTransactionId: body.SparkTransactionId, Status: { Verdict: 'Approved' } });
    },
  };
  const opened = [], reopen = () => { const adapter = new NayaxSparkAdapter(options); opened.push(adapter); return adapter; };
  const adapter = reopen();
  t.after(() => { for (const a of opened) a.close(); rmSync(root, { recursive: true, force: true }); });
  const request = () => ({ saleId: randomUUID(), idempotencyKey: randomUUID(), mode: 'PRODUCTION', currency: 'USD', totalCents: 2500,
    items: [{ lineId: randomUUID(), name: 'Pack', priceCents: 2500 }] });
  const receipt = (id, changes = {}) => ({ receiptId: `spark-production:${createHash('sha256').update(id).digest('hex')}`, stage: 'PRODUCTION', paymentBindingDigest: plan.bindingDigest,
    kind: 'TRANSACTION', sparkTransactionId: id, nayaxTransactionId: '9223372036854775807', machineId: options.nayaxMachineId, terminalId: options.hwSerial,
    hwSerial: options.hwSerial, siteId: options.siteId, amountCents: 2500, currency: 'USD', currencySource: 'CALLBACK', verdict: 'Approved', errorCode: 0,
    machineAuTime: '20261007120000123', methodClassification: 'ACQUIRING', methodProfileDigest: plan.methodProfileDigest,
    methodEvidence: { cardUidPresent: false, cardBrandClass: 'SUPPORTED_ACQUIRING', authCodePresent: true, rrnPresent: true }, ...changes });
  const paid = async () => { const purchase = request(), result = await adapter.startSession(purchase); state.rows = [receipt(result.providerSessionId)];
    const capture = await adapter.reconcile(result.providerSessionId); assert.equal(capture.state, 'SETTLED');
    const action = { actionId: randomUUID(), saleId: purchase.saleId, providerSessionId: result.providerSessionId, providerTransactionId: capture.providerTransactionId,
      bindingDigest: plan.bindingDigest, amountCents: 2500, currency: 'USD', reason: 'Verified complete service compensation' };
    return { purchase, capture, action }; };
  return { value, plan, state, options, adapter, reopen, request, receipt, paid };
}

test('production flags or a missing credential generation cannot substitute for runtime effect authority', t => {
  const f = fixture(t);
  for (const patch of [{ beforeEffect: undefined }, { credentialGeneration: undefined }, { credentialGeneration: 'not-a-generation' },
    { sandboxConfirmed: true }, { productionConfirmed: false }, { environment: 'LIVE' }]) {
    assert.throws(() => new NayaxSparkClient({ ...f.options, ...patch }), /SPARK_SANDBOX_CONFIG_INVALID|Spark did not confirm/);
  }
  assert.equal(f.state.calls.length, 0);
});

test('production generation, full binding and LIVE capability match the generated disabled plan', async t => {
  const f = fixture(t), capabilities = await f.adapter.capabilities();
  assert.equal(capabilities.mode, 'LIVE'); assert.equal(capabilities.productionConfirmed, true); assert.equal(capabilities.sandboxConfirmed, undefined);
  assert.equal(capabilities.bindingDigest, f.plan.bindingDigest); assert.equal(f.plan.cloudBindings[0].paymentBindingDigest, capabilities.bindingDigest);
  assert.equal(f.plan.cloudEnvironment.VAULT_NAYAX_SPARK_PRODUCTION_CALLBACKS_ENABLED, 'false');
  assert.equal(f.plan.cloudEnvironment.VAULT_NAYAX_SPARK_CALLBACKS_ENABLED, undefined);
  assert.match(f.plan.callbackUrls.transaction, /\/spark\/production\/TransactionCallback$/);
  const rotated = structuredClone(f.value); rotated.profile.credentialGeneration = randomUUID();
  assert.notEqual(buildSparkProvisioning(rotated).bindingDigest, f.plan.bindingDigest);
  f.options.environment = 'SANDBOX'; f.options.beforeEffect = () => {}; f.options.maxTotalCents = 1;
  f.state.allowed = false; await assert.rejects(f.adapter.startSession(f.request()), /authority revoked/);
  assert.equal((await f.adapter.capabilities()).mode, 'LIVE'); assert.equal(f.state.calls.length, 0);
});

test('only PRODUCTION purchase mode reaches live PRE_SELECTION; acknowledgment is not payment and sends no Settlement', async t => {
  const f = fixture(t);
  for (const mode of ['CERTIFICATION', 'LIVE', 'UNKNOWN']) await assert.rejects(f.adapter.startSession({ ...f.request(), mode }), { code: 'SPARK_TEST_REQUEST_INVALID' });
  assert.equal(f.state.calls.length, 0);
  const pending = await f.adapter.startSession(f.request()); assert.equal(pending.state, 'REQUESTED');
  assert.deepEqual(f.state.calls.map(c => new URL(c.url).pathname), ['/api/StartAuthentication', '/api/TriggerTransaction']);
  assert.equal(f.state.calls[1].body.Amount, 25); assert.equal(f.state.calls[1].body.TransactionTimeout, 60);
  assert.ok(f.state.guardCalls >= 4);
});

test('production adapter rejects sandbox, missing stage, foreign binding and malformed callback identity before ingest', async t => {
  for (const patch of [{ receiptId: `spark-sandbox:${'a'.repeat(64)}` }, { stage: undefined }, { stage: 'SANDBOX' },
    { paymentBindingDigest: 'b'.repeat(64) }, { sparkTransactionId: randomUUID() }, { sparkTransactionId: 'invalid' }]) {
    const f = fixture(t), pending = await f.adapter.startSession(f.request()); f.state.rows = [f.receipt(pending.providerSessionId, patch)];
    await assert.rejects(f.adapter.reconcile(pending.providerSessionId), { code: 'SPARK_OBSERVATION_BINDING_INVALID' });
    assert.equal(f.state.calls.length, 2);
  }
});

test('revocation before authentication creates no intent and revocation after authentication prevents trigger', async t => {
  const a = fixture(t), request = a.request(); a.state.allowed = false;
  await assert.rejects(a.adapter.startSession(request), /authority revoked/); assert.equal(a.state.calls.length, 0);
  await assert.rejects(a.adapter.reconcileRequest(request.idempotencyKey), { code: 'SPARK_UNBOUND_START_REQUIRES_REVIEW' });
  const b = fixture(t); b.state.afterAuth = () => { b.state.allowed = false; };
  assert.equal((await b.adapter.startSession(b.request())).state, 'DECLINED'); assert.equal(b.state.calls.length, 1);
});

test('revocation blocks an eligible original trigger replay; later exact replay retains GUID and serialized body', async t => {
  const f = fixture(t, { triggerReplayPolicy: 'SAME_GUID_CONFIRMED_FINAL', maxTriggerAttempts: 2 });
  f.state.loseTrigger = true; const pending = await f.adapter.startSession(f.request()); assert.equal(pending.state, 'UNKNOWN');
  f.state.now += 60_000; f.state.allowed = false;
  await assert.rejects(f.adapter.reconcile(pending.providerSessionId), /authority revoked/); assert.equal(f.state.calls.length, 2);
  assert.equal((await f.adapter.reconcile(pending.providerSessionId, { allowReplay: false })).state, 'UNKNOWN');
  f.state.allowed = true; f.state.loseTrigger = false; assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, 'REQUESTED');
  assert.equal(f.state.calls[2].raw, f.state.calls[1].raw);
});

test('durable late capture and confirmed void remain readable after authority expiry without a new effect', async t => {
  const f = fixture(t); const { capture, action } = await f.paid();
  f.state.allowed = false; assert.equal((await f.adapter.reconcile(capture.providerSessionId)).state, 'SETTLED');
  await assert.rejects(f.adapter.voidPaidTransaction(action), /authority revoked/); assert.equal(f.state.calls.length, 2);
  f.state.allowed = true; assert.equal((await f.adapter.voidPaidTransaction(action)).state, 'VOIDED');
  f.state.allowed = false; assert.equal((await f.adapter.voidPaidTransaction(action)).state, 'VOIDED'); assert.equal(f.state.calls.length, 3);
  assert.match(f.state.calls[2].raw, /"NayaxTransactionId":9223372036854775807/); assert.equal(f.state.calls[2].body.CancellationType, 2);
});

test('unknown production void keeps original action/body and does not replay with expired authority', async t => {
  const f = fixture(t, { cancelReplayPolicy: 'SAME_REQUEST_CONFIRMED', maxCancelAttempts: 2 }); const { action } = await f.paid();
  f.state.loseVoid = true; assert.equal((await f.adapter.voidPaidTransaction(action)).state, 'UNKNOWN');
  f.state.now += 60_000; f.state.allowed = false; await assert.rejects(f.adapter.voidPaidTransaction(action), /authority revoked/);
  assert.equal(f.state.calls.length, 3); f.state.allowed = true; f.state.loseVoid = false;
  assert.equal((await f.adapter.voidPaidTransaction(action)).state, 'VOIDED'); assert.equal(f.state.calls[3].raw, f.state.calls[2].raw);
});

test('authority revoked while queued blocks the later start before a durable authentication intent', async t => {
  const f = fixture(t); let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
  f.state.feed = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const read = f.adapter.financialRecoveryEvidence(); await waiting;
  const request = f.request(), start = f.adapter.startSession(request); f.state.allowed = false; release(); await read;
  await assert.rejects(start, /authority revoked/); assert.equal(f.state.calls.length, 0);
  await assert.rejects(f.adapter.reconcileRequest(request.idempotencyKey), { code: 'SPARK_UNBOUND_START_REQUIRES_REVIEW' });
});

test('new production credential generation cannot reopen or overwrite an old provider journal', async t => {
  const f = fixture(t), purchase = f.request(), pending = await f.adapter.startSession(purchase); f.adapter.close();
  const old = f.options.credentialGeneration; f.options.credentialGeneration = randomUUID();
  assert.throws(() => f.reopen(), { code: 'SPARK_JOURNAL_ANCHOR_MISMATCH' });
  f.options.credentialGeneration = old; const restored = f.reopen();
  assert.equal((await restored.reconcileRequest(purchase.idempotencyKey, { allowReplay: false })).providerSessionId, pending.providerSessionId);
  assert.equal(f.state.calls.length, 2);
});

test('production secret readiness uses only separate generation references and rejects callback secret reuse', () => {
  const sandbox = { VAULT_SPARK_TOKEN_SECRET: 't'.repeat(40), VAULT_SPARK_SIGN_KEY: 's'.repeat(40), VAULT_NAYAX_SPARK_CALLBACK_SECRET: 'c'.repeat(40) };
  assert.equal(checkSparkSecretPresence(sandbox, 'PRODUCTION').ready, false);
  const env = { ...sandbox, VAULT_SPARK_PRODUCTION_TOKEN_SECRET: 'T'.repeat(40), VAULT_SPARK_PRODUCTION_SIGN_KEY: 'S'.repeat(40), VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET: 'C'.repeat(40) };
  assert.equal(checkSparkSecretPresence(env, 'PRODUCTION').ready, true);
  assert.equal(checkSparkSecretPresence({ ...env, VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET: sandbox.VAULT_NAYAX_SPARK_CALLBACK_SECRET }, 'PRODUCTION').ready, false);
});


test('historical sandbox provisioning keeps the approved canonical fixture binding', () => {
  const plan = buildSparkProvisioning(input());
  assert.equal(plan.bindingDigest, '22bbb274044519d369498902a159c30ee55fde68ce24e89f06cb6c81f9a75e17');
  assert.equal(plan.cloudBindings[0].stage, undefined); assert.equal(plan.cloudBindings[0].paymentBindingDigest, undefined);
});


test('an accidentally asynchronous effect guard cannot race a production HTTP request', async t => {
  const f = fixture(t); f.adapter.close();
  f.options.beforeEffect = async () => { throw Error('synthetic async denial'); };
  const adapter = f.reopen(); await assert.rejects(adapter.startSession(f.request()), { code: 'SPARK_EFFECT_AUTHORITY_NOT_SYNCHRONOUS' });
  const client = new NayaxSparkClient(f.options);
  await assert.rejects(client.authenticate(randomUUID(), f.options.terminalId, 1), { code: 'SPARK_EFFECT_AUTHORITY_NOT_SYNCHRONOUS' });
  assert.equal(f.state.calls.length, 0);
});
