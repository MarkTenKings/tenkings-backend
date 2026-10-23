import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { openLocalStore } from '../src/store.mjs';
import { requireValue } from '../src/contract.mjs';
import { reconcileFinanceIntent } from '../src/payment.mjs';
import { catalogListings } from '../src/catalog.mjs';
import { actors, createLocalFixture, syntheticFulfillmentEvidence } from './local-fixture.mjs';
import { createMarketplacePublicNodeHandler } from '../src/runtime-public-node.mjs';

const STATIC = new Map([
  ['/physical-evidence.mjs', ['physical-evidence.mjs', 'text/javascript']],
  ['/parcel-presets.mjs', ['parcel-presets.mjs', 'text/javascript']],
  ['/report-link.mjs', ['report-link.mjs', 'text/javascript']],
  ['/', ['index.html', 'text/html']], ['/app.mjs', ['app.mjs', 'text/javascript']], ['/stripe-payment.mjs',['stripe-payment.mjs','text/javascript']], ['/view.mjs', ['view.mjs', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']],
  ['/demo/front.svg', ['front.svg', 'image/svg+xml']], ['/demo/back.svg', ['back.svg', 'image/svg+xml']], ['/demo/report', ['report.html', 'text/html']],
]);
const tokenEquals = (value, expected) => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
export async function startDemoServer({ directory, port = 0, enabled = false, clock = Date.now } = {}) {
  requireValue(enabled === true, 'SYNTHETIC_DEMO_DISABLED');
  requireValue(typeof directory === 'string', 'OWNED_DIRECTORY_REQUIRED');
  const store = openLocalStore({ filename: join(directory, 'marketplace.sqlite'), environment: 'SYNTHETIC_LOCAL', clock });
  const fixture = createLocalFixture({ store, clock });
  const { service, provider } = fixture;
  const csrfToken = randomBytes(32).toString('hex');
  let origin, publicCatalog;
  async function snapshot() {
    const state = await service.localSnapshot();
    const account=await provider.getAccount('demo_connected');
    return { mode: 'SYNTHETIC_LOCAL', now:clock(), scope:{role:'LOCAL_DEMO',actorId:'demo_operator'}, sellerEligibility:{status:account.requirementsSatisfied&&account.transfersActive?'ELIGIBLE':'RESTRICTED',chargesEnabled:true,transfersEnabled:account.transfersActive,payoutsEnabled:account.payoutsEnabled,bank:{status:account.verifiedExternalAccountIds.includes('demo_bank')?'VERIFIED':'UNAVAILABLE',label:'Synthetic bank'},requirements:[],observedAt:account.observedAt}, csrfToken, eligibilityCards: [fixture.eligibilityFixture.approvedCard], policy: fixture.listingPolicy,
      actors: { sellerId: actors.seller.id, buyerId: actors.buyer.id, alternateBuyerId: actors.alternateBuyer.id },
      listings: Object.values(state.listings), reservations: Object.values(state.reservations), orders: Object.values(state.orders),
      intents: Object.values(state.intents).map(({ id, kind, status, order, orderId, amountCents, confirmed, policyEvidence }) => ({ id, kind, status, orderId, reservationId: order?.reservationId ?? null, amountCents, confirmed, caseId:policyEvidence?.caseId??null })),
      consent: state.consent, fulfillment: state.fulfillment, balance: await service.balance(actors.seller),
      operationalMetrics: { productionEvents: 0, syntheticEventsExcluded: state.events.length, contributionProfit: null },
      gates: service.status() };
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, result) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); };
    try {
      requireValue(request.headers.host === new URL(origin).host, 'HOST_REFUSED');
      const url = new URL(request.url, origin);
      if(url.pathname.startsWith('/marketplace/'))return publicCatalog.listener(request,response);
      requireValue(!request.headers.origin || request.headers.origin === origin, 'ORIGIN_REFUSED');
      const staticNavigation = request.method === 'GET' && STATIC.has(url.pathname) && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
      requireValue(staticNavigation || !request.headers['sec-fetch-site'] || ['none', 'same-origin'].includes(request.headers['sec-fetch-site']), 'CROSS_SITE_REFUSED');
      if (request.method === 'GET' && STATIC.has(url.pathname)) {
        const [filename, type] = STATIC.get(url.pathname);
        const bytes = await readFile(new URL(`../ui/${filename}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); response.end(bytes); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/demo') { send(200, await snapshot()); return; }
      if (request.method === 'GET' && url.pathname === '/api/catalog') {
        const filters = {};
        for (const [key, value] of url.searchParams) {
          requireValue(!Object.hasOwn(filters, key), 'FILTER_INVALID');
          if (key === 'grade') {
            requireValue(/^(?:[1-9](?:\.[0-9]+)?|10(?:\.0+)?)$/.test(value), 'FILTER_INVALID'); filters[key] = Number(value);
          } else if (['minPriceCents', 'maxPriceCents', 'numberedDenominator', 'offset', 'limit'].includes(key)) {
            requireValue(/^(0|[1-9][0-9]*)$/.test(value), 'FILTER_INVALID'); filters[key] = Number(value);
          } else if (['autograph', 'relic'].includes(key)) {
            requireValue(['true', 'false'].includes(value), 'FILTER_INVALID'); filters[key] = value === 'true';
          } else filters[key] = value;
        }
        send(200, catalogListings(await service.localSnapshot(), filters)); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/quote') { send(200, await service.quote(actors.buyer, url.searchParams.get('listingId'))); return; }
      requireValue(request.method === 'POST', 'NOT_FOUND');
      requireValue(request.headers.origin === origin && tokenEquals(request.headers['x-atlas-demo-csrf'], csrfToken), 'CSRF_REFUSED');
      requireValue(request.headers['content-type']?.split(';')[0] === 'application/json', 'JSON_REQUIRED');
      let length = 0; const chunks = [];
      for await (const chunk of request) { length += chunk.length; requireValue(length <= 16384, 'BODY_TOO_LARGE'); chunks.push(chunk); }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(Error('Invalid JSON'), { code: 'INVALID_JSON' }); }
      requireValue(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT');
      let result;
      if (url.pathname === '/api/consent') result = await service.recordConsent(actors.seller, { ...input, evidenceRef: input.choice === 'HOLD_AND_LIST' ? 'demo_hold_consent' : 'demo_ship_consent' });
      else if (url.pathname === '/api/listings') result = await service.publishListing(actors.seller, input);
      else if (url.pathname === '/api/listings/revise') result = await service.reviseListing(actors.seller,input);
      else if (url.pathname === '/api/listings/withdraw') result = await service.withdrawListing(actors.seller,input);
      else if (url.pathname === '/api/reservations/cancel') result = await service.cancelReservation(actors.buyer,input);
      else if (url.pathname === '/api/reservations') result = await service.reserve(actors.buyer, input);
      else if (url.pathname === '/api/payments') result = await service.pay(actors.buyer, input);
      else if (url.pathname === '/api/reconcile') result = await service.reconcilePayment(actors.buyer, input);
      else if (url.pathname === '/api/fulfillment') {
        const order = store.read(state => state.orders[input.orderId]); requireValue(order, 'ORDER_UNAVAILABLE');
        result = await service.fulfill(actors.staff, { ...input, evidence: syntheticFulfillmentEvidence(order, input.action) });
      } else if(url.pathname === '/api/transfers/reconcile') result=await service.resumeTransfer(actors.staff,input);
      else if(url.pathname === '/api/cases') result=await service.openCase(actors.buyer,{...input,evidenceRef:'demo_case_evidence'});
      else if(url.pathname === '/api/cases/refund') {
        requireValue(input.reviewConfirmed===true,'REVIEW_REQUIRED');
        const prior=store.read(state=>state.fulfillment[input.orderId]?.cases.find(row=>row.id===input.caseId)?.refundObligation);
        result=await service.refundCase(actors.staff,{...input,reviewRef:prior?.reviewRef??'demo_review_'+input.caseId});
      } else if(url.pathname === '/api/cases/refund/reconcile') result=await service.reconcileRefund(actors.staff,input);
      else if(url.pathname === '/api/cases/resolve') {
        const order=store.read(state=>state.orders[input.orderId]); requireValue(order,'ORDER_UNAVAILABLE');
        const evidence={environment:'SYNTHETIC_LOCAL',orderId:order.orderId,cardId:order.cardId,ref:'demo_case_resolution',refundIntentId:input.refundIntentId};
        if(input.inspectionConfirmed===true) for(const key of ['receivedParcelRef','inspectionFrontRef','inspectionBackRef','holderInspectionRef']) evidence[key]='demo_'+key;
        result=await service.resolveCase(actors.staff,{...input,evidence});
      } else if (url.pathname === '/api/withdrawals') result = await service.withdraw(actors.seller, { ...input, externalAccountId: 'demo_bank' });
      else if (url.pathname === '/api/withdrawals/reconcile') result = await service.reconcileWithdrawal(actors.seller, input);
      else if (url.pathname === '/api/demo/provider') {
        const intent = store.read(state => state.intents[input.intentId]); requireValue(intent, 'INTENT_NOT_FOUND');
        requireValue(['PAYMENT', 'TRANSFER', 'PAYOUT','REFUND'].includes(intent.kind), 'UNSUPPORTED_DEMO_EFFECT');
        const allowed = intent.kind === 'PAYOUT' ? ['paid', 'failed', 'canceled'] : intent.kind==='PAYMENT'?['succeeded','canceled']:['succeeded'];
        requireValue(allowed.includes(input.status), 'UNSUPPORTED_DEMO_STATUS');
        await provider.resolve(intent.id, { status: input.status, processingFeeCents: intent.kind === 'PAYMENT' ? 300 : 0 });
        result = intent.kind === 'PAYMENT'
          ? await service.reconcilePayment(actors.buyer, { reservationId: intent.order.reservationId })
          : await reconcileFinanceIntent({ store, provider, intentId: intent.id });
      } else requireValue(false, 'NOT_FOUND');
      send(200, result);
    } catch (error) { send(error.code === 'NOT_FOUND' ? 404 : /REFUSED|FORBIDDEN/.test(error.code ?? '') ? 403 : 409, { error: error.code ?? 'REQUEST_FAILED', message: error.code ? error.message : 'Request failed; inspect the retained original state before retrying.' }); }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    publicCatalog=createMarketplacePublicNodeHandler({enabled:true,origin,service,customerPath:'/account/marketplace/',admitPublicRequest:async()=>true}); // Owned loopback fixture only.
  } catch (error) { store.close(); throw error; }
  return { origin, store, service, provider, server, async close() { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); store.close(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  requireValue(args.includes('--synthetic-local'), 'SYNTHETIC_DEMO_DISABLED');
  const directory = args[args.indexOf('--data-dir') + 1];
  requireValue(args.includes('--data-dir') && directory, 'OWNED_DIRECTORY_REQUIRED');
  const app = await startDemoServer({ directory, enabled: true });
  console.log(`SYNTHETIC LOCAL ONLY — ${app.origin}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
