import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as client from '../lib/workspace-client.mjs';
import * as drafts from '../lib/workspace-drafts.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const fullCardFrame = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
function compile(path) { return babel.transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { filename: path, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code; }
const hookCode = compile('../lib/useWorkspaceMutation.js'), workspaceCode = compile('../components/CardGradingWorkspace.jsx'), intakeCode = compile('../components/PhotoIntake.jsx');
function reactHarness() {
    const slots = [], effects = []; let cursor = 0;
    return { react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
        useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
        useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
        useEffect(action, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => old[i] !== value)) { slots[index] = deps; effects.push(action); } } },
        render(action) { cursor = 0; const result = action(); for (const effect of effects.splice(0)) effect(); return result; }
    };
}
const storage = () => { const saved = new Map(); return { saved, getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }; };
const card = () => ({ id: randomUUID(), revision: 3, state: 'IN_PROGRESS', stage: 'IDENTITY', workspace: {}, sides: [{ side: 'FRONT', status: 'VERIFIED' }, { side: 'BACK', status: 'VERIFIED' }], capabilities: { canEdit: true, actions: ['SAVE_IDENTITY', 'SAVE_BOUNDARY', 'SAVE_CENTERING'] } });
function hookHarness(savedStorage = storage(), initialCard = card()) {
    const react = reactHarness(), exported = {}, f = { storage: savedStorage, card: initialCard, calls: [], applied: [], accessCalls: 0, respond: async () => { throw new Error('Lost reply'); } }; let guard;
    const request = async (path, options) => { f.calls.push({ path, ...options, body: structuredClone(options.body) }); return f.respond(path, options); };
    vm.runInNewContext(hookCode, { exports: exported, require(name) {
        if (name === 'react') return react.react;
        if (name === './usePendingNavigation') return { usePendingNavigation: action => { guard = action; } };
        if (name === './workspace-client.mjs') return { ...client, workspaceRequest: request, freshWorkspaceAccess: async () => { f.accessCalls++; return { csrf: 'b'.repeat(64) }; } };
        if (name === './workspace-drafts.mjs') return { createWorkspaceJournal: (owner, id) => drafts.createWorkspaceJournal(owner, id, savedStorage) };
        return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
    f.render = () => { f.hook = react.render(() => exported.useWorkspaceMutation({ staffId: 'reviewer', cardId: f.card.id, csrf: 'a'.repeat(64), onCard: value => f.applied.push(value) })); };
    f.pending = () => guard(); f.render(); f.render(); return f;
}
test('actual workspace mutation hook blocks duplicate clicks and restores exact uncertain request after reload', async () => {
    const f = hookHarness(); let reject; f.respond = () => new Promise((yes, no) => { reject = no; });
    const path = `workspace/cards/${f.card.id}/action`, first = f.hook.mutate(path, { action: 'SAVE_IDENTITY', payload: { identity: { category: 'SPORTS', playerName: 'Original' } }, expectedRevision: 3 }, f.card.id);
    await f.hook.mutate(path, { action: 'SAVE_IDENTITY', payload: { identity: { playerName: 'Changed' } }, expectedRevision: 3 }, f.card.id);
    assert.equal(f.calls.length, 1); reject(new Error('Lost')); await first; f.render(); assert.equal(f.pending(), true);
    const original = structuredClone(f.calls[0].body), restored = hookHarness(f.storage, f.card); assert.equal(restored.pending(), true);
    await restored.hook.mutate(path, { action: 'INITIALIZE_REPORT', expectedRevision: 9 }, f.card.id); assert.equal(restored.calls.length, 0);
    restored.respond = async (path, { body }) => ({ card: { ...restored.card, revision: 4 }, operationId: body.operationId });
    await restored.hook.recover(); restored.render(); assert.deepEqual(restored.calls[0].body, original); assert.equal(restored.calls[0].csrf, 'b'.repeat(64));
    assert.equal(restored.accessCalls, 1); assert.equal(restored.pending(), false); assert.equal(restored.applied.length, 1); assert.equal(restored.storage.saved.size, 0);
});
test('malformed receipt and generic denial retain authority; proven no-dispatch conflict releases it', async () => {
    const f = hookHarness(), path = `workspace/cards/${f.card.id}/claim`;
    f.respond = async () => ({ card: { ...f.card, id: randomUUID() }, operationId: randomUUID() });
    await f.hook.mutate(path, { operator: 'HUMAN', expectedRevision: 3 }, f.card.id); f.render(); assert.equal(f.pending(), true); assert.equal(f.applied.length, 0);
    f.respond = async () => { throw { status: 409, code: 'WORKSPACE_REVISION_CHANGED' }; }; await f.hook.recover(); f.render(); assert.equal(f.pending(), true);
    f.respond = async () => { throw { status: 409, code: 'WORKSPACE_REVISION_CHANGED', outcome: 'NOT_DISPATCHED' }; }; await f.hook.recover(); f.render(); assert.equal(f.pending(), false);
});
const all = (tree, predicate, output = []) => { if (Array.isArray(tree)) tree.forEach(node => all(node, predicate, output)); else if (tree && typeof tree === 'object') { if (predicate(tree)) output.push(tree); all(tree.props?.children, predicate, output); } return output; };
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree ?? '';
function stageHarness(name, initial) {
    const react = reactHarness(), exported = {}, f = { props: { card: initial, forms: {}, disabled: false, discard() {} }, actions: [] };
    f.props.edit = (scope, value) => { f.props.forms = { ...f.props.forms, [scope]: { value, baseRevision: f.props.card.revision } }; };
    f.props.act = (...args) => f.actions.push(args);
    vm.runInNewContext(workspaceCode, { exports: exported, require(module) {
        if (module === 'react') return react.react;
        if (module === 'next/link') return 'link';
        if (module === './Shell') return { Notice: 'notice' };
        if (module === './WorkspaceShared') return { OriginalImages: 'OriginalImages', ReportLink: 'ReportLink' };
        if (module === './WorkspaceGeometry') return { ImageQuadEditor: 'ImageQuadEditor', fullCardFrame };
        if (module === '../lib/workspace-client.mjs') return client;
        if (module === '../lib/useWorkspaceMutation' || module === '../lib/usePendingNavigation') return {};
        if (module.endsWith('.module.css')) return {};
        if (module.startsWith('./')) return {};
        return nextRequire(module.startsWith('@babel/runtime/') ? `next/dist/compiled/${module}` : module);
    } });
    f.render = () => { f.tree = react.render(() => exported[name](f.props)); };
    f.find = (type, label) => { const value = all(f.tree, node => node.type === type && (label == null || text(node).includes(label)))[0]; assert.ok(value, `${type}: ${label}`); return value; };
    f.change = (label, value, checked = false) => { const field = f.find('label', label), input = all(field, node => ['input', 'select'].includes(node.type))[0]; input.props.onChange({ target: { value, checked } }); f.render(); };
    f.submit = () => { f.find('form').props.onSubmit({ preventDefault() {} }); f.render(); };
    f.render(); return f;
}
test('identity form binds explicit human corner shape and strips fields from the other category', () => {
    const initial = card(); initial.identity = { category: 'SPORTS', playerName: 'Sports Player', manufacturer: 'Maker', insert: 'Insert', year: '2024', productSet: 'Set' };
    const f = stageHarness('IdentityStage', initial);
    f.change('Card type', 'POKEMON'); f.change('Card name', 'New Pokémon'); f.change('Printed layout', 'TRAINER'); f.change('Physical card corners', 'SQUARE'); f.submit();
    assert.equal(f.actions.length, 1); const [action, payload, scope] = f.actions[0];
    assert.equal(action, 'SAVE_IDENTITY'); assert.equal(scope, 'identity'); assert.equal(payload.cornerShape, 'SQUARE');
    assert.equal(payload.identity.layoutType, 'TRAINER'); assert.equal(payload.identity.cardName, 'New Pokémon');
    assert.equal('playerName' in payload.identity, false); assert.equal('manufacturer' in payload.identity, false); assert.equal('cornerShape' in payload.identity, false);
    f.props.card = { ...initial, revision: 4 }; f.render(); f.submit(); assert.equal(f.actions.length, 1, 'A newer saved card invalidates the stale form revision.');
});
test('centering uses only the prepared image and fixed physical frame, preserving earlier edits on invalidation', () => {
    const initial = card(), f = stageHarness('CenteringStage', initial);
    assert.equal(f.find('ImageQuadEditor').props.imageUrl, null, 'Original photography is never a centering fallback.');
    assert.equal(f.find('button', 'Save and measure').props.disabled, true);
    f.props.card.workspace = { preparation: { FRONT: { status: 'PREPARED', imageUrl: `/admin/api/staff/workspace/cards/${initial.id}/prepared/FRONT` } } }; f.render();
    f.find('ImageQuadEditor').props.onReady(true); f.render();
    const inner = [{ x: .04, y: .06 }, { x: .96, y: .06 }, { x: .96, y: .94 }, { x: .04, y: .94 }];
    f.find('ImageQuadEditor').props.onChange(inner); f.render(); f.change('I reviewed the printed frame', '', true);
    const save = f.find('button', 'Save and measure'); assert.equal(save.props.disabled, false); save.props.onClick();
    assert.equal(f.actions[0][0], 'SAVE_CENTERING'); assert.deepEqual(f.actions[0][1].outer, fullCardFrame); assert.deepEqual(f.actions[0][1].inner, inner);
    f.props.card = { ...f.props.card, revision: 4, workspace: { preparation: { FRONT: { status: 'PENDING' } } } }; f.render();
    assert.equal(f.find('ImageQuadEditor').props.imageUrl, null); assert.equal(f.find('button', 'Save and measure').props.disabled, true);
    assert.deepEqual(f.find('ImageQuadEditor').props.points, inner, 'The human outline stays visible in the local draft state.');
});

test('actual batch intake keeps verified pairs out of the queue until each human confirmation', async () => {
    const react = reactHarness(), exported = {}, saved = { entries: [] }, cards = new Map(), requests = [], puts = [];
    const entry = number => ({ id: randomUUID(), title: `Card ${number}`, identity: { category: 'POKEMON' }, files: { FRONT: { name: `front-${number}.jpg`, type: 'image/jpeg', size: 20 }, BACK: { name: `back-${number}.jpg`, type: 'image/jpeg', size: 20 } }, uploads: {}, card: null, pending: null, pairConfirmed: false });
    saved.entries = [entry(1), entry(2)];
    const request = async (path, { body }) => {
        requests.push({ path, body: structuredClone(body) });
        let current;
        if (path === 'workspace/cards') { current = { ...card(), title: body.title, state: 'DRAFT', stage: 'PHOTOS', revision: 1, sides: [{ side: 'FRONT', status: 'MISSING' }, { side: 'BACK', status: 'MISSING' }] }; cards.set(current.id, current); }
        else { current = cards.get(path.split('/')[2]); assert.equal(body.expectedRevision, current.revision); current.revision++; }
        let upload;
        if (path.endsWith('/upload-plan')) { upload = { id: randomUUID() }; Object.assign(current.sides.find(value => value.side === body.side), { status: 'PLANNED', uploadId: upload.id }); }
        if (path.endsWith('/upload-complete')) current.sides.find(value => value.uploadId === body.uploadId).status = 'VERIFIED';
        if (path.endsWith('/queue')) { assert.equal(body.pairConfirmed, true); assert.ok(current.sides.every(value => value.status === 'VERIFIED')); current.state = 'WAITING'; }
        return { card: structuredClone(current), operationId: body.operationId, ...(upload ? { upload } : {}) };
    };
    vm.runInNewContext(intakeCode, { exports: exported, structuredClone, require(module) {
        if (module === 'react') return react.react;
        if (module === 'next/link') return 'link';
        if (module === './Shell') return { Notice: 'notice' };
        if (module === './WorkspaceShared') return { PhotoPreview: 'PhotoPreview', Readiness: 'Readiness', StateBadge: 'StateBadge' };
        if (module === '../lib/workspace-drafts.mjs') return { createPhotoDraftStore: () => ({ read: async () => structuredClone(saved.entries), write: async entries => { saved.entries = structuredClone(entries); } }) };
        if (module === '../lib/workspace-client.mjs') return { ...client, workspaceRequest: request, freshWorkspaceAccess: async () => ({ csrf: 'a'.repeat(64) }), uploadIntakeEntry: (entry, options) => client.uploadIntakeEntry(entry, { ...options, describe: async file => ({ name: file.name, contentType: file.type, byteCount: file.size, sha256: 'a'.repeat(64) }), put: async (upload, file) => { puts.push(file.name); } }) };
        if (module === '../lib/routes.mjs') return { STAFF_REAUTHENTICATE_PATH: '/admin?reauthenticate=1' };
        if (module === '../lib/usePendingNavigation') return { usePendingNavigation() {} };
        if (module.endsWith('.module.css')) return {};
        return nextRequire(module.startsWith('@babel/runtime/') ? `next/dist/compiled/${module}` : module);
    } });
    let tree; const render = () => { tree = react.render(() => exported.default({ staff: { id: 'reviewer', role: 'REVIEWER' } })); }, find = (type, label) => all(tree, node => node.type === type && text(node).includes(label));
    render(); await new Promise(resolve => setImmediate(resolve)); render();
    await find('button', 'Upload all selected photos')[0].props.onClick(); render();
    assert.equal(puts.length, 4); assert.equal(cards.size, 2); assert.ok([...cards.values()].every(value => value.state === 'DRAFT'));
    assert.equal(requests.filter(value => value.path.endsWith('/queue')).length, 0);
    const queueButtons = find('button', 'Add to Waiting to grade'); assert.equal(queueButtons.length, 2); assert.ok(queueButtons.every(button => button.props.disabled));
    const checks = all(tree, node => node.type === 'input' && node.props.type === 'checkbox'); checks[0].props.onChange({ target: { checked: true } }); await new Promise(resolve => setImmediate(resolve)); render();
    assert.equal(find('button', 'Add to Waiting to grade')[0].props.disabled, false); assert.equal(find('button', 'Add to Waiting to grade')[1].props.disabled, true);
    await find('button', 'Add to Waiting to grade')[0].props.onClick(); render();
    assert.equal(requests.filter(value => value.path.endsWith('/queue')).length, 1); assert.equal([...cards.values()].filter(value => value.state === 'WAITING').length, 1);
    assert.equal(saved.entries[0].files.FRONT, null); assert.equal(saved.entries[0].files.BACK, null); assert.notEqual(saved.entries[1].files.FRONT, null);
    assert.ok(requests.every(value => !/claim|action/.test(value.path)), 'Queue population never starts grading.');
});

test('map review checks automatically once, while failure consent stays explicitly human and revision-bound', () => {
    const initial = card(); initial.operator = { kind: 'HUMAN', name: 'Fixture reviewer' }; initial.capabilities.actions.push('RESOLVE_MAP');
    const f = stageHarness('MapReview', initial); assert.equal(f.actions.length, 1); assert.equal(f.actions[0][0], 'RESOLVE_MAP'); f.render(); assert.equal(f.actions.length, 1);
    f.props.card = { ...initial, revision: 4, workspace: { map: { status: 'LOOKUP_FAILED', name: null, scope: null, version: null, registration: { FRONT: 'MISSING', BACK: 'MISSING' }, bindingReady: false, canRegister: false } }, capabilities: { canEdit: true, actions: ['RESOLVE_MAP', 'CONTINUE_WITHOUT_MAP'] } }; f.render();
    assert.equal(f.find('button', 'Save decision').props.disabled, true);
    f.change('I reviewed the recorded map failure', '', true); assert.equal(f.find('button', 'Save decision').props.disabled, false);
    f.props.card = { ...f.props.card, revision: 5 }; f.render(); assert.equal(f.find('button', 'Save decision').props.disabled, true);
    f.change('I reviewed the recorded map failure', '', true); f.find('button', 'Save decision').props.onClick();
    assert.equal(f.actions.at(-1)[0], 'CONTINUE_WITHOUT_MAP'); assert.equal(f.actions.at(-1)[1].confirmed, true);
    f.props.card.operator = { kind: 'ASTRA' }; f.render(); assert.equal(all(f.tree, node => node.type === 'input' && node.props.type === 'checkbox').length, 0);
});

test('photo intake enables explicit reselect after a retained rejection and keeps unresolved uploads locked', async () => {
    for (const unresolved of [false, true]) {
        const react = reactHarness(), exported = {}, original = { name: 'front.png', type: 'image/png', size: 20 }, replacement = { ...original, name: 'replacement.png' };
        const rejected = { ...card(), state: 'DRAFT', stage: 'PHOTOS', title: 'Same physical card',
            sides: [{ side: 'FRONT', status: 'REJECTED', uploadId: randomUUID(), rejection: { reason: 'BYTES_MISMATCH' } }, { side: 'BACK', status: 'VERIFIED', uploadId: randomUUID() }] };
        let saved = [{ id: randomUUID(), title: rejected.title, identity: { category: 'POKEMON' }, card: rejected,
            files: { FRONT: original, BACK: { name: 'back.png', type: 'image/png', size: 20 } },
            uploads: { FRONT: { phase: unresolved ? 'COMPLETE' : 'REJECTED', rejection: { reason: 'BYTES_MISMATCH' } }, BACK: { phase: 'VERIFIED' } },
            pending: unresolved ? { path: `workspace/cards/${rejected.id}/upload-complete`, body: { operationId: randomUUID() } } : null,
            pairConfirmed: false }];
        const back = structuredClone(saved[0].files.BACK);
        vm.runInNewContext(intakeCode, { exports: exported, structuredClone, require(module) {
            if (module === 'react') return react.react;
            if (module === 'next/link') return 'link';
            if (module === './Shell') return { Notice: 'notice' };
            if (module === './WorkspaceShared') return { PhotoPreview: 'PhotoPreview', Readiness: 'Readiness', StateBadge: 'StateBadge' };
            if (module === '../lib/workspace-drafts.mjs') return { createPhotoDraftStore: () => ({ read: async () => structuredClone(saved), write: async entries => { saved = structuredClone(entries); } }) };
            if (module === '../lib/workspace-client.mjs') return client;
            if (module === '../lib/routes.mjs') return { STAFF_REAUTHENTICATE_PATH: '/admin?reauthenticate=1' };
            if (module === '../lib/usePendingNavigation') return { usePendingNavigation() {} };
            if (module.endsWith('.module.css')) return {};
            return nextRequire(module.startsWith('@babel/runtime/') ? `next/dist/compiled/${module}` : module);
        } });
        const render = () => react.render(() => exported.default({ staff: { id: 'fixture-reviewer', role: 'REVIEWER' } }));
        render(); await new Promise(resolve => setImmediate(resolve)); const tree = render();
        const files = all(tree, node => node.type === 'input' && node.props.type === 'file');
        assert.equal(files[0].props.disabled, unresolved);
        if (!unresolved) assert.match(text(tree), /Needs replacement/);
        files[0].props.onChange({ target: { files: [replacement], value: 'selected' } });
        await new Promise(resolve => setImmediate(resolve)); render();
        assert.equal(saved[0].card.id, rejected.id); assert.deepEqual(saved[0].files.BACK, back);
        assert.equal(saved[0].files.FRONT.name, unresolved ? original.name : replacement.name);
        assert.equal(saved[0].uploads.FRONT?.phase ?? null, unresolved ? 'COMPLETE' : null);
        assert.equal(saved[0].pairConfirmed, false);
    }
});

test('map review never treats missing map or integrity failure as a human override', () => {
    for (const status of ['NO_MAP', 'INTEGRITY_ERROR', 'HUMAN_REVIEW_WITHOUT_MAP']) {
        const initial = card(); initial.operator = { kind: 'HUMAN' }; initial.workspace.map = { status, name: null, scope: null, version: null, registration: {}, canRegister: false, bindingReady: false };
        const f = stageHarness('MapReview', initial); assert.equal(f.actions.length, 0); assert.equal(all(f.tree, node => node.type === 'input').length, 0);
    }
});

test('lost human map-decision response recovers its exact affirmative request after reload', async () => {
    const f = hookHarness(), path = `workspace/cards/${f.card.id}/action`;
    await f.hook.mutate(path, { action: 'CONTINUE_WITHOUT_MAP', payload: { confirmed: true }, expectedRevision: 3 }, f.card.id);
    const original = structuredClone(f.calls[0].body), restored = hookHarness(f.storage, f.card);
    restored.respond = async (_path, { body }) => ({ card: { ...restored.card, revision: 5, workspace: { map: { status: 'HUMAN_REVIEW_WITHOUT_MAP' } } }, operationId: body.operationId });
    await restored.hook.recover(); restored.render(); assert.deepEqual(restored.calls[0].body, original); assert.equal(restored.pending(), false);
});
