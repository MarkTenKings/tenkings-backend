import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedFinance, assertHostedFinanceBinding } from '../src/host-finance.mjs';
import { syntheticFulfillmentEvidence } from '../scripts/local-fixture.mjs';
import { compose, config, NOW, signed, actors, webhook, deferred } from './host-finance-fixtures.mjs';

const eventFor = (f, paymentId, id = 'evt_host_paid', type = 'payment_intent.succeeded') => ({ id, object: 'event', livemode: false, type, created: Math.floor(NOW/1000) - 86400, data: { object: { id: f.store.read(state => state.intents[paymentId].objectId), object: 'payment_intent', metadata: { atlas_marketplace_intent: paymentId } } } });

test('host remains inert/default off; exact shared dependency brand and readiness cannot be reconstructed or bypassed', async t => {
  const disabled = createHostedFinance(); await assert.rejects(disabled.runOnce(), { code: 'HOST_FINANCE_DISABLED' });
  await assert.rejects(disabled.receiveProviderWebhook({}), { code: 'HOST_FINANCE_DISABLED' }); assert.throws(() => disabled.start(), { code: 'HOST_FINANCE_DISABLED' });
  let allowed = true; const f = compose({ readiness: () => allowed }); t.after(() => f.store.close());
  assert.equal(f.counts.identities, 0); assert.equal(f.store.read().financeSchedules, undefined);
  const expected = { store: f.store, provider: f.provider, service: f.service, settlementCapability: f.capability, environment: config.environment, platformAccountId: config.platformAccountId };
  assert.equal(assertHostedFinanceBinding(f.host, expected), true);
  assert.throws(() => assertHostedFinanceBinding({ ...f.host }, expected), { code: 'HOST_FINANCE_BINDING_MISMATCH' });
  assert.throws(() => assertHostedFinanceBinding(f.host, { ...expected, store: { ...f.store } }), { code: 'HOST_FINANCE_BINDING_MISMATCH' });
  assert.throws(() => createHostedFinance({ ...f.options, config: { ...config, secretKey: 'not-allowed' } }), { code: 'HOST_FINANCE_CONFIG_REQUIRED' });
  assert.throws(() => createHostedFinance({ ...f.options, assertRuntimeReady: async () => { throw new Error('async refusal'); } }), { code: 'HOST_FINANCE_UNQUALIFIED' });
  allowed = false; await assert.rejects(f.host.runOnce({ runId: 'refused' }), { code: 'HOST_FINANCE_UNQUALIFIED' }); assert.equal(f.counts.identities, 0);
});

test('raw signatures precede all financial effects; duplicate and delayed deliveries settle the original exactly once', async t => {
  const f = compose(); t.after(() => f.store.close()); const { reservation, paymentId } = await f.reserve();
  f.provider.resolve(paymentId, { status: 'succeeded', processingFeeCents: 300 });
  const input = signed(eventFor(f, paymentId));
  await assert.rejects(f.host.receiveProviderWebhook({ ...input, rawBody: Buffer.concat([input.rawBody, Buffer.from(' ')]) }), { code: 'INVALID_WEBHOOK_SIGNATURE' });
  assert.equal(f.store.read().financeWebhooks, undefined); assert.equal(f.store.read().journals.length, 0); assert.equal(Object.keys(f.store.read().orders).length, 0);
  assert.equal((await f.host.receiveProviderWebhook(input)).status, 'SUCCEEDED');
  const count = f.store.read().journals.length;
  await Promise.all([f.host.receiveProviderWebhook(input), f.host.receiveProviderWebhook(input)]);
  await f.host.receiveProviderWebhook(signed(eventFor(f, paymentId, 'evt_delayed_failed', 'payment_intent.payment_failed')));
  const after = f.store.read(); assert.equal(after.journals.length, count); assert.equal(after.orders[reservation.orderId].status, 'PAID');
  assert.equal(Object.keys(after.orders).length, 1); assert.equal(after.syntheticProvider.calls[paymentId], 1);
  assert.equal(JSON.stringify(after.financeOperationalAlerts).includes('whsec_'), false);
});

test('provider outage retains retry evidence; restart GET recovery settles the original and never clears the failed delivery', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-host-finance-'))), filename = join(directory, 'owned.sqlite');
  let f = compose({ filename });
  try {
    const { reservation, paymentId } = await f.reserve(); f.provider.resolve(paymentId, { status: 'succeeded', processingFeeCents: 300 });
    // Provider is fixed at construction; fail the underlying fixture's next GET
    // via a separate service wrapper while retaining the exact host dependency.
    const unavailable = { ...f.provider, retrieve: async () => { const error = new Error('sk_test_never_retained'); error.code = 'PROVIDER_UNAVAILABLE'; throw error; } };
    const { createMarketplacePilot } = await import('../src/service.mjs');
    const { createLocalFixture } = await import('../scripts/local-fixture.mjs');
    const fixture = createLocalFixture({ store: f.store, clock: () => NOW, assets: false });
    const service = createMarketplacePilot({ ...fixture, provider: unavailable, store: f.store, enabled: true, environment: config.environment, platformAccountId: config.platformAccountId, recoverySettlementCapability: f.capability, clock: () => NOW, webhook });
    const host = createHostedFinance({ ...f.options, provider: unavailable, service });
    await assert.rejects(host.receiveProviderWebhook(signed(eventFor(f, paymentId))), { code: 'PROVIDER_UNAVAILABLE' });
    assert.equal(f.store.read().financeWebhooks.evt_host_paid.status, 'RETRY_REQUIRED'); assert.equal(Object.keys(f.store.read().orders).length, 0);
    f.store.close(); f = compose({ filename });
    const result = await f.host.runOnce({ runId: 'restart_original' });
    assert.deepEqual(result.settledIntentIds, [paymentId]);
    const after = f.store.read(); assert.equal(after.orders[reservation.orderId].status, 'PAID'); assert.equal(after.syntheticProvider.calls[paymentId], 1);
    assert.equal(after.financeWebhooks.evt_host_paid.status, 'RETRY_REQUIRED');
    assert.ok(Object.values(after.financeExceptions).some(row => row.status === 'OPEN'));
    assert.equal(JSON.stringify(after).includes('sk_test_'), false);
    const journals = after.journals.length; await f.host.runOnce({ runId: 'restart_original' }); assert.equal(f.store.read().journals.length, journals);
  } finally { f.store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('lost create response uses discovery and original GET, settles once and reconciles both accounts without another create', async t => {
  const f = compose(); t.after(() => f.store.close()); const { reservation, paymentId } = await f.reserve({ lostResponse: true });
  assert.equal(f.store.read().intents[paymentId].status, 'UNKNOWN'); assert.equal(f.store.read().intents[paymentId].objectId, null);
  f.provider.resolve(paymentId, { status: 'succeeded', processingFeeCents: 300 });
  const creates = f.counts.creates, result = await f.host.runOnce({ runId: 'lost_original' });
  assert.equal(result.status, 'COMPLETED'); assert.deepEqual(result.settledIntentIds, [paymentId]);
  const state = f.store.read(); assert.equal(state.orders[reservation.orderId].status, 'PAID');
  assert.equal(f.counts.creates, creates); assert.equal(state.syntheticProvider.calls[paymentId], 1);
  assert.ok(Object.values(state.financeReconciliationReports).every(row => row.status === 'RECONCILED' && row.differenceCents === 0));
});

test('unknown payable originals stay reserved; early dispute settles payment but retains the fulfillment hold', async t => {
  const f = compose(); t.after(() => f.store.close()); const { reservation, paymentId } = await f.reserve();
  const first = await f.host.runOnce({ runId: 'still_payable' }); assert.deepEqual(first.settledIntentIds, []);
  assert.equal(f.store.read().reservations[reservation.id].status, 'PAYMENT_PENDING');
  f.provider.resolve(paymentId, { status: 'succeeded' });
  const objectId = f.store.read(state => state.intents[paymentId].objectId);
  const input = signed({ id: 'evt_host_dispute', object: 'event', livemode: false, type: 'charge.dispute.created', data: { object: { id: 'du_host', object: 'dispute', payment_intent: objectId } } });
  assert.equal((await f.host.receiveProviderWebhook(input)).status, 'REVIEW_REQUIRED');
  const after = f.store.read(), order = after.orders[reservation.orderId]; assert.equal(order.status, 'PAID'); assert.equal(after.financeOrders[order.orderId].blocked, true);
  await assert.rejects(f.service.fulfill(actors.staff, { requestId: 'demo_pack_held', orderId: order.orderId, action: 'PACK', evidence: syntheticFulfillmentEvidence(order, 'PACK') }), { code: 'FINANCE_HOLD' });
  assert.ok((await f.host.snapshot()).alertCount > 0);
});

test('dual scoped hosted destinations accept connected events only with their bound secret; legacy-only configuration is refused', async t => {
  const f = compose(); t.after(() => f.store.close());
  const event = { id: 'evt_connected_host', object: 'event', livemode: false, type: 'account.updated', account: 'demo_connected', data: { object: { id: 'demo_connected', object: 'account' } } };
  const before = f.store.read();
  await assert.rejects(f.host.receiveProviderWebhook(signed(event)), { code: 'WEBHOOK_ENDPOINT_SCOPE_MISMATCH' });
  assert.deepEqual(f.store.read(), before);
  const result = await f.host.receiveProviderWebhook(signed(event, NOW, webhook.endpoints[1].secret)); assert.equal(result.status, 'RECONCILED');
  assert.equal(f.store.read().financeWebhooks[event.id].accountId, 'demo_connected');
  const binding = f.service.getHostedWebhookBinding(); assert.equal(JSON.stringify(binding).includes('whsec_'), false);
  const changedService = { ...f.service, getHostedWebhookBinding: () => ({ ...binding, endpoints: [binding.endpoints[0]] }) };
  assert.throws(() => createHostedFinance({ ...f.options, service: changedService }), { code: 'HOST_FINANCE_WEBHOOK_SCOPE_REQUIRED' });
});

test('whole-run deadline discards a late provider GET without detached reconciliation or a replacement create', async t => {
  const f = compose(); t.after(() => f.store.close()); const { paymentId } = await f.reserve(); f.provider.resolve(paymentId, { status: 'succeeded' });
  const gate = deferred(), entered = deferred();
  const provider = { ...f.provider, retrieve: async (...args) => { const evidence = await f.provider.retrieve(...args); entered.resolve(); await gate.promise; return evidence; } };
  const limited = { ...config, recovery: { ...config.recovery, maxDurationMs: 1000, concurrency: 1 }, finalizationBudgetMs: 500, schedule: { ...config.schedule, leaseMs: 2500 } };
  const host = createHostedFinance({ ...f.options, provider, config: limited }), work = host.runOnce({ runId: 'late_original_get' });
  await entered.promise; const result = await work;
  assert.ok(['INTERRUPTED','REVIEW_REQUIRED'].includes(result.recoveryStatus));
  assert.equal((await host.snapshot()).providerInFlightCount, 1);
  const calls = { ...f.counts }; const second = await host.runOnce({ runId: 'while_transport_alive' });
  assert.equal(second.recoveryStatus, 'ERROR'); assert.deepEqual(f.counts, calls);
  const before = f.store.read();
  assert.equal(before.intents[paymentId].confirmed, false); assert.equal(Object.keys(before.orders).length, 0);
  gate.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await host.snapshot()).providerInFlightCount, 0);
  assert.deepEqual(f.store.read(), before); assert.equal(before.syntheticProvider.calls[paymentId], 1);
});


test('tax reporting requires separate opt-in, runs after original settlement, and a reporting failure never reclassifies payment',async t=>{
 const f=compose();t.after(()=>f.store.close());const {reservation,paymentId}=await f.reserve();f.provider.resolve(paymentId,{status:'succeeded',processingFeeCents:300});
 let calls=0;const service={...f.service,async runTaxFollowup(capability,input){calls++;assert.equal(capability,f.capability);assert.equal(input.limit,2);assert.equal(input.signal.aborted,false);assert.equal(f.store.read().orders[reservation.orderId].status,'PAID');return {status:'REVIEW_REQUIRED',results:[{status:'UNKNOWN'}]};}};
 const inert=createHostedFinance({...f.options,service});await inert.runOnce({runId:'without_tax_optin'});assert.equal(calls,0);
 const host=createHostedFinance({...f.options,service,config:{...config,taxReporting:{enabled:true,maxItems:2,approvalRef:'fixture_separate_tax_reporting'}}});
 const result=await host.runOnce({runId:'with_tax_optin'});assert.equal(calls,1);assert.equal(result.status,'REVIEW_REQUIRED');assert.equal(result.taxReporting.status,'REVIEW_REQUIRED');assert.equal(f.store.read().intents[paymentId].status,'SUCCEEDED');assert.equal(f.store.read().orders[reservation.orderId].status,'PAID');assert.equal(f.store.read().syntheticProvider.calls[paymentId],1);
});
