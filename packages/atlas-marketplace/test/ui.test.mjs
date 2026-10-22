import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApp, parsePrice } from '../ui/view.mjs';
import { makeSyntheticEligibility, makeSyntheticPolicy } from './listing-fixtures.mjs';

const demo = () => ({ mode: 'SYNTHETIC_LOCAL', csrfToken: 'demo_csrf', eligibilityCards: [makeSyntheticEligibility().approvedCard], policy: makeSyntheticPolicy(), actors: { sellerId: 'demo_seller', buyerId: 'demo_buyer' }, listings: [], reservations: [], orders: [], intents: [], consent: {}, fulfillment: {}, balance: null });

test('buyer/seller UI identifies synthetic state, refuses real mode, escapes text and exposes all catalog facets', () => {
  const data = demo();
  data.eligibilityCards[0].identity.name = '<img src=x onerror="alert(1)">';
  data.eligibilityCards[0].media.front.url = 'javascript:alert(1)';
  const html = renderApp(data);
  assert.match(html, /LOCAL SYNTHETIC DEMO/);
  assert.match(html, /Hold and list/);
  assert.match(html, /Ship to me/);
  assert.match(html, /Not reconciled/);
  assert.match(html, /&lt;img src=x/);
  assert.doesNotMatch(html, /src="javascript:|<img src=x|onerror="alert/);
  for (const name of ['query', 'category', 'set', 'year', 'grade', 'minPriceCents', 'maxPriceCents', 'numberedDenominator', 'autograph', 'relic']) assert.match(html, new RegExp(`name="${name}"`));
  assert.match(renderApp({ ...data, mode: 'PRODUCTION' }), /Marketplace unavailable/);
  assert.doesNotMatch(renderApp({ ...data, mode: 'PRODUCTION' }), /data-action="pay"/);
});

test('seller amount parsing cannot silently round, coerce or overflow', () => {
  assert.equal(parsePrice('125.00'), 12500);
  assert.equal(parsePrice('0.01'), 1);
  for (const value of ['', '0', '-1', '1.001', '1e2', '12abc', ' 12', '9007199254740992.00', 12]) assert.equal(parsePrice(value), null);
});

test('a lost payment response performs only recovery reads; unresolved state blocks another POST and carries CSRF', async () => {
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  const listeners = {};
  const root = { innerHTML: '', addEventListener(type, fn) { listeners[type] = fn; }, querySelector() { return null; } };
  const data = demo();
  const calls = [];
  globalThis.document = { getElementById() { return root; }, querySelector() { return null; } };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) return { ok: true, json: async () => data };
    throw new Error('Connection interrupted');
  };
  try {
    await import(`../ui/app.mjs?qualification=${Date.now()}`);
    const button = { disabled: false, dataset: { action: 'pay', reservation: 'demo_reservation' } };
    await listeners.click({ target: { closest: () => button } });
    assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1);
    assert.equal(calls[1].options.headers['x-atlas-demo-csrf'], 'demo_csrf');
    assert.equal(calls.filter((call) => call.url === '/api/demo').length, 2);
    assert.match(root.innerHTML, /last response is unknown/);
    await listeners.click({ target: { closest: () => button } });
    assert.equal(calls.length, 3);
  } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; }
});
