import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import test from 'node:test';
import sharp from 'sharp';
import type { Prisma, PrismaClient } from '@prisma/client';
import { canonical } from '@atlas/service-bridge/protocol';
import { captureProposalRef, selectedCapturePreparation } from '@atlas/operator/capture-protocol';
import { SPEEDSTER_RULE_VERSION } from '../lib/ai-grader-v2/contracts';
import { canonicalizeNewSpeedsterSessionIdentity } from '../lib/ai-grader-v2/identity';
import { createAtlasWorkspaceSource, createAtlasWorkspacePhysicalGeometry, createPrismaAtlasWorkspaceSessions,
    type AtlasWorkspaceSourceAuthority, type AtlasWorkspaceGeometryLedger, type AtlasWorkspaceGeometryResult,
    type AtlasAuthorizedWorkspaceSource, type AtlasWorkspaceSourceDependencies, type AtlasWorkspaceSourceRequest } from '../lib/server/atlasWorkspaceSource';
import { currentSpeedsterPreparationRelease } from '../lib/server/speedsterPreparationRelease';
import { preparationBytesHash, preparationHash } from '../lib/server/speedsterPreparationIntegrity';
import { issueSpeedsterColorGeometryReceipt, verifySpeedsterColorGeometryReceipt } from '../lib/server/speedsterColorGeometryAuthority';
import { savePreparedSpeedsterSessionCapture, validateSpeedsterSubmittedMapBinding } from '../lib/server/speedsterSessionCapture';
import { resolvePersistedSpeedsterPreparationCapture } from '../lib/server/speedsterPreparationCaptureEvidence';
import { parseSpeedsterMapSourceSession } from '../lib/server/speedsterCardTypeMaps';
import { parseSpeedsterColorGeometryProposal } from '../lib/ai-grader-v2/color-geometry';
import type { AtlasWorkspaceMachineProof, AtlasWorkspaceMachineStep } from '../lib/server/atlasWorkspaceSourceMachine';
import { FixturePreparationStorage, FixturePreparationStore, fixturePreparationColor, fixturePreparationIdentity,
    fixturePreparationInput, fixturePreparationTransform } from './fixtures/speedsterPreparation';
import { preparedCaptureIdentity, preparedCaptureReceiptEnv } from './fixtures/speedsterPreparedCapture';

const SIDES = ['FRONT', 'BACK'] as const;
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
const images = Promise.all([
    sharp({ create: { width: 800, height: 1000, channels: 3, background: '#bc9e76' } }).jpeg().toBuffer(),
    sharp({ create: { width: 800, height: 1000, channels: 3, background: '#c93fa1' } }).jpeg().toBuffer(),
    sharp({ create: { width: 1270, height: 1778, channels: 3, background: '#afa690' } }).webp().toBuffer(),
    sharp({ create: { width: 1350, height: 1858, channels: 3, background: '#4a729d' } }).webp().toBuffer(),
]);

async function fixture() {
    const [front, back, rectified, inspection] = await images;
    const cardId = randomUUID(), actorId = randomUUID(), creatorId = randomUUID();
    const source = { sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` };
    const store = new FixturePreparationStore(), storage = new FixturePreparationStorage();
    const lockContext = new AsyncLocalStorage<boolean>(), transaction = store.transaction;
    store.transaction = (owner, work) => transaction(owner, tx => lockContext.run(true, () => work(tx)));
    const originals = Object.fromEntries(SIDES.map((side, i) => {
        const bytes = [front, back][i], id = randomUUID();
        const objectRef = `ai-grader-v2/${source.sourceOwnerId}/${source.sourceId}/original/recapture-${id}/${side.toLowerCase()}.jpg`;
        storage.objects.set(objectRef, bytes);
        return [side, { upload: { id, cardId, side, sourceId: source.sourceId, sourceOwnerId: source.sourceOwnerId,
            objectRef, sha256: preparationBytesHash(bytes), byteCount: bytes.length, contentType: 'image/jpeg' },
        verification: { objectRef, sha256: preparationBytesHash(bytes), byteCount: bytes.length, contentType: 'image/jpeg', width: 800, height: 1000 } }];
    })) as AtlasAuthorizedWorkspaceSource['originals'];
    const captureHash = preparationHash({ source, captureRevision: 1,
        sides: Object.fromEntries(SIDES.map(side => [side, { uploadId: originals[side].upload.id, ...originals[side].verification }])) });
    const binding = { captureRevision: 1, captureHash, claimFence: 1, workflowRevision: 8 };
    const request: AtlasWorkspaceSourceRequest = { requestId: randomUUID(), cardId,
        scope: { actorId, sessionHash: 'd'.repeat(64), controlRevision: 1 }, binding };
    const corners = fixturePreparationInput().physicalQuad, inner = [{ x: .05, y: .05 }, { x: .95, y: .05 }, { x: .95, y: .95 }, { x: .05, y: .95 }];
    const current = {
        card: { id: cardId, creatorId, revision: 8, state: 'IN_PROGRESS', source, captureRevision: 1, captureHash, claimFence: 1,
            claim: { id: randomUUID(), kind: 'HUMAN', actorId, fence: 1, captureRevision: 1, captureHash },
            sides: Object.fromEntries(SIDES.map(side => [side, { uploadId: originals[side].upload.id, verificationId: randomUUID() }])),
            identity: { category: 'SPORTS', ...preparedCaptureIdentity }, workspace: {
                identity: { category: 'SPORTS', ...preparedCaptureIdentity }, cornerShape: 'SQUARE',
                preparation: Object.fromEntries(SIDES.map(side => [side, { status: 'BOUNDARY_SAVED', corners, matColor: 'BLACK' }])) as Record<string, Record<string, unknown>>,
                centering: {} as Record<string, Record<string, unknown>>,
                pending: { requestId: request.requestId, action: 'PREPARE_SIDE', side: 'FRONT' as string | undefined, binding },
            } }, originals,
        operation: { actorId, cardId, action: 'MANUAL_ACTION', result: { requestId: request.requestId,
            action: 'PREPARE_SIDE', payload: { side: 'FRONT' as string | undefined }, binding, phase: 'REQUESTED' } },
    };
    let revoked = false, sessionExists = false, loads = 0, rechecks = 0, ensured = 0, workerCalls = 0, physicalCalls = 0, bridgeCalls = 0, captureWrites = 0;
    let recheckHook: (() => void) | undefined;
    const authority: AtlasWorkspaceSourceAuthority = {
        load: async () => { loads++; if (revoked) throw new Error('WORKSPACE_SESSION_REVOKED'); return structuredClone(current) as unknown as AtlasAuthorizedWorkspaceSource; },
        recheck: async req => { rechecks++; recheckHook?.(); if (revoked) throw new Error('WORKSPACE_SESSION_REVOKED');
            assert.deepEqual(req.binding, { captureRevision: current.card.captureRevision, captureHash: current.card.captureHash,
                claimFence: current.card.claimFence, workflowRevision: current.card.revision }); },
    };
    const ledgerRows = new Map<string, { claimId: string; result: AtlasWorkspaceGeometryResult }>();
    const ledger: AtlasWorkspaceGeometryLedger = {
        read: async binding => structuredClone(ledgerRows.get(preparationHash(binding))?.result ?? null),
        claim: async binding => { const key = preparationHash(binding), row = ledgerRows.get(key);
            if (row) return { claimed: false, ...structuredClone(row) };
            const created = { claimId: randomUUID(), result: { state: 'PENDING' as const } }; ledgerRows.set(key, created);
            return { claimed: true, ...structuredClone(created) }; },
        complete: async (binding, claimId, result) => { const row = ledgerRows.get(preparationHash(binding));
            assert.equal(row?.claimId, claimId); assert(row); row.result = structuredClone(result); return result; },
    };
    const issueReceipt: typeof issueSpeedsterColorGeometryReceipt = binding => issueSpeedsterColorGeometryReceipt(binding, { env: preparedCaptureReceiptEnv });
    const verifyReceipt: typeof verifySpeedsterColorGeometryReceipt = (receipt, binding) => verifySpeedsterColorGeometryReceipt(receipt, binding, { env: preparedCaptureReceiptEnv });
    const physical = { invoke: async (_body: unknown) => { physicalCalls++; assert.notEqual(lockContext.getStore(), true);
        return { ok: true, status: 200, payload: { corners: null, colorGeometry: { ...fixturePreparationColor,
            mode: 'PHYSICAL_OUTER', contrastFloorDeltaE: 18, minimumSideSupport: .7 } } }; } };
    const geometry = createAtlasWorkspacePhysicalGeometry({ ledger, authority, readUrl: async key => `fixture-read:${key}`,
        invoke: body => physical.invoke(body), issueReceipt });
    const database = { $executeRaw: async () => 1 } as unknown as Prisma.TransactionClient;
    const capture: Parameters<typeof savePreparedSpeedsterSessionCapture>[0] = {
        preparationStore: { read: store.read, transaction: (owner, work) => store.transaction(owner, tx => work({ ...tx, database })) },
        preparationStorage: storage,
        findSession: async () => store.session, updateSession: async () => { throw new Error('legacy save forbidden'); },
        validateMapBinding: (session, binding, input) => validateSpeedsterSubmittedMapBinding(session, binding, input, {
            loadActiveMap: async () => null, hashEvidence: async () => { throw new Error('NO_MAP has no external map evidence'); } }),
        verifyColorGeometryReceipt: verifyReceipt, loadLockedMap: async () => null,
        persistPreparedCapture: async (_tx, data, evidence) => { assert.equal(store.locked, true); assert.equal(evidence.length, 4);
            captureWrites++; store.session = { ...store.session, ...data } as typeof store.session; return store.session; },
    };
    const specimenId = randomUUID();
    const deps: Omit<AtlasWorkspaceSourceDependencies, 'preparation' | 'initialization'> & {
        preparation: Mutable<AtlasWorkspaceSourceDependencies['preparation']>;
        initialization: Mutable<AtlasWorkspaceSourceDependencies['initialization']>;
    } = {
        authority, geometry, capture, verifyColorReceipt: verifyReceipt,
        sessions: { find: async () => sessionExists ? structuredClone(store.session) : null,
            ensure: async () => { ensured++; if (!sessionExists) { sessionExists = true;
                store.session = { ...store.session, id: source.sourceId, createdByUserId: source.sourceOwnerId,
                    identity: canonicalizeNewSpeedsterSessionIdentity('SPORTS', preparedCaptureIdentity),
                    ruleVersion: SPEEDSTER_RULE_VERSION } as typeof store.session; }
                return structuredClone(store.session); } },
        preparation: { store, storage, approvedRelease: () => fixturePreparationIdentity,
            readUrl: async key => `fixture-read:${key}`, stagingUpload: async key => `fixture-put:${key}`,
            issueColorReceipt: issueReceipt, invokeWorker: async body => { workerCalls++; assert.notEqual(lockContext.getStore(), true);
                const binding = body.preparationBinding as Record<string, string>, attempt = store.attempts.get(binding.attemptId)!;
                for (const [role, url] of Object.entries(body.outputUploads as Record<string, string>)) {
                    storage.objects.set(url.slice('fixture-put:'.length), Buffer.from(role === 'rectified' ? rectified : inspection));
                }
                const { originalStorageKey: _original, originalSha256: _originalHash, storageKey: _snapshot, ...source } = attempt.input.source;
                return { ok: true, status: 200, payload: { width: 1270, height: 1778, borders: null,
                    colorGeometry: fixturePreparationColor, transform: fixturePreparationTransform(attempt.input),
                    inspectionFrame: { width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
                    preparationIdentity: fixturePreparationIdentity, preparationEvidence: { ...binding, source } } };
            } },
        initialization: { status: async () => bridgeCalls ? { state: 'SUCCEEDED', specimenId } : { state: 'PENDING' },
            run: async req => { assert.equal(req.requestId, current.operation.result.requestId);
                assert.equal(store.session.workflowState, 'CAPTURED'); if (!bridgeCalls) bridgeCalls++;
                return { state: 'SUCCEEDED', specimenId }; } },
    };
    storage.beforeRead = () => { assert.notEqual(lockContext.getStore(), true, 'object bytes must be read outside caller transaction'); };
    function next(action: 'PREPARE_SIDE' | 'INITIALIZE_REPORT', side?: 'FRONT' | 'BACK') {
        request.requestId = randomUUID(); current.card.revision++; request.binding.workflowRevision = current.card.revision;
        current.operation.result = { requestId: request.requestId, action, payload: { side }, binding: request.binding, phase: 'REQUESTED' };
        current.card.workspace.pending = { requestId: request.requestId, action, side, binding: request.binding };
    }
    const service = () => createAtlasWorkspaceSource(deps);
    async function preparePair() {
        for (const side of SIDES) {
            if (side === 'BACK') next('PREPARE_SIDE', side);
            const result = await service().prepare(request); assert.equal(result.state, 'SUCCEEDED'); assert(result.preparation);
            Object.assign(current.card.workspace.preparation[side], result.preparation, { status: 'PREPARED' });
            current.card.workspace.centering[side] = { inner, confirmed: true, preparationHash: result.preparation.manifestHash };
        }
        next('INITIALIZE_REPORT');
    }
    return { current, request, store, storage, deps, authority, ledgerRows, physical, service, next, preparePair,
        setRecheckHook: (hook: () => void) => { recheckHook = hook; }, revoke: () => { revoked = true; },
        counts: () => ({ loads, rechecks, ensured, workerCalls, physicalCalls, bridgeCalls, captureWrites }) };
}

test('workspace source: strict DTO and retained scope mismatches fail before any source/storage/provider work', async () => {
    for (const mutate of [
        (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.request, sourceOwnerId: 'legacy-owner' }),
        (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.request, scope: { ...f.request.scope, actorId: randomUUID() } }),
        (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.request, binding: { ...f.request.binding, claimFence: 2 } }),
        (f: Awaited<ReturnType<typeof fixture>>) => { f.current.card.source.sourceOwnerId = 'legacy-owner'; return f.request; },
        (f: Awaited<ReturnType<typeof fixture>>) => { f.current.operation.result.payload.side = 'BACK'; return f.request; },
        (f: Awaited<ReturnType<typeof fixture>>) => { f.current.card.claim.kind = 'ASTRA'; return f.request; },
        (f: Awaited<ReturnType<typeof fixture>>) => { f.current.card.sides.FRONT.uploadId = randomUUID(); return f.request; },
    ]) {
        const f = await fixture(); await assert.rejects(f.service().prepare(mutate(f)), /WORKSPACE_/);
        assert.equal(f.counts().ensured + f.counts().workerCalls + f.counts().physicalCalls, 0); assert.equal(f.storage.writes.length, 0);
    }
});

test('workspace source: report lifecycle recovery reads the admitted exact request without recapture or dispatch', async () => {
    const f = await fixture(); await f.preparePair(); await f.service().finalize(f.request);
    const before = f.counts(); f.store.session = { ...f.store.session, workflowState: 'GRADED' };
    await assert.rejects(f.service().status(f.request), /WORKSPACE_SOURCE_CHANGED/);
    Object.assign(f.current, { sourceAdmission: { requestId: f.request.requestId, cardId: f.request.cardId, specimenId: f.request.cardId,
        sourceId: f.current.card.source.sourceId, sourceOwnerId: f.current.card.source.sourceOwnerId, actorKind: 'HUMAN',
        actorId: f.request.scope.actorId, captureHash: f.request.binding.captureHash, claimFence: f.request.binding.claimFence } });
    f.deps.initialization.run = async () => { throw new Error('recovered report must not dispatch'); };
    assert.equal((await f.service().status(f.request)).state, 'SUCCEEDED');
    assert.equal((await f.service().finalize(f.request)).state, 'SUCCEEDED');
    assert.equal(f.counts().captureWrites, before.captureWrites); assert.equal(f.counts().workerCalls, before.workerCalls);
    Object.assign(f.current, { sourceAdmission: { ...(f.current as unknown as AtlasAuthorizedWorkspaceSource).sourceAdmission, requestId: randomUUID() } });
    await assert.rejects(f.service().finalize(f.request), /WORKSPACE_SOURCE_CHANGED/);
});

test('workspace source: incomplete identity and absent preparation release cannot create a source or spend', async () => {
    const f = await fixture(); f.current.card.workspace.identity.playerName = '';
    await assert.rejects(f.service().prepare(f.request)); assert.equal(f.counts().ensured, 0);
    const g = await fixture(); g.deps.preparation.approvedRelease = currentSpeedsterPreparationRelease;
    await assert.rejects(g.service().prepare(g.request), /compatible release/);
    assert.equal(g.counts().ensured + g.counts().workerCalls + g.counts().physicalCalls, 0);
});

test('workspace source: original preparation is durable, sides independent, response excludes private proofs and URLs', async () => {
    const f = await fixture(); const result = await f.service().prepare(f.request);
    assert.equal(result.state, 'SUCCEEDED'); assert.equal(result.preparation?.width, 1270);
    assert.equal(result.requestId, f.request.requestId); assert.equal(result.side, 'FRONT');
    assert.doesNotMatch(JSON.stringify(result), /fixture-read|storageKey|originalStorageKey|createdByUserId|dispatchClaimId|serverReceipt|outputs/);
    const attempts = structuredClone(f.store.attempts), manifests = structuredClone(f.store.manifests);
    f.storage.objects.set(f.current.originals.FRONT.upload.objectRef, Buffer.from('mutable alias replaced'));
    assert.deepEqual(await f.service().status(f.request), result);
    assert.deepEqual(await f.service().prepare(f.request), result);
    assert.deepEqual(f.store.attempts, attempts); assert.deepEqual(f.store.manifests, manifests);
    assert.equal(f.counts().workerCalls, 1); assert.equal(f.counts().physicalCalls, 1); assert.equal(f.counts().bridgeCalls, 0);
    f.next('PREPARE_SIDE', 'BACK'); assert.equal((await f.service().prepare(f.request)).state, 'SUCCEEDED');
    assert.equal(f.store.manifests.size, 2); assert.equal(f.counts().workerCalls, 2);
});

test('workspace source: concurrent exact preparation calls claim physical and preparation dispatch once', async () => {
    const f = await fixture(); const results = await Promise.all([f.service().prepare(f.request), f.service().prepare(f.request)]);
    assert(results.some(result => result.state === 'SUCCEEDED'));
    assert.equal(f.counts().physicalCalls, 1); assert.equal(f.counts().workerCalls, 1);
    assert.equal(f.store.manifests.size, 1); assert.equal(f.ledgerRows.size, 1);
});

test('workspace source: unknown physical response keeps exact retained outcome across status and replay', async () => {
    const f = await fixture(); let calls = 0;
    f.physical.invoke = async () => { calls++; throw new Error('fixture connection lost'); };
    const first = await f.service().prepare(f.request); assert.equal(first.state, 'UNKNOWN');
    assert.equal(first.failureCode, 'PHYSICAL_GEOMETRY_OUTCOME_UNCONFIRMED');
    assert.deepEqual(await f.service().status(f.request), first); assert.deepEqual(await f.service().prepare(f.request), first);
    assert.equal(calls, 1); assert.equal(f.store.attempts.size, 0); assert.equal(f.counts().workerCalls, 0);
});

test('workspace source: unknown original preparation dispatch cannot be retried or replaced', async () => {
    const f = await fixture(); let calls = 0;
    f.deps.preparation.invokeWorker = async () => { calls++; throw new Error('fixture worker response lost'); };
    const result = await f.service().prepare(f.request); assert.equal(result.state, 'UNKNOWN');
    assert.equal(result.failureCode, 'PREPARATION_OUTCOME_UNCONFIRMED');
    assert.deepEqual(await f.service().status(f.request), result); assert.deepEqual(await f.service().prepare(f.request), result);
    assert.equal(calls, 1); assert.equal(f.store.attempts.size, 1); assert.equal(f.counts().physicalCalls, 1);
});

test('workspace source: changed original and invalid physical evidence never reach preparation dispatch', async () => {
    const f = await fixture(); f.storage.objects.set(f.current.originals.FRONT.upload.objectRef, (await images)[1]);
    await assert.rejects(f.service().prepare(f.request), /WORKSPACE_ORIGINAL_CHANGED/);
    assert.equal(f.counts().physicalCalls + f.counts().workerCalls, 0);
    const g = await fixture(); g.physical.invoke = async () => ({ ok: true, status: 200, payload: {} } as never);
    const result = await g.service().prepare(g.request); assert.equal(result.state, 'FAILED');
    assert.equal(result.failureCode, 'PHYSICAL_GEOMETRY_INVALID'); assert.equal(g.counts().workerCalls, 0);
    assert.deepEqual(await g.service().status(g.request), result);
});

test('workspace source: revocation during a physical response retains proof but cannot dispatch preparation', async () => {
    const f = await fixture(); const invoke = f.physical.invoke;
    f.physical.invoke = async body => { const result = await invoke(body); f.revoke(); return result; };
    await assert.rejects(f.service().prepare(f.request), /WORKSPACE_SESSION_REVOKED/);
    assert.equal([...f.ledgerRows.values()][0].result.state, 'SUCCEEDED');
    assert.equal(f.counts().workerCalls, 0); assert.equal(f.store.attempts.size, 0);
});

test('workspace source: revoked authority rolls back a late preparation adoption', async () => {
    const f = await fixture(); const invoke = f.deps.preparation.invokeWorker;
    f.deps.preparation.invokeWorker = async body => { const result = await invoke(body); f.revoke(); return result; };
    await assert.rejects(f.service().prepare(f.request), /WORKSPACE_SESSION_REVOKED/);
    assert.equal(f.store.manifests.size, 0); assert.equal(f.store.attempts.size, 1);
    assert.equal([...f.store.attempts.values()][0].terminalOutcome, null);
});

test('workspace source: exact confirmed pair freezes through original capture math then uses retained initialization bridge', async () => {
    const f = await fixture(); await f.preparePair();
    const result = await f.service().finalize(f.request); assert.equal(result.state, 'SUCCEEDED'); assert(result.specimenId);
    const persisted = resolvePersistedSpeedsterPreparationCapture(f.store.session);
    const original = parseSpeedsterMapSourceSession(persisted);
    assert(original.front.centeringBorders.leftMm > 0); assert(original.back.centeringBorders.rightMm > 0);
    assert.equal(f.counts().captureWrites, 1); assert.equal(f.counts().bridgeCalls, 1);
    assert.deepEqual(await f.service().status(f.request), result); assert.deepEqual(await f.service().finalize(f.request), result);
    assert.equal(f.counts().captureWrites, 1); assert.equal(f.counts().bridgeCalls, 1);
    assert.doesNotMatch(JSON.stringify(result), /storageKey|receipt|sourceOwner|fixture-read/);
});

test('workspace source: missing centering, stale manifest, corner selection, or signed physical result cannot initialize', async () => {
    for (const change of [
        (f: Awaited<ReturnType<typeof fixture>>) => { f.current.card.workspace.centering.FRONT.confirmed = false; },
        (f: Awaited<ReturnType<typeof fixture>>) => { f.current.card.workspace.centering.FRONT.preparationHash = '0'.repeat(64); },
        (f: Awaited<ReturnType<typeof fixture>>) => { f.current.card.workspace.cornerShape = ''; },
        (f: Awaited<ReturnType<typeof fixture>>) => { f.ledgerRows.clear(); },
        (f: Awaited<ReturnType<typeof fixture>>) => { f.current.card.workspace.preparation.BACK.corners = fixturePreparationInput().physicalQuad.map(p => ({ x: p.x + .01, y: p.y })); },
    ]) {
        const f = await fixture(); await f.preparePair(); change(f);
        await assert.rejects(f.service().finalize(f.request), /WORKSPACE_/);
        assert.equal(f.counts().captureWrites + f.counts().bridgeCalls, 0); assert.equal(f.store.session.workflowState, 'DRAFT');
    }
});

test('workspace source: original map requirement remains a gate and human missing-map authority cannot be guessed', async () => {
    const f = await fixture(); await f.preparePair();
    f.deps.capture!.validateMapBinding = async () => { throw new Error('Original active map requires signed registration or explicit human decision'); };
    await assert.rejects(f.service().finalize(f.request), /Original active map/);
    assert.equal(f.counts().captureWrites + f.counts().bridgeCalls, 0);
});

test('workspace source: late capture write is rolled back under the source transaction fence', async () => {
    const f = await fixture(); await f.preparePair(); const persist = f.deps.capture!.persistPreparedCapture!;
    f.deps.capture!.persistPreparedCapture = async (...args) => { const result = await persist(...args); f.revoke(); return result; };
    await assert.rejects(f.service().finalize(f.request), /WORKSPACE_SESSION_REVOKED/);
    assert.equal(f.store.session.workflowState, 'DRAFT'); assert.equal(f.counts().bridgeCalls, 0);
    assert.equal(f.store.events.some(event => event.eventType === 'PREPARATION_CAPTURE_FROZEN'), false);
});

test('workspace source: initialization unknown is recoverable and port details cannot override scoped output', async () => {
    const f = await fixture(); await f.preparePair();
    f.deps.initialization.run = async () => ({ state: 'UNKNOWN', failureCode: 'INITIALIZATION_OUTCOME_UNCONFIRMED',
        requestId: randomUUID(), cardId: randomUUID(), sourceOwnerId: 'private-owner', storageKey: 'private-key' } as never);
    f.deps.initialization.status = f.deps.initialization.run;
    const result = await f.service().finalize(f.request); assert.equal(result.state, 'UNKNOWN');
    assert.equal(result.requestId, f.request.requestId); assert.equal(result.cardId, f.request.cardId);
    assert.doesNotMatch(JSON.stringify(result), /private-owner|private-key/);
    assert.deepEqual(await f.service().status(f.request), result); assert.equal(f.counts().captureWrites, 1);
    f.deps.initialization.status = async () => ({ state: 'SUCCEEDED' });
    await assert.rejects(f.service().status(f.request), /WORKSPACE_INITIALIZATION_UNCONFIRMED/);
});

test('workspace source: narrow draft INSERT derives namespace and identity without ORM finishing defaults, replays and rejects foreign binding', async () => {
    const f = await fixture(); const authorized = await f.authority.load(f.request);
    let row: Record<string, unknown> | null = null, creates = 0, checks = 0;
    const database = { aiGraderV2Session: { findUnique: async () => row,
        create: async () => { throw new Error('Prisma default finishing fields are not granted'); } },
        $executeRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
            const sql = query.join('?');
            assert.match(sql, /INSERT INTO public\."AiGraderV2Session"/);
            assert.deepEqual(sql.match(/\(([^)]+)\)\s*VALUES/)![1].replaceAll('"', '').split(','),
                ['id', 'createdByUserId', 'cardProfile', 'workflowState', 'ruleVersion', 'identity', 'capture', 'reviewedDefects', 'gradeReport', 'createdAt', 'updatedAt']);
            assert.doesNotMatch(sql, /nfcDone|compsDone|inventoryDone|publicReportSlug|slabFrontKey|slabBackKey|ON CONFLICT|UPDATE/);
            assert.equal(values.length, 9); creates++;
            const [id, createdByUserId, cardProfile, workflowState, ruleVersion, ...json] = values;
            row = { id, createdByUserId, cardProfile, workflowState, ruleVersion,
                ...Object.fromEntries(['identity', 'capture', 'reviewedDefects', 'gradeReport'].map((key, index) => [key, JSON.parse(String(json[index]))])) };
            return 1;
        } };
    const client = { $transaction: async (work: (tx: typeof database) => Promise<unknown>) => work(database) } as unknown as PrismaClient;
    const source = createPrismaAtlasWorkspaceSessions(client, { ...f.authority, recheck: async (_request, _authorized, tx) => { checks++; assert.equal(tx, database); } });
    assert.equal(await source.find(f.request, authorized), null); assert.equal(creates, 0);
    const created = await source.ensure(f.request, authorized);
    assert.equal(created.id, `atlas-${f.request.cardId}`); assert.equal(created.createdByUserId, `atlas-staff-${f.current.card.creatorId}`);
    assert.deepEqual(created.identity, canonicalizeNewSpeedsterSessionIdentity('SPORTS', preparedCaptureIdentity));
    assert.equal(created.workflowState, 'DRAFT'); assert.equal(created.ruleVersion, SPEEDSTER_RULE_VERSION);
    assert.deepEqual(created.capture, {}); assert.deepEqual(created.reviewedDefects, []); assert.deepEqual(created.gradeReport, {});
    assert.deepEqual(await source.ensure(f.request, authorized), created); assert.equal(creates, 1); assert(checks >= 6);
    Object.assign(row!, { createdByUserId: 'foreign-owner' });
    await assert.rejects(source.find(f.request, authorized), /WORKSPACE_SOURCE_CHANGED/);
});

async function machineFixture() {
    const f = await fixture(), current = f.current as typeof f.current & { machine: AtlasWorkspaceMachineProof };
    const runId = randomUUID(), createdAt = new Date();
    Object.assign(current.card.claim, { kind: 'ASTRA', runId, workflowRevision: current.card.revision });
    const manifest = { version: 'atlas-operator-capture-manifest-v1', phase: 'CAPTURE_REVIEW', runId,
        workspaceCardId: current.card.id, claimId: current.card.claim.id, claimFence: current.card.claimFence,
        captureRevision: current.card.captureRevision, workflowRevision: current.card.revision, evidenceHash: current.card.captureHash,
        identity: Object.fromEntries(Object.entries(current.card.identity).map(([key, value]) => [key, value ?? ''])),
        cornerShape: 'SQUARE', assets: SIDES.map(side => ({ assetId: randomUUID(), side, view: 'ORIGINAL', sha256: current.originals[side].verification.sha256,
            ...Object.fromEntries(['sha256', 'byteCount', 'width', 'height', 'contentType'].map(key =>
                [key, (current.originals[side].verification as unknown as Record<string, unknown>)[key]])) })) };
    const manifestCanonical = canonical(manifest), manifestHash = preparationHash(manifest);
    const run = { id: runId, phase: 'CAPTURE_REVIEW', state: 'PREPARATION_READY', workspaceCardId: current.card.id,
        specimenId: null, initializationId: null, evidenceHash: current.card.captureHash, manifestCanonical, manifestHash,
        revision: 4, leaseFence: 2, controlRevision: 1, controlState: 'RUNNING', executionMode: 'CONTINUOUS' };
    const row = (id: string, toolName: string, args: Record<string, unknown>, result: unknown): AtlasWorkspaceMachineStep => {
        const requestCanonical = canonical(args), output = { binding: { runId, evidenceHash: run.evidenceHash,
            manifestHash, expectedRevision: Number(args.expectedRevision) + 1 }, result };
        return { id, runId, revision: Number(args.expectedRevision) + 1, toolName, requestCanonical,
            requestHash: preparationHash(args), resultCanonical: canonical(output), resultHash: preparationHash(output), createdAt };
    };
    const proposals = SIDES.map((side, index) => {
        const stepId = randomUUID(), asset = manifest.assets[index];
        const args = { runId, evidenceHash: run.evidenceHash, expectedRevision: index + 1, manifestHash, side,
            corners: fixturePreparationInput().physicalQuad, matColor: 'BLACK', evidence: [{ assetId: asset.assetId, side, sha256: asset.sha256 }],
            summary: 'Synthetic machine proposal from the delivered original.' };
        return row(stepId, 'propose_physical_boundary', args, { actor: 'MACHINE', status: 'PROPOSED_FOR_PREPARATION',
            proposal: captureProposalRef(stepId, { args }) });
    });
    const submit = { runId, evidenceHash: run.evidenceHash, expectedRevision: 3, manifestHash,
        disposition: 'READY_FOR_PREPARATION', identityProposal: null,
        boundaries: proposals.map((entry, i) => ({ side: SIDES[i], proposal: { stepId: entry.id, requestHash: entry.requestHash } })),
        summary: 'Exact machine proposals selected for original preparation.' };
    const selection = await selectedCapturePreparation({ run: { ...run, revision: 3 }, manifest,
        call: { name: 'submit_capture_preparation', args: submit },
        tx: { staffOperatorStep: { findUnique: async ({ where }: { where: { id: string } }) => proposals.find(p => p.id === where.id) } } }, async () => {});
    const selectionStep = row(randomUUID(), 'submit_capture_preparation', submit, selection);
    current.machine = { run, selectionStep, proposalSteps: proposals, unresolvedAttempts: 0,
        deliveredAssets: manifest.assets.map(asset => ({ assetId: asset.assetId, side: asset.side, sha256: asset.sha256 as string })) };
    const intent = { runId, runRevision: run.revision, leaseFence: run.leaseFence, runControlRevision: run.controlRevision,
        selectionStepId: selectionStep.id, selectionResultHash: selectionStep.resultHash } as Record<string, unknown>;
    Object.assign(current.card.claim, { accessVersion: 1, controlRevision: 1 });
    f.request.scope = { actorKind: 'MACHINE', actorId: f.request.scope.actorId, accessVersion: 1, controlRevision: 1,
        runId, runRevision: run.revision, leaseFence: run.leaseFence, runControlRevision: run.controlRevision };
    function sync() { current.operation.action = 'MACHINE_SOURCE_ACTION'; Object.assign(current.operation.result, { accessVersion: 1 });
        Object.assign(current.operation.result.payload, { machine: intent }); }
    sync();
    const inner = [{ x: .05, y: .05 }, { x: .95, y: .05 }, { x: .95, y: .95 }, { x: .05, y: .95 }];
    function color(mode: 'PHYSICAL_OUTER' | 'PRINTED_FRAME', proposal: unknown) {
        return parseSpeedsterColorGeometryProposal({ ...fixturePreparationColor, mode, outcome: 'ACCEPTED', proposal,
            contrastFloorDeltaE: mode === 'PHYSICAL_OUTER' ? 18 : 12, minimumSideSupport: mode === 'PHYSICAL_OUTER' ? .7 : .55,
            sideEvidence: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side,
                { medianContrastDeltaE: 40, supportFraction: 1, sampleCount: 50, candidateCount: 1, ambiguous: false }])),
            ambiguity: { candidateCount: 1, runnerUpScoreRatio: null, ambiguous: false } });
    }
    f.physical.invoke = async () => ({ ok: true, status: 200, payload: { corners: fixturePreparationInput().physicalQuad,
        colorGeometry: color('PHYSICAL_OUTER', fixturePreparationInput().physicalQuad) } } as never);
    const invoke = f.deps.preparation.invokeWorker;
    f.deps.preparation.invokeWorker = async body => { const result = await invoke(body);
        Object.assign(result.payload as object, { borders: inner, colorGeometry: color('PRINTED_FRAME', inner) }); return result; };
    const provenance: Record<string, unknown>[] = [];
    Object.assign(f.deps, { recordMachineCapture: async (_tx: unknown, _source: unknown, proof: Record<string, unknown>) => { provenance.push(proof); } });
    async function pair() {
        assert.equal((await f.service().prepare(f.request)).state, 'SUCCEEDED');
        f.next('PREPARE_SIDE', 'BACK'); sync(); assert.equal((await f.service().prepare(f.request)).state, 'SUCCEEDED');
        f.next('INITIALIZE_REPORT'); sync();
    }
    return { ...f, current, run, intent, sync, pair, provenance };
}

test('workspace machine source: exact immutable selections and genuine worker evidence use original capture without human flags', async () => {
    const f = await machineFixture(); await f.pair();
    assert.deepEqual(f.current.card.workspace.centering, {}, 'machine selection never creates HUMAN confirmed flags');
    const result = await f.service().finalize(f.request); assert.equal(result.state, 'SUCCEEDED');
    assert.equal(f.provenance.length, 1); assert.equal(f.provenance[0].actor, 'MACHINE');
    assert.equal(f.provenance[0].selectionResultHash, f.current.machine.selectionStep.resultHash);
    const source = parseSpeedsterMapSourceSession(resolvePersistedSpeedsterPreparationCapture(f.store.session));
    assert(source.front.centeringBorders.leftMm > 0); assert.equal(f.counts().captureWrites, 1);
});

test('workspace machine source: stale run fence, rewritten selection/proposal, undelivered evidence, and unresolved attempts are denied', async () => {
    for (const change of [
        (f: Awaited<ReturnType<typeof machineFixture>>) => { f.run.leaseFence++; },
        (f: Awaited<ReturnType<typeof machineFixture>>) => { f.run.controlRevision++; },
        (f: Awaited<ReturnType<typeof machineFixture>>) => { Object.assign(f.current.machine.selectionStep, { resultHash: '0'.repeat(64) }); },
        (f: Awaited<ReturnType<typeof machineFixture>>) => { Object.assign(f.current.machine.proposalSteps[0], { requestCanonical: '{}' }); },
        (f: Awaited<ReturnType<typeof machineFixture>>) => { Object.assign(f.current.machine, { deliveredAssets: [] }); },
        (f: Awaited<ReturnType<typeof machineFixture>>) => { Object.assign(f.current.machine, { unresolvedAttempts: 1 }); },
        (f: Awaited<ReturnType<typeof machineFixture>>) => { Object.assign(f.current.card.claim, { accessVersion: 2 }); },
        (f: Awaited<ReturnType<typeof machineFixture>>) => { Object.assign(f.request.scope, { accessVersion: 2 }); },
        (f: Awaited<ReturnType<typeof machineFixture>>) => { Object.assign(f.current.operation.result, { accessVersion: 2 }); },
        (f: Awaited<ReturnType<typeof machineFixture>>) => { f.request.scope = { actorId: f.request.scope.actorId, sessionHash: 'd'.repeat(64), controlRevision: 1 }; },
    ]) {
        const f = await machineFixture(); change(f); await assert.rejects(f.service().prepare(f.request));
        assert.equal(f.counts().ensured, 0); assert.equal(f.store.attempts.size, 0); assert.equal(f.ledgerRows.size, 0);
    }
});

test('workspace machine source: a retained action permit fences control metadata advances and paused recovery', async () => {
    const f = await machineFixture(), selected = f.current.machine.selectionStep;
    const permit = { requestId: f.request.requestId, cardId: f.request.cardId, runId: f.run.id, runRevision: f.run.revision,
        runControlRevision: f.run.controlRevision, claimFence: f.current.card.claimFence, captureHash: f.current.card.captureHash,
        selectionStepId: selected.id, selectionResultHash: selected.resultHash, mode: 'CONTINUOUS', state: 'ACTIVE' };
    Object.assign(f.current.machine, { sourcePermit: permit }); f.run.controlRevision++; f.run.controlState = 'PAUSE_REQUESTED';
    const result = await f.service().prepare(f.request); assert.equal(result.state, 'SUCCEEDED');
    permit.state = 'SUCCEEDED'; f.run.controlRevision++; f.run.controlState = 'PAUSED';
    assert.deepEqual(await f.service().status(f.request), result);
    const calls = f.counts().workerCalls; assert.deepEqual(await f.service().prepare(f.request), result); assert.equal(f.counts().workerCalls, calls);
    permit.requestId = randomUUID(); await assert.rejects(f.service().status(f.request), /WORKSPACE_MACHINE_PERMIT_CHANGED/);
});

test('workspace machine source: STEP terminal requires a new exact human permit', async () => {
    const f = await machineFixture(); f.run.executionMode = 'STEP';
    await assert.rejects(f.service().prepare(f.request), /WORKSPACE_MACHINE_STEP_PERMIT_REQUIRED/);
    const permitOperationId = randomUUID(); f.intent.permitOperationId = permitOperationId;
    Object.assign(f.current.machine, { permitOperation: { id: permitOperationId, cardId: f.request.cardId,
        actorId: f.request.scope.actorId, action: 'OPERATOR_CONTROL', createdAt: new Date(),
        result: { action: 'STEP', claimFence: f.current.card.claimFence, runId: f.run.id, runControlRevision: f.run.controlRevision,
            control: { state: 'RUNNING', mode: 'STEP' } } } });
    assert.equal((await f.service().prepare(f.request)).state, 'SUCCEEDED');
    const actualControl = f.current.machine.permitOperation!.result;
    Object.assign(f.current.machine.permitOperation!, { result: { action: 'STEP', claimFence: actualControl.claimFence,
        control: { ...actualControl.control, runId: actualControl.runId, revision: actualControl.runControlRevision } } });
    await assert.rejects(f.service().status(f.request), /WORKSPACE_MACHINE_STEP_PERMIT_REQUIRED/);
    Object.assign(f.current.machine.permitOperation!, { result: actualControl });
    Object.assign(f.current.machine.permitOperation!, { createdAt: new Date(0) });
    await assert.rejects(f.service().status(f.request), /WORKSPACE_MACHINE_STEP_PERMIT_REQUIRED/);
});

test('workspace machine source: genuine physical abstention and printed abstention require human attention', async () => {
    const f = await machineFixture();
    f.physical.invoke = async () => ({ ok: true, status: 200, payload: { corners: null,
        colorGeometry: { ...fixturePreparationColor, mode: 'PHYSICAL_OUTER', contrastFloorDeltaE: 18, minimumSideSupport: .7 } } });
    const physical = await f.service().prepare(f.request); assert.equal(physical.state, 'FAILED');
    assert.equal(physical.failureCode, 'WORKSPACE_MACHINE_PHYSICAL_REVIEW_REQUIRED');
    assert.deepEqual(await f.service().status(f.request), physical); assert.equal(f.store.attempts.size, 0);
    const g = await machineFixture(), invoke = g.deps.preparation.invokeWorker;
    g.deps.preparation.invokeWorker = async body => { const result = await invoke(body);
        Object.assign(result.payload as object, { borders: null, colorGeometry: fixturePreparationColor }); return result; };
    const printed = await g.service().prepare(g.request); assert.equal(printed.state, 'FAILED');
    assert.equal(printed.failureCode, 'WORKSPACE_MACHINE_PRINTED_REVIEW_REQUIRED');
    assert.deepEqual(await g.service().status(g.request), printed); assert.equal(g.store.manifests.size, 1);
    assert.equal(g.counts().captureWrites + g.counts().bridgeCalls, 0);
});
