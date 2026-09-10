import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canQueue, checkedCardResult, isNotDispatched, makePending, PHOTO_MAX_BYTES, queueCards, replaceIntakePhoto, uploadIntakeEntry, uploadPhoto, validatePhoto } from '../lib/workspace-client.mjs';

const makeCard = () => ({ id: randomUUID(), title: 'Fresh card', revision: 1, state: 'DRAFT', stage: 'PHOTOS', sides: [{ side: 'FRONT', status: 'MISSING' }, { side: 'BACK', status: 'MISSING' }] });
const makeEntry = () => ({ id: randomUUID(), title: 'Card one', identity: { category: 'POKEMON' }, files: { FRONT: { name: 'front.jpg', size: 20, type: 'image/jpeg' }, BACK: { name: 'back.png', size: 24, type: 'image/png' } }, card: null, uploads: {}, pending: null });
function fixture() {
    const f = { saved: makeEntry(), card: null, calls: [], puts: [], replies: new Map(), failures: new Map() };
    f.options = { describe: async file => ({ name: file.name, contentType: file.type, byteCount: file.size, sha256: (file.name === 'front.jpg' ? 'a' : 'b').repeat(64) }),
        persist: async entry => { f.saved = structuredClone(entry); }, put: async (grant, file) => { f.puts.push({ id: grant.id, file: file.name }); if (f.failPut) { f.failPut = false; throw new Error('Interrupted upload'); } },
        request: async (path, { body }) => {
            f.calls.push({ path, body: structuredClone(body) });
            if (f.replies.has(body.operationId)) return structuredClone(f.replies.get(body.operationId));
            if (path === 'workspace/cards') f.card = makeCard();
            else {
                assert.equal(body.expectedRevision, f.card.revision); f.card.revision++;
                if (path.endsWith('/upload-plan')) f.card.sides.find(side => side.side === body.side).status = 'PLANNED';
                if (path.endsWith('/upload-complete')) f.card.sides.find(side => side.uploadId === body.uploadId).status = 'VERIFIED';
            }
            const result = { card: structuredClone(f.card), operationId: body.operationId };
            if (path.endsWith('/upload-plan')) {
                const id = randomUUID(); f.card.sides.find(side => side.side === body.side).uploadId = id; result.card = structuredClone(f.card);
                result.upload = { id, url: 'https://private-storage.example/only-this-object?signature=TRANSIENT', method: 'PUT', headers: { 'Content-Type': body.file.contentType }, expiresAt: '2099-01-01T00:00:00.000Z' };
            }
            f.replies.set(body.operationId, structuredClone(result));
            if (f.failures.has(path)) { const error = f.failures.get(path); f.failures.delete(path); throw error; }
            return result;
        }
    };
    f.run = () => uploadIntakeEntry(f.saved, f.options);
    return f;
}

test('fresh paired photos persist exact create/plan/verify work and never auto-queue or dispatch grading', async () => {
    const f = fixture(); await f.run();
    assert.equal(f.calls.length, 5); assert.equal(f.puts.length, 2); assert.equal(canQueue(f.saved.card), true);
    assert.deepEqual(f.puts.map(value => value.file), ['front.jpg', 'back.png']);
    assert.ok(f.calls.every(call => !/queue|claim|action/.test(call.path)));
    const persisted = JSON.stringify(f.saved); assert.equal(persisted.includes('TRANSIENT'), false); assert.equal(persisted.includes('https://'), false);
    assert.equal(f.saved.pending, null); assert.equal(f.saved.uploads.FRONT.phase, 'VERIFIED');
    const before = f.calls.length; await f.run(); assert.equal(f.calls.length, before, 'Already verified photos do not upload again.');
});

test('lost create reply recovers the exact card request after a reload', async () => {
    const f = fixture(); f.failures.set('workspace/cards', new Error('Reply lost after card creation'));
    await assert.rejects(f.run()); const pending = structuredClone(f.saved.pending), originalCard = f.card.id;
    assert.equal(f.saved.card, null); await f.run();
    assert.equal(f.saved.card.id, originalCard); assert.deepEqual(f.calls[1].body, pending.body);
    assert.equal(new Set(f.calls.filter(call => call.path === 'workspace/cards').map(call => call.body.operationId)).size, 1);
});

test('lost verification reply retries completion without reuploading or replacing the operation', async () => {
    const f = fixture(); let failed = false, request = f.options.request;
    f.options.request = async (path, options) => { if (!failed && path.endsWith('/upload-complete')) { failed = true; f.failures.set(path, new Error('Reply lost after verification')); } return request(path, options); };
    await assert.rejects(f.run()); const pending = structuredClone(f.saved.pending), cardId = f.saved.card.id;
    assert.equal(f.saved.uploads.FRONT.phase, 'COMPLETE'); assert.equal(f.puts.length, 1);
    await f.run(); assert.equal(f.saved.card.id, cardId); assert.equal(f.puts.filter(put => put.file === 'front.jpg').length, 1);
    const completions = f.calls.filter(call => call.body.uploadId === pending.body.uploadId);
    assert.equal(completions.length, 2); assert.deepEqual(completions[1].body, pending.body); assert.equal(canQueue(f.saved.card), true);
});

test('interrupted direct upload reuses the same plan and immutable object, retaining no grant', async () => {
    const f = fixture(); f.failPut = true; await assert.rejects(f.run());
    const plan = structuredClone(f.saved.uploads.FRONT.planBody), objectId = f.saved.uploads.FRONT.uploadId;
    assert.equal(f.saved.pending, null); assert.equal(f.saved.uploads.FRONT.phase, 'UPLOAD'); await f.run();
    const plans = f.calls.filter(call => call.path.endsWith('/upload-plan') && call.body.side === 'FRONT');
    assert.equal(plans.length, 2); assert.deepEqual(plans[1].body, plan);
    assert.equal(f.puts[0].id, objectId); assert.equal(f.puts[1].id, objectId);
});

test('lost plan reply preserves the original plan body for later storage retry', async () => {
    const f = fixture(); let first = true, request = f.options.request;
    f.options.request = async (path, options) => { if (first && path.endsWith('/upload-plan')) { first = false; f.failures.set(path, new Error('Lost plan')); } return request(path, options); };
    await assert.rejects(f.run()); const pending = structuredClone(f.saved.pending); f.failPut = true; await assert.rejects(f.run());
    assert.deepEqual(f.saved.uploads.FRONT.planBody, pending.body); await f.run();
    const plans = f.calls.filter(call => call.path.endsWith('/upload-plan') && call.body.side === 'FRONT');
    assert.equal(plans.length, 3); for (const plan of plans) assert.deepEqual(plan.body, pending.body);
});

test('unknown conflicts remain retained and only proven pre-dispatch denials can unlock', async () => {
    const f = fixture(), unknown = Object.assign(new Error('Conflict'), { status: 409, code: 'WORKSPACE_REVISION_CHANGED' });
    f.options.request = async () => { throw unknown; }; await assert.rejects(f.run()); const original = f.saved.pending;
    assert.ok(original); assert.equal(isNotDispatched(unknown), false);
    f.options.request = async () => { throw { ...unknown, outcome: 'NOT_DISPATCHED' }; }; await assert.rejects(f.run()); assert.equal(f.saved.pending, null);
    assert.equal(isNotDispatched({ code: 'GRADING_OUTCOME_UNCONFIRMED', outcome: 'NOT_DISPATCHED' }), false);
});

test('server receipt identity, operation and revision are required to adopt a mutation', () => {
    const card = makeCard(), pending = makePending(`workspace/cards/${card.id}/claim`, { expectedRevision: card.revision }, card.id), result = { card, operationId: pending.body.operationId };
    assert.equal(checkedCardResult(result, pending), card);
    for (const wrong of [{ ...result, operationId: randomUUID() }, { ...result, card: { ...card, id: randomUUID() } }, { ...result, card: { ...card, revision: 0 } }, { card }]) assert.throws(() => checkedCardResult(wrong, pending));
});

test('photo format and queue readiness fail closed; search never turns filenames into identity', () => {
    assert.equal(validatePhoto({ name: 'new.jpg', type: 'image/jpeg', size: PHOTO_MAX_BYTES }).name, 'new.jpg');
    assert.throws(() => validatePhoto({ name: 'new.heic', type: 'image/heic', size: 200 }));
    assert.throws(() => validatePhoto({ name: 'new.jpg', type: 'image/jpeg', size: PHOTO_MAX_BYTES + 1 }));
    const card = makeCard(); card.sides[0].status = 'VERIFIED'; assert.equal(canQueue(card), false);
    card.sides[1].status = 'VERIFIED'; assert.equal(canQueue(card), true); card.state = 'IN_PROGRESS'; assert.equal(canQueue(card), false);
    assert.deepEqual(queueCards([card], 'IN_PROGRESS', 'fresh'), [card]); assert.equal(queueCards([card], 'WAITING').length, 0);
});

test('direct PUT is bounded, carries no staff credentials and never marks provider success as verification', async () => {
    const calls = [], progress = [], grant = { id: randomUUID(), method: 'PUT', url: 'https://images.example/exact?signature=private', expiresAt: '2099-01-01', headers: { 'Content-Type': 'image/jpeg' } };
    const xhr = { upload: {}, open: (...args) => calls.push(args), setRequestHeader: (...args) => calls.push(args), send() { this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 }); this.status = 200; this.onload(); } };
    await uploadPhoto(grant, {}, { xhrFactory: () => xhr, onProgress: value => progress.push(value) });
    assert.equal(xhr.withCredentials, false); assert.equal(xhr.timeout, 180_000); assert.deepEqual(progress, [50, 100]);
    assert.equal(calls[0][0], 'PUT'); assert.ok(calls.every(call => !call.includes('X-Atlas-Csrf')));
    assert.throws(() => uploadPhoto({ ...grant, expiresAt: '2000-01-01' }, {}, { xhrFactory: () => xhr }));
});

test('create-only PUT replay reaches exact server verification and cannot mark mismatched stored bytes verified', async () => {
    const f = fixture();
    f.options.put = (grant, file) => uploadPhoto(grant, file, { xhrFactory: () => ({ upload: {}, open() {}, setRequestHeader() {}, send() { this.status = 412; this.onload(); } }) });
    const request = f.options.request;
    f.options.request = async (path, options) => {
        if (path.endsWith('/upload-complete')) throw Object.assign(new Error('Stored bytes differ'), { code: 'WORKSPACE_UPLOAD_UNVERIFIED' });
        return request(path, options);
    };
    await assert.rejects(f.run(), /Stored bytes differ/);
    assert.equal(f.saved.uploads.FRONT.phase, 'COMPLETE'); assert.equal(f.saved.card.sides[0].status, 'PLANNED');
    const pending = structuredClone(f.saved.pending);
    f.options.request = request; await f.run();
    assert.deepEqual(f.calls.find(call => call.path.endsWith('/upload-complete')).body, pending.body);
    assert.equal(f.saved.uploads.FRONT.phase, 'VERIFIED');
});

test('only an exact retained rejection unlocks explicit replacement; malformed or reordered receipts remain pending', async () => {
    for (const change of [value => { value.uploadResult.uploadId = randomUUID(); }, value => { value.uploadResult.cardId = randomUUID(); },
        value => { value.uploadResult.side = 'BACK'; }, value => { value.uploadResult.revision--; },
        value => { value.uploadResult.extra = true; }, value => { value.uploadResult.reason = 'TIMEOUT'; },
        value => { value.card.sides[0].rejection.operationId = randomUUID(); }, value => { value.card.sides[0].uploadId = randomUUID(); },
        value => { delete value.card.sides[0].rejection; }]) {
        const f = fixture(), request = f.options.request;
        f.options.request = async (path, options) => {
            const result = await request(path, options);
            if (path.endsWith('/upload-complete')) {
                result.card.sides[0].status = 'REJECTED';
                result.card.sides[0].rejection = { operationId: options.body.operationId, revision: options.body.expectedRevision + 1, reason: 'BYTES_MISMATCH' };
                result.uploadResult = { state: 'REJECTED', cardId: result.card.id, uploadId: options.body.uploadId,
                    side: 'FRONT', reason: 'BYTES_MISMATCH', revision: options.body.expectedRevision + 1 };
                change(result);
            }
            return result;
        };
        await assert.rejects(f.run(), /could not be matched/);
        assert.equal(f.saved.uploads.FRONT.phase, 'COMPLETE'); assert.ok(f.saved.pending);
        assert.throws(() => replaceIntakePhoto(f.saved, 'FRONT', f.saved.files.FRONT), /Recover the saved request/);
    }
});
