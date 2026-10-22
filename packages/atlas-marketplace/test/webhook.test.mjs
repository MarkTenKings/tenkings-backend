import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyRawWebhook, handleFinanceWebhook } from '../src/webhook.mjs';
import { financeFixture, NOW } from './finance-fixtures.mjs';

const secret = 'whsec_explicit_synthetic_fixture_only';
function signature(raw, time = NOW / 1000) { return `t=${time},v1=${createHmac('sha256', secret).update(`${time}.`).update(raw).digest('hex')}`; }

test('signature verification uses original bytes, rejects old/future signatures and does not parse unsigned data', () => {
  const rawBody = Buffer.from('{"object":"event","id":"evt_one","livemode":false,"type":"payment_intent.succeeded","data":{"object":{}}}');
  assert.equal(verifyRawWebhook({ rawBody, signature: signature(rawBody), secret, now: NOW }).event.id, 'evt_one');
  assert.throws(() => verifyRawWebhook({ rawBody: Buffer.concat([rawBody, Buffer.from(' ')]), signature: signature(rawBody), secret, now: NOW }), { code: 'INVALID_WEBHOOK_SIGNATURE' });
  assert.throws(() => verifyRawWebhook({ rawBody: JSON.parse(rawBody), signature: signature(rawBody), secret, now: NOW }), { code: 'RAW_WEBHOOK_BYTES_REQUIRED' });
  for (const delta of [-301, 301]) assert.throws(() => verifyRawWebhook({ rawBody, signature: signature(rawBody, NOW / 1000 + delta), secret, now: NOW }), { code: 'EXPIRED_WEBHOOK_SIGNATURE' });
});

test('duplicate and out-of-order webhook hints always retrieve exact current object, scoped to account and mode', async t => {
  const f = financeFixture(); t.after(() => f.store.close()); await f.paid();
  const objectId = f.store.read(state => state.intents.payment_one.objectId);
  const event = { object: 'event', id: 'evt_one', livemode: false, type: 'payment_intent.processing', data: { object: { id: objectId, object: 'payment_intent', status: 'processing', metadata: { atlas_marketplace_intent: 'payment_one' } } } };
  const handle = async (value, override = {}) => {
    const rawBody = Buffer.from(JSON.stringify(value));
    return handleFinanceWebhook({ store: f.store, provider: f.provider, rawBody, signature: signature(rawBody), secret, platformAccountId: 'acct_platform', now: NOW, enabled: true, ...override });
  };
  assert.equal((await handle(event)).status, 'SUCCEEDED');
  assert.equal((await handle(event)).status, 'SUCCEEDED');
  assert.equal(f.store.read(state => state.journals.length), 1);
  assert.equal(f.store.read(state => state.financeWebhooks.evt_one.status), 'RECONCILED');
  await assert.rejects(handle({ ...event, account: 'acct_other' }), { code: 'WEBHOOK_SCOPE_MISMATCH' });
  await assert.rejects(handle({ ...event, livemode: true }), { code: 'INVALID_WEBHOOK_EVENT' });
  await assert.rejects(handle({ ...event, type: 'payment_intent.succeeded' }), { code: 'WEBHOOK_EVENT_CONFLICT' });
  await assert.rejects(handle(event, { enabled: false }), { code: 'FINANCE_WEBHOOK_DISABLED' });
});
