// Explicit local QA only. Importing this module does not listen, read credentials,
// create/confirm provider objects, or register an R1 route. The operator supplies
// an already-dispatched isolated QA payment, its approved plan, store and provider.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hash, requireValue as check } from '../src/contract.mjs';
import { getPaymentCollection, reconcileFinanceIntent } from '../src/payment.mjs';
import { MARKETPLACE_CSP } from '../src/runtime-node.mjs';
import { SANDBOX_PLATFORM, SANDBOX_SELLER, validateSandboxPlan } from './qualify-stripe-sandbox.mjs';

const mountPath = '/account/marketplace/';
const apiPath = mountPath + 'api';
const assets = new Map([
  ['', ['workspace.html', 'text/html']], ['app.mjs', ['app.mjs', 'text/javascript']],
  ['view.mjs', ['view.mjs', 'text/javascript']], ['stripe-payment.mjs', ['stripe-payment.mjs', 'text/javascript']],
  ['styles.css', ['styles.css', 'text/css']],
  ['report-link.mjs', ['report-link.mjs', 'text/javascript']],
]);
const banner = '<aside class="notice attention" role="note"><strong>LOCAL STRIPE SANDBOX QUALIFICATION — SYNTHETIC SESSION AND CHECKOUT</strong><p>This isolated test uses real Stripe test APIs and a synthetic buyer/reservation projection. It does not authenticate through R1, qualify card ownership or custody, create a sale, or move real money. Only the original test payment can be collected and reconciled. The fixture reservation stays held after payment; no marketplace order or fulfillment is created.</p></aside>';
const safeCode = error => /^[A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'BROWSER_QUALIFICATION_FAILED';

export async function startStripeBrowserQualification({ enabled = false, store, provider, plan: suppliedPlan, approvedPlanHash, port = 0, clock = Date.now } = {}) {
  check(enabled === true, 'BROWSER_QUALIFICATION_DISABLED');
  check(typeof store?.read === 'function' && typeof store?.transaction === 'function' && typeof provider?.getIdentity === 'function' && typeof provider?.getPaymentCollection === 'function' && typeof provider?.retrieve === 'function', 'BROWSER_QUALIFICATION_PORT_REQUIRED');
  check(Number.isSafeInteger(port) && port >= 0 && port <= 65535, 'BROWSER_QUALIFICATION_PORT_REFUSED');
  const plan = validateSandboxPlan(suppliedPlan), planHash = hash(plan), intentId = `${plan.runId}_payment`;
  check(planHash === approvedPlanHash, 'SANDBOX_EXECUTION_NOT_AUTHORIZED');
  const order = { ...plan.amounts, currency: 'USD', policyVersion: plan.financePolicy.version };
  for (const key of ['orderId', 'reservationId', 'listingId', 'cardId', 'sellerId', 'buyerId']) order[key] = `${plan.runId}_${key}`;
  order.bindingHash = hash({ planHash, order });
  const orderHash = hash(order), csrfToken = randomBytes(32).toString('hex');
  let origin, closed = false, busy = false, originalObjectId;
  function authorized() {
    const now = clock();
    check(!closed && Number.isSafeInteger(now) && plan.authorization.approvedAt <= now && now < plan.authorization.expiresAt && ['confirm', 'reconcile'].every(stage => plan.authorization.allowedStages.includes(stage)), 'SANDBOX_EXECUTION_NOT_AUTHORIZED');
    return now;
  }
  async function snapshot() {
    authorized();
    return store.read(state => {
      const intent = state.intents?.[intentId];
      check(state.sandbox?.runId === plan.runId && state.sandbox.planHash === planHash && state.sandbox.environment === 'PROVIDER_SANDBOX', 'SANDBOX_STORE_BINDING_MISMATCH');
      check(intent?.kind === 'PAYMENT' && intent.id === intentId && intent.dispatchCount === 1 && /^pi_[A-Za-z0-9]+$/.test(intent.objectId ?? '') && (!originalObjectId || intent.objectId === originalObjectId), 'SANDBOX_ORIGINAL_PAYMENT_REQUIRED');
      check(hash(intent.order) === orderHash && intent.amountCents === order.totalCents && intent.currency === 'USD' && intent.bindingHash === order.bindingHash && hash(intent.policy) === hash(plan.financePolicy) && intent.platformAccountId === SANDBOX_PLATFORM && intent.accountId === SANDBOX_PLATFORM && intent.connectedAccountId === SANDBOX_SELLER, 'SANDBOX_PAYMENT_BINDING_MISMATCH');
      return { intent, journalEntries: state.journals.filter(row => row.intentId === intentId).length };
    });
  }
  const initial = await snapshot();
  check(!initial.intent.confirmed && !initial.intent.terminalUnpaid && ['PENDING', 'UNKNOWN', 'DISPATCHING'].includes(initial.intent.status), 'SANDBOX_PENDING_PAYMENT_REQUIRED');
  originalObjectId = initial.intent.objectId;
  const identity = await provider.getIdentity();
  check(identity.provider === 'stripe' && identity.environment === 'PROVIDER_SANDBOX' && identity.livemode === false && identity.platformAccountId === SANDBOX_PLATFORM && identity.allowedConnectedAccountIds?.length === 1 && identity.allowedConnectedAccountIds[0] === SANDBOX_SELLER && identity.apiVersion === plan.apiVersion && identity.paymentCollectionConfigured === true, 'SANDBOX_IDENTITY_MISMATCH');
  authorized();
  function receipt({ intent, journalEntries }) {
    return { intentId, paymentIntentId: intent.objectId, status: intent.status, confirmed: intent.confirmed, amountCents: intent.amountCents, currency: 'USD', dispatchCount: intent.dispatchCount, journalEntries };
  }
  function workspace(value) {
    // These read-only projection rows are deliberately not persisted or passed
    // to listing/reservation reducers. No title, report, media or policy is invented.
    return {
      schema: 'atlas-marketplace-workspace-v1', environment: 'PROVIDER_SANDBOX', now: authorized(), csrfToken,
      scope: { role: 'BUYER', actorId: order.buyerId },
      qualification: { syntheticSession: true, cardAuthority: false, runId: plan.runId, ...receipt(value) },
      listings: [{ id: order.listingId, status: 'RESERVED', version: 1, bindingHash: order.bindingHash, askingPriceCents: order.itemCents, approvedCard: null }],
      reservations: [{ id: order.reservationId, listingId: order.listingId, status: 'PAYMENT_PENDING', paymentIntentId: intentId, quote: { totalCents: order.totalCents, currency: 'USD' } }],
      intents: [{ id: intentId, kind: 'PAYMENT', status: value.intent.status, confirmed: value.intent.confirmed, amountCents: order.totalCents, reservationId: order.reservationId, orderId: order.orderId }],
      orders: [], fulfillment: {}, eligibilityCards: [], consent: {}, policy: null,
    };
  }
  const server = createServer(async (request, response) => {
    const send = (status, body, contentType = 'application/json') => {
      response.writeHead(status, { 'Content-Type': contentType + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': MARKETPLACE_CSP });
      response.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      authorized();
      check(request.socket.remoteAddress === '127.0.0.1' && request.headers.host === new URL(origin).host && typeof request.url === 'string' && request.url.startsWith('/') && !request.url.startsWith('//') && request.url.length <= 4000, 'SANDBOX_REQUEST_REFUSED');
      const url = new URL(request.url, origin), rawPath = request.url.split('?')[0];
      check(url.origin === origin && url.pathname === rawPath && (!request.headers.origin || request.headers.origin === origin), 'SANDBOX_ORIGIN_REFUSED');
      const asset = url.pathname.startsWith(mountPath) ? assets.get(url.pathname.slice(mountPath.length)) : null;
      if (request.method === 'GET' && asset) {
        let bytes = await readFile(new URL(`../ui/${asset[0]}`, import.meta.url));
        if (asset[0] === 'workspace.html') bytes = Buffer.from(bytes.toString('utf8').replace('<body>', '<body>' + banner).replace('data-runtime="AUTHENTICATED"', `data-runtime="AUTHENTICATED" data-api-path="${apiPath}" data-mount-path="${mountPath}"`));
        return send(200, bytes, asset[1]);
      }
      check(!request.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(request.headers['sec-fetch-site']), 'SANDBOX_ORIGIN_REFUSED');
      if (request.method === 'GET' && url.pathname === apiPath + '/workspace' && !url.search) return send(200, workspace(await snapshot()));
      if (request.method === 'GET' && url.pathname === apiPath + '/catalog' && url.search.length <= 2000) return send(200, { environment: 'PROVIDER_SANDBOX', items: [], total: 0, offset: 0, nextOffset: null });
      const operation = url.pathname === apiPath + '/payments/collection' ? 'collection' : url.pathname === apiPath + '/payments/reconcile' ? 'reconcile' : null;
      if (!operation) return send(404, { error: 'SANDBOX_ROUTE_UNAVAILABLE' });
      if (request.method !== 'POST') return send(405, { error: 'SANDBOX_METHOD_REFUSED' });
      check(!url.search && request.headers.origin === origin && request.headers['content-type'] === 'application/json', 'SANDBOX_ORIGIN_REFUSED');
      const suppliedToken = request.headers['x-atlas-csrf'];
      check(typeof suppliedToken === 'string' && /^[a-f0-9]{64}$/.test(suppliedToken) && timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(csrfToken)), 'SANDBOX_CSRF_REFUSED');
      check(!request.headers['content-length'] || /^\d+$/.test(request.headers['content-length']) && Number(request.headers['content-length']) <= 1024, 'SANDBOX_BODY_TOO_LARGE');
      let length = 0; const chunks = [];
      for await (const chunk of request) { length += chunk.length; check(length <= 1024, 'SANDBOX_BODY_TOO_LARGE'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { check(false, 'SANDBOX_BODY_REFUSED'); }
      check(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).join(',') === 'reservationId' && body.reservationId === order.reservationId, 'SANDBOX_PAYMENT_SCOPE_REFUSED');
      check(!busy, 'SANDBOX_OPERATION_IN_PROGRESS');
      busy = true;
      try {
        await snapshot();
        const result = operation === 'collection'
          ? await getPaymentCollection({ store, provider, intentId, buyerId: order.buyerId, reservationId: order.reservationId, enabled: true })
          : await reconcileFinanceIntent({ store, provider, intentId, objectId: originalObjectId });
        const after = await snapshot();
        // The collection capability exists only in this no-store response; it is
        // never projected, logged, checkpointed or retained by this fixture.
        return send(200, operation === 'collection' ? result : receipt(after));
      } finally { busy = false; }
    } catch (error) {
      const code = safeCode(error);
      send(code.endsWith('TOO_LARGE') ? 413 : /REFUSED|NOT_AUTHORIZED/.test(code) ? 403 : 409, { error: code });
    }
  });
  server.headersTimeout = 5000; server.requestTimeout = 30000; server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return Object.freeze({ origin, url: origin + mountPath, mountPath, apiPath, async close() { if (closed) return; closed = true; await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } });
}
