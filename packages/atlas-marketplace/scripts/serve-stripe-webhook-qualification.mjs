// Inert until explicitly started with an isolated approved sandbox store and
// provider. CLI-forwarded test signatures qualify local transport only, never a
// hosted production endpoint. No credentials, routes or CLI processes discovered.
import { createServer } from 'node:http';
import { hash, requireValue as check } from '../src/contract.mjs';
import { handleFinanceWebhook, verifyRawWebhook } from '../src/webhook.mjs';
import { SANDBOX_PLATFORM, SANDBOX_SELLER, validateSandboxPlan } from './qualify-stripe-sandbox.mjs';

const webhookPath = '/webhook';
const stages = { PAYMENT: 'payment', TRANSFER: 'transfer', REFUND: 'refund', REVERSAL: 'reversal', PAYOUT: 'payout' };
const objects = { payment_intent: 'PAYMENT', transfer: 'TRANSFER', refund: 'REFUND', transfer_reversal: 'REVERSAL', payout: 'PAYOUT' };
export const STRIPE_WEBHOOK_QUALIFICATION_EVENTS = Object.freeze([
  'payment_intent.created', 'payment_intent.processing', 'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled', 'payment_intent.requires_action',
  'refund.created', 'refund.updated', 'refund.failed', 'charge.refunded',
  'transfer.created', 'transfer.updated', 'transfer.reversed',
  'payout.created', 'payout.updated', 'payout.paid', 'payout.failed', 'payout.canceled', 'balance.available',
]);
const safeCode = error => /^[A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'WEBHOOK_QUALIFICATION_FAILED';

export async function startStripeWebhookQualification({ enabled = false, store, provider, plan: suppliedPlan, approvedPlanHash, secret, port = 0, clock = Date.now, onReceipt } = {}) {
  check(enabled === true, 'WEBHOOK_QUALIFICATION_DISABLED');
  check(typeof store?.read === 'function' && typeof store?.transaction === 'function' && typeof provider?.getIdentity === 'function' && typeof provider?.retrieve === 'function' && (onReceipt === undefined || typeof onReceipt === 'function'), 'WEBHOOK_QUALIFICATION_PORT_REQUIRED');
  check(Number.isSafeInteger(port) && port >= 0 && port <= 65535, 'WEBHOOK_QUALIFICATION_PORT_REFUSED');
  const plan = validateSandboxPlan(suppliedPlan), planHash = hash(plan);
  check(planHash === approvedPlanHash, 'SANDBOX_EXECUTION_NOT_AUTHORIZED');
  const order = { ...plan.amounts, currency: 'USD', policyVersion: plan.financePolicy.version };
  for (const key of ['orderId', 'reservationId', 'listingId', 'cardId', 'sellerId', 'buyerId']) order[key] = `${plan.runId}_${key}`;
  order.bindingHash = hash({ planHash, order });
  const orderHash = hash(order), policyHash = hash(plan.financePolicy), originalObjects = new Map();
  const payoutBinding = hash({ sellerId: order.sellerId, connectedAccountId: SANDBOX_SELLER, externalAccountId: plan.payout.externalAccountId, amountCents: plan.payout.amountCents, allocationOrderIds: [order.orderId] });
  const amounts = { PAYMENT: plan.amounts.totalCents, REFUND: plan.refund.amountCents, REVERSAL: plan.refund.allocations.sellerCents, TRANSFER: plan.amounts.sellerNetCents - (plan.refund.timing === 'BEFORE_TRANSFER' ? plan.refund.allocations.sellerCents : 0), PAYOUT: plan.payout.amountCents };
  let closed = false, signingSecret = null, origin;
  function authorized() {
    const now = clock();
    check(!closed && Number.isSafeInteger(now) && plan.authorization.approvedAt <= now && now < plan.authorization.expiresAt && plan.authorization.allowedStages.includes('reconcile'), 'SANDBOX_EXECUTION_NOT_AUTHORIZED');
    return now;
  }
  function setSigningSecret(value) {
    authorized();
    check(typeof value === 'string' && /^whsec_[A-Za-z0-9_]{16,250}$/.test(value), 'SANDBOX_WEBHOOK_SECRET_REQUIRED');
    check(signingSecret === null || signingSecret === value, 'SANDBOX_WEBHOOK_SECRET_ALREADY_SET');
    signingSecret = value;
  }
  async function snapshot() {
    authorized();
    return store.read(state => {
      check(state.sandbox?.runId === plan.runId && state.sandbox.planHash === planHash && state.sandbox.environment === 'PROVIDER_SANDBOX', 'SANDBOX_STORE_BINDING_MISMATCH');
      const intents = Object.values(state.intents ?? {});
      check(intents.some(intent => intent.id === `${plan.runId}_payment` && intent.dispatchCount === 1 && intent.objectId), 'SANDBOX_ORIGINAL_PAYMENT_REQUIRED');
      for (const intent of intents) {
        const boundOrder = intent.kind === 'PAYOUT'
          ? intent.order === null && intent.orderId === null && intent.bindingHash === payoutBinding && intent.externalAccountId === plan.payout.externalAccountId && hash(intent.payoutAllocations) === hash([{ orderId: order.orderId, amountCents: plan.payout.amountCents }])
          : hash(intent.order) === orderHash && intent.bindingHash === order.bindingHash;
        check(stages[intent.kind] && intent.id === `${plan.runId}_${stages[intent.kind]}` && boundOrder && intent.sellerId === order.sellerId && intent.amountCents === amounts[intent.kind] && intent.currency === 'USD' && hash(intent.policy) === policyHash && intent.platformAccountId === SANDBOX_PLATFORM && intent.connectedAccountId === SANDBOX_SELLER && intent.accountId === (intent.kind === 'PAYOUT' ? SANDBOX_SELLER : SANDBOX_PLATFORM), 'SANDBOX_WEBHOOK_STORE_SCOPE_REFUSED');
        const previous = originalObjects.get(intent.id);
        check(!previous || previous === intent.objectId, 'SANDBOX_ORIGINAL_OBJECT_CHANGED');
        if (intent.objectId) originalObjects.set(intent.id, intent.objectId);
      }
      return { intents, inbox: Object.values(state.financeWebhooks ?? {}), journalEntries: state.journals.length };
    });
  }
  await snapshot();
  if (secret !== undefined) setSigningSecret(secret);
  secret = null;
  const identity = await provider.getIdentity();
  check(identity.provider === 'stripe' && identity.environment === 'PROVIDER_SANDBOX' && identity.livemode === false && identity.platformAccountId === SANDBOX_PLATFORM && identity.allowedConnectedAccountIds?.length === 1 && identity.allowedConnectedAccountIds[0] === SANDBOX_SELLER && identity.apiVersion === plan.apiVersion, 'SANDBOX_IDENTITY_MISMATCH');
  authorized();
  function scopeEvent(event, current) {
    const accountId = event.account ?? SANDBOX_PLATFORM, object = event.data.object;
    check([SANDBOX_PLATFORM, SANDBOX_SELLER].includes(accountId) && STRIPE_WEBHOOK_QUALIFICATION_EVENTS.includes(event.type), 'SANDBOX_WEBHOOK_EVENT_REFUSED');
    if (event.type === 'balance.available') {
      check(object.object === 'balance' && (!object.id || object.id === accountId), 'SANDBOX_WEBHOOK_OBJECT_REFUSED');
      return;
    }
    const intent = event.type === 'charge.refunded'
      ? current.intents.find(row => row.kind === 'PAYMENT' && row.accountId === accountId && row.chargeId === object.id && object.object === 'charge')
      : current.intents.find(row => row.kind === objects[object.object] && row.accountId === accountId && row.objectId === object.id && event.type.startsWith(object.object + '.'));
    check(intent?.dispatchCount === 1 && (!object.metadata?.atlas_marketplace_intent || object.metadata.atlas_marketplace_intent === intent.id) && (!object.metadata?.atlas_marketplace_order || object.metadata.atlas_marketplace_order === (intent.orderId ?? '')) && (!object.metadata?.atlas_marketplace_binding || object.metadata.atlas_marketplace_binding === intent.bindingHash), 'SANDBOX_WEBHOOK_OBJECT_REFUSED');
  }
  async function receipt() {
    const current = await snapshot();
    return {
      format: 'atlas-r2-cli-webhook-qualification-v1', environment: 'PROVIDER_SANDBOX', transport: 'STRIPE_CLI_FORWARDING', productionEndpointQualified: false,
      runId: plan.runId, planHash, ready: signingSecret !== null, journalEntries: current.journalEntries,
      intents: current.intents.map(intent => ({ intentId: intent.id, kind: intent.kind, objectId: intent.objectId, status: intent.status, dispatchCount: intent.dispatchCount, confirmed: intent.confirmed })),
      events: current.inbox.map(event => ({ eventId: event.eventId, type: event.type, accountId: event.accountId, objectId: event.objectId, rawHash: event.rawHash, status: event.status, ...(event.intentId ? { intentId: event.intentId } : {}), ...(event.errorCode ? { errorCode: event.errorCode } : {}) })),
    };
  }
  const server = createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); response.end(JSON.stringify(body)); };
    try {
      authorized();
      check(request.socket.remoteAddress === '127.0.0.1' && request.headers.host === new URL(origin).host && (!request.headers.origin || request.headers.origin === origin), 'SANDBOX_WEBHOOK_ORIGIN_REFUSED');
      if (request.url !== webhookPath) return send(404, { error: 'SANDBOX_WEBHOOK_ROUTE_UNAVAILABLE' });
      if (request.method !== 'POST') return send(405, { error: 'SANDBOX_WEBHOOK_METHOD_REFUSED' });
      if (!signingSecret) return send(503, { error: 'SANDBOX_WEBHOOK_SECRET_NOT_READY' });
      check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? ''), 'SANDBOX_WEBHOOK_CONTENT_REFUSED');
      check(!request.headers['content-length'] || /^\d+$/.test(request.headers['content-length']) && Number(request.headers['content-length']) <= 262144, 'SANDBOX_WEBHOOK_BODY_TOO_LARGE');
      let length = 0; const chunks = [];
      for await (const chunk of request) { length += chunk.length; check(length <= 262144, 'SANDBOX_WEBHOOK_BODY_TOO_LARGE'); chunks.push(chunk); }
      const rawBody = Buffer.concat(chunks), signature = request.headers['stripe-signature'];
      // Verify before parsing scope or touching the inbox; the domain handler
      // receives the same Buffer, never a serialized copy of event.data.
      const { event } = verifyRawWebhook({ rawBody, signature, secret: signingSecret, now: authorized(), expectedLivemode: false });
      scopeEvent(event, await snapshot());
      const result = await handleFinanceWebhook({ store, provider, rawBody, signature, secret: signingSecret, platformAccountId: SANDBOX_PLATFORM, now: authorized(), enabled: true, expectedLivemode: false });
      await snapshot();
      const safe = { received: true, transport: 'STRIPE_CLI_FORWARDING', productionEndpointQualified: false, eventId: result.eventId, type: event.type, status: result.status, ...(result.intentId ? { intentId: result.intentId } : {}), ...(result.accountReconciliationRequired ? { accountReconciliationRequired: true } : {}) };
      if (onReceipt) { try { await onReceipt(structuredClone(safe)); } catch { /* Receipt sinks cannot change the durable webhook result. */ } }
      send(200, safe);
    } catch (error) {
      const code = safeCode(error);
      send(code.endsWith('TOO_LARGE') ? 413 : /REFUSED|SIGNATURE|NOT_AUTHORIZED|INVALID_WEBHOOK/.test(code) ? 403 : 409, { error: code, transport: 'STRIPE_CLI_FORWARDING', productionEndpointQualified: false });
    }
  });
  server.headersTimeout = 5000; server.requestTimeout = 30000; server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return Object.freeze({ origin, url: origin + webhookPath, webhookPath, setSigningSecret, receipt, async close() { if (closed) return; closed = true; signingSecret = null; await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } });
}
