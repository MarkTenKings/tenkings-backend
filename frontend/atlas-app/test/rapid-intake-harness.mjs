import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as client from '../lib/workspace-client.mjs';
import * as rapid from '../lib/rapid-intake.mjs';
import * as identity from '../lib/workspace-identification.mjs';
import { parseWorkspaceIntakeRequest } from '../lib/server/access/workspace-intake-validation.mjs';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/PhotoIntake.jsx', import.meta.url), 'utf8'), { filename: 'PhotoIntake.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code;
export const photo = name => new File([`original photograph ${name}`], `${name}.png`, { type: 'image/png', lastModified: 1 });
export const settle = () => new Promise(resolve => setImmediate(resolve));
export function clone(value) {
    if (value instanceof File) return new File([value], value.name, { type: value.type, lastModified: value.lastModified });
    if (value instanceof Blob) return value.slice(0, value.size, value.type);
    if (Array.isArray(value)) return Array.from(value, clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}
export const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
export function all(tree, predicate, found = []) {
    if (Array.isArray(tree)) tree.forEach(node => all(node, predicate, found));
    else if (tree && typeof tree === 'object') { if (predicate(tree)) found.push(tree); all(tree.props?.children, predicate, found); }
    return found;
}
function hooks() {
    const slots = [], effects = [], cleanup = []; let cursor = 0;
    return { react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
        useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useEffect(action, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((value, j) => !Object.is(value, prior[j]))) { slots[i] = deps; effects.push(() => { cleanup[i]?.(); cleanup[i] = action(); }); } }
    }, render(action) { cursor = 0; const tree = action(); effects.splice(0).forEach(action => action()); return tree; }, close() { cleanup.forEach(action => action?.()); } };
}
export function fixture() {
    const f = { saved: [], cards: new Map(), receipts: new Map(), requests: [], puts: [], grants: new Map(), objects: new Map(), failAfter: new Map(), accessCalls: 0 };
    f.access = async () => { f.accessCalls++; return { csrf: 'a'.repeat(64) }; };
    f.prepare = client.prepareIntakePhoto;
    f.write = async entries => { if (f.failWrite) { f.failWrite = false; throw new Error('Quota exceeded'); } f.saved = clone(entries); };
    f.request = async (path, { body }) => {
        const action = path === 'workspace/cards' ? 'create' : path.split('/').at(-1);
        if (!['identify', 'identity'].includes(action)) parseWorkspaceIntakeRequest(action, clone(body));
        const retained = f.saved.find(entry => entry.pending?.body.operationId === body.operationId)?.pending;
        assert.equal(retained?.path, path, 'Persist the exact request before network'); assert.deepEqual(retained.body, body);
        f.requests.push({ path, body: clone(body) });
        const prior = f.receipts.get(body.operationId);
        if (prior) { assert.deepEqual(prior.body, body); return { ...clone(prior.result), card: clone(f.cards.get(prior.result.card.id)) }; }
        let card;
        if (action === 'create') {
            card = { id: randomUUID(), title: body.title || 'New card', identity: clone(body.identity), revision: 1, state: 'DRAFT', stage: 'PHOTOS', sides: ['FRONT', 'BACK'].map(side => ({ side, status: 'MISSING' })) };
            f.cards.set(card.id, card);
        } else { card = f.cards.get(path.split('/')[2]); assert.equal(card.revision, body.expectedRevision); card.revision++; }
        const result = { card, operationId: body.operationId };
        if (action === 'upload-plan') {
            const id = randomUUID(); f.grants.set(id, clone(body.file));
            Object.assign(card.sides.find(value => value.side === body.side), { status: 'PLANNED', uploadId: id, sha256: body.file.sha256 }); result.upload = { id };
        }
        if (action === 'upload-complete') {
            const side = card.sides.find(value => value.uploadId === body.uploadId);
            assert.deepEqual(f.objects.get(body.uploadId), f.grants.get(body.uploadId), 'Verify original fixture bytes');
            side.status = 'VERIFIED'; side.width = 3024; side.height = 4032;
            if (f.rejectSide === side.side) {
                side.status = 'REJECTED'; side.rejection = { reason: 'BYTES_MISMATCH', operationId: body.operationId, revision: card.revision };
                result.uploadResult = { state: 'REJECTED', cardId: card.id, uploadId: body.uploadId, side: side.side, reason: 'BYTES_MISMATCH', revision: card.revision };
            }
            if (f.malformedVerification) result.operationId = randomUUID();
        }
        if (action === 'identify') {
            if (f.holdIdentity) await new Promise(resolve => { f.releaseIdentity = resolve; });
            const suggestions = Object.fromEntries(identity.IDENTIFICATION_FIELDS.map(field => [field, { value: null, confidence: 'unknown', evidence: null }]));
            for (const [field, value] of Object.entries({ name: 'Charmander', category: 'POKEMON', cardNumber: '007' })) suggestions[field] = { value, confidence: 'high', evidence: 'Printed on the card' };
            if (f.unknownIdentity) suggestions.category = { value: null, confidence: 'unknown', evidence: null };
            const pairHash = createHash('sha256').update(identity.workspaceIdentificationPairKey(body.photos)).digest('hex');
            const adoption = identity.adoptWorkspaceIdentitySuggestions({ identity: card.identity, suggestions, editedFields: f.humanFields ?? [], requestIdentity: card.identity, currentPair: body.photos, requestPair: body.photos });
            card.identity = adoption.identity; card.identityReview = { status: adoption.status };
            result.identification = { status: 'SUCCEEDED', photos: body.photos, pairHash, suggestions, warnings: [], provenance: { version: identity.IDENTIFICATION_VERSION, model: 'gpt-6-astra', reasoningEffort: 'low', maxOutputTokens: 2400, authority: 'MACHINE', elapsedMs: 8123 } };
            if (f.wrongIdentityPair) result.identification.photos = { ...body.photos, FRONT: { ...body.photos.FRONT, sha256: 'd'.repeat(64) } };
        }
        if (action === 'identity') { card.identity = clone(body.identity); f.humanFields = body.editedFields; card.identityReview = { status: body.identity.category ? 'READY' : 'UNKNOWN' }; }
        if (action === 'queue') {
            assert.equal(body.pairConfirmed, true); assert.ok(card.sides.every(side => side.status === 'VERIFIED'));
            if (f.duplicate) result.queueResult = clone(f.duplicate); else card.state = 'WAITING';
        }
        f.receipts.set(body.operationId, { body: clone(body), result: clone(result) });
        if (f.failAfter.has(action)) { const error = f.failAfter.get(action); f.failAfter.delete(action); throw error; }
        return clone(result);
    };
    f.put = async (grant, file) => { f.puts.push({ id: grant.id, name: file.name }); f.objects.set(grant.id, await client.describePhoto(file)); };
    return f;
}
export async function mount(f, props = {}) {
    const react = hooks(), exported = {}, listeners = new Map(); let tree;
    const window = { addEventListener: (name, action) => listeners.set(name, action), removeEventListener: name => listeners.delete(name) };
    vm.runInNewContext(code, { exports: exported, structuredClone: clone, AbortController, Date, window, setTimeout, clearTimeout, setInterval, clearInterval, require(module) {
        if (module === 'react') return react.react;
        if (module === 'next/link') return 'link';
        if (module === './Shell') return { Notice: 'notice' };
        if (module === './RapidCardCamera') return 'RapidCardCamera';
        if (module === './WorkspaceShared') return { PhotoPreview: 'PhotoPreview', OriginalHeicDownload: 'OriginalHeicDownload', Readiness: 'Readiness', StateBadge: 'StateBadge' };
        if (module === '../lib/workspace-drafts.mjs') return { createPhotoDraftStore: () => ({ read: async () => clone(f.saved), write: entries => f.write(entries) }) };
        if (module === '../lib/workspace-client.mjs') return { ...client, workspaceRequest: f.request, freshWorkspaceAccess: () => f.access(), prepareIntakePhoto: (...args) => f.prepare(...args) };
        if (module === '../lib/rapid-intake.mjs') return { ...rapid, uploadRapidIntakeEntry: (entry, options) => rapid.uploadRapidIntakeEntry(entry, { ...options, put: f.put }) };
        if (module === '../lib/workspace-identification.mjs') return identity;
        if (module === '../lib/routes.mjs') return { STAFF_REAUTHENTICATE_PATH: '/admin?reauthenticate=1' };
        if (module === '../lib/usePendingNavigation') return { usePendingNavigation() {} };
        if (module.endsWith('.module.css')) return {};
        return nextRequire(module.startsWith('@babel/runtime/') ? `next/dist/compiled/${module}` : module);
    } });
    const h = { render() { tree = react.render(() => exported.default({ staff: { id: 'fixture-reviewer', role: 'REVIEWER' }, ...props })); }, close() { react.close(); },
        nodes: predicate => all(tree, predicate), text: () => text(tree),
        button(label, index = 0) { const value = all(tree, node => node.type === 'button' && text(node).includes(label))[index]; assert.ok(value, label); return value; },
        files: () => all(tree, node => node.type === 'input' && node.props.type === 'file'),
        async flush(rounds = 8) { for (let i = 0; i < rounds; i++) { await settle(); h.render(); } },
        async select(index, file) { h.files()[index].props.onChange({ target: { files: [file], value: 'selected' } }); await h.flush(); },
        async click(label, index) { await h.button(label, index).props.onClick(); await h.flush(); },
        async change(label, value, index = 0) { const labels = all(tree, node => node.type === 'label' && text(node).startsWith(label)); const input = all(labels[index], node => ['input', 'select'].includes(node.type))[0]; assert.ok(input, label); await input.props.onChange({ target: { value } }); await h.flush(); },
        async event(name) { listeners.get(name)?.(); await h.flush(); }
    };
    h.render(); await h.flush(); return h;
}
