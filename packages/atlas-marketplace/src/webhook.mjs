import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { financeAssert as check, identifier } from './ledger.mjs';
import { reconcileFinanceIntent } from './payment.mjs';

export function verifyRawWebhook({ rawBody, signature, secret, now = Date.now(), toleranceSeconds = 300 }) {
  check(Buffer.isBuffer(rawBody) && rawBody.length > 0 && rawBody.length <= 1048576, 'RAW_WEBHOOK_BYTES_REQUIRED');
  check(typeof secret === 'string' && secret.length >= 16 && typeof signature === 'string' && signature.length <= 8192, 'INVALID_WEBHOOK_SIGNATURE');
  check(Number.isSafeInteger(now) && Number.isSafeInteger(toleranceSeconds) && toleranceSeconds > 0 && toleranceSeconds <= 300, 'INVALID_WEBHOOK_CLOCK');
  const parts = signature.split(',').map(part => part.trim().split('='));
  const times = parts.filter(([key]) => key === 't');
  check(times.length === 1 && /^\d{1,13}$/.test(times[0][1]), 'INVALID_WEBHOOK_SIGNATURE');
  const time = Number(times[0][1]);
  check(Number.isSafeInteger(time) && Math.abs(Math.floor(now / 1000) - time) <= toleranceSeconds, 'EXPIRED_WEBHOOK_SIGNATURE');
  const expected = createHmac('sha256', secret).update(`${time}.`).update(rawBody).digest();
  const valid = parts.filter(([key, value]) => key === 'v1' && /^[a-fA-F0-9]{64}$/.test(value)).some(([, value]) => timingSafeEqual(expected, Buffer.from(value, 'hex')));
  check(valid, 'INVALID_WEBHOOK_SIGNATURE');
  let event; try { event = JSON.parse(rawBody.toString('utf8')); } catch { check(false, 'INVALID_WEBHOOK_JSON'); }
  check(event && event.object === 'event' && event.livemode === false && typeof event.type === 'string' && event.data?.object, 'INVALID_WEBHOOK_EVENT');
  identifier(event.id);
  return { event, rawHash: createHash('sha256').update(rawBody).digest('hex') };
}
const EVENT_KINDS = { payment_intent: 'PAYMENT', refund: 'REFUND', transfer: 'TRANSFER', transfer_reversal: 'REVERSAL', payout: 'PAYOUT' };
export async function handleFinanceWebhook({ store, provider, rawBody, signature, secret, platformAccountId, now = Date.now(), enabled = false }) {
  check(enabled === true, 'FINANCE_WEBHOOK_DISABLED');
  const { event, rawHash } = verifyRawWebhook({ rawBody, signature, secret, now });
  identifier(platformAccountId);
  const object = event.data.object;
  const kind = EVENT_KINDS[object.object];
  check(kind && event.type.startsWith(`${object.object}.`), 'UNSUPPORTED_FINANCE_WEBHOOK');
  const intentId = object.metadata?.atlas_marketplace_intent;
  identifier(intentId); identifier(object.id);
  const intent = store.read(state => state.intents[intentId]);
  check(intent && intent.kind === kind && intent.accountId === (event.account ?? platformAccountId) && intent.platformAccountId === platformAccountId && (intent.objectId === null || intent.objectId === object.id), 'WEBHOOK_SCOPE_MISMATCH');
  const receipt = store.transaction(tx => {
    const inbox = tx.state.financeWebhooks ??= {};
    const existing = inbox[event.id];
    if (existing) check(existing.rawHash === rawHash && existing.intentId === intentId && existing.objectId === object.id, 'WEBHOOK_EVENT_CONFLICT');
    else inbox[event.id] = { eventId: event.id, rawHash, intentId, objectId: object.id, receivedAt: tx.now, status: 'RECEIVED' };
    return inbox[event.id];
  });
  // Even a duplicate event retrieves current state; event age/order never regresses provider truth.
  const result = await reconcileFinanceIntent({ store, provider, intentId, objectId: receipt.objectId });
  store.transaction(tx => { tx.state.financeWebhooks[event.id].status = 'RECONCILED'; tx.state.financeWebhooks[event.id].reconciledAt = tx.now; return true; });
  return { eventId: event.id, intentId, status: result.status };
}
