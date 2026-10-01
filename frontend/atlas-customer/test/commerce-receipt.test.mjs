import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../package.json', import.meta.url)), babel = require('next/dist/compiled/babel/core'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const compile = path => babel.transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { filename: path, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } }, 'transform-runtime': { helpers: false } }]], babelrc: false, configFile: false }).code;
const receipt = {};
vm.runInNewContext(compile('../components/commerce/OrderReceipt.jsx'), { exports: receipt, Intl, require: name => name === 'react' ? React : name.endsWith('.css') ? {} : name.endsWith('/client.mjs') ? {} : name.endsWith('CustomerHandoff.jsx') ? {__esModule:true,default:()=>null} : require(name) });
const order = { id: 'saved-order', reference: 'ATLAS-SAVED', receipt: { channel: 'KIOSK', subtotalCents: 5000, shippingCents: 0, taxCents: 450, totalCents: 5450,
    cards: [{ cardId: 'one', unitCents: 5000 }], terms: { days: 7, clockStart: 'ATLAS_COLLECTION' }, location: { name: 'Original kiosk', address: { line1: '1 Saved Street', city: 'Testville' },
        schedule: { timeZone: 'America/Los_Angeles', nextCollectionAt: '2026-09-30T17:00:00Z', projectedReturnAt: '2026-10-07T17:00:00Z', cutoffAt: '2026-09-30T16:00:00Z' } } },
    effects: [{ id: 'email', kind: 'EMAIL_RECEIPT', state: 'SUCCEEDED', deliveryStatus: 'ACCEPTED' }, { id: 'sms', kind: 'SMS_RECEIPT', state: 'SUCCEEDED', deliveryStatus: 'QUEUED' }, { id: 'label', kind: 'PACKAGE_LABEL', state: 'SUCCEEDED', artifactState: 'GENERATED' }] };
test('paid kiosk receipt retains exact saved location, schedule, terms, amounts and honest delivery/print states', () => {
    const html = renderToStaticMarkup(React.createElement(receipt.default, { initialOrder: order }));
    for (const content of ['Original kiosk', '1 Saved Street', 'Collection shown at checkout', 'Sep 30', 'Return projected at checkout', 'Oct 7', 'Drop-off cutoff', 'PDT', 'One week from actual ATLAS collection', '$50.00', '$4.50', '$54.50', 'Included', 'Accepted for delivery', 'Queued for delivery', 'Download label', 'does not confirm it has been printed']) assert.ok(html.includes(content), content);
    assert.doesNotMatch(html, />Sent<|>Delivered<|Prepare your shipment/);
});
test('mail paid receipt uses its retained clock and shipping-leg terms', () => {
    const html = renderToStaticMarkup(React.createElement(receipt.default, { initialOrder: { ...order, receipt: { ...order.receipt, channel: 'MAIL_IN', location: null, terms: { days: 14, clockStart: 'CARRIER_ACCEPTANCE', mailChargedLegs: 'BOTH_LEGS' }, subtotalCents: 4000, shippingCents: 1350, taxCents: 320, totalCents: 5670 } } }));
    for (const content of ['Two weeks from carrier acceptance', 'trip to ATLAS and the return trip', '$40.00', '$13.50', '$3.20', '$56.70', 'Prepare your shipment']) assert.ok(html.includes(content), content);
    assert.doesNotMatch(html, /Original kiosk|dropbox package|Included/);
    const inbound = renderToStaticMarkup(React.createElement(receipt.ServiceSummary, { snapshot: { channel: 'MAIL_IN', terms: { days: 14, clockStart: 'ATLAS_RECEIPT', mailChargedLegs: 'INBOUND_ONLY' } } }));
    assert.match(inbound, /physical receipt at ATLAS/); assert.match(inbound, /Return shipping is not included in this payment/);
});
test('provider acceptance and unknown delivery never assert sent or delivered', () => {
    for (const [deliveryStatus, expected] of [['ACCEPTED', 'Accepted for delivery'], ['QUEUED', 'Queued for delivery'], ['SENT', 'Sent'], ['DELIVERED', 'Delivered'], ['UNDELIVERED', 'Not delivered'], [undefined, 'Delivery not confirmed']]) assert.equal(receipt.deliveryLabel({ state: 'SUCCEEDED', deliveryStatus }), expected);
    assert.equal(receipt.deliveryLabel({ state: 'UNKNOWN', deliveryStatus: 'DELIVERED' }), 'Checking status');
    assert.equal(receipt.deliveryLabel({ state: 'FAILED' }), 'Needs attention');
});
test('resumed paid checkout renders receipt from the original paid order even when current view differs', async () => {
    let cursor = 0, tree; const slots = [], effects = [];
    const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => value !== b[i]);
    const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], value => { slots[id] = typeof value === 'function' ? value(slots[id]) : value; }]; },
        useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
        useCallback(value, deps) { const id = cursor++; if (changed(slots[id]?.deps, deps)) slots[id] = { value, deps }; return slots[id].value; },
        useEffect(fn, deps) { const id = cursor++; if (changed(slots[id]?.deps, deps)) { slots[id] = { deps }; effects.push(fn); } } };
    const exports = {}, notifications = [];
    vm.runInNewContext(compile('../components/commerce/CommerceCheckout.jsx'), { exports, Intl, require: name => name === 'react' ? react : name.endsWith('OrderReceipt.jsx') ? { ...receipt, __esModule: true } : name.endsWith('.css') ? {} : require(name) });
    const props = { draft: { id: 'draft', channel: 'MAIL_IN' }, request: async () => ({ channel: 'MAIL_IN', location: { name: 'Changed location' }, activePayment: { state: 'PAID', order } }), onPaid: value => notifications.push(value) };
    const render = () => { cursor = 0; tree = exports.default(props); while (effects.length) effects.shift()(); };
    render(); await new Promise(resolve => setImmediate(resolve)); render();
    assert.equal(tree.type, receipt.default); assert.equal(tree.props.initialOrder, order); assert.equal(notifications.length, 1);
    render(); assert.equal(notifications.length, 1);
});

test('cold commerce offers a saved-draft destination without quoting, collecting payment or inventing order status', () => {
    const exports = {};
    vm.runInNewContext(compile('../components/commerce/CommerceCheckout.jsx'), { exports, Intl, require: name => name === 'react' ? React : name.endsWith('OrderReceipt.jsx') ? { ...receipt, __esModule: true } : name.endsWith('.css') ? {} : require(name) });
    const html = renderToStaticMarkup(React.createElement(exports.SavedDraftConfirmation, { draft: { cards: [{id:'saved-card',identity:{title:'Saved card identity'}}] } }));
    assert.match(html, /Your draft is saved/); assert.match(html, /Saved card identity/); assert.match(html, /href="\/account"/);
    assert.match(html, /does not take a payment or confirm an order/); assert.doesNotMatch(html, /Get exact total|Pay securely|have not been charged|Order confirmed/);
});
