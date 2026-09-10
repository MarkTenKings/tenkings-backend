// Owned disposable PostgreSQL and synthetic image bytes only. The real staff
// store, signed private transport and Sharp verifier run without provider I/O.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { workspaceServiceClient } from '@atlas/service-bridge/workspace';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { StaffDatabase } from '../lib/server/access/database.mjs';
import { StaffWorkspaceStore } from '../lib/server/access/workspace-store.mjs';
import { StaffWorkspaceIntake } from '../lib/server/access/workspace-intake.mjs';

const privateRequire = createRequire(new URL('../../nextjs-app/package.json', import.meta.url));
const { register } = await import(pathToFileURL(privateRequire.resolve('tsx/esm/api')).href);
// A single scoped loader preserves the typed rejection's module identity at
// the verifier/host boundary while staying separate from other SQL fixtures.
const loader = register({ namespace: 'atlas-workspace-upload-recovery' });
const cjsLoader = privateRequire('tsx/cjs/api').register({ namespace: 'atlas-workspace-upload-recovery' });
const { createAtlasWorkspaceSourceStorage } = await loader.import('../../nextjs-app/lib/server/atlasWorkspaceSourceStorage.ts', import.meta.url);
const { createAtlasWorkspaceSourceHost } = await loader.import('../../nextjs-app/lib/server/atlasWorkspaceSourceHost.ts', import.meta.url);
await loader.unregister();
cjsLoader.unregister();
const sharp = privateRequire('sharp');
const denied = (code, work) => assert.rejects(work, error => error.code === code, code);

async function fixture(context, work) {
    const { admin, auth, config, db } = context, signed = await context.login();
    const workspace = { enabled: true, mode: 'LOCAL_FIXTURE', releaseSha: config.releaseSha,
        configHash: digest('owned PostgreSQL upload recovery'), cohortId: randomUUID(), intakeEnabled: true,
        claimsEnabled: true, astraEnabled: false, processingLimit: 1, expiresAt: new Date(Date.now() + 600_000) };
    await admin.staffWorkspaceControl.create({ data: workspace });
    const store = new StaffWorkspaceStore({ auth, configHash: workspace.configHash });
    const objects = new Map(), settings = { partial: false, afterVerified: null }, freshClients = [];
    let reads = 0, grants = 0;
    const storage = createAtlasWorkspaceSourceStorage({ bucket: 'owned-upload-recovery', uploadOrigin: 'https://uploads.example.invalid',
        presign: async () => { grants++; return 'https://uploads.example.invalid/owned-no-network'; },
        client: { async send(command) {
            const object = objects.get(command.input.Key); assert(object, 'only owned synthetic objects may be read');
            // The scoped loader separates its dependencies from native require;
            // these are the real SDK commands sent by the loaded adapter.
            if (command.constructor.name === 'HeadObjectCommand') return { ContentLength: object.bytes.length, ContentType: 'image/png',
                ChecksumSHA256: object.claimedChecksum };
            assert.equal(command.constructor.name, 'GetObjectCommand'); reads++;
            return { ContentLength: object.bytes.length, Body: Readable.from([settings.partial ? object.bytes.subarray(0, 10) : object.bytes]) };
        } } });
    const bridgeConfig = { origin: 'https://private.example.invalid', key: randomBytes(32), configHash: workspace.configHash,
        releaseSha: config.releaseSha, deploymentId: config.deploymentId };
    const host = createAtlasWorkspaceSourceHost({ bridgeConfig, client: admin, storage,
        worker: { geometryOrigin: 'https://geometry.example.invalid', preparationOrigin: 'https://preparation.example.invalid',
            apiKey: 'owned-fixture-geometry-only', preparationApiKey: 'owned-fixture-preparation-only', receiptKey: 'x'.repeat(40), receiptKeyId: 'fixture' },
        // Resolve the actual retained SQL records through current staff access.
        // Production private-role authority has its own source privilege suite.
        authority: { loadUpload: ({ cardId, uploadId }) => store.transaction(signed.staff, async c => {
            const card = await c.tx.getCard(cardId), operation = await c.tx.getOperationById(uploadId);
            assert.equal(operation.cardId, card.id); assert.equal(operation.action, 'upload-plan');
            return { card, upload: operation.result.upload, verification: null, workspace: c.policy, now: c.now };
        }) },
        initialization: () => { throw Error('Upload recovery cannot initialize a report'); },
        fetchImpl: async () => { throw Error('Upload recovery cannot call a worker'); } });
    const transport = workspaceServiceClient(bridgeConfig, async (_url, request) => {
        const result = await host.receive(request.body, request.headers['x-atlas-workspace-signature']);
        return new Response(result.bytes, { headers: { 'content-type': result.contentType, 'x-atlas-workspace-response': result.signature } });
    });
    const intake = currentStore => new StaffWorkspaceIntake({ store: currentStore,
        source: { reserve: ({ cardId, creatorId }) => ({ sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` }) },
        storage: { grant: ({ upload }) => transport.call('UPLOAD_GRANT', { cardId: upload.cardId, uploadId: upload.id }),
            async verify({ upload }) {
                const result = await transport.call('VERIFY_UPLOAD', { cardId: upload.cardId, uploadId: upload.id });
                await settings.afterVerified?.(); return result;
            } } });
    const service = intake(store);
    const { card: initial } = await service.create(signed.staff, { operationId: randomUUID(), title: 'Owned recovery photograph', identity: { category: 'POKEMON' } });
    const card = async () => JSON.parse((await admin.staffWorkspaceCard.findUnique({ where: { id: initial.id } })).canonical);
    const operation = id => admin.staffWorkspaceOperation.findUnique({ where: { id } });
    const file = async color => {
        const bytes = await sharp({ create: { width: 32, height: 48, channels: 3, background: color } }).png().toBuffer();
        return { bytes, descriptor: { name: `${color}.png`, contentType: 'image/png', byteCount: bytes.length, sha256: digest(bytes) } };
    };
    const plan = async (side, photo, bytes = photo.bytes) => {
        const result = await service.planUpload(signed.staff, initial.id, { operationId: randomUUID(), expectedRevision: (await card()).revision,
            side, file: photo.descriptor });
        const upload = JSON.parse((await operation(result.upload.id)).canonical).result.upload;
        assert(!objects.has(upload.objectRef));
        objects.set(upload.objectRef, { bytes: Buffer.from(bytes), claimedChecksum: Buffer.from(upload.sha256, 'hex').toString('base64') });
        return { ...result, retained: upload, input: { operationId: randomUUID(), expectedRevision: result.card.revision, uploadId: result.upload.id } };
    };
    const complete = planned => service.completeUpload(signed.staff, initial.id, planned.input);
    const fresh = async () => {
        const client = new PrismaClient({ datasources: { db: { url: db.staffUrl } } }); freshClients.push(client);
        const restoredAuth = new DurableStaffAuth({ config, database: new StaffDatabase(client, config) });
        const staff = await restoredAuth.authenticate(signed.cookie, signed.csrf);
        return { service: intake(new StaffWorkspaceStore({ auth: restoredAuth, configHash: workspace.configHash })), staff };
    };
    try { await work({ ...context, signed, service, card, operation, file, plan, complete, fresh, settings, objects,
        id: initial.id, reads: () => reads, grants: () => grants }); }
    finally { await Promise.all(freshClients.map(client => client.$disconnect())); }
}

export async function workspaceUploadRecoveryScenarios(scenario) {
    for (const reason of ['BYTES_MISMATCH', 'INVALID_IMAGE']) {
        await scenario(`real SQL retains signed ${reason} receipt across lost reply, other-side revision and same-draft replacement`, context => fixture(context, async f => {
            const front = await f.file('red'), back = await f.file('blue');
            const badBytes = Buffer.from(front.bytes); badBytes[badBytes.length - 1] ^= 1;
            // Matching declared bytes with a corrupt PNG CRC exercises the
            // original Sharp decoder rather than another hash mismatch.
            if (reason === 'INVALID_IMAGE') {
                badBytes[29] ^= 1;
                front.descriptor = { ...front.descriptor, sha256: digest(badBytes) };
            }
            const first = await f.plan('FRONT', front, badBytes), rejected = await f.complete(first);
            const rejectedCard = await f.card(), receipt = await f.operation(rejectedCard.sides.FRONT.rejectionId);
            const saved = JSON.parse(receipt.canonical);
            assert.equal(rejected.uploadResult.reason, reason); assert.equal(rejected.card.state, 'DRAFT');
            assert.equal(rejectedCard.sides.FRONT.verificationId, null); assert.equal(saved.inputHash,
                digest(canonical({ action: 'upload-complete', cardId: f.id, input: first.input })));
            assert.deepEqual(saved.result, { uploadId: first.upload.id, outcome: 'REJECTED', reason, revision: rejectedCard.revision });
            await denied('WORKSPACE_PHOTOS_REQUIRED', () => f.service.queue(f.signed.staff, f.id,
                { operationId: randomUUID(), expectedRevision: rejectedCard.revision, pairConfirmed: true }));
            const backPlan = await f.plan('BACK', back); await f.complete(backPlan);
            const advanced = await f.card(), priorReads = f.reads(), count = await f.admin.staffWorkspaceOperation.count();
            // Deliberately discard the first reply and recreate the serving
            // client/auth/store before replaying its exact saved command.
            const fresh = await f.fresh(), replay = await fresh.service.completeUpload(fresh.staff, f.id, first.input);
            assert.deepEqual(replay.uploadResult, rejected.uploadResult); assert.equal(replay.card.revision, advanced.revision);
            assert.equal(replay.card.sides.find(side => side.side === 'BACK').status, 'VERIFIED');
            assert.equal(f.reads(), priorReads); assert.equal(await f.admin.staffWorkspaceOperation.count(), count);
            await denied('WORKSPACE_REQUEST_CONFLICT', () => fresh.service.completeUpload(fresh.staff, f.id,
                { ...first.input, expectedRevision: advanced.revision }));
            await denied('WORKSPACE_REVISION_CHANGED', () => fresh.service.completeUpload(fresh.staff, f.id,
                { ...first.input, operationId: randomUUID() }));
            assert.equal(f.reads(), priorReads);
            const replacement = await f.plan('FRONT', await f.file('green')); await f.complete(replacement);
            const final = await f.card();
            assert.equal(await f.admin.staffWorkspaceCard.count(), 1); assert.equal(final.id, f.id); assert.equal(final.state, 'DRAFT');
            assert.equal(final.specimenId, null); assert.equal(final.claim, null); assert.equal(final.captureHash, null);
            assert.equal(final.startedAt, null); assert.notEqual(replacement.upload.id, first.upload.id);
            assert.notEqual(replacement.retained.objectRef, first.retained.objectRef);
            assert.deepEqual(final.sides.BACK, advanced.sides.BACK); assert.equal(final.sides.FRONT.rejectionId, undefined);
            assert.deepEqual(await f.operation(receipt.id), receipt);
            assert.deepEqual(f.objects.get(first.retained.objectRef).bytes, badBytes);
            const afterReplacement = await fresh.service.completeUpload(fresh.staff, f.id, first.input);
            assert.deepEqual(afterReplacement.uploadResult, rejected.uploadResult);
            assert.equal(afterReplacement.card.sides.find(side => side.side === 'FRONT').uploadId, replacement.upload.id);
            assert.equal(await f.admin.staffReportApproval.count(), 0); assert.equal(await f.admin.staffOperatorRun.count(), 0);
            // The owner client has table permissions: these denials prove the
            // actual immutable SQL triggers, not just the serving role grants.
            await assert.rejects(() => f.admin.staffWorkspaceOperation.update({ where: { id: receipt.id }, data: { canonical: receipt.canonical } }), /immutable/i);
            await assert.rejects(() => f.admin.staffWorkspaceOperation.delete({ where: { id: receipt.id } }), /immutable/i);
            await assert.rejects(() => f.admin.staffWorkspaceCard.update({ where: { id: f.id }, data: { canonical: canonical(final) } }), /revision or immutable source changed/i);
            assert.deepEqual(await f.operation(receipt.id), receipt); assert.deepEqual(await f.card(), final);
        }));
    }

    await scenario('real SQL rejects late upload rejection after revision or staff authority changes and keeps partial reads unresolved', context => fixture(context, async f => {
        const front = await f.file('red'), badBytes = Buffer.from(front.bytes); badBytes[badBytes.length - 1] ^= 1;
        const planned = await f.plan('FRONT', front, badBytes), initial = await f.card();
        const observer = await f.login(f.auth, '+12025550142');
        await denied('WORKSPACE_REVIEW_PERMISSION_REQUIRED', () => f.service.completeUpload(observer.staff, f.id, planned.input));
        await denied('SIGN_IN_REQUIRED', () => f.service.completeUpload({ ...f.signed.staff }, f.id, planned.input));
        assert.equal(f.reads(), 0);
        f.settings.partial = true;
        await assert.rejects(() => f.complete(planned), /WORKSPACE_UPLOAD_UNVERIFIED/);
        assert.deepEqual(await f.card(), initial); assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { action: 'upload-complete' } }), 0);
        f.settings.partial = false;
        f.settings.afterVerified = async () => { f.settings.afterVerified = null; await f.plan('BACK', await f.file('blue')); };
        await denied('WORKSPACE_REVISION_CHANGED', () => f.complete(planned));
        const advanced = await f.card();
        assert.deepEqual(advanced.sides.FRONT, initial.sides.FRONT);
        assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { action: 'upload-complete' } }), 0);
        f.settings.afterVerified = async () => {
            await f.admin.staffIdentity.update({ where: { id: f.signed.staff.id }, data: { revokedAt: new Date(), accessVersion: { increment: 1 } } });
        };
        await denied('SIGN_IN_REQUIRED', () => f.service.completeUpload(f.signed.staff, f.id,
            { ...planned.input, operationId: randomUUID(), expectedRevision: advanced.revision }));
        assert.deepEqual(await f.card(), advanced);
        assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { action: 'upload-complete' } }), 0);
        assert.equal(await f.admin.staffReportApproval.count(), 0); assert.equal(await f.admin.staffOperatorRun.count(), 0);
    }));
}
