import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import * as client from '../lib/workspace-client.mjs';
import * as identity from '../lib/workspace-identification.mjs';
import { parseWorkspaceIntakeRequest } from '../lib/server/access/workspace-intake-validation.mjs';
export const photo = name => new File([`original photograph ${name}`], `${name}.png`, { type: 'image/png', lastModified: 1 });
export const settle = () => new Promise(resolve => setImmediate(resolve));
// Event-loop turns do not bound WebCrypto, Blob reads or uploads. Yield until
// the test's observable state arrives, with a deadline that names the wait.
export async function waitFor(predicate, description, { timeoutMs = 5000 } = {}) {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) {
        assert.ok(performance.now() < deadline, `Timed out waiting for ${description}`);
        await settle();
    }
}
export function clone(value) {
    if (value instanceof File) return new File([value], value.name, { type: value.type, lastModified: value.lastModified });
    if (value instanceof Blob) return value.slice(0, value.size, value.type);
    if (Array.isArray(value)) return Array.from(value, clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}
export function fixture() {
    const f = { saved: [], cards: new Map(), receipts: new Map(), requests: [], puts: [], grants: new Map(), objects: new Map(), failAfter: new Map(), accessCalls: 0 };
    f.access = async () => { f.accessCalls++; return { csrf: 'a'.repeat(64) }; };
    f.prepare = client.prepareIntakePhoto;
    f.describe = client.describePhoto;
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
