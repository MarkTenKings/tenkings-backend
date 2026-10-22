import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as history from '../lib/card-history-client.mjs';
import * as archive from '../lib/graded-cards-client.mjs';
import * as routes from '../lib/routes.mjs';
import * as orderDesk from '../lib/order-desk-client.mjs';
import * as soldReferences from '@atlas/manual-workspace/sold-references';
import * as identity from '@atlas/grading-core/identity';
import * as reportEntry from '@atlas/site-router/report-entry';

const cardId = randomUUID(), token = `ar_${'a'.repeat(24)}`, action = randomUUID();
const fixture = () => ({ schemaVersion: 1, card: { cardId, approvalActionId: action, certificateNumber: 'ATLAS-ABCDEF123456', identity: { playerName: 'Saved card' }, finalGrade: 8.5, approvedAt: '2026-10-20T00:00:00.000000Z', report: { state: 'PUBLISHED', version: 2, publicToken: token, path: `/reports/${token}?v=2` }, media: { FRONT: { url: `/api/reports/${token}/images/FRONT?v=2` } } }, ownership: { status: 'UNKNOWN', verification: 'UNKNOWN', history: [] }, custody: { status: 'UNKNOWN', currentPhysicalHolder: 'UNKNOWN' }, history: { scope: 'RECORDED_ATLAS_EVENTS', complete: false, snapshot: '2026-10-21T00:00:00.000000Z', events: [{ eventId: `publication:${randomUUID()}`, kind: 'REPORT_PUBLISHED', category: 'GRADING', verification: 'VERIFIED_RECORD', recordedAt: '2026-10-20T00:00:00.000000Z', report: { version: 2, finalGrade: 8.5, path: `/reports/${token}?v=2` } }], nextCursor: null } });
test('history navigation is exact-card and accepts only bounded canonical read queries', () => {
  const path = history.cardHistoryPath(cardId);
  assert.equal(routes.staffApiPath(path), `/admin/api/staff/${path}`);
  assert.equal(history.cardHistoryPagePath(cardId), `/graded-cards/${cardId}`);
  for (const bad of [undefined, [cardId], `${cardId}/other`, 'https://example.com']) assert.equal(history.historyCardId(bad), null);
  for (const suffix of ['?limit=0', '?limit=101', '?limit=01', '?limit=50&limit=50', '?owner=me', '?cursor=', '?cursor=%61', '/transfer', '?limit=50&'])
    assert.throws(() => routes.staffApiPath(`manual-connected/cards/${cardId}/provenance${suffix}`));
  assert.throws(() => history.cardHistoryPath(cardId, { cursor: 'a'.repeat(769) }));
});
test('history replies cannot switch card, ownership meaning or snapshot during pagination', () => {
  const first = fixture();
  assert.equal(history.readCardHistory(first, cardId), first);
  assert.equal(archive.recordedGrade(first.card), '8.5');
  assert.throws(() => history.readCardHistory(first, randomUUID()));
  const inferredOwner = structuredClone(first); inferredOwner.ownership.status = 'VERIFIED';
  assert.throws(() => history.readCardHistory(inferredOwner, cardId));
  const wrongDate = structuredClone(first); wrongDate.history.events[0].recordedAt = 'invalid';
  assert.throws(() => history.readCardHistory(wrongDate, cardId));
  for (const occurredAt of [true, 1729382400000, 'invalid']) {
    const malformed = structuredClone(first); malformed.history.events[0].occurredAt = occurredAt;
    assert.throws(() => history.readCardHistory(malformed, cardId));
  }
  const next = fixture(); next.history.events[0].recordedAt = '2026-10-19T00:00:00.000000Z'; next.history.events.unshift(first.history.events[0]);
  assert.equal(history.mergeCardHistory(first, next).history.events.length, 2);
  next.card.approvalActionId = randomUUID(); assert.throws(() => history.mergeCardHistory(first, next));
  next.card.approvalActionId = action; next.history.snapshot = '2026-10-22T00:00:00.000000Z';
  assert.throws(() => history.mergeCardHistory(first, next));
});
test('report and photo links remain bound to the exact token, side and saved version', () => {
  const value = fixture(), event = value.history.events[0];
  assert.equal(history.historyPhotoPath(value.card, 'FRONT'), value.card.media.FRONT.url);
  assert.equal(history.historyPhotoPath(value.card, 'BACK'), null);
  assert.equal(history.historyReportPath(event, token), event.report.path);
  event.report.path = 'https://example.com/'; assert.equal(history.historyReportPath(event, token), null);
  value.card.media.FRONT.url = `/api/reports/${token}/images/FRONT?v=1`; assert.equal(history.historyPhotoPath(value.card, 'FRONT'), null);
  assert.match(history.historyEventDetail({ kind: 'DEPOSIT_DECLARED', category: 'CUSTODY' }), /Deposit Declared/);
});

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const source = babel.transformSync(readFileSync(new URL('../components/CardHistory.jsx', import.meta.url), 'utf8'), { filename: 'CardHistory.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(extraProps = {}) {
  let cursor = 0, dirty = false;
  const slots = [], effects = [], listeners = new Map(), exports = {}, calls = [];
  const staff = { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE' };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], next => { const value = typeof next === 'function' ? next(slots[id]) : next; if (!Object.is(value, slots[id])) { slots[id] = value; dirty = true; } }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useEffect(fn, deps) { const id = cursor++, old = slots[id]; if (!old || deps.some((v, i) => v !== old.deps[i])) { slots[id] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[id].cleanup = fn(); }); } },
  };
  const f = { staff, calls, result: fixture(), hold: null, session: { staff }, failure: null, reportEntries: [] };
  const request = async (path, options) => { calls.push({ path, options }); assert.equal(options.body, undefined); if (path === 'session') return f.session; if (f.hold) return f.hold.promise; if (f.failure) throw f.failure; return structuredClone(f.result); };
  vm.runInNewContext(source, { exports, AbortController, URL, Intl, window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) }, require(name) {
    if (name === 'react') return react;
    if (name === 'next/link') return 'a';
    if (name === './Shell') return { __esModule: true, default: 'Shell' };
    if (name === './ApprovedCardMedia') return { __esModule: true, default: 'ApprovedCardMedia' };
    if (name === './StaffCompCuration') return { __esModule: true, default: 'StaffCompCuration' };
    if (name === '@atlas/manual-workspace/sold-references') return soldReferences;
    if (name === '@atlas/grading-core/identity') return identity;
    if (name === '@atlas/site-router/report-entry') return { ...reportEntry, rememberCardDetailReportClick: (...args) => f.reportEntries.push(args) };
    if (name.endsWith('/order-desk-client.mjs')) return orderDesk;
    if (name.endsWith('/routes.mjs')) return routes;
    if (name.endsWith('/card-history-client.mjs')) return history;
    if (name.endsWith('/graded-cards-client.mjs')) return archive;
    if (name.endsWith('/client')) return { api: request };
    if (name.endsWith('.module.css')) return {};
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  f.props = extraProps;
  f.render = () => { let count = 0; do { dirty = false; cursor = 0; f.tree = exports.default({ staff: f.staff, cardId, request, ...f.props }); effects.splice(0).forEach(work => work()); assert.ok(++count < 30); } while (dirty); };
  f.flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(setImmediate); f.render(); } };
  f.event = name => { listeners.get(name)?.({ persisted: true }); f.render(); };
  f.text = () => JSON.stringify(f.tree);
  f.component = (name, props) => { cursor = 1000; return exports[name](props); };
  f.find = predicate => findNode(f.tree, predicate);
  f.dispose = () => slots.forEach(slot => slot?.cleanup?.());
  f.render(); return f;
}
test('actual history component reads only after matching fresh session and retains saved grade', async () => {
  const f = harness(); await f.flush();
  assert.deepEqual(f.calls.map(call => call.path), ['session', history.cardHistoryPath(cardId)]);
  assert.match(f.text(), /ATLAS-ABCDEF123456/); assert.match(f.text(), /8\.5/);
  assert.match(JSON.stringify(f.component('CardOverview', { card: fixture().card, custody: { status: 'UNKNOWN' }, orderLinks: false })), /Not recorded/); f.dispose();
});
test('changed account prevents any private history read', async () => {
  const f = harness(); f.session = { staff: { ...f.staff, id: randomUUID() } }; f.event('pageshow'); await f.flush();
  assert.match(f.text(), /Sign in again/); assert.doesNotMatch(f.text(), /ATLAS-ABCDEF123456/);
  // Initial session may already resolve; after the account-change reload only
  // session checks run, never the private archive endpoint.
  assert.equal(f.calls.filter(call => call.path !== 'session').length, 0); f.dispose();
});
test('access-ended aborts a pending request and late data cannot repopulate history', async () => {
  const f = harness(); const wait = deferred(); f.hold = wait; await f.flush();
  const call = f.calls.find(call => call.path !== 'session'); assert.ok(call);
  f.event('atlas:verified-image-access-ended'); assert.equal(call.options.signal.aborted, true);
  wait.resolve(fixture()); await f.flush();
  assert.match(f.text(), /Sign in again/); assert.doesNotMatch(f.text(), /ATLAS-ABCDEF123456/); f.dispose();
});
test('403 clears previously loaded private history and unknown custody is never an owner assertion', async () => {
  const f = harness(); await f.flush(); assert.match(f.text(), /ATLAS-ABCDEF123456/);
  f.failure = { status: 403 }; f.event('pageshow'); await f.flush();
  assert.doesNotMatch(f.text(), /ATLAS-ABCDEF123456/); assert.match(f.text(), /Sign in again/); f.dispose();
});


function findNode(value, predicate) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return value.map(item => findNode(item, predicate)).find(Boolean) ?? null;
  if (predicate(value)) return value;
  return findNode(value.props?.children, predicate);
}

test('card detail keeps a concise report link and moves operational context out of the hero', async () => {
  const f = harness(); await f.flush();
  const report = f.find(node => node.type === 'a' && node.props.href === `/reports/${token}?v=2`);
  assert.ok(report); assert.equal(report.props['aria-label'], 'Grade Report');
  const hero = f.find(node => node.type === 'section' && node.props['aria-label'] === 'Card details');
  assert.doesNotMatch(JSON.stringify(hero), /Human approved|APPROVED CARD|Report version|Grading workspace|Open approved report/);
  const summary = f.component('GradeSummary', { card: fixture().card, report: `/reports/${token}?v=2` });
  assert.ok(findNode(summary, node => node.type === 'a' && node.props.href === `/manual/${cardId}`));
  assert.match(JSON.stringify(summary), /Approved \(UTC\)|Report version|Version/);
  const media = f.find(node => node.type === 'ApprovedCardMedia');
  assert.equal(media.props.mode, 'detail'); assert.equal(media.props.card.approvalActionId, action);
  assert.equal(f.find(node => node.props?.role === 'tab' && node.props.id === 'card-tab-overview').props['aria-selected'], true);
  f.dispose();
});

test('every detail report entry preserves its saved version and suppresses private-page referrers', async () => {
  const f = harness(); await f.flush();
  const reportPath = `/reports/${token}?v=2`, event = { button: 0 };
  const links = [
    f.find(node => node.type === 'a' && node.props['aria-label'] === 'Grade Report'),
    findNode(f.component('GradeSummary', { card: fixture().card, report: reportPath }), node => node.type === 'a' && node.props.href === reportPath),
    findNode(f.component('HistoryTimeline', { data: fixture() }), node => node.type === 'a' && node.props.href === reportPath),
  ];
  for (const link of links) {
    assert.ok(link); assert.equal(link.props.href, reportPath);
    assert.equal(link.props.referrerPolicy, 'no-referrer'); assert.equal(link.props.rel, 'noreferrer');
    link.props.onClick(event);
  }
  assert.equal(f.reportEntries.length, 3);
  for (const args of f.reportEntries) assert.deepEqual(args, [event, reportPath, cardId]);
  const historical = fixture(); historical.history.events[0].report = { ...historical.history.events[0].report, version: 1, path: `/reports/${token}?v=1` };
  const oldLink = findNode(f.component('HistoryTimeline', { data: historical }), node => node.type === 'a');
  oldLink.props.onClick(event);
  assert.deepEqual(f.reportEntries[3], [event, `/reports/${token}?v=1`, cardId]);
  f.dispose();
});

test('tabs support keyboard navigation and opening saved panels never dispatches work', async () => {
  const f = harness(); await f.flush(); const count = f.calls.length;
  let prevented = false, focused = null;
  const tab = f.find(node => node.props?.id === 'card-tab-overview');
  tab.props.onKeyDown({ key: 'End', preventDefault() { prevented = true; }, currentTarget: { parentElement: {
    querySelectorAll: () => [0, 1, 2, 3].map(index => ({ focus() { focused = index; } })),
  } } });
  f.render(); assert.equal(prevented, true); assert.equal(focused, 3);
  assert.equal(f.find(node => node.props?.id === 'card-tab-history').props.tabIndex, 0);
  assert.equal(f.find(node => node.props?.id === 'card-panel-history').props.hidden, false);
  assert.equal(f.find(node => node.props?.id === 'card-panel-overview').props.hidden, true);
  f.find(node => node.props?.id === 'card-tab-comps').props.onClick(); f.render(); await f.flush();
  assert.equal(f.find(node => node.props?.id === 'card-panel-comps').props.hidden, false);
  assert.equal(f.calls.length, count); f.dispose();
});

test('a changed staff role hides loaded details before the replacement read resolves', async () => {
  const f = harness(); await f.flush(); assert.match(f.text(), /ATLAS-ABCDEF123456/);
  f.staff = { ...f.staff, role: 'OBSERVER' }; f.render();
  assert.doesNotMatch(f.text(), /ATLAS-ABCDEF123456/);
  await f.flush(); assert.match(f.text(), /Sign in again/); f.dispose();
});

test('pagehide clears loaded detail and bfcache return rechecks the ordinary staff session', async () => {
  const f = harness(); await f.flush(); f.event('pagehide');
  assert.doesNotMatch(f.text(), /ATLAS-ABCDEF123456/);
  const count = f.calls.length; f.event('pageshow'); await f.flush();
  assert.equal(f.calls[count].path, 'session'); assert.match(f.text(), /ATLAS-ABCDEF123456/); f.dispose();
});

test('overview exposes linked submission only through the existing order permission', async () => {
  const f = harness(); await f.flush();
  const card = { ...fixture().card, submission: { orderId: randomUUID(), reference: 'ATLAS-ORDER-123', customer: { name: 'Recorded submitter' }, channel: 'MAIL_IN' } };
  const without = f.component('CardOverview', { card, custody: { status: 'UNKNOWN' }, orderLinks: false });
  assert.doesNotMatch(JSON.stringify(without), new RegExp(card.submission.orderId)); assert.match(JSON.stringify(without), /do not establish ownership/);
  const withLink = f.component('CardOverview', { card, custody: { status: 'RECORDED' }, orderLinks: true });
  assert.match(JSON.stringify(withLink), new RegExp(card.submission.orderId));
  assert.match(JSON.stringify(withLink), /current physical holder have not been established/); f.dispose();
});

test('category tiles round only their display while exact saved scores and historical award stay available', async () => {
  const f = harness(); await f.flush();
  const card = { ...fixture().card, approvedSummary: { state: 'AVAILABLE', ruleVersion: 'ATLAS_2026_10_13_CATEGORY_DAMAGE_V1', finalGradePolicy: 'atlas-final-half-point-v1', subgrades: { centering: 8.125, corners: 9, edges: 7.5, surface: 8.75 } } };
  const tree = f.component('GradeSummary', { card, report: `/reports/${token}?v=2` });
  const text = JSON.stringify(tree);
  assert.match(text, /8\.13/); assert.match(text, /8\.125/); assert.match(text, /8\.75/); assert.match(text, /8\.5/); assert.match(text, /atlas-final-half-point-v1/);
  assert.match(text, /Category tiles display up to two decimal places/); assert.match(text, /does not recalculate the approved grade/); f.dispose();
});

test('saved sales preserve unknown prices, grading distinctions and unconfirmed identities', async () => {
  const f = harness(); await f.flush();
  const card = { ...fixture().card, savedComparables: { state: 'SAVED', selection: 'SAVED_REPORT_SELECTION', observedAt: '2026-10-20T00:00:00.000Z', sales: [
    { id: 'one', title: 'Recorded PSA sale', grader: 'PSA', grade: '9', soldAt: '2026-10-19T00:00:00.000Z', priceMinor: 12500, currency: 'USD', priceBasis: 'sold', identityStatus: 'MATCH', listingUrl: 'https://www.ebay.com/itm/123456789012' },
    { id: 'two', title: 'Recorded raw sale', grader: null, grade: null, raw: true, soldAt: null, priceMinor: null, currency: 'USD', priceBasis: 'accepted_offer_unknown', identityStatus: 'UNKNOWN', listingUrl: null },
  ] } };
  const text = JSON.stringify(f.component('SavedComparables', { card }));
  assert.match(text, /PSA 9/); assert.match(text, /Ungraded/); assert.match(text, /\$125\.00/);
  assert.match(text, /Accepted offer · Amount undisclosed/); assert.match(text, /Identity match is unconfirmed/);
  assert.doesNotMatch(text, /market value|estimated value|\$0\.00/i);
  const missing = JSON.stringify(f.component('SavedComparables', { card: fixture().card }));
  assert.match(missing, /does not mean no comparable sales exist/); f.dispose();
});


test('sports facts preserve exact printed serial and distinguish presence from authentication', async () => {
  const f = harness(); await f.flush();
  const card = { ...fixture().card, identity: { ...fixture().card.identity, sportsAttributes: {
    serial: { presence: 'PRESENT', printed: '007/099' }, autograph: { presence: 'PRESENT', type: 'STICKER' },
    relic: { presence: 'PRESENT', windows: [{ position: 'Lower left', material: 'Fabric', use: 'UNKNOWN', manufacturerStatement: null }] },
  } } };
  const text = JSON.stringify(f.component('CardOverview', { card, custody: { status: 'UNKNOWN' }, orderLinks: false }));
  assert.match(text, /007\/099/); assert.match(text, /Sticker · Presence is not authentication/);
  assert.match(text, /Fabric · Unknown/); assert.doesNotMatch(text, /game.used/i); f.dispose();
});


test('a card-specific 404 during history pagination clears the retained detail and media', async () => {
  const f = harness(); f.result.history.nextCursor = 'saved-cursor'; await f.flush();
  f.find(node => node.props?.id === 'card-tab-history').props.onClick(); f.render();
  const loadMore = f.find(node => node.type === 'button' && JSON.stringify(node.props.children).includes('Load earlier events'));
  assert.ok(loadMore); assert.match(f.text(), /ATLAS-ABCDEF123456/);
  f.failure = { status: 404, code: 'CARD_PROVENANCE_NOT_FOUND' }; loadMore.props.onClick(); await f.flush();
  assert.match(f.text(), /This approved card is unavailable to this account/);
  assert.doesNotMatch(f.text(), /ATLAS-ABCDEF123456|Saved card|ApprovedCardMedia/);
  assert.doesNotMatch(f.text(), /Sign in again/); f.dispose();
});

test('private curation mounts only on Sold comps with an explicit separate transport and enablement', async () => {
  const compRequest = () => assert.fail('The parent does not dispatch curation requests');
  const f = harness(); await f.flush();
  const openComps = () => { f.find(node => node.props?.id === 'card-tab-comps').props.onClick(); f.render(); };
  openComps(); assert.equal(f.find(node => node.type === 'StaffCompCuration'), null);
  f.props = { compCurationEnabled: true }; f.render(); assert.equal(f.find(node => node.type === 'StaffCompCuration'), null);
  f.props = { compCurationRequest: compRequest }; f.render(); assert.equal(f.find(node => node.type === 'StaffCompCuration'), null);
  f.props = { compCurationEnabled: true, compCurationRequest: compRequest }; f.render();
  const panel = f.find(node => node.type === 'StaffCompCuration'); assert.ok(panel);
  assert.equal(panel.props.request, compRequest); assert.equal(panel.props.staff, f.staff);
  assert.equal(panel.props.card.approvalActionId, action); assert.equal(panel.props.enabled, true);
  assert.ok(f.find(node => node.type?.name === 'SavedComparables'), 'Saved report sales remain a separate component');
  f.find(node => node.props?.id === 'card-tab-overview').props.onClick(); f.render();
  assert.equal(f.find(node => node.type === 'StaffCompCuration'), null);
  assert.deepEqual(f.calls.map(call => call.path), ['session', history.cardHistoryPath(cardId)]); f.dispose();
});

test('curation access loss clears the whole private detail and a stale callback cannot clear a refreshed record', async () => {
  const f = harness({ compCurationEnabled: true, compCurationRequest: () => assert.fail('Parent transport') }); await f.flush();
  const openComps = () => { f.find(node => node.props?.id === 'card-tab-comps').props.onClick(); f.render(); };
  openComps(); const old = f.find(node => node.type === 'StaffCompCuration').props.onAccessLost;
  f.event('pageshow'); await f.flush(); old(); f.render(); assert.match(f.text(), /ATLAS-ABCDEF123456/);
  openComps(); f.find(node => node.type === 'StaffCompCuration').props.onAccessLost(); f.render();
  assert.match(f.text(), /Sign in again/); assert.doesNotMatch(f.text(), /ATLAS-ABCDEF123456|ApprovedCardMedia|StaffCompCuration/);
  f.dispose();
});

test('replaced staff, transport, disabled curation and departed tab refuse stale child access callbacks', async () => {
  for (const change of ['staff', 'transport', 'disabled', 'tab']) {
    const f = harness({ compCurationEnabled: true, compCurationRequest: () => assert.fail('Parent transport') }); await f.flush();
    f.find(node => node.props?.id === 'card-tab-comps').props.onClick(); f.render();
    const old = f.find(node => node.type === 'StaffCompCuration').props.onAccessLost;
    if (change === 'staff') f.staff = { ...f.staff };
    if (change === 'transport') f.props.compCurationRequest = () => assert.fail('Replacement transport');
    if (change === 'disabled') f.props.compCurationEnabled = false;
    if (change === 'tab') f.find(node => node.props?.id === 'card-tab-overview').props.onClick();
    f.render(); old(); f.render();
    assert.match(f.text(), /ATLAS-ABCDEF123456/, change); assert.doesNotMatch(f.text(), /Sign in again/, change); f.dispose();
  }
});
