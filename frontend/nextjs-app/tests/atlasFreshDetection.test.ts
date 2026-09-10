import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAtlasFreshDetection, createAtlasFreshDetectionCheckpointLoader, withAtlasFreshDetection,
    type AtlasFreshDetectionTransaction } from '../lib/server/atlasFreshDetection';
import { applySpeedsterReviewAction, type SpeedsterDetectionCheckpointLookup, type SpeedsterReviewActionDependencies,
    type SpeedsterReviewActionSession } from '../lib/server/aiGraderV2ReviewAction';
import { speedsterDetectionOperationId } from '../lib/server/speedsterDetectionSideCheckpoint';

const source = { id: 'session-12345678901234567890', createdByUserId: 'admin-1', updatedAt: new Date('2026-09-08T20:00:00.000Z') };
const revision = source.updatedAt.toISOString(), SHA = 'a'.repeat(64);
type Event = { id: string; sessionId: string; createdByUserId: string; category: string; eventType: string; details: { sessionRevision?: string; side?: string } };
const event = (side = 'FRONT'): Event => ({ id: `synthetic-${side}`, sessionId: source.id, createdByUserId: source.createdByUserId,
    category: 'DETECTOR_CHECKPOINT', eventType: 'DETECTOR_SIDE_RESULT_PRESERVED', details: { sessionRevision: revision, side } });
function database() {
    const state = { source: { ...source, workflowState: 'CAPTURED' } as typeof source & { workflowState: string } | null,
        events: [] as Event[], calls: [] as string[], fail: false };
    const tx = {
        async $executeRaw(strings: TemplateStringsArray) {
            assert.equal(strings.join('?'), "SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))");
            state.calls.push('staff-lock'); return 0;
        },
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
            const sql = strings.join('?').replace(/\s+/g, ' ').trim();
            if (state.fail) throw new Error('SYNTHETIC_DATABASE_UNAVAILABLE');
            if (sql.includes('public."AiGraderV2Session"')) {
                assert(sql.endsWith('FOR SHARE')); assert.equal(values.length, 2);
                assert(sql.includes('WHERE id=? AND "createdByUserId"=?')); state.calls.push('source-lock');
                return state.source && state.source.id === values[0] && state.source.createdByUserId === values[1] ? [state.source] : [];
            }
            assert(sql.includes('public."AiGraderV2InstrumentationEvent"'));
            assert(sql.includes('"sessionId"=? AND "createdByUserId"=?'));
            assert(sql.includes("category='DETECTOR_CHECKPOINT' AND \"eventType\"='DETECTOR_SIDE_RESULT_PRESERVED'"));
            assert(sql.includes("details->>'sessionRevision'=? LIMIT 1")); assert.equal(values.length, 3);
            state.calls.push('checkpoint-read');
            return state.events.filter(row => row.sessionId === values[0] && row.createdByUserId === values[1]
                && row.category === 'DETECTOR_CHECKPOINT' && row.eventType === 'DETECTOR_SIDE_RESULT_PRESERVED'
                && row.details.sessionRevision === values[2]).slice(0, 1).map(row => ({ id: row.id }));
        },
    } as unknown as AtlasFreshDetectionTransaction;
    return { state, tx };
}
const lookup = (): SpeedsterDetectionCheckpointLookup => ({ sessionId: source.id, createdByUserId: source.createdByUserId,
    sessionRevision: revision, captureBindingSha256: SHA,
    operationId: speedsterDetectionOperationId({ sessionId: source.id, sessionRevision: revision, captureBindingSha256: SHA }) });
type Loader = NonNullable<SpeedsterReviewActionDependencies['loadDetectionSideCheckpoints']>;

test('preclaim gate holds staff then exact original source locks before its bounded checkpoint read', async () => {
    const { state, tx } = database(); let paidClaims = 0;
    await assertAtlasFreshDetection(tx, source); paidClaims++;
    assert.deepEqual(state.calls, ['staff-lock', 'source-lock', 'checkpoint-read']); assert.equal(paidClaims, 1);
});

test('either partial side or complete retained checkpoints reject before a paid claim, without altering events', async () => {
    for (const sides of [['FRONT'], ['BACK'], ['FRONT', 'BACK']]) {
        const { state, tx } = database(); state.events = sides.map(event); const before = structuredClone(state.events); let paidClaims = 0;
        await assert.rejects(async () => { await assertAtlasFreshDetection(tx, source); paidClaims++; }, /FRESH_DETECTION_REQUIRED/);
        assert.equal(paidClaims, 0); assert.deepEqual(state.events, before);
    }
});

test('checkpoint preflight uses exact source, owner, top-level revision, category and event type', async () => {
    const { state, tx } = database();
    state.events = [
        { ...event(), sessionId: 'different-session' }, { ...event(), createdByUserId: 'different-owner' },
        { ...event(), details: { sessionRevision: '2026-09-08T19:59:59.999Z' } },
        { ...event(), category: 'OTHER' }, { ...event(), eventType: 'OTHER' }, { ...event(), details: {} },
    ];
    await assertAtlasFreshDetection(tx, source); assert.equal(state.events.length, 6);
    // No receipt parsing can silently make a same-revision retained event fresh.
    state.events.push({ ...event(), details: { sessionRevision: revision } });
    await assert.rejects(() => assertAtlasFreshDetection(tx, source), /FRESH_DETECTION_REQUIRED/);
});

test('missing, wrong-owner, stale or noncaptured original source rejects before checkpoint access', async () => {
    for (const change of [
        (state: ReturnType<typeof database>['state']) => { state.source = null; },
        (state: ReturnType<typeof database>['state']) => { state.source!.createdByUserId = 'different-owner'; },
        (state: ReturnType<typeof database>['state']) => { state.source!.updatedAt = new Date(+source.updatedAt + 1); },
        (state: ReturnType<typeof database>['state']) => { state.source!.workflowState = 'APPROVED'; },
    ]) {
        const { state, tx } = database(); change(state);
        await assert.rejects(() => assertAtlasFreshDetection(tx, source), /SOURCE_REVISION_CHANGED/);
        assert(!state.calls.includes('checkpoint-read'));
    }
});

test('root client, absent transaction ports and database failure cannot turn into fresh authority', async () => {
    const { state, tx } = database();
    await assert.rejects(() => assertAtlasFreshDetection({ ...tx, $transaction() {} } as never, source), /FRESH_DETECTION_TRANSACTION_REQUIRED/);
    await assert.rejects(() => assertAtlasFreshDetection({} as never, source), /FRESH_DETECTION_TRANSACTION_REQUIRED/);
    assert.equal(state.calls.length, 0); state.fail = true;
    await assert.rejects(() => assertAtlasFreshDetection(tx, source), /SYNTHETIC_DATABASE_UNAVAILABLE/);
});

test('fresh loader calls the original port exactly once and returns its unchanged empty result', async () => {
    let calls = 0; const exact = lookup(), empty = {};
    const wrapped = createAtlasFreshDetectionCheckpointLoader(source, async value => { calls++; assert.equal(value, exact); return empty; });
    assert.equal(await wrapped(exact), empty); assert.equal(calls, 1);
});

test('loader rejects every nonempty checkpoint object, including undefined sides and hidden keys', async () => {
    for (const result of [{ FRONT: { retained: true } }, { BACK: { retained: true } }, { FRONT: {}, BACK: {} }, { FRONT: undefined },
        Object.defineProperty({}, 'FRONT', { value: undefined }), { [Symbol('saved')]: {} }]) {
        let calls = 0; const keys = Reflect.ownKeys(result);
        const wrapped = createAtlasFreshDetectionCheckpointLoader(source, (async () => { calls++; return result; }) as Loader);
        await assert.rejects(() => wrapped(lookup()), /FRESH_DETECTION_REQUIRED/);
        assert.equal(calls, 1); assert.deepEqual(Reflect.ownKeys(result), keys);
    }
    for (const malformed of [null, [], new Map(), Object.create({ FRONT: {} })])
        await assert.rejects(() => createAtlasFreshDetectionCheckpointLoader(source, (async () => malformed) as Loader)(lookup()), /FRESH_DETECTION_REQUIRED/);
});

test('lookup scope and deterministic operation binding are validated before consulting the original loader', async () => {
    let calls = 0; const wrapped = createAtlasFreshDetectionCheckpointLoader(source, async () => { calls++; return {}; });
    for (const change of [{ sessionId: 'other-session' }, { createdByUserId: 'other-owner' },
        { sessionRevision: '2026-09-08T20:00:00.001Z' }, { captureBindingSha256: 'b'.repeat(64) },
        { operationId: 'invented' }, { unexpected: true }])
        await assert.rejects(() => wrapped({ ...lookup(), ...change } as SpeedsterDetectionCheckpointLookup), /SOURCE_REVISION_CHANGED/);
    assert.equal(calls, 0);
});

test('source scope is snapshotted and original loader failures remain failures', async () => {
    const mutable = { ...source, updatedAt: new Date(source.updatedAt) };
    const wrapped = createAtlasFreshDetectionCheckpointLoader(mutable, async () => ({}));
    mutable.id = 'other-session'; mutable.updatedAt.setTime(+source.updatedAt + 1);
    assert.deepEqual(await wrapped(lookup()), {});
    const error = new Error('SYNTHETIC_RECEIPT_VALIDATION_FAILED');
    await assert.rejects(() => createAtlasFreshDetectionCheckpointLoader(source, async () => { throw error; })(lookup()), value => value === error);
});

function originalAction(checkpoints: unknown) {
    const side = (name: 'front' | 'back') => {
        const prefix = `ai-grader-v2/${source.createdByUserId}/${source.id}`;
        return { originalStorageKey: `${prefix}/original/${name}.jpg`, rectifiedStorageKey: `${prefix}/prepared/${name}/rectified.webp`,
            inspectionStorageKey: `${prefix}/prepared/${name}/inspection.webp`,
            inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
            viewStorageKeys: { NORMALIZED: `${prefix}/prepared/${name}/normalized.webp`, MICRO_DEFECT: `${prefix}/prepared/${name}/micro_defect.webp`,
                DIRECTIONAL: `${prefix}/prepared/${name}/directional.webp` },
            centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 },
            centeringQuad: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }] };
    };
    const session: SpeedsterReviewActionSession = { ...source, workflowState: 'CAPTURED', reviewedDefects: [], gradeReport: null,
        capture: { cornerShape: 'SQUARE', front: side('front'), back: side('back') } };
    const calls = { detect: 0, measure: 0, persist: 0, checkpoint: 0, learning: 0 };
    const deps: SpeedsterReviewActionDependencies = {
        loadOwnedSession: async () => session,
        presignRead: async key => `https://synthetic.invalid/${key}`,
        hashDetectionEvidence: async () => SHA,
        loadDetectionSideCheckpoints: async () => { calls.checkpoint++; return checkpoints as Awaited<ReturnType<Loader>>; },
        persistDetectionSideCheckpoint: async () => { assert.fail('A denied checkpoint may not be replaced'); },
        learningBankForDetect: async () => { calls.learning++; assert.fail('Blocked before any learning read'); },
        detect: async () => { calls.detect++; assert.fail('No worker allowed'); },
        measure: async () => { calls.measure++; assert.fail('No measurement allowed'); },
        persistReviewIfRevision: async () => { calls.persist++; assert.fail('No commit allowed'); },
    };
    return { deps, session, calls };
}

test('required wrapper refuses missing recovery ports and preserves the original worker/commit engine', () => {
    const { deps } = originalAction({});
    for (const key of ['hashDetectionEvidence', 'loadDetectionSideCheckpoints', 'persistDetectionSideCheckpoint'] as const)
        assert.throws(() => withAtlasFreshDetection(source, { ...deps, [key]: undefined }), /FRESH_DETECTION_COMPOSITION_REQUIRED/);
    const originalLoader = deps.loadDetectionSideCheckpoints;
    const wrapped = withAtlasFreshDetection(source, deps);
    assert.equal(wrapped.detect, deps.detect); assert.equal(wrapped.measure, deps.measure); assert.equal(wrapped.persistReviewIfRevision, deps.persistReviewIfRevision);
    assert.notEqual(wrapped.loadDetectionSideCheckpoints, deps.loadDetectionSideCheckpoints);
    assert.equal(deps.loadDetectionSideCheckpoints, originalLoader);
});

test('the real original INITIALIZE action rejects Front, Back and complete retained pairs before any worker or commit', async () => {
    for (const retained of [{ FRONT: {} }, { BACK: {} }, { FRONT: {}, BACK: {} }]) {
        const { deps, session, calls } = originalAction(retained);
        await assert.rejects(() => applySpeedsterReviewAction({ sessionId: source.id, createdByUserId: source.createdByUserId,
            action: { type: 'INITIALIZE' } }, withAtlasFreshDetection(session, deps)), /FRESH_DETECTION_REQUIRED/);
        assert.deepEqual(calls, { detect: 0, measure: 0, persist: 0, checkpoint: 1, learning: 0 });
        assert.equal(session.gradeReport, null); assert.deepEqual(session.reviewedDefects, []);
    }
});

test('a checkpoint appearing after the clean preclaim check is still denied by the original engine wrapper', async () => {
    const { tx } = database(); await assertAtlasFreshDetection(tx, source);
    const { deps, session, calls } = originalAction({ FRONT: { retainedAfterPreflight: true } });
    await assert.rejects(() => applySpeedsterReviewAction({ sessionId: source.id, createdByUserId: source.createdByUserId,
        action: { type: 'INITIALIZE' } }, withAtlasFreshDetection(session, deps)), /FRESH_DETECTION_REQUIRED/);
    assert.equal(calls.detect, 0); assert.equal(calls.measure, 0); assert.equal(calls.persist, 0); assert.equal(calls.checkpoint, 1);
});
