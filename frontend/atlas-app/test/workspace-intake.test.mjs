import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { hash, deny } from '../lib/server/policy.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { StaffWorkspaceIntake } from '../lib/server/access/workspace-intake.mjs';
import { parseWorkspaceIntakeRequest } from '../lib/server/access/workspace-intake-validation.mjs';
import { readWorkspacePhotoBytes, workspacePhotoVerifier } from '../lib/server/access/workspace-intake-storage.mjs';

const clone = value => structuredClone(value);
const operationId = () => randomUUID();
const NOW = new Date('2026-09-10T04:00:00Z');
const sourceBinding = ({ cardId, creatorId }) => ({ sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` });
function fixture(overrides = {}) {
    const f = { now: new Date(NOW), policy: { cohortId: 'fresh-photo-pilot-retained', maxCards: 10,
        expiresAt: new Date('2026-09-16T20:41:57Z'), intakeEnabled: true, claimsEnabled: true, astraEnabled: true, processingLimit: 1 },
        state: { cards: new Map(), operations: new Map(), operationIds: new Map() }, objects: new Map(), inTransaction: false,
        calls: { grant: 0, verify: 0, read: 0, record: 0, pair: 0, claim: 0 }, pending: Promise.resolve() };
    f.staff = Object.freeze({ marker: 'authenticated reviewer' });
    f.otherStaff = Object.freeze({ marker: 'another authenticated reviewer' });
    f.observer = Object.freeze({ marker: 'authenticated observer' });
    f.identities = new Map([[f.staff, { id: randomUUID(), name: 'Example Grader', role: 'REVIEWER', accessVersion: 1 }],
        [f.otherStaff, { id: randomUUID(), name: 'Second Grader', role: 'REVIEWER', accessVersion: 1 }],
        [f.observer, { id: randomUUID(), name: 'Observer', role: 'OBSERVER', accessVersion: 1 }]]);
    f.store = { async transaction(staff, work) {
        const earlier = f.pending;
        let release;
        f.pending = new Promise(resolve => { release = resolve; });
        await earlier;
        try {
            const identity = f.identities.get(staff);
            if (!identity) deny(401, 'SIGN_IN_REQUIRED');
            f.inTransaction = true;
            const state = clone(f.state), tx = {
                async getCard(id) { return clone(state.cards.get(id) ?? null); },
                async listCards(cohortId) { return clone([...state.cards.values()].filter(card => card.cohortId === cohortId)); },
                async insertCard(card) { assert(!state.cards.has(card.id)); state.cards.set(card.id, clone(card)); },
                async updateCard(card, expectedRevision) {
                    if (state.cards.get(card.id)?.revision !== expectedRevision) deny(409, 'WORKSPACE_REVISION_CHANGED');
                    assert.equal(card.revision, expectedRevision + 1); state.cards.set(card.id, clone(card));
                },
                async getOperation(actorId, id) { return clone(state.operations.get(`${actorId}/${id}`) ?? null); },
                async getOperationById(id) { return clone(state.operationIds.get(id) ?? null); },
                async insertOperation(row) {
                    const key = `${row.actorId}/${row.operationId}`;
                    assert(!state.operations.has(key)); assert(!state.operationIds.has(row.id)); assert(state.cards.has(row.cardId));
                    state.operations.set(key, clone(row)); state.operationIds.set(row.id, clone(row));
                },
            };
            const result = await work({ identity, control: { revision: 1 }, now: new Date(f.now), policy: clone(f.policy), tx, databaseTx: {} });
            f.state = state;
            return result;
        } finally { f.inTransaction = false; release(); }
    } };
    f.source = { reserve: sourceBinding,
        async captureReadiness() { assert(f.inTransaction); return f.admission ?? { ready: true, code: null }; },
        async recordVerifiedUpload() { assert(f.inTransaction); f.calls.record++; },
        async confirmPair() { assert(f.inTransaction); f.calls.pair++; },
        async assertClaimable(context, value) { assert(f.inTransaction); f.calls.claim++; f.lastClaim = clone(value); return null; },
    };
    f.storage = {
        async grant({ upload }) {
            assert(!f.inTransaction); f.calls.grant++;
            if (f.grantFailure) throw new Error('storage grant response unavailable');
            return { id: upload.id, url: `https://storage.example.invalid/object?signature=${f.calls.grant}`,
                method: 'PUT', headers: { 'Content-Type': upload.contentType, 'x-amz-checksum-sha256': Buffer.from(upload.sha256, 'hex').toString('base64') },
                expiresAt: new Date(+f.now + 60_000).toISOString() };
        },
        async verify({ upload }) {
            assert(!f.inTransaction); f.calls.verify++;
            if (f.verifyFailure) throw new Error('storage read response unavailable');
            if (f.verifyWait) await f.verifyWait;
            const bytes = f.objects.get(upload.objectRef);
            if (!bytes) deny(409, 'WORKSPACE_UPLOAD_UNVERIFIED');
            return { objectRef: upload.objectRef, byteCount: bytes.length, sha256: hash(bytes), contentType: upload.contentType,
                width: 800, height: 1100, ...(f.verificationChange ?? {}) };
        },
        async read({ upload }) {
            assert(!f.inTransaction); f.calls.read++;
            if (f.readWait) await f.readWait;
            return Buffer.from(f.objects.get(upload.objectRef));
        },
    };
    Object.assign(f.policy, overrides);
    f.service = new StaffWorkspaceIntake({ store: f.store, source: f.source, storage: f.storage });
    f.restart = () => { f.service = new StaffWorkspaceIntake({ store: f.store, source: f.source, storage: f.storage }); };
    f.create = async (title = 'New physical card') => f.service.create(f.staff, { operationId: operationId(), title, identity: {} });
    f.plan = async (card, side, body = `${card.id}/${side}/new photo bytes`) => {
        const bytes = Buffer.from(body), input = { operationId: operationId(), expectedRevision: card.revision, side,
            file: { name: `${side.toLowerCase()}.png`, contentType: 'image/png', byteCount: bytes.length, sha256: hash(bytes) } };
        const result = await f.service.planUpload(f.staff, card.id, input);
        const upload = f.state.operationIds.get(result.upload.id).result.upload;
        f.objects.set(upload.objectRef, bytes);
        return { ...result, input, upload, bytes };
    };
    f.complete = (card, upload) => f.service.completeUpload(f.staff, card.id, { operationId: operationId(), expectedRevision: card.revision, uploadId: upload.id });
    f.photos = async (original, contents = {}) => {
        let card = original ?? (await f.create()).card;
        for (const side of ['FRONT', 'BACK']) { const planned = await f.plan(card, side, contents[side]); card = (await f.complete(planned.card, planned.upload)).card; }
        return card;
    };
    f.ready = async () => { const card = await f.photos(); return (await f.service.queue(f.staff, card.id,
        { operationId: operationId(), expectedRevision: card.revision, pairConfirmed: true })).card; };
    return f;
}

test('draft creation accepts incomplete identity and retains one exact card across restart and later edits', async () => {
    const f = fixture(), input = { operationId: operationId(), title: ' Card 1 ', identity: { category: 'POKEMON' } };
    const first = await f.service.create(f.staff, input);
    assert.equal(first.operationId, input.operationId); assert.equal(first.card.title, 'Card 1');
    assert.equal(first.card.state, 'DRAFT'); assert.equal(first.card.specimenId, null);
    assert.deepEqual(first.card.sides.map(side => side.status), ['MISSING', 'MISSING']);
    const original = f.state.cards.get(first.card.id);
    assert.deepEqual(original.source, sourceBinding({ cardId: first.card.id, creatorId: f.identities.get(f.staff).id }));
    const afterUpload = await f.plan(first.card, 'FRONT'); f.restart();
    const replay = await f.service.create(f.staff, input);
    assert.equal(replay.card.id, first.card.id); assert.equal(replay.card.revision, afterUpload.card.revision);
    assert.equal(f.state.cards.size, 1); assert.equal(f.calls.claim, 0); assert.equal(f.calls.pair, 0);
    await assert.rejects(f.service.create(f.staff, { ...input, title: 'Different card' }), /WORKSPACE_REQUEST_CONFLICT/);
    assert(!JSON.stringify(replay).includes('sourceOwnerId'));
});

test('strict named DTOs reject authority, opaque source selectors, unsafe files and cross-category identity', () => {
    const create = { operationId: operationId(), title: '', identity: {} };
    assert.deepEqual(parseWorkspaceIntakeRequest('create', create), create);
    for (const extra of [{ sourceId: 'previous-card' }, { sourceOwnerId: 'owner' }, { authorized: true }, { actorId: randomUUID() }, { grade: 10 }])
        assert.throws(() => parseWorkspaceIntakeRequest('create', { ...create, ...extra }), /WORKSPACE_REQUEST_INVALID/);
    for (const identity of [{ category: 'POKEMON', playerName: 'Player' }, { category: 'SPORTS', cardName: 'Pokémon' },
        { category: 'POKEMON', manufacturer: '' }, { layoutType: 'POKEMON' }, { category: 'POKEMON', layoutType: 'FAKE' },
        { cardName: 'no category' }, { category: 'OTHER' }, { sourceRef: 'hidden' }])
        assert.throws(() => parseWorkspaceIntakeRequest('create', { ...create, identity }), /WORKSPACE_REQUEST_INVALID/);
    const plan = { operationId: operationId(), expectedRevision: 1, side: 'FRONT',
        file: { name: 'card.png', contentType: 'image/png', byteCount: 500, sha256: 'a'.repeat(64) } };
    for (const file of [{ ...plan.file, contentType: 'image/svg+xml' }, { ...plan.file, name: '../card.png' },
        { ...plan.file, name: 'folder\\card.png' }, { ...plan.file, byteCount: 0 }, { ...plan.file, byteCount: 50 * 1024 * 1024 + 1 },
        { ...plan.file, sha256: 'A'.repeat(64) }, { ...plan.file, objectRef: 'elsewhere' }, { ...plan.file, width: 800 }])
        assert.throws(() => parseWorkspaceIntakeRequest('upload-plan', { ...plan, file }), /WORKSPACE_REQUEST_INVALID/);
    for (const patch of [{ expectedRevision: 0 }, { expectedRevision: 1.2 }, { side: 'BOTH' }, { operationId: 'short' }])
        assert.throws(() => parseWorkspaceIntakeRequest('upload-plan', { ...plan, ...patch }), /WORKSPACE_REQUEST_INVALID/);
    assert.throws(() => parseWorkspaceIntakeRequest('claim', { operationId: operationId(), expectedRevision: 1, operator: 'HUMAN', mode: 'STEP' }));
    assert.throws(() => parseWorkspaceIntakeRequest('queue', { operationId: operationId(), expectedRevision: 1, pairConfirmed: false }), /WORKSPACE_PAIR_REQUIRED/);
});

test('ten cards can be entered before processing while concurrent eleventh admission is refused without paid work', async () => {
    const f = fixture(), attempts = await Promise.allSettled(Array.from({ length: 11 }, (_, index) => f.create(`Card ${index + 1}`)));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 10);
    assert.equal(attempts.filter(result => result.status === 'rejected')[0].reason.code, 'WORKSPACE_PILOT_FULL');
    assert.equal(f.state.cards.size, 10); assert.deepEqual(f.calls, { grant: 0, verify: 0, read: 0, record: 0, pair: 0, claim: 0 });
    assert.equal((await f.service.list(f.staff)).cards.length, 10);
});

test('upload grants are transient and replay refreshes only the retained exact original object', async () => {
    const f = fixture(), { card } = await f.create(), bytes = Buffer.from('fresh front'), input = {
        operationId: operationId(), expectedRevision: card.revision, side: 'FRONT',
        file: { name: 'front.png', contentType: 'image/png', byteCount: bytes.length, sha256: hash(bytes) } };
    f.grantFailure = true;
    await assert.rejects(f.service.planUpload(f.staff, card.id, input), /storage grant response unavailable/);
    const saved = f.state.cards.get(card.id), savedUploadId = saved.sides.FRONT.uploadId;
    assert.equal(saved.revision, 2); assert.equal(saved.sides.FRONT.verificationId, null);
    assert.equal(f.state.operations.size, 2);
    f.grantFailure = false; f.restart();
    const first = await f.service.planUpload(f.staff, card.id, input);
    const second = await f.service.planUpload(f.staff, card.id, input);
    assert.equal(first.upload.id, savedUploadId); assert.equal(second.upload.id, savedUploadId);
    assert.notEqual(first.upload.url, second.upload.url); assert.equal(second.card.revision, 2);
    const persisted = JSON.stringify([...f.state.operationIds.values()]);
    assert(!persisted.includes('signature=')); assert(!persisted.includes('storage.example.invalid')); assert(!persisted.includes('headers'));
    assert.match(f.state.operationIds.get(savedUploadId).result.upload.objectRef,
        /^ai-grader-v2\/atlas-staff-[a-f0-9-]+\/atlas-[a-f0-9-]+\/original\/recapture-[a-f0-9-]+\/front\.png$/);
    assert.equal(f.calls.verify, 0); assert.equal(f.calls.claim, 0);
});

test('unverified and same-byte Front/Back photos cannot queue; correct paired photos can wait without source admission', async () => {
    const f = fixture(), { card } = await f.create();
    await assert.rejects(f.service.queue(f.staff, card.id, { operationId: operationId(), expectedRevision: card.revision, pairConfirmed: true }), /WORKSPACE_PHOTOS_REQUIRED/);
    const front = await f.plan(card, 'FRONT');
    assert.equal(front.card.sides[0].status, 'PLANNED');
    await assert.rejects(f.service.queue(f.staff, card.id, { operationId: operationId(), expectedRevision: front.card.revision, pairConfirmed: true }), /WORKSPACE_PHOTOS_REQUIRED/);
    const current = (await f.complete(front.card, front.upload)).card;
    assert.match(current.sides[0].imageUrl, new RegExp(`/admin/api/staff/workspace/cards/${card.id}/evidence/FRONT$`));
    const back = await f.plan(current, 'BACK', front.bytes);
    const identical = (await f.complete(back.card, back.upload)).card;
    await assert.rejects(f.service.queue(f.staff, card.id, { operationId: operationId(), expectedRevision: identical.revision, pairConfirmed: true }), /WORKSPACE_PAIR_REQUIRED/);
    const replaced = await f.plan(identical, 'BACK', 'new actual back photograph');
    const verified = (await f.complete(replaced.card, replaced.upload)).card;
    const result = await f.service.queue(f.staff, card.id, { operationId: operationId(), expectedRevision: verified.revision, pairConfirmed: true });
    assert.equal(result.card.state, 'WAITING'); assert.equal(result.card.specimenId, null); assert.equal(result.card.pairConfirmed, true);
    assert.equal(f.calls.claim, 0); assert.equal(f.calls.pair, 1);
    const old = f.state.operationIds.get(back.upload.id);
    assert.equal(old.result.upload.sha256, hash(front.bytes)); assert(f.state.operationIds.has(front.upload.id));
});

test('completion verifies exact object, size, MIME and SHA and retains unknown reads for same-operation recovery', async () => {
    for (const change of [{ objectRef: 'other-key' }, { byteCount: 9999 }, { contentType: 'image/jpeg' },
        { sha256: 'b'.repeat(64) }, { width: 0 }, { width: 1 }, { height: 1.5 }, { width: 16385 },
        { height: 16385 }, { width: 16384, height: 16384 }, { versionId: '' }]) {
        const f = fixture(), planned = await f.plan((await f.create()).card, 'FRONT'); f.verificationChange = change;
        await assert.rejects(f.complete(planned.card, planned.upload), /WORKSPACE_UPLOAD_UNVERIFIED/);
        assert.equal(f.state.cards.get(planned.card.id).revision, planned.card.revision);
        assert.equal(f.state.cards.get(planned.card.id).sides.FRONT.verificationId, null); assert.equal(f.calls.record, 0);
    }
    const f = fixture(), planned = await f.plan((await f.create()).card, 'FRONT'), input = {
        operationId: operationId(), expectedRevision: planned.card.revision, uploadId: planned.upload.id };
    f.verifyFailure = true;
    await assert.rejects(f.service.completeUpload(f.staff, planned.card.id, input), /storage read response unavailable/);
    assert.equal(f.state.cards.get(planned.card.id).sides.FRONT.verificationId, null);
    f.verifyFailure = false;
    const completed = await f.service.completeUpload(f.staff, planned.card.id, input);
    assert.equal(completed.card.sides[0].status, 'VERIFIED'); f.restart();
    const replay = await f.service.completeUpload(f.staff, planned.card.id, input);
    assert.equal(replay.operationId, input.operationId); assert.equal(replay.card.revision, completed.card.revision);
    assert.equal(f.calls.verify, 2); assert.equal(f.calls.record, 1);
});

test('Front and Back plans stay independent and superseded upload completion cannot overwrite the selected side', async () => {
    const f = fixture(), original = await f.plan((await f.create()).card, 'FRONT'), back = await f.plan(original.card, 'BACK');
    const replacement = await f.plan(back.card, 'FRONT', 'replacement front photograph');
    await assert.rejects(f.complete(replacement.card, original.upload), /WORKSPACE_UPLOAD_SUPERSEDED/);
    await assert.rejects(f.service.planUpload(f.staff, original.card.id, original.input), /WORKSPACE_UPLOAD_SUPERSEDED/);
    const saved = f.state.cards.get(original.card.id);
    assert.equal(saved.sides.FRONT.uploadId, replacement.upload.id); assert.equal(saved.sides.BACK.uploadId, back.upload.id);
    assert.equal(f.state.operationIds.get(original.upload.id).result.upload.objectRef, original.upload.objectRef);
    const completedBack = await f.complete(replacement.card, back.upload);
    assert.equal(completedBack.card.sides[1].status, 'VERIFIED'); assert.equal(completedBack.card.sides[0].status, 'PLANNED');
});

test('rejected completion keeps immutable receipt through replay, later side revisions and explicit replacement', async () => {
    const f = fixture(), front = await f.plan((await f.create()).card, 'FRONT');
    const input = { operationId: operationId(), expectedRevision: front.card.revision, uploadId: front.upload.id };
    const verifier = f.storage.verify; let rejectionReads = 0;
    f.storage.verify = async ({ upload }) => { rejectionReads++; return { state: 'REJECTED', cardId: upload.cardId, uploadId: upload.id, reason: 'BYTES_MISMATCH' }; };
    const rejected = await f.service.completeUpload(f.staff, front.card.id, input);
    assert.equal(rejected.card.state, 'DRAFT'); assert.equal(rejected.card.sides[0].status, 'REJECTED');
    assert.equal(rejected.card.sides[0].imageUrl, null); assert.equal(f.calls.record, 0);
    const pointer = clone(f.state.cards.get(front.card.id).sides.FRONT), receipt = clone(f.state.operationIds.get(pointer.rejectionId));
    assert.equal(pointer.verificationId, null); assert.equal(receipt.operationId, input.operationId);
    assert.equal(receipt.result.outcome, 'REJECTED');
    await assert.rejects(f.service.queue(f.staff, front.card.id, { operationId: operationId(), expectedRevision: rejected.card.revision, pairConfirmed: true }), /WORKSPACE_PHOTOS_REQUIRED/);
    f.storage.verify = verifier;
    const back = await f.plan(rejected.card, 'BACK'), paired = await f.complete(back.card, back.upload);
    f.restart();
    const replay = await f.service.completeUpload(f.staff, front.card.id, input);
    assert.deepEqual(replay.uploadResult, rejected.uploadResult); assert.equal(replay.card.revision, paired.card.revision);
    assert.equal(rejectionReads, 1); assert.equal(replay.operationId, input.operationId);
    const replacement = await f.plan(replay.card, 'FRONT', 'a new selected original');
    const complete = await f.complete(replacement.card, replacement.upload);
    assert.equal(complete.card.id, front.card.id); assert.equal(f.state.cards.size, 1);
    assert.notEqual(replacement.upload.objectRef, front.upload.objectRef);
    assert.equal(complete.card.sides[1].uploadId, back.upload.id); assert.equal(complete.card.sides[1].status, 'VERIFIED');
    const late = await f.service.completeUpload(f.staff, front.card.id, input);
    assert.deepEqual(late.uploadResult, rejected.uploadResult); assert.equal(late.card.sides[0].uploadId, replacement.upload.id);
    assert.deepEqual(f.state.operationIds.get(pointer.rejectionId), receipt);
    assert.deepEqual(f.state.operationIds.get(front.upload.id).result.upload, front.upload);
    assert.equal(f.calls.claim, 0);
});

test('malformed, stale or unauthorized verifier rejections cannot settle the browser request or change evidence', async () => {
    for (const change of [value => ({ ...value, cardId: randomUUID() }), value => ({ ...value, uploadId: randomUUID() }),
        value => ({ ...value, reason: 'TIMEOUT' }), value => ({ ...value, extra: true })]) {
        const f = fixture(), plan = await f.plan((await f.create()).card, 'FRONT'), count = f.state.operations.size;
        f.storage.verify = async ({ upload }) => change({ state: 'REJECTED', cardId: upload.cardId, uploadId: upload.id, reason: 'BYTES_MISMATCH' });
        await assert.rejects(f.complete(plan.card, plan.upload), /WORKSPACE_UPLOAD_UNVERIFIED/);
        assert.equal(f.state.operations.size, count); assert.equal(f.state.cards.get(plan.card.id).sides.FRONT.rejectionId, undefined);
    }
    for (const revoke of [false, true]) {
        const f = fixture(), plan = await f.plan((await f.create()).card, 'FRONT');
        f.storage.verify = async ({ upload }) => {
            if (revoke) f.identities.delete(f.staff);
            else await f.plan(plan.card, 'BACK');
            return { state: 'REJECTED', cardId: upload.cardId, uploadId: upload.id, reason: 'INVALID_IMAGE' };
        };
        await assert.rejects(f.complete(plan.card, plan.upload), revoke ? /SIGN_IN_REQUIRED/ : /WORKSPACE_REVISION_CHANGED/);
        assert.equal(f.state.cards.get(plan.card.id).sides.FRONT.rejectionId, undefined);
        assert.equal([...f.state.operations.values()].some(row => row.result.outcome === 'REJECTED'), false);
    }
});

test('verified originals and expired pilot plans never receive a fresh overwrite grant', async () => {
    const f = fixture(), plan = await f.plan((await f.create()).card, 'FRONT');
    await f.complete(plan.card, plan.upload);
    await assert.rejects(f.service.planUpload(f.staff, plan.card.id, plan.input), /WORKSPACE_UPLOAD_ALREADY_VERIFIED/);
    assert.equal(f.calls.grant, 1);
    const second = await f.plan((await f.create()).card, 'BACK');
    f.now = new Date('2026-09-17T00:00:00Z');
    await assert.rejects(f.service.planUpload(f.staff, second.card.id, second.input), /WORKSPACE_CAPABILITY_UNAVAILABLE/);
    assert.equal(f.calls.grant, 2);
    assert.equal(f.state.cards.get(second.card.id).sides.BACK.uploadId, second.upload.id);
});

test('replacement invalidates the unclaimed exact pair while active claims keep all original evidence', async () => {
    const f = fixture(), first = await f.ready(), saved = f.state.cards.get(first.id);
    const oldCapture = saved.captureHash, oldFront = saved.sides.FRONT.uploadId;
    await f.store.transaction(f.staff, async ({ tx }) => {
        await tx.updateCard({ ...saved, state: 'NEEDS_ATTENTION', revision: saved.revision + 1 }, saved.revision);
    });
    const needingPhotos = (await f.service.read(f.staff, first.id)).card;
    const replaced = await f.plan(needingPhotos, 'FRONT', 'new replacement photograph');
    const current = f.state.cards.get(first.id);
    assert.equal(current.state, 'DRAFT'); assert.equal(current.captureHash, null); assert.equal(current.pairConfirmedAt, null);
    assert.equal(current.captureRevision, saved.captureRevision); assert.equal(current.claim, null);
    assert(f.state.operationIds.has(oldFront));
    assert([...f.state.operationIds.values()].some(row => row.action === 'queue' && row.result.captureHash === oldCapture));
    const verified = (await f.complete(replaced.card, replaced.upload)).card;
    const queued = await f.service.queue(f.staff, first.id, { operationId: operationId(), expectedRevision: verified.revision, pairConfirmed: true });
    assert.equal(f.state.cards.get(first.id).captureRevision, saved.captureRevision + 1);
    assert.notEqual(f.state.cards.get(first.id).captureHash, oldCapture);
    const claim = await f.service.claim(f.staff, first.id, { operationId: operationId(), expectedRevision: queued.card.revision, operator: 'HUMAN' });
    const before = canonical(f.state.cards.get(first.id));
    await assert.rejects(f.plan(claim.card, 'FRONT', 'not permitted while owned'), /WORKSPACE_CLAIM_CONFLICT/);
    assert.equal(canonical(f.state.cards.get(first.id)), before);
});

test('late verification reauthenticates and rechecks the selected side before persisting bytes', async () => {
    const f = fixture(), first = await f.plan((await f.create()).card, 'FRONT');
    let release;
    f.verifyWait = new Promise(resolve => { release = resolve; });
    const completing = f.complete(first.card, first.upload);
    while (f.calls.verify === 0) await new Promise(resolve => setImmediate(resolve));
    const replacement = await f.plan(first.card, 'FRONT', 'newest front');
    release(); await assert.rejects(completing, /WORKSPACE_REVISION_CHANGED/);
    assert.equal(f.state.cards.get(first.card.id).sides.FRONT.uploadId, replacement.upload.id); assert.equal(f.calls.record, 0);
});

test('cohort duplicate originals cannot be admitted as another fresh physical-card pair', async () => {
    const f = fixture(), first = await f.photos(undefined, { FRONT: 'same camera image', BACK: 'original back image' });
    await f.service.queue(f.staff, first.id, { operationId: operationId(), expectedRevision: first.revision, pairConfirmed: true });
    const second = await f.photos(undefined, { FRONT: 'same camera image', BACK: 'a different back' });
    await assert.rejects(f.service.queue(f.staff, second.id, { operationId: operationId(), expectedRevision: second.revision, pairConfirmed: true }), /WORKSPACE_PHOTO_ALREADY_USED/);
    assert.equal(f.state.cards.get(second.id).state, 'DRAFT'); assert.equal(f.calls.claim, 0);
});

test('the exact already queued pair resolves to its original card durably without another admission or claim', async () => {
    const f = fixture(), photos = { FRONT: 'same verified front', BACK: 'same verified back' };
    const first = await f.photos(undefined, photos);
    const original = (await f.service.queue(f.staff, first.id,
        { operationId: operationId(), expectedRevision: first.revision, pairConfirmed: true })).card;
    await f.service.claim(f.staff, original.id, { operationId: operationId(), expectedRevision: original.revision, operator: 'ASTRA' });
    const before = canonical(f.state.cards.get(original.id)), second = await f.photos(undefined, photos);
    const input = { operationId: operationId(), expectedRevision: second.revision, pairConfirmed: true };
    const reply = await f.service.queue(f.staff, second.id, input);
    assert.equal(reply.card.id, second.id); assert.equal(reply.card.state, 'DRAFT');
    assert.equal(reply.card.revision, second.revision);
    assert.deepEqual(reply.queueResult, { state: 'EXISTING_CARD', cardId: original.id,
        title: original.title, cardState: 'IN_PROGRESS', stage: 'IDENTITY' });
    assert.equal(canonical(f.state.cards.get(original.id)), before);
    assert.equal(f.calls.pair, 1); assert.equal(f.calls.claim, 1);
    const count = f.state.operationIds.size;
    f.restart();
    assert.deepEqual(await f.service.queue(f.staff, second.id, input), reply);
    assert.equal(f.state.operationIds.size, count);
    await assert.rejects(f.service.queue(f.staff, second.id, { ...input, expectedRevision: second.revision + 1 }), /WORKSPACE_REQUEST_CONFLICT/);
    f.policy.cohortId = 'another-cohort';
    await assert.rejects(f.service.queue(f.staff, second.id, input), /WORKSPACE_CARD_NOT_FOUND/);
});

test('partial, reversed and unconfirmed pairs return a known refusal and never resolve to another card', async () => {
    for (const variant of ['partial', 'reversed', 'unconfirmed']) {
        const f = fixture(), photos = { FRONT: 'verified original front', BACK: 'verified original back' };
        const first = await f.photos(undefined, photos);
        if (variant !== 'unconfirmed') await f.service.queue(f.staff, first.id,
            { operationId: operationId(), expectedRevision: first.revision, pairConfirmed: true });
        const second = await f.photos(undefined, variant === 'partial' ? { ...photos, BACK: 'different back' }
            : variant === 'reversed' ? { FRONT: photos.BACK, BACK: photos.FRONT } : photos);
        const count = f.state.operationIds.size;
        await assert.rejects(f.service.queue(f.staff, second.id,
            { operationId: operationId(), expectedRevision: second.revision, pairConfirmed: true }), error =>
            error.code === 'WORKSPACE_PHOTO_ALREADY_USED' && error.outcome === 'NOT_DISPATCHED');
        assert.equal(f.state.operationIds.size, count);
        assert.equal(f.state.cards.get(second.id).state, 'DRAFT'); assert.equal(f.calls.claim, 0);
    }
});

test('competing human and Astra claims acquire exactly one fenced owner and replay cannot reacquire', async () => {
    const f = fixture(), card = await f.ready(), human = { operationId: operationId(), expectedRevision: card.revision, operator: 'HUMAN' };
    const astra = { operationId: operationId(), expectedRevision: card.revision, operator: 'ASTRA', mode: 'STEP' };
    const results = await Promise.allSettled([f.service.claim(f.staff, card.id, human), f.service.claim(f.otherStaff, card.id, astra)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'WORKSPACE_CLAIM_CONFLICT');
    const saved = f.state.cards.get(card.id);
    assert.equal(saved.state, 'IN_PROGRESS'); assert.equal(saved.stage, 'IDENTITY'); assert.equal(saved.claimFence, 1);
    assert.equal(saved.claim.captureRevision, saved.captureRevision); assert.equal(saved.claim.captureHash, saved.captureHash);
    assert.equal(saved.claim.workflowRevision, saved.revision); assert.equal(f.calls.claim, 1);
    const winner = results[0].status === 'fulfilled' ? [f.staff, human] : [f.otherStaff, astra]; f.restart();
    const replay = await f.service.claim(winner[0], card.id, winner[1]);
    assert.equal(replay.card.revision, saved.revision); assert.equal(f.calls.claim, 1);
    f.now = new Date('2026-09-12T04:00:00Z');
    await assert.rejects(f.service.claim(f.otherStaff, card.id, { ...astra, operationId: operationId(), expectedRevision: saved.revision }), /WORKSPACE_CLAIM_CONFLICT/);
    assert.equal(f.state.cards.get(card.id).claimFence, 1);
});

test('all ten fresh pairs may wait, but the initial one-card processing limit persists after apparent completion', async () => {
    const f = fixture(), cards = [];
    for (let index = 0; index < 10; index++) cards.push(await f.ready());
    assert.equal((await f.service.list(f.staff)).cards.filter(card => card.state === 'WAITING').length, 10);
    const first = await f.service.claim(f.staff, cards[0].id, { operationId: operationId(), expectedRevision: cards[0].revision, operator: 'HUMAN' });
    await assert.rejects(f.service.claim(f.staff, cards[1].id, { operationId: operationId(), expectedRevision: cards[1].revision, operator: 'HUMAN' }), /WORKSPACE_CAPABILITY_UNAVAILABLE/);
    assert.equal((await f.service.read(f.staff, cards[1].id)).card.capabilities.humanClaim, false);
    await f.store.transaction(f.staff, async ({ tx, now }) => {
        const saved = await tx.getCard(first.card.id);
        await tx.updateCard({ ...saved, revision: saved.revision + 1, state: 'APPROVED', stage: 'FINISHING', updatedAt: now.toISOString() }, saved.revision);
    });
    await assert.rejects(f.service.claim(f.staff, cards[1].id, { operationId: operationId(), expectedRevision: cards[1].revision, operator: 'HUMAN' }), /WORKSPACE_CAPABILITY_UNAVAILABLE/);
    f.policy.processingLimit = 10;
    const second = await f.service.claim(f.staff, cards[1].id, { operationId: operationId(), expectedRevision: cards[1].revision, operator: 'ASTRA', mode: 'CONTINUOUS' });
    assert.equal(second.card.operator.kind, 'ASTRA');
    await assert.rejects(f.service.claim(f.staff, cards[2].id, { operationId: operationId(), expectedRevision: cards[2].revision, operator: 'ASTRA' }), /WORKSPACE_CLAIM_CONFLICT/);
    assert.equal((await f.service.read(f.staff, cards[2].id)).card.capabilities.astraClaim, false);
});

test('expired pilots, missing runtime, observer writes and forged callers fail without losing saved drafts', async () => {
    const f = fixture(), ready = await f.ready();
    f.policy.astraEnabled = false;
    await assert.rejects(f.service.claim(f.staff, ready.id, { operationId: operationId(), expectedRevision: ready.revision, operator: 'ASTRA' }), /WORKSPACE_CAPABILITY_UNAVAILABLE/);
    assert.equal((await f.service.read(f.staff, ready.id)).card.capabilities.astraClaim, false);
    f.policy.claimsEnabled = false;
    await assert.rejects(f.service.claim(f.staff, ready.id, { operationId: operationId(), expectedRevision: ready.revision, operator: 'HUMAN' }), /WORKSPACE_CAPABILITY_UNAVAILABLE/);
    assert.equal((await f.service.list(f.observer)).cards.length, 1);
    await assert.rejects(f.service.create(f.observer, { operationId: operationId(), title: 'Observer card', identity: {} }), /WORKSPACE_REVIEW_PERMISSION_REQUIRED/);
    await assert.rejects(f.service.list({ id: f.identities.get(f.staff).id, role: 'REVIEWER' }), /SIGN_IN_REQUIRED/);
    f.now = new Date('2026-09-17T00:00:00Z');
    await assert.rejects(f.create(), /WORKSPACE_CAPABILITY_UNAVAILABLE/);
    assert.equal((await f.service.read(f.staff, ready.id)).card.id, ready.id); assert.equal(f.state.cards.size, 1);
});

test('source claim hook denial rolls back ownership and no upload is eligible for paid dispatch', async () => {
    const f = fixture(), card = await f.ready(), before = canonical(f.state.cards.get(card.id));
    f.source.assertClaimable = async () => deny(409, 'GRADING_WORK_UNRESOLVED');
    await assert.rejects(f.service.claim(f.staff, card.id, { operationId: operationId(), expectedRevision: card.revision, operator: 'ASTRA' }), /GRADING_WORK_UNRESOLVED/);
    assert.equal(canonical(f.state.cards.get(card.id)), before);
    assert.equal(f.calls.record, 2); assert.equal(f.calls.pair, 1); assert.equal(f.calls.claim, 0);
});

test('the explicit Astra roster controls the button and rejects a new claim before any mutation', async () => {
    const f = fixture(), ready = await f.ready();
    f.state.cards.get(ready.id).identity = { category: 'SPORTS', playerName: 'Verified test card' };
    f.admission = { ready: false, code: 'WORKSPACE_ASTRA_NOT_ADMITTED' };
    const before = clone(f.state), view = (await f.service.read(f.staff, ready.id)).card;
    assert.equal(view.capabilities.astraClaim, false); assert.equal(view.capabilities.humanClaim, true);
    assert.equal(view.capabilities.astraClaimUnavailableReason, 'WORKSPACE_ASTRA_NOT_ADMITTED');
    const input = { operationId: operationId(), expectedRevision: ready.revision, operator: 'ASTRA' };
    await assert.rejects(f.service.claim(f.staff, ready.id, input), error => error.status === 409
        && error.code === 'WORKSPACE_ASTRA_NOT_ADMITTED' && error.outcome === 'NOT_DISPATCHED');
    assert.deepEqual(f.state, before); assert.equal(f.calls.claim, 0);
    f.admission = { ready: true, code: null };
    assert.equal((await f.service.read(f.staff, ready.id)).card.capabilities.astraClaim, true);
    const committed = await f.service.claim(f.staff, ready.id, input);
    f.admission = { ready: false, code: 'WORKSPACE_ASTRA_NOT_ADMITTED' };
    const replay = await f.service.claim(f.staff, ready.id, input);
    assert.equal(replay.operationId, committed.operationId); assert.equal(replay.card.revision, committed.card.revision);
    assert.equal(f.calls.claim, 1);
});

test('missing or changed readiness never advertises Astra and rechecks before a new claim', async () => {
    const f = fixture(), ready = await f.ready(); f.state.cards.get(ready.id).identity = { category: 'POKEMON' };
    assert.equal((await f.service.read(f.staff, ready.id)).card.capabilities.astraClaim, true);
    for (const admission of [{ ready: false, code: 'WORKSPACE_ASTRA_NOT_READY' }, { ready: true }, null]) {
        f.admission = admission; if (admission === null) f.source.captureReadiness = async () => null;
        const before = clone(f.state);
        assert.equal((await f.service.read(f.staff, ready.id)).card.capabilities.astraClaim, false);
        await assert.rejects(f.service.claim(f.staff, ready.id, { operationId: operationId(), expectedRevision: ready.revision, operator: 'ASTRA' }),
            error => error.code === 'WORKSPACE_ASTRA_NOT_READY' && error.outcome === 'NOT_DISPATCHED');
        assert.deepEqual(f.state, before); assert.equal(f.calls.claim, 0);
    }
});

test('an older unsaved claim is definitively rejected after another command claimed the card', async () => {
    const f = fixture(), ready = await f.ready(), input = { operationId: operationId(), expectedRevision: ready.revision, operator: 'ASTRA' };
    const committed = await f.service.claim(f.staff, ready.id, { ...input, operationId: operationId() });
    const before = clone(f.state);
    await assert.rejects(f.service.claim(f.staff, ready.id, input), error => error.code === 'WORKSPACE_CLAIM_CONFLICT'
        && error.status === 409 && error.outcome === 'NOT_DISPATCHED');
    assert.deepEqual(f.state, before); assert.equal(f.calls.claim, 1);
    assert.equal((await f.service.read(f.staff, ready.id)).card.revision, committed.card.revision);
});

test('errors from the claim hook are not relabeled as safe preflight refusals', async () => {
    const f = fixture(), ready = await f.ready();
    f.source.assertClaimable = async () => deny(409, 'WORKSPACE_CLAIM_CONFLICT');
    await assert.rejects(f.service.claim(f.staff, ready.id, { operationId: operationId(), expectedRevision: ready.revision, operator: 'ASTRA' }),
        error => error.code === 'WORKSPACE_CLAIM_CONFLICT' && error.outcome === undefined);
});

test('saved evidence exposes only exact verified bytes after post-read auth and revision recheck', async () => {
    const f = fixture(), ready = await f.ready();
    const evidence = await f.service.evidence(f.staff, ready.id, 'FRONT');
    assert.equal(evidence.contentType, 'image/png'); assert.equal(hash(evidence.bytes), ready.sides[0].sha256);
    assert.deepEqual(Object.keys(evidence), ['bytes', 'contentType']);
    const pointer = f.state.cards.get(ready.id).sides.FRONT, upload = f.state.operationIds.get(pointer.uploadId).result.upload;
    f.objects.set(upload.objectRef, Buffer.from('storage was overwritten'));
    await assert.rejects(f.service.evidence(f.staff, ready.id, 'FRONT'), /WORKSPACE_UPLOAD_UNVERIFIED/);
    const second = fixture(), secondCard = await second.ready();
    let release;
    second.readWait = new Promise(resolve => { release = resolve; });
    const reading = second.service.evidence(second.staff, secondCard.id, 'BACK');
    while (second.calls.read === 0) await new Promise(resolve => setImmediate(resolve));
    second.identities.delete(second.staff); release();
    await assert.rejects(reading, /SIGN_IN_REQUIRED/);
});

test('bounded byte reader handles Node/Web streams and rejects overruns, truncation, bad SHA and stalled reads', async () => {
    const bytes = Buffer.from('verified bytes from exact planned object'), upload = {
        byteCount: bytes.length, sha256: hash(bytes), contentType: 'image/png' };
    const node = await readWorkspacePhotoBytes({ upload, read: async () => Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]) });
    assert.deepEqual(node, bytes);
    const web = await readWorkspacePhotoBytes({ upload, read: async () => new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(bytes)); controller.close();
    } }) });
    assert.deepEqual(web, bytes);
    for (const body of [Buffer.concat([bytes, Buffer.from('x')]), bytes.subarray(1), Buffer.alloc(bytes.length)])
        await assert.rejects(readWorkspacePhotoBytes({ upload, read: async () => Readable.from([body]) }), /WORKSPACE_UPLOAD_UNVERIFIED/);
    let aborted = false;
    await assert.rejects(readWorkspacePhotoBytes({ upload, timeoutMs: 5, read: signal => {
        signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {});
    } }), /WORKSPACE_STORAGE_UNAVAILABLE/);
    assert.equal(aborted, true);
    await assert.rejects(readWorkspacePhotoBytes({ upload, timeoutMs: 5, read: async () => ({
        [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: () => new Promise(() => {}) }; },
    }) }), /WORKSPACE_STORAGE_UNAVAILABLE/);
});

test('storage verifier hashes the exact planned object, never ETag/metadata, before trusted still-image decoding', async () => {
    const bytes = Buffer.from('exact fixture PNG bytes'), upload = { id: randomUUID(), objectRef: 'bound/original.png',
        byteCount: bytes.length, sha256: hash(bytes), contentType: 'image/png' };
    let head = { objectRef: upload.objectRef, byteCount: upload.byteCount, contentType: upload.contentType,
        nativeChecksumPresent: false, sha256: 'b'.repeat(64), etag: 'invented', metadata: { sha256: 'c'.repeat(64) } };
    let body = bytes, readCount = 0, inspectCount = 0, decodedType = 'image/png';
    const verify = workspacePhotoVerifier({ head: async () => head, read: async ({ upload: observed }) => {
        assert.equal(observed.objectRef, upload.objectRef); readCount++; return Readable.from([body]);
    }, inspect: async observed => { inspectCount++; assert.deepEqual(observed, bytes); return { contentType: decodedType, width: 800, height: 1100 }; } });
    const result = await verify({ upload, source: {} });
    assert.equal(result.sha256, upload.sha256); assert.equal(readCount, 1); assert.equal(inspectCount, 1);
    body = Buffer.alloc(bytes.length);
    await assert.rejects(verify({ upload, source: {} }), /WORKSPACE_UPLOAD_UNVERIFIED/); assert.equal(inspectCount, 1);
    body = bytes; head = { ...head, nativeChecksumPresent: true };
    await assert.rejects(verify({ upload, source: {} }), /WORKSPACE_UPLOAD_UNVERIFIED/); assert.equal(readCount, 2);
    head = { ...head, sha256: upload.sha256 }; decodedType = 'image/jpeg';
    await assert.rejects(verify({ upload, source: {} }), /WORKSPACE_UPLOAD_UNVERIFIED/);
    head = { ...head, objectRef: 'different/object' };
    await assert.rejects(verify({ upload, source: {} }), /WORKSPACE_UPLOAD_UNVERIFIED/);
});
