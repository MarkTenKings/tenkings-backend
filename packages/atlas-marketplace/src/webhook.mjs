import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { financeAssert as check, identifier, digest } from './ledger.mjs';
import { reconcileFinanceIntent } from './payment.mjs';
import { recordFinanceException, reconcileProviderDispute } from './reconciliation.mjs';

export function scopedWebhookBinding({ endpoints, secret }) {
  check(secret === undefined && Array.isArray(endpoints) && endpoints.length >= 1 && endpoints.length <= 4, 'WEBHOOK_ENDPOINT_CONFIG_REQUIRED');
  const ids = new Set(), secrets = new Set();
  for (const endpoint of endpoints) {
    check(endpoint && Object.keys(endpoint).sort().join(',') === 'id,scope,secret', 'WEBHOOK_ENDPOINT_CONFIG_REQUIRED');
    identifier(endpoint.id);
    check(['PLATFORM','CONNECTED'].includes(endpoint.scope) && typeof endpoint.secret === 'string' && endpoint.secret.length >= 16 && endpoint.secret.length <= 512 && !ids.has(endpoint.id) && !secrets.has(endpoint.secret), 'WEBHOOK_ENDPOINT_CONFIG_REQUIRED');
    ids.add(endpoint.id); secrets.add(endpoint.secret);
  }
  // Digest binds the server credential generation without returning credentials.
  return { endpoints: endpoints.map(({ id, scope }) => ({ id, scope })).sort((a,b) => a.id.localeCompare(b.id)), configurationHash: digest(endpoints) };
}

export function verifyScopedRawWebhook({ endpoints, secret, platformAccountId, ...input }) {
  scopedWebhookBinding({ endpoints, secret }); identifier(platformAccountId);
  for (let index = 0; index < endpoints.length; index++) {
    let verified;
    try { verified = verifyRawWebhook({ ...input, secret: endpoints[index].secret }); }
    catch (error) { if (error.code === 'INVALID_WEBHOOK_SIGNATURE') continue; throw error; }
    const account = verified.event.account;
    const platform = account === undefined || account === platformAccountId;
    check(endpoints[index].scope === (platform ? 'PLATFORM' : 'CONNECTED'), 'WEBHOOK_ENDPOINT_SCOPE_MISMATCH');
    if (!platform) identifier(account);
    return { ...verified, endpointIndex: index, endpointId: endpoints[index].id };
  }
  check(false, 'INVALID_WEBHOOK_SIGNATURE');
}

export function verifyRawWebhook({ rawBody, signature, secret, now = Date.now(), toleranceSeconds = 300, expectedLivemode = false }) {
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
  check(typeof expectedLivemode === 'boolean' && event && event.object === 'event' && event.livemode === expectedLivemode && typeof event.type === 'string' && event.data?.object, 'INVALID_WEBHOOK_EVENT');
  identifier(event.id);
  return { event, rawHash: createHash('sha256').update(rawBody).digest('hex') };
}
const EVENT_KINDS = { payment_intent: 'PAYMENT', refund: 'REFUND', transfer: 'TRANSFER', transfer_reversal: 'REVERSAL', payout: 'PAYOUT' };
export async function handleFinanceWebhook({ store, provider, rawBody, signature, secret, platformAccountId, now = Date.now(), enabled = false, resolveDisputePolicy, expectedLivemode = false }) {
  check(enabled === true, 'FINANCE_WEBHOOK_DISABLED');
  const { event, rawHash } = verifyRawWebhook({ rawBody, signature, secret, now, expectedLivemode });
  identifier(platformAccountId);
  const object = event.data.object, accountId = event.account ?? platformAccountId;
  identifier(object.id ?? (event.type === 'balance.available' ? accountId : null));
  const snapshot = await store.read(state => state), intents = Object.values(snapshot.intents ?? {}).filter(intent => (intent.policy.environment === 'stripe-production') === expectedLivemode);
  check(accountId === platformAccountId || provider.acceptsAccount?.(accountId) === true || intents.some(intent => intent.platformAccountId === platformAccountId && intent.connectedAccountId === accountId), 'WEBHOOK_SCOPE_MISMATCH');
  const kind = EVENT_KINDS[object.object], hintedId = object.metadata?.atlas_marketplace_intent;
  let direct = kind ? (hintedId ? snapshot.intents?.[hintedId] : intents.find(intent => intent.kind === kind && intent.objectId === object.id && intent.accountId === accountId)) : null;
  if (direct) check(direct.kind === kind && (direct.policy.environment === 'stripe-production') === expectedLivemode && direct.accountId === accountId && direct.platformAccountId === platformAccountId && (direct.objectId === null || direct.objectId === object.id), 'WEBHOOK_SCOPE_MISMATCH');
  await store.transaction(tx => {
    const inbox = tx.state.financeWebhooks ??= {}, old = inbox[event.id];
    if (old) check(old.rawHash === rawHash && old.accountId === accountId && old.objectId === (object.id ?? null), 'WEBHOOK_EVENT_CONFLICT');
    else inbox[event.id] = { eventId: event.id, rawHash, accountId, objectId: object.id ?? null, type: event.type, receivedAt: tx.now, status: 'RECEIVED' };
    return true;
  });
  const exception = async (code, orderId = null, details = null) => {
    await store.transaction(tx => recordFinanceException(tx, { exceptionId: `webhook:${event.id}:${code}`, accountId, orderId, code, evidenceHash: rawHash, details }));
    return { status: 'REVIEW_REQUIRED', code };
  };
  const related = async parent => {
    if (!provider.listRelatedObjects) return exception('PROVIDER_RELATED_RECONCILIATION_UNAVAILABLE', parent.orderId);
    const listed = await provider.listRelatedObjects(parent);
    check(listed.complete === true, 'RELATED_PROVIDER_OBJECTS_INCOMPLETE');
    const results = [];
    for (const item of listed.objects) {
      const candidate = await store.read(state => state.intents[item.intentId]);
      if (!candidate || candidate.kind !== item.kind || candidate.accountId !== accountId || candidate.orderId !== parent.orderId || candidate.parentObjectId !== item.parentObjectId) results.push(await exception('EXTERNAL_FINANCIAL_ACTION', parent.orderId, { objectId: item.objectId, kind: item.kind }));
      else results.push(await reconcileFinanceIntent({ store, provider, intentId: candidate.id, objectId: item.objectId }));
    }
    return { status: results.some(result => result.status === 'REVIEW_REQUIRED') ? 'REVIEW_REQUIRED' : 'RECONCILED', relatedCount: results.length };
  };
  let result, affectedPaymentIntentId = null;
  try {
    if (object.object === 'dispute' && event.type.startsWith('charge.dispute.')) {
      const chargeId = typeof object.charge === 'object' ? object.charge?.id : object.charge;
      const pi = typeof object.payment_intent === 'object' ? object.payment_intent?.id : object.payment_intent;
      let payment = intents.find(intent => intent.kind === 'PAYMENT' && intent.accountId === accountId &&
        (typeof chargeId === 'string' && intent.chargeId === chargeId || typeof pi === 'string' && intent.objectId === pi));
      if (payment && !payment.confirmed) payment = await reconcileFinanceIntent({ store, provider, intentId: payment.id });
      if (!payment?.confirmed) result = await exception('UNBOUND_DISPUTE');
      else {
        // A dispute can be the first notification of a captured payment. The
        // order must settle that exact payment even when dispute review holds it.
        affectedPaymentIntentId = payment.id;
        result = await reconcileProviderDispute({ store, provider, paymentIntentId: payment.id, objectId: object.id, resolveDisputePolicy });
      }
    } else if (event.type === 'charge.refunded' && object.object === 'charge') {
      const payment = intents.find(intent => intent.kind === 'PAYMENT' && intent.accountId === accountId && intent.chargeId === object.id);
      result = payment ? await related(payment) : await exception('UNBOUND_REFUND');
    } else if (event.type === 'transfer.reversed' && object.object === 'transfer') {
      if (!direct) result = await exception('UNBOUND_REVERSAL');
      else { await reconcileFinanceIntent({ store, provider, intentId: direct.id, objectId: object.id }); result = await related(direct); }
    } else if (kind && event.type.startsWith(`${object.object}.`)) {
      result = direct ? await reconcileFinanceIntent({ store, provider, intentId: direct.id, objectId: object.id }) : await exception('UNBOUND_FINANCIAL_OBJECT');
    } else if (event.type === 'account.updated' || event.type.startsWith('account.external_account.') || event.type === 'capability.updated' || event.type === 'person.updated') {
      const target = object.object === 'account' ? object.id : accountId;
      check(target === accountId && target !== platformAccountId, 'WEBHOOK_SCOPE_MISMATCH');
      const account = await provider.getAccount(target);
      check(account.accountId === target && account.livemode === expectedLivemode, 'WEBHOOK_SCOPE_MISMATCH');
      await store.transaction(tx => { (tx.state.financeAccountObservations ??= {})[target] = account; return true; });
      const active = account.requirementsSatisfied && account.transfersActive && account.payoutsEnabled && account.manualPayouts && account.verifiedExternalAccountIds.length > 0;
      result = active ? { status: 'RECONCILED' } : await exception('CONNECTED_ACCOUNT_RESTRICTED');
    } else if (event.type === 'account.application.deauthorized') result = await exception('CONNECTED_ACCOUNT_DEAUTHORIZED');
    else if (event.type === 'balance.available') {
      const candidates = intents.filter(intent => intent.kind === 'TRANSFER' && intent.connectedAccountId === accountId && intent.confirmed && !intent.available);
      for (const candidate of candidates) await reconcileFinanceIntent({ store, provider, intentId: candidate.id });
      result = { status: 'RECONCILED', reconciledCount: candidates.length, accountReconciliationRequired: true };
    } else result = await exception('UNSUPPORTED_FINANCE_WEBHOOK', null, { type: event.type });
    const status = result.status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'RECONCILED';
    const receipt = { ...(direct ? { intentId: direct.id } : {}), ...(affectedPaymentIntentId ? { affectedPaymentIntentId } : {}) };
    await store.transaction(tx => { Object.assign(tx.state.financeWebhooks[event.id], { status, reconciledAt: tx.now, ...receipt }); return true; });
    return { ...result, eventId: event.id, ...receipt };
  } catch (error) {
    const code = /^[A-Z0-9_]{1,100}$/.test(error.code ?? '') ? error.code : 'WEBHOOK_RECONCILIATION_ERROR';
    await exception(code, direct?.orderId ?? null);
    await store.transaction(tx => { Object.assign(tx.state.financeWebhooks[event.id], { status: 'RETRY_REQUIRED', errorCode: code, attemptedAt: tx.now }); return true; });
    throw error;
  }
}
