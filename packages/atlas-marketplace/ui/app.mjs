import { renderApp, parsePrice } from './view.mjs';
import { createStripePaymentSession } from './stripe-payment.mjs';

const root = document.getElementById('app');
const localDemo = root.dataset?.runtime === 'LOCAL_DEMO';
const apiPath = root.dataset?.apiPath ?? '/api/marketplace';
const mountPath = root.dataset?.mountPath ?? '/marketplace/';
if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(apiPath) || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/$/.test(mountPath)) throw new Error('Workspace route configuration is unavailable.');
const statePath = localDemo ? '/api/demo' : apiPath+'/workspace';
function endpointPath(path) { return localDemo ? path : apiPath + (path === '/api/reconcile' ? '/payments/reconcile' : path.slice(4)); }
const authenticatedFields = {
  '/api/consent': ['requestId','cardId','choice','evidenceRef'], '/api/listings': ['requestId','cardId','askingPriceCents'],
  '/api/listings/revise': ['requestId','listingId','expectedVersion','expectedBindingHash','askingPriceCents'], '/api/listings/withdraw': ['requestId','listingId','expectedVersion','expectedBindingHash'],
  '/api/reservations': ['requestId','listingId','listingVersion','listingHash','quoteId'], '/api/reservations/cancel': ['requestId','reservationId'],
  '/api/payments': ['reservationId'], '/api/reconcile': ['reservationId'], '/api/fulfillment': ['requestId','orderId','action','evidence'],
  '/api/transfers/reconcile': ['orderId'], '/api/withdrawals': ['requestId','amountCents','externalAccountId'], '/api/withdrawals/reconcile': ['intentId'],
  '/api/cases': ['requestId','caseId','orderId','kind','evidenceRef'], '/api/cases/refund': ['orderId','caseId','amountCents','allocations','reviewRef'],
  '/api/cases/refund/reconcile': ['orderId','caseId'], '/api/cases/resolve': ['requestId','orderId','caseId','outcome','evidence'],
};
let data = null, paymentSurface = null;
const paymentReturnKey = 'atlas.marketplace.payment-return:'+mountPath;
let returnedFromPayment = false;
if (!localDemo && globalThis.location?.pathname === mountPath) {
  const query = new URLSearchParams(globalThis.location.search);
  returnedFromPayment = ['payment_intent','payment_intent_client_secret','redirect_status'].some(key => query.has(key));
  if (returnedFromPayment) globalThis.history?.replaceState(null, '', mountPath);
}
function closePayment() {
  if (!paymentSurface) return;
  paymentSurface.session?.destroy(); paymentSurface.dialog.remove(); paymentSurface = null;
}
globalThis.addEventListener?.('pagehide', closePayment);
const ui = { evidencePathPrefix:apiPath+'/evidence/', side: 'front', price: localDemo ? '125.00' : '', quote: null, selectedListingId: null, notice: null, busy: false, uncertain: false };
const requests = new Map();
let readAt = Date.now(), serverNow = readAt, expiryTimer;
function requestId(key) {
  if (!requests.has(key)) requests.set(key, localDemo ? `demo_${crypto.randomUUID().replaceAll('-', '_')}` : crypto.randomUUID());
  return requests.get(key);
}
function render() { closePayment(); ui.now = serverNow + Math.max(0, Date.now() - readAt); root.innerHTML = renderApp(data, ui); }
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  const reservations = Array.isArray(data?.reservations) ? data.reservations : Object.values(data?.reservations ?? {});
  const now = serverNow + Math.max(0, Date.now() - readAt);
  const next = [ui.quote?.expiresAt, ...reservations.filter(item => item.status === 'HELD' && !item.paymentIntentId).map(item => item.expiresAt)].map(Date.parse).filter(time => time > now).sort((a, b) => a - b)[0];
  if (next) {
    expiryTimer = setTimeout(() => { ui.notice = 'A quote or unpaid reservation reached its deadline. Refresh saved state and review a current total before payment.'; render(); scheduleExpiry(); }, Math.min(2147483647, next - now + 1));
    expiryTimer.unref?.();
  }
}
async function readState() {
  const response = await fetch(statePath, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) { if (!localDemo && [401,403].includes(response.status)) data = null; throw new Error(localDemo ? 'Saved local state is unavailable.' : 'Authenticated workspace unavailable. Sign in with the required account and refresh.'); }
  data = await response.json();
  if (localDemo ? data.mode !== 'SYNTHETIC_LOCAL' : data.schema !== 'atlas-marketplace-workspace-v1' || !['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(data.environment) || !['BUYER','SELLER','STAFF'].includes(data.scope?.role) || typeof data.csrfToken !== 'string' || !data.csrfToken) { data = null; throw new Error('The workspace contract is unavailable.'); }
  data.runtime = localDemo ? 'LOCAL_DEMO' : 'AUTHENTICATED';
  readAt = Date.now(); serverNow = Number.isSafeInteger(data.now) ? data.now : readAt;
  if (ui.quote && !(Array.isArray(data.listings) ? data.listings : Object.values(data.listings ?? {})).some(item => item.status === 'ACTIVE' && item.bindingHash === ui.quote.listingHash)) ui.quote = null;
  ui.catalog = null;
  ui.uncertain = false;
  scheduleExpiry();
}
async function refresh() {
  ui.busy = true;
  render();
  try { await readState(); ui.notice = localDemo ? 'Saved local state refreshed. No payment or shipment was dispatched.' : 'Authenticated saved state refreshed. No financial or physical operation was dispatched.'; }
  catch (error) { ui.notice = error.message; }
  finally { ui.busy = false; render(); }
}
async function mutate(endpoint, body, success, requestKey) {
  if (ui.busy || ui.uncertain) return;
  if (!localDemo) {
    const keys = authenticatedFields[endpoint];
    if (!keys) return;
    body = Object.fromEntries(keys.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
  }
  ui.busy = true;
  ui.notice = localDemo ? 'Recording this local action…' : 'Recording this authenticated action…';
  render();
  let terminalRefusal = false;
  try {
    const response = await fetch(endpointPath(endpoint), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', [localDemo ? 'x-atlas-demo-csrf' : 'x-atlas-csrf']: data?.csrfToken ?? '' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      terminalRefusal = response.status >= 400 && response.status < 500;
      throw new Error(result.message ?? result.error?.message ?? result.error ?? 'This action could not be completed.');
    }
    await readState();
    if (requestKey) requests.delete(requestKey);
    ui.notice = localDemo ? success : 'The action was recorded. Review the saved order, payment or case status before continuing.';
  } catch (error) {
    ui.notice = String(error.message ?? error);
    ui.uncertain = !terminalRefusal;
    // Read only after uncertainty. Never repeat the payment or another POST.
    if (!terminalRefusal) {
      try { await readState(); ui.notice = 'The response was interrupted. Saved state was recovered; inspect the retained payment or order before continuing.'; }
      catch { ui.uncertain = true; }
    }
  } finally { ui.busy = false; render(); }
}

root.addEventListener('input', (event) => {
  if (event.target.id !== 'asking-price') return;
  ui.price = event.target.value;
  // Keep input focus and selection; only update the derived seller net.
  const fee = data?.policy?.feeCents;
  const price = parsePrice(ui.price);
  const net = document.querySelector('.seller-amounts .total dd');
  if (net) net.textContent = price !== null && Number.isSafeInteger(fee) && price > fee ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((price - fee) / 100) : 'Enter a valid price';
});
root.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.dataset?.form) {
    event.preventDefault();
    if (ui.busy || ui.uncertain) return;
    const values = new FormData(form), orderId = form.dataset.order, caseId = form.dataset.case;
    if (form.dataset.form === 'consent') {
      if (localDemo) return;
      const choice = values.get('choice'), cardId = form.dataset.card, key = `consent:${cardId}:${choice}`;
      await mutate('/api/consent', { requestId: requestId(key), cardId, choice, evidenceRef: values.get('evidenceRef') }, 'Disposition recorded.', key);
    } else if (form.dataset.form === 'fulfillment-evidence') {
      if (localDemo) return;
      const order = (Array.isArray(data.orders) ? data.orders : Object.values(data.orders)).find(row => row.orderId === orderId);
      if (!order) return;
      const action = form.dataset.step, evidence = { ...Object.fromEntries(values), environment: data.environment, orderId, cardId: order.cardId };
      const key = `fulfillment:${orderId}:${action}:${JSON.stringify(evidence)}`;
      await mutate('/api/fulfillment', { requestId: requestId(key), orderId, action, evidence }, 'Evidence recorded.', key);
    } else if (form.dataset.form === 'case-open') {
      const kind = values.get('kind'), key = `case-open:${orderId}:${kind}`, id = requestId(key);
      await mutate('/api/cases', { requestId: id, caseId: id, orderId, kind, ...(!localDemo ? { evidenceRef: values.get('evidenceRef') } : {}) }, 'The synthetic protection case is open; proceeds are held pending review.', key);
    } else if (form.dataset.form === 'refund-review') {
      const allocations = {};
      for (const key of ['sellerCents', 'feeCents', 'taxCents', 'shippingCents']) {
        const value = values.get(key);
        allocations[key] = /^(?:0|0\.0{1,2})$/.test(value) ? 0 : parsePrice(value);
      }
      const amountCents = Object.values(allocations).reduce((sum, value) => sum + value, 0);
      if (Object.values(allocations).some(value => value === null) || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !values.has('reviewConfirmed')) {
        ui.notice = 'Review each exact USD allocation and confirm the case review. The total must be positive.'; render(); return;
      }
      const key = `refund:${orderId}:${caseId}:${JSON.stringify(allocations)}`;
      await mutate('/api/cases/refund', { requestId: requestId(key), orderId, caseId, amountCents, allocations, reviewConfirmed: true, ...(!localDemo ? { reviewRef: values.get('reviewRef') } : {}) }, 'The reviewed obligation is saved. Reconcile its original refund before closing the case.', key);
    } else if (form.dataset.form === 'case-resolve') {
      const outcome = values.get('outcome'), key = `resolve:${orderId}:${caseId}:${outcome}`;
      const order = (Array.isArray(data.orders) ? data.orders : Object.values(data.orders)).find(row => row.orderId === orderId);
      if (!order) return;
      const evidence = { orderId, cardId: order.cardId, ref: values.get('ref'), ...(form.dataset.refund ? { refundIntentId: form.dataset.refund } : {}) };
      for (const key of ['receivedParcelRef','inspectionFrontRef','inspectionBackRef','holderInspectionRef']) if (values.has(key)) evidence[key] = values.get(key);
      await mutate('/api/cases/resolve', { requestId: requestId(key), orderId, caseId, outcome, ...(form.dataset.refund ? { refundIntentId: form.dataset.refund } : {}), inspectionConfirmed: values.has('inspectionConfirmed'), ...(!localDemo ? { evidence } : {}) }, 'The explicit synthetic case resolution is recorded.', key);
    }
    return;
  }
  if (event.target.id === 'catalog-form') {
    event.preventDefault();
    if (ui.busy || ui.uncertain) return;
    const filters = new FormData(event.target);
    const params = new URLSearchParams();
    for (const [key, value] of filters) {
      if (!String(value).trim()) continue;
      if (key === 'minPriceCents' || key === 'maxPriceCents') {
        const parsed = /^(?:0|0\.0{1,2})$/.test(value) ? 0 : parsePrice(value);
        if (parsed === null) { ui.notice = 'Price filters must be valid USD amounts.'; render(); return; }
        params.set(key, String(parsed));
      } else params.set(key, value);
    }
    ui.busy = true;
    ui.catalogFilters = Object.fromEntries(filters);
    render();
    try {
      const response = await fetch(`${endpointPath('/api/catalog')}?${params}`, { cache: 'no-store', credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Listings unavailable.');
      ui.catalog = result;
      ui.selectedListingId = result.items?.[0]?.id ?? null;
      ui.quote = null;
      ui.notice = `${result.total} available ${localDemo?'synthetic ':''}listing${result.total === 1 ? '' : 's'} match your filters. Collection specimens are not included.`;
    } catch (error) { ui.notice = String(error.message ?? error); }
    finally { ui.busy = false; render(); }
    return;
  }
  if (event.target.id !== 'listing-form') return;
  event.preventDefault();
  const askingPriceCents = parsePrice(ui.price);
  if (askingPriceCents === null) { ui.notice = 'Enter a positive USD amount with no more than two decimal places.'; render(); return; }
  const card = Array.isArray(data?.eligibilityCards) ? data.eligibilityCards[0] : Object.values(data?.eligibilityCards ?? {})[0];
  if (form.dataset.mode === 'revise') {
    const listing = (Array.isArray(data.listings) ? data.listings : Object.values(data.listings)).find(item => item.id === form.dataset.listing);
    if (!listing) return;
    const key = `revision:${listing.id}:${listing.version}:${askingPriceCents}`;
    await mutate('/api/listings/revise', { requestId: requestId(key), listingId: listing.id, expectedVersion: listing.version, expectedBindingHash: listing.bindingHash, askingPriceCents }, 'A new listing revision is saved. Earlier buyer quotes cannot be used.', key);
    return;
  }
  const key = `listing:${card?.cardId}:${askingPriceCents}`;
  void mutate('/api/listings', { requestId: requestId(key), cardId: card?.cardId, askingPriceCents }, 'The synthetic listing is saved with its exact fee, net, report and photographs.', key);
});
root.addEventListener('click', async (event) => {
  const target = event.target.closest('button[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (action === 'side') { ui.side = target.dataset.side; render(); root.querySelector(`[data-action="side"][data-side="${ui.side}"]`)?.focus(); return; }
  if (action === 'refresh') { await refresh(); return; }
  if (action === 'clear-filters') { ui.catalog = null; ui.catalogFilters = {}; ui.selectedListingId = null; ui.quote = null; render(); return; }
  if (action === 'select-listing') {
    const match = ui.catalog?.items?.find(item => item.id === target.dataset.listing);
    if (match && data && !(Array.isArray(data.listings) ? data.listings : Object.values(data.listings)).some(item => item.id === match.id)) data.listings = [...(Array.isArray(data.listings) ? data.listings : Object.values(data.listings)), match];
    ui.selectedListingId = target.dataset.listing; ui.quote = null; ui.side = 'front'; render(); root.querySelector('#specimen-heading')?.scrollIntoView({ block: 'start' }); return; }
  if (ui.busy || ui.uncertain) return;
  if (action === 'collect-payment') { await openPaymentCollection(target.dataset.reservation); return; }
  if (action === 'onboard') { await openOnboarding(); return; }
  if (action === 'quote') {
    ui.busy = true; render();
    try {
      const response = await fetch(`${endpointPath('/api/quote')}?listingId=${encodeURIComponent(target.dataset.listing)}`, { cache: 'no-store', credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Quote unavailable.');
      ui.quote = result.quote ?? result;
      scheduleExpiry();
      ui.selectedListingId = target.dataset.listing;
      ui.notice = 'Review the complete total, delivery estimate and protection terms before reserving.';
    } catch (error) { ui.notice = String(error.message ?? error); }
    finally { ui.busy = false; render(); }
    return;
  }
  if (action === 'withdraw-listing') {
    const listing = (Array.isArray(data.listings) ? data.listings : Object.values(data.listings)).find(item => item.id === target.dataset.listing);
    if (!listing) return;
    const key = `withdraw-listing:${listing.id}:${listing.version}`;
    await mutate('/api/listings/withdraw', { requestId: requestId(key), listingId: listing.id, expectedVersion: listing.version, expectedBindingHash: listing.bindingHash }, 'The listing is withdrawn. It is no longer offered for sale.', key);
  } else if (action === 'cancel-reservation') {
    const key = `cancel:${target.dataset.reservation}`;
    await mutate('/api/reservations/cancel', { requestId: requestId(key), reservationId: target.dataset.reservation }, 'The unpaid reservation is canceled. No payment was submitted.', key);
  } else if (action === 'reconcile-transfer') {
    await mutate('/api/transfers/reconcile', { orderId: target.dataset.order }, 'The original seller transfer was resumed or reconciled from its saved release evidence.');
  } else if (action === 'resume-refund') {
    const item = data.fulfillment?.[target.dataset.order]?.cases?.find(row => row.id === target.dataset.case);
    const obligation = item?.refundObligation;
    if (!obligation) return;
    const key = `refund:${target.dataset.order}:${target.dataset.case}:${JSON.stringify(obligation.allocations)}`;
    await mutate('/api/cases/refund', { requestId: requestId(key), orderId: target.dataset.order, caseId: target.dataset.case, amountCents: obligation.amountCents, allocations: obligation.allocations, reviewConfirmed: true, ...(!localDemo ? { reviewRef: obligation.reviewRef } : {}) }, 'The exact previously reviewed refund was resumed; its amount and allocation remain unchanged.', key);
  } else if (action === 'reconcile-refund') {
    await mutate('/api/cases/refund/reconcile', { orderId: target.dataset.order, caseId: target.dataset.case }, 'The original case refund was reconciled. Review its exact outcome before closing the case.');
  } else if (action === 'consent') {
    if (!localDemo) return;
    const key = `consent:${target.dataset.card}:${target.dataset.choice}`;
    await mutate('/api/consent', { requestId: requestId(key), cardId: target.dataset.card, choice: target.dataset.choice }, 'Your synthetic disposition choice is recorded.', key);
  } else if (action === 'reserve') {
    const listing = (Array.isArray(data.listings) ? data.listings : Object.values(data.listings)).find((item) => item.id === target.dataset.listing);
    if (!listing || !ui.quote) return;
    const key = `reserve:${listing.id}:${ui.quote.quoteId}`;
    await mutate('/api/reservations', { requestId: requestId(key), listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, quoteId: ui.quote.quoteId, bindingHash: ui.quote.bindingHash ?? listing.bindingHash }, 'This exact synthetic card is reserved. No payment has been confirmed.', key);
  } else if (action === 'pay') {
    const key = `payment:${target.dataset.reservation}`;
    await mutate('/api/payments', { requestId: requestId(key), reservationId: target.dataset.reservation }, 'The original synthetic payment intent is saved. Confirm it in the local simulator, then reconcile that same intent.', key);
  } else if (action === 'reconcile-payment') {
    await mutate('/api/reconcile', { reservationId: target.dataset.reservation }, 'The original payment was reconciled; no replacement payment was created.');
  } else if (action === 'simulate') {
    if (!localDemo) return;
    await mutate('/api/demo/provider', { intentId: target.dataset.intent, status: target.dataset.status }, 'Synthetic provider evidence was updated and the original intent reconciled. No real money moved.');
  } else if (action === 'fulfillment') {
    if (!localDemo) return;
    const key = `fulfillment:${target.dataset.order}:${target.dataset.step}`;
    await mutate('/api/fulfillment', { requestId: requestId(key), orderId: target.dataset.order, action: target.dataset.step }, 'Synthetic fulfillment evidence recorded. No physical action occurred.', key);
  } else if (action === 'withdraw') {
    const amountCents = Number(target.dataset.amount);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return;
    const key = `withdraw:${amountCents}`;
    await mutate('/api/withdrawals', { requestId: requestId(key), amountCents, ...(!localDemo ? { externalAccountId: target.dataset.bank } : {}) }, 'The synthetic withdrawal intent is saved. Confirm its bank result with the local simulator.', key);
  } else if (action === 'reconcile-withdrawal') {
    await mutate('/api/withdrawals/reconcile', { intentId: target.dataset.intent }, 'The original withdrawal was reconciled. No replacement payout was created.');
  }
});
async function openPaymentCollection(reservationId) {
  if (localDemo || data?.scope?.role !== 'BUYER' || ui.busy || ui.uncertain) return;
  const rows = () => Array.isArray(data?.reservations) ? data.reservations : Object.values(data?.reservations ?? {});
  const saved = rows().find(row => row.id === reservationId);
  if (saved?.status !== 'PAYMENT_PENDING' || !saved.paymentIntentId) return;
  const expected = { reservationId, intentId: saved.paymentIntentId, amountCents: saved.quote?.totalCents, currency: 'USD', environment: data.environment };
  ui.busy = true; ui.notice = 'Loading Stripe payment details for the original reservation…'; render();
  try {
    const response = await fetch(apiPath+'/payments/collection', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-atlas-csrf': data.csrfToken }, body: JSON.stringify({ reservationId }) });
    if (!response.ok) throw new Error('The original payment is not currently collectible. Reconcile it before continuing.');
    const collection = await response.json();
    await readState();
    const current = rows().find(row => row.id === reservationId);
    if (current?.status !== 'PAYMENT_PENDING' || current.paymentIntentId !== expected.intentId || current.quote?.totalCents !== expected.amountCents) throw new Error('The retained payment changed. Refresh and reconcile the original reservation.');
    ui.busy = false; render();
    const dialog = document.createElement('dialog'); dialog.className = 'payment-dialog'; dialog.setAttribute('aria-labelledby', 'stripe-heading');
    dialog.innerHTML = '<form><h2 id="stripe-heading">Complete payment securely</h2><p class="small">Card details are collected by Stripe. A redirect or browser confirmation does not mark your order paid.</p><div class="stripe-mount"></div><p class="small payment-notice" role="status" aria-live="polite">Loading the Stripe form…</p><button type="submit" class="button" disabled>Confirm original payment</button><button type="button" class="button secondary payment-close">Close and return to saved state</button></form>';
    document.body.append(dialog);
    const surface = { dialog, session: null }; paymentSurface = surface;
    surface.session = createStripePaymentSession({ collection, expected, mountNode: dialog.querySelector('.stripe-mount'), submitButton: dialog.querySelector('[type="submit"]'), noticeNode: dialog.querySelector('.payment-notice'), origin: globalThis.location.origin, returnPath:mountPath,
      onConfirmStart(binding) { try { globalThis.sessionStorage?.setItem(paymentReturnKey, JSON.stringify(binding)); } catch {} },
      async onReconcile(binding) { closePayment(); await mutate('/api/reconcile', { reservationId: binding.reservationId }, 'Original payment reconciled.'); try { globalThis.sessionStorage?.removeItem(paymentReturnKey); } catch {} },
    });
    dialog.querySelector('form').addEventListener('submit', surface.session.confirm);
    const close = () => { closePayment(); ui.notice = 'Payment form closed. Reconcile the original payment if confirmation was in progress.'; render(); };
    dialog.querySelector('.payment-close').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.showModal();
    await surface.session.ready;
  } catch { closePayment(); ui.notice = 'Payment collection is unavailable or changed. Refresh and reconcile the original payment before continuing.'; }
  finally { ui.busy = false; if (!paymentSurface) render(); }
}

async function openOnboarding() {
  if (localDemo || data?.scope?.role !== 'SELLER' || ui.busy || ui.uncertain) return;
  ui.busy = true; render();
  try {
    const response = await fetch(apiPath+'/onboarding', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-atlas-csrf': data.csrfToken }, body: '{}' });
    if (!response.ok) throw new Error();
    const result = await response.json(), url = new URL(result.url);
    if (url.origin !== 'https://connect.stripe.com' || url.username || url.password || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error();
    globalThis.location.assign(url.href);
  } catch { ui.notice = 'Connected-account onboarding is unavailable. Refresh account eligibility before trying again.'; }
  finally { ui.busy = false; render(); }
}

await refresh();
if (!localDemo && !returnedFromPayment && data?.scope?.role==='BUYER') {
  const requested=new URLSearchParams(globalThis.location.search).get('listingId');
  if(requested&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(requested)) {
    try {
      const response=await fetch(apiPath+'/catalog?listingId='+encodeURIComponent(requested),{cache:'no-store',credentials:'same-origin'});
      if(!response.ok) throw new Error();
      const catalog=await response.json(),listing=catalog.items?.find(row=>row.id===requested&&row.status==='ACTIVE');
      if(!listing) throw new Error();
      data.listings=[...(Array.isArray(data.listings)?data.listings:Object.values(data.listings??{})).filter(row=>row.id!==requested),listing];
      ui.selectedListingId=requested;ui.notice='Review this card and request its current complete total before reserving.';
    } catch {ui.notice='That listing is no longer available. Browse current listings before starting checkout.';}
    render();
  }
}
if (!localDemo && returnedFromPayment && data) {
  let binding;
  try { const value = globalThis.sessionStorage?.getItem(paymentReturnKey); if (value?.length < 1000) binding = JSON.parse(value); } catch {}
  const rows = Array.isArray(data.reservations) ? data.reservations : Object.values(data.reservations ?? {});
  const original = rows.find(row => row.id === binding?.reservationId && row.paymentIntentId === binding?.intentId && row.quote?.totalCents === binding?.amountCents && binding?.currency === 'USD');
  if (original?.status === 'PAYMENT_PENDING' && data.scope.role === 'BUYER') await mutate('/api/reconcile', { reservationId: original.id }, 'Original payment reconciled after authentication.');
  else { ui.notice = 'Returned from payment authentication. Review saved state and reconcile the original payment; return parameters do not confirm a sale.'; render(); }
  try { globalThis.sessionStorage?.removeItem(paymentReturnKey); } catch {}
}
