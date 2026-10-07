import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as contract from '../lib/customer-intake-contract.mjs';
import * as routes from '../lib/routes.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const nextRequire = createRequire(require.resolve('next/package.json'));
const compiled = babel.transformSync(readFileSync(new URL('../components/CustomerIntakeWorkspace.jsx', import.meta.url), 'utf8'), {
    filename: 'CustomerIntakeWorkspace.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code;
const now = '2026-09-09T09:00:00.000Z';
const makeCard = (stage, title) => ({ id: randomUUID(), title, category: 'SPORTS', specimenId: stage === 'SUBMITTED' ? null : randomUUID(), stage,
    events: [...new Set(['SUBMITTED', stage])].map(kind => ({ kind, recordedAt: now })), actionNeeded: null, shipment: null,
    reportUrl: ['APPROVED', 'ENCAPSULATED'].includes(stage) ? `/reports/ar_${'a'.repeat(24)}?v=1` : null });
function harness() {
    const slots = [], effects = []; let cursor = 0, tree, guard;
    const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
        useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useEffect(action, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((v, n) => v !== prior[n])) { slots[i] = deps; effects.push(action); } } };
    const cards = [makeCard('SUBMITTED', 'Unreceived card'), makeCard('APPROVED', 'Approved card'), makeCard('ENCAPSULATED', 'Finished card')];
    const f = { props: { csrf: 'a'.repeat(64), disabled: false }, calls: [], locks: [], cards,
        queue: { submissions: [{ id: randomUUID(), reference: 'ATLAS-123456ABCDEF', createdAt: now, intakeMethod: 'MAIL_IN',
            profileSnapshot: { name: 'Fictional Collector', address1: '12 Example Street', address2: '', city: 'Example', region: 'CA', postalCode: '90210', country: 'US' }, cards }], nextCursor: null },
        freshCsrf: 'b'.repeat(64), signedIn: true, failRead: false, respond: async () => { throw Error('Unexpected synthetic write'); } };
    f.props.onPendingChange = value => f.locks.push(value);
    const exports = {};
    vm.runInNewContext(compiled, { exports, crypto: { randomUUID }, window: { addEventListener() {}, removeEventListener() {} }, require(name) {
        if (name === 'react') return react;
        if (name === 'next/link') return 'next-link';
        if (name === '../lib/customer-intake-contract.mjs') return contract;
        if (name === '../lib/routes.mjs') return routes;
        if (name === '../lib/usePendingNavigation') return { usePendingNavigation: fn => { guard = fn; } };
        if (name === '../lib/client-request.mjs') return { staffClientRequest: async path => {
            f.calls.push({ path }); if (f.failRead) throw Error('Lost list reply'); return { ok: true, status: 200, data: structuredClone(f.queue) };
        } };
        if (name === './MachinePreparation') return { operationsRequest: async (path, options = {}) => {
            f.calls.push({ path, ...options, body: options.body && structuredClone(options.body) });
            if (path === 'session') return { staff: f.signedIn ? { id: 'human' } : null, csrf: f.freshCsrf };
            return f.respond(path, options);
        } };
        if (name.endsWith('.module.css')) return {};
        return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
    const all = (node, predicate, out = []) => { if (Array.isArray(node)) node.forEach(n => all(n, predicate, out));
        else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); all(node.props?.children, predicate, out); } return out; };
    const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
    f.render = () => { cursor = 0; tree = exports.default(f.props); for (const effect of effects.splice(0)) effect(); return tree; };
    f.find = (type, label) => { const value = all(tree, node => node.type === type && (label === undefined || text(node).includes(label)))[0]; assert.ok(value, `${type}: ${label}`); return value; };
    f.has = (type, label) => all(tree, node => node.type === type && text(node).includes(label)).length > 0;
    f.change = (label, value, checked = false) => { const field = f.find('label', label), input = all(field, node => ['input', 'select', 'textarea'].includes(node.type))[0];
        input.props.onChange({ target: { value, checked } }); f.render(); };
    f.click = async label => { await f.find('button', label).props.onClick(); f.render(); };
    f.submit = async label => { await f.find('form', label).props.onSubmit({ preventDefault() {} }); f.render(); };
    f.prepareBind = () => { f.change('Exact grading specimen reference', randomUUID()); f.change('I physically received', '', true); };
    f.writes = () => f.calls.filter(row => row.body); f.pending = () => guard(); f.render(); return f;
}
function receipt(body, kind = 'RECEIVED') { return { receipt: { id: randomUUID(), operationId: body.operationId, cardId: body.cardId, kind, recordedAt: now } }; }

test('actual forms require physical confirmation and report approval alone cannot enable shipping', async () => {
    const f = harness(); await f.click('Load latest submissions'); await f.click('Unreceived card');
    assert.ok(f.has('span', '0 of 3 cards shipped')); assert.ok(f.has('span', 'Mail-in'));
    await f.submit('Receive and associate'); assert.equal(f.writes().length, 0);
    f.change('Exact grading specimen reference', randomUUID()); await f.submit('Receive and associate'); assert.equal(f.writes().length, 0);
    await f.click('Approved card'); assert.equal(f.find('fieldset', 'Record physical shipment').props.disabled, true);
    f.change('Carrier', 'USPS'); f.change('Tracking number', 'EXAMPLE123'); f.change('I physically handed', '', true);
    await f.submit('Record physical shipment'); assert.equal(f.writes().length, 0);
    await f.click('Finished card'); assert.equal(f.find('fieldset', 'Record physical shipment').props.disabled, false);
    f.change('Carrier', 'USPS'); f.change('Tracking number', 'EXAMPLE123'); await f.submit('Record physical shipment'); assert.equal(f.writes().length, 0);
    f.change('I physically handed', '', true); f.respond = async (path, { body }) => receipt(body, 'SHIPPED');
    await f.submit('Record physical shipment'); assert.equal(f.writes().length, 1); assert.equal(f.writes()[0].body.physicalDispatchConfirmed, true);
    assert.equal(f.writes()[0].body.cardId, f.cards[2].id);
});

test('lost reply keeps exact bind, blocks same-tick double click, and recovers with fresh access while disabled', async () => {
    const f = harness(); await f.click('Load latest submissions'); await f.click('Unreceived card'); f.prepareBind();
    let reject; f.respond = () => new Promise((yes, no) => { reject = no; });
    const first = f.submit('Receive and associate'); await f.submit('Receive and associate'); assert.equal(f.writes().length, 1);
    reject(Error('Lost reply')); await first; const original = structuredClone(f.writes()[0].body);
    assert.equal(f.pending(), true); assert.equal(f.locks.at(-1), true);
    f.props.disabled = true; f.render(); f.signedIn = false; await f.click('Retry exact customer action');
    assert.equal(f.writes().length, 1); assert.equal(f.pending(), true);
    f.signedIn = true; f.respond = async () => { throw { status: 403, code: 'FRESH_HUMAN_OPERATIONS_REQUIRED' }; };
    await f.click('Retry exact customer action'); assert.equal(f.pending(), true); assert.deepEqual(f.writes()[1].body, original);
    f.respond = async (path, { body }) => receipt(body);
    await f.click('Retry exact customer action'); assert.equal(f.pending(), false); assert.equal(f.locks.at(-1), false);
    for (const call of f.writes()) { assert.deepEqual(call.body, original); assert.equal(call.path, 'operations/customers/bind'); }
    assert.equal(f.writes().at(-1).csrf, f.freshCsrf);
});

test('confirmed action with failed list refresh locks controls and reload never repeats the mutation', async () => {
    const f = harness(); await f.click('Load latest submissions'); await f.click('Unreceived card'); f.prepareBind();
    f.respond = async (path, { body }) => receipt(body); f.failRead = true;
    await f.submit('Receive and associate'); assert.equal(f.pending(), true); assert.equal(f.has('button', 'Retry exact customer action'), false);
    assert.equal(f.find('fieldset', 'Receive and associate').props.disabled, true); assert.ok(f.has('p', 'The action is saved.'));
    const count = f.writes().length; f.props.disabled = true; f.render(); f.failRead = false;
    await f.click('Refresh access and submissions'); assert.equal(f.writes().length, count); assert.equal(f.pending(), false); assert.equal(f.locks.at(-1), false);
});

test('customer-visible action message requires explicit review and holds exact content through malformed receipts', async () => {
    const f = harness(); await f.click('Load latest submissions'); await f.click('Unreceived card');
    f.change('What the customer needs to do', 'CARD_DETAILS_NEEDED'); f.change('Message shown', 'Please confirm the card number.');
    await f.submit('Ask the customer to act'); assert.equal(f.writes().length, 0);
    f.change('I reviewed this customer-visible message', '', true);
    f.respond = async (path, { body }) => ({ receipt: { ...receipt(body, 'ACTION_NEEDED').receipt, cardId: randomUUID() } });
    await f.submit('Ask the customer to act'); assert.equal(f.pending(), true);
    const original = structuredClone(f.writes()[0].body);
    assert.deepEqual(Object.keys(original).sort(), ['operationId', 'cardId', 'reason', 'message', 'resolved'].sort());
    f.respond = async (path, { body }) => receipt(body, 'ACTION_NEEDED'); await f.click('Retry exact customer action');
    assert.deepEqual(f.writes()[1].body, original); assert.equal(f.pending(), false);
});

test('stale card selection changes and disabled form calls cannot replace the retained request', async () => {
    const f = harness(); await f.click('Load latest submissions'); await f.click('Unreceived card'); f.prepareBind();
    f.respond = async () => { throw Error('lost'); }; await f.submit('Receive and associate');
    await f.click('Finished card'); assert.ok(f.has('h3', 'Unreceived card')); assert.equal(f.writes().length, 1);
    f.props.disabled = true; f.render(); await f.submit('Receive and associate'); assert.equal(f.writes().length, 1);
    assert.equal(f.find('a', 'Sign in in another tab').props.href, '/admin?reauthenticate=1');
    assert.equal(f.find('a', 'Sign in in another tab').props.target, '_blank');
});
