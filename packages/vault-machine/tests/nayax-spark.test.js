const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, statSync, unlinkSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const crypto = require('node:crypto');
const { NayaxSparkTestAdapter } = require('../dist/nayax-spark-test-adapter');
const { sparkAuthenticationCipher, sparkTransactionSignature, sparkBodySignature } = require('../dist/nayax-spark-client');
const { digest } = require('../dist/util');
const { createRig, makeDoorAvailable, vault, contracts } = require('./helpers');
const { makeSyntheticConfig } = require('../../vault-contracts/tests/profile-fixtures');
function fixture(t, changes = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'vault-spark-test-'));
    const state = { calls: [], observations: [], feed: [], failAuth: false, failTrigger: false, failVoid: false, triggerError: null, voidError: null, now: Date.parse('2026-10-07T12:00:00Z'), cloudDown: false, currentId: null, feedReads: [] };
    const options = { machineId: crypto.randomUUID(), terminalId: '0434334921100366', terminalIdType: 1, nayaxMachineId: '71234996', hwSerial: '0434334921100366', siteId: 2,
        integratorId: '927', tokenId: 116383, tokenSecret: 'FixtureToken_0123456789abcdefghijklmNOPQRSTUVWXYZ', signKey: 'FixtureSignKey16Characters',
        apiBase: 'https://spark.example.test/api', environment: 'SANDBOX', sandboxConfirmed: true, preSelectionConfirmed: true, currency: 'USD', currencyConfirmed: true,
        signingProfile: 'CURRENT_GUID_SHA256', wireApiVersion: null, vendorApprovalReference: 'synthetic-vendor-fixture', maxTotalCents: 100000, acquiringOnlyConfirmed: true,
        acquiringCardBrands: ['VISA', 'MASTERCARD'], unsupportedCardBrands: ['SMC'], cardUidPolicy: 'REJECT_AMBIGUOUS', callbackTerminalIdRepresentation: 'HW_SERIAL',
        triggerReplayPolicy: 'DISABLED', cancelReplayPolicy: 'DISABLED', maxTriggerAttempts: 1, maxCancelAttempts: 1,
        journalPath: join(directory, 'test.spark-provider.sqlite'), now: () => state.now,
        readObservations: async () => { if (state.cloudDown)
            throw new Error('cloud secret'); return structuredClone(state.observations); },
        readReceiptFeed: async (after) => { state.feedReads.push(after); if (state.cloudDown)
            throw new Error('cloud secret'); const start = Number(after), rows = state.feed.slice(start, start + 100); return { observations: structuredClone(rows), nextCursor: String(start + rows.length), hasMore: start + rows.length < state.feed.length }; },
        fetchImpl: async (url, init) => {
            const body = JSON.parse(init.body);
            state.calls.push({ url, ...init, rawBody: init.body, body });
            if (state.rawResponse) return new Response(state.rawResponse, {status:200});
            if (url.endsWith('/StartAuthentication')) {
                const decipher = crypto.createDecipheriv('aes-256-ecb', Buffer.from(options.tokenSecret.slice(-32)), null);
                state.currentId = Buffer.concat([decipher.update(Buffer.from(body.Cipher, 'base64')), decipher.final()]).toString().slice(0, 36);
                if (state.failAuth)
                    throw new Error('private token');
                return Response.json({ HashedSparkTransactionId: crypto.createHash('sha256').update(state.currentId).digest('hex'), Status: { Verdict: 'Approved' } });
            }
            if (url.endsWith('/TriggerTransaction')) {
                if (state.failTrigger)
                    throw new Error('private token');
                return Response.json({ SparkTransactionId: body.SparkTransactionId, Status: state.triggerError == null ? { Verdict: 'Approved' } : { Verdict: 'Declined', ErrorCode: state.triggerError } });
            }
            if (url.endsWith('/CancelTransaction')) {
                if (state.failVoid)
                    throw new Error('private token');
                return Response.json({ SparkTransactionId: body.SparkTransactionId, Status: state.voidError == null ? { Verdict: 'Approved' } : { Verdict: 'Declined', ErrorCode: state.voidError } });
            }
            throw new Error('Unexpected endpoint');
        }, ...changes };
    const adapters = [];
    const reopen = () => { const adapter = new NayaxSparkTestAdapter(options); adapters.push(adapter); return adapter; };
    const payment = reopen();
    t.after(() => { for (const a of adapters)
        a.close(); rmSync(directory, { recursive: true, force: true }); });
    const approved = (patch = {}) => ({ receiptId: `spark-sandbox:${crypto.randomBytes(32).toString('hex')}`, kind: 'TRANSACTION', sparkTransactionId: state.currentId, nayaxTransactionId: '2004545072',
        machineId: options.nayaxMachineId, terminalId: options.callbackTerminalIdRepresentation === 'HW_SERIAL' ? options.hwSerial : options.nayaxMachineId, hwSerial: options.hwSerial, siteId: 2,
        amountCents: 2500, currency: 'USD', currencySource: 'CALLBACK', verdict: 'Approved', errorCode: 0, machineAuTime: '20261007120000123', methodClassification: 'ACQUIRING',
        methodProfileDigest: digest({ acquiringCardBrands: options.acquiringCardBrands, acquiringOnlyConfirmed: true, callbackTerminalIdRepresentation: options.callbackTerminalIdRepresentation, cardUidPolicy: options.cardUidPolicy, unsupportedCardBrands: options.unsupportedCardBrands }),
        methodEvidence: { cardUidPresent: false, cardBrandClass: 'SUPPORTED_ACQUIRING', authCodePresent: true, rrnPresent: true }, ...patch });
    const declined = (patch = {}) => approved({ kind: 'DECLINE', verdict: 'Declined', errorCode: 44, nayaxTransactionId: null, terminalId: null, siteId: null, amountCents: null, currency: null, currencySource: null, machineAuTime: null,
        methodClassification: patch.kind === 'TRANSACTION' ? 'ACQUIRING' : 'AMBIGUOUS',
        methodEvidence: { cardUidPresent: false, cardBrandClass: 'ABSENT', authCodePresent: false, rrnPresent: false }, ...patch });
    return { options, state, payment, reopen, approved, declined };
}
function request(patch = {}) { return { idempotencyKey: crypto.randomUUID(), saleId: crypto.randomUUID(), mode: 'CERTIFICATION', currency: 'USD', totalCents: 2500, items: [{ lineId: crypto.randomUUID(), name: 'Sports pack', priceCents: 2500 }], ...patch }; }
async function captured(f) { const purchase = request(); const pending = await f.payment.startSession(purchase); f.state.observations = [f.approved()]; const result = await f.payment.reconcile(pending.providerSessionId); assert.equal(result.state, 'SETTLED'); return { purchase, pending, result }; }
function voidRequest(f, record, patch = {}) { return { actionId: crypto.randomUUID(), saleId: record.purchase.saleId, providerSessionId: record.result.providerSessionId, providerTransactionId: record.result.providerTransactionId, bindingDigest: f.payment.bindingDigest, amountCents: 2500, currency: 'USD', reason: 'Staff verified service was not provided', ...patch }; }
test('cipher includes GUID/random/UTC minute with token suffix and PKCS7', () => {
    const id = '12c7cec2-c690-4425-9a1f-db0db60e2d8c', token = 'prefix_0123456789abcdefghijklmnopqrstuv';
    const encoded = sparkAuthenticationCipher(id, token, 'Ab0123456789CdefG', new Date('2026-10-02T23:47:59Z'));
    assert.equal(Buffer.from(encoded, 'base64').length, 80);
    const decipher = crypto.createDecipheriv('aes-256-ecb', Buffer.from(token.slice(-32)), null);
    assert.equal(Buffer.concat([decipher.update(Buffer.from(encoded, 'base64')), decipher.final()]).toString(), `${id}=Ab0123456789CdefG2610022347`);
});
test('selected signatures use exact body text; manual auth omits plaintext GUID', async (t) => {
    for (const profile of ['CURRENT_GUID_SHA256', 'MANUAL_BODY_SHA256']) {
        const f = fixture(t, { signingProfile: profile });
        const pending = await f.payment.startSession(request());
        assert.equal(pending.state, 'REQUESTED');
        for (const call of f.state.calls) {
            const raw = call.body;
            assert.equal(call.headers.IntegratorId, '927');
            if (profile === 'MANUAL_BODY_SHA256') {
                assert.equal(call.headers.Signature, sparkBodySignature(JSON.stringify(raw), f.options.signKey));
                assert.equal(call.headers.TransactionSignature, undefined);
            }
            else {
                assert.equal(call.headers.TransactionSignature, sparkTransactionSignature(pending.providerSessionId, f.options.signKey));
                assert.equal(call.headers.Signature, undefined);
            }
        }
        const [auth, trigger] = f.state.calls;
        assert.equal(auth.body.SparkTransactionId, profile === 'CURRENT_GUID_SHA256' ? pending.providerSessionId : undefined);
        assert.equal(trigger.body.Amount, 25);
        assert.equal(trigger.body.TransactionTimeout, 60);
        assert.match(trigger.body.PosDisplay, /Total:USD 25\.00/);
        assert.equal((await f.payment.capabilities()).apiVersion, null);
        assert.equal(statSync(f.options.journalPath).mode & 0o777, 0o600);
    }
});
test('capture is durable and permits offline reconciliation without a second trigger', async (t) => {
    const f = fixture(t);
    const r = await captured(f);
    f.payment.close();
    const recovered = f.reopen();
    f.state.cloudDown = true;
    assert.deepEqual(await recovered.reconcileRequest(r.purchase.idempotencyKey), r.result);
    assert.equal(f.state.calls.length, 2);
});
test('approved callback requires original time, exact binding, method profile and complete amount', async (t) => {
    for (const patch of [{ amountCents: null }, { machineAuTime: null }, { machineAuTime: '20260230120000000' }, { methodClassification: 'AMBIGUOUS' },
        { methodProfileDigest: '0'.repeat(64) }, { terminalId: 'other' }, { amountCents: 2499 }, { siteId: 3 }, { currency: 'EUR' },
        { methodEvidence: { cardUidPresent: true, cardBrandClass: 'SUPPORTED_ACQUIRING', authCodePresent: true, rrnPresent: true } }]) {
        const f = fixture(t);
        const p = await f.payment.startSession(request());
        f.state.observations = [f.approved(patch)];
        assert.equal((await f.payment.reconcile(p.providerSessionId)).state, 'UNKNOWN');
        assert.ok((await f.payment.pollEvidence()).length);
    }
});
test('ordinary negative variants release a single attempt without inventing missing amount', async (t) => {
    for (const variant of [{ kind: 'DECLINE', errorCode: 38 }, { kind: 'DECLINE', errorCode: 44 }, { kind: 'DECLINE', errorCode: 45 },
        { kind: 'TRANSACTION', errorCode: 37, nayaxTransactionId: '2004545072', siteId: 2, terminalId: '0434334921100366', machineAuTime: '20261007120000123' }]) {
        const f = fixture(t);
        const p = await f.payment.startSession(request());
        f.state.observations = [f.declined(variant)];
        assert.equal((await f.payment.reconcile(p.providerSessionId)).state, 'DECLINED');
        assert.equal(f.state.calls.length, 2);
    }
});
test('authentication transport failure is no-payment; uncertain wake response remains held', async (t) => {
    const auth = fixture(t);
    auth.state.failAuth = true;
    assert.equal((await auth.payment.startSession(request())).state, 'DECLINED');
    assert.equal(auth.state.calls.length, 1);
    for (const error of [24, 992, 997, 999]) {
        const f = fixture(t);
        f.state.triggerError = error;
        const p = await f.payment.startSession(request());
        assert.equal(p.state, 'UNKNOWN');
        f.payment.close();
        const recovered = f.reopen();
        assert.equal((await recovered.reconcile(p.providerSessionId)).state, 'UNKNOWN');
        assert.equal(f.state.calls.length, 2);
    }
    const f = fixture(t);
    f.state.triggerError = 25;
    assert.equal((await f.payment.startSession(request())).state, 'DECLINED');
});
test('identical GUID/body retries require confirmed policy, elapsed wait, remaining budget and unexpired auth', async (t) => {
    const f = fixture(t, { triggerReplayPolicy: 'SAME_GUID_CONFIRMED_FINAL', maxTriggerAttempts: 3 });
    f.state.failTrigger = true;
    const purchase = request();
    const p = await f.payment.startSession(purchase);
    await f.payment.reconcile(p.providerSessionId);
    assert.equal(f.state.calls.length, 2);
    f.state.now += 60000;
    await Promise.all([f.payment.reconcile(p.providerSessionId), f.payment.startSession(purchase), f.payment.reconcile(p.providerSessionId)]);
    assert.equal(f.state.calls.length, 3);
    assert.deepEqual(f.state.calls[1].body, f.state.calls[2].body);
    f.state.now += 600000;
    assert.equal((await f.payment.reconcile(p.providerSessionId)).state, 'UNKNOWN');
    assert.equal(f.state.calls.length, 3);
    f.state.observations = [f.approved()];
    assert.equal((await f.payment.reconcile(p.providerSessionId)).state, 'SETTLED');
});
test('default disabled replay never sends again after expiry or restart', async (t) => {
    const f = fixture(t);
    f.state.failTrigger = true;
    const p = await f.payment.startSession(request());
    f.state.now += 3600000;
    f.payment.close();
    const recovered = f.reopen();
    assert.equal((await recovered.reconcile(p.providerSessionId)).state, 'UNKNOWN');
    assert.equal(f.state.calls.length, 2);
});
test('conflicting callbacks persist across response order and late capture raises durable notice', async (t) => {
    const f = fixture(t);
    const p = await f.payment.startSession(request());
    f.state.observations = [f.declined()];
    assert.equal((await f.payment.reconcile(p.providerSessionId)).state, 'DECLINED');
    f.state.observations = [f.approved()];
    assert.equal((await f.payment.reconcile(p.providerSessionId)).state, 'UNKNOWN');
    const notices = await f.payment.pollEvidence();
    assert.equal(notices[0].captureConfirmed, true);
    f.payment.close();
    const reopened = f.reopen();
    assert.equal((await reopened.pollEvidence())[0].noticeId, notices[0].noticeId);
    await reopened.acknowledgeEvidence(notices[0].noticeId);
    assert.equal((await reopened.pollEvidence()).length, 0);
});
test('distinct captures and same transaction with different machine times cannot win by arrival order', async (t) => {
    for (const patch of [{ nayaxTransactionId: '2004545073' }, { machineAuTime: '20261007120000124' }]) {
        const f = fixture(t);
        const r = await captured(f);
        f.state.observations = [f.approved(patch)];
        assert.equal((await f.payment.reconcile(r.result.providerSessionId)).state, 'UNKNOWN');
        assert.equal((await f.payment.pollEvidence())[0].code, 'SPARK_CONFLICTING_CAPTURE');
    }
});
test('global feed detects late conflicts for finalized sales and cursor survives restart', async (t) => {
    const f = fixture(t);
    const r = await captured(f);
    f.state.feed = [f.approved({ nayaxTransactionId: '2004545073' })];
    assert.equal((await f.payment.pollEvidence())[0].code, 'SPARK_CONFLICTING_CAPTURE');
    f.payment.close();
    const reopened = f.reopen();
    await reopened.pollEvidence();
    assert.deepEqual(f.state.feedReads, ['0', '1']);
    assert.equal(f.state.calls.length, 2);
    assert.equal((await reopened.reconcile(r.result.providerSessionId)).state, 'UNKNOWN');
});
test('paid void freezes original IDs/time/full amount; duplicate action never creates another operation', async (t) => {
    const f = fixture(t);
    const r = await captured(f);
    const action = voidRequest(f, r);
    const result = await f.payment.voidPaidTransaction(action);
    assert.equal(result.state, 'VOIDED');
    const call = f.state.calls[2];
    assert.equal(call.body.CancellationType, 2);
    assert.equal(call.body.MachineAuTime, '20261007120000123');
    assert.equal(call.body.CancelAmount, 25);
    assert.equal(call.body.SparkTransactionId, r.result.providerSessionId);
    assert.deepEqual(await f.payment.voidPaidTransaction(action), result);
    assert.equal(f.state.calls.length, 3);
    assert.equal((await f.payment.reconcile(r.result.providerSessionId)).state, 'SETTLED');
    await assert.rejects(f.payment.voidPaidTransaction({ ...action, reason: 'Different support reason' }));
    await assert.rejects(f.payment.voidPaidTransaction({ ...action, actionId: crypto.randomUUID() }));
});
test('ambiguous void replays only identical approved action under explicit bounded policy', async (t) => {
    for (const confirmed of [false, true]) {
        const f = fixture(t, confirmed ? { cancelReplayPolicy: 'SAME_REQUEST_CONFIRMED', maxCancelAttempts: 2 } : {});
        const r = await captured(f);
        const action = voidRequest(f, r);
        f.state.failVoid = true;
        assert.equal((await f.payment.voidPaidTransaction(action)).state, 'UNKNOWN');
        f.payment.close();
        const recovered = f.reopen();
        f.state.now += 60000;
        f.state.failVoid = false;
        assert.equal((await recovered.voidPaidTransaction(action)).state, confirmed ? 'VOIDED' : 'UNKNOWN');
        assert.equal(f.state.calls.length, confirmed ? 4 : 3);
        if (confirmed)
            assert.deepEqual(f.state.calls[2].body, f.state.calls[3].body);
    }
});
test('already-cancelled does not prove a full paid void and IDs serialize beyond Number precision', async (t) => {
    const f = fixture(t);
    const purchase = request(), p = await f.payment.startSession(purchase);
    f.state.observations = [f.approved({ nayaxTransactionId: '9223372036854775807' })];
    const result = await f.payment.reconcile(p.providerSessionId);
    f.state.voidError = 28;
    const action = voidRequest(f, { purchase, result });
    assert.equal((await f.payment.voidPaidTransaction(action)).state, 'UNKNOWN');
    assert.match(f.state.calls[2].rawBody, /"NayaxTransactionId":9223372036854775807,/);
});
test('startup audit finds orphan and missing provider journals without issuing network mutations', async (t) => {
    const f = fixture(t);
    const r = await captured(f);
    const notices = await f.payment.auditRecovery({ sales: [], voids: [] });
    assert.equal(notices[0].code, 'SPARK_ORPHAN_JOURNAL_SESSION');
    assert.equal(f.state.calls.length, 2);
    f.payment.close();
    unlinkSync(f.options.journalPath);
    assert.throws(() => f.reopen(), { code: 'SPARK_JOURNAL_ANCHOR_MISMATCH' });
});
test('profiles are immutable and confirmations/limits are required before any remote call', async (t) => {
    const f = fixture(t);
    f.payment.close();
    for (const patch of [{ acquiringOnlyConfirmed: false }, { maxTotalCents: 0 }, { vendorApprovalReference: '' }, { signingProfile: 'automatic' }, { wireApiVersion: undefined }, { currencyConfirmed: false }])
        assert.throws(() => new NayaxSparkTestAdapter({ ...f.options, ...patch }));
    for (const patch of [{ cardUidPolicy: 'ALLOW_CONFIRMED_ACQUIRING' }, { maxTotalCents: 100001 }, { callbackTerminalIdRepresentation: 'MACHINE_ID' }, { signingProfile: 'MANUAL_BODY_SHA256' }])
        assert.throws(() => new NayaxSparkTestAdapter({ ...f.options, ...patch }));
    assert.equal(f.state.calls.length, 0);
});
test('VaultMachine creates exactly one simulated door group after complete Spark capture', async (t) => {
    const f = fixture(t);
    const rig = await createRig({ machineId: f.options.machineId, payment: f.payment, configure: false });
    t.after(() => rig.store.close());
    const generated = makeSyntheticConfig(rig.machineId, 1, rig.keyPair.privateKey, 7);
    const signed = { payload: generated.payload, digest: contracts.configDigest(generated.payload), keyId: 'test-config-key', algorithm: 'Ed25519', signature: crypto.sign(null, Buffer.from(contracts.canonicalJson(generated.payload)), rig.keyPair.privateKey).toString('base64') };
    rig.machine = new vault.VaultMachine(rig.store, f.payment, new vault.DeterministicControllerSimulator(signed.payload.doorMapping), { pinnedConfigKeys: { 'test-config-key': rig.keyPair.publicKey.export({ type: 'spki', format: 'pem' }) }, appVersion: '0.1.0', clock: rig.clock });
    rig.machine.stageConfig(signed);
    assert.equal(rig.machine.activatePendingConfig().activated, true);
    rig.machine.markCloudContact();
    const door = signed.payload.machineProfile.doors[3].doorId;
    makeDoorAvailable(rig, [door]);
    rig.machine.selectCartDoor(door, 'sports-25', true);
    const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: [door] })).sale;
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM command_intent WHERE sale_id=?', sale.saleId).n, 0);
    f.state.observations = [f.approved({ amountCents: sale.totalCents })];
    assert.equal((await rig.machine.reconcileSale(sale.saleId)).paymentState, 'SETTLED');
    await rig.machine.reconcileSale(sale.saleId);
    assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM command_intent WHERE sale_id=?', sale.saleId).n, 1);
    assert.equal(f.state.calls.length, 2);
});

test('duplicate response keys never turn an ambiguous paid void into success', async t => {
  const f=fixture(t);const record=await captured(f);const action=voidRequest(f,record);
  f.state.rawResponse=`{"SparkTransactionId":"${record.result.providerSessionId}","Status":{"Verdict":"Declined","Verdict":"Approved"}}`;
  assert.equal((await f.payment.voidPaidTransaction(action)).state,'UNKNOWN');
});

test('clock rollback cannot extend replay eligibility or consume a second attempt', async t => {
  const f=fixture(t,{triggerReplayPolicy:'SAME_GUID_CONFIRMED_FINAL',maxTriggerAttempts:3});f.state.failTrigger=true;
  const p=await f.payment.startSession(request());f.state.now-=60_000;
  assert.equal((await f.payment.reconcile(p.providerSessionId)).state,'UNKNOWN');assert.equal(f.state.calls.length,2);
});

test('legacy profile negative is quarantined while ordered receipt cursor still advances', async t => {
  const f=fixture(t);const p=await f.payment.startSession(request());f.state.feed=[f.declined({methodProfileDigest:'0'.repeat(64)})];
  const notices=await f.payment.pollEvidence();assert.equal(notices[0].code,'SPARK_OBSERVATION_BINDING_INVALID');
  assert.equal((await f.payment.reconcile(p.providerSessionId)).state,'UNKNOWN');f.payment.close();const reopened=f.reopen();
  await reopened.pollEvidence();assert.equal(f.state.feedReads.at(-1),'1');assert.equal(f.state.calls.length,2);
});

test('confirmed terminal type 2 compares callback representation separately from machine identity', async t => {
  for(const representation of ['HW_SERIAL','MACHINE_ID']){
    const f=fixture(t,{terminalId:'71234996',terminalIdType:2,callbackTerminalIdRepresentation:representation});
    const p=await f.payment.startSession(request());f.state.observations=[f.approved()];
    assert.equal((await f.payment.reconcile(p.providerSessionId)).state,'SETTLED');
    assert.equal(f.state.calls[1].body.TerminalId,'71234996');assert.equal(f.state.calls[1].body.TerminalIdType,2);
  }
});

test('read-only reconciliation cannot replay even when its configured budget permits it', async t => {
  const f=fixture(t,{triggerReplayPolicy:'SAME_GUID_CONFIRMED_FINAL',maxTriggerAttempts:3});f.state.failTrigger=true;
  const purchase=request(),pending=await f.payment.startSession(purchase);f.state.now+=60_000;
  await f.payment.reconcile(pending.providerSessionId,{allowReplay:false});await f.payment.reconcileRequest(purchase.idempotencyKey,{allowReplay:false});
  assert.equal(f.state.calls.length,2);
});

test('invalid monetary evidence still emits a safe durable anomaly', async t => {
  const f=fixture(t);const p=await f.payment.startSession(request());f.state.observations=[f.approved({amountCents:-1,nayaxTransactionId:'bad-id'})];
  assert.equal((await f.payment.reconcile(p.providerSessionId)).state,'UNKNOWN');const notice=(await f.payment.pollEvidence())[0];
  assert.equal(notice.amountCents,null);assert.equal(notice.providerTransactionId,null);
});

function recoverySnapshot(f, record, voids) {
  return {sales:[{saleId:record.purchase.saleId,requestKey:record.purchase.idempotencyKey,requestDigest:record.result.originalRequestDigest,
    providerSessionId:record.result.providerSessionId,providerTransactionId:record.result.providerTransactionId,bindingDigest:f.payment.bindingDigest,
    totalCents:2500,currency:'USD',paymentState:'SETTLED',hasCommittedFulfillment:true}],voids};
}

test('older provider-journal restore cannot recreate a retained main void intent, including after restart', async t => {
  const f=fixture(t,{cancelReplayPolicy:'SAME_REQUEST_CONFIRMED',maxCancelAttempts:3});const record=await captured(f);const action=voidRequest(f,record);
  f.payment.close();const beforeVoid=readFileSync(f.options.journalPath);const live=f.reopen();f.state.failVoid=true;
  assert.equal((await live.voidPaidTransaction(action)).state,'UNKNOWN');assert.equal(f.state.calls.filter(c=>c.url.endsWith('/CancelTransaction')).length,1);live.close();
  // Restore the provider database to a complete captured sale before the lost void,
  // while the main ledger still retains the later uncertain action.
  writeFileSync(f.options.journalPath,beforeVoid);const restored=f.reopen();f.state.now+=60_000;f.state.failVoid=false;
  const notices=await restored.auditRecovery(recoverySnapshot(f,record,[{actionId:action.actionId,saleId:record.purchase.saleId,state:'UNKNOWN'}]));
  assert.ok(notices.some(n=>n.code==='SPARK_VOID_INTENT_UNBOUND'));
  await assert.rejects(restored.voidPaidTransaction(action),{code:'SPARK_JOURNAL_VOID_RECOVERY_BLOCKED'});
  restored.close();const restarted=f.reopen();
  // The block itself is durable; even before a repeated audit no cancellation can run.
  await assert.rejects(restarted.voidPaidTransaction(action),{code:'SPARK_JOURNAL_VOID_RECOVERY_BLOCKED'});
  assert.equal(f.state.calls.filter(c=>c.url.endsWith('/CancelTransaction')).length,1);
});

test('provider terminal void result safely completes a lagging main intent without another cancellation', async t => {
  const f=fixture(t);const record=await captured(f);const action=voidRequest(f,record);const original=await f.payment.voidPaidTransaction(action);
  const notices=await f.payment.auditRecovery(recoverySnapshot(f,record,[{actionId:action.actionId,saleId:record.purchase.saleId,state:'INTENT'}]));
  assert.equal(notices.length,0);assert.deepEqual(await f.payment.voidPaidTransaction(action),original);
  assert.equal(f.state.calls.filter(c=>c.url.endsWith('/CancelTransaction')).length,1);
});

test('terminal main/provider void disagreement blocks even an otherwise eligible exact replay', async t => {
  const f=fixture(t,{cancelReplayPolicy:'SAME_REQUEST_CONFIRMED',maxCancelAttempts:3});const record=await captured(f);const action=voidRequest(f,record);f.state.failVoid=true;
  await f.payment.voidPaidTransaction(action);f.state.now+=60_000;f.state.failVoid=false;
  const notices=await f.payment.auditRecovery(recoverySnapshot(f,record,[{actionId:action.actionId,saleId:record.purchase.saleId,state:'VOIDED'}]));
  assert.ok(notices.some(n=>n.code==='SPARK_VOID_JOURNAL_MISMATCH'));
  await assert.rejects(f.payment.voidPaidTransaction(action),{code:'SPARK_JOURNAL_VOID_RECOVERY_BLOCKED'});
  assert.equal(f.state.calls.filter(c=>c.url.endsWith('/CancelTransaction')).length,1);
});

test('durable unstarted retirement proves no provider intent and prevents every later transport', async t => {
    const f = fixture(t), record = await captured(f), action = voidRequest(f, record), hash = 'd'.repeat(64);
    const before = f.state.calls.length;
    const proof = await f.payment.retireVoidAction(action.actionId, hash, 'EXPIRED_UNSTARTED');
    assert.match(proof.proofDigest, /^[a-f0-9]{64}$/);
    f.payment.close(); const reopened = f.reopen();
    assert.deepEqual(await reopened.retireVoidAction(action.actionId, hash, 'EXPIRED_UNSTARTED'), proof);
    await assert.rejects(reopened.retireVoidAction(action.actionId, 'e'.repeat(64), 'EXPIRED_UNSTARTED'), { code: 'SPARK_JOURNAL_VOID_RETIREMENT_CONFLICT' });
    await assert.rejects(reopened.voidPaidTransaction(action), { code: "SPARK_JOURNAL_VOID_RETIRED" });
    assert.equal(f.state.calls.length, before);
});

test('started UNKNOWN void cannot retire as unstarted; exact external review persists without confirmed funds', async t => {
    const f = fixture(t), record = await captured(f), action = voidRequest(f, record);
    f.state.failVoid = true; assert.equal((await f.payment.voidPaidTransaction(action)).state, 'UNKNOWN');
    const before = f.state.calls.length, evidence = await f.payment.financialRecoveryEvidence();
    await assert.rejects(f.payment.retireVoidAction(action.actionId, 'd'.repeat(64), 'EXPIRED_UNSTARTED'), { code: "SPARK_JOURNAL_VOID_ALREADY_STARTED" });
    const proof = await f.payment.retireVoidAction(action.actionId, 'd'.repeat(64), 'EXTERNAL_REVIEW');
    assert.equal(proof.reason, 'EXTERNAL_REVIEW');
    assert.equal((await f.payment.financialRecoveryEvidence()).evidenceDigest, evidence.evidenceDigest);
    f.payment.close(); const reopened = f.reopen();
    await assert.rejects(reopened.voidPaidTransaction(action), { code: 'SPARK_JOURNAL_VOID_RETIRED' });
    assert.equal(f.state.calls.length, before);
    assert.equal((await reopened.reconcile(record.pending.providerSessionId, { allowReplay: false })).state, 'SETTLED');
});

test('financial snapshot requires caught-up receipt feed and never clears missing-void-journal recovery', async t => {
    const f = fixture(t), record = await captured(f), action = voidRequest(f, record);
    f.state.cloudDown = true;
    assert.ok((await f.payment.financialRecoveryEvidence()).blockers.includes('SPARK_RECEIPT_FEED_UNAVAILABLE'));
    f.state.cloudDown = false;
    await f.payment.auditRecovery({ sales: [], voids: [{ actionId: action.actionId, saleId: action.saleId, state: 'UNKNOWN' }] });
    assert.ok((await f.payment.financialRecoveryEvidence()).blockers.includes('SPARK_VOID_RECOVERY_BLOCKED'));
    await assert.rejects(f.payment.retireVoidAction(action.actionId, 'd'.repeat(64), 'EXPIRED_UNSTARTED'), { code: "SPARK_JOURNAL_VOID_RECOVERY_BLOCKED" });
    await assert.rejects(f.payment.retireVoidAction(action.actionId, 'd'.repeat(64), 'EXTERNAL_REVIEW'), { code: "SPARK_JOURNAL_VOID_RECOVERY_BLOCKED" });
});

test('void transport guard is evaluated after the real Spark adapter queue wait and before any attempt bytes', async t => {
    const f = fixture(t), record = await captured(f), action = voidRequest(f, record);
    let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    f.options.readReceiptFeed = async after => { entered(); await new Promise(resolve => { release = resolve; }); return { observations: [], nextCursor: after, hasMore: false }; };
    f.payment.close(); f.payment = f.reopen();
    const poll = f.payment.financialRecoveryEvidence(); await waiting;
    let held = false, checks = 0; const before = f.state.calls.length;
    const operation = f.payment.voidPaidTransaction(action, { beforeTransport: () => { checks++; if (held) throw Error('machine technical hold'); } });
    held = true; release(); await poll;
    await assert.rejects(operation, /machine technical hold/); assert.equal(checks, 1); assert.equal(f.state.calls.length, before);
    // A gate rejection creates no attempt, so the exact retained action can run
    // once after separately resolving the hold; no replay policy is consumed.
    held = false; assert.equal((await f.payment.voidPaidTransaction(action, { beforeTransport: () => assert.equal(held, false) })).state, 'VOIDED');
    assert.equal(f.state.calls.length, before + 1);
});
