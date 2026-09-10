import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as client from '../lib/workspace-client.mjs';
import { parseWorkspaceIntakeRequest } from '../lib/server/access/workspace-intake-validation.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const nextRequire = createRequire(require.resolve('next/package.json'));
const filename = '../components/PhotoIntake.jsx';
const code = babel.transformSync(readFileSync(new URL(filename, import.meta.url), 'utf8'), {
    filename, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false
}).code;
const nativeClone = globalThis.structuredClone;
// Node 20 clones File as Blob; browser structuredClone/IndexedDB retain its
// name and lastModified. Keep native byte cloning and restore those two File
// fields only, including inside the real upload client's persisted snapshots.
function clone(value) {
    const copied = nativeClone(value), seen = new WeakMap();
    function restore(source, target) {
        if (!source || typeof source !== 'object') return target;
        if (seen.has(source)) return seen.get(source);
        const result = source instanceof File
            ? new File([target], source.name, { type: source.type, lastModified: source.lastModified }) : target;
        seen.set(source, result);
        if (!(source instanceof File)) for (const key of Object.keys(source)) result[key] = restore(source[key], target[key]);
        return result;
    }
    return restore(value, copied);
}
beforeEach(() => { globalThis.structuredClone = clone; });
afterEach(() => { globalThis.structuredClone = nativeClone; });
const settle = () => new Promise(resolve => setImmediate(resolve));
const photo = name => new File([`original photograph bytes: ${name}`], `${name}.png`, { type: 'image/png' });
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
function all(tree, predicate, found = []) {
    if (Array.isArray(tree)) tree.forEach(node => all(node, predicate, found));
    else if (tree && typeof tree === 'object') { if (predicate(tree)) found.push(tree); all(tree.props?.children, predicate, found); }
    return found;
}
function hooks() {
    const slots = [], effects = []; let cursor = 0;
    return { react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
        useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useEffect(action, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((value, j) => value !== prior[j])) { slots[i] = deps; effects.push(action); } }
    }, render(action) { cursor = 0; const tree = action(); effects.splice(0).forEach(action => action()); return tree; } };
}

function fixture() {
    const f = { saved: [], cards: new Map(), receipts: new Map(), requests: [], puts: [], grants: new Map(), objects: new Map(), failAfter: new Map(), accessCalls: 0 };
    f.access = async () => { f.accessCalls++; return { csrf: 'a'.repeat(64) }; };
    f.request = async (path, { body }) => {
        const action = path === 'workspace/cards' ? 'create' : path.split('/').at(-1);
        parseWorkspaceIntakeRequest(action, clone(body));
        const retained = f.saved.find(entry => entry.pending?.body.operationId === body.operationId)?.pending;
        assert.equal(retained?.path, path, 'Every request must already be saved in the browser');
        assert.deepEqual(retained.body, body);
        f.requests.push({ path, body: clone(body) });
        const prior = f.receipts.get(body.operationId);
        if (prior) { assert.deepEqual(prior.body, body); return clone(prior.result); }
        let card;
        if (action === 'create') {
            card = { id: randomUUID(), title: body.title || 'New card', identity: clone(body.identity), revision: 1, state: 'DRAFT', stage: 'PHOTOS',
                sides: ['FRONT', 'BACK'].map(side => ({ side, status: 'MISSING' })) };
            f.cards.set(card.id, card);
        } else { card = f.cards.get(path.split('/')[2]); assert.equal(card.revision, body.expectedRevision); card.revision++; }
        const result = { card, operationId: body.operationId };
        if (action === 'upload-plan') {
            const id = randomUUID(); f.grants.set(id, clone(body.file));
            Object.assign(card.sides.find(value => value.side === body.side), { status: 'PLANNED', uploadId: id });
            result.upload = { id };
        }
        if (action === 'upload-complete') {
            const side = card.sides.find(value => value.uploadId === body.uploadId);
            assert.deepEqual(f.objects.get(body.uploadId), f.grants.get(body.uploadId), 'Only exact uploaded fixture bytes become verified');
            side.status = 'VERIFIED';
            if (f.rejectSide === side.side) {
                side.status = 'REJECTED'; side.rejection = { reason: 'BYTES_MISMATCH', operationId: body.operationId, revision: card.revision };
                result.uploadResult = { state: 'REJECTED', cardId: card.id, uploadId: body.uploadId, side: side.side, reason: 'BYTES_MISMATCH', revision: card.revision };
            }
            if (f.malformedVerification) result.operationId = randomUUID();
        }
        if (action === 'queue') {
            assert.equal(body.pairConfirmed, true); assert.ok(card.sides.every(side => side.status === 'VERIFIED'));
            card.state = 'WAITING';
        }
        f.receipts.set(body.operationId, { body: clone(body), result: clone(result) });
        if (f.failAfter.has(action)) { const error = f.failAfter.get(action); f.failAfter.delete(action); throw error; }
        return clone(result);
    };
    f.put = async (grant, file) => { f.puts.push({ id: grant.id, name: file.name }); f.objects.set(grant.id, await client.describePhoto(file)); };
    return f;
}

async function mount(f, props = {}) {
    const react = hooks(), exported = {}; let tree;
    vm.runInNewContext(code, { exports: exported, structuredClone, AbortController, require(module) {
        if (module === 'react') return react.react;
        if (module === 'next/link') return 'link';
        if (module === './Shell') return { Notice: 'notice' };
        if (module === './WorkspaceShared') return { PhotoPreview: 'PhotoPreview', OriginalHeicDownload: 'OriginalHeicDownload', Readiness: 'Readiness', StateBadge: 'StateBadge' };
        if (module === '../lib/workspace-drafts.mjs') return { createPhotoDraftStore: () => ({ read: async () => clone(f.saved), write: async entries => { f.saved = clone(entries); } }) };
        if (module === '../lib/workspace-client.mjs') return { ...client, workspaceRequest: f.request, freshWorkspaceAccess: () => f.access(),
            uploadIntakeEntry: (entry, options) => client.uploadIntakeEntry(entry, { ...options, put: f.put }) };
        if (module === '../lib/routes.mjs') return { STAFF_REAUTHENTICATE_PATH: '/admin?reauthenticate=1' };
        if (module === '../lib/usePendingNavigation') return { usePendingNavigation() {} };
        if (module.endsWith('.module.css')) return {};
        return nextRequire(module.startsWith('@babel/runtime/') ? `next/dist/compiled/${module}` : module);
    } });
    const h = { render() { tree = react.render(() => exported.default({ staff: { id: 'fixture-reviewer', role: 'REVIEWER' }, ...props })); },
        nodes: predicate => all(tree, predicate), text: () => text(tree),
        button(label, index = 0) { const value = all(tree, node => node.type === 'button' && text(node).includes(label))[index]; assert.ok(value, label); return value; },
        checks: () => all(tree, node => node.type === 'input' && node.props.type === 'checkbox'),
        files: () => all(tree, node => node.type === 'input' && node.props.type === 'file'),
        async select(index, file) { h.files()[index].props.onChange({ target: { files: [file], value: 'selected' } }); await settle(); h.render(); },
        async confirm(index = 0) { assert.equal(h.checks()[index].props.disabled, false); h.checks()[index].props.onChange({ target: { checked: true } }); await settle(); h.render(); },
        async click(label, index) { await h.button(label, index).props.onClick(); await settle(); h.render(); }
    };
    h.render(); await settle(); h.render(); return h;
}
async function selectPair(h, index = 0) { await h.select(index * 2, photo(`front-${index}`)); await h.select(index * 2 + 1, photo(`back-${index}`)); }

test('the browser draft fixture clones real File bytes, metadata and nested request records independently', async () => {
    const original = { files: [new File(['exact original photo'], 'front.heic', { type: 'image/heic', lastModified: 123456 })],
        pending: { body: { operationId: randomUUID(), expectedRevision: 2 } } };
    const copy = clone(original);
    assert.notEqual(copy.files[0], original.files[0]); assert.ok(copy.files[0] instanceof File);
    assert.equal(copy.files[0].name, original.files[0].name); assert.equal(copy.files[0].type, original.files[0].type);
    assert.equal(copy.files[0].lastModified, original.files[0].lastModified);
    assert.deepEqual(await copy.files[0].arrayBuffer(), await original.files[0].arrayBuffer());
    copy.pending.body.expectedRevision++;
    assert.equal(original.pending.body.expectedRevision, 2); assert.equal(copy.pending.body.expectedRevision, 3);
});

test('a physical pair can be queued in one action with no title or category, after explicit confirmation', async () => {
    const f = fixture(), h = await mount(f);
    assert.equal(h.nodes(node => node.type === 'select').length, 0, 'Intake asks for no category');
    assert.equal(h.checks()[0].props.disabled, true);
    const label = h.nodes(node => node.type === 'input' && node.props.type !== 'file' && node.props.type !== 'checkbox')[0];
    label.props.onChange({ target: { value: '' } }); await settle(); h.render();
    await h.select(0, photo('front')); assert.equal(h.checks()[0].props.disabled, true);
    await h.select(1, photo('back')); assert.equal(h.checks()[0].props.disabled, false);
    assert.equal(f.requests.length, 0, 'Selecting photos only saves local drafts');
    assert.equal(h.button('Add to Waiting to grade').props.disabled, true);
    await h.click('Add to Waiting to grade'); assert.equal(f.requests.length, 0, 'Even a direct handler call cannot skip human confirmation');
    await h.confirm(); assert.equal(h.button('Add to Waiting to grade').props.disabled, false);
    await h.click('Add to Waiting to grade');
    assert.deepEqual(f.requests[0].body.identity, {}); assert.equal(f.requests[0].body.title, '');
    assert.deepEqual(f.requests.map(value => value.path.split('/').at(-1)), ['cards', 'upload-plan', 'upload-complete', 'upload-plan', 'upload-complete', 'queue']);
    assert.equal(f.cards.size, 1); assert.equal(f.saved[0].card.state, 'WAITING'); assert.equal(f.puts.length, 2);
    assert.equal(f.saved[0].pending, null); assert.deepEqual(f.saved[0].files, { FRONT: null, BACK: null });
    assert.ok(f.requests.every(value => !/claim|action/.test(value.path)), 'Queueing does not start Astra or grading');
});

test('an older unnamed draft omits only its empty category and preserves supplied details', async () => {
    const f = fixture(); let h = await mount(f); await selectPair(h);
    f.saved[0].identity = { category: '', year: '2026' }; h = await mount(f);
    await h.confirm(); await h.click('Add to Waiting to grade');
    assert.deepEqual(f.requests[0].body.identity, { year: '2026' });
    assert.equal(f.saved[0].card.state, 'WAITING');
});

test('an interrupted verification recovers the exact upload after reload, then queues without reuploading', async () => {
    const f = fixture(); let h = await mount(f); await selectPair(h); await h.confirm();
    f.failAfter.set('upload-complete', new Error('Reply lost after verification'));
    await h.click('Add to Waiting to grade');
    const pending = clone(f.saved[0].pending); assert.equal(f.puts.length, 1);
    assert.equal(f.requests.filter(value => value.path.endsWith('/queue')).length, 0);
    h = await mount(f); assert.ok(h.files().every(node => node.props.disabled));
    await h.click('Recover saved request');
    assert.equal(f.saved[0].pending, null); assert.equal(f.saved[0].card.state, 'DRAFT');
    const retries = f.requests.filter(value => value.body.operationId === pending.body.operationId);
    assert.equal(retries.length, 2); assert.deepEqual(retries[1].body, pending.body);
    assert.equal(f.puts.length, 2); await h.click('Add to Waiting to grade');
    assert.equal(f.saved[0].card.state, 'WAITING'); assert.equal(f.cards.size, 1); assert.equal(f.puts.length, 2);
});

test('a lost queue reply retains the exact queue request and local HEIC originals across reload', async () => {
    const f = fixture(); let h = await mount(f); await selectPair(h);
    const originals = { FRONT: new File(['original front HEIC'], 'front.heic', { type: 'image/heic' }), BACK: new File(['original back HEIC'], 'back.heic', { type: 'image/heic' }) };
    f.saved[0].sourceFiles = clone(originals); f.saved[0].photoImports = { FRONT: { width: 3024, height: 4032 }, BACK: { width: 3024, height: 4032 } };
    h = await mount(f); await h.confirm(); f.failAfter.set('queue', new Error('Reply lost after queue commit'));
    await h.click('Add to Waiting to grade');
    const pending = clone(f.saved[0].pending), requestCount = f.requests.length;
    assert.ok(pending.path.endsWith('/queue')); assert.notEqual(f.saved[0].files.FRONT, null);
    h = await mount(f); await h.click('Recover saved request');
    assert.equal(f.requests.length, requestCount + 1); assert.deepEqual(f.requests.at(-1).body, pending.body);
    assert.equal(f.puts.length, 2); assert.equal(f.cards.size, 1); assert.equal(f.saved[0].card.state, 'WAITING');
    assert.equal(f.saved[0].pending, null); assert.equal(f.saved[0].files.FRONT, null);
    for (const side of ['FRONT', 'BACK']) assert.deepEqual(await f.saved[0].sourceFiles[side].arrayBuffer(), await originals[side].arrayBuffer());
});

test('rejected or malformed verification never reaches the queue through the combined action', async () => {
    for (const failure of ['rejectSide', 'malformedVerification']) {
        const f = fixture(), h = await mount(f); await selectPair(h); await h.confirm();
        f[failure] = failure === 'rejectSide' ? 'FRONT' : true;
        await h.click('Add to Waiting to grade');
        assert.equal(f.requests.filter(value => value.path.endsWith('/queue')).length, 0);
        assert.equal(f.saved[0].card.state, 'DRAFT'); assert.notEqual(f.saved[0].files.FRONT, null);
        if (failure === 'rejectSide') {
            assert.equal(f.saved[0].pending, null); assert.equal(f.saved[0].pairConfirmed, false);
            assert.equal(h.checks()[0].props.disabled, true); assert.equal(h.files()[0].props.disabled, false);
            await h.select(0, photo('replacement-front')); assert.equal(f.saved[0].pairConfirmed, false);
        } else { assert.ok(f.saved[0].pending); assert.ok(h.files().every(node => node.props.disabled)); }
    }
});

test('batch queueing includes only individually confirmed pairs and still saves each card separately', async () => {
    const f = fixture(), h = await mount(f); await selectPair(h); await h.confirm();
    await h.click('Add another card'); await selectPair(h, 1);
    assert.equal(h.nodes(node => node.type === 'button' && text(node).includes('confirmed cards')).length, 0);
    await h.confirm(1); await h.click('Add 2 confirmed cards to queue');
    assert.equal(f.cards.size, 2); assert.equal(f.puts.length, 4);
    assert.ok(f.saved.every(entry => entry.card.state === 'WAITING' && entry.pending === null));
    assert.ok(f.requests.filter(value => value.path.endsWith('/queue')).every(value => value.body.pairConfirmed === true));
});

test('duplicate queue clicks cannot start a second request while refreshing staff access', async () => {
    const f = fixture(), h = await mount(f); await selectPair(h); await h.confirm();
    let release; f.access = () => { f.accessCalls++; return new Promise(resolve => { release = resolve; }); };
    const first = h.button('Add to Waiting to grade').props.onClick(); await settle(); h.render();
    assert.ok(h.files().every(node => node.props.disabled));
    await h.button('Saving and verifying').props.onClick(); assert.equal(f.accessCalls, 1);
    release({ csrf: 'a'.repeat(64) }); await first; await settle(); h.render();
    assert.equal(f.cards.size, 1); assert.equal(f.requests.filter(value => value.path.endsWith('/queue')).length, 1);
});

test('a newer saved photo cannot inherit an earlier physical-pair confirmation or local verified status', async () => {
    const f = fixture(); let h = await mount(f); await selectPair(h);
    await h.click('Upload all selected photos'); await h.confirm();
    const originalFiles = clone(f.saved[0].files), card = f.cards.get(f.saved[0].card.id), requestCount = f.requests.length;
    card.revision++; card.title = 'Updated label';
    h = await mount(f, { focusCard: clone(card) });
    assert.equal(f.saved[0].pairConfirmed, true, 'An unchanged photo pair keeps its confirmation');
    card.revision++; card.sides[0].uploadId = randomUUID();
    h = await mount(f, { focusCard: clone(card) });
    assert.equal(f.saved[0].pairConfirmed, false); assert.equal(h.checks()[0].props.disabled, true);
    assert.match(h.text(), /saved photo changed/i); assert.equal(h.button('Add to Waiting to grade').props.disabled, true);
    await h.click('Add to Waiting to grade'); assert.equal(f.requests.length, requestCount);
    for (const side of ['FRONT', 'BACK']) assert.deepEqual(await f.saved[0].files[side].arrayBuffer(), await originalFiles[side].arrayBuffer());
    await h.select(0, photo('front-reselected')); await h.confirm(); await h.click('Add to Waiting to grade');
    assert.equal(f.saved[0].card.state, 'WAITING'); assert.equal(f.puts.length, 3);
});
