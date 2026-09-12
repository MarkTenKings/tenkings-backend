import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as workspaceClient from '../lib/workspace-client.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { LOCAL_HOST, LOCAL_ORIGIN, deny } from '../lib/server/policy.mjs';
import { DurableReviewStore } from '../lib/server/access/review.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const compiled = babel.transformSync(readFileSync(new URL('../pages/grading.jsx', import.meta.url), 'utf8'), {
    filename: 'grading.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false
}).code;
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree ?? '';
function all(tree, predicate, result = []) {
    if (Array.isArray(tree)) tree.forEach(node => all(node, predicate, result));
    else if (tree && typeof tree === 'object') { if (predicate(tree)) result.push(tree); all(tree.props?.children, predicate, result); }
    return result;
}
const waitingCard = { id: 'waiting-card', title: 'Saved photo pair', state: 'WAITING', stage: 'PHOTOS', revision: 6,
    sides: [{ side: 'FRONT', status: 'VERIFIED' }, { side: 'BACK', status: 'VERIFIED' }], capabilities: {} };
const loaded = cards => ({ loading: false, data: { cards }, session: { csrf: 'fixture-csrf' }, error: '', signedOut: false });
function harness({ queue = 'WAITING', assigned = loaded([]), workspace = loaded([waitingCard]) } = {}) {
    const slots = [], effects = [], exports = {}; let cursor = 0, tree;
    const f = { assigned, workspace, queue, reloads: 0, claimingEnabled: false, mutations: [], destinations: [], liveEvents: [] };
    const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
        useEffect(effect, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => slots[index][i] !== value)) { slots[index] = deps; effects.push(effect); } } };
    vm.runInNewContext(compiled, { exports, require(name) {
        if (name === 'react') return react;
        if (name === 'next/link') return 'link';
        if (name === 'next/router') return { useRouter: () => ({ query: { queue: f.queue }, push(path) { assert.equal(f.claimingEnabled, true, 'Queue reads never navigate'); f.destinations.push(path); return Promise.resolve(true); } }) };
        if (name === '../components/Shell') return { default: 'shell', Notice: 'notice', Unavailable: 'unavailable', __esModule: true };
        if (name === '../components/WorkspaceShared') return { PhotoPreview: 'photo', Readiness: 'readiness', RecoveryNotice: 'recovery', StateBadge: 'badge' };
        if (name === '../components/WorkspaceIcon') return 'icon';
        if (name === '../components/ManualCards') return 'manual-cards';
        if (name === '../lib/useGradingQueue') return { useGradingQueue: () => ({ resource: f.workspace, assigned: { ...f.assigned, reload: () => { f.reloads++; } }, suspend() { f.liveEvents.push('suspend'); }, resume() { f.liveEvents.push('resume'); } }) };
        if (name === '../lib/useWorkspaceMutation') return { useWorkspaceMutation: () => ({ ready: true, busy: false, pending: null, async mutate(path, body) { assert.equal(f.claimingEnabled, true, 'Queue reads never mutate'); f.mutations.push({ path, body }); return { ...waitingCard, state: 'IN_PROGRESS' }; } }) };
        if (name === '../lib/workspace-client.mjs') return workspaceClient;
        if (name === '../lib/server/runtime.mjs' || name.endsWith('.module.css')) return {};
        return require(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
    f.render = () => { cursor = 0; const page = exports.default({ staff: { id: 'reviewer', role: 'REVIEWER' } }); tree = page.type(page.props); for (const effect of effects.splice(0)) effect(); return tree; };
    f.nodes = predicate => all(tree, predicate);
    f.text = () => text(tree);
    f.count = state => text(f.nodes(node => node.type === 'link' && node.props.href === `/grading?queue=${state}`)[0].props.children.at(-1));
    f.render(); f.render(); return f;
}

test('assigned-report failure preserves saved waiting cards, its real error and an explicit reload', () => {
    const f = harness({ assigned: { ...loaded([]), error: 'The report could not be verified. Reload before continuing.' } });
    assert.match(f.text(), /Saved photo pair/);
    assert.equal(f.count('WAITING'), '1');
    assert.equal(f.count('DRAFT'), '0');
    for (const state of ['IN_PROGRESS', 'NEEDS_ATTENTION', 'HUMAN_REVIEW', 'APPROVED']) assert.equal(f.count(state), '—');
    assert.match(f.text(), /The report could not be verified/);
    const retry = f.nodes(node => node.type === 'button' && text(node) === 'Reload assigned reports');
    assert.equal(retry.length, 1); retry[0].props.onClick(); assert.equal(f.reloads, 1);
    assert.equal(f.nodes(node => node.type === 'link' && text(node) === 'Sign in again').length, 0);
    f.assigned = loaded([{ id: 'existing-report', title: 'Existing report', disposition: 'READY_FOR_HUMAN' }]); f.render();
    assert.equal(f.count('HUMAN_REVIEW'), '1'); assert.equal(f.count('WAITING'), '1');
    assert.doesNotMatch(f.text(), /could not be loaded/);
});

test('assigned-report auth expiry offers sign-in instead of a reload loop', () => {
    for (const error of ['', 'Your session ended. Sign in again to continue.']) {
        const f = harness({ assigned: { ...loaded([]), signedOut: true, error } });
        const signIn = f.nodes(node => node.type === 'link' && text(node) === 'Sign in again');
        assert.equal(signIn.length, 1); assert.equal(signIn[0].props.href, '/?reauthenticate=1');
        assert.match(f.text(), /Your session ended/);
        assert.equal(f.nodes(node => node.type === 'button' && text(node) === 'Reload assigned reports').length, 0);
        assert.equal(f.count('HUMAN_REVIEW'), '—');
    }
});

test('pending assigned reports do not prevent an accurate waiting count or claim a report queue is empty', () => {
    const f = harness({ queue: 'HUMAN_REVIEW', assigned: { ...loaded([]), loading: true, data: null } });
    assert.equal(f.count('WAITING'), '1'); assert.equal(f.count('HUMAN_REVIEW'), '—');
    assert.match(f.text(), /Loading assigned reports/);
    assert.doesNotMatch(f.text(), /No cards in human review/);
    f.assigned = { ...loaded([]), error: 'Reports are temporarily unavailable.' }; f.render();
    assert.match(f.text(), /Assigned reports have not loaded/);
    assert.doesNotMatch(f.text(), /No cards in human review/);
    f.assigned = loaded([]); f.render();
    assert.equal(f.count('HUMAN_REVIEW'), '0'); assert.match(f.text(), /No cards in human review/);
});

test('a waiting card explains the disabled Start admission inline without recovery or sign-in prompts', () => {
    const f = harness({ workspace: loaded([{ ...waitingCard, capabilities: { astraClaim: false, humanClaim: true,
        astraClaimUnavailableReason: 'WORKSPACE_ASTRA_NOT_ADMITTED' } }]) });
    const start = f.nodes(node => node.type === 'button' && text(node).includes('Start Astra'));
    assert.equal(start.length, 1); assert.equal(start[0].props.disabled, true);
    assert.match(f.text(), /waiting for test admission/); assert.doesNotMatch(f.text(), /Recover saved request|another tab/);
    assert.equal(f.mutations.length, 0);
});

test('the Waiting page renders its saved card while the assigned-report read is still pending', () => {
    const f = harness({ assigned: { ...loaded([]), loading: true, data: null } });
    assert.match(f.text(), /Saved photo pair/); assert.equal(f.count('WAITING'), '1');
    assert.equal(f.nodes(node => node.type === 'link' && node.props.href === '/workspace/waiting-card').length, 2);
    assert.doesNotMatch(f.text(), /Loading saved cards|Loading assigned reports|No cards in waiting/);
});

test('a workspace load error cannot produce complete-looking queue counts', () => {
    const f = harness({ workspace: { ...loaded([]), error: 'Workspace unavailable' } });
    for (const state of Object.keys(workspaceClient.stateNames)) assert.equal(f.count(state), '—');
});

test('Start Astra runs continuously, with one-step operation kept as a separate explicit choice', async () => {
    for (const [label, mode] of [['Start Astra', 'CONTINUOUS'], ['Start one step', 'STEP']]) {
        const f = harness({ workspace: loaded([{ ...waitingCard, capabilities: { astraClaim: true, humanClaim: true } }]) }); f.claimingEnabled = true;
        const start = f.nodes(node => node.type === 'button' && text(node) === label)[0]; assert.ok(start); assert.equal(start.props.disabled, false);
        await start.props.onClick();
        assert.equal(f.mutations.length, 1); assert.equal(f.mutations[0].body.operator, 'ASTRA'); assert.equal(f.mutations[0].body.mode, mode);
        assert.equal(f.mutations[0].body.expectedRevision, waitingCard.revision); assert.deepEqual(f.destinations, ['/workspace/waiting-card']);
        assert.deepEqual(f.liveEvents, ['suspend', 'resume']);
    }
});

test('a background read interruption preserves the visible saved queue and identifies it as a saved state', () => {
    const f = harness({ workspace: { ...loaded([waitingCard]), refreshError: 'The service is temporarily unavailable.' } });
    assert.match(f.text(), /Saved photo pair/); assert.match(f.text(), /Showing saved state/); assert.match(f.text(), /last saved cards remain visible/);
    assert.equal(f.count('WAITING'), '1'); assert.doesNotMatch(f.text(), /Loading saved cards/);
});

test('assigned-report reads remain available with no processing runtime and never convert a genuine failure to an empty success', async () => {
    const staff = Object.freeze({ id: 'reviewer' }); let failure = null, calls = 0;
    const context = { identity: staff, now: new Date(), tx: { staffAssignment: { async findMany({ where }) {
        calls++; assert.equal(where.identityId, staff.id); assert.equal(where.revokedAt, null); assert.equal(where.expiresAt.gt, context.now);
        if (failure) throw failure;
        return [];
    } } } };
    const auth = { async authenticate(cookie) { if (cookie !== 'fixture-session') deny(401, 'SIGN_IN_REQUIRED'); return staff; },
        async withStaff(actor, work) { assert.equal(actor, staff); return work(context); } };
    const review = new DurableReviewStore({ auth });
    const handler = createHandler({ auth, review }, { NODE_ENV: 'development', ATLAS_LOCAL_SYNTHETIC: '1' });
    async function get(cookie = 'fixture-session') {
        const out = {}, res = { setHeader() {}, status(status) { out.status = status; return this; }, json(body) { out.body = body; return this; } };
        await handler({ url: '/api/staff/cards', method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: LOCAL_HOST, origin: LOCAL_ORIGIN, cookie } }, res);
        return out;
    }
    assert.deepEqual(await get(), { status: 200, body: { cards: [] } });
    failure = new Error('Private database failure that must not reach the browser');
    assert.deepEqual(await get(), { status: 503, body: { error: 'TEMPORARILY_UNAVAILABLE' } });
    failure = null;
    assert.deepEqual(await get(), { status: 200, body: { cards: [] } });
    assert.deepEqual(await get('expired-session'), { status: 401, body: { error: 'SIGN_IN_REQUIRED' } });
    assert.equal(calls, 3);
});
