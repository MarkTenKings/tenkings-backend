import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { canonical } from '@atlas/service-bridge/protocol';
import { boundedBytes } from '@atlas/service-bridge/transport';
import { verifyWorkspaceRequest, workspaceResponseSignature } from '@atlas/service-bridge/workspace';
import { createAtlasWorkspaceSource, createAtlasWorkspacePhysicalGeometry, createPrismaAtlasWorkspaceSessions,
    type AtlasWorkspaceSourceDependencies, type AtlasWorkspaceSourceRequest, type AtlasAuthorizedWorkspaceSource } from './atlasWorkspaceSource';
import { createAtlasWorkspaceSourceLedger, atlasWorkspacePhysicalLedger,
    type AtlasWorkspaceSourceLedger, type createAtlasWorkspaceSourceAuthority } from './atlasWorkspaceSourceAuthority';
import { AtlasWorkspaceUploadRejected, type createAtlasWorkspaceSourceStorage, type AtlasWorkspaceUpload, type AtlasWorkspacePhotoDescriptor } from './atlasWorkspaceSourceStorage';
import { createPrismaSpeedsterPreparationStore } from './speedsterPreparationStore';
import { currentSpeedsterPreparationRelease } from './speedsterPreparationRelease';
import { createHash } from 'node:crypto';
import { createAtlasWorkspaceSourceMap, createPrismaAtlasWorkspaceMapStore } from './atlasWorkspaceSourceMap';
import { verifySpeedsterMapRegistrationReceipt } from './speedsterMapRegistrationAuthority';
import { preparationHash, preparationRequire } from './speedsterPreparationIntegrity';
import { issueSpeedsterColorGeometryReceipt, verifySpeedsterColorGeometryReceipt } from './speedsterColorGeometryAuthority';
import { persistPreparedSpeedsterCaptureTransaction, validateSpeedsterSubmittedMapBinding } from './speedsterSessionCapture';
import { loadLockedEffectiveSpeedsterMapRevision } from './speedsterCardTypeMaps';
import { preparationAttemptState } from './speedsterPreparationAuthority';
import { verifySpeedsterPreparationManifestBytes } from './speedsterPreparationStorage';

const uuid = z.uuidv4(), sha = z.string().regex(/^[a-f0-9]{64}$/), revision = z.number().int().positive();
const preparedRequest = z.strictObject({ cardId: uuid, side: z.enum(['FRONT', 'BACK']), manifestHash: sha,
    scope: z.strictObject({ actorId: uuid, sessionHash: sha, controlRevision: revision }),
    binding: z.strictObject({ captureRevision: revision, captureHash: sha, claimFence: revision, workflowRevision: revision }) });
function check(value: unknown, code = 'WORKSPACE_SOURCE_HOST_INVALID'): asserts value { preparationRequire(value, code); }
type WorkerResponse = Readonly<{ ok: boolean; status: number; payload: unknown }>;
type BridgeConfig = Readonly<{ origin: string; key: Uint8Array; configHash: string; releaseSha: string; deploymentId: string }>;
export type AtlasWorkspaceSourceHostDependencies = Readonly<{
    bridgeConfig: BridgeConfig; client: PrismaClient; authority: ReturnType<typeof createAtlasWorkspaceSourceAuthority>;
    storage: ReturnType<typeof createAtlasWorkspaceSourceStorage>;
    worker: Readonly<{ geometryOrigin: string; preparationOrigin: string; apiKey: string; preparationApiKey: string; receiptKey: string; receiptKeyId: string;
        registrationOrigin?: string; registrationApiKey?: string; mapReceiptKey?: string; mapReceiptKeyId?: string;
        approvedRelease?: typeof currentSpeedsterPreparationRelease }>;
    initialization: (context: Readonly<{ request: AtlasWorkspaceSourceRequest; authorized: AtlasAuthorizedWorkspaceSource; ledger: AtlasWorkspaceSourceLedger }>) => AtlasWorkspaceSourceDependencies['initialization'];
    mapBinding?: AtlasWorkspaceSourceDependencies['mapBinding'];
    capture?: AtlasWorkspaceSourceDependencies['capture'];
    fetchImpl?: typeof fetch;
}>;

/** Exact original worker protocols; one retained source reservation authorizes
 * each call. Fixed origin, bounded request/response/deadline, no redirects,
 * no automatic retries and no provider or general-purpose HTTP escape hatch. */
export function createAtlasWorkspacePreparationWorker(worker: AtlasWorkspaceSourceHostDependencies['worker'], fetchImpl = fetch) {
    worker = Object.freeze({ ...worker });
    for (const address of [worker.geometryOrigin, worker.preparationOrigin, ...(worker.registrationOrigin ? [worker.registrationOrigin] : [])]) {
        const origin = new URL(address); check(origin.protocol === 'https:' && origin.origin === address && !origin.username && !origin.password,
            'WORKSPACE_WORKER_CONFIGURATION_INVALID');
    }
    check(typeof worker.apiKey === 'string' && worker.apiKey.length >= 16 && worker.apiKey.length <= 512
        && !/[\x00-\x20\x7f]/.test(worker.apiKey) && typeof worker.receiptKey === 'string' && worker.receiptKey.length >= 32
        && /^[a-zA-Z0-9._-]{1,80}$/.test(worker.receiptKeyId), 'WORKSPACE_WORKER_CONFIGURATION_INVALID');
    check(typeof worker.preparationApiKey === 'string' && worker.preparationApiKey.length >= 16 && worker.preparationApiKey.length <= 512
        && !/[\x00-\x20\x7f]/.test(worker.preparationApiKey) && worker.preparationApiKey !== worker.apiKey, 'WORKSPACE_PREPARATION_CREDENTIAL_INVALID');
    const hasRegistration = [worker.registrationOrigin, worker.registrationApiKey, worker.mapReceiptKey, worker.mapReceiptKeyId].some(value => value !== undefined);
    check(!hasRegistration || Boolean(worker.registrationOrigin && worker.registrationApiKey && worker.mapReceiptKey && worker.mapReceiptKeyId)
        && typeof worker.registrationApiKey === 'string' && worker.registrationApiKey.length >= 16 && worker.registrationApiKey.length <= 512
        && !/[\x00-\x20\x7f]/.test(worker.registrationApiKey) && /^[A-Za-z0-9_-]{43,256}$/.test(worker.mapReceiptKey ?? '')
        && /^[A-Za-z0-9._-]{1,80}$/.test(worker.mapReceiptKeyId ?? ''), 'WORKSPACE_MAP_WORKER_CONFIGURATION_INVALID');
    const mapReceiptEnv: NodeJS.ProcessEnv = { NODE_ENV: 'production', SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY: worker.mapReceiptKey,
        SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY_ID: worker.mapReceiptKeyId };
    const receiptEnv: NodeJS.ProcessEnv = { NODE_ENV: 'production', SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY: worker.receiptKey,
        SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY_ID: worker.receiptKeyId };
    return {
        registration: hasRegistration ? { origin: worker.registrationOrigin!, apiKey: worker.registrationApiKey!, receiptEnv: mapReceiptEnv } : undefined,
        verifyMapReceipt: (input: Parameters<typeof verifySpeedsterMapRegistrationReceipt>[0]) => verifySpeedsterMapRegistrationReceipt({ ...input, env: mapReceiptEnv }),
        issueReceipt: (binding: Parameters<typeof issueSpeedsterColorGeometryReceipt>[0]) => issueSpeedsterColorGeometryReceipt(binding, { env: receiptEnv }),
        verifyReceipt: (receipt: string, binding: Parameters<typeof verifySpeedsterColorGeometryReceipt>[1]) => verifySpeedsterColorGeometryReceipt(receipt, binding, { env: receiptEnv }),
        async invoke(action: 'geometry' | 'prepare' | 'map-registration', body: Record<string, unknown>): Promise<WorkerResponse> {
            check(['geometry', 'prepare', 'map-registration'].includes(action) && (action !== 'map-registration' || hasRegistration)); const input = canonical(body); check(Buffer.byteLength(input) <= 65536);
            const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
            const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort();
                reject(new Error('WORKSPACE_WORKER_OUTCOME_UNCONFIRMED')); }, action === 'map-registration' ? 55000 : 200000); });
            try {
                return await Promise.race([timeout, (async () => {
                    const response = await fetchImpl(`${action === 'geometry' ? worker.geometryOrigin : action === 'prepare' ? worker.preparationOrigin : worker.registrationOrigin}/${action}`, { method: 'POST', redirect: 'error', signal: controller.signal,
                        headers: { 'content-type': 'application/json', authorization: `Bearer ${action === 'prepare' ? worker.preparationApiKey : action === 'map-registration' ? worker.registrationApiKey : worker.apiKey}` }, body: input });
                    check(response.headers.get('content-type')?.split(';')[0] === 'application/json', 'WORKSPACE_WORKER_RESPONSE_INVALID');
                    const bytes = await boundedBytes(response, 524288);
                    let payload: unknown; try { payload = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('WORKSPACE_WORKER_RESPONSE_INVALID'); }
                    return { ok: response.ok, status: response.status, payload };
                })()]);
            } finally { clearTimeout(timer!); }
        },
    };
}

/** Workspace locks precede original source locks. The original preparation
 * implementation still owns every source/head/attempt/manifest transaction. */
export function createAtlasWorkspacePreparationStore(client: PrismaClient) {
    const ordered = { $transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options: Record<string, unknown>) =>
        client.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            return work(tx);
        }, options) } as unknown as PrismaClient;
    return createPrismaSpeedsterPreparationStore(ordered);
}

/** Transport-neutral private host; the caller owns its fixed /workspace/v1 HTTP
 * listener and explicit scoped credentials. Signed packet verification happens
 * before every database/storage operation. No public page handler is imported. */
export function createAtlasWorkspaceSourceHost(deps: AtlasWorkspaceSourceHostDependencies) {
    const { authority, storage, client } = deps, worker = createAtlasWorkspacePreparationWorker(deps.worker, deps.fetchImpl);
    const preparationStore = createAtlasWorkspacePreparationStore(client);
    const authorizedUpload = async (input: Readonly<{ cardId: string; uploadId: string }>, mutate: boolean) => {
        const loaded = await authority.loadUpload(input), { card, upload, workspace } = loaded;
        check(card.sides?.[upload.side]?.uploadId === upload.id, 'WORKSPACE_UPLOAD_SUPERSEDED');
        if (mutate) check(workspace.intakeEnabled && !card.claim && !card.specimenId
            && ['DRAFT', 'NEEDS_ATTENTION'].includes(card.state), 'WORKSPACE_UPLOAD_NOT_EDITABLE');
        return loaded;
    };
    async function service(request: AtlasWorkspaceSourceRequest) {
        const authorized = await authority.load(request), media = storage.forSource(authorized.card.source);
        const ledger = createAtlasWorkspaceSourceLedger(client, authority, request);
        const maps = createAtlasWorkspaceSourceMap({ request, authorized, authority, ledger, preparationStore, storage: media.storage,
            store: createPrismaAtlasWorkspaceMapStore(client, authority, request, authorized),
            loadMap: input => client.$transaction(tx => loadLockedEffectiveSpeedsterMapRevision(tx, input)),
            ...(worker.registration ? { registration: { ...worker.registration, readUrl: media.readUrl,
                reference: storage.mapReference, invoke: body => worker.invoke('map-registration', body) } } : {}) });
        const capture: AtlasWorkspaceSourceDependencies['capture'] = deps.capture ?? {
            preparationStore, preparationStorage: media.storage, loadLockedMap: loadLockedEffectiveSpeedsterMapRevision,
            persistPreparedCapture: persistPreparedSpeedsterCaptureTransaction,
            findSession: (id, createdByUserId) => client.aiGraderV2Session.findFirst({ where: { id, createdByUserId } }),
            updateSession: async () => { throw new Error('WORKSPACE_LEGACY_CAPTURE_FORBIDDEN'); },
            verifyColorGeometryReceipt: worker.verifyReceipt,
            validateMapBinding: (session, binding, source) => validateSpeedsterSubmittedMapBinding(session, binding, source, {
                loadActiveMap: input => client.$transaction(tx => loadLockedEffectiveSpeedsterMapRevision(tx, input)),
                hashEvidence: async key => createHash('sha256').update(await media.storage.read(key, 50 * 1024 * 1024)).digest('hex'),
                verifyReceipt: worker.verifyMapReceipt,
                verifyHumanLesson: async () => { throw new Error('WORKSPACE_MAP_HUMAN_LESSON_NOT_CONFIGURED'); },
                verifyReferenceLesson: async () => { throw new Error('WORKSPACE_MAP_REFERENCE_LESSON_NOT_CONFIGURED'); },
            }),
        };
        const source = createAtlasWorkspaceSource({ authority, sessions: createPrismaAtlasWorkspaceSessions(client, authority), capture,
            maps, mapBinding: deps.mapBinding ?? maps.binding, verifyColorReceipt: worker.verifyReceipt,
            initialization: deps.initialization({ request, authorized, ledger }),
            geometry: createAtlasWorkspacePhysicalGeometry({ authority, ledger: atlasWorkspacePhysicalLedger(ledger),
                readUrl: media.readUrl, invoke: body => worker.invoke('geometry', body), issueReceipt: worker.issueReceipt }),
            preparation: { store: preparationStore, storage: media.storage, approvedRelease: deps.worker.approvedRelease ?? currentSpeedsterPreparationRelease,
                readUrl: media.readUrl, stagingUpload: media.stagingUpload, issueColorReceipt: worker.issueReceipt,
                invokeWorker: async body => {
                    const intent = authorized.operation.result;
                    const value = { requestId: request.requestId, cardId: request.cardId, purpose: 'PREPARATION' as const,
                        side: intent.payload.side as 'FRONT' | 'BACK', binding: { ...request.binding },
                        request: { preparationBinding: body.preparationBinding, corners: body.corners, matColor: body.matColor } };
                    const claim = await ledger.claim(value);
                    if (!claim.claimed) {
                        if (claim.row.result?.response) return claim.row.result.response as WorkerResponse;
                        throw new Error('WORKSPACE_WORKER_OUTCOME_UNCONFIRMED');
                    }
                    await ledger.dispatch(value, claim.row.id);
                    let response: WorkerResponse;
                    try { response = await worker.invoke('prepare', body); }
                    catch (error) { await ledger.complete(value, claim.row.id, { state: 'UNKNOWN', failureCode: 'WORKSPACE_WORKER_OUTCOME_UNCONFIRMED' }); throw error; }
                    await ledger.complete(value, claim.row.id, { state: response.ok ? 'SUCCEEDED' : response.status >= 400 && response.status < 500 ? 'FAILED' : 'UNKNOWN',
                        ...(response.ok ? {} : { failureCode: 'WORKSPACE_PREPARATION_WORKER_REJECTED' }), response });
                    return response;
                } },
        });
        return { source, ledger };
    }
    async function preparedImage(input: unknown) {
        const request = preparedRequest.parse(input), before = await authority.loadPrepared(request), source = before.card.source;
        const media = storage.forSource(source), owner = { sessionId: source.sourceId, createdByUserId: source.sourceOwnerId };
        const snapshot = await preparationStore.read(owner), manifest = snapshot.manifests[request.side], attempt = snapshot.attempts[request.side];
        check(manifest && attempt && preparationAttemptState(attempt, snapshot.heads[request.side]) === 'ADOPTED'
            && manifest.manifestSha256 === request.manifestHash && manifest.body.input.source.sha256 === before.originals[request.side].verification.sha256
            && manifest.body.input.source.originalStorageKey === before.originals[request.side].upload.objectRef, 'WORKSPACE_PREPARATION_CHANGED');
        await verifySpeedsterPreparationManifestBytes(manifest.body, media.storage);
        const artifact = manifest.body.artifacts.RECTIFIED;
        const bytes = await storage.readCapture({ objectRef: artifact.storageKey, sha256: artifact.sha256,
            byteCount: artifact.byteCount, contentType: 'image/webp' });
        const after = await authority.loadPrepared(request);
        check(preparationHash(before.card) === preparationHash(after.card), 'WORKSPACE_SOURCE_SCOPE_CHANGED');
        return { bytes, contentType: 'image/webp' };
    }
    return {
        async receive(body: string, signature: string) {
            const packet = verifyWorkspaceRequest(deps.bridgeConfig, body, signature);
            let result: unknown, binary: Readonly<{ bytes: Buffer; contentType: string }> | undefined;
            if (['UPLOAD_GRANT', 'VERIFY_UPLOAD', 'READ_ORIGINAL'].includes(packet.claims.action)) {
                const input = packet.input as { cardId: string; uploadId: string }, mutable = packet.claims.action !== 'READ_ORIGINAL';
                const before = await authorizedUpload(input, mutable);
                if (packet.claims.action === 'UPLOAD_GRANT') {
                    check(!before.verification, 'WORKSPACE_UPLOAD_ALREADY_VERIFIED');
                    result = await storage.grant(before.upload as AtlasWorkspaceUpload, before.workspace.expiresAt, before.now);
                } else if (packet.claims.action === 'VERIFY_UPLOAD') {
                    try { result = await storage.verify(before.upload as AtlasWorkspaceUpload); }
                    catch (error) {
                        if (!(error instanceof AtlasWorkspaceUploadRejected)) throw error;
                        check(error.cardId === input.cardId && error.uploadId === input.uploadId
                            && ['BYTES_MISMATCH', 'INVALID_IMAGE'].includes(error.reason), 'WORKSPACE_SERVICE_RESPONSE_INVALID');
                        result = { state: 'REJECTED', cardId: input.cardId, uploadId: input.uploadId, reason: error.reason };
                    }
                }
                else { check(before.verification, 'WORKSPACE_PHOTOS_REQUIRED');
                    binary = { bytes: await storage.readCapture(before.verification as AtlasWorkspacePhotoDescriptor), contentType: before.verification.contentType }; }
                const after = await authorizedUpload(input, mutable);
                check(preparationHash(before.card) === preparationHash(after.card)
                    && preparationHash(before.upload) === preparationHash(after.upload), 'WORKSPACE_SOURCE_SCOPE_CHANGED');
            } else if (packet.claims.action === 'READ_PREPARED') binary = await preparedImage(packet.input);
            else {
                const request = packet.input as AtlasWorkspaceSourceRequest, ready = await service(request);
                if (packet.claims.action === 'READ_STATUS') result = await ready.source.status(request);
                else {
                    result = packet.claims.action === 'PREPARE_SIDE' ? await ready.source.prepare(request)
                        : ['RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP'].includes(packet.claims.action)
                            ? await ready.source.map(request, packet.claims.action as 'RESOLVE_MAP' | 'REGISTER_MAP' | 'CONTINUE_WITHOUT_MAP')
                            : await ready.source.finalize(request);
                    const state = (result as { state: string }).state;
                    if (['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(state)) await ready.ledger.finishPermit(state as 'SUCCEEDED' | 'FAILED' | 'UNKNOWN');
                }
            }
            const bytes = binary?.bytes ?? Buffer.from(canonical(result)), contentType = binary?.contentType ?? 'application/json';
            return { bytes, contentType, signature: workspaceResponseSignature(deps.bridgeConfig, packet.claims, bytes, contentType) };
        },
        /** Capture evidence bridge already authenticates its exact run+manifest.
         * These helpers keep the storage key and byte reader within this host. */
        loadCapture: async (_tx: unknown, { workspace, originals }: { workspace: { captureHash: string; source: { sourceId: string; sourceOwnerId: string } };
            originals: Record<'FRONT' | 'BACK', AtlasWorkspacePhotoDescriptor> }) => {
            for (const side of ['FRONT', 'BACK'] as const) check(originals[side].objectRef.startsWith(`ai-grader-v2/${workspace.source.sourceOwnerId}/${workspace.source.sourceId}/original/`));
            return { captureHash: workspace.captureHash, originals };
        },
        readCapture: storage.readCapture,
    };
}
