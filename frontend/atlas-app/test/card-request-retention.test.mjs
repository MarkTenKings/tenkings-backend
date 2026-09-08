import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as retention from '../lib/card-request-retention.mjs';
const require = createRequire(import.meta.url);
const babel = require('next/dist/compiled/babel/core');
const nextRequire = createRequire(require.resolve('next/package.json'));
const source = readFileSync(new URL('../pages/cards/[cardId].jsx', import.meta.url), 'utf8');
const compiled = babel.transformSync(source + '\nexport { Workspace };', { filename: 'card.jsx',
    presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code;
const draft = () => ({ revision: 1, observations: { FRONT: 'front', BACK: 'back' }, reviewedSides: ['FRONT'],
    identityReviewed: false, disposition: 'IN_REVIEW', savedAt: null });
const makeCard = () => ({ id: 'card', title: 'Card', canEdit: true, sides: [], history: [], draft: draft(), evidenceRevision: 1,
    evidenceHash: 'evidence', reviewHash: 'review', grading: { analysisRevision: 1, analysisHash: 'analysis', approvalBlock: null, proposals: [] } });
function harness() {
    const slots = []; let cursor = 0, tree, guard, serial = 0;
    const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
        useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
        useRef(value) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; }, useEffect() {} };
    const calls = [], f = { card: makeCard(), csrf: 'old-csrf', respond: async () => { throw new Error('Unexpected call'); } };
    const api = async (path, options = {}) => { calls.push({ path, ...options, body: options.body && structuredClone(options.body) }); return f.respond(path, options); };
    const exports = {}, context = { exports, structuredClone, console, crypto: { randomUUID: () => `operation-${++serial}` }, window: { confirm: () => true },
        require(name) {
            if (name === 'react') return react;
            if (name === '../../lib/client') return { api, approvalMessage: code => code };
            if (name === '../../lib/usePendingNavigation') return { usePendingNavigation: callback => { guard = callback; } };
            if (name === '../../lib/card-request-retention.mjs') return retention;
            if (name.includes('/components/') || name === 'next/link') return { __esModule: true, default: name.split('/').at(-1), Notice: 'Notice', Unavailable: 'Unavailable' };
            if (name.includes('/server/')) return {};
            return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
        } };
    vm.runInNewContext(compiled, context);
    f.render = () => { cursor = 0; tree = exports.Workspace({ initial: f.card, csrf: f.csrf, mode: 'PRODUCTION' }); return tree; };
    const all = (node, predicate, out = []) => { if (Array.isArray(node)) node.forEach(n => all(n, predicate, out));
        else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); all(node.props?.children, predicate, out); } return out; };
    const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
    f.find = (type, label) => { const found = all(tree, n => n.type === type && (label === undefined || text(n).includes(label)))[0]; assert.ok(found, `${type}: ${label}`); return found; };
    f.edit = value => { const input = all(tree, n => n.type === 'textarea' && n.props.id === 'notes-FRONT')[0]; input.props.onChange({ target: { value } }); f.render(); };
    f.notes = () => all(tree, n => n.type === 'textarea' && n.props.id === 'notes-FRONT')[0].props.value;
    f.click = async label => { await f.find('button', label).props.onClick(); f.render(); };
    f.submit = async () => { await f.find('form').props.onSubmit({ preventDefault() {} }); f.render(); };
    f.calls = calls; f.pending = () => guard(); f.render(); return f;
}
test('retained request body is detached, deeply immutable, and uncertainty survives later 4xx', () => {
    const body = { operationId: 'same', ...draft() }, request = retention.retainCardRequest(body);
    body.observations.FRONT = 'changed'; assert.equal(request.body.observations.FRONT, 'front');
    assert.throws(() => request.body.reviewedSides.push('BACK'), TypeError);
    assert.equal(retention.afterCardRequestError(request, new Error('lost')), request);
    for (const status of [400, 401, 403, 409, 422, 429]) assert.equal(retention.afterCardRequestError(request, { status }), request);
    assert.equal(retention.afterCardRequestError(retention.retainCardRequest(body), { status: 409 }), null);
    for (const e of [{ status: 408 }, { status: 409, code: 'OUTCOME_UNCONFIRMED' }]) assert.ok(retention.afterCardRequestError(retention.retainCardRequest(body), e));
});
test('saved draft merge preserves later local edits and takes saved metadata and untouched fields', () => {
    const baseline = draft(), local = structuredClone(baseline), saved = structuredClone(baseline);
    local.observations.FRONT = 'new local'; saved.observations.BACK = 'server back'; saved.identityReviewed = true; saved.revision = 2;
    const merged = retention.mergeCardDraft(local, baseline, saved);
    assert.equal(merged.observations.FRONT, 'new local'); assert.equal(merged.observations.BACK, 'server back');
    assert.equal(merged.identityReviewed, true); assert.equal(merged.revision, 2); assert.equal(local.revision, 1);
});
test('page retains lost draft through edit/reload/later 403 and retries original snapshot with fresh csrf', async () => {
    const f = harness(); f.edit('submitted'); f.respond = async () => { throw new Error('lost reply'); }; await f.submit();
    const original = f.calls[0].body; f.edit('newer local edit'); assert.equal(f.pending(), true);
    f.respond = async path => path === 'session' ? { staff: {}, csrf: 'fresh-csrf' } : { card: makeCard() };
    await f.click('Reload saved state'); assert.equal(f.notes(), 'newer local edit');
    f.respond = async path => { if (path === 'session') return { staff: {}, csrf: 'fresh-csrf' }; throw { status: 403, code: 'CSRF_REQUIRED', message: 'Changed session' }; };
    await f.click('retry exact review draft'); assert.equal(f.pending(), true); assert.equal(f.notes(), 'newer local edit');
    const saved = makeCard(); saved.draft = { ...structuredClone(original), revision: 2 };
    f.respond = async path => path === 'session' ? { staff: {}, csrf: 'latest-csrf' } : { card: saved };
    await f.click('retry exact review draft');
    const writes = f.calls.filter(c => c.body); assert.equal(writes.length, 3);
    for (const write of writes) assert.deepEqual(write.body, original);
    assert.equal(writes.at(-1).csrf, 'latest-csrf'); assert.equal(f.notes(), 'newer local edit');
    assert.equal(f.find('IdentityCorrection').props.csrf, 'latest-csrf');
    assert.equal(f.pending(), true, 'newer unsaved edit still guards navigation');
    await f.click('Discard unsaved changes'); assert.equal(f.pending(), false);
});
test('initial definitive draft rejection allows editing and a new request; refresh-only never mutates', async () => {
    const f = harness(); f.edit('first'); f.respond = async () => { throw { status: 422, message: 'Validation failed' }; }; await f.submit();
    f.edit('second'); f.respond = async path => { assert.equal(path, 'session'); return { staff: {}, csrf: 'new-csrf' }; };
    await f.click('Refresh access'); assert.equal(f.notes(), 'second'); assert.equal(f.calls.filter(c => c.body).length, 1);
    f.respond = async () => { throw { status: 422, message: 'Validation failed' }; }; await f.submit();
    assert.notEqual(f.calls[0].body.operationId, f.calls.at(-1).body.operationId); assert.equal(f.calls.at(-1).csrf, 'new-csrf');
});
test('approval lost reply remains retryable after edits and stale-session rejection without replacing notes', async () => {
    const f = harness(); f.respond = async () => { throw new Error('lost approval'); }; await f.click('Approve exact report');
    const original = f.calls[0].body; f.edit('notes after approval attempt');
    f.respond = async path => { if (path === 'session') return { staff: {}, csrf: 'fresh' }; throw { status: 401, code: 'SIGN_IN_REQUIRED', message: 'Expired' }; };
    await f.click('retry exact report approval'); assert.equal(f.pending(), true); assert.equal(f.find('IdentityCorrection').props.disabled, true);
    f.respond = async path => path === 'session' ? { staff: {}, csrf: 'freshest' } : { card: makeCard(), approval: { version: 1 } };
    await f.click('retry exact report approval'); assert.equal(f.notes(), 'notes after approval attempt');
    for (const call of f.calls.filter(c => c.body)) assert.deepEqual(call.body, original);
});
test('proposal decision is retained independently of later edited reason and reload', async () => {
    const f = harness(); f.respond = async () => { throw new Error('lost proposal'); };
    await f.find('MachineProposals').props.onDecide({ stepId: 'step' }, 'REJECTED', 'Original reason'); f.render();
    const original = f.calls[0].body;
    await f.find('MachineProposals').props.onDecide({ stepId: 'different' }, 'ACCEPTED', 'New reason'); assert.equal(f.calls.length, 1);
    f.respond = async path => path === 'session' ? { staff: {}, csrf: 'fresh' } : { card: makeCard() };
    await f.click('Reload saved state'); assert.equal(f.pending(), true);
    await f.click('retry exact proposal decision'); assert.deepEqual(f.calls.at(-1).body, original); assert.equal(f.pending(), false);
});
test('identity pending state blocks parent edits/dispatch and safely applies reset checklist', async () => {
    const f = harness(); f.find('IdentityCorrection').props.onPendingChange(true); f.render();
    assert.equal(f.pending(), true); assert.equal(f.find('button', 'Approve exact report').props.disabled, true);
    const corrected = makeCard(); corrected.draft = { ...draft(), revision: 2, reviewedSides: [], identityReviewed: false };
    f.find('IdentityCorrection').props.onCorrected(corrected); f.find('IdentityCorrection').props.onPendingChange(false); f.render();
    assert.equal(f.pending(), false); assert.equal(f.find('IdentityCorrection').props.card.draft.revision, 2);
});
test('new analysis reload preserves local notes but cannot carry local reviewed identity onto changed evidence', async () => {
    const f = harness(); f.edit('unsaved evidence concern');
    // Exercise the actual checkbox event, not a fabricated saved draft.
    const visit = node => Array.isArray(node) ? node.flatMap(visit) : node && typeof node === 'object' ? [node, ...visit(node.props?.children)] : [];
    const checkbox = visit(f.render()).find(n => n.type === 'input' && n.props.type === 'checkbox');
    checkbox.props.onChange({ target: { checked: true } }); f.render();
    const next = makeCard(); next.evidenceRevision = 2; next.evidenceHash = 'new-evidence'; next.grading.analysisRevision = 2;
    next.draft = { ...draft(), revision: 2, reviewedSides: [], identityReviewed: false };
    f.respond = async path => path === 'session' ? { staff: {}, csrf: 'fresh' } : { card: next };
    await f.click('Reload saved state'); assert.equal(f.notes(), 'unsaved evidence concern');
    assert.equal(visit(f.render()).find(n => n.type === 'input' && n.props.type === 'checkbox').props.checked, false);
});
test('same-tick repeated submit sends once and a failed access refresh cannot discard unknown work', async () => {
    const f = harness(); f.edit('pending'); let reject;
    f.respond = () => new Promise((_, no) => { reject = no; });
    const first = f.submit(); await f.submit(); assert.equal(f.calls.length, 1);
    reject(new Error('lost')); await first;
    f.respond = async () => ({ staff: null, csrf: null }); await f.click('retry exact review draft');
    assert.equal(f.calls.filter(c => c.body).length, 1); assert.equal(f.pending(), true); assert.equal(f.notes(), 'pending');
    assert.ok(f.find('IdentityCorrection'), 'panel remains mounted after sign-out');
});
test('grading unresolved-result behavior and exact retained action survive reload and live access refresh', async () => {
    const f = harness(), action = { type: 'IGNORE_FINDING', findingId: 'finding' };
    f.respond = async () => { throw new Error('lost grading'); };
    await f.find('GradingActions').props.onAction(action); f.render(); const original = f.calls[0].body;
    f.respond = async path => path === 'session' ? { staff: {}, csrf: 'fresh' } : { card: makeCard() };
    await f.click('Reload saved state'); assert.equal(f.pending(), true);
    f.respond = async () => ({ card: makeCard(), operation: { state: 'UNKNOWN', failureCode: 'GRADING_WORK_UNRESOLVED' } });
    await f.click('Check previous grading request'); assert.deepEqual(f.calls.at(-1).body, original);
    assert.equal(f.calls.at(-1).csrf, 'fresh'); assert.equal(f.pending(), false, 'recorded unknown outcome uses existing operation controls');
});
