import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { PrismaClient } from '@prisma/client';
import { createSpeedsterReviewDependencies, type SpeedsterReviewDependencyOptions } from '../lib/server/speedsterReviewDependencies';
import { createAtlasGradingPorts, type atlasGradingBridgeConfig } from '../lib/server/atlasGradingBridge';
import type { SpeedsterReviewActionDependencies, SpeedsterReviewActionSession } from '../lib/server/aiGraderV2ReviewAction';
import { parseSpeedsterDetectionSideCheckpoint, sealSpeedsterDetectionSideCheckpoint, speedsterDetectionSha256,
    type SpeedsterDetectionSideCheckpoint, type UnsignedSpeedsterDetectionSideCheckpoint } from '../lib/server/speedsterDetectionSideCheckpoint';
import { beginSpeedsterPreparation, claimSpeedsterPreparationDispatch, adoptSpeedsterPreparation } from '../lib/server/speedsterPreparationAuthority';
import { persistSpeedsterPreparationCapture } from '../lib/server/speedsterPreparationCaptureEvidence';
import { FixturePreparationStore, fixturePreparationBody, fixturePreparationRequest, fixturePreparationScope } from './fixtures/speedsterPreparation';
import { preparedCaptureIdentity, preparedCaptureSide } from './fixtures/speedsterPreparedCapture';
import { currentSpeedsterIdentityFixture } from './fixtures/speedsterCurrentRelease';

const configuredEnv = (): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', AI_GRADER_SPEEDSTER_SERVICE_URL: 'https://scoped-worker.example.invalid',
    AI_GRADER_SPEEDSTER_SERVICE_API_KEY: 'scoped-worker-credential', AI_GRADER_SPEEDSTER_REQUIRE_DETECTOR_IDENTITY_V1: 'true',
    AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_KEY_ID: 'scoped-key', AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET: 's'.repeat(64),
    AI_GRADER_SPEEDSTER_DETECT_DEADLINE_MS: '3200' });
const inertClient = {} as PrismaClient;
const detectBody: Parameters<SpeedsterReviewActionDependencies['detect']>[0] = { side: 'FRONT', cornerShape: 'SQUARE',
    views: [], sessionId: 'synthetic-session', requestTraceId: 'synthetic-detection-request', learningBank: null };
const measureBody: Parameters<SpeedsterReviewActionDependencies['measure']>[0] = { side: 'FRONT', cornerShape: 'SQUARE',
    evidenceView: { id: 'FRONT:ORIGINAL', imageUrl: 'https://scoped-evidence.example.invalid/photo',
        inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } } }, findings: [], marks: [] };

async function ambient<T>(env: NodeJS.ProcessEnv, work: () => Promise<T>): Promise<T> {
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    try { return await work(); } finally { for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    } }
}

test('scoped review transport snapshots explicit configuration and combines operation/detection cancellation', async () => {
    await ambient({ ...configuredEnv(), AI_GRADER_SPEEDSTER_SERVICE_URL: 'https://ambient.example.invalid',
        AI_GRADER_SPEEDSTER_SERVICE_API_KEY: 'ambient-credential' }, async () => {
        const env = configuredEnv(), calls: Array<{ url: unknown; init?: RequestInit }> = [];
        const operation = new AbortController(), detection = new AbortController();
        const dependencies = createSpeedsterReviewDependencies(inertClient, { env, signal: operation.signal,
            fetchImpl: (async (url, init) => { calls.push({ url, init }); return Response.json({ defects: [] }); }) as typeof fetch });
        Object.assign(env, { AI_GRADER_SPEEDSTER_SERVICE_URL: 'https://mutated.example.invalid', AI_GRADER_SPEEDSTER_SERVICE_API_KEY: 'mutated',
            AI_GRADER_SPEEDSTER_REQUIRE_DETECTOR_IDENTITY_V1: 'false', AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET: '', AI_GRADER_SPEEDSTER_DETECT_DEADLINE_MS: '1' });
        dependencies.assertDetectionRuntimeAuthority!(); assert.equal(dependencies.detectionDeadlineMs, 3200);
        await dependencies.detect(detectBody, { signal: detection.signal, deadlineMs: 3200 }); await dependencies.measure(measureBody);
        assert.deepEqual(calls.map(call => call.url), ['https://scoped-worker.example.invalid/detect', 'https://scoped-worker.example.invalid/measure']);
        assert(calls.every(call => (call.init?.headers as Record<string, string>).Authorization === 'Bearer scoped-worker-credential'));
        assert.deepEqual(JSON.parse(calls[1].init!.body as string), measureBody);
        detection.abort(); assert.equal(calls[0].init!.signal!.aborted, true); assert.equal(calls[1].init!.signal!.aborted, false);
        operation.abort(); assert.equal(calls[1].init!.signal!.aborted, true);
    });
});

test('explicit headers do not inherit ambient credentials; missing scoped authority cannot borrow a valid ambient key', async () => {
    await ambient(configuredEnv(), async () => {
        const calls: Array<{ url: unknown; init?: RequestInit }> = [], headers = { 'x-private-worker-key': 'explicit-key' };
        const options: SpeedsterReviewDependencyOptions = { env: { NODE_ENV: 'test' }, serviceUrl: 'https://explicit.example.invalid/', serviceHeaders: headers,
            fetchImpl: (async (url, init) => { calls.push({ url, init }); return Response.json({ defects: [] }); }) as typeof fetch };
        const dependencies = createSpeedsterReviewDependencies(inertClient, options);
        headers['x-private-worker-key'] = 'changed'; options.fetchImpl = async () => { throw new Error('changed transport'); };
        await dependencies.measure(measureBody);
        assert.equal(calls[0].url, 'https://explicit.example.invalid/measure');
        assert.deepEqual(calls[0].init!.headers, { 'Content-Type': 'application/json', 'x-private-worker-key': 'explicit-key' });
        assert.throws(() => dependencies.assertDetectionRuntimeAuthority!(), /authority is not configured/);
        const legacy = createSpeedsterReviewDependencies(inertClient, { fetchImpl: (async (url, init) => {
            calls.push({ url, init }); return Response.json({ defects: [] }); }) as typeof fetch });
        legacy.assertDetectionRuntimeAuthority!(); await legacy.measure(measureBody);
        assert.equal(calls[1].url, 'https://scoped-worker.example.invalid/measure');
        assert.equal((calls[1].init!.headers as Record<string, string>).Authorization, 'Bearer scoped-worker-credential');
    });
});

test('scoped evidence/map adapters retain the original bounded hash and pinned revision validation', async () => {
    const bytes = Buffer.from('synthetic private evidence'), calls: unknown[] = [];
    let size = bytes.length, storageKey = 'scoped/photo';
    const mapLookup: NonNullable<SpeedsterReviewDependencyOptions['mapLookup']> = {
        findActiveMap: async () => { throw new Error('pinned read cannot select a different active map'); },
        findPinnedRevision: async id => { calls.push(id); return null; },
    };
    const dependencies = createSpeedsterReviewDependencies(inertClient, { env: { NODE_ENV: 'test' }, mapLookup,
        presignReadUrl: async (key, seconds) => { calls.push({ key, seconds }); return 'https://private.example.invalid/exact'; },
        openEvidence: async key => { calls.push(key); return { storageKey, byteSize: size, body: Readable.from([bytes.subarray(0, 6), bytes.subarray(6)]) }; } });
    assert.equal(await dependencies.presignRead('scoped/photo', 600), 'https://private.example.invalid/exact');
    assert.equal(await dependencies.hashDetectionEvidence!('scoped/photo'), createHash('sha256').update(bytes).digest('hex'));
    size--; await assert.rejects(dependencies.hashDetectionEvidence!('scoped/photo'), /bounded byte size/);
    size = bytes.length; storageKey = 'foreign/photo'; await assert.rejects(dependencies.hashDetectionEvidence!('scoped/photo'), /coherently/);
    const source = { id: 'synthetic-session', mapRevisionId: 'immutable-map-revision', mapRegistration: null } as SpeedsterReviewActionSession & { mapRevisionId: string };
    await assert.rejects(dependencies.loadPinnedMapFilter!(source), /Pinned map revision was not found/);
    assert(calls.includes('immutable-map-revision')); assert.deepEqual(calls[0], { key: 'scoped/photo', seconds: 600 });
});

function unsignedCheckpoint(side: 'FRONT' | 'BACK'): UnsignedSpeedsterDetectionSideCheckpoint {
    const roles = ['SOURCE_ORIGINAL', 'RECTIFIED', 'INSPECTION', 'NORMALIZED', 'MICRO_DEFECT', 'DIRECTIONAL'] as const;
    const assets = roles.map(role => ({ role, storageKey: `synthetic/${side}/${role}`, sha256: 'a'.repeat(64) }));
    const detectorIdentity = currentSpeedsterIdentityFixture();
    return { version: 'speedster-detection-side-checkpoint-v1', sessionId: 'scoped-session', createdByUserId: 'scoped-owner',
        sessionRevision: '2026-09-09T00:00:00.000Z', operationId: 'b'.repeat(24), captureBindingSha256: 'c'.repeat(64), side,
        sideBinding: { side, assets, bindingSha256: speedsterDetectionSha256({ side, assets }) }, memorySnapshot: {}, memorySnapshotSha256: speedsterDetectionSha256({}),
        detectorVersion: detectorIdentity.detectorVersion, detectorIdentity, detectorIdentitySha256: speedsterDetectionSha256(detectorIdentity),
        requestTraceId: `scoped-session-${side}-request`, result: { defects: [] }, resultSha256: speedsterDetectionSha256({ defects: [] }), createdAt: '2026-09-09T00:00:01.000Z' };
}

test('receipt creation, replay and atomic Front/Back commit use the same scoped key snapshot and preserve the CAS fence', async () => {
    const env = configuredEnv(), previousKey = 'p'.repeat(64), rows: SpeedsterDetectionSideCheckpoint[] = [], events: string[] = [];
    env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_PREVIOUS_KEYS_JSON = JSON.stringify({ previous: previousKey });
    let currentRevision = new Date('2026-09-09T00:00:00.000Z');
    const tx = { $queryRaw: async () => { events.push('lock'); return []; }, $executeRaw: async () => { events.push('constraints'); return 1; },
        aiGraderV2Session: { findFirst: async () => ({ workflowState: 'CAPTURED', updatedAt: currentRevision }),
            updateMany: async () => { events.push('update'); return { count: 1 }; } },
        aiGraderV2InstrumentationEvent: { findMany: async () => rows.map(details => ({ details })) } };
    const client = { $executeRaw: async () => 1, aiGraderV2InstrumentationEvent: tx.aiGraderV2InstrumentationEvent,
        $transaction: async (work: (transaction: typeof tx) => Promise<void>, options: unknown) => { assert.deepEqual(options, { isolationLevel: 'Serializable' }); return work(tx); } } as unknown as PrismaClient;
    const dependencies = createSpeedsterReviewDependencies(client, { env, beforeSessionLock: async () => { events.push('before'); }, afterPersist: async () => { events.push('after'); } });
    env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET = 'changed'; env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_PREVIOUS_KEYS_JSON = '{}';
    const front = await dependencies.persistDetectionSideCheckpoint!(unsignedCheckpoint('FRONT'));
    assert.equal(front.receipt.keyId, 'scoped-key'); assert.deepEqual(parseSpeedsterDetectionSideCheckpoint(front, () => 's'.repeat(64)), front);
    const back = sealSpeedsterDetectionSideCheckpoint(unsignedCheckpoint('BACK'), { keyId: 'previous', secret: previousKey }); rows.push(front, back);
    const lookup = { sessionId: front.sessionId, createdByUserId: front.createdByUserId, sessionRevision: front.sessionRevision,
        captureBindingSha256: front.captureBindingSha256, operationId: front.operationId };
    assert.deepEqual(await dependencies.loadDetectionSideCheckpoints!(lookup), { FRONT: front, BACK: back });
    const commit = { reviewedDefects: [], gradeReport: {}, detectionPair: { operationId: front.operationId, captureBindingSha256: front.captureBindingSha256,
        memorySnapshotSha256: front.memorySnapshotSha256, frontReceiptHmacSha256: front.receipt.hmacSha256, backReceiptHmacSha256: back.receipt.hmacSha256 } };
    await dependencies.persistReviewIfRevision(lookup, new Date(front.sessionRevision), commit);
    assert.deepEqual(events, ['before', 'lock', 'update', 'after', 'constraints']);
    rows[1] = sealSpeedsterDetectionSideCheckpoint(unsignedCheckpoint('BACK'), { keyId: 'unknown-key', secret: previousKey });
    await assert.rejects(dependencies.loadDetectionSideCheckpoints!(lookup), /receipt key is unavailable/);
    const updates = events.filter(event => event === 'update').length;
    await assert.rejects(dependencies.persistReviewIfRevision(lookup, new Date(front.sessionRevision), commit), /receipt key is unavailable/);
    rows[1] = back; currentRevision = new Date(+currentRevision + 1);
    await assert.rejects(dependencies.persistReviewIfRevision(lookup, new Date(front.sessionRevision), commit), /state changed/);
    assert.equal(events.filter(event => event === 'update').length, updates);
});

const bridgeConfig = { serviceUrl: 'https://fixed-worker.example.invalid' } as ReturnType<typeof atlasGradingBridgeConfig>;
test('ATLAS evidence ports accept explicit bytes or the original bounded reader with a scoped stream', async () => {
    const bytes = Buffer.from('synthetic bounded bytes'), descriptor = { sourceRef: 'scoped/evidence', byteCount: bytes.length };
    const explicit = createAtlasGradingPorts(inertClient, bridgeConfig, { env: { NODE_ENV: 'test' }, readEvidence: async actual => { assert.deepEqual(actual, descriptor); return bytes; } });
    assert.deepEqual(await explicit.readEvidence(descriptor), bytes);
    const streamed = createAtlasGradingPorts(inertClient, bridgeConfig, { env: { NODE_ENV: 'test' }, openEvidence: async key => ({ storageKey: key, byteSize: bytes.length, body: Readable.from([bytes]) }) });
    assert.deepEqual(await streamed.readEvidence(descriptor), bytes);
    await assert.rejects(streamed.readEvidence({ ...descriptor, byteCount: bytes.length - 1 }), /invalid bounded byte size/);
});

async function preparedSource() {
    const store = new FixturePreparationStore(); store.session = { ...store.session, identity: preparedCaptureIdentity };
    for (const side of ['FRONT', 'BACK'] as const) {
        const scope = { ...fixturePreparationScope, side }, begun = await beginSpeedsterPreparation(fixturePreparationRequest(scope), store);
        const claimed = await claimSpeedsterPreparationDispatch(scope, begun.attempt.id, 1, store);
        await adoptSpeedsterPreparation(fixturePreparationBody(claimed.attempt), claimed.attempt.dispatchClaimId!, store);
    }
    const pair = (await store.read(fixturePreparationScope)).manifests as Required<Awaited<ReturnType<typeof store.read>>['manifests']>;
    const capture = persistSpeedsterPreparationCapture({ owner: fixturePreparationScope, pair,
        capture: { cornerShape: 'SQUARE', front: preparedCaptureSide(pair.FRONT), back: preparedCaptureSide(pair.BACK) }, mapRegistration: null });
    const measurement = { widthMm: 1, heightMm: 1, areaMm2: 1, zonePercent: 1, multiplier: 1, weightedAreaMm2: 1, subgradeEffect: 0 };
    const finding = { id: 'FRONT:synthetic:SURFACE', side: 'FRONT', zone: 'SURFACE', defectType: 'LIGHT_SCRATCH_SCUFF', origin: 'DETECTOR', confidence: .9,
        canonicalContour: [{ x: .1, y: .1 }, { x: .2, y: .1 }, { x: .2, y: .2 }], sourceViewId: 'FRONT:ORIGINAL', supportingViewIds: [], reviewResult: 'UNREVIEWED', measurement };
    return { source: { ...store.session, workflowState: 'CAPTURED', capture, reviewedDefects: [finding],
        gradeReport: { detectorVersion: currentSpeedsterIdentityFixture().detectorVersion } } as SpeedsterReviewActionSession, finding, measurement };
}

test('ATLAS performs the original correction with fixed scoped transport, fresh-source checks and transaction hooks', async () => {
    const { source, finding, measurement } = await preparedSource(), env = configuredEnv(), calls: Array<{ url: unknown; init?: RequestInit }> = [], hooks: string[] = [];
    const tx = { $queryRaw: async () => [], $executeRaw: async () => 1,
        aiGraderV2Session: { findFirst: async () => source, updateMany: async () => { hooks.push('persist'); return { count: 1 }; } } };
    const client = { aiGraderV2Session: { findFirst: async () => source }, $executeRaw: async () => 1,
        $transaction: async (work: (transaction: typeof tx) => Promise<void>) => work(tx) } as unknown as PrismaClient;
    let reads = 0;
    const ports = createAtlasGradingPorts(client, bridgeConfig, { env, presignReadUrl: async key => {
        reads++; assert.equal(key, (source.capture as { front: { inspectionStorageKey: string } }).front.inspectionStorageKey);
        return 'https://private-evidence.example.invalid/scoped'; },
        fetchImpl: (async (url, init) => { calls.push({ url, init }); const body = JSON.parse(init!.body as string);
            assert.equal(body.evidenceView.imageUrl, 'https://private-evidence.example.invalid/scoped');
            return Response.json({ defects: body.findings.map((item: object) => ({ ...item, measurement })) }); }) as typeof fetch });
    env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY = 'changed';
    const input = { source, action: { type: 'CHANGE_TYPE', defectId: finding.id, defectType: 'VISIBLE_WHITENING' } as const,
        policy: { maxWorkerCalls: 1 }, signal: new AbortController().signal,
        beforeSessionLock: async () => { hooks.push('before'); }, afterPersist: async () => { hooks.push('after'); } };
    await ports.perform(input);
    assert.equal(reads, 1); assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://fixed-worker.example.invalid/measure');
    assert.equal((calls[0].init!.headers as Record<string, string>).Authorization, 'Bearer scoped-worker-credential');
    assert.equal(calls[0].init!.redirect, 'error'); assert.deepEqual(hooks, ['before', 'persist', 'after']);
    await assert.rejects(ports.perform({ ...input, policy: { maxWorkerCalls: 0 } }), /WORKER_CALL_LIMIT/); assert.equal(calls.length, 1);
    await assert.rejects(ports.perform({ ...input, source: { ...source, updatedAt: new Date(+source.updatedAt + 1) } }), /SOURCE_REVISION_CHANGED/);
    assert.equal(calls.length, 1);
    assert.throws(() => ports.assertSourceAdmission(source), /preparation.*release|release.*preparation/i);
});
