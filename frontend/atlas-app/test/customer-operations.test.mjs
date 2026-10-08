import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as contract from '../lib/customer-operations.mjs';
import * as routes from '../lib/routes.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/CustomerOperations.jsx', import.meta.url), 'utf8'), {
  filename: 'CustomerOperations.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const staff = { id: randomUUID(), name: 'Fixture reviewer', role: 'REVIEWER', mode: 'LOCAL_FIXTURE' };
const card = { cardId: randomUUID(), channel: 'KIOSK', events: [], identity: { title: 'Synthetic intake card' }, grading: 'NOT_STARTED', manualCardId: null };
const input = { cardId: card.cardId, requestId: randomUUID(), kind: 'COLLECTED', occurredAt: '2026-09-22T12:00:00.000Z', evidence: { reference: 'fixture-custody-001', note: 'Verified fixture only' } };
const empty = { orders: [], manualCards: [], memberships: [], locations: [] };
const record = () => ({ version: 1, staffId: staff.id, action: 'custody', input: structuredClone(input), acknowledged: false });
function storage() { const rows = new Map(); return { getItem: k => rows.get(k) ?? null, setItem: (k, v) => rows.set(k, v), removeItem: k => rows.delete(k) }; }
function load(react, overrides = {}) {
  const exports = {};
  vm.runInNewContext(code, { exports, crypto: { randomUUID }, Intl, ...overrides, require(name) {
    if (name === 'react') return react;
    if (name === 'next/link') return 'a';
    if (name === './Shell') return { __esModule: true, default: ({ children }) => react.createElement('main', null, children) };
    if (name === '../lib/customer-operations.mjs') return contract;
    if (name === '../lib/routes.mjs') return routes;
    if (name === '../lib/client') return overrides.client ?? { useStaffResource: () => { throw Error('Unexpected staff read'); } };
    if (name.endsWith('.module.css')) return {};
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  return exports;
}
function harness(existingStorage = storage()) {
  const slots = [], effects = []; let cursor = 0, tree;
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(action, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((v, n) => v !== prior[n])) { slots[i] = deps; effects.push(action); } } };
  const f = { storage: existingStorage, calls: [], data: structuredClone(empty), csrf: 'fixture-csrf', staff, reloads: 0, lock: false, signedIn: true,
    response: async () => { throw Error('No fixture response was configured'); } };
  const api = async (path, options = {}) => {
    f.calls.push({ path, ...options, ...(options.body ? { body: structuredClone(options.body) } : {}) });
    if (path === 'session') return { csrf: f.csrf, staff: f.signedIn ? f.staff : null };
    if (!options.body) return structuredClone(f.data);
    return f.response(path, options);
  };
  const exported = load(react, { window: { localStorage: f.storage, addEventListener() {}, removeEventListener() {} }, navigator: { locks: { request: async (_key, _options, fn) => {
    if (f.lock) return fn(null); f.lock = true; try { return await fn({}); } finally { f.lock = false; }
  } } }, client: { api, useStaffResource: () => ({ loading: false, data: f.data, session: { staff, csrf: f.csrf }, error: '', reload: () => { f.reloads++; } }) } });
  const all = (node, predicate, out = []) => { if (Array.isArray(node)) node.forEach(n => all(n, predicate, out)); else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); all(node.props?.children, predicate, out); } return out; };
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
  f.render = () => { cursor = 0; tree = exported.Operations({ staff }); for (const effect of effects.splice(0)) effect(); return tree; };
  f.nodes = (type, label) => all(tree, n => n.type === type && (label === undefined || text(n).includes(label)));
  f.click = async label => { const node = f.nodes('button', label)[0]; assert.ok(node, label); await node.props.onClick(); f.render(); };
  f.action = (...args) => { const roster = all(tree, n => n.type === exported.OrderRoster)[0]; assert.ok(roster); return roster.props.onAction(...args); };
  f.writes = () => f.calls.filter(row => row.body);
  f.saved = () => contract.browserJournal(existingStorage, staff.id).read();
  f.render(); f.render(); return f;
}
function confirmedData(entry = record()) {
  return { ...structuredClone(empty), orders: [{ id: randomUUID(), reference: 'ATLAS-FIXTURE', cards: [{ ...card, custodyEvents: [{ id: randomUUID(), actorId: entry.staffId, requestId: entry.input.requestId, kind: entry.input.kind, occurredAt: '2026-09-22T12:00:00+00:00', evidence: structuredClone(entry.input.evidence) }] }] }] };
}

test('custody availability follows actual physical sequence and approval, never a projected collection time', () => {
  assert.deepEqual(contract.availableCustody({ ...card, currentProjection: { nextCollectionAt: '2020-01-01' } }), ['COLLECTED', 'DELAY_REPORTED', 'DELAY_RESOLVED']);
  const received = { ...card, events: [{ kind: 'COLLECTED' }, { kind: 'ATLAS_RECEIVED' }] };
  assert.equal(contract.availableCustody(received).includes('RETURN_DISPATCHED'), false);
  assert.equal(contract.availableCustody({ ...received, manualCardId: randomUUID(), grading: 'HUMAN_APPROVED' }).includes('RETURN_DISPATCHED'), true);
  assert.equal(contract.availableCustody({ ...card, channel: 'MAIL_IN' })[0], 'ATLAS_RECEIVED');
  assert.throws(() => contract.custodyInput(card, { kind: 'COLLECTED', confirmed: false }, randomUUID), /Confirm the actual event/);
  assert.throws(() => contract.custodyInput(card, { kind: 'COLLECTED', confirmed: true, occurredAt: '2099-01-01', reference: 'x' }, randomUUID, Date.now()), /already happened/);
});

test('empty registry defaults disabled with no fabricated schedule; actual structured configuration is preserved', () => {
  const form = contract.newLocation(); assert.equal(form.enabled, false); assert.deepEqual(form.schedule.pickups, []); assert.equal(form.authorizedUntil, '');
  assert.throws(() => contract.locationInput(form, randomUUID), /time zone|schedule/);
  Object.assign(form, { dealerId: randomUUID(), name: 'Fixture location', address: { line1: '1 Fixture Way', city: 'Test', region: 'CA', postalCode: '90001', country: 'US' }, position: { lat: '34', lng: '-118' }, schedule: { timeZone: 'America/Los_Angeles', pickups: [{ weekday: '2', time: '10:00', cutoff: '09:00' }], returns: [{ weekday: 2, time: '11:00' }], exceptions: [{ date: '2026-10-06', kind: 'pickups', cancelled: true, reason: 'Fixture closure' }] }, terminalId: 'fixture-reader', terminalLocationId: 'fixture-location', packagePrinterId: 'fixture-printer', entryToken: 'a'.repeat(64), authorizedUntil: '2026-10-01T12:00:00Z' });
  const result = contract.locationInput(form, randomUUID);
  assert.equal(result.enabled, false); assert.deepEqual(result.position, { lat: 34, lng: -118 }); assert.equal(result.schedule.pickups[0].weekday, 2); assert.equal(result.schedule.exceptions[0].time, undefined); assert.equal(result.authorizedUntil, '2026-10-01T12:00:00.000Z');
});

test('reconciliation requires exact staff event identity and content; public timeline is insufficient', () => {
  const entry = record(), data = confirmedData(entry); assert.equal(contract.operationRecorded(data, entry), true);
  for (const change of [{ actorId: randomUUID() }, { requestId: randomUUID() }, { evidence: { reference: 'different' } }, { occurredAt: '2026-09-22T12:01:00Z' }]) {
    const altered = structuredClone(data); Object.assign(altered.orders[0].cards[0].custodyEvents[0], change); assert.equal(contract.operationRecorded(altered, entry), false);
  }
  delete data.orders[0].cards[0].custodyEvents; data.orders[0].cards[0].events = [{ ...entry.input }]; assert.equal(contract.operationRecorded(data, entry), false);
});

test('phone-only shop setup omits blank equipment and reconciles SQL nulls without accepting different equipment', () => {
  const saved = { id: randomUUID(), dealer_id: randomUUID(), revision: 4, enabled: true, name: 'Synthetic phone shop',
    address: { line1: '1 Fixture Way', city: 'Test', region: 'CA', postalCode: '90001', country: 'US' }, latitude: 34, longitude: -118,
    schedule: { timeZone: 'America/Los_Angeles', pickups: [{ weekday: 2, time: '10:00', cutoff: '09:00' }], returns: [{ weekday: 2, time: '11:00' }], exceptions: [] },
    terminal_id: null, terminal_location_id: null, package_printer_id: null, entry_token: 'a'.repeat(64), authorized_until: '2026-10-15T12:00:00Z' };
  const form = contract.locationForm(saved);
  assert.equal(form.terminalId, ''); assert.equal(form.terminalLocationId, ''); assert.equal(form.packagePrinterId, '');
  form.packagePrinterId = '  ';
  const input = contract.locationInput(form, randomUUID), journal = { action: 'location-configure', input, staffId: staff.id };
  for (const key of ['terminalId', 'terminalLocationId', 'packagePrinterId']) assert.equal(Object.hasOwn(input, key), false);
  const after = { ...saved, revision: 5 };
  assert.equal(contract.operationRecorded({ locations: [after] }, journal), true);
  assert.equal(contract.operationRecorded({ locations: [{ ...after, terminal_id: 'unexpected-reader' }] }, journal), false);
  assert.equal(contract.operationRecorded({ locations: [saved] }, journal), false);
  const legacy = { ...saved, terminal_id: 'retained-reader', terminal_location_id: 'retained-terminal-location', package_printer_id: 'retained-printer' };
  const legacyInput = contract.locationInput(contract.locationForm(legacy), randomUUID);
  assert.deepEqual([legacyInput.terminalId, legacyInput.terminalLocationId, legacyInput.packagePrinterId], ['retained-reader', 'retained-terminal-location', 'retained-printer']);
  assert.equal(contract.operationRecorded({ locations: [{ ...legacy, revision: 5 }] }, { ...journal, input: legacyInput }), true);
  assert.equal(contract.operationRecorded({ locations: [after] }, { ...journal, input: legacyInput }), false);
  assert.throws(() => contract.locationInput({ ...form, terminalId: 'x'.repeat(161) }, randomUUID), /terminal ID/);
});

test('rendered empty roster is honest and received-card binding uses only accessible saved cards', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), exported = load(React);
  const emptyHtml = renderToStaticMarkup(React.createElement(exported.OrderRoster, { data: empty })); assert.match(emptyHtml, /No paid customer submissions yet/);
  const observer = renderToStaticMarkup(React.createElement(exported.default, { staff: { ...staff, role: 'OBSERVER' } })); assert.match(observer, /reviewer staff account is required/);
  const received = { ...card, events: [{ id: randomUUID(), kind: 'ATLAS_RECEIVED', occurredAt: input.occurredAt }] };
  const html = renderToStaticMarkup(React.createElement(exported.CustodyCard, { card: received, manualCards: [], disabled: false })); assert.match(html, /No accessible, unlinked grading cards/); assert.match(html, /<fieldset disabled=""><legend>Match the physical card/); assert.match(html, /type="datetime-local"[^>]*value=""/);
  const member = renderToStaticMarkup(React.createElement(exported.MembershipEditor, { data: empty, disabled: false })); assert.match(member, /No dealer memberships/); assert.match(member, /<fieldset disabled="">/);
  const setup = renderToStaticMarkup(React.createElement(exported.LocationEditor, { locations: [], disabled: false })); assert.match(setup, /No kiosk locations are configured/); assert.match(setup, /No weekly pickups entered/); assert.doesNotMatch(setup, /type="checkbox"[^>]*checked/);
  assert.match(setup, /Customers pay on their own phones/);
  for (const label of ['Linked payment terminal ID', 'Payment terminal location ID', 'Package printer ID']) {
    const attributes = setup.match(new RegExp(`<span>${label} \\(optional\\)</span><input([^>]*)>`))?.[1];
    assert.notEqual(attributes, undefined); assert.doesNotMatch(attributes, /required/);
  }
});

test('lost custody reply survives remount, prevents double click, and reconciles by read without resubmitting', async () => {
  const f = harness(); let reject; f.response = () => new Promise((resolve, no) => { reject = no; });
  const first = f.action('custody', structuredClone(input)); await f.action('custody', structuredClone(input));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.writes().length, 1); assert.deepEqual(f.saved().input, input);
  reject(Error('Fixture lost reply')); await first; f.render(); assert.equal(f.saved().acknowledged, false);
  const restored = harness(f.storage); assert.equal(restored.writes().length, 0); assert.equal(restored.nodes('button', 'Retry exact saved request').length, 1);
  restored.data = confirmedData(restored.saved()); await restored.click('Check saved status'); assert.equal(restored.saved(), null); assert.equal(restored.writes().length, 0);
});

test('explicit retry keeps request ID/content and fresh csrf; a retry refusal never erases earlier uncertainty', async () => {
  const s = storage(); contract.browserJournal(s, staff.id).save(record()); const f = harness(s);
  f.response = async () => { throw { status: 403, code: 'FRESH_HUMAN_OPERATIONS_REQUIRED' }; }; f.csrf = 'fresh-csrf';
  await f.click('Retry exact saved request'); assert.deepEqual(f.writes()[0].body, input); assert.equal(f.writes()[0].csrf, 'fresh-csrf'); assert.ok(f.saved());
  f.signedIn = false; await f.click('Retry exact saved request'); assert.equal(f.writes().length, 1); assert.ok(f.saved());
  f.signedIn = true; f.response = async () => { f.data = confirmedData(f.saved()); return { eventId: randomUUID() }; };
  await f.click('Retry exact saved request'); assert.equal(f.saved(), null); assert.deepEqual(f.writes()[1].body, input);
});

test('acknowledged custody with unavailable read remains locked and offers no repeat mutation', async () => {
  const f = harness(); f.response = async () => ({ eventId: randomUUID() });
  await f.action('custody', structuredClone(input)); f.render(); assert.equal(f.saved().acknowledged, true); assert.equal(f.nodes('button', 'Retry exact saved request').length, 0);
  await f.action('custody', { ...input, requestId: randomUUID() }); assert.equal(f.writes().length, 1);
  await f.click('Check saved status'); assert.equal(f.writes().length, 1); assert.ok(f.saved());
});

test('first definitive rejection unlocks editing while blocked storage and another-tab ownership prevent writes', async () => {
  const f = harness(); f.response = async () => { throw { status: 400, code: 'ACTUAL_CUSTODY_EVIDENCE_REQUIRED' }; };
  await f.action('custody', structuredClone(input)); assert.equal(f.saved(), null); assert.equal(f.writes().length, 1);
  const blocked = harness({ getItem: () => null, setItem() { throw Error('Storage unavailable'); }, removeItem() {} });
  await blocked.action('custody', structuredClone(input)); assert.equal(blocked.writes().length, 0);
  const competing = harness(); competing.lock = true; await competing.action('custody', structuredClone(input)); assert.equal(competing.writes().length, 0);
});

test('unconfirmed dealer setup has no retry write and only exact saved membership version clears it', async () => {
  const f = harness(), membership = { accountId: randomUUID(), locationId: randomUUID(), enabled: true };
  f.response = async () => { throw Error('Lost setup reply'); };
  await f.action('membership-configure', membership, { priorVersion: 2 }); f.render(); assert.equal(f.nodes('button', 'Retry exact saved request').length, 0);
  f.data.memberships = [{ ...membership, revokedAt: null, version: 4 }]; await f.click('Check saved status'); assert.ok(f.saved());
  f.data.memberships[0].version = 3; await f.click('Check saved status'); assert.equal(f.saved(), null); assert.equal(f.writes().length, 1);
});

test('return label verifies exact order, direction and PDF bytes before download', async () => {
  const { createHash, webcrypto } = await import('node:crypto'), bytes = Buffer.from('%PDF-1.7\nSynthetic return\n%%EOF'), orderId = randomUUID();
  const label = { orderId, leg: 'RETURN', mimeType: 'application/pdf', bytes: new Uint8Array(bytes), labelSha256: createHash('sha256').update(bytes).digest('hex') };
  assert.deepEqual(Buffer.from(await contract.returnLabelBytes(label, orderId, webcrypto.subtle)), bytes);
  for (const change of [{ orderId: randomUUID() }, { leg: 'INBOUND' }, { labelSha256: 'f'.repeat(64) }, { bytes: new Uint8Array(4 * 1024 * 1024 + 1) }, { bytes: new Uint8Array(Buffer.from('HTML')) }, { mimeType: 'text/html' }]) await assert.rejects(contract.returnLabelBytes({ ...label, ...change }, orderId, webcrypto.subtle), /could not be verified/);
});

test('staff paid roster separates the saved return label from actual custody and never offers a retry', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), exported = load(React);
  const order = { id: randomUUID(), reference: 'ATLAS-FIXTURE', cards: [], returnShipping: { state: 'SUCCEEDED' } };
  const html = renderToStaticMarkup(React.createElement(exported.OrderRoster, { data: { ...empty, orders: [order] } }));
  assert.match(html, /ATLAS to customer/); assert.match(html, /Download return-to-customer label/); assert.match(html, /actual mailing separately/); assert.doesNotMatch(html, /Create label|Retry.*label|labelBase64/);
  for (const state of ['PENDING', 'DISPATCHED', 'UNKNOWN', 'FAILED']) {
    const pending = renderToStaticMarkup(React.createElement(exported.ReturnShippingLabel, { order: { ...order, returnShipping: { state } } }));
    assert.match(pending, /return label is not ready/); assert.doesNotMatch(pending, /<button/);
  }
  assert.equal(renderToStaticMarkup(React.createElement(exported.ReturnShippingLabel, { order: { ...order, returnShipping: null } })), '');
});

test('return-label read is independent of a retained mutation journal and downloads only verified saved bytes', async () => {
  const { createHash, webcrypto } = await import('node:crypto');
  const bytes = Buffer.from('%PDF-1.7\nSaved return\n%%EOF'), order = { id: randomUUID(), reference: 'ATLAS-FIXTURE', returnShipping: { state: 'SUCCEEDED' } };
  const label = { orderId: order.id, leg: 'RETURN', mimeType: 'application/pdf', bytes: new Uint8Array(bytes), labelSha256: createHash('sha256').update(bytes).digest('hex') };
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const rendered = renderToStaticMarkup(React.createElement(load(React).OrderRoster, { data: { ...empty, orders: [{ ...order, cards: [] }] }, disabled: true, readDisabled: false }));
  assert.match(rendered, /<button type="button">Download return-to-customer label/);
  const calls = [], downloads = []; let released = false;
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useState: x => [x, () => {}], useRef: x => ({ current: x }) };
  const link = { click() { downloads.push({ href: this.href, name: this.download }); }, remove() {} };
  const exported = load(react, { crypto: webcrypto, Blob, document: { createElement: () => link, body: { appendChild() {} } }, URL: { createObjectURL(blob) { assert.equal(blob.type, 'application/pdf'); return 'blob:verified-return'; }, revokeObjectURL(value) { assert.equal(value, 'blob:verified-return'); released = true; } }, setTimeout: fn => fn(), client: { api: async (...args) => { calls.push(args); return label; } } });
  const tree = exported.ReturnShippingLabel({ order, disabled: false }), button = tree.props.children.find(node => node?.type === 'button');
  await button.props.onClick();
  assert.deepEqual(calls, [[`manual-connected/dealer-operations/orders/${order.id}/return-label`]]); assert.deepEqual(downloads, [{ href: 'blob:verified-return', name: 'ATLAS-FIXTURE-return-to-customer.pdf' }]); assert.equal(released, true);
});

test('return preparation appears only on server-qualified orders and uses the explicit action without custody evidence',async()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),exported=load(React),order={id:randomUUID(),returnShipping:{state:'PENDING',prepared:false,canPrepare:true}};
  const html=renderToStaticMarkup(React.createElement(exported.ReturnShippingLabel,{order,onPrepare:()=>{},prepareDisabled:false}));assert.match(html,/Prepare return label/);assert.match(html,/does not record mailing/);
  for(const canPrepare of [false,undefined]){const blocked=renderToStaticMarkup(React.createElement(exported.ReturnShippingLabel,{order:{...order,returnShipping:{...order.returnShipping,canPrepare}},onPrepare:()=>{}}));assert.doesNotMatch(blocked,/>Prepare return label</);}
  const locked=renderToStaticMarkup(React.createElement(exported.ReturnShippingLabel,{order,prepareDisabled:true,onPrepare:()=>{}}));assert.match(locked,/<button type="button" disabled="">Prepare return label/);
  const calls=[],react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:value=>[value,()=>{}],useRef:value=>({current:value})};
  const tree=load(react).ReturnShippingLabel({order,onPrepare:(...args)=>calls.push(args)}),all=node=>Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'?[node,...all(node.props?.children)]:[];
  all(tree).find(node=>node.type==='button'&&node.props.children.includes('Prepare return label')).props.onClick();assert.equal(calls[0][0],'prepare-return-label');assert.equal(calls[0][1].orderId,order.id);assert.equal(Object.keys(calls[0][1]).join(','),'orderId,requestId');
});

test('lost return preparation survives reload and only exact saved request ID reconciles without a second label request',async()=>{
  const f=harness(),input={orderId:randomUUID(),requestId:randomUUID()};f.response=async()=>{throw Error('Lost preparation reply');};
  await f.action('prepare-return-label',input);f.render();assert.equal(f.writes().length,1);assert.equal(f.writes()[0].path,`manual-connected/dealer-operations/orders/${input.orderId}/return-label`);assert.deepEqual(f.writes()[0].body,{requestId:input.requestId});assert.equal(f.saved().action,'prepare-return-label');
  const resumed=harness(f.storage);assert.equal(resumed.saved().input.requestId,input.requestId);
  resumed.data.orders=[{id:input.orderId,returnShipping:{prepared:true,preparedRequestId:randomUUID()},cards:[]}];await resumed.click('Check saved status');assert.ok(resumed.saved());
  resumed.response=async(_path,options)=>{assert.equal(options.body.requestId,input.requestId);resumed.data.orders[0].returnShipping.preparedRequestId=input.requestId;return{orderId:input.orderId,requestId:input.requestId,prepared:true,state:'PENDING'};};
  await resumed.click('Retry exact saved request');assert.equal(resumed.saved(),null);assert.equal(resumed.writes().length,1);assert.equal(resumed.writes()[0].csrf,'fixture-csrf');
});
