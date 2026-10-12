import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as client from '../lib/workspace-client.mjs';
import * as drafts from '../lib/workspace-drafts.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
function compile(path) { return babel.transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { filename: path, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code; }
const hookCode = compile('../lib/useWorkspaceMutation.js'), sharedCode = compile('../components/WorkspaceShared.jsx');
function reactHarness() {
    const slots = [], effects = [], cleanups = new Map(); let cursor = 0;
    return { react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
        useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
        useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
        useEffect(action, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => old[i] !== value)) { slots[index] = deps; effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, action()); }); } } },
        render(action) { cursor = 0; const result = action(); for (const effect of effects.splice(0)) effect(); return result; },
        unmount() { for (const cleanup of cleanups.values()) cleanup?.(); cleanups.clear(); }
    };
}
const storage = () => { const saved = new Map(); return { saved, getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }; };
const card = () => ({ id: randomUUID(), revision: 3, state: 'IN_PROGRESS', stage: 'IDENTITY', workspace: {}, sides: [{ side: 'FRONT', status: 'VERIFIED' }, { side: 'BACK', status: 'VERIFIED' }], capabilities: { canEdit: true, actions: ['SAVE_IDENTITY', 'SAVE_BOUNDARY', 'SAVE_CENTERING'] } });
function hookHarness(savedStorage = storage(), initialCard = card(), options = {}) {
    const react = reactHarness(), exported = {}, f = { storage: savedStorage, card: initialCard, staffId: 'reviewer', calls: [], applied: [], accessCalls: 0, window: new EventTarget(), respond: async () => { throw new Error('Lost reply'); }, ...options }; let guard;
    f.access ??= async () => ({ staff: { id: f.staffId }, csrf: 'b'.repeat(64) });
    const request = async (path, options) => { f.calls.push({ path, ...options, body: structuredClone(options.body) }); return f.respond(path, options); };
    vm.runInNewContext(hookCode, { exports: exported, window: f.window, AbortController, require(name) {
        if (name === 'react') return react.react;
        if (name === './usePendingNavigation') return { usePendingNavigation: action => { guard = action; } };
        if (name === './workspace-client.mjs') return { ...client, workspaceRequest: request, freshWorkspaceAccess: async () => { f.accessCalls++; return f.access(); } };
        if (name === './workspace-drafts.mjs') return { createWorkspaceJournal: (owner, id) => drafts.createWorkspaceJournal(owner, id, savedStorage) };
        return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
    f.render = () => { f.hook = react.render(() => exported.useWorkspaceMutation({ staffId: f.staffId, cardId: f.card.id, csrf: 'a'.repeat(64), onCard: value => f.applied.push(value) })); };
    f.pending = () => Boolean(f.hook.pending); f.navigationBlocked = () => guard(); f.posts = () => f.calls.filter(call => call.body !== undefined);
    f.flush = async () => { await new Promise(resolve => setImmediate(resolve)); f.render(); };
    f.unmount = () => react.unmount(); f.render(); f.render(); return f;
}
test('actual workspace hook reconciles a lost reply automatically with one exact command and blocks duplicate clicks', async () => {
    const f = hookHarness(); let reject; f.respond = () => new Promise((yes, no) => { reject = no; });
    const path = `workspace/cards/${f.card.id}/action`, first = f.hook.mutate(path, { action: 'SAVE_IDENTITY', payload: { identity: { category: 'SPORTS', playerName: 'Original' } }, expectedRevision: 3 }, f.card.id);
    await f.hook.mutate(path, { action: 'SAVE_IDENTITY', payload: { identity: { playerName: 'Changed' } }, expectedRevision: 3 }, f.card.id);
    assert.equal(f.calls.length, 1); assert.equal(f.navigationBlocked(), true);
    const original = structuredClone(f.calls[0].body);
    f.respond = async (_path, { body }) => ({ card: { ...f.card, revision: 4 }, operationId: body.operationId });
    reject(new Error('Lost')); await first; f.render();
    assert.equal(f.posts().length, 2); assert.deepEqual(f.posts()[1].body, original); assert.equal(f.posts()[1].csrf, 'b'.repeat(64));
    assert.equal(f.accessCalls, 1); assert.equal(f.pending(), false); assert.equal(f.applied.length, 1); assert.equal(f.storage.saved.size, 0);
    assert.equal(f.navigationBlocked(), false);
});
test('bounded failed reconciliation retains the exact journal and automatically resumes it after reload', async () => {
    const f = hookHarness(), path = `workspace/cards/${f.card.id}/claim`;
    await f.hook.mutate(path, { operator: 'ASTRA', mode: 'CONTINUOUS', expectedRevision: 3 }, f.card.id); f.render();
    assert.equal(f.posts().length, 2); assert.equal(f.pending(), true); assert.equal(f.navigationBlocked(), false);
    const original = structuredClone(f.posts()[0].body); f.unmount();
    const restored = hookHarness(f.storage, f.card, { respond: async (_path, { body }) => ({ card: { ...f.card, revision: 4 }, operationId: body.operationId }) });
    await restored.hook.mutate(path, { operator: 'ASTRA', mode: 'STEP', expectedRevision: 9 }, f.card.id); await restored.flush();
    assert.equal(restored.posts().length, 1); assert.deepEqual(restored.posts()[0].body, original); assert.equal(restored.posts()[0].csrf, 'b'.repeat(64));
    assert.equal(restored.pending(), false); assert.equal(restored.applied.length, 1); assert.equal(restored.storage.saved.size, 0);
});
test('malformed receipt and generic denial retain authority; proven no-dispatch conflict releases it', async () => {
    const f = hookHarness(), path = `workspace/cards/${f.card.id}/claim`;
    f.respond = async () => ({ card: { ...f.card, id: randomUUID() }, operationId: randomUUID() });
    await f.hook.mutate(path, { operator: 'HUMAN', expectedRevision: 3 }, f.card.id); f.render(); assert.equal(f.pending(), true); assert.equal(f.applied.length, 0);
    f.respond = async () => { throw { status: 409, code: 'WORKSPACE_REVISION_CHANGED' }; }; await f.hook.recover(); f.render(); assert.equal(f.pending(), true);
    f.respond = async () => { throw { status: 409, code: 'WORKSPACE_REVISION_CHANGED', outcome: 'NOT_DISPATCHED' }; }; await f.hook.recover(); f.render(); assert.equal(f.pending(), false);
});
test('definitive Start rejection clears pending, refreshes availability and allows an ordinary new Start', async () => {
    for (const code of ['WORKSPACE_ASTRA_NOT_ADMITTED', 'WORKSPACE_ASTRA_NOT_READY']) {
        const initial = { ...card(), state: 'WAITING', operator: null }, path = `workspace/cards/${initial.id}/claim`;
        const f = hookHarness(storage(), initial, { respond: async (_path, { body }) => {
            if (!body) return { card: { ...initial, capabilities: { astraClaim: false, astraClaimUnavailableReason: code } } };
            throw { status: 409, code, outcome: 'NOT_DISPATCHED' };
        } });
        await f.hook.mutate(path, { operator: 'ASTRA', mode: 'CONTINUOUS', expectedRevision: 3 }, initial.id); f.render();
        assert.equal(f.posts().length, 1); assert.equal(f.calls.length, 2); assert.equal(f.accessCalls, 0);
        assert.equal(f.pending(), false); assert.equal(f.storage.saved.size, 0); assert.equal(f.hook.errorCode, code);
        assert.equal(f.applied[0].capabilities.astraClaim, false); assert.equal(f.navigationBlocked(), false);
        const rejectedId = f.posts()[0].body.operationId;
        f.respond = async (_path, { body }) => ({ card: { ...initial, revision: 4, state: 'IN_PROGRESS', operator: { kind: 'ASTRA' } }, operationId: body.operationId });
        await f.hook.mutate(path, { operator: 'ASTRA', mode: 'CONTINUOUS', expectedRevision: 3 }, initial.id); f.render();
        assert.equal(f.posts().length, 2); assert.notEqual(f.posts()[1].body.operationId, rejectedId); assert.equal(f.hook.error, '');
    }
});
test('committed-but-lost Start reply automatically reconciles without creating a second command or dispatch effect', async () => {
    const initial = { ...card(), state: 'WAITING', operator: null }, recorded = new Map(); let dispatches = 0;
    const f = hookHarness(storage(), initial, { respond: async (_path, { body }) => {
        if (recorded.has(body.operationId)) { assert.deepEqual(body, recorded.get(body.operationId)); return { card: { ...initial, revision: 4, operator: { kind: 'ASTRA' } }, operationId: body.operationId }; }
        recorded.set(body.operationId, structuredClone(body)); dispatches++; throw new Error('Committed reply lost');
    } });
    await f.hook.mutate(`workspace/cards/${initial.id}/claim`, { operator: 'ASTRA', mode: 'CONTINUOUS', expectedRevision: 3 }, initial.id); f.render();
    assert.equal(f.posts().length, 2); assert.equal(recorded.size, 1); assert.equal(dispatches, 1);
    assert.deepEqual(f.posts()[0].body, f.posts()[1].body); assert.equal(f.applied.length, 1); assert.equal(f.pending(), false);
});
test('restored refused Start clears an obsolete hold and refreshes an already automatically started card without residual error', async () => {
    const initial = { ...card(), state: 'WAITING', operator: null }, savedStorage = storage();
    const pending = client.makePending(`workspace/cards/${initial.id}/claim`, { operator: 'ASTRA', mode: 'CONTINUOUS', expectedRevision: 3 }, initial.id);
    drafts.createWorkspaceJournal('reviewer', initial.id, savedStorage).write(pending);
    const f = hookHarness(savedStorage, initial, { respond: async (_path, { body }) => {
        if (body) { assert.deepEqual(body, pending.body); throw { status: 409, code: 'WORKSPACE_CLAIM_CONFLICT', outcome: 'NOT_DISPATCHED' }; }
        return { card: { ...initial, revision: 4, state: 'IN_PROGRESS', operator: { kind: 'ASTRA' } } };
    } });
    await f.flush();
    assert.equal(f.posts().length, 1); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].path, `workspace/cards/${initial.id}`);
    assert.equal(f.pending(), false); assert.equal(f.hook.error, ''); assert.equal(f.storage.saved.size, 0);
    assert.equal(f.applied[0].state, 'IN_PROGRESS'); assert.equal(f.applied[0].operator.kind, 'ASTRA');
});
test('unconfirmed dispatch and unrelated readback cannot be mistaken for proof of a rejected or successful Start', async () => {
    for (const error of [{ status: 503, code: 'WORKSPACE_ASTRA_NOT_READY' }, { status: 503, code: 'WORKSPACE_ASTRA_DISPATCH_UNCONFIRMED' }, { status: 409, code: 'WORKSPACE_CLAIM_CONFLICT' }]) {
        const f = hookHarness(storage(), card(), { respond: async () => { throw error; } });
        await f.hook.mutate(`workspace/cards/${f.card.id}/claim`, { operator: 'ASTRA', expectedRevision: 3 }, f.card.id); f.render();
        assert.equal(f.calls.length, 2); assert.equal(f.posts().length, 2); assert.equal(f.pending(), true); assert.equal(f.applied.length, 0);
    }
    const f = hookHarness(storage(), card(), { respond: async (_path, { body }) => {
        if (body) throw { status: 409, code: 'WORKSPACE_CLAIM_CONFLICT', outcome: 'NOT_DISPATCHED' };
        return { card: { ...card(), revision: 4, operator: { kind: 'ASTRA' } } };
    } });
    await f.hook.mutate(`workspace/cards/${f.card.id}/claim`, { operator: 'ASTRA', expectedRevision: 3 }, f.card.id); f.render();
    assert.equal(f.pending(), false); assert.equal(f.applied.length, 0); assert.equal(f.hook.errorCode, 'WORKSPACE_CLAIM_CONFLICT');
});
test('failed automatic reconciliation is bounded and one returning-connection event resumes only the retained command', async () => {
    const f = hookHarness(), path = `workspace/cards/${f.card.id}/claim`;
    await f.hook.mutate(path, { operator: 'ASTRA', expectedRevision: 3 }, f.card.id); f.render();
    assert.equal(f.posts().length, 2); const original = structuredClone(f.posts()[0].body);
    f.respond = async (_path, { body }) => ({ card: { ...f.card, revision: 4 }, operationId: body.operationId });
    f.window.dispatchEvent(new Event('online')); f.window.dispatchEvent(new Event('focus')); await f.flush();
    assert.equal(f.posts().length, 3); assert.deepEqual(f.posts()[2].body, original); assert.equal(f.pending(), false);
});
test('expired or changed staff access retains the original command without reposting under another staff identity', async () => {
    const f = hookHarness(storage(), card(), { access: async () => ({ staff: { id: 'different-reviewer' }, csrf: 'b'.repeat(64) }) });
    await f.hook.mutate(`workspace/cards/${f.card.id}/claim`, { operator: 'ASTRA', expectedRevision: 3 }, f.card.id); f.render();
    assert.equal(f.posts().length, 1); assert.equal(f.pending(), true); assert.equal(f.hook.errorCode, 'SIGN_IN_REQUIRED');
    assert.equal(f.navigationBlocked(), false);
});
test('navigation during an uncertain Start cancels local reconciliation and preserves its journal for the original card', async () => {
    const f = hookHarness(); let reject;
    f.respond = async () => new Promise((resolve, no) => { reject = no; });
    const action = f.hook.mutate(`workspace/cards/${f.card.id}/claim`, { operator: 'ASTRA', expectedRevision: 3 }, f.card.id);
    f.unmount(); assert.equal(f.posts()[0].signal.aborted, true); reject(new Error('Interrupted')); await action;
    assert.equal(f.posts().length, 1); assert.equal(f.storage.saved.size, 1); assert.equal(f.applied.length, 0);
});
const all = (tree, predicate, output = []) => { if (Array.isArray(tree)) tree.forEach(node => all(node, predicate, output)); else if (tree && typeof tree === 'object') { if (predicate(tree)) output.push(tree); all(tree.props?.children, predicate, output); } return output; };
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree ?? '';
test('workspace notices use inline status/errors with no yellow recovery panel or manual recovery/alternate-tab links', () => {
    const react = reactHarness(), exported = {};
    vm.runInNewContext(sharedCode, { exports: exported, require(name) {
        if (name === 'react') return react.react;
        if (name === 'next/link') return 'link';
        if (name === './Shell') return { Notice: 'notice' };
        if (name === '../lib/workspace-client.mjs') return client;
        if (name === '../lib/routes.mjs') return { STAFF_REAUTHENTICATE_PATH: '/?reauthenticate=1' };
        if (name.endsWith('.module.css')) return { recovery: 'yellow-recovery', help: 'help' };
        return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
    for (const mutation of [{ pending: {}, busy: true, reconciling: true }, { pending: {}, error: 'The connection is interrupted.' }, { pending: null, error: 'This card is waiting for test admission.' }]) {
        const tree = exported.RecoveryNotice({ mutation });
        assert.doesNotMatch(text(tree), /saved request needs|Recover saved request|another tab/);
        assert.equal(all(tree, node => node.props.className === 'yellow-recovery').length, 0);
        assert.equal(all(tree, node => node.type === 'button' || node.type === 'a').length, 0);
    }
    const auth = exported.RecoveryNotice({ mutation: { pending: {}, errorCode: 'SIGN_IN_REQUIRED', error: 'Your session ended.' } });
    const links = all(auth, node => node.type === 'a'); assert.equal(links.length, 1); assert.equal(text(links[0]), 'Sign in again'); assert.equal(links[0].props.target, undefined);
});
test('lost human map-decision response recovers its exact affirmative request after reload', async () => {
    const f = hookHarness(), path = `workspace/cards/${f.card.id}/action`;
    await f.hook.mutate(path, { action: 'CONTINUE_WITHOUT_MAP', payload: { confirmed: true }, expectedRevision: 3 }, f.card.id);
    const original = structuredClone(f.calls[0].body); f.unmount();
    const restored = hookHarness(f.storage, f.card, { respond: async (_path, { body }) => ({ card: { ...f.card, revision: 5, workspace: { map: { status: 'HUMAN_REVIEW_WITHOUT_MAP' } } }, operationId: body.operationId }) });
    await restored.flush(); assert.deepEqual(restored.calls[0].body, original); assert.equal(restored.pending(), false);
});
