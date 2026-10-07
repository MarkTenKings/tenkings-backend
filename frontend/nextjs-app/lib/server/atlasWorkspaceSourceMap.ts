import type { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { appendSpeedsterMapAuthorityEvidence, speedsterMapAuthorityEvidenceFromCapture, type SpeedsterMapAuthorityEvent, type SpeedsterMapAuthorityFailure } from '../ai-grader-v2/map-authority';
import { bindSpeedsterPreparationCapture } from './speedsterPreparationCaptureEvidence';
import { canonicalizeSpeedsterSessionIdentity } from '../ai-grader-v2/identity';
import { preparationAttemptState, preparationManifestReference, type PreparationStore } from './speedsterPreparationAuthority';
import { preparationCanonicalJson, preparationHash, preparationRequire } from './speedsterPreparationIntegrity';
import { verifySpeedsterPreparationManifestBytes, type SpeedsterPreparationStorage } from './speedsterPreparationStorage';
import { resolveSpeedsterMapAuthority, type SpeedsterMapAuthoritySession } from './speedsterMapAuthority';
import { loadLockedEffectiveSpeedsterMapRevision, parseSpeedsterMapSourceSession, registerRestoredMapSide, parseSpeedsterMapRegistration, speedsterPhysicalQuadHash, SpeedsterMapIntegrityError, type SpeedsterAppliedMapRevision, type SpeedsterMapSourceSession } from './speedsterCardTypeMaps';
import { issueSpeedsterMapRegistrationReceipt, verifySpeedsterMapRegistrationReceipt } from './speedsterMapRegistrationAuthority';
import type { SpeedsterMapRegistration } from '../ai-grader-v2/card-type-map-contracts';
import type { MapBindingInput, PersistedSession } from './speedsterSessionCapture';
import type { AtlasAuthorizedWorkspaceSource, AtlasWorkspaceMapAction, AtlasWorkspaceMapPort, AtlasWorkspaceMapProjection, AtlasWorkspaceSourceAuthority, AtlasWorkspaceSourceRequest } from './atlasWorkspaceSource';
import type { AtlasWorkspaceSourceLedger } from './atlasWorkspaceSourceAuthority';
import { insertSpeedsterInstrumentationEventWithConflictDetection } from './aiGraderV2Instrumentation';

const SIDES = ['FRONT', 'BACK'] as const;
type Side = typeof SIDES[number];
type Json = Record<string, unknown>;
type MapSession = PersistedSession & SpeedsterMapAuthoritySession;
type SignedRegistration = SpeedsterMapRegistration & { serverReceipt: string };
type Outcome = Awaited<ReturnType<AtlasWorkspaceMapPort['run']>>;
type RegistrationInput = Parameters<AtlasWorkspaceSourceLedger['read']>[0];
type MapState = { version: 'atlas-workspace-map-v1'; scopeHash: string; revisionHash: string | null;
    registration: Partial<Record<Side, SignedRegistration>>;
    failed: Partial<Record<Side, boolean>>; lastAuthorityRequest?: string; lastAuthorityAction?: string;
    active?: { requestId: string; inputs: Partial<Record<Side, RegistrationInput>> } };
export type AtlasWorkspaceMapStore = Readonly<{
    load: () => Promise<MapSession>;
    result: (request: AtlasWorkspaceSourceRequest, scopeHash: string) => Promise<Outcome | null>;
    save: (session: MapSession, state: MapState, event?: SpeedsterMapAuthorityEvent, result?: Readonly<{ request: AtlasWorkspaceSourceRequest; outcome: Outcome }>) => Promise<MapSession>;
}>;
function check(value: unknown, code = 'WORKSPACE_MAP_AUTHORITY_CHANGED'): asserts value { preparationRequire(value, code); }
const clone = <T>(value: T): T => structuredClone(value);
function stateOf(session: PersistedSession): MapState | undefined {
    const capture = session.capture as Json, text = capture?.atlasWorkspaceMapCanonical;
    if (text === undefined) return undefined;
    check(typeof text === 'string' && Buffer.byteLength(text) <= 750000, 'WORKSPACE_MAP_STATE_INVALID');
    const state = JSON.parse(text);
    check(preparationCanonicalJson(state) === text && preparationHash(state) === capture.atlasWorkspaceMapHash, 'WORKSPACE_MAP_STATE_INVALID');
    return state;
}
const eventOf = (session: PersistedSession) => speedsterMapAuthorityEvidenceFromCapture(session.capture)?.current;
const emptyState = (scopeHash: string): MapState => ({ version: 'atlas-workspace-map-v1', scopeHash, revisionHash: null, registration: {}, failed: {} });
const eventKey = (sourceId: string, requestId: string) => `${sourceId}:atlas-map-result:${requestId}`;

/** Private source transactions retain the original map-authority history and
 * exact request result together. Browser DTOs never contain this binding. */
export function createPrismaAtlasWorkspaceMapStore(client: PrismaClient, authority: AtlasWorkspaceSourceAuthority,
    request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource): AtlasWorkspaceMapStore {
    const owner = { id: authorized.card.source.sourceId, createdByUserId: authorized.card.source.sourceOwnerId };
    const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => client.$transaction(async tx => {
        await authority.recheck(request, authorized, tx); const value = await work(tx); await authority.recheck(request, authorized, tx); return value;
    }, { maxWait: 5000, timeout: 10000 });
    return {
        load: () => transaction(async tx => { const session = await tx.aiGraderV2Session.findFirst({ where: owner }); check(session, 'WORKSPACE_SOURCE_UNAVAILABLE'); return session; }),
        result: (input, scopeHash) => transaction(async tx => {
            const row = await tx.aiGraderV2InstrumentationEvent.findUnique({ where: { eventKey: eventKey(owner.id, input.requestId) } });
            if (!row) return null;
            const details = row.details as Json;
            check(row.sessionId === owner.id && row.createdByUserId === owner.createdByUserId && row.category === 'MAP_APPLICATION'
                && row.eventType === 'ATLAS_WORKSPACE_MAP_RESULT' && details.scopeHash === scopeHash
                && details.action === authorized.operation.result.action && details.actorId === request.scope.actorId
                && preparationHash(details.request) === preparationHash(input));
            return details.outcome as Outcome;
        }),
        save: (session, state, event, result) => transaction(async tx => {
            check(session.id === owner.id && session.createdByUserId === owner.createdByUserId && session.workflowState === 'DRAFT');
            const capture = { ...(event ? appendSpeedsterMapAuthorityEvidence(session.capture, event) : session.capture as Json), atlasWorkspaceMapCanonical: preparationCanonicalJson(state), atlasWorkspaceMapHash: preparationHash(state) };
            check(Buffer.byteLength(JSON.stringify(capture)) <= 1_000_000, 'WORKSPACE_MAP_STATE_TOO_LARGE');
            const changed = await tx.aiGraderV2Session.updateMany({ where: { ...owner, workflowState: 'DRAFT', updatedAt: session.updatedAt }, data: { capture: capture as unknown as Prisma.InputJsonValue } });
            check(changed.count === 1);
            if (result) await insertSpeedsterInstrumentationEventWithConflictDetection(tx, {
                eventKey: eventKey(owner.id, result.request.requestId), sessionId: owner.id, createdByUserId: owner.createdByUserId,
                category: 'MAP_APPLICATION', eventType: 'ATLAS_WORKSPACE_MAP_RESULT', details: {
                    request: result.request, scopeHash: state.scopeHash, actorId: request.scope.actorId,
                    actorKind: authorized.card.claim.kind, action: authorized.operation.result.action, outcome: result.outcome,
                } as unknown as Prisma.InputJsonValue,
            });
            const saved = await tx.aiGraderV2Session.findFirst({ where: owner }); check(saved); return saved;
        }),
    };
}

export type AtlasWorkspaceMapDependencies = Readonly<{
    request: AtlasWorkspaceSourceRequest; authorized: AtlasAuthorizedWorkspaceSource; authority: AtlasWorkspaceSourceAuthority;
    store: AtlasWorkspaceMapStore; preparationStore: PreparationStore; storage: SpeedsterPreparationStorage;
    ledger: AtlasWorkspaceSourceLedger;
    loadMap: (input: Parameters<typeof loadLockedEffectiveSpeedsterMapRevision>[1]) => Promise<SpeedsterAppliedMapRevision | null>;
    registration?: Readonly<{ origin: string; apiKey: string; receiptEnv: NodeJS.ProcessEnv;
        invoke: (body: Json) => Promise<{ ok: boolean; status: number; payload: unknown }>;
        reference: (input: { storageKey: string; sha256: string }) => { read: () => Promise<Buffer>; readUrl: () => Promise<string> };
        readUrl: (key: string) => Promise<string> }>;
    verifyManifest?: typeof verifySpeedsterPreparationManifestBytes;
}>;

/** Original map lookup, original registration parser/worker protocol and original
 * MapBindingInput. An explicit HUMAN decision is the sole no-map override. */
export function createAtlasWorkspaceSourceMap(deps: AtlasWorkspaceMapDependencies) {
    const { request, authorized, authority, store, ledger } = deps;
    const assertHuman = () => check(authorized.card.claim.kind === 'HUMAN' && !('actorKind' in request.scope)
        && authorized.operation.action === 'MANUAL_ACTION' && authorized.operation.actorId === request.scope.actorId,
    'WORKSPACE_MAP_HUMAN_DECISION_REQUIRED');
    const context = async (capture?: Json) => {
        await authority.recheck(request, authorized);
        const session = await store.load(); check(session.workflowState === 'DRAFT', 'WORKSPACE_MAP_DRAFT_REQUIRED');
        const snapshot = await deps.preparationStore.read({ sessionId: session.id, createdByUserId: session.createdByUserId });
        const raw: Json = capture ? clone(capture) : { cornerShape: authorized.card.workspace.cornerShape };
        for (const side of SIDES) {
            const manifest = snapshot.manifests[side], attempt = snapshot.attempts[side], saved = authorized.card.workspace.preparation?.[side];
            check(manifest && attempt && preparationAttemptState(attempt, snapshot.heads[side]) === 'ADOPTED'
                && manifest.body.input.source.originalStorageKey === authorized.originals[side].upload.objectRef
                && manifest.body.input.source.sha256 === authorized.originals[side].verification.sha256, 'WORKSPACE_PREPARATION_CHANGED');
            await (deps.verifyManifest ?? verifySpeedsterPreparationManifestBytes)(manifest.body, deps.storage);
            if (!capture) {
                const centering = authorized.card.workspace.centering?.[side];
                check(centering?.confirmed === true && centering.preparationHash === manifest.manifestSha256
                    && saved?.manifestHash === manifest.manifestSha256
                    && preparationHash(saved.corners) === preparationHash(manifest.body.input.physicalQuad), 'WORKSPACE_CONFIRMED_PREPARATION_REQUIRED');
                const body = manifest.body;
                raw[side.toLowerCase()] = { preparation: preparationManifestReference(manifest), originalStorageKey: body.input.source.originalStorageKey,
                    rectifiedStorageKey: body.artifacts.RECTIFIED.storageKey, inspectionStorageKey: body.artifacts.INSPECTION.storageKey,
                    sourceCorners: body.input.physicalQuad, centeringQuad: centering.inner, inspectionFrame: body.inspectionFrame, transform: body.transform,
                    viewStorageKeys: Object.fromEntries(['NORMALIZED', 'MICRO_DEFECT', 'DIRECTIONAL'].map(role => [role, body.artifacts[role as 'NORMALIZED'].storageKey])) };
            }
        }
        const boundCapture = bindSpeedsterPreparationCapture(raw, { FRONT: snapshot.manifests.FRONT!, BACK: snapshot.manifests.BACK! });
        const source = parseSpeedsterMapSourceSession({ ...session, capture: boundCapture });
        const scopeHash = preparationHash({ captureHash: request.binding.captureHash, captureRevision: request.binding.captureRevision,
            identity: source.identity, cornerShape: source.cornerShape, front: source.front, back: source.back });
        const prior = stateOf(session), state = prior?.version === 'atlas-workspace-map-v1' && prior.scopeHash === scopeHash ? clone(prior) : emptyState(scopeHash);
        await authority.recheck(request, authorized);
        return { session, state, source, scopeHash, inspectionHashes: Object.fromEntries(SIDES.map(side => [side, snapshot.manifests[side]!.body.artifacts.INSPECTION.sha256])) };
    };
    type Context = Awaited<ReturnType<typeof context>>;
    const save = async (ctx: Context, event?: SpeedsterMapAuthorityEvent, outcome?: Outcome) => {
        ctx.session = await store.save(ctx.session, ctx.state, event, outcome ? { request, outcome } : undefined); return ctx.session;
    };
    const projection = (ctx: Context): AtlasWorkspaceMapProjection => {
        const event = eventOf(ctx.session); check(event, 'WORKSPACE_MAP_LOOKUP_REQUIRED');
        const registration = Object.fromEntries(SIDES.map(side => [side, ctx.state.registration[side] ? 'REGISTERED' : ctx.state.failed[side] ? 'FAILED' : 'MISSING'])) as AtlasWorkspaceMapProjection['registration'];
        const bindingReady = SIDES.every(side => registration[side] === 'REGISTERED') && ['LOADED', 'APPLIED'].includes(event.status);
        return { status: event.status, name: event.revision?.name ?? null, scope: event.revision?.scope ?? null,
            version: event.revision?.version ?? null, registration, bindingReady,
            canRegister: Boolean(deps.registration && ['LOADED', 'REGISTRATION_BLOCKED'].includes(event.status) && !bindingReady) };
    };
    const finish = async (ctx: Context, record = true): Promise<Outcome> => { const outcome: Outcome = { state: 'SUCCEEDED', map: projection(ctx) }; await save(ctx, undefined, record ? outcome : undefined); return outcome; };
    const resolve = async (ctx: Context, body: Json, selectedOverride?: SpeedsterAppliedMapRevision | null | Error) => {
        let selected: SpeedsterAppliedMapRevision | null = null;
        const result = await resolveSpeedsterMapAuthority({
            findSession: async () => {
                // A decision for different physical evidence cannot authorize the
                // new capture. Its original history remains in the persisted source.
                if (stateOf(ctx.session)?.scopeHash === ctx.scopeHash) return ctx.session;
                const capture = { ...(ctx.session.capture as Json) }; delete capture.mapAuthority;
                return { ...ctx.session, capture };
            },
            loadEffectiveMap: async input => { if (selectedOverride instanceof Error) throw selectedOverride;
                return selected = selectedOverride === undefined ? await deps.loadMap(input) : selectedOverride; },
            persistEvidence: async (_session, _actor, event) => {
                const revisionHash = event.revision?.revisionHash ?? null;
                if (ctx.state.revisionHash !== revisionHash) { ctx.state.registration = {}; ctx.state.failed = {}; delete ctx.state.active; }
                ctx.state.revisionHash = revisionHash; ctx.state.lastAuthorityRequest = request.requestId; ctx.state.lastAuthorityAction = authorized.operation.result.action; return save(ctx, event) as Promise<SpeedsterMapAuthoritySession>;
            },
        }, { sessionId: ctx.session.id, createdByUserId: ctx.session.createdByUserId, body });
        check(result.body.authority, 'WORKSPACE_MAP_AUTHORITY_CHANGED');
        // Idempotent original decisions may return without another write.
        if (stateOf(ctx.session)?.scopeHash !== ctx.scopeHash) await save(ctx);
        if (selected) {
            let changed = false;
            for (const side of SIDES) if (ctx.state.registration[side]) {
                try { validateRegistration(ctx, selected, side, ctx.state.registration[side]!); }
                catch { delete ctx.state.registration[side]; changed = true; }
            }
            if (changed) await save(ctx);
        }
        return selected;
    };
    const bind = (ctx: Context, selected: SpeedsterAppliedMapRevision): MapBindingInput => ({ revisionId: selected.revision.revisionId,
        filterPolicyVersion: selected.revision.filterPolicyVersion,
        registration: { front: ctx.state.registration.FRONT as unknown as Json, back: ctx.state.registration.BACK as unknown as Json } });
    const validateRegistration = (ctx: Context, selected: SpeedsterAppliedMapRevision, side: Side, raw: SignedRegistration) => {
        check(deps.registration, 'WORKSPACE_MAP_REGISTRATION_UNAVAILABLE');
        const { serverReceipt, ...unsigned } = raw, map = side === 'FRONT' ? selected.revision.frontMap : selected.revision.backMap;
        const registration = parseSpeedsterMapRegistration(unsigned, { side, mapRevisionId: selected.revision.revisionId,
            zones: map.zones, anchors: map.anchors, designBoundary: map.designBoundary });
        verifySpeedsterMapRegistrationReceipt({ receipt: serverReceipt, sessionId: ctx.session.id, operatorAdminId: ctx.session.createdByUserId,
            registration, env: deps.registration.receiptEnv });
        const current = side === 'FRONT' ? ctx.source.front : ctx.source.back;
        check(registration.currentPhysicalQuadSha256 === speedsterPhysicalQuadHash(current.sourceCorners)
            && registration.currentInspectionSha256 === ctx.inspectionHashes[side], 'WORKSPACE_MAP_REGISTRATION_CHANGED');
        return { ...registration, serverReceipt } as SignedRegistration;
    };
    const registerOne = async (ctx: Context, selected: SpeedsterAppliedMapRevision, side: Side) => {
        check(deps.registration, 'WORKSPACE_MAP_REGISTRATION_UNAVAILABLE');
        const config = deps.registration, current = side === 'FRONT' ? ctx.source.front : ctx.source.back;
        const map = side === 'FRONT' ? selected.revision.frontMap : selected.revision.backMap;
        const input: RegistrationInput = { requestId: request.requestId, cardId: request.cardId, purpose: 'MAP_REGISTRATION', side,
            binding: { ...request.binding }, request: { scopeHash: ctx.scopeHash, mapRevisionId: selected.revision.revisionId,
                mapRevisionHash: selected.revision.revisionHash, side, reference: map.referenceInspection,
                inspectionStorageKey: current.inspectionStorageKey, physicalQuad: current.sourceCorners } };
        ctx.state.active ??= { requestId: request.requestId, inputs: {} };
        check(ctx.state.active.requestId === request.requestId); ctx.state.active.inputs[side] = input; await save(ctx);
        const prior = await ledger.read(input); if (prior) return prior.result ?? { state: 'UNKNOWN', failureCode: 'WORKSPACE_MAP_REGISTRATION_UNCONFIRMED' };
        const reference = config.reference(map.referenceInspection);
        let rowId: string | undefined, reply: Awaited<ReturnType<typeof config.invoke>> | undefined;
        try {
            const registered = await registerRestoredMapSide(current, selected.revision.mapId, selected.revision.revisionId, map, {
                serviceUrl: config.origin, apiKey: config.apiKey, timeoutMs: 55000,
                hashEvidence: async key => {
                    const bytes = key === map.referenceInspection.storageKey ? await reference.read()
                        : key === current.inspectionStorageKey ? await deps.storage.read(key, 50 * 1024 * 1024) : null;
                    check(bytes, 'WORKSPACE_MAP_EVIDENCE_SCOPE_INVALID'); return createHash('sha256').update(bytes).digest('hex');
                },
                presignRead: async key => key === map.referenceInspection.storageKey ? reference.readUrl()
                    : key === current.inspectionStorageKey ? config.readUrl(key) : Promise.reject(new Error('WORKSPACE_MAP_EVIDENCE_SCOPE_INVALID')),
                fetchImpl: async (url, init) => {
                    check(url === `${config.origin}/map-registration` && init?.method === 'POST'
                        && (init.headers as Record<string, string>).Authorization === `Bearer ${config.apiKey}`, 'WORKSPACE_MAP_WORKER_SCOPE_INVALID');
                    const claim = await ledger.claim(input); check(claim.claimed, 'WORKSPACE_MAP_REGISTRATION_UNCONFIRMED'); rowId = claim.row.id;
                    await authority.recheck(request, authorized); await ledger.dispatch(input, claim.row.id);
                    reply = await config.invoke(JSON.parse(String(init.body)));
                    return new Response(JSON.stringify(reply.payload), { status: reply.status, headers: { 'content-type': 'application/json' } });
                },
            });
            check(rowId && reply?.ok, 'WORKSPACE_MAP_REGISTRATION_UNCONFIRMED');
            check(registered.version !== 'opencv-redundant-ransac-registration-v2'
                || !['HUMAN_CORRECTION', 'REGISTRATION_LESSON'].includes(registered.candidateProvenance?.source ?? ''), 'WORKSPACE_MAP_REGISTRATION_PROVENANCE_INVALID');
            const signed = { ...registered, serverReceipt: issueSpeedsterMapRegistrationReceipt({ operatorAdminId: ctx.session.createdByUserId,
                sessionId: ctx.session.id, registration: registered, env: config.receiptEnv }) };
            return (await ledger.complete(input, rowId, { state: 'SUCCEEDED', registration: signed })).result;
        } catch (error) {
            if (!rowId) {
                const held = await ledger.read(input);
                if (held) return held.result ?? { state: 'UNKNOWN', failureCode: 'WORKSPACE_MAP_REGISTRATION_UNCONFIRMED' };
                throw Object.assign(new Error('WORKSPACE_MAP_REFERENCE_UNVERIFIED'), { mapPreDispatchFailure: true });
            }
            const terminal = reply && (reply.ok || reply.status >= 400 && reply.status < 500);
            return (await ledger.complete(input, rowId, { state: terminal ? 'FAILED' : 'UNKNOWN', failureCode: terminal
                ? 'CARD_MAP_REGISTRATION_REJECTED' : 'WORKSPACE_MAP_REGISTRATION_UNCONFIRMED' })).result;
        }
    };
    const blocked = async (ctx: Context, selected: SpeedsterAppliedMapRevision) => {
        const failures: SpeedsterMapAuthorityFailure[] = SIDES.filter(side => ctx.state.failed[side]).map(side => ({ side,
            source: 'TEN_KINGS_API', code: 'CARD_MAP_REGISTRATION_REJECTED', httpStatus: null, requestId: request.requestId }));
        if (failures.length) await resolve(ctx, { action: 'BLOCK_REGISTRATION', mapRevisionId: selected.revision.revisionId,
            mapRevisionHash: selected.revision.revisionHash, mapScope: selected.appliedScope, operationId: request.requestId, failures });
        else {
            // Registration recovered both sides; the prior blocker stays in history.
            const prior = eventOf(ctx.session)!;
            if (prior.status === 'REGISTRATION_BLOCKED') await save(ctx, { ...prior, attemptId: request.requestId, recordedAt: new Date().toISOString(),
                status: 'LOADED', failureCode: null, message: 'Both sides registered to the exact active Card Map revision.', registrationFailures: [], operatorDecisionId: null });
        }
    };
    const register = async (ctx: Context, selected: SpeedsterAppliedMapRevision, statusOnly = false, record = true): Promise<Outcome> => {
        for (const side of SIDES) {
            if (ctx.state.registration[side]) {
                try { ctx.state.registration[side] = validateRegistration(ctx, selected, side, ctx.state.registration[side]!); continue; }
                catch { delete ctx.state.registration[side]; }
            }
            let result;
            if (statusOnly) {
                const input = ctx.state.active?.requestId === request.requestId && ctx.state.active.inputs[side];
                const row = input ? await ledger.read(input) : null;
                result = row?.result ?? { state: 'UNKNOWN' };
            } else result = await registerOne(ctx, selected, side);
            await authority.recheck(request, authorized);
            if (result?.state === 'SUCCEEDED') {
                ctx.state.registration[side] = validateRegistration(ctx, selected, side, result.registration as SignedRegistration);
                delete ctx.state.failed[side]; await save(ctx);
            } else if (result?.state === 'FAILED') {
                ctx.state.failed[side] = true; await save(ctx); break;
            } else return { state: 'UNKNOWN', failureCode: 'WORKSPACE_MAP_REGISTRATION_UNCONFIRMED' };
        }
        await blocked(ctx, selected); delete ctx.state.active;
        return finish(ctx, record);
    };
    const run: AtlasWorkspaceMapPort['run'] = async (_request, _authorized, action) => {
        assertHuman(); check(action === authorized.operation.result.action);
        const ctx = await context(), prior = await store.result(request, ctx.scopeHash); if (prior) return prior;
        if (action === 'CONTINUE_WITHOUT_MAP') {
            check(authorized.operation.result.payload.confirmed === true && /^[a-f0-9-]{36}$/.test(authorized.operation.operationId ?? '')
                && stateOf(ctx.session)?.scopeHash === ctx.scopeHash && !ctx.state.active, 'WORKSPACE_MAP_HUMAN_DECISION_REQUIRED');
            await resolve(ctx, { action: 'CONTINUE_WITHOUT_MAP', decisionId: authorized.operation.operationId }); return finish(ctx);
        }
        const selected = await resolve(ctx, { action: 'RESOLVE_LOOKUP' });
        if (ctx.state.active && ctx.state.active.requestId !== request.requestId) delete ctx.state.active;
        if (action === 'REGISTER_MAP' && selected && ['LOADED', 'REGISTRATION_BLOCKED'].includes(eventOf(ctx.session)!.status)) {
            try { return await register(ctx, selected); }
            catch (error) {
                if (!(error && typeof error === 'object' && 'mapPreDispatchFailure' in error)) throw error;
                await resolve(ctx, { action: 'RESOLVE_LOOKUP' }, new SpeedsterMapIntegrityError('The selected map reference could not be verified before registration.'));
            }
        }
        return finish(ctx);
    };
    const status: AtlasWorkspaceMapPort['status'] = async () => {
        if (authorized.operation.result.action === 'INITIALIZE_REPORT') {
            const source = await store.load(), saved = stateOf(source);
            const result = saved ? await store.result(request, saved.scopeHash) : null;
            return result ?? { state: 'PENDING' };
        }
        const ctx = await context(), prior = await store.result(request, ctx.scopeHash); if (prior) return prior;
        if (authorized.operation.result.action === 'REGISTER_MAP' && ctx.state.active?.requestId === request.requestId) {
            const selected = await deps.loadMap({ cardProfile: ctx.source.cardProfile, identity: ctx.source.identity });
            check(selected?.revision.revisionHash === ctx.state.revisionHash, 'WORKSPACE_MAP_AUTHORITY_CHANGED');
            return register(ctx, selected, true);
        }
        if (ctx.state.lastAuthorityRequest === request.requestId && ctx.state.lastAuthorityAction === authorized.operation.result.action && !ctx.state.active
            && (['RESOLVE_MAP', 'CONTINUE_WITHOUT_MAP'].includes(authorized.operation.result.action) || ['NO_MAP', 'HUMAN_REVIEW_WITHOUT_MAP'].includes(eventOf(ctx.session)?.status ?? ''))) return finish(ctx);
        return { state: 'UNKNOWN', failureCode: 'WORKSPACE_MAP_OUTCOME_UNCONFIRMED' };
    };
    const binding = async (_request: AtlasWorkspaceSourceRequest, _authorized: AtlasAuthorizedWorkspaceSource, _session: PersistedSession, capture: Json): Promise<MapBindingInput | undefined> => {
            const ctx = await context(capture), retained = await store.result(request, ctx.scopeHash);
            if (retained) throw Object.assign(new Error('WORKSPACE_MAP_REVIEW_REQUIRED'), { workspaceMapOutcome: retained });
            if (authorized.card.claim.kind === 'ASTRA') {
                // Automatic lookup/registration can use the existing machine
                // source permit. It cannot manufacture a HUMAN map decision.
                const selected = await resolve(ctx, { action: 'RESOLVE_LOOKUP' });
                if (selected && ['LOADED', 'REGISTRATION_BLOCKED'].includes(eventOf(ctx.session)!.status)) {
                    if (!deps.registration) throw Object.assign(new Error('WORKSPACE_MAP_REGISTRATION_UNAVAILABLE'), { workspaceMapOutcome: { state: 'FAILED', failureCode: 'WORKSPACE_MAP_REGISTRATION_UNAVAILABLE' } });
                    const outcome = await register(ctx, selected, false, false);
                    if (outcome.state !== 'SUCCEEDED') throw Object.assign(new Error('WORKSPACE_MAP_REVIEW_REQUIRED'), { workspaceMapOutcome: outcome });
                }
            }
            check(stateOf(ctx.session)?.scopeHash === ctx.scopeHash, 'WORKSPACE_MAP_LOOKUP_REQUIRED');
            const event = eventOf(ctx.session); check(event, 'WORKSPACE_MAP_LOOKUP_REQUIRED');
            if (event.status === 'NO_MAP' || event.status === 'HUMAN_REVIEW_WITHOUT_MAP') return undefined;
            if (!['LOADED', 'APPLIED'].includes(event.status) || !SIDES.every(side => ctx.state.registration[side])) {
                throw Object.assign(new Error('WORKSPACE_MAP_REVIEW_REQUIRED'), { workspaceMapOutcome: { state: 'FAILED', failureCode: 'WORKSPACE_MAP_REVIEW_REQUIRED', map: projection(ctx) } });
            }
            const selected = await deps.loadMap({ cardProfile: ctx.source.cardProfile,
                identity: canonicalizeSpeedsterSessionIdentity(ctx.source.cardProfile, ctx.session.identity) });
            check(selected && selected.revision.revisionHash === ctx.state.revisionHash, 'WORKSPACE_MAP_AUTHORITY_CHANGED');
            for (const side of SIDES) ctx.state.registration[side] = validateRegistration(ctx, selected, side, ctx.state.registration[side]!);
            return bind(ctx, selected);
    };
    const retainFailure = async (capture: Json, error?: unknown): Promise<Outcome> => {
        await authority.recheck(request, authorized);
        const ctx = await context(capture), prior = await store.result(request, ctx.scopeHash); if (prior) return prior;
        let outcome: Outcome = { state: 'FAILED', failureCode: 'WORKSPACE_MAP_REVIEW_REQUIRED' };
        if (error && typeof error === 'object' && 'workspaceMapOutcome' in error) outcome = error.workspaceMapOutcome as Outcome;
        else if (ctx.state.active?.requestId === request.requestId) {
            for (const input of Object.values(ctx.state.active.inputs)) {
                const row = await ledger.read(input!);
                if (row && !['SUCCEEDED', 'FAILED'].includes(row.state)) outcome = { state: 'UNKNOWN', failureCode: 'WORKSPACE_MAP_REGISTRATION_UNCONFIRMED' };
            }
        }
        await save(ctx, undefined, outcome); return outcome;
    };
    return { run, status,
        failCapture: (_request: AtlasWorkspaceSourceRequest, _authorized: AtlasAuthorizedWorkspaceSource, capture: Json) => retainFailure(capture),
        binding: async (...args: Parameters<typeof binding>) => {
            try { return await binding(...args); }
            catch (error) { const outcome = await retainFailure(args[3], error);
                throw Object.assign(new Error('WORKSPACE_MAP_REVIEW_REQUIRED'), { workspaceMapOutcome: outcome }); }
        },
    };
}
