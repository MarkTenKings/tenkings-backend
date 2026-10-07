const test = require('node:test');
const assert = require('node:assert/strict');
const { createRig, makeDoorAvailable, crypto, vault } = require('./helpers');

async function reserve(rig) {
  makeDoorAvailable(rig); rig.machine.selectCartDoor('X-01', 'sports-25', true);
  return (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: ['X-01'] })).sale;
}

test('provider-only authorization cannot consume a reserved door or create command authority', async t => {
  const rig = await createRig(); t.after(() => rig.store.close());
  rig.payment.scriptStart({ outcome: 'UNKNOWN' });
  const sale = await reserve(rig); await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
  const providerSessionId = rig.store.one('SELECT provider_session_id FROM sale WHERE sale_id=?', sale.saleId).provider_session_id;
  rig.payment.scriptReconcile({ outcome: 'AUTHORIZE' });
  await assert.rejects(rig.machine.handleProviderCallback({ callbackId: 'authorization-is-not-payment', saleId: sale.saleId,
    providerSessionId, sequence: 1, state: 'AUTHORIZED', occurredAt: rig.clock.now().toISOString(), evidence: {} }), { code: 'PAYMENT_CAPTURE_REQUIRED' });
  assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM command_intent').n, 0);
  assert.equal(rig.store.one("SELECT state FROM door WHERE door_id='X-01'").state, 'RESERVED');
  await assert.rejects(rig.machine.reconcileSale(sale.saleId), { code: 'PAYMENT_CAPTURE_REQUIRED' });
  assert.equal(rig.controller.receipts.length, 0);
});

test('reserved sale pins provider before its first network request and cannot switch automatically', async t => {
  const rig = await createRig(); t.after(() => rig.store.close());
  const sale = await reserve(rig); const caps = await rig.payment.capabilities(); let effects = 0;
  const pin = rig.store.one('SELECT * FROM sale_payment_binding WHERE sale_id=?', sale.saleId);
  assert.equal(pin.provider, 'SIMULATED'); assert.match(pin.binding_digest, /^[a-f0-9]{64}$/);
  rig.payment.capabilities = async () => ({ ...caps, provider: 'NAYAX_SPARK', bindingDigest: 'a'.repeat(64) });
  rig.payment.startSession = async () => { effects++; throw Error('wrong provider contacted'); };
  await assert.rejects(rig.machine.startPayment(sale.saleId, crypto.randomUUID()), { code: 'PAYMENT_BINDING_MISMATCH' });
  assert.equal(effects, 0); assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'NOT_REQUESTED');
  assert.throws(() => rig.store.run('UPDATE sale_payment_binding SET provider=? WHERE sale_id=?', 'STRIPE_TERMINAL', sale.saleId), /immutable/);
  assert.throws(() => rig.store.run('DELETE FROM sale_payment_binding WHERE sale_id=?', sale.saleId), /retained/);
});

test('pending payment cannot reconcile, cancel, or consume a callback with another terminal binding', async t => {
  const rig = await createRig(); t.after(() => rig.store.close());
  const originalCapabilities = await rig.payment.capabilities();
  rig.payment.capabilities = async () => ({ ...originalCapabilities, bindingDigest: 'a'.repeat(64) });
  rig.payment.scriptStart({ outcome: 'UNKNOWN' });
  const sale = await reserve(rig); await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
  const session = rig.store.one('SELECT provider_session_id FROM sale WHERE sale_id=?', sale.saleId).provider_session_id;
  let reads = 0, cancels = 0;
  rig.payment.capabilities = async () => ({ ...originalCapabilities, bindingDigest: 'b'.repeat(64) });
  rig.payment.reconcile = async () => { reads++; throw Error('wrong terminal contacted'); };
  rig.payment.cancelSession = async () => { cancels++; throw Error('wrong terminal contacted'); };
  await assert.rejects(rig.machine.reconcileSale(sale.saleId), { code: 'PAYMENT_BINDING_MISMATCH' });
  await assert.rejects(rig.machine.cancelPayment(sale.saleId, 'cancel-original-sale'), { code: 'PAYMENT_BINDING_MISMATCH' });
  await assert.rejects(rig.machine.handleProviderCallback({ callbackId: 'wrong-device', saleId: sale.saleId,
    providerSessionId: session, sequence: 1, state: 'SETTLED', occurredAt: rig.clock.now().toISOString(), evidence: {} }), { code: 'PAYMENT_BINDING_MISMATCH' });
  await rig.machine.initialize();
  assert.equal(reads, 0); assert.equal(cancels, 0); assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'RECONCILIATION_REQUIRED');
  assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM command_intent').n, 0);
});

test('official adapters without an exact binding fail before reservation', async t => {
  const rig = await createRig(); t.after(() => rig.store.close());
  const caps = await rig.payment.capabilities();
  rig.payment.capabilities = async () => ({ ...caps, provider: 'NAYAX_SPARK', mode: 'OFFICIAL_TEST' });
  await assert.rejects(reserve(rig), { code: 'PAYMENT_BINDING_UNAVAILABLE' });
  assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM sale').n, 0);
});
