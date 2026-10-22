import { renderApp, parsePrice } from './view.mjs';

const root = document.getElementById('app');
let data = null;
const ui = { side: 'front', price: '125.00', quote: null, selectedListingId: null, notice: null, busy: false, uncertain: false };
const requests = new Map();
function requestId(key) {
  if (!requests.has(key)) requests.set(key, `demo_${crypto.randomUUID().replaceAll('-', '_')}`);
  return requests.get(key);
}
function render() { root.innerHTML = renderApp(data, ui); }
async function readState() {
  const response = await fetch('/api/demo', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Saved local state is unavailable.');
  data = await response.json();
  if (data.mode !== 'SYNTHETIC_LOCAL') throw new Error('Only the explicitly synthetic local runtime can be used.');
  ui.uncertain = false;
}
async function refresh() {
  ui.busy = true;
  render();
  try { await readState(); ui.notice = 'Saved local state refreshed. No payment or shipment was dispatched.'; }
  catch (error) { ui.notice = error.message; }
  finally { ui.busy = false; render(); }
}
async function mutate(endpoint, body, success, requestKey) {
  if (ui.busy || ui.uncertain) return;
  ui.busy = true;
  ui.notice = 'Recording this local action…';
  render();
  let terminalRefusal = false;
  try {
    const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-atlas-demo-csrf': data?.csrfToken ?? '' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      terminalRefusal = response.status >= 400 && response.status < 500;
      throw new Error(result.message ?? result.error?.message ?? result.error ?? 'This action could not be completed.');
    }
    await readState();
    if (requestKey) requests.delete(requestKey);
    ui.notice = success;
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
      const response = await fetch(`/api/catalog?${params}`, { cache: 'no-store', credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Listings unavailable.');
      ui.catalog = result;
      ui.selectedListingId = result.items?.[0]?.id ?? null;
      ui.quote = null;
      ui.notice = `${result.total} available synthetic listing${result.total === 1 ? '' : 's'} match your filters. Collection specimens are not included.`;
    } catch (error) { ui.notice = String(error.message ?? error); }
    finally { ui.busy = false; render(); }
    return;
  }
  if (event.target.id !== 'listing-form') return;
  event.preventDefault();
  const askingPriceCents = parsePrice(ui.price);
  if (askingPriceCents === null) { ui.notice = 'Enter a positive USD amount with no more than two decimal places.'; render(); return; }
  const card = Array.isArray(data?.eligibilityCards) ? data.eligibilityCards[0] : Object.values(data?.eligibilityCards ?? {})[0];
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
  if (action === 'select-listing') { ui.selectedListingId = target.dataset.listing; ui.quote = null; ui.side = 'front'; render(); root.querySelector('#specimen-heading')?.scrollIntoView({ block: 'start' }); return; }
  if (ui.busy || ui.uncertain) return;
  if (action === 'quote') {
    ui.busy = true; render();
    try {
      const response = await fetch(`/api/quote?listingId=${encodeURIComponent(target.dataset.listing)}`, { cache: 'no-store', credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Quote unavailable.');
      ui.quote = result.quote ?? result;
      ui.selectedListingId = target.dataset.listing;
      ui.notice = 'Review the complete total, delivery estimate and protection terms before reserving.';
    } catch (error) { ui.notice = String(error.message ?? error); }
    finally { ui.busy = false; render(); }
    return;
  }
  if (action === 'consent') {
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
    await mutate('/api/demo/provider', { intentId: target.dataset.intent, status: target.dataset.status }, 'Synthetic provider evidence was updated and the original intent reconciled. No real money moved.');
  } else if (action === 'fulfillment') {
    const key = `fulfillment:${target.dataset.order}:${target.dataset.step}`;
    await mutate('/api/fulfillment', { requestId: requestId(key), orderId: target.dataset.order, action: target.dataset.step }, 'Synthetic fulfillment evidence recorded. No physical action occurred.', key);
  } else if (action === 'withdraw') {
    const amountCents = Number(target.dataset.amount);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return;
    const key = `withdraw:${amountCents}`;
    await mutate('/api/withdrawals', { requestId: requestId(key), amountCents }, 'The synthetic withdrawal intent is saved. Confirm its bank result with the local simulator.', key);
  } else if (action === 'reconcile-withdrawal') {
    await mutate('/api/withdrawals/reconcile', { intentId: target.dataset.intent }, 'The original withdrawal was reconciled. No replacement payout was created.');
  }
});
await refresh();
