import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import type { Prisma, PrismaClient } from '@prisma/client';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { canonical } from '@atlas/service-bridge/protocol';
import { signWorkspaceRequest, workspaceResponseSignature } from '@atlas/service-bridge/workspace';
import { preparationBytesHash, preparationHash } from '../lib/server/speedsterPreparationIntegrity';
import { createAtlasWorkspaceSourceStorage, type AtlasWorkspaceUpload } from '../lib/server/atlasWorkspaceSourceStorage';
import { createAtlasWorkspacePreparationWorker, createAtlasWorkspacePreparationStore, createAtlasWorkspaceSourceHost,
    type AtlasWorkspaceSourceHostDependencies } from '../lib/server/atlasWorkspaceSourceHost';
import { createAtlasWorkspaceSourceAuthority, createAtlasWorkspaceSourceLedger } from '../lib/server/atlasWorkspaceSourceAuthority';
import type { AtlasWorkspaceSourceRequest } from '../lib/server/atlasWorkspaceSource';

type Row = Record<string, any>;
const NOW = new Date('2026-09-10T04:00:00.000Z'), LATER = new Date('2026-09-16T20:41:57.000Z');
const image = sharp({ create: { width: 32, height: 48, channels: 3, background: '#94aa2b' } }).jpeg().toBuffer();
const workerConfig = { geometryOrigin: 'https://color.example.invalid', preparationOrigin: 'https://cpu.example.invalid',
    apiKey: 'fixture-worker-credential', preparationApiKey: 'fixture-separate-cpu-credential', receiptKey: 'fixture-receipt-key-with-at-least-32-characters', receiptKeyId: 'fixture-source' };
const bridgeConfig = { origin: 'https://source.example.invalid', key: Buffer.alloc(32, 47), configHash: 'a'.repeat(64),
    releaseSha: 'b'.repeat(40), deploymentId: 'fixture-staff' };

async function storageFixture() {
    const bytes = await image, cardId = randomUUID(), creatorId = randomUUID(), id = randomUUID();
    const source = { sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` };
    const upload: AtlasWorkspaceUpload = { id, cardId, side: 'FRONT', ...source,
        objectRef: `ai-grader-v2/${source.sourceOwnerId}/${source.sourceId}/original/recapture-${id}/front.jpg`,
        sha256: preparationBytesHash(bytes), byteCount: bytes.length, contentType: 'image/jpeg' };
    const calls: Array<GetObjectCommand | HeadObjectCommand | PutObjectCommand> = [], grants: Row[] = [];
    const f = { bytes, upload, source, calls, grants, versionId: 'immutable-version', getLength: bytes.length,
        checksum: Buffer.from(upload.sha256, 'hex').toString('base64'), contentType: upload.contentType,
        body: () => Readable.from([bytes.subarray(0, 30), bytes.subarray(30)]), presignOrigin: 'https://upload.example.invalid' };
    const client = { send: async (command: GetObjectCommand | HeadObjectCommand | PutObjectCommand) => {
        calls.push(command);
        if (command instanceof HeadObjectCommand) return { ContentLength: f.bytes.length, ContentType: f.contentType,
            ChecksumSHA256: f.checksum, VersionId: f.versionId, ETag: 'not-a-checksum' };
        if (command instanceof GetObjectCommand) return { Body: f.body(), ContentLength: f.getLength };
        assert(command instanceof PutObjectCommand); return {};
    } } as unknown as S3Client;
    const storage = createAtlasWorkspaceSourceStorage({ client, bucket: 'fixture-private-bucket', uploadOrigin: 'https://upload.example.invalid',
        presign: (async (_client: unknown, command: GetObjectCommand | PutObjectCommand, options: Row) => {
            grants.push({ command, options }); return `${f.presignOrigin}/fixture?signature=${grants.length}`;
        }) as never });
    return { ...f, state: f, client, storage };
}

test('private storage: exact independent create-only grant and version-bound decoded completion', async () => {
    const f = await storageFixture(), first = await f.storage.grant(f.upload, LATER, NOW), second = await f.storage.grant(f.upload, LATER, NOW);
    assert.notEqual(first.url, second.url); assert.equal(first.id, second.id); assert.equal(first.method, 'PUT');
    assert.equal(first.headers['If-None-Match'], '*'); assert.equal(first.headers['x-amz-acl'], 'private');
    assert.equal(first.expiresAt, new Date(+NOW + 600000).toISOString());
    const input = f.grants[0].command.input;
    assert.equal(input.Key, f.upload.objectRef); assert.equal(input.ContentLength, f.bytes.length);
    assert.equal(input.ChecksumSHA256, f.state.checksum); assert.equal(input.IfNoneMatch, '*');
    assert.deepEqual([...f.grants[0].options.unhoistableHeaders], ['x-amz-checksum-sha256', 'x-amz-acl']);
    const result = await f.storage.verify(f.upload);
    assert.deepEqual(result, { objectRef: f.upload.objectRef, sha256: f.upload.sha256, byteCount: f.bytes.length,
        contentType: 'image/jpeg', width: 32, height: 48, versionId: f.state.versionId });
    assert.equal((f.calls.find(command => command instanceof GetObjectCommand) as GetObjectCommand).input.VersionId, f.state.versionId);
    assert(!JSON.stringify(result).includes('signature')); assert(!JSON.stringify(result).includes('ETag'));
});

test('private storage: dishonest metadata, truncated bytes, decoder failures and stale grant origins fail closed', async () => {
    for (const change of [
        (f: Awaited<ReturnType<typeof storageFixture>>) => { f.state.checksum = Buffer.alloc(32).toString('base64'); },
        (f: Awaited<ReturnType<typeof storageFixture>>) => { f.state.contentType = 'image/png'; },
        (f: Awaited<ReturnType<typeof storageFixture>>) => { f.state.getLength++; },
        (f: Awaited<ReturnType<typeof storageFixture>>) => { f.state.body = () => Readable.from([Buffer.alloc(f.bytes.length)]); },
        (f: Awaited<ReturnType<typeof storageFixture>>) => { f.state.body = () => Readable.from([f.bytes.subarray(0, 40)]); },
    ]) { const f = await storageFixture(); change(f); await assert.rejects(f.storage.verify(f.upload), /WORKSPACE_UPLOAD_UNVERIFIED/); }
    const f = await storageFixture(), bytes = Buffer.alloc(256, 'x'); f.state.bytes = bytes; f.state.getLength = bytes.length;
    f.state.checksum = Buffer.from(preparationBytesHash(bytes), 'hex').toString('base64'); f.state.body = () => Readable.from([bytes]);
    await assert.rejects(f.storage.verify({ ...f.upload, sha256: preparationBytesHash(bytes), byteCount: bytes.length }));
    f.state.presignOrigin = 'https://different.example.invalid';
    await assert.rejects(f.storage.grant(f.upload, LATER, NOW), /WORKSPACE_STORAGE_GRANT_INVALID/);
    await assert.rejects(f.storage.grant(f.upload, NOW, NOW), /WORKSPACE_UPLOAD_EXPIRED/);
});

test('private storage: source capabilities reject cross-owner, mutable writes, corrupt evidence and abort uncooperative streams', async () => {
    const f = await storageFixture(), media = f.storage.forSource(f.source);
    await assert.rejects(media.storage.read(f.upload.objectRef.replace(f.source.sourceId, `atlas-${randomUUID()}`), 1024), /WORKSPACE_STORAGE_SCOPE_INVALID/);
    await assert.rejects(media.storage.create(f.upload.objectRef, f.bytes, 'image/jpeg', f.upload.sha256), /WORKSPACE_STORAGE_SCOPE_INVALID/);
    const evidenceKey = `ai-grader-v2/${f.source.sourceOwnerId}/${f.source.sourceId}/source-evidence/${f.upload.sha256}.jpg`;
    await media.storage.create(evidenceKey, f.bytes, 'image/jpeg', f.upload.sha256);
    const created = f.calls.find(command => command instanceof PutObjectCommand) as PutObjectCommand;
    assert.equal(created.input.IfNoneMatch, '*'); assert.equal(created.input.ACL, 'private');
    await assert.rejects(media.storage.create(evidenceKey, Buffer.alloc(f.bytes.length), 'image/jpeg', f.upload.sha256), /WORKSPACE_UPLOAD_UNVERIFIED/);
    await assert.rejects(media.stagingUpload(f.upload.objectRef), /WORKSPACE_STORAGE_SCOPE_INVALID/);
    await media.stagingUpload(`ai-grader-v2/${f.source.sourceOwnerId}/${f.source.sourceId}/prepare-staging/front/${randomUUID()}/rectified.webp`);
    assert.equal(f.grants[0].options.unhoistableHeaders, undefined, 'worker staging URL carries the fixed private ACL in its signed query');
    f.state.body = () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: () => new Promise(() => {}) }) }) as never;
    const controller = new AbortController(), reading = f.storage.readCapture(f.upload, controller.signal);
    setImmediate(() => controller.abort()); await assert.rejects(reading, /WORKSPACE_STORAGE_READ_ABORTED/);
});

test('private worker: fixed separate original endpoints, exact auth, bounded payloads and no retry', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const worker = createAtlasWorkspacePreparationWorker(workerConfig, (async (url: string, init: RequestInit) => {
        calls.push({ url, init }); return Response.json({ accepted: true });
    }) as typeof fetch);
    await worker.invoke('geometry', { imageUrl: 'https://upload.example.invalid/exact', matColor: 'BLACK' });
    await worker.invoke('prepare', { preparationBinding: { requestId: randomUUID() } });
    assert.deepEqual(calls.map(call => call.url), ['https://color.example.invalid/geometry', 'https://cpu.example.invalid/prepare']);
    assert.equal((calls[0].init.headers as Row).authorization, `Bearer ${workerConfig.apiKey}`);
    assert.equal((calls[1].init.headers as Row).authorization, `Bearer ${workerConfig.preparationApiKey}`);
    assert(calls.every(call => call.init.method === 'POST' && call.init.redirect === 'error'
        && call.init.signal instanceof AbortSignal));
    await assert.rejects(worker.invoke('prepare', { tooLarge: 'x'.repeat(65537) }), /WORKSPACE_SOURCE_HOST_INVALID/);
    assert.equal(calls.length, 2);
    for (const response of [() => Promise.reject(new Error('connection lost')), () => new Response('html'),
        () => Response.json({ tooLarge: 'x'.repeat(524288) }), () => new Response('broken', { headers: { 'content-type': 'application/json' } })]) {
        let attempted = 0; const failed = createAtlasWorkspacePreparationWorker(workerConfig, (async () => { attempted++; return response(); }) as typeof fetch);
        await assert.rejects(failed.invoke('geometry', {})); assert.equal(attempted, 1);
    }
    assert.throws(() => createAtlasWorkspacePreparationWorker({ ...workerConfig, preparationOrigin: 'https://cpu.example.invalid/prepare' }));
});

function databaseFixture() {
    const cardId = randomUUID(), creatorId = randomUUID(), actorId = randomUUID(), cohortId = randomUUID(), pilotId = randomUUID();
    const config = { mode: 'LOCAL_FIXTURE' as const, staffOrigin: 'https://staff.example.invalid', staffDeploymentId: 'fixture-staff',
        staffReleaseSha: 'a'.repeat(40), staffConfigHash: 'b'.repeat(64), configHash: 'c'.repeat(64), sourceConfigHash: 'd'.repeat(64),
        sourceDeploymentId: 'fixture-source', sourceReleaseSha: 'e'.repeat(40), allowedPhoneHashes: ['f'.repeat(64)] };
    const staff = { enabled: true, mode: config.mode, origin: config.staffOrigin, deploymentId: config.staffDeploymentId,
        releaseSha: config.staffReleaseSha, configHash: config.staffConfigHash, revision: 1 };
    const workspace = { enabled: true, mode: config.mode, releaseSha: config.staffReleaseSha, configHash: config.configHash,
        maxCards: 10, cohortId, expiresAt: LATER, intakeEnabled: true, preparationEnabled: true, claimsEnabled: true, astraEnabled: true };
    const sourceControl = { enabled: true, mode: config.mode, releaseSha: config.staffReleaseSha, configHash: config.configHash,
        sourceConfigHash: config.sourceConfigHash, sourceDeploymentId: config.sourceDeploymentId, sourceReleaseSha: config.sourceReleaseSha,
        cohortId, pilotId, expiresAt: LATER, revision: 3, physicalReserveMicroUsd: 23000n, preparationReserveMicroUsd: 41000n, registrationReserveMicroUsd: 12000n };
    const identity = { id: actorId, role: 'REVIEWER', phoneHash: config.allowedPhoneHashes[0], revokedAt: null, accessVersion: 2 };
    const session = { identityId: actorId, accessVersion: 2, controlRevision: 1, createdAt: new Date(+NOW - 60000),
        expiresAt: LATER, revokedAt: null, browserHash: '7'.repeat(64) }, browser = { controlRevision: 1, createdAt: new Date(+NOW - 120000), expiresAt: LATER };
    const source = { sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` };
    const operations = new Map<string, Row>(), entries: Row = {}, sides: Row = {};
    const row = (value: Row) => ({ ...value, canonical: canonical(value), contentHash: preparationHash(value) });
    const op = (action: string, result: Row, id: string = randomUUID()) => { const value = { id, actorId, operationId: randomUUID(), cardId,
        action, inputHash: '9'.repeat(64), result }; operations.set(id, row(value)); return value; };
    for (const side of ['FRONT', 'BACK']) {
        const id = randomUUID(), sha256 = (side === 'FRONT' ? '1' : '2').repeat(64), objectRef =
            `ai-grader-v2/${source.sourceOwnerId}/${source.sourceId}/original/recapture-${id}/${side.toLowerCase()}.jpg`;
        const upload = { id, cardId, side, ...source, objectRef, sha256, byteCount: 1024, contentType: 'image/jpeg' };
        const verification = { objectRef, sha256, byteCount: 1024, contentType: 'image/jpeg', width: 800, height: 1000 };
        op('upload-plan', { upload }, id); const completion = op('upload-complete', { uploadId: id, verification });
        entries[side] = { upload, verification }; sides[side] = { uploadId: id, verificationId: completion.id };
    }
    const captureHash = preparationHash({ source, captureRevision: 1,
        sides: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { uploadId: entries[side].upload.id, ...entries[side].verification }])) });
    const binding = { captureRevision: 1, captureHash, claimFence: 1, workflowRevision: 8 };
    const request: AtlasWorkspaceSourceRequest = { requestId: randomUUID(), cardId, scope: { actorId, sessionHash: '3'.repeat(64), controlRevision: 1 }, binding };
    const card: Row = { id: cardId, creatorId, cohortId, revision: 8, state: 'IN_PROGRESS', stage: 'PREPARATION', specimenId: null,
        source, captureRevision: 1, captureHash, claimFence: 1, sides,
        claim: { id: randomUUID(), actorId, kind: 'HUMAN', fence: 1, captureRevision: 1, captureHash, accessVersion: 2, controlRevision: 1 },
        identity: { category: 'SPORTS', playerName: 'Example Player' }, workspace: { identity: { category: 'SPORTS', playerName: 'Example Player' },
            pending: { requestId: request.requestId, action: 'PREPARE_SIDE', side: 'FRONT', binding } } };
    const intent = op('MANUAL_ACTION', { requestId: request.requestId, action: 'PREPARE_SIDE', payload: { side: 'FRONT' }, binding, phase: 'REQUESTED' }, request.requestId);
    const policy = { version: 'atlas-workspace-bridge-policy-v1', pilotId, workspaceCardIds: [cardId, ...Array.from({ length: 9 }, () => randomUUID())],
        expiresAt: LATER.toISOString(), maxOperationsPerCard: 50, maxTotalMicroUsd: 90000000, maxCardMicroUsd: 9000000,
        reservationPerOperationMicroUsd: 100000, maxWorkerCalls: 2, deadlineMs: 200000 };
    const bridge = { enabled: true, mode: config.mode, releaseSha: config.staffReleaseSha, policyCanonical: canonical(policy), policyHash: preparationHash(policy) };
    const sourceRows = new Map<string, Row>(), queries: string[] = [], writes: string[] = [];
    const f = { cardRow: row(card), card, intent, operations, entries, staff, workspace, sourceControl, identity, session, browser,
        bridge, policy, request, config, queries, writes, sourceRows, admission: null as Row | null,
        usage: { total: '3500000', card: '0', operations: 0, attempts: 0, overrun: false }, transactions: 0 };
    const key = (values: unknown[]) => values.slice(0, 3).join('/');
    const database = {
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const sql = strings.join('?'); queries.push(sql);
            if (sql.includes('clock_timestamp() AS now')) return [{ now: NOW }];
            if (sql.includes('workspace_pilot_budget_usage')) return [f.usage];
            if (sql.includes('"StaffControl"')) return [staff];
            if (sql.includes('"StaffWorkspaceControl"')) return [workspace];
            if (sql.includes('"StaffWorkspaceSourceControl"')) return [sourceControl];
            if (sql.includes('"StaffGradingBridgeControl"')) return [bridge];
            if (sql.includes('"StaffIdentity"') || sql.includes('lock_workspace_private_actor')) return [identity];
            if (sql.includes('"StaffSession"')) return [session];
            if (sql.includes('"StaffBrowser"')) return [browser];
            if (sql.includes('"StaffWorkspaceCard"') || sql.includes('lock_workspace_private_card')) return [f.cardRow];
            if (sql.includes('"StaffWorkspaceSourceAdmission"')) return f.admission ? [f.admission] : [];
            if (sql.includes('"StaffWorkspaceOperation"')) return sql.includes('action IN')
                ? [...operations.values()].filter(value => value.cardId === values[0] && value.actorId === values[1]
                    && ['MANUAL_ACTION', 'MACHINE_SOURCE_ACTION'].includes(value.action) && value.result.requestId === values[2])
                : operations.has(String(values[0])) ? [operations.get(String(values[0]))] : [];
            if (sql.includes('"StaffWorkspaceSourceOperation"')) return sourceRows.has(key(values)) ? [structuredClone(sourceRows.get(key(values)))] : [];
            if (sql.includes('"StaffWorkspaceSourceActionPermit"') || sql.includes('lock_workspace_private_permit')) return [];
            throw new Error(`Unexpected fixture query: ${sql}`);
        },
        $executeRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
            const sql = strings.join('?'); writes.push(sql);
            if (sql.includes('pg_advisory_xact_lock') || sql.includes('lock_workspace_private_controls')) return 1;
            if (sql.includes('INSERT INTO atlas_staff."StaffWorkspaceSourceOperation"')) {
                const [id, requestId, cardId, cohortId, pilotId, purpose, side, sourceConfigHash, sourceControlRevision,
                    bindingCanonical, bindingHash, requestCanonical, requestHash, runId, runControlRevision, reservedMicroUsd, createdAt] = values;
                const key = [requestId, purpose, side].join('/'); assert(!sourceRows.has(key));
                sourceRows.set(key, { id, requestId, cardId, cohortId, pilotId, purpose, side, sourceConfigHash, sourceControlRevision,
                    bindingCanonical, bindingHash, requestCanonical, requestHash, runId, runControlRevision, reservedMicroUsd, createdAt,
                    gradingExecutionId: null, state: 'RESERVED', actualMicroUsd: null, costEvidenceHash: null,
                    dispatchedAt: null, finishedAt: null, resultCanonical: null, resultHash: null, failureCode: null }); return 1;
            }
            if (sql.includes("SET state='DISPATCHED'")) {
                const saved = [...sourceRows.values()].find(row => row.id === values[1]); assert(saved && saved.state === 'RESERVED');
                Object.assign(saved, { state: 'DISPATCHED', gradingExecutionId: values[0], dispatchedAt: NOW }); return 1;
            }
            if (sql.includes('SET state=?')) {
                const saved = [...sourceRows.values()].find(row => row.id === values[4]); assert(saved && saved.resultCanonical === null);
                Object.assign(saved, { state: values[0], resultCanonical: values[1], resultHash: values[2], failureCode: values[3], finishedAt: NOW }); return 1;
            }
            throw new Error(`Unexpected fixture mutation: ${sql}`);
        },
    } as unknown as Prisma.TransactionClient;
    let queue = Promise.resolve(); const inside = new AsyncLocalStorage<boolean>();
    const client = { $transaction: async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
        assert(!inside.getStore(), 'authority must reuse caller transaction, never nest while holding the staff advisory lock');
        const prior = queue; let release!: () => void; queue = new Promise(resolve => { release = resolve; }); await prior;
        f.transactions++; try { return await inside.run(true, () => work(database)); } finally { release(); }
    } } as unknown as PrismaClient;
    const authority = createAtlasWorkspaceSourceAuthority(client, config), ledger = createAtlasWorkspaceSourceLedger(client, authority, request);
    const input = { requestId: request.requestId, cardId, purpose: 'PHYSICAL_GEOMETRY' as const, side: 'FRONT' as const,
        binding: { sourceHash: entries.FRONT.verification.sha256, ...binding }, request: { matColor: 'BLACK', sourceHash: entries.FRONT.verification.sha256 } };
    return { ...f, state: f, client, database, authority, ledger, input, saveCard: () => { f.cardRow = row(card); },
        saveIntent: () => { operations.set(intent.id, row(intent)); } };
}

test('private authority: current staff, exact controls, immutable source and upload/completion records are independently checked', async () => {
    const f = databaseFixture(), authorized = await f.authority.load(f.request);
    assert.equal(authorized.card.source.sourceId, `atlas-${f.request.cardId}`); assert.equal(Object.keys(authorized.originals).length, 2);
    const read = await f.authority.loadUpload({ cardId: f.request.cardId, uploadId: f.entries.FRONT.upload.id });
    assert.deepEqual(read.verification, f.entries.FRONT.verification);
    for (const change of [
        (g: ReturnType<typeof databaseFixture>) => { g.sourceControl.sourceConfigHash = '0'.repeat(64); },
        (g: ReturnType<typeof databaseFixture>) => { g.sourceControl.cohortId = randomUUID(); },
        (g: ReturnType<typeof databaseFixture>) => { g.sourceControl.expiresAt = NOW; },
        (g: ReturnType<typeof databaseFixture>) => { g.session.expiresAt = NOW; },
        (g: ReturnType<typeof databaseFixture>) => { g.identity.accessVersion++; },
        (g: ReturnType<typeof databaseFixture>) => { g.identity.phoneHash = '0'.repeat(64); },
        (g: ReturnType<typeof databaseFixture>) => { g.card.claimFence++; g.saveCard(); },
        (g: ReturnType<typeof databaseFixture>) => { g.card.source.sourceOwnerId = `atlas-staff-${randomUUID()}`; g.saveCard(); },
        (g: ReturnType<typeof databaseFixture>) => { g.state.cardRow.canonical = g.state.cardRow.canonical.replace('IN_PROGRESS', 'WAITING'); },
        (g: ReturnType<typeof databaseFixture>) => { const row = g.operations.get(g.card.sides.FRONT.verificationId)!; row.canonical = '{}'; },
        (g: ReturnType<typeof databaseFixture>) => { g.intent.result.binding = { ...g.request.binding, workflowRevision: 7 }; g.saveIntent(); },
        (g: ReturnType<typeof databaseFixture>) => { g.intent.result.payload.side = 'BACK'; g.saveIntent(); },
    ]) { const g = databaseFixture(); change(g); await assert.rejects(g.authority.load(g.request), /WORKSPACE_/); }
});

test('private authority: machine access uses retained current identity version without a browser or fabricated session', async () => {
    const f = databaseFixture(); f.card.claim.kind = 'ASTRA'; f.saveCard();
    const request: AtlasWorkspaceSourceRequest = { ...f.request, scope: { actorKind: 'MACHINE', actorId: f.identity.id,
        accessVersion: 2, controlRevision: 1, runId: randomUUID(), runRevision: 4, leaseFence: 1, runControlRevision: 3 } };
    await f.authority.current(f.database, request);
    assert(!f.queries.some(sql => sql.includes('"StaffSession"') || sql.includes('"StaffBrowser"')));
    f.identity.accessVersion++; await assert.rejects(f.authority.current(f.database, request), /WORKSPACE_SOURCE_SCOPE_CHANGED/);
    f.identity.accessVersion--; f.card.claim.accessVersion++; f.saveCard();
    await assert.rejects(f.authority.current(f.database, request), /WORKSPACE_SOURCE_SCOPE_CHANGED/);
});

test('private prepared image reads: current observers and reviewers may watch Astra without acquiring its action authority', async () => {
    const f = databaseFixture(); f.card.claim.kind = 'ASTRA'; f.card.claim.actorId = randomUUID(); f.saveCard();
    await f.authority.loadPrepared(f.request);
    f.identity.role = 'OBSERVER'; await f.authority.loadPrepared(f.request);
    await assert.rejects(f.authority.load(f.request), /WORKSPACE_SOURCE_SCOPE_CHANGED/);
    f.identity.accessVersion++; await assert.rejects(f.authority.loadPrepared(f.request), /WORKSPACE_SOURCE_SCOPE_CHANGED/);
    f.identity.accessVersion--; f.card.captureRevision++; f.saveCard();
    await assert.rejects(f.authority.loadPrepared(f.request), /WORKSPACE_SOURCE_SCOPE_CHANGED/);
});

test('private preparation transactions lock workspace before original source and head rows', async () => {
    const calls: string[] = [], sourceId = `atlas-${randomUUID()}`, ownerId = `atlas-staff-${randomUUID()}`;
    const database = {
        $executeRaw: async (query: { strings?: string[] } | TemplateStringsArray) => {
            calls.push(Array.isArray(query) ? query.join('?') : (query as { strings: string[] }).strings.join('?')); return 1;
        },
        $queryRaw: async (query: { strings: string[] }) => { calls.push(query.strings.join('?')); return [{ id: sourceId }]; },
        aiGraderV2Session: { findFirst: async () => ({ id: sourceId, createdByUserId: ownerId, workflowState: 'DRAFT' }) },
        aiGraderV2PreparationHead: { findMany: async () => [] },
    };
    const client = { $transaction: async (work: (tx: typeof database) => Promise<unknown>) => work(database) } as unknown as PrismaClient;
    const store = createAtlasWorkspacePreparationStore(client);
    await store.transaction({ sessionId: sourceId, createdByUserId: ownerId }, async () => { calls.push('work'); });
    assert.match(calls[0], /pg_advisory_xact_lock/); assert.match(calls[1], /AiGraderV2Session[\s\S]*FOR UPDATE/);
    assert.match(calls[2], /AiGraderV2PreparationHead[\s\S]*FOR UPDATE/); assert.equal(calls[3], 'work');
});

test('private authority: control metadata may advance; only the exact immutable source admission permits a specimen link', async () => {
    const f = databaseFixture(); f.intent.result.action = 'INITIALIZE_REPORT'; f.intent.result.payload = {};
    f.card.workspace.pending.action = 'INITIALIZE_REPORT'; delete f.card.workspace.pending.side; f.saveIntent(); f.saveCard();
    const before = await f.authority.load(f.request);
    f.card.revision++; f.card.claim.mode = 'STEP'; f.saveCard(); await f.authority.recheck(f.request, before);
    f.card.specimenId = f.card.id; f.card.revision++; f.saveCard();
    await assert.rejects(f.authority.recheck(f.request, before), /WORKSPACE_SOURCE_ADMISSION_CHANGED/);
    const proof = { version: 'atlas-workspace-source-admission-v1', requestId: f.request.requestId, workspaceCardId: f.card.id,
        actorKind: 'HUMAN', captureHash: f.card.captureHash, claimFence: f.card.claimFence,
        sourceRevision: NOW.toISOString(), sourceHash: '4'.repeat(64), evidenceHash: '5'.repeat(64), sourceConfigHash: f.config.sourceConfigHash };
    f.state.admission = { requestId: f.request.requestId, cardId: f.card.id, specimenId: f.card.id, ...f.card.source,
        sourceRevision: proof.sourceRevision, sourceHash: proof.sourceHash, evidenceHash: proof.evidenceHash, sourceConfigHash: f.config.sourceConfigHash,
        actorKind: 'HUMAN', actorId: f.identity.id, accessVersion: f.identity.accessVersion,
        sessionHash: '3'.repeat(64), admissionCanonical: canonical(proof), admissionHash: preparationHash(proof) };
    await f.authority.recheck(f.request, before);
    f.card.workspace.identity.playerName = 'Different Player'; f.saveCard();
    await assert.rejects(f.authority.recheck(f.request, before), /WORKSPACE_SOURCE_SCOPE_CHANGED/);
});

test('private ledger: concurrent retries reserve once, dispatch once and preserve unknown cost without nested transactions', async () => {
    const f = databaseFixture(), claims = await Promise.all(Array.from({ length: 8 }, () => f.ledger.claim(f.input)));
    assert.equal(claims.filter(claim => claim.claimed).length, 1); assert.equal(f.sourceRows.size, 1);
    const row = claims[0].row;
    assert.equal(row.reservedMicroUsd, 23000n); assert.equal(row.sourceControlRevision, 3);
    assert.equal(row.bindingCanonical, canonical(f.request.binding));
    assert.equal(row.requestCanonical, canonical({ binding: f.input.binding, request: f.input.request }));
    assert.equal(row.actualMicroUsd, null); assert.equal(row.costEvidenceHash, null);
    await assert.rejects(f.ledger.complete(f.input, row.id, { state: 'SUCCEEDED' }), /WORKSPACE_SOURCE_DISPATCH_REQUIRED/);
    const dispatches = await Promise.allSettled([f.ledger.dispatch(f.input, row.id), f.ledger.dispatch(f.input, row.id)]);
    assert.equal(dispatches.filter(result => result.status === 'fulfilled').length, 1);
    const unknown = { state: 'UNKNOWN' as const, failureCode: 'WORKSPACE_WORKER_OUTCOME_UNCONFIRMED' };
    const saved = await f.ledger.complete(f.input, row.id, unknown); assert.equal(saved.state, 'UNKNOWN');
    assert.equal(saved.actualMicroUsd, null); assert.equal(saved.reservedMicroUsd, 23000n);
    assert.equal((await f.ledger.complete(f.input, row.id, unknown)).id, row.id);
    await assert.rejects(f.ledger.complete(f.input, row.id, { state: 'SUCCEEDED' }), /WORKSPACE_SOURCE_RESULT_CHANGED/);
    await assert.rejects(f.ledger.claim({ ...f.input, request: { ...f.input.request, matColor: 'WHITE' } }), /WORKSPACE_SOURCE_REQUEST_CHANGED/);
    assert.equal((await f.ledger.claim(f.input)).claimed, false);
});

test('private ledger: fixed pilot ceilings deny new work and initialization dispatch reuses its original grading transaction', async () => {
    for (const change of [
        (f: ReturnType<typeof databaseFixture>) => { f.state.usage.total = '89999999'; },
        (f: ReturnType<typeof databaseFixture>) => { f.state.usage.card = '8999999'; },
        (f: ReturnType<typeof databaseFixture>) => { f.state.usage.overrun = true; },
        (f: ReturnType<typeof databaseFixture>) => { f.sourceControl.physicalReserveMicroUsd = 0n; },
        (f: ReturnType<typeof databaseFixture>) => { f.bridge.enabled = false; },
    ]) { const f = databaseFixture(); change(f); await assert.rejects(f.ledger.claim(f.input), /WORKSPACE_SOURCE_/); assert.equal(f.sourceRows.size, 0); }
    const f = databaseFixture(); f.intent.result.action = 'INITIALIZE_REPORT'; f.intent.result.payload = {}; f.saveIntent();
    f.card.workspace.pending.action = 'INITIALIZE_REPORT'; delete f.card.workspace.pending.side; f.saveCard();
    const input = { ...f.input, purpose: 'INITIALIZE_REPORT' as const, side: 'PAIR' as const };
    const claim = await f.ledger.claim(input); assert.equal(claim.row.reservedMicroUsd, 0n);
    await assert.rejects(f.ledger.dispatch(input, claim.row.id), /WORKSPACE_INITIALIZATION_RESERVATION_REQUIRED/);
    const gradingExecutionId = randomUUID(), count = f.state.transactions;
    await f.client.$transaction(tx => f.ledger.dispatch(input, claim.row.id, gradingExecutionId, tx));
    assert.equal(f.state.transactions, count + 1); assert.equal((await f.ledger.read(input))?.gradingExecutionId, gradingExecutionId);
});

test('private host: signature validation precedes all side effects; current authority is checked again before returning a grant', async () => {
    const f = await storageFixture(); let loads = 0, denied = false;
    const card = { id: f.upload.cardId, sides: { FRONT: { uploadId: f.upload.id } }, state: 'DRAFT', claim: null, specimenId: null };
    const authority = { loadUpload: async () => { loads++; if (denied && loads % 2 === 0) throw new Error('WORKSPACE_SOURCE_SCOPE_CHANGED');
        return { card, upload: f.upload, verification: null, workspace: { intakeEnabled: true, expiresAt: LATER }, now: NOW }; } };
    const host = createAtlasWorkspaceSourceHost({ bridgeConfig, worker: workerConfig, client: {} as PrismaClient,
        authority: authority as never, storage: f.storage, initialization: () => { throw new Error('uploads never initialize'); },
        fetchImpl: async () => { throw new Error('uploads never invoke a worker'); } } as AtlasWorkspaceSourceHostDependencies);
    const packet = signWorkspaceRequest(bridgeConfig, 'UPLOAD_GRANT', { cardId: f.upload.cardId, uploadId: f.upload.id });
    await assert.rejects(host.receive(packet.body, '0'.repeat(64)), /WORKSPACE_SERVICE_AUTHENTICATION_REQUIRED/);
    assert.equal(loads, 0); assert.equal(f.grants.length, 0);
    const result = await host.receive(packet.body, packet.signature), grant = JSON.parse(result.bytes.toString('utf8'));
    assert.equal(grant.id, f.upload.id); assert.equal(loads, 2); assert.equal(result.contentType, 'application/json');
    assert.equal(result.signature, workspaceResponseSignature(bridgeConfig, packet.claims, result.bytes, result.contentType));
    denied = true; await assert.rejects(host.receive(packet.body, packet.signature), /WORKSPACE_SOURCE_SCOPE_CHANGED/);
    assert.equal(loads, 4);
});

test('private worker: preparation and registration use explicit separate credentials and pinned endpoints', async () => {
    const calls: Row[] = [], config = { ...workerConfig, registrationOrigin: 'https://registration.example.invalid', registrationApiKey: 'fixture-map-registration-key',
        mapReceiptKey: 'm'.repeat(64), mapReceiptKeyId: 'fixture-map' };
    const worker = createAtlasWorkspacePreparationWorker(config, (async (url, init) => { calls.push({ url, init }); return Response.json({ syntheticOnly: true }); }) as typeof fetch);
    await worker.invoke('map-registration', { side: 'FRONT' });
    assert.equal(calls[0].url, `${config.registrationOrigin}/map-registration`); assert.equal(calls[0].init.headers.authorization, `Bearer ${config.registrationApiKey}`);
    assert.throws(() => createAtlasWorkspacePreparationWorker({ ...workerConfig, preparationApiKey: workerConfig.apiKey }), /WORKSPACE_PREPARATION_CREDENTIAL_INVALID/);
    assert.throws(() => createAtlasWorkspacePreparationWorker({ ...workerConfig, preparationApiKey: undefined as never }), /WORKSPACE_PREPARATION_CREDENTIAL_INVALID/);
    assert.throws(() => createAtlasWorkspacePreparationWorker({ ...config, mapReceiptKey: undefined }), /WORKSPACE_MAP_WORKER_CONFIGURATION_INVALID/);
    await assert.rejects(createAtlasWorkspacePreparationWorker(workerConfig).invoke('map-registration', {}));
});

test('private map reference: only exact server-selected evidence is readable; original-photo scope stays closed', async () => {
    const f = await storageFixture(), key = 'ai-grader-v2/original-map-owner/original-map-session/prepared/front/inspection.webp';
    const reference = f.storage.mapReference({ storageKey: key, sha256: f.upload.sha256 });
    assert.deepEqual(await reference.read(), f.bytes); assert.match(await reference.readUrl(), /^https:\/\/upload.example.invalid\//);
    await assert.rejects(f.storage.readCapture({ ...f.upload, objectRef: key }), /WORKSPACE_STORAGE_SCOPE_INVALID/);
    await assert.rejects(f.storage.mapReference({ storageKey: key, sha256: '0'.repeat(64) }).read(), /WORKSPACE_MAP_REFERENCE_CHANGED/);
    for (const storageKey of ['https://other.invalid/file', key.replace('prepared', '..'), key + '?public=true']) assert.throws(() => f.storage.mapReference({ storageKey, sha256: f.upload.sha256 }), /WORKSPACE_MAP_REFERENCE_INVALID/);
});

test('private registration ledger: a pair action reserves each side once and rejects missing budget or unrelated intent', async () => {
    const f = databaseFixture(), input = { ...f.input, purpose: 'MAP_REGISTRATION' as const };
    await assert.rejects(f.ledger.claim(input), /WORKSPACE_MAP_REGISTRATION_INTENT_REQUIRED/);
    f.intent.result.action = 'REGISTER_MAP'; f.intent.result.payload = {}; f.saveIntent();
    f.card.workspace.pending.action = 'REGISTER_MAP'; delete f.card.workspace.pending.side; f.saveCard();
    const claims = await Promise.all([f.ledger.claim(input), f.ledger.claim(input)]);
    assert.equal(claims.filter(value => value.claimed).length, 1); assert.equal(claims[0].row.reservedMicroUsd, 12000n);
    f.sourceControl.registrationReserveMicroUsd = 0n;
    await assert.rejects(f.ledger.claim({ ...input, side: 'BACK' }), /WORKSPACE_SOURCE_RESERVATION_INVALID/);
    assert.equal(f.sourceRows.size, 1);
    assert(f.queries.some(sql => sql.includes('lock_workspace_private_actor')));
    assert(f.queries.some(sql => sql.includes('lock_workspace_private_card')));
    assert(!f.queries.some(sql => /Staff(?:Control|Identity|Session|Browser|WorkspaceCard|WorkspaceOperation)".*FOR SHARE/.test(sql)));
});
