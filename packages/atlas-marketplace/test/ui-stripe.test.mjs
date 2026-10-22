import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPaymentCollection, createStripePaymentSession } from '../ui/stripe-payment.mjs';

const expected = { reservationId: 'reservation_owned', intentId: 'intent_original', amountCents: 14700, currency: 'USD', environment: 'PROVIDER_SANDBOX' };
const collection = key => ({ strategy: 'stripe-payment-element', reservationId: expected.reservationId, intentId: expected.intentId, paymentIntentId: 'pi_fixture', clientSecret: 'pi_fixture_secret_ephemeral', publishableKey: `pk_test_${key}`, amountCents: expected.amountCents, currency: 'USD' });

test('Stripe collection rejects wrong reservation, intent, total, currency, secret binding and environment before mounting', () => {
  const value = collection('scope');
  for (const patch of [{ reservationId: 'someone_else' }, { intentId: 'new_intent' }, { amountCents: 1 }, { currency: 'EUR' }, { clientSecret: 'pi_other_secret_value' }, { publishableKey: 'pk_live_wrongmode' }]) assert.throws(() => assertPaymentCollection({ ...value, ...patch }, expected));
  assert.deepEqual(assertPaymentCollection(value, expected), { reservationId: expected.reservationId, intentId: expected.intentId, amountCents: expected.amountCents, currency: 'USD' });
});

test('Stripe confirmation keeps one original Element through 3DS, blocks duplicate submission and reconciles exact backend before cleanup', async () => {
  const events = {}, operations = [], submitButton = {}, noticeNode = {};
  let release, destroyed = 0, confirms = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const element = { on(name, fn) { events[name] = fn; }, mount(node) { operations.push(['mount', node]); events.ready(); }, destroy() { destroyed++; } };
  const elements = { create(type) { assert.equal(type, 'payment'); return element; }, async submit() { operations.push(['validated']); return {}; } };
  const stripe = { elements(options) { assert.equal(options.clientSecret, 'pi_fixture_secret_ephemeral'); return elements; }, async confirmPayment(options) { confirms++; assert.equal(options.elements, elements); assert.equal(options.confirmParams.return_url, 'https://marketplace.invalid/marketplace/'); assert.equal(options.redirect, 'if_required'); operations.push(['confirm']); await wait; return { paymentIntent: { status: 'succeeded' } }; } };
  const session = createStripePaymentSession({ collection: collection('confirm'), expected, mountNode: 'owned_node', submitButton, noticeNode, origin: 'https://marketplace.invalid', load: async () => () => stripe, onConfirmStart(binding) { assert.equal(binding.clientSecret, undefined); operations.push(['return_binding', binding]); }, async onReconcile(binding) { assert.equal(binding.intentId, 'intent_original'); assert.equal(destroyed, 0); operations.push(['reconcile']); } });
  await session.ready;
  const first = session.confirm({ preventDefault() {} });
  await Promise.resolve(); await Promise.resolve();
  await session.confirm(); assert.equal(confirms, 1); assert.equal(destroyed, 0); assert.equal(submitButton.disabled, true);
  release(); await first;
  assert.equal(destroyed, 1); assert.equal(operations.at(-1)[0], 'reconcile');
  assert.doesNotMatch(String(noticeNode.textContent), /secret_|paid order/i);
  session.destroy(); assert.equal(destroyed, 1);
});

test('destroying a pending Stripe mount prevents late initialization; an unknown confirm response reconciles without another confirm', async () => {
  let resolveLoad, initialized = 0;
  const session = createStripePaymentSession({ collection: collection('late'), expected, mountNode: {}, submitButton: {}, noticeNode: {}, origin: 'https://marketplace.invalid', load: () => new Promise(resolve => { resolveLoad = resolve; }), onReconcile: async () => {} });
  session.destroy(); resolveLoad(() => { initialized++; }); await session.ready; assert.equal(initialized, 0);
  let confirms = 0, reconciles = 0;
  const handlers = {}, element = { on(key, fn) { handlers[key] = fn; }, mount() { handlers.ready(); }, destroy() {} };
  const unknown = createStripePaymentSession({ collection: collection('unknown'), expected, mountNode: {}, submitButton: {}, noticeNode: {}, origin: 'https://marketplace.invalid', load: async () => () => ({ elements() { return { create: () => element, submit: async () => ({}) }; }, async confirmPayment() { confirms++; throw new Error('network unknown'); } }), onReconcile: async () => { reconciles++; } });
  await unknown.ready; await unknown.confirm(); await unknown.confirm();
  assert.equal(confirms, 1); assert.equal(reconciles, 1);
});

test('Stripe confirmation preserves the configured account mount and rejects external, query or traversal return paths before SDK loading',async()=>{
  const events={},element={on(name,callback){events[name]=callback;},mount(){events.ready();},destroy(){}},calls=[];
  let loads=0;
  const load=async()=>{loads++;return ()=>({elements:()=>({create:()=>element,submit:async()=>({})}),async confirmPayment(options){calls.push(options.confirmParams.return_url);return {};}});};
  const options={collection:collection('custommount'),expected,mountNode:{},submitButton:{},noticeNode:{},origin:'https://marketplace.invalid',load,onReconcile:async binding=>{assert.equal(binding.intentId,expected.intentId);}};
  for(const returnPath of ['https://evil.invalid/','//evil.invalid/','/account/../marketplace/','/account/marketplace/?next=elsewhere','/account/%2e%2e/marketplace/'])assert.throws(()=>createStripePaymentSession({...options,returnPath}),/return path/);
  assert.equal(loads,0);
  const session=createStripePaymentSession({...options,returnPath:'/account/marketplace/'});await session.ready;await session.confirm();
  assert.deepEqual(calls,['https://marketplace.invalid/account/marketplace/']);assert.equal(loads,1);
});
