import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createAtlasWorkspaceSourceMap, type AtlasWorkspaceMapDependencies, type AtlasWorkspaceMapStore } from '../lib/server/atlasWorkspaceSourceMap';
import { beginSpeedsterPreparation, claimSpeedsterPreparationDispatch, adoptSpeedsterPreparation } from '../lib/server/speedsterPreparationAuthority';
import { preparationBytesHash, preparationHash, preparationCanonicalJson } from '../lib/server/speedsterPreparationIntegrity';
import { appendSpeedsterMapAuthorityEvidence, speedsterMapAuthorityEvidenceFromCapture } from '../lib/ai-grader-v2/map-authority';
import { parseSpeedsterMapSourceSession, speedsterIdentityMapRegistration, SpeedsterMapIntegrityError } from '../lib/server/speedsterCardTypeMaps';
import { validateSpeedsterSubmittedMapBinding } from '../lib/server/speedsterSessionCapture';
import { verifySpeedsterMapRegistrationReceipt } from '../lib/server/speedsterMapRegistrationAuthority';
import { FixturePreparationStore, FixturePreparationStorage, fixturePreparationRequest, fixturePreparationBody } from './fixtures/speedsterPreparation';
import { bindSpeedsterPreparationCapture } from '../lib/server/speedsterPreparationCaptureEvidence';
import { preparedCaptureIdentity, preparedCaptureSide } from './fixtures/speedsterPreparedCapture';
import type { AtlasAuthorizedWorkspaceSource, AtlasWorkspaceMapAction, AtlasWorkspaceSourceRequest } from '../lib/server/atlasWorkspaceSource';
import type { AtlasWorkspaceSourceLedger } from '../lib/server/atlasWorkspaceSourceAuthority';

type Row = Record<string, any>;
const SIDES = ['FRONT', 'BACK'] as const;
async function mapFixture() {
    const cardId = randomUUID(), actorId = randomUUID(), creatorId = randomUUID();
    const preparationStore = new FixturePreparationStore(), storage = new FixturePreparationStorage();
    const source = { sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}`, sourceType: 'SPEEDSTER' };
    const session: Row = { id: source.sourceId, createdByUserId: source.sourceOwnerId, cardProfile: 'SPORTS', identity: preparedCaptureIdentity,
        workflowState: 'DRAFT', updatedAt: new Date(), capture: {} };
    preparationStore.session = session as never;
    const raw: Row = { cornerShape: 'SQUARE' }, prepared: Row = {}, centering: Row = {}, originals: Row = {};
    for (const side of SIDES) {
        const scope = { sessionId: session.id, createdByUserId: session.createdByUserId, side };
        const request = fixturePreparationRequest(scope), { attempt } = await beginSpeedsterPreparation(request, preparationStore);
        const claim = await claimSpeedsterPreparationDispatch(scope, attempt.id, attempt.sideRevision, preparationStore);
        const body = fixturePreparationBody(attempt, side), manifest = await adoptSpeedsterPreparation(body, claim.attempt.dispatchClaimId!, preparationStore);
        storage.installBody(body, side); raw[side.toLowerCase()] = preparedCaptureSide(manifest);
        prepared[side] = { status: 'PREPARED', manifestHash: manifest.manifestSha256, corners: body.input.physicalQuad, matColor: 'BLACK' };
        centering[side] = { inner: raw[side.toLowerCase()].centeringQuad, confirmed: true, preparationHash: manifest.manifestSha256 };
        originals[side] = { upload: { objectRef: body.input.source.originalStorageKey }, verification: { sha256: body.input.source.sha256 } };
    }
    const snapshot = await preparationStore.read({ sessionId: session.id, createdByUserId: session.createdByUserId });
    Object.assign(raw, bindSpeedsterPreparationCapture(raw, { FRONT: snapshot.manifests.FRONT!, BACK: snapshot.manifests.BACK! }));
    let request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource;
    const state = { session, results: new Map<string, Row>(), ledger: new Map<string, Row>(), calls: [] as Row[], revoked: false,
        failLookup: null as Error | null, selected: null as Row | null, response: 'OK', failSave: false, failResult: false, saveCount: 0 };
    const authority = { load: async () => authorized, recheck: async () => { if (state.revoked) throw new Error('REVOKED'); } };
    const mapStore: AtlasWorkspaceMapStore = {
        load: async () => structuredClone(state.session) as never,
        result: async (request, scopeHash) => {
            const saved = state.results.get(request.requestId); if (!saved) return null;
            assert.equal(saved.scopeHash, scopeHash); assert.deepEqual(saved.request, request); return structuredClone(saved.outcome);
        },
        save: async (before, value, event, outcome) => {
            await authority.recheck(); if (state.failSave || state.failResult && outcome) throw new Error('saved source reply interrupted');
            assert.equal(+before.updatedAt, +state.session.updatedAt, 'Exact source CAS');
            state.session = { ...state.session, capture: { ...(event ? appendSpeedsterMapAuthorityEvidence(state.session.capture, event) : state.session.capture), atlasWorkspaceMapCanonical: preparationCanonicalJson(value), atlasWorkspaceMapHash: preparationHash(value) }, updatedAt: new Date(+state.session.updatedAt + 1) };
            state.saveCount++;
            if (outcome) { assert(!state.results.has(outcome.request.requestId)); state.results.set(outcome.request.requestId, structuredClone({ ...outcome, scopeHash: value.scopeHash })); }
            return structuredClone(state.session) as never;
        },
    };
    const key = (input: Row) => `${input.requestId}:${input.side}`;
    const ledger = {
        read: async (input: Row) => { await authority.recheck(); const row = state.ledger.get(key(input)); if (row) assert.deepEqual(row.input, input); return structuredClone(row ?? null); },
        claim: async (input: Row) => {
            await authority.recheck(); assert.equal(input.purpose, 'MAP_REGISTRATION'); const prior = state.ledger.get(key(input));
            if (prior) return { claimed: false, row: structuredClone(prior) };
            const row = { id: randomUUID(), input: structuredClone(input), state: 'RESERVED', result: null }; state.ledger.set(key(input), row); return { claimed: true, row: structuredClone(row) };
        },
        dispatch: async (input: Row, id: string) => { await authority.recheck(); const row = state.ledger.get(key(input))!; assert.equal(row.id, id); assert.equal(row.state, 'RESERVED'); row.state = 'DISPATCHED'; },
        complete: async (input: Row, id: string, result: Row) => { const row = state.ledger.get(key(input))!; assert.equal(row.id, id); assert.equal(row.state, 'DISPATCHED'); row.state = result.state; row.result = structuredClone(result); return structuredClone(row); },
        finishPermit: async () => {},
    } as unknown as AtlasWorkspaceSourceLedger;
    const receiptEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test', SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY: 'm'.repeat(64), SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY_ID: 'fixture-map' };
    const selected = () => {
        const side = (name: 'FRONT' | 'BACK') => {
            const value = raw[name.toLowerCase()], evidence = { storageKey: value.inspectionStorageKey, sha256: preparationBytesHash(storage.objects.get(value.inspectionStorageKey)!) };
            return { side: name, referenceInspection: evidence, sourcePhysicalQuadSha256: preparationHash(value.sourceCorners), designBoundary: { kind: 'FULL_BLEED' },
                anchors: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }].map((point, i) => ({ id: `a${i}`, label: `Anchor ${i}`, point, referencePatch: evidence })),
                zones: [{ id: 'fixture-zone', label: 'Synthetic printed mark', semanticType: 'PRINT_TEXT', polygon: [{ x: .1, y: .1 }, { x: .2, y: .1 }, { x: .2, y: .2 }] }] };
        };
        return { appliedScope: 'EXACT', appliedMapName: 'Synthetic fixture map', sourceProvenance: { sourceSessionId: 'fixture-source', sourceIdentity: preparedCaptureIdentity },
            revision: { createdAt: new Date(), displayIdentity: preparedCaptureIdentity, mapSchemaVersion: 'speedster-card-type-map-v1', mapId: 'fixture-map', revisionId: 'fixture-revision', revisionHash: 'a'.repeat(64), version: 3, filterPolicyVersion: 'speedster-map-filter-v1', frontMap: side('FRONT'), backMap: side('BACK') } };
    };
    let deps: AtlasWorkspaceMapDependencies, service: ReturnType<typeof createAtlasWorkspaceSourceMap>;
    const next = (action: AtlasWorkspaceMapAction | 'INITIALIZE_REPORT', options: { machine?: boolean; confirmed?: boolean } = {}) => {
        request = { requestId: randomUUID(), cardId, scope: { actorId, sessionHash: 'f'.repeat(64), controlRevision: 1 }, binding: { captureRevision: 1, captureHash: 'b'.repeat(64), claimFence: 1, workflowRevision: state.saveCount + 3 } };
        authorized = { card: { id: cardId, creatorId, source, claim: { kind: options.machine ? 'ASTRA' : 'HUMAN', actorId }, workspace: { cornerShape: 'SQUARE', preparation: prepared, centering } },
            operation: { actorId, cardId, action: options.machine ? 'MACHINE_SOURCE_ACTION' : 'MANUAL_ACTION', operationId: randomUUID(), result: { requestId: request.requestId, action, payload: options.confirmed === undefined ? {} : { confirmed: options.confirmed }, phase: 'REQUESTED', binding: request.binding } }, originals } as unknown as AtlasAuthorizedWorkspaceSource;
        deps = { request, authorized, authority, store: mapStore, preparationStore, storage, ledger,
            verifyManifest: async body => { for (const artifact of Object.values(body.artifacts)) assert.equal(preparationBytesHash(await storage.read(artifact.storageKey)), artifact.sha256); },
            loadMap: async () => { if (state.failLookup) throw state.failLookup; return state.selected as never; },
            registration: { origin: 'https://map.fixture.invalid', apiKey: 'fixture-map-api-key', receiptEnv,
                readUrl: async () => 'https://storage.fixture.invalid/current', reference: value => ({ read: () => storage.read(value.storageKey), readUrl: async () => 'https://storage.fixture.invalid/reference' }),
                invoke: async body => {
                    state.calls.push(body); assert.equal(state.ledger.get(`${request.requestId}:${body.side}`)?.state, 'DISPATCHED');
                    if (state.response === 'UNKNOWN') throw new Error('Worker transport lost');
                    if (state.response === 'FAILED') return { ok: false, status: 422, payload: { error: 'synthetic registration failed' } };
                    const parsed = parseSpeedsterMapSourceSession({ ...session, capture: raw } as never), map = body.side === 'FRONT' ? state.selected!.revision.frontMap : state.selected!.revision.backMap;
                    const payload = speedsterIdentityMapRegistration(map, body.side === 'FRONT' ? parsed.front : parsed.back, state.selected!.revision.revisionId);
                    if (state.response === 'REVOKED') state.revoked = true;
                    if (state.response === 'LOST_ADOPTION' || state.response === 'LOST_SECOND_ADOPTION' && body.side === 'BACK') state.failSave = true;
                    return { ok: true, status: 200, payload };
                } },
        }; service = createAtlasWorkspaceSourceMap(deps); return service;
    };
    next('RESOLVE_MAP');
    return { state, raw, selected, next, get request() { return request; }, get authorized() { return authorized; }, get service() { return service; }, get deps() { return deps; },
        run: () => service.run(request, authorized, authorized.operation.result.action as AtlasWorkspaceMapAction),
        binding: () => service.binding(request, authorized, state.session as never, raw), mapState: () => JSON.parse(state.session.capture.atlasWorkspaceMapCanonical),
        editMap: (edit: (value: Row) => void) => { const value = JSON.parse(state.session.capture.atlasWorkspaceMapCanonical); edit(value); state.session.capture.atlasWorkspaceMapCanonical = preparationCanonicalJson(value); state.session.capture.atlasWorkspaceMapHash = preparationHash(value); }, storage, receiptEnv };
}

test('source map: actual no-map result is distinct from recorded lookup failure and genuine human consent', async () => {
    const f = await mapFixture(), result = await f.run(); assert.equal(result.map?.status, 'NO_MAP'); assert.equal(f.state.calls.length, 0);
    f.next('CONTINUE_WITHOUT_MAP', { confirmed: true }); await assert.rejects(f.run(), /WORKSPACE_MAP_AUTHORITY_CHANGED/);
    f.next('RESOLVE_MAP'); f.state.failLookup = new Error('database unavailable'); const failed = await f.run(); assert.equal(failed.map?.status, 'LOOKUP_FAILED');
    f.next('CONTINUE_WITHOUT_MAP', { confirmed: false }); await assert.rejects(f.run(), /WORKSPACE_MAP_HUMAN_DECISION_REQUIRED/);
    f.next('CONTINUE_WITHOUT_MAP', { confirmed: true }); const decision = await f.run(); assert.equal(decision.map?.status, 'HUMAN_REVIEW_WITHOUT_MAP');
    const count = f.state.saveCount; assert.deepEqual(await f.run(), decision); assert.equal(f.state.saveCount, count);
    const history = speedsterMapAuthorityEvidenceFromCapture(f.state.session.capture)!;
    assert.deepEqual(history.history.map(row => row.status), ['NO_MAP', 'LOOKUP_FAILED', 'HUMAN_REVIEW_WITHOUT_MAP']);
    assert.equal(history.current.operatorDecisionId, f.authorized.operation.operationId);
    f.next('INITIALIZE_REPORT'); assert.equal(await f.binding(), undefined); assert.equal(f.state.calls.length, 0);
});

test('source map: integrity errors and machine claims cannot manufacture missing-map consent', async () => {
    const f = await mapFixture(); f.state.failLookup = new SpeedsterMapIntegrityError('bad immutable revision'); assert.equal((await f.run()).map?.status, 'INTEGRITY_ERROR');
    f.next('CONTINUE_WITHOUT_MAP', { confirmed: true }); await assert.rejects(f.run(), /WORKSPACE_MAP_AUTHORITY_CHANGED/);
    f.next('CONTINUE_WITHOUT_MAP', { confirmed: true, machine: true }); await assert.rejects(f.run(), /WORKSPACE_MAP_HUMAN_DECISION_REQUIRED/);
    f.state.failLookup = new Error('lookup failed'); f.next('INITIALIZE_REPORT', { machine: true });
    await assert.rejects(f.binding(), (error: any) => error.workspaceMapOutcome?.state === 'FAILED');
    assert.equal(speedsterMapAuthorityEvidenceFromCapture(f.state.session.capture)?.current.status, 'LOOKUP_FAILED'); assert.equal(f.state.calls.length, 0);
});

test('source map: exact original Front+Back registration and signed MapBindingInput pass original capture validation', async () => {
    const f = await mapFixture(); f.state.selected = f.selected(); assert.equal((await f.run()).map?.status, 'LOADED'); assert.equal(f.state.calls.length, 0);
    f.next('REGISTER_MAP'); const done = await f.run(); assert.equal(done.map?.bindingReady, true); assert.deepEqual(f.state.calls.map(row => row.side), ['FRONT', 'BACK']);
    assert(!JSON.stringify(done).includes('Receipt')); assert(!JSON.stringify(done).includes('revisionId')); assert(!JSON.stringify(done).includes('storageKey'));
    const count = f.state.calls.length; assert.deepEqual(await f.service.status(f.request, f.authorized), done); assert.equal(f.state.calls.length, count);
    f.next('INITIALIZE_REPORT'); const binding = await f.binding(); assert.equal(binding?.revisionId, f.state.selected.revision.revisionId);
    const result = await validateSpeedsterSubmittedMapBinding(f.state.session as never, binding, f.raw, { loadActiveMap: async () => f.state.selected as never,
        hashEvidence: async key => preparationBytesHash(await f.storage.read(key)), verifyReceipt: input => verifySpeedsterMapRegistrationReceipt({ ...input, env: f.receiptEnv }) });
    assert.equal(result.mapRevisionId, f.state.selected.revision.revisionId);
    f.editMap(value => { value.registration.FRONT.serverReceipt = 'foreign'; }); await assert.rejects(f.binding(), /WORKSPACE_MAP_REVIEW_REQUIRED/);
});

test('source map: real failed registration preserves history and permits explicit human decision; unknown holds never resend', async () => {
    for (const mode of ['FAILED', 'UNKNOWN']) {
        const f = await mapFixture(); f.state.selected = f.selected(); await f.run(); f.next('REGISTER_MAP'); f.state.response = mode;
        const result = await f.run(); assert.equal(f.state.calls.length, 1);
        if (mode === 'FAILED') { assert.equal(result.map?.status, 'REGISTRATION_BLOCKED'); f.next('CONTINUE_WITHOUT_MAP', { confirmed: true }); assert.equal((await f.run()).map?.status, 'HUMAN_REVIEW_WITHOUT_MAP'); }
        else { assert.equal(result.state, 'UNKNOWN'); const recovered = await f.service.status(f.request, f.authorized); assert.equal(recovered.state, 'UNKNOWN'); assert.equal(f.state.calls.length, 1); }
    }
});

test('source map: changed centering invalidates prior human decision while retaining immutable authority history', async () => {
    const f = await mapFixture(); f.state.failLookup = new Error('fixture lookup error'); await f.run(); f.next('CONTINUE_WITHOUT_MAP', { confirmed: true }); await f.run();
    f.state.failLookup = null; const centering = f.authorized.card.workspace.centering as Row; centering.FRONT.inner = [{ x: .06, y: .05 }, { x: .95, y: .05 }, { x: .95, y: .95 }, { x: .05, y: .95 }];
    f.next('RESOLVE_MAP'); const result = await f.run(); assert.equal(result.map?.status, 'NO_MAP');
    assert.deepEqual(speedsterMapAuthorityEvidenceFromCapture(f.state.session.capture)!.history.map(row => row.status), ['LOOKUP_FAILED', 'HUMAN_REVIEW_WITHOUT_MAP', 'NO_MAP']);
});

test('source map: a late successful registration is retained in its ledger after revoked human authority, without adoption', async () => {
    const f = await mapFixture(); f.state.selected = f.selected(); await f.run(); f.next('REGISTER_MAP'); f.state.response = 'REVOKED';
    await assert.rejects(f.run(), /REVOKED/); assert.equal(f.state.calls.length, 1);
    assert.equal([...f.state.ledger.values()][0].result.state, 'SUCCEEDED'); assert.deepEqual(f.mapState().registration, {});
});


test('source map: lost final registration adoption recovers exact retained side results without a new worker dispatch', async () => {
    const f = await mapFixture(); f.state.selected = f.selected(); await f.run(); f.next('REGISTER_MAP'); f.state.response = 'LOST_SECOND_ADOPTION';
    await assert.rejects(f.run(), /saved source reply interrupted/); assert.equal(f.state.calls.length, 2);
    f.state.failSave = false; const recovered = await f.service.status(f.request, f.authorized);
    assert.equal(recovered.map?.bindingReady, true); assert.equal(f.state.calls.length, 2);
    assert.deepEqual(await f.service.status(f.request, f.authorized), recovered);
});


test('source map: lost lookup result recovers its already-recorded original authority without another lookup or decision', async () => {
    const f = await mapFixture(); f.state.failResult = true; await assert.rejects(f.run(), /saved source reply interrupted/);
    assert.equal(speedsterMapAuthorityEvidenceFromCapture(f.state.session.capture)?.current.status, 'NO_MAP');
    f.state.failResult = false; f.state.failLookup = new Error('Do not repeat the lookup');
    const recovered = await f.service.status(f.request, f.authorized); assert.equal(recovered.map?.status, 'NO_MAP');
    assert.equal(speedsterMapAuthorityEvidenceFromCapture(f.state.session.capture)?.history.length, 1); assert.equal(f.state.calls.length, 0);
});

test('source map: machine map failure is a retained attention result, never a fabricated human decision or resumed paid request', async () => {
    const f = await mapFixture(); f.state.selected = f.selected(); f.next('INITIALIZE_REPORT', { machine: true }); f.state.response = 'FAILED';
    await assert.rejects(f.binding(), (error: any) => error.workspaceMapOutcome?.failureCode === 'WORKSPACE_MAP_REVIEW_REQUIRED');
    const status = await f.service.status(f.request, f.authorized); assert.equal(status.state, 'FAILED');
    await assert.rejects(f.binding()); assert.equal(f.state.calls.length, 1);
    const history = speedsterMapAuthorityEvidenceFromCapture(f.state.session.capture)!;
    assert.equal(history.current.status, 'REGISTRATION_BLOCKED'); assert(!history.history.some(row => row.status === 'HUMAN_REVIEW_WITHOUT_MAP'));
});
