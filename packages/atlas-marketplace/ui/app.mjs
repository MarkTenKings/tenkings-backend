import { renderApp, parsePrice } from './view.mjs';
import { createStripePaymentSession } from './stripe-payment.mjs';
import {createPhysicalEvidenceController} from './physical-evidence.mjs';

const root = document.getElementById('app');
const localDemo = root.dataset?.runtime === 'LOCAL_DEMO';
const apiPath = root.dataset?.apiPath ?? '/api/marketplace';
const mountPath = root.dataset?.mountPath ?? '/marketplace/';
if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(apiPath) || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/$/.test(mountPath)) throw new Error('Workspace route configuration is unavailable.');
const statePath = localDemo ? '/api/demo' : apiPath+'/workspace';
function endpointPath(path) { return localDemo ? path : apiPath + (path === '/api/reconcile' ? '/payments/reconcile' : path.slice(4)); }
const authenticatedFields = {
  '/api/destinations/save':['requestId','destinationId','expectedVersion','label','address'], '/api/destinations/remove':['requestId','destinationId','expectedVersion'],
  '/api/staff/orders/destination':['requestId','orderId'],
  '/api/consent': ['requestId','cardId','choice','evidenceRef'], '/api/listings': ['requestId','cardId','askingPriceCents','feeQuoteId'],
  '/api/listings/revise': ['requestId','listingId','expectedVersion','expectedBindingHash','askingPriceCents','feeQuoteId'], '/api/listings/withdraw': ['requestId','listingId','expectedVersion','expectedBindingHash'],
  '/api/reservations': ['requestId','listingId','listingVersion','listingHash','quoteId'], '/api/reservations/cancel': ['requestId','reservationId'],
  '/api/payments': ['reservationId'], '/api/reconcile': ['reservationId'], '/api/fulfillment': ['requestId','orderId','action','evidence'],
  '/api/transfers/reconcile': ['orderId'], '/api/withdrawals': ['requestId','amountCents','externalAccountId','method','quoteId'], '/api/withdrawals/reconcile': ['intentId'],
  '/api/withdrawals/cancel': ['intentId'],
  '/api/cases': ['requestId','caseId','orderId','kind','returnReason','evidenceRef'], '/api/cases/refund': ['orderId','caseId','amountCents','allocations','reviewRef'],
  '/api/cases/return/review': ['requestId','orderId','caseId','decision','reviewRef'],
  '/api/cases/refund/reconcile': ['orderId','caseId'], '/api/cases/resolve': ['requestId','orderId','caseId','outcome','evidence'],
  '/api/staff/incidents': ['requestId','alertId','expectedVersion','action','reviewRef','evidenceHash'],
  '/api/staff/instant-fees/settle': ['settlementId','intentIds','evidenceRef','reviewRef'],
  '/api/staff/tax/sale': ['orderId'], '/api/staff/tax/refund': ['refundIntentId','itemTaxCents','shippingTaxCents','reviewRef'],
  '/api/staff/tax/resume': ['operationId'], '/api/staff/tax/reconcile': ['operationId','providerId','reviewRef'],
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
const ui = { apiPath, evidencePathPrefix:apiPath+'/evidence/', side: 'front', price: localDemo ? '125.00' : '', quote: null, selectedListingId: null, notice: null, busy: false, uncertain: false };
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
  const next = [ui.quote?.expiresAt, ui.feeQuote?.expiresAt, ui.instantQuote?.expiresAt, ...reservations.filter(item => item.status === 'HELD' && !item.paymentIntentId).map(item => item.expiresAt)].map(Date.parse).filter(time => time > now).sort((a, b) => a - b)[0];
  if (next) {
    expiryTimer = setTimeout(() => { ui.notice = 'A quote or unpaid reservation reached its deadline. Refresh saved state and review a current total before payment.'; render(); scheduleExpiry(); }, Math.min(2147483647, next - now + 1));
    expiryTimer.unref?.();
  }
}
async function readState() {
  ui.deliveryAddresses={};
  const response = await fetch(statePath, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) { if (!localDemo && [401,403].includes(response.status)) {data = null;ui.proofOrders={};ui.shippingOrders={};ui.returnProofs={};ui.parcelEstimates={};ui.missingScanOrders={};requests.clear();} throw new Error(localDemo ? 'Saved local state is unavailable.' : 'Authenticated workspace unavailable. Sign in with the required account and refresh.'); }
  const priorScope=data?.scope;data = await response.json();
  if(priorScope?.actorId!==data?.scope?.actorId||priorScope?.role!==data?.scope?.role){ui.proofOrders={};ui.shippingOrders={};ui.returnProofs={};ui.parcelEstimates={};ui.missingScanOrders={};requests.clear();}
  if (localDemo ? data.mode !== 'SYNTHETIC_LOCAL' : data.schema !== 'atlas-marketplace-workspace-v1' || !['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(data.environment) || !['BUYER','SELLER','STAFF'].includes(data.scope?.role) || typeof data.csrfToken !== 'string' || !data.csrfToken) { data = null; throw new Error('The workspace contract is unavailable.'); }
  data.runtime = localDemo ? 'LOCAL_DEMO' : 'AUTHENTICATED';
  readAt = Date.now(); serverNow = Number.isSafeInteger(data.now) ? data.now : readAt;
  if (ui.quote && !(Array.isArray(data.listings) ? data.listings : Object.values(data.listings ?? {})).some(item => item.status === 'ACTIVE' && item.bindingHash === ui.quote.listingHash)) ui.quote = null;
  if (data.quoteDestinationRequired && !data.quoteDestinations?.some(item => item.id === ui.destinationId && (!ui.quote || item.version === ui.quote.destination?.version))) { ui.destinationId = ''; ui.quote = null; }
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
async function mutate(endpoint, body, success, requestKey,applyResult) {
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
    applyResult?.(result);
    if (requestKey) requests.delete(requestKey);
    ui.notice = localDemo || endpoint.startsWith('/api/destinations/') || endpoint==='/api/staff/orders/destination' ? success : 'The action was recorded. Review the saved order, payment or case status before continuing.';
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

const physicalController=createPhysicalEvidenceController({getData:()=>data,ui,apiPath,render,readState,requestId});

root.addEventListener('input', (event) => {
  if (event.target.id === 'instant-amount') {
    ui.instantAmount = event.target.value; ui.instantQuote = null;
    root.querySelector('.instant-review')?.remove();
    return;
  }
  if (event.target.id !== 'asking-price') return;
  ui.price = event.target.value;
  ui.feeQuote = null;
  if (data?.feePreviewRequired) {
    root.querySelectorAll('.seller-amounts dd').forEach(node => { node.textContent = 'Review a current fee'; });
    const submit = root.querySelector('#listing-form [type="submit"]'); if (submit) submit.disabled = true;
    return;
  }
  // Keep input focus and selection; only update the derived seller net.
  const fee = data?.policy?.feeCents;
  const price = parsePrice(ui.price);
  const net = document.querySelector('.seller-amounts .total dd');
  if (net) net.textContent = price !== null && Number.isSafeInteger(fee) && price > fee ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((price - fee) / 100) : 'Enter a valid price';
});
root.addEventListener('change', event => {
  if (event.target.id !== 'quote-destination') return;
  ui.destinationId = event.target.value; ui.quote = null; render();
});
root.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.dataset?.form) {
    event.preventDefault();
    if (ui.busy || ui.uncertain) return;
    if(await physicalController.submit(form))return;
    const values = new FormData(form), orderId = form.dataset.order, caseId = form.dataset.case;
    if (form.dataset.form === 'destination') {
      if(localDemo||data?.scope?.role!=='BUYER'||!data.destinationsEnabled)return;
      const address=Object.fromEntries(['name','phone','line1','city','state','postalCode','residential'].map(key=>[key,String(values.get(key)??'').trim()]));address.state=address.state.toUpperCase();address.country='US';address.line2=String(values.get('line2')??'').trim()||null;
      const label=String(values.get('label')??'').trim(),edit=ui.editDestination,key='destination:'+JSON.stringify({label,address,edit});
      const destinationId=edit?.id??requestId(key+':id');
      await mutate('/api/destinations/save',{requestId:requestId(key),destinationId,expectedVersion:edit?Number(edit.version):0,label,address},'Delivery address saved.',key,()=>{ui.editDestination=null;ui.quote=null;ui.destinationId=destinationId;requests.delete(key+':id');});
    } else if (['tax-sale','tax-refund','tax-resume','tax-reconcile'].includes(form.dataset.form)) {
      if (localDemo || data?.scope?.role !== 'STAFF' || data.taxReporting?.available !== true) return;
      const orders = data.taxReporting.orders ?? [], kind = form.dataset.form;
      if (kind === 'tax-sale') {
        const order = orders.find(row => row.orderId === orderId && row.saleStatus === 'MISSING'); if (!order) return;
        await mutate('/api/staff/tax/sale', {orderId}, 'Original sale tax record reviewed.');
      } else if (kind === 'tax-refund') {
        const order = orders.find(row => row.refunds?.some(item => item.refundIntentId === form.dataset.refund));
        const refund = order?.refunds.find(row => row.refundIntentId === form.dataset.refund);
        if (!refund || refund.status !== 'MISSING' || order.saleStatus !== 'SUCCEEDED') return;
        const parseCents = key => {const raw=values.get(key);return typeof raw==='string' && /^(0|[1-9]\d*)$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;};
        const itemTaxCents=parseCents('itemTaxCents'), shippingTaxCents=parseCents('shippingTaxCents'), reviewRef=String(values.get('reviewRef')??'').trim();
        if (itemTaxCents===null || shippingTaxCents===null || !Number.isSafeInteger(itemTaxCents+shippingTaxCents) || itemTaxCents+shippingTaxCents!==refund.taxCents || !reviewRef || reviewRef.length>500 || !values.has('reviewConfirmed')) {ui.notice='Review nonnegative integer-cent item and shipping tax amounts whose exact sum equals the confirmed refund tax, and retain its review reference.';render();return;}
        await mutate('/api/staff/tax/refund', {refundIntentId:refund.refundIntentId,itemTaxCents,shippingTaxCents,reviewRef}, 'Original refund tax record reviewed.');
      } else {
        const operationId=form.dataset.operation;
        const operation=orders.flatMap(row=>[{operationId:row.operationId,status:row.saleStatus},...(row.refunds??[])]).find(row=>row.operationId && row.operationId===operationId);
        if (!operation) return;
        if (kind==='tax-resume') {
          if(operation.status!=='PREPARED')return;
          await mutate('/api/staff/tax/resume',{operationId},'Retained approved tax record resumed.');
        } else {
          if(!['DISPATCHING','UNKNOWN'].includes(operation.status))return;
          const providerId=String(values.get('providerId')??'').trim(),reviewRef=String(values.get('reviewRef')??'').trim();
          if ((providerId && (!/^tax_[A-Za-z0-9]{1,124}$/.test(providerId)||!reviewRef||reviewRef.length>500)) || (!providerId&&reviewRef)) {ui.notice='For a recovered original tax ID, provide both the exact provider ID and an independent review reference. Leave both blank to retrieve the saved original.';render();return;}
          await mutate('/api/staff/tax/reconcile',{operationId,...(providerId?{providerId,reviewRef}:{})},'Original tax evidence reconciled.');
        }
      }
    } else if (form.dataset.form === 'instant-fee-settlement') {
      if (localDemo || data?.scope?.role !== 'STAFF' || data.operations?.instantFeeSettlementAvailable !== true || !values.has('reviewConfirmed')) return;
      const intentIds = values.getAll('intentIds').sort(), eligible = new Set((data.operations.unsettledInstantFeeIntents ?? []).map(row => row.id));
      if (!intentIds.length || new Set(intentIds).size !== intentIds.length || intentIds.some(id => !eligible.has(id))) { ui.notice = 'Select the exact eligible payout intents you reviewed.'; render(); return; }
      const evidenceRef = values.get('evidenceRef'), reviewRef = values.get('reviewRef'), key = `instant-fees:${JSON.stringify(intentIds)}:${evidenceRef}:${reviewRef}`;
      await mutate('/api/staff/instant-fees/settle', { settlementId: requestId(key), intentIds, evidenceRef, reviewRef }, 'Reviewed provider fee settlement recorded.', key);
    } else if (form.dataset.form === 'finance-incident') {
      if (localDemo || data?.scope?.role !== 'STAFF' || !values.has('reviewConfirmed')) return;
      const incident = data.operations?.incidents?.find(item => item.alertId === form.dataset.alert);
      if (!incident || incident.status === 'RESOLVED') return;
      const action = values.get('action'), key = `incident:${incident.alertId}:${incident.version}:${action}`;
      await mutate('/api/staff/incidents', { requestId: requestId(key), alertId: incident.alertId, expectedVersion: incident.version, action, reviewRef: values.get('reviewRef'), evidenceHash: incident.latestEvidenceHash }, 'Incident review recorded.', key);
    } else if (form.dataset.form === 'consent') {
      if (localDemo) return;
      const choice = values.get('choice'), cardId = form.dataset.card, key = `consent:${cardId}:${choice}`;
      await mutate('/api/consent', { requestId: requestId(key), cardId, choice, evidenceRef: values.get('evidenceRef') }, 'Disposition recorded.', key);
    } else if (form.dataset.form === 'fulfillment-evidence') {
      if (localDemo) return;
      const order = (Array.isArray(data.orders) ? data.orders : Object.values(data.orders)).find(row => row.orderId === orderId);
      if (!order) return;
      const action = form.dataset.step, evidence = { ...Object.fromEntries(values), environment: data.environment, orderId, cardId: order.cardId };
      if(values.has('deliveredAt')) {
        const deliveredAt=new Date(values.get('deliveredAt')).getTime();
        if(!Number.isSafeInteger(deliveredAt)){ui.notice='Enter the delivery date and time shown by the carrier.';render();return;}
        evidence.deliveredAt=deliveredAt;
      }
      const key = `fulfillment:${orderId}:${action}:${JSON.stringify(evidence)}`;
      await mutate('/api/fulfillment', { requestId: requestId(key), orderId, action, evidence }, 'Evidence recorded.', key);
    } else if (form.dataset.form === 'case-open') {
      const kind = values.get('kind'), returnReason=kind==='RETURN'?values.get('returnReason'):null;
      if(kind==='RETURN'&&values.has('returnReason')&&!returnReason){ui.notice='Choose severe damage or the wrong product and provide your evidence.';render();return;}
      const key = `case-open:${orderId}:${kind}:${returnReason??''}:${values.get('evidenceRef')??''}`, id = requestId(key);
      await mutate('/api/cases', { requestId: id, caseId: id, orderId, kind, ...(returnReason?{returnReason}:{}), ...(!localDemo ? { evidenceRef: values.get('evidenceRef') } : {}) }, 'Your case is recorded; seller proceeds are held pending review.', key);
    } else if(form.dataset.form==='return-review') {
      if(localDemo)return;
      const decision=values.get('decision'),reviewRef=values.get('reviewRef'),key=`return-review:${orderId}:${caseId}:${decision}:${reviewRef}`;
      await mutate('/api/cases/return/review',{requestId:requestId(key),orderId,caseId,decision,reviewRef},'Return request review recorded.',key);
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
  const feeQuoteId = data?.feePreviewRequired ? ui.feeQuote?.id : undefined;
  if (data?.feePreviewRequired && (!feeQuoteId || ui.feeQuote.askingPriceCents !== askingPriceCents || Date.parse(ui.feeQuote.expiresAt) <= serverNow + Math.max(0, Date.now() - readAt))) { ui.notice = 'Review a fresh exact fee and proceeds quote before listing.'; render(); return; }
  if (form.dataset.mode === 'revise') {
    const listing = (Array.isArray(data.listings) ? data.listings : Object.values(data.listings)).find(item => item.id === form.dataset.listing);
    if (!listing) return;
    const key = `revision:${listing.id}:${listing.version}:${askingPriceCents}`;
    await mutate('/api/listings/revise', { requestId: requestId(key), listingId: listing.id, expectedVersion: listing.version, expectedBindingHash: listing.bindingHash, askingPriceCents, feeQuoteId }, 'A new listing revision is saved. Earlier buyer quotes cannot be used.', key);
    return;
  }
  const key = `listing:${card?.cardId}:${askingPriceCents}`;
  await mutate('/api/listings', { requestId: requestId(key), cardId: card?.cardId, askingPriceCents, feeQuoteId }, 'The synthetic listing is saved with its exact fee, net, report and photographs.', key);
});
root.addEventListener('click', async (event) => {
  const target = event.target.closest('button[data-action]');
  if (!target || target.disabled) return;
  if(await physicalController.click(target))return;
  const action = target.dataset.action;
  if (action === 'side') { ui.side = target.dataset.side; render(); root.querySelector(`[data-action="side"][data-side="${ui.side}"]`)?.focus(); return; }
  if (action === 'refresh') { await refresh(); return; }
  if (action === 'clear-filters') { ui.catalog = null; ui.catalogFilters = {}; ui.selectedListingId = null; ui.quote = null; render(); return; }
  if (action === 'select-listing') {
    const match = ui.catalog?.items?.find(item => item.id === target.dataset.listing);
    if (match && data && !(Array.isArray(data.listings) ? data.listings : Object.values(data.listings)).some(item => item.id === match.id)) data.listings = [...(Array.isArray(data.listings) ? data.listings : Object.values(data.listings)), match];
    ui.selectedListingId = target.dataset.listing; ui.quote = null; ui.side = 'front'; render(); root.querySelector('#specimen-heading')?.scrollIntoView({ block: 'start' }); return; }
  if (ui.busy || ui.uncertain) return;
  if(['edit-destination','remove-destination','new-destination'].includes(action)) {
    if(localDemo||data?.scope?.role!=='BUYER'||!data.destinationsEnabled)return;
    if(action==='new-destination'){ui.editDestination=null;render();return;}
    const row=data.quoteDestinations?.find(item=>item.id===target.dataset.destination);if(!row)return;
    if(action==='edit-destination'){ui.editDestination=row;render();root.querySelector('#delivery-addresses')?.scrollIntoView({block:'start'});return;}
    const key=`remove-destination:${row.id}:${row.version}`;await mutate('/api/destinations/remove',{requestId:requestId(key),destinationId:row.id,expectedVersion:Number(row.version)},'Saved address removed.',key,()=>{ui.editDestination=null;ui.quote=null;});return;
  }
  if(action==='delivery-address') {
    if(localDemo||data?.scope?.role!=='STAFF'||!data.destinationsEnabled||!data.orders?.some(row=>row.orderId===target.dataset.order))return;
    const orderId=target.dataset.order,key=`delivery-address:${orderId}`;
    await mutate('/api/staff/orders/destination',{orderId,requestId:requestId(key)},'Retained delivery address retrieved.',key,result=>{if(result.orderId===orderId)ui.deliveryAddresses={[orderId]:result.address};});return;
  }
  if (action === 'collect-payment') { await openPaymentCollection(target.dataset.reservation); return; }
  if (action === 'onboard') { await openOnboarding(); return; }
  if (action === 'preview-fee') {
    if (localDemo || data?.scope?.role !== 'SELLER') return;
    const rows = Array.isArray(data.listings) ? data.listings : Object.values(data.listings ?? {});
    const listing = rows.find(row => row.id === ui.selectedListingId) ?? rows.find(row => row.status === 'ACTIVE') ?? rows[0];
    const editable = listing?.status === 'ACTIVE';
    const card = editable ? listing.approvedCard : (Array.isArray(data.eligibilityCards) ? data.eligibilityCards : Object.values(data.eligibilityCards ?? {}))[0];
    const askingPriceCents = parsePrice(ui.price);
    if (!card || askingPriceCents === null) { ui.notice = 'Enter a positive USD price before reviewing the fee.'; render(); return; }
    ui.feeQuote = null;
    await readPreview('/listings/preview', { cardId: card.cardId, askingPriceCents, ...(editable ? { listingId: listing.id } : {}) }, result => {
      if (result.cardId !== card.cardId || result.askingPriceCents !== askingPriceCents || !result.id) throw new Error('Fee quote did not match the selected card and price.');
      ui.feeQuote = result; ui.notice = 'Review the exact fee, proceeds and terms, then explicitly list the card.';
    });
    return;
  }
  if (action === 'quote-withdrawal') {
    if (localDemo || data?.scope?.role !== 'SELLER') return;
    const amountCents = parsePrice(ui.instantAmount ?? ''), externalAccountId = target.dataset.bank;
    ui.instantQuote = null;
    if (amountCents === null || !externalAccountId) { ui.notice = 'Enter a positive amount and review the selected payout bank.'; render(); return; }
    await readPreview('/withdrawals/quote', { amountCents, externalAccountId, method: 'instant' }, result => {
      if (result.amountCents !== amountCents || result.method !== 'instant' || !result.quoteId || result.externalAccountId !== undefined && result.externalAccountId !== externalAccountId || !Number.isSafeInteger(result.sellerFeeCents) || result.sellerFeeCents < 0 || !Number.isSafeInteger(result.totalDebitCents) || result.totalDebitCents !== amountCents + result.sellerFeeCents) throw new Error('The instant payout quote is incomplete or changed.');
      ui.instantQuote = { ...result, externalAccountId }; ui.notice = 'Review the exact instant fee, balance debit and timing before confirming.';
    });
    return;
  }
  if (action === 'confirm-instant-withdrawal') {
    if (localDemo || data?.scope?.role !== 'SELLER') return;
    const quote = ui.instantQuote;
    if (!quote || quote.quoteId !== target.dataset.quote || Date.parse(quote.expiresAt) <= serverNow + Math.max(0, Date.now() - readAt)) return;
    const key = `instant-withdraw:${quote.quoteId}`;
    await mutate('/api/withdrawals', { requestId: requestId(key), amountCents: quote.amountCents, externalAccountId: quote.externalAccountId, method: 'instant', quoteId: quote.quoteId }, 'Original instant payout recorded.', key);
    ui.instantQuote = null; render(); return;
  }
  if (action === 'quote') {
    ui.busy = true; render();
    try {
      const response = data?.quoteDestinationRequired
        ? await fetch(endpointPath('/api/quote'), { method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','x-atlas-csrf':data.csrfToken},body:JSON.stringify({listingId:target.dataset.listing,destinationId:ui.destinationId}) })
        : await fetch(`${endpointPath('/api/quote')}?listingId=${encodeURIComponent(target.dataset.listing)}`, { cache: 'no-store', credentials: 'same-origin' });
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
  } else if (action === 'cancel-withdrawal') {
    const intent = (Array.isArray(data.intents) ? data.intents : Object.values(data.intents ?? {})).find(row => row.id === target.dataset.intent);
    if (intent?.kind !== 'PAYOUT' || intent.status !== 'PREPARED') return;
    await mutate('/api/withdrawals/cancel', { intentId: intent.id }, 'The undispatched withdrawal was canceled and its reserved balance released.');
  }
});
async function readPreview(path, body, adopt) {
  ui.busy = true; render();
  try {
    const response = await fetch(apiPath + path, { method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','x-atlas-csrf':data?.csrfToken ?? ''},body:JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? result.error?.message ?? result.error ?? 'Current quote unavailable.');
    adopt(result); scheduleExpiry();
  } catch (error) { ui.notice = String(error.message ?? error); }
  finally { ui.busy = false; render(); }
}
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
