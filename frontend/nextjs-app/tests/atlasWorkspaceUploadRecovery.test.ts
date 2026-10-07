import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { GetObjectCommand, HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { workspaceServiceClient } from '@atlas/service-bridge/workspace';
import { createAtlasWorkspaceSourceStorage } from '../lib/server/atlasWorkspaceSourceStorage';
import { createAtlasWorkspaceSourceHost } from '../lib/server/atlasWorkspaceSourceHost';
import { StaffWorkspaceIntake } from '../../atlas-app/lib/server/access/workspace-intake.mjs';
import { describePhoto, replaceIntakePhoto, uploadIntakeEntry, uploadPhoto } from '../../atlas-app/lib/workspace-client.mjs';

type Row = Record<string, any>;
const copy = structuredClone;
async function fixture() {
    const identity = { id: randomUUID(), name: 'Fixture grader', role: 'REVIEWER', accessVersion: 1 };
    const policy = { cohortId: randomUUID(), maxCards: 10, intakeEnabled: true, claimsEnabled: true, astraEnabled: false,
        processingLimit: 1, expiresAt: new Date(Date.now() + 3600000) };
    const config = { origin: 'https://source.example.invalid', key: Buffer.alloc(32, 47), configHash: 'a'.repeat(64), releaseSha: 'b'.repeat(40), deploymentId: 'fixture-staff' };
    const f: Row = { state: { cards: new Map(), operations: new Map() }, objects: new Map(), tail: Promise.resolve(),
        requests: [], puts: [], gets: 0, corruptNext: false, loseReply: false, privateMode: 'SIGNED', streamMode: 'COMPLETE' };
    const operation = (id: string) => f.state.operations.get(id);
    const store = { async transaction(_staff: unknown, work: (context: Row) => unknown) {
        const earlier = f.tail; let release!: () => void; f.tail = new Promise(resolve => { release = resolve; }); await earlier;
        try {
            const state = copy(f.state), tx = {
                getCard: async (id: string) => copy(state.cards.get(id)), listCards: async () => copy([...state.cards.values()]),
                insertCard: async (row: Row) => { assert(!state.cards.has(row.id)); state.cards.set(row.id, copy(row)); },
                updateCard: async (row: Row, revision: number) => { assert.equal(state.cards.get(row.id).revision, revision); assert.equal(row.revision, revision + 1); state.cards.set(row.id, copy(row)); },
                getOperationById: async (id: string) => copy(state.operations.get(id)),
                getOperation: async (actorId: string, id: string) => copy([...state.operations.values()].find((row: any) => row.actorId === actorId && row.operationId === id)),
                insertOperation: async (row: Row) => { assert(![...state.operations.values()].some((old: any) => old.actorId === row.actorId && old.operationId === row.operationId)); state.operations.set(row.id, copy(row)); },
            };
            const result = await work({ identity, control: { revision: 1 }, policy, now: new Date(), tx }); f.state = state; return result;
        } finally { release(); }
    } };
    const client = { send: async (command: any) => {
        const object = f.objects.get(command.input.Key); assert(object);
        if (command instanceof HeadObjectCommand) return { ContentLength: object.bytes.length, ContentType: object.type,
            ChecksumSHA256: object.claimedChecksum }; // Deliberately untrusted, like the observed Spaces behavior.
        assert(command instanceof GetObjectCommand); f.gets++;
        const body = f.streamMode === 'PARTIAL' ? object.bytes.subarray(0, 10) : object.bytes;
        return { ContentLength: object.bytes.length, Body: Readable.from([body]) };
    } } as S3Client;
    const storage = createAtlasWorkspaceSourceStorage({ client, bucket: 'fixture-private-bucket', uploadOrigin: 'https://uploads.example.invalid',
        presign: (async () => 'https://uploads.example.invalid/exact?transient=grant') as never });
    const host = createAtlasWorkspaceSourceHost({ bridgeConfig: config, client: {} as never, storage,
        worker: { geometryOrigin: 'https://color.example.invalid', preparationOrigin: 'https://cpu.example.invalid', apiKey: 'fixture-geometry-credential',
            preparationApiKey: 'fixture-preparation-credential', receiptKey: 'x'.repeat(40), receiptKeyId: 'fixture' },
        authority: { loadUpload: async ({ cardId, uploadId }: Row) => {
            const card = copy(f.state.cards.get(cardId)), upload = copy(operation(uploadId).result.upload);
            assert.equal(upload.cardId, card.id);
            return { card, upload, verification: null, workspace: policy, now: new Date() };
        } } as never,
        initialization: () => { throw new Error('uploads cannot initialize reports'); }, fetchImpl: async () => { throw new Error('uploads cannot call workers'); } });
    const transport = workspaceServiceClient(config, async (_url: any, input: any) => {
        if (JSON.parse(input.body).claims.action === 'VERIFY_UPLOAD' && f.privateMode === 'UNSIGNED') return new Response('{}', { status: 503 });
        try {
            const result = await host.receive(input.body, input.headers['x-atlas-workspace-signature']);
            return new Response(result.bytes, { headers: { 'content-type': result.contentType,
                'x-atlas-workspace-response': f.privateMode === 'TAMPERED' ? '0'.repeat(64) : result.signature } });
        } catch { return new Response('{}', { status: 503 }); }
    });
    const ports = { store, source: { reserve: ({ cardId, creatorId }: Row) => ({ sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` }) },
        storage: { grant: ({ upload }: Row) => transport.call('UPLOAD_GRANT', { cardId: upload.cardId, uploadId: upload.id }),
            verify: ({ upload }: Row) => transport.call('VERIFY_UPLOAD', { cardId: upload.cardId, uploadId: upload.id }) } };
    f.restart = () => { f.intake = new StaffWorkspaceIntake(ports); f.saved = copy(f.saved); };
    f.saved = { id: randomUUID(), title: 'Fresh physical card', identity: { category: 'POKEMON' }, files: { FRONT: null, BACK: null }, uploads: {}, card: null, pending: null, pairConfirmed: false };
    f.restart();
    f.file = async (name: string, color: string) => { const bytes = await sharp({ create: { width: 32, height: 48, channels: 3, background: color } }).png().toBuffer();
        return { name, type: 'image/png', size: bytes.length, bytes: new Uint8Array(bytes) }; };
    f.describe = (file: Row) => describePhoto({ ...file, arrayBuffer: async () => new Uint8Array(file.bytes).buffer });
    f.put = (grant: Row, file: Row) => uploadPhoto(grant, file, { xhrFactory: () => {
        const xhr: Row = { upload: {}, open() {}, setRequestHeader() {}, send() {
            const upload = operation(grant.id).result.upload; f.puts.push(grant.id);
            if (f.objects.has(upload.objectRef)) xhr.status = 412;
            else {
                const bytes = Buffer.from(file.bytes); if (f.corruptNext) { bytes[bytes.length - 1] ^= 1; f.corruptNext = false; }
                f.objects.set(upload.objectRef, { bytes, type: file.type, claimedChecksum: Buffer.from(upload.sha256, 'hex').toString('base64') }); xhr.status = 200;
            }
            xhr.onload();
        } }; return xhr;
    } });
    f.run = () => uploadIntakeEntry(f.saved, { describe: f.describe, put: f.put, persist: async (entry: Row) => { f.saved = copy(entry); },
        request: async (path: string, { body }: Row) => {
            f.requests.push({ path, body: copy(body) }); const id = path.split('/')[2];
            const result = path === 'workspace/cards' ? await f.intake.create(identity, body)
                : path.endsWith('/upload-plan') ? await f.intake.planUpload(identity, id, body) : await f.intake.completeUpload(identity, id, body);
            if (f.loseReply && result.uploadResult) { f.loseReply = false; throw new Error('lost rejection acknowledgment'); }
            return result;
        } });
    return f;
}

test('complete corrupt immutable upload recovers its signed rejection after lost ACK/reload and replaces only that side on the same draft', async () => {
    const f = await fixture(), back = await f.file('back.png', 'blue'), front = await f.file('front.png', 'red');
    f.saved = replaceIntakePhoto(f.saved, 'BACK', back); await f.run();
    const cardId = f.saved.card.id;
    f.saved = replaceIntakePhoto(f.saved, 'FRONT', front); f.corruptNext = true; f.loseReply = true;
    await assert.rejects(f.run(), /lost rejection acknowledgment/);
    const pending = copy(f.saved.pending), oldUpload = f.state.operations.get(pending.body.uploadId).result.upload;
    const rejectedCard = copy(f.state.cards.get(cardId)), rejectionId = rejectedCard.sides.FRONT.rejectionId;
    const receipt = copy(f.state.operations.get(rejectionId)), corruptBytes = Buffer.from(f.objects.get(oldUpload.objectRef).bytes);
    assert.equal(f.saved.uploads.FRONT.phase, 'COMPLETE'); assert.equal(receipt.result.outcome, 'REJECTED');
    // Another authorized tab advances the other side before the lost reply is recovered.
    const plan = await f.intake.planUpload({}, cardId, { operationId: randomUUID(), expectedRevision: rejectedCard.revision, side: 'BACK', file: await f.describe(back) });
    await f.put(plan.upload, back);
    const other = await f.intake.completeUpload({}, cardId, { operationId: randomUUID(), expectedRevision: plan.card.revision, uploadId: plan.upload.id });
    const gets = f.gets; f.restart(); await assert.rejects(f.run(), /Choose the photograph again/);
    assert.equal(f.gets, gets, 'retained rejection replay does not re-read storage');
    assert.equal(f.saved.pending, null); assert.equal(f.saved.uploads.FRONT.phase, 'REJECTED');
    assert.equal(f.saved.card.revision, other.card.revision); assert.equal(f.saved.card.id, cardId);
    assert.deepEqual(f.saved.files.FRONT, front); assert.deepEqual(f.saved.uploads.FRONT.rejection.operationId, pending.body.operationId);
    const requests = f.requests.length; await assert.rejects(f.run(), /Choose the photograph again/); assert.equal(f.requests.length, requests);
    f.saved = replaceIntakePhoto(f.saved, 'FRONT', front); await f.run();
    const replacement = f.state.operations.get(f.saved.uploads.FRONT.uploadId).result.upload;
    assert.equal(f.state.cards.size, 1); assert.equal(f.saved.card.id, cardId);
    assert.notEqual(replacement.id, oldUpload.id); assert.notEqual(replacement.objectRef, oldUpload.objectRef);
    assert.equal(f.saved.card.sides[0].status, 'VERIFIED'); assert.equal(f.saved.card.sides[1].uploadId, plan.upload.id);
    assert.equal(f.saved.card.sides[1].status, 'VERIFIED'); assert.equal(f.saved.card.state, 'DRAFT');
    assert.deepEqual(f.state.operations.get(rejectionId), receipt); assert.deepEqual(f.objects.get(oldUpload.objectRef).bytes, corruptBytes);
    assert(f.requests.every((row: Row) => !/queue|claim|action/.test(row.path)));
});

test('unsigned, malformed-signature and partial storage responses keep the exact completion pending', async () => {
    for (const mode of ['UNSIGNED', 'TAMPERED', 'PARTIAL']) {
        const f = await fixture(); f.saved = replaceIntakePhoto(f.saved, 'FRONT', await f.file('front.png', 'red'));
        // Interrupt after PUT, while retaining the completion request rather than its grant.
        const put = f.put; f.put = async (...args: any[]) => { await put(...args); if (mode === 'PARTIAL') f.streamMode = mode; else f.privateMode = mode; };
        await assert.rejects(f.run()); const pending = copy(f.saved.pending);
        assert.equal(f.saved.uploads.FRONT.phase, 'COMPLETE'); assert.equal(f.saved.card.sides[0].status, 'PLANNED');
        assert.throws(() => replaceIntakePhoto(f.saved, 'FRONT', f.saved.files.FRONT), /Recover the saved request/);
        f.restart(); await assert.rejects(f.run()); assert.deepEqual(f.saved.pending, pending);
        assert.equal([...f.state.operations.values()].some((row: any) => row.action === 'upload-complete'), false);
        f.privateMode = 'SIGNED'; f.streamMode = 'COMPLETE'; await f.run();
        assert.equal(f.saved.pending, null); assert.equal(f.saved.card.sides[0].status, 'VERIFIED');
        assert.equal(f.puts.length, 1);
    }
});
