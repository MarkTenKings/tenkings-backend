import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as history from '../lib/card-history-client.mjs';
import * as archive from '../lib/graded-cards-client.mjs';
import * as routes from '../lib/routes.mjs';

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
  const next = fixture(); next.history.events.unshift(first.history.events[0]);
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
function harness() {
  let cursor = 0, dirty = false;
  const slots = [], effects = [], listeners = new Map(), exports = {}, calls = [];
  const staff = { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE' };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], next => { const value = typeof next === 'function' ? next(slots[id]) : next; if (!Object.is(value, slots[id])) { slots[id] = value; dirty = true; } }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useEffect(fn, deps) { const id = cursor++, old = slots[id]; if (!old || deps.some((v, i) => v !== old.deps[i])) { slots[id] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[id].cleanup = fn(); }); } },
  };
  const f = { staff, calls, result: fixture(), hold: null, session: { staff }, failure: null };
  const request = async (path, options) => { calls.push({ path, options }); assert.equal(options.body, undefined); if (path === 'session') return f.session; if (f.hold) return f.hold.promise; if (f.failure) throw f.failure; return structuredClone(f.result); };
  vm.runInNewContext(source, { exports, AbortController, URL, Intl, window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) }, require(name) {
    if (name === 'react') return react;
    if (name === 'next/link') return 'a';
    if (name === './Shell') return { __esModule: true, default: 'Shell' };
    if (name.endsWith('/routes.mjs')) return routes;
    if (name.endsWith('/card-history-client.mjs')) return history;
    if (name.endsWith('/graded-cards-client.mjs')) return archive;
    if (name.endsWith('/client')) return { api: request };
    if (name.endsWith('.module.css')) return {};
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  f.render = () => { let count = 0; do { dirty = false; cursor = 0; f.tree = exports.default({ staff: f.staff, cardId, request }); effects.splice(0).forEach(work => work()); assert.ok(++count < 30); } while (dirty); };
  f.flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(setImmediate); f.render(); } };
  f.event = name => { listeners.get(name)?.({ persisted: true }); f.render(); };
  f.text = () => JSON.stringify(f.tree);
  f.dispose = () => slots.forEach(slot => slot?.cleanup?.());
  f.render(); return f;
}
test('actual history component reads only after matching fresh session and retains saved grade', async () => {
  const f = harness(); await f.flush();
  assert.deepEqual(f.calls.map(call => call.path), ['session', history.cardHistoryPath(cardId)]);
  assert.match(f.text(), /ATLAS-ABCDEF123456/); assert.match(f.text(), /8\.5/); assert.match(f.text(), /Not recorded/); f.dispose();
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
