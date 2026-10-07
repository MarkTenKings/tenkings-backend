import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { SPEEDSTER_RULE_VERSION, type SpeedsterCardSide, type SpeedsterQuad } from '../ai-grader-v2/contracts';
import { canonicalizeNewSpeedsterSessionIdentity } from '../ai-grader-v2/identity';
import { sanitizeSpeedsterUnitQuad } from '../ai-grader-v2/geometry';
import { parseSpeedsterColorGeometryProposal, type SpeedsterColorGeometryProposal, type SpeedsterMatColor } from '../ai-grader-v2/color-geometry';
import type { SpeedsterPreparationSource } from '../ai-grader-v2/preparation';
import { preparationAttemptState, preparationManifestReference, type PreparationManifest, type PreparationOwner,
    type PreparationStore, type PreparationTransaction } from './speedsterPreparationAuthority';
import { prepareSpeedsterSide, type SpeedsterPreparationServiceDependencies } from './speedsterPreparationService';
import { assertPreparationIdentity, preparationHash, preparationRequire } from './speedsterPreparationIntegrity';
import { freezeSpeedsterPreparationSource, verifySpeedsterPreparationManifestBytes } from './speedsterPreparationStorage';
import { issueSpeedsterColorGeometryReceipt, verifySpeedsterColorGeometryReceipt } from './speedsterColorGeometryAuthority';
import { savePreparedSpeedsterSessionCapture, speedsterSessionCaptureDependencies,
    type MapBindingInput, type PersistedSession, type SpeedsterSessionCaptureDependencies } from './speedsterSessionCapture';
import type { PrismaPreparationTransaction } from './speedsterPreparationStore';
import { validateAtlasWorkspaceMachineSource, type AtlasWorkspaceMachineProof, type AtlasWorkspaceValidatedMachine } from './atlasWorkspaceSourceMachine';
import { SpeedsterMapIntegrityError } from './speedsterCardTypeMaps';
import { insertSpeedsterInstrumentationEventWithConflictDetection } from './aiGraderV2Instrumentation';

const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().min(1).max(2147483646);
const requestSchema = z.object({ requestId: uuid, cardId: uuid,
    scope: z.union([z.object({ actorId: uuid, sessionHash: sha, controlRevision: revision }).strict(),
        z.object({ actorKind: z.literal('MACHINE'), actorId: uuid, accessVersion: revision, controlRevision: revision,
            runId: uuid, runRevision: revision, leaseFence: revision, runControlRevision: revision }).strict()]),
    binding: z.object({ captureRevision: revision, captureHash: sha, claimFence: revision, workflowRevision: revision }).strict(),
}).strict();
const sides = ['FRONT', 'BACK'] as const;
const exact = (value: unknown, expected: unknown) => preparationHash(value) === preparationHash(expected);
type JsonObject = Record<string, unknown>;
export type AtlasWorkspaceMapAction = 'RESOLVE_MAP' | 'REGISTER_MAP' | 'CONTINUE_WITHOUT_MAP';
type Action = 'PREPARE_SIDE' | 'INITIALIZE_REPORT' | AtlasWorkspaceMapAction;
export type AtlasWorkspaceMapProjection = Readonly<{ status: 'LOADED' | 'NO_MAP' | 'LOOKUP_FAILED' | 'INTEGRITY_ERROR' | 'REGISTRATION_BLOCKED' | 'HUMAN_REVIEW_WITHOUT_MAP' | 'APPLIED';
    name: string | null; scope: 'EXACT' | 'FAMILY' | null; version: number | null; registration: Readonly<Record<SpeedsterCardSide, 'MISSING' | 'REGISTERED' | 'FAILED' | 'UNKNOWN'>>; bindingReady: boolean; canRegister: boolean }>;
export type AtlasWorkspaceMapPort = Readonly<{ failCapture?: (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource, capture: JsonObject) => Promise<Pick<AtlasWorkspaceSourceResult, 'state' | 'failureCode'>>;
    run: (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource, action: AtlasWorkspaceMapAction) => Promise<Pick<AtlasWorkspaceSourceResult, 'state' | 'map' | 'failureCode'>>;
    status: (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource) => Promise<Pick<AtlasWorkspaceSourceResult, 'state' | 'map' | 'failureCode'>> }>;
const machineSelection = Symbol('validated-atlas-machine-source-selection');
export type AtlasWorkspaceSourceRequest = z.output<typeof requestSchema>;
export type AtlasWorkspaceSourceResult = Readonly<{
    state: 'SUCCEEDED' | 'PENDING' | 'UNKNOWN' | 'FAILED'; requestId: string; cardId: string;
    captureHash: string; claimFence: number; action: Action; side?: SpeedsterCardSide;
    preparation?: Readonly<{ manifestHash: string; width: number; height: number; sourceCorners: SpeedsterQuad;
        matColor: SpeedsterMatColor; centeringProposal: SpeedsterQuad | null }>;
    specimenId?: string; failureCode?: string; map?: AtlasWorkspaceMapProjection;
}>;
type VerifiedOriginal = Readonly<{
    upload: Readonly<{ id: string; cardId: string; side: SpeedsterCardSide; sourceId: string; sourceOwnerId: string; objectRef: string;
        sha256: string; byteCount: number; contentType: string }>;
    verification: Readonly<{ objectRef: string; sha256: string; byteCount: number; contentType: string;
        width: number; height: number; versionId?: string }>;
}>;
type SavedPreparation = Readonly<{ status: string; corners: SpeedsterQuad; matColor: SpeedsterMatColor; manifestHash?: string }>;
type SavedCentering = Readonly<{ inner: SpeedsterQuad; confirmed: boolean; preparationHash: string }>;
export type AtlasAuthorizedWorkspaceSource = Readonly<{
    card: Readonly<{ id: string; creatorId: string; revision: number; state: string;
        source: Readonly<{ sourceType: string; sourceId: string; sourceOwnerId: string }>;
        captureRevision: number; captureHash: string; claimFence: number;
        claim: Readonly<{ id: string; kind: string; actorId: string; fence: number; captureRevision: number; captureHash: string;
            runId?: string | null; workflowRevision?: number; accessVersion?: number; controlRevision?: number }>;
        sides: Readonly<Record<SpeedsterCardSide, Readonly<{ uploadId: string; verificationId: string }>>>;
        identity: JsonObject;
        workspace: Readonly<{ identity?: JsonObject; cornerShape?: 'SQUARE' | 'ROUNDED_3_18_MM';
            preparation?: Partial<Record<SpeedsterCardSide, SavedPreparation>>;
            centering?: Partial<Record<SpeedsterCardSide, SavedCentering>>;
            pending?: Readonly<{ requestId: string; action: Action; side?: SpeedsterCardSide; binding: AtlasWorkspaceSourceRequest['binding'] }> }>; }>;
    originals: Readonly<Record<SpeedsterCardSide, VerifiedOriginal>>;
    operation: Readonly<{ actorId: string; cardId: string; action: string; operationId?: string;
        result: Readonly<{ requestId: string; action: Action; payload: JsonObject; binding: AtlasWorkspaceSourceRequest['binding']; phase: string; accessVersion?: number }> }>;
    machine?: AtlasWorkspaceMachineProof;
    sourceAdmission?: Readonly<{ requestId: string; cardId: string; specimenId: string; sourceId: string; sourceOwnerId: string;
        actorKind: 'HUMAN' | 'MACHINE'; actorId: string; captureHash: string; claimFence: number }>;
    [machineSelection]?: AtlasWorkspaceValidatedMachine;
}>;
export type AtlasWorkspaceSourceAuthority = Readonly<{
    /** Authenticates the signed private transport and reads the retained exact
     * MANUAL_ACTION intent, current staff session, pilot and workspace claim. */
    load: (request: AtlasWorkspaceSourceRequest) => Promise<AtlasAuthorizedWorkspaceSource>;
    /** Rechecks the same authority. For source writes this executes using the
     * provided transaction, so a late result cannot outrun takeover/revocation. */
    recheck: (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource, transaction?: unknown) => Promise<void>;
}>;
type SessionPort = Readonly<{
    find: (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource) => Promise<PersistedSession | null>;
    ensure: (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource) => Promise<PersistedSession>;
}>;

function newSource(authorized: AtlasAuthorizedWorkspaceSource) {
    const { card } = authorized, input = authorized[machineSelection]?.selection.identity ?? card.workspace.identity ?? card.identity;
    const { category, ...fields } = input;
    preparationRequire(category === 'SPORTS' || category === 'POKEMON', 'WORKSPACE_IDENTITY_REQUIRED');
    const identity = canonicalizeNewSpeedsterSessionIdentity(category, fields);
    return { id: `atlas-${card.id}`, createdByUserId: `atlas-staff-${card.creatorId}`, cardProfile: category, identity,
        workflowState: 'DRAFT' as const, ruleVersion: SPEEDSTER_RULE_VERSION,
        capture: {} as Prisma.InputJsonValue, reviewedDefects: [] as Prisma.InputJsonValue, gradeReport: {} as Prisma.InputJsonValue };
}

function assertSource(session: PersistedSession, authorized: AtlasAuthorizedWorkspaceSource) {
    const expected = newSource(authorized);
    const admission = authorized.sourceAdmission, retainedInitialization = authorized.operation.result.action === 'INITIALIZE_REPORT'
        && admission?.requestId === authorized.operation.result.requestId && admission.cardId === authorized.card.id
        && admission.specimenId === authorized.card.id && admission.sourceId === expected.id && admission.sourceOwnerId === expected.createdByUserId
        && admission.actorId === authorized.card.claim.actorId && admission.captureHash === authorized.card.captureHash
        && admission.claimFence === authorized.card.claimFence && admission.actorKind === (authorized.card.claim.kind === 'ASTRA' ? 'MACHINE' : 'HUMAN');
    preparationRequire(session.id === expected.id && session.createdByUserId === expected.createdByUserId
        && session.cardProfile === expected.cardProfile && session.ruleVersion === expected.ruleVersion
        && exact(session.identity, expected.identity) && (['DRAFT', 'CAPTURED'].includes(String(session.workflowState)) || retainedInitialization),
    'WORKSPACE_SOURCE_CHANGED');
    return session;
}

/** One deterministic original AiGraderV2Session; no copied historical session,
 * V1 card/item, label, public slug or report is created by this adapter. */
export function createPrismaAtlasWorkspaceSessions(client: PrismaClient, authority: AtlasWorkspaceSourceAuthority): SessionPort {
    const find = async (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource, create: boolean) => client.$transaction(async tx => {
        authorized = await validateAuthorized(request, authorized);
        await authority.recheck(request, authorized, tx);
        const expected = newSource(authorized);
        // The current staff/workspace authority owns serialization. An existing
        // draft read takes no source lock in the reverse of preparation order.
        let session = await tx.aiGraderV2Session.findUnique({ where: { id: expected.id } });
        if (!session && create) {
            // Prisma create sends model defaults for finishing columns. This
            // source role may insert only draft capture fields; PostgreSQL owns
            // the untouched finishing defaults. Millisecond timestamps preserve
            // exact Date-based source revision comparisons in original services.
            const inserted = await tx.$executeRaw`INSERT INTO public."AiGraderV2Session"
                (id,"createdByUserId","cardProfile","workflowState","ruleVersion",identity,capture,"reviewedDefects","gradeReport","createdAt","updatedAt")
                VALUES (${expected.id},${expected.createdByUserId},${expected.cardProfile},${expected.workflowState},${expected.ruleVersion},
                    ${JSON.stringify(expected.identity)}::jsonb,${JSON.stringify(expected.capture)}::jsonb,
                    ${JSON.stringify(expected.reviewedDefects)}::jsonb,${JSON.stringify(expected.gradeReport)}::jsonb,
                    date_trunc('milliseconds',statement_timestamp()) AT TIME ZONE 'UTC',date_trunc('milliseconds',statement_timestamp()) AT TIME ZONE 'UTC')`;
            preparationRequire(inserted === 1, 'WORKSPACE_SOURCE_UNAVAILABLE');
            session = await tx.aiGraderV2Session.findUnique({ where: { id: expected.id } });
        }
        if (session) assertSource(session, authorized);
        await authority.recheck(request, authorized, tx);
        return session;
    }, { maxWait: 5000, timeout: 10000 });
    return { find: (request, authorized) => find(request, authorized, false), ensure: async (request, authorized) => {
        const value = await find(request, authorized, true); preparationRequire(value, 'WORKSPACE_SOURCE_UNAVAILABLE'); return value;
    } };
}

async function validateAuthorized(request: AtlasWorkspaceSourceRequest, value: AtlasAuthorizedWorkspaceSource) {
    const { card, operation, originals } = value;
    const pending = card?.workspace?.pending;
    preparationRequire(card?.id === request.cardId && uuid.safeParse(card.creatorId).success
        && (card.revision === request.binding.workflowRevision || card.revision > request.binding.workflowRevision
            && pending?.requestId === request.requestId && exact(pending.binding, request.binding))
        && card.captureRevision === request.binding.captureRevision
        && card.captureHash === request.binding.captureHash && card.claimFence === request.binding.claimFence
        && card.source?.sourceType === 'SPEEDSTER' && card.source.sourceId === `atlas-${card.id}`
        && card.source.sourceOwnerId === `atlas-staff-${card.creatorId}`
        && ['HUMAN', 'ASTRA'].includes(card.claim?.kind) && card.claim.actorId === request.scope.actorId
        && (card.claim.kind === 'ASTRA' ? 'actorKind' in request.scope && request.scope.actorKind === 'MACHINE' : !('actorKind' in request.scope))
        && card.claim.fence === card.claimFence && card.claim.captureRevision === card.captureRevision && card.claim.captureHash === card.captureHash
        && ['IN_PROGRESS', 'NEEDS_ATTENTION'].includes(card.state), 'WORKSPACE_SOURCE_SCOPE_CHANGED');
    const intent = operation?.result;
    preparationRequire(operation?.actorId === request.scope.actorId && operation.cardId === card.id
        && operation.action === (card.claim.kind === 'HUMAN' ? 'MANUAL_ACTION' : 'MACHINE_SOURCE_ACTION')
        && intent?.requestId === request.requestId && ['PREPARE_SIDE', 'INITIALIZE_REPORT', 'RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP'].includes(intent.action)
        && (card.claim.kind === 'HUMAN' || ['PREPARE_SIDE', 'INITIALIZE_REPORT'].includes(intent.action)) && intent.phase === 'REQUESTED'
        && exact(intent.binding, request.binding) && pending?.requestId === request.requestId && pending.action === intent.action
        && exact(pending.binding, request.binding), 'WORKSPACE_SOURCE_INTENT_CHANGED');
    if (intent.action === 'PREPARE_SIDE') preparationRequire(sides.includes(intent.payload.side as SpeedsterCardSide)
        && pending.side === intent.payload.side, 'WORKSPACE_SOURCE_INTENT_CHANGED');
    for (const side of sides) {
        const entry = originals?.[side], upload = entry?.upload, verified = entry?.verification;
        preparationRequire(upload && verified && upload.cardId === card.id && upload.side === side
            && upload.id === card.sides[side]?.uploadId && uuid.safeParse(card.sides[side]?.verificationId).success
            && upload.sourceId === card.source.sourceId && upload.sourceOwnerId === card.source.sourceOwnerId
            && upload.objectRef === verified.objectRef && upload.sha256 === verified.sha256 && upload.byteCount === verified.byteCount
            && upload.contentType === verified.contentType && sha.safeParse(upload.sha256).success, 'WORKSPACE_ORIGINAL_CHANGED');
    }
    const captureHash = preparationHash({ source: card.source, captureRevision: card.captureRevision,
        sides: Object.fromEntries(sides.map(side => [side, { uploadId: originals[side].upload.id, ...originals[side].verification }])) });
    preparationRequire(captureHash === card.captureHash, 'WORKSPACE_ORIGINAL_CHANGED');
    const verified = { ...value, [machineSelection]: card.claim.kind === 'ASTRA' ? await validateAtlasWorkspaceMachineSource(request, value) : undefined };
    preparationRequire(card.claim.kind === 'ASTRA' || value.machine === undefined, 'WORKSPACE_MACHINE_PROOF_INVALID');
    newSource(verified);
    return verified;
}

function guardedStore<Tx extends PreparationTransaction>(store: PreparationStore<Tx>, authority: AtlasWorkspaceSourceAuthority,
    request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource): PreparationStore<Tx> {
    return { read: async owner => { await authority.recheck(request, authorized); return store.read(owner); },
        transaction: (owner, work) => store.transaction(owner, async tx => {
            await authority.recheck(request, authorized, 'database' in tx ? tx.database : tx);
            const result = await work(tx);
            await authority.recheck(request, authorized, 'database' in tx ? tx.database : tx);
            return result;
        }) };
}

export type AtlasWorkspaceGeometryLookup = Readonly<{
    request: AtlasWorkspaceSourceRequest; authorized: AtlasAuthorizedWorkspaceSource; side: SpeedsterCardSide;
    preparationRequestId: string; matColor: SpeedsterMatColor;
}>;
export type AtlasWorkspaceGeometryInput = AtlasWorkspaceGeometryLookup & Readonly<{ source: SpeedsterPreparationSource }>;
export type AtlasWorkspaceGeometryResult = Readonly<{
    state: 'SUCCEEDED' | 'PENDING' | 'UNKNOWN' | 'FAILED'; failureCode?: string;
    result?: SpeedsterColorGeometryProposal; serverReceipt?: string;
}>;
export type AtlasWorkspaceGeometryPort = Readonly<{
    read: (input: AtlasWorkspaceGeometryLookup) => Promise<AtlasWorkspaceGeometryResult | null>;
    run: (input: AtlasWorkspaceGeometryInput) => Promise<AtlasWorkspaceGeometryResult>;
}>;
type PhysicalBinding = Readonly<{ purpose: 'ATLAS_PHYSICAL_GEOMETRY'; requestId: string; cardId: string; captureHash: string;
    claimFence: number; side: SpeedsterCardSide; sourceId: string; sourceOwnerId: string; sourceHash: string; matColor: SpeedsterMatColor }>;
export type AtlasWorkspaceGeometryLedger = Readonly<{
    read: (binding: PhysicalBinding) => Promise<AtlasWorkspaceGeometryResult | null>;
    /** Atomically retains max one dispatch and its existing image-budget hold.
     * A pre-existing or unknown claim returns claimed:false and its status. */
    claim: (binding: PhysicalBinding) => Promise<Readonly<{ claimed: boolean; claimId: string; result: AtlasWorkspaceGeometryResult }>>;
    complete: (binding: PhysicalBinding, claimId: string, result: AtlasWorkspaceGeometryResult) => Promise<AtlasWorkspaceGeometryResult>;
}>;

/** Existing /geometry protocol and Color authority, with one retained dispatch.
 * No invented/manual machine outcome and no transport retry. The budget-aware
 * ledger remains a required injected port; this helper creates no budget. */
export function createAtlasWorkspacePhysicalGeometry({ ledger, invoke, readUrl, authority,
    issueReceipt = issueSpeedsterColorGeometryReceipt }: Readonly<{
    ledger: AtlasWorkspaceGeometryLedger; authority: AtlasWorkspaceSourceAuthority;
    invoke: (body: Readonly<{ imageUrl: string; matColor: SpeedsterMatColor }>) => Promise<Readonly<{ ok: boolean; status: number; payload: unknown }>>;
    readUrl: (key: string) => Promise<string>; issueReceipt?: typeof issueSpeedsterColorGeometryReceipt;
}>): AtlasWorkspaceGeometryPort {
    const binding = (input: AtlasWorkspaceGeometryLookup): PhysicalBinding => ({ purpose: 'ATLAS_PHYSICAL_GEOMETRY',
        requestId: input.preparationRequestId, cardId: input.request.cardId, captureHash: input.request.binding.captureHash,
        claimFence: input.request.binding.claimFence, side: input.side, sourceId: input.authorized.card.source.sourceId,
        sourceOwnerId: input.authorized.card.source.sourceOwnerId,
        sourceHash: input.authorized.originals[input.side].verification.sha256, matColor: input.matColor });
    return { read: input => ledger.read(binding(input)), run: async input => {
        const bound = binding(input); await authority.recheck(input.request, input.authorized);
        preparationRequire(input.source.sha256 === bound.sourceHash
            && input.source.originalStorageKey === input.authorized.originals[input.side].upload.objectRef,
        'WORKSPACE_ORIGINAL_CHANGED');
        const prior = await ledger.read(bound); if (prior) return prior;
        const claim = await ledger.claim(bound); if (!claim.claimed) return claim.result;
        let response;
        try {
            await authority.recheck(input.request, input.authorized);
            response = await invoke({ imageUrl: await readUrl(input.source.storageKey), matColor: input.matColor });
        } catch {
            return ledger.complete(bound, claim.claimId, { state: 'UNKNOWN', failureCode: 'PHYSICAL_GEOMETRY_OUTCOME_UNCONFIRMED' });
        }
        if (!response.ok) return ledger.complete(bound, claim.claimId, { state: response.status >= 400 && response.status < 500 ? 'FAILED' : 'UNKNOWN',
            failureCode: response.status >= 400 && response.status < 500 ? 'PHYSICAL_GEOMETRY_REJECTED' : 'PHYSICAL_GEOMETRY_OUTCOME_UNCONFIRMED' });
        let result: SpeedsterColorGeometryProposal, serverReceipt: string;
        try {
            preparationRequire(response.payload && typeof response.payload === 'object', 'PHYSICAL_GEOMETRY_INVALID');
            const payload = response.payload as JsonObject;
            result = parseSpeedsterColorGeometryProposal(payload.colorGeometry, { mode: 'PHYSICAL_OUTER', matColor: input.matColor });
            const corners = payload.corners === null ? null : sanitizeSpeedsterUnitQuad(payload.corners);
            preparationRequire((result.outcome === 'ACCEPTED') === Boolean(corners)
                && (result.outcome !== 'ACCEPTED' || exact(corners, result.proposal)), 'PHYSICAL_GEOMETRY_INVALID');
            serverReceipt = issueReceipt({ operatorAdminId: bound.sourceOwnerId, sessionId: bound.sourceId, side: bound.side,
                mode: 'PHYSICAL_OUTER', sourceImageStorageKey: input.source.originalStorageKey,
                sourceImageSha256: bound.sourceHash, matColor: bound.matColor, physicalQuadSha256: null, result });
        } catch { return ledger.complete(bound, claim.claimId, { state: 'FAILED', failureCode: 'PHYSICAL_GEOMETRY_INVALID' }); }
        // A valid late response is retained even if current human authority was
        // revoked. It cannot be applied until the outer source recheck succeeds.
        return ledger.complete(bound, claim.claimId, { state: 'SUCCEEDED', result, serverReceipt });
    } };
}

type InitializationPort = Readonly<{
    /** These methods use the existing scoped intake/initialization bridge and
     * original fresh detection. They return retained status, never free grades. */
    status: (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource, source: PersistedSession) => Promise<Pick<AtlasWorkspaceSourceResult, 'state' | 'specimenId' | 'failureCode'>>;
    run: (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource, source: PersistedSession) => Promise<Pick<AtlasWorkspaceSourceResult, 'state' | 'specimenId' | 'failureCode'>>;
}>;
export type AtlasWorkspaceSourceDependencies = Readonly<{
    authority: AtlasWorkspaceSourceAuthority; sessions: SessionPort;
    preparation: SpeedsterPreparationServiceDependencies; geometry: AtlasWorkspaceGeometryPort;
    capture?: SpeedsterSessionCaptureDependencies; maps?: AtlasWorkspaceMapPort;
    mapBinding?: (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource, source: PersistedSession, capture: JsonObject) => Promise<MapBindingInput | undefined>;
    initialization: InitializationPort;
    freezeSource?: typeof freezeSpeedsterPreparationSource;
    verifyManifest?: typeof verifySpeedsterPreparationManifestBytes;
    verifyColorReceipt?: typeof verifySpeedsterColorGeometryReceipt;
    recordMachineCapture?: (tx: PrismaPreparationTransaction, source: PreparationOwner, provenance: JsonObject) => Promise<void>;
}>;

/** The only complete preparation/capture implementation is the original one.
 * This adapter derives its input from retained ATLAS records, never from a page
 * handler or a caller-chosen legacy owner, storage URL, report or numeric grade. */
export function createAtlasWorkspaceSource(deps: AtlasWorkspaceSourceDependencies) {
    const load = async (raw: unknown) => {
        const parsed = requestSchema.safeParse(raw); preparationRequire(parsed.success, 'WORKSPACE_SOURCE_REQUEST_INVALID');
        const request = parsed.data, authorized = await validateAuthorized(request, await deps.authority.load(request));
        return { request, authorized, owner: { sessionId: authorized.card.source.sourceId, createdByUserId: authorized.card.source.sourceOwnerId } };
    };
    const response = (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource,
        state: AtlasWorkspaceSourceResult['state'], extra: Partial<AtlasWorkspaceSourceResult> = {}): AtlasWorkspaceSourceResult => {
        preparationRequire(['SUCCEEDED', 'PENDING', 'UNKNOWN', 'FAILED'].includes(state), 'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED');
        preparationRequire(extra.failureCode === undefined || /^[A-Z][A-Z0-9_]{0,79}$/.test(extra.failureCode), 'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED');
        preparationRequire(extra.specimenId === undefined || uuid.safeParse(extra.specimenId).success, 'WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED');
        if (authorized.operation.result.action === 'INITIALIZE_REPORT' && state === 'SUCCEEDED') {
            preparationRequire(uuid.safeParse(extra.specimenId).success, 'WORKSPACE_INITIALIZATION_UNCONFIRMED');
        }
        return { state, requestId: request.requestId, cardId: request.cardId, captureHash: request.binding.captureHash,
            claimFence: request.binding.claimFence, action: authorized.operation.result.action,
            ...(authorized.operation.result.action === 'PREPARE_SIDE' ? { side: authorized.operation.result.payload.side as SpeedsterCardSide } : {}),
            ...(extra.preparation ? { preparation: extra.preparation } : {}),
            ...(extra.map && ['RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP'].includes(authorized.operation.result.action) ? { map: extra.map } : {}), ...(extra.specimenId ? { specimenId: extra.specimenId } : {}), ...(extra.failureCode ? { failureCode: extra.failureCode } : {}) };
    };
    const boundary = (authorized: AtlasAuthorizedWorkspaceSource, side: SpeedsterCardSide) => {
        const saved = authorized[machineSelection]?.selection.boundaries.find(value => value.side === side)
            ?? authorized.card.workspace.preparation?.[side], corners = sanitizeSpeedsterUnitQuad(saved?.corners);
        preparationRequire(saved && corners && exact(corners, saved.corners) && ['BLACK', 'WHITE', 'MAGENTA'].includes(saved.matColor), 'WORKSPACE_BOUNDARY_REQUIRED');
        return { ...saved, corners };
    };
    const machinePhysicalAttention = (authorized: AtlasAuthorizedWorkspaceSource, geometry: AtlasWorkspaceGeometryResult, side: SpeedsterCardSide) =>
        authorized[machineSelection] && geometry.state === 'SUCCEEDED'
            && (geometry.result?.outcome !== 'ACCEPTED' || !exact(geometry.result.proposal, boundary(authorized, side).corners));
    const readAttempt = (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource, owner: PreparationOwner, side: SpeedsterCardSide) =>
        guardedStore(deps.preparation.store, deps.authority, request, authorized).transaction(owner, async tx => {
            const attempt = await tx.findIdempotentAttempt(side, request.requestId);
            return { attempt, state: attempt ? preparationAttemptState(attempt, tx.snapshot.heads[side]) : null,
                manifest: attempt ? await tx.findManifest(attempt.id) : null, snapshot: tx.snapshot };
        });
    const prepared = async (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource, manifest: PreparationManifest) => {
        const side = manifest.side, selected = boundary(authorized, side), original = authorized.originals[side];
        preparationManifestReference(manifest);
        preparationRequire(manifest.body.input.source.originalStorageKey === original.upload.objectRef
            && manifest.body.input.source.sha256 === original.verification.sha256 && exact(manifest.body.input.physicalQuad, selected.corners)
            && manifest.body.input.matColor === selected.matColor, 'WORKSPACE_PREPARATION_CHANGED');
        await (deps.verifyManifest ?? verifySpeedsterPreparationManifestBytes)(manifest.body, deps.preparation.storage);
        await deps.authority.recheck(request, authorized);
        return { manifestHash: manifest.manifestSha256,
            width: manifest.body.artifacts.RECTIFIED.width, height: manifest.body.artifacts.RECTIFIED.height,
            sourceCorners: manifest.body.input.physicalQuad, matColor: manifest.body.input.matColor,
            centeringProposal: manifest.body.printedColorResult.proposal };
    };
    const statusLoaded = async (request: AtlasWorkspaceSourceRequest, authorized: AtlasAuthorizedWorkspaceSource, owner: PreparationOwner) => {
        if (['RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP'].includes(authorized.operation.result.action)) {
            preparationRequire(deps.maps, 'WORKSPACE_MAP_NOT_CONFIGURED');
            const result = await deps.maps.status(request, authorized); await deps.authority.recheck(request, authorized);
            return response(request, authorized, result.state, result);
        }
        const session = await deps.sessions.find(request, authorized);
        if (!session) return response(request, authorized, 'PENDING');
        assertSource(session, authorized);
        if (authorized.operation.result.action === 'INITIALIZE_REPORT') {
            if (session.workflowState === 'DRAFT') {
                const mapResult = await deps.maps?.status(request, authorized);
                if (mapResult && ['FAILED', 'UNKNOWN'].includes(mapResult.state)) return response(request, authorized, mapResult.state, mapResult);
                return response(request, authorized, 'PENDING');
            }
            const status = await deps.initialization.status(request, authorized, session);
            await deps.authority.recheck(request, authorized);
            return response(request, authorized, status.state, status);
        }
        const side = authorized.operation.result.payload.side as SpeedsterCardSide;
        const retained = await readAttempt(request, authorized, owner, side);
        if (retained.state === 'ADOPTED' && retained.manifest) {
            const projection = await prepared(request, authorized, retained.manifest);
            if (authorized[machineSelection] && retained.manifest.body.printedColorResult.outcome !== 'ACCEPTED') {
                return response(request, authorized, 'FAILED', { failureCode: 'WORKSPACE_MACHINE_PRINTED_REVIEW_REQUIRED' });
            }
            return response(request, authorized, 'SUCCEEDED', { preparation: projection });
        }
        if (retained.state === 'FAILED' || retained.state === 'SUPERSEDED') return response(request, authorized, 'FAILED', { failureCode: `PREPARATION_${retained.state}` });
        if (retained.state === 'RUNNING_OR_UNRESOLVED') return response(request, authorized, 'UNKNOWN', { failureCode: 'PREPARATION_OUTCOME_UNCONFIRMED' });
        const selected = boundary(authorized, side);
        const physical = await deps.geometry.read({ request, authorized, side, preparationRequestId: request.requestId, matColor: selected.matColor });
        await deps.authority.recheck(request, authorized);
        if (physical && machinePhysicalAttention(authorized, physical, side)) return response(request, authorized, 'FAILED',
            { failureCode: 'WORKSPACE_MACHINE_PHYSICAL_REVIEW_REQUIRED' });
        if (physical && physical.state !== 'SUCCEEDED') return response(request, authorized, physical.state,
            physical.failureCode ? { failureCode: physical.failureCode } : {});
        return response(request, authorized, 'PENDING');
    };
    return {
        async map(raw: unknown, action: AtlasWorkspaceMapAction) {
            const { request, authorized } = await load(raw);
            preparationRequire(deps.maps && authorized.card.claim.kind === 'HUMAN' && authorized.operation.result.action === action, 'WORKSPACE_SOURCE_ACTION_INVALID');
            const result = await deps.maps.run(request, authorized, action); await deps.authority.recheck(request, authorized);
            return response(request, authorized, result.state, result);
        },
        async status(raw: unknown) {
            const { request, authorized, owner } = await load(raw);
            return statusLoaded(request, authorized, owner);
        },
        async prepare(raw: unknown) {
            const { request, authorized, owner } = await load(raw);
            preparationRequire(authorized.operation.result.action === 'PREPARE_SIDE', 'WORKSPACE_SOURCE_ACTION_INVALID');
            // Missing preparation release fails before physical-geometry spending.
            assertPreparationIdentity(deps.preparation.approvedRelease());
            const side = authorized.operation.result.payload.side as SpeedsterCardSide, selected = boundary(authorized, side);
            assertSource(await deps.sessions.ensure(request, authorized), authorized);
            const retained = await readAttempt(request, authorized, owner, side);
            if (retained.attempt) return statusLoaded(request, authorized, owner);
            const source = await (deps.freezeSource ?? freezeSpeedsterPreparationSource)({ ...owner, side }, authorized.originals[side].upload.objectRef, deps.preparation.storage);
            preparationRequire(source.sha256 === authorized.originals[side].verification.sha256
                && source.byteCount === authorized.originals[side].verification.byteCount, 'WORKSPACE_ORIGINAL_CHANGED');
            await deps.authority.recheck(request, authorized);
            const geometry = await deps.geometry.run({ request, authorized, side, preparationRequestId: request.requestId, source, matColor: selected.matColor });
            if (geometry.state !== 'SUCCEEDED') return response(request, authorized, geometry.state,
                geometry.failureCode ? { failureCode: geometry.failureCode } : {});
            if (machinePhysicalAttention(authorized, geometry, side)) return response(request, authorized, 'FAILED',
                { failureCode: 'WORKSPACE_MACHINE_PHYSICAL_REVIEW_REQUIRED' });
            preparationRequire(geometry.result && geometry.serverReceipt, 'WORKSPACE_PHYSICAL_EVIDENCE_REQUIRED');
            (deps.verifyColorReceipt ?? verifySpeedsterColorGeometryReceipt)(geometry.serverReceipt, { operatorAdminId: owner.createdByUserId,
                sessionId: owner.sessionId, side, mode: 'PHYSICAL_OUTER', sourceImageStorageKey: source.originalStorageKey,
                sourceImageSha256: source.sha256, matColor: selected.matColor, physicalQuadSha256: null, result: geometry.result });
            await deps.authority.recheck(request, authorized);
            const store = guardedStore(deps.preparation.store, deps.authority, request, authorized);
            const head = retained.snapshot.heads[side];
            try {
                await prepareSpeedsterSide({ sessionId: owner.sessionId, side, sourceImageStorageKey: source.originalStorageKey,
                    corners: selected.corners, matColor: selected.matColor,
                    preparationRequest: { idempotencyKey: request.requestId,
                        expectedHead: { sideRevision: head?.sideRevision ?? 0, attemptId: head?.activeAttemptId ?? null } } }, owner.createdByUserId,
                { ...deps.preparation, store });
            } catch (error) {
                // If a claim exists, only its retained state may explain the
                // response. No retry or replacement request ID is manufactured.
                const current = await readAttempt(request, authorized, owner, side);
                if (!current.attempt) throw error;
            }
            return statusLoaded(request, authorized, owner);
        },
        async finalize(raw: unknown) {
            const { request, authorized, owner } = await load(raw);
            preparationRequire(authorized.operation.result.action === 'INITIALIZE_REPORT', 'WORKSPACE_SOURCE_ACTION_INVALID');
            let session = await deps.sessions.find(request, authorized);
            preparationRequire(session, 'WORKSPACE_SOURCE_UNAVAILABLE'); assertSource(session, authorized);
            // Once the original grader advances this exact admitted source,
            // recover its retained request only. Never capture or dispatch it again.
            if (!['DRAFT', 'CAPTURED'].includes(String(session.workflowState))) return statusLoaded(request, authorized, owner);
            if (session.workflowState === 'DRAFT') {
                const snapshot = await deps.preparation.store.read(owner), capture: JsonObject = {};
                const machine = authorized[machineSelection], cornerShape = machine?.selection.cornerShape ?? authorized.card.workspace.cornerShape;
                preparationRequire(cornerShape === 'SQUARE' || cornerShape === 'ROUNDED_3_18_MM', 'WORKSPACE_CORNER_SHAPE_REQUIRED');
                capture.cornerShape = cornerShape;
                for (const side of sides) {
                    const manifest = snapshot.manifests[side], attempt = snapshot.attempts[side], selected = boundary(authorized, side);
                    const centering = authorized.card.workspace.centering?.[side];
                    const centeringQuad = sanitizeSpeedsterUnitQuad(machine ? manifest?.body.printedColorResult.proposal : centering?.inner);
                    preparationRequire(manifest && attempt && preparationAttemptState(attempt, snapshot.heads[side]) === 'ADOPTED'
                        && manifest.attemptId === attempt.id && centeringQuad
                        && (machine ? manifest.body.printedColorResult.outcome === 'ACCEPTED'
                            && exact(centeringQuad, manifest.body.printedColorResult.proposal)
                            : centering?.confirmed === true && exact(centeringQuad, centering.inner)
                                && centering.preparationHash === manifest.manifestSha256
                                && ('manifestHash' in selected && selected.manifestHash === manifest.manifestSha256)),
                    'WORKSPACE_CONFIRMED_PREPARATION_REQUIRED');
                    await prepared(request, authorized, manifest);
                    const body = manifest.body;
                    const physical = await deps.geometry.read({ request, authorized, side, preparationRequestId: attempt.idempotencyKey,
                        matColor: body.input.matColor });
                    preparationRequire(physical?.state === 'SUCCEEDED' && physical.result && physical.serverReceipt, 'WORKSPACE_PHYSICAL_EVIDENCE_REQUIRED');
                    preparationRequire(!machinePhysicalAttention(authorized, physical, side), 'WORKSPACE_MACHINE_PHYSICAL_REVIEW_REQUIRED');
                    capture[side.toLowerCase()] = { preparation: preparationManifestReference(manifest),
                        originalStorageKey: body.input.source.originalStorageKey, sourceCorners: body.input.physicalQuad,
                        rectifiedStorageKey: body.artifacts.RECTIFIED.storageKey, inspectionStorageKey: body.artifacts.INSPECTION.storageKey,
                        inspectionFrame: body.inspectionFrame, transform: body.transform,
                        viewStorageKeys: Object.fromEntries(['NORMALIZED', 'MICRO_DEFECT', 'DIRECTIONAL'].map(role => [role, body.artifacts[role as 'NORMALIZED'].storageKey])),
                        centeringQuad,
                        colorGeometryEvidence: [{ side, mode: 'PHYSICAL_OUTER', sourceImageStorageKey: body.input.source.originalStorageKey,
                            matColor: body.input.matColor, result: physical.result, serverReceipt: physical.serverReceipt, confirmedQuad: body.input.physicalQuad },
                        { side, mode: 'PRINTED_FRAME', sourceImageStorageKey: body.input.source.originalStorageKey, matColor: body.input.matColor,
                            result: body.printedColorResult, serverReceipt: body.printedColorReceipt, confirmedQuad: centeringQuad }] };
                }
                const captureDeps = deps.capture ?? speedsterSessionCaptureDependencies;
                preparationRequire(captureDeps.preparationStore, 'WORKSPACE_CAPTURE_NOT_CONFIGURED');
                let mapBinding: MapBindingInput | undefined;
                try { mapBinding = await deps.mapBinding?.(request, authorized, session, capture); }
                catch (error) {
                    if (error && typeof error === 'object' && 'workspaceMapOutcome' in error) {
                        const outcome = error.workspaceMapOutcome as Partial<AtlasWorkspaceSourceResult>;
                        return response(request, authorized, outcome.state === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED', outcome);
                    }
                    throw error;
                }
                await deps.authority.recheck(request, authorized);
                try { session = await savePreparedSpeedsterSessionCapture({ ...captureDeps,
                    ...(machine ? { persistPreparedCapture: async (tx, data, rows) => {
                        preparationRequire(captureDeps.persistPreparedCapture, 'WORKSPACE_CAPTURE_NOT_CONFIGURED');
                        const saved = await captureDeps.persistPreparedCapture(tx, data, rows);
                        const provenance = { ...machine.provenance, requestId: request.requestId, cardId: request.cardId,
                            captureHash: request.binding.captureHash, claimFence: request.binding.claimFence,
                            preparations: Object.fromEntries(sides.map(side => [side, snapshot.manifests[side]!.manifestSha256])) };
                        if (deps.recordMachineCapture) await deps.recordMachineCapture(tx, owner, provenance);
                        else await insertSpeedsterInstrumentationEventWithConflictDetection(tx.database, {
                            eventKey: `${owner.sessionId}:atlas-machine-capture:${machine.provenance.selectionHash}`,
                            ...owner, category: 'PREPARATION_AUTHORITY', eventType: 'ATLAS_MACHINE_CAPTURE_ADOPTED',
                            details: provenance as Prisma.InputJsonValue });
                        return saved;
                    } } : {}),
                    preparationStore: guardedStore(captureDeps.preparationStore as PreparationStore<PrismaPreparationTransaction>, deps.authority, request, authorized) },
                owner, capture, mapBinding); }
                catch (error) {
                    if (!(error instanceof SpeedsterMapIntegrityError) || !deps.maps?.failCapture) throw error;
                    const failure = await deps.maps.failCapture(request, authorized, capture);
                    return response(request, authorized, failure.state, failure);
                }
                preparationRequire(session?.workflowState === 'CAPTURED', 'WORKSPACE_CAPTURE_UNCONFIRMED');
            }
            await deps.authority.recheck(request, authorized);
            // The original scoped bridge preserves fresh detector receipts,
            // deterministic measurements, run/attempt/budget holds and history.
            const result = await deps.initialization.run(request, authorized, session);
            await deps.authority.recheck(request, authorized);
            preparationRequire(result.state !== 'SUCCEEDED' || uuid.safeParse(result.specimenId).success, 'WORKSPACE_INITIALIZATION_UNCONFIRMED');
            return response(request, authorized, result.state, result);
        },
    };
}
