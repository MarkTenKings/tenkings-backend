import { Prisma, type PrismaClient } from '@prisma/client';
import { ScopedGradingBridge } from '@atlas/service-bridge/executor';
import { bridgeOrigin, canonical, digest, keyBytes, requireBridge } from '@atlas/service-bridge/protocol';
import { boundedWorkerFetch } from '@atlas/service-bridge/transport';
import { applySpeedsterReviewAction, type SpeedsterReviewAction, type SpeedsterReviewActionSession } from './aiGraderV2ReviewAction';
import { createSpeedsterReviewDependencies, type SpeedsterReviewDependencyOptions } from './speedsterReviewDependencies';
import { resolvePersistedSpeedsterPreparationCapture, speedsterPreparationSideAuthority } from './speedsterPreparationCaptureEvidence';
import { assertPreparationIdentity } from './speedsterPreparationIntegrity';
import { currentSpeedsterPreparationRelease } from './speedsterPreparationRelease';
import { readStorageBufferBounded } from './storage';
import { currentSpeedsterDetectorReleasePolicy } from './speedsterCurrentRelease';
import { SPEEDSTER_RULE_VERSION } from '../ai-grader-v2/contracts';
import { assertAtlasFreshDetection, withAtlasFreshDetection } from './atlasFreshDetection';

export function atlasGradingPolicyHash() {
    return digest(canonical({ purpose: 'atlas-grading-policy-v1', ruleVersion: SPEEDSTER_RULE_VERSION,
        reviewContract: 'source-bound-full-speedster-review-v1', preparation: currentSpeedsterPreparationRelease(),
        detector: currentSpeedsterDetectorReleasePolicy() }));
}

export function atlasGradingBridgeConfig(env: NodeJS.ProcessEnv = process.env) {
    requireBridge(env.NODE_ENV === 'production' && env.VERCEL_ENV === 'production'
        && env.ATLAS_GRADING_BRIDGE_ENABLED === 'true' && !env.ATLAS_LOCAL_SYNTHETIC && !env.ATLAS_LOCAL_POSTGRES
        && /^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '')
        && /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? ''), 'BRIDGE_NOT_ENABLED');
    const origin = bridgeOrigin(env.ATLAS_GRADING_BRIDGE_ORIGIN), key = keyBytes(env.ATLAS_GRADING_BRIDGE_KEY);
    const serviceUrl = env.AI_GRADER_SPEEDSTER_SERVICE_URL?.replace(/\/$/, '');
    requireBridge(serviceUrl && env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY?.trim()
        && env.AI_GRADER_SPEEDSTER_REQUIRE_DETECTOR_IDENTITY_V1 === 'true'
        && (env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET?.trim().length ?? 0) >= 32,
    'BRIDGE_CONFIGURATION_INVALID');
    const config = { mode: 'PRODUCTION', origin, deploymentId: env.VERCEL_URL!, releaseSha: env.VERCEL_GIT_COMMIT_SHA!,
        clientKeyHash: digest(key), serviceUrl: serviceUrl!, gradingPolicyHash: atlasGradingPolicyHash() };
    const configHash = digest(canonical({ version: 'atlas-grading-bridge-config-v1', ...config,
        workerKeyHash: digest(env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY ?? ''),
        receiptKeyId: env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_KEY_ID,
        receiptKeyHash: digest(env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_HMAC_SECRET ?? ''),
        previousReceiptKeysHash: digest(env.AI_GRADER_SPEEDSTER_DETECTION_RECEIPT_PREVIOUS_KEYS_JSON ?? ''),
        detectorDeadlineMs: env.AI_GRADER_SPEEDSTER_DETECT_DEADLINE_MS ?? '55000',
        machineAdmissionKeyHash: digest(env.ATLAS_MACHINE_ADMISSION_KEY ?? ''),
        machineExecutionKeyHash: digest(env.ATLAS_MACHINE_EXECUTION_KEY ?? ''),
        machineRuntimeHash: env.ATLAS_OPERATOR_RUNTIME_HASH ?? '',
        machineIntakeRosterHash: digest(env.ATLAS_INTAKE_ALLOWED_PHONE_HASHES_JSON ?? '') }));
    return { ...config, configHash, key };
}

/** Operator intake and every subsequent read use the same manifest projection. */
export function atlasSpeedsterSourceEvidence(raw: SpeedsterReviewActionSession, sourceRevision = raw.updatedAt.toISOString()) {
    const source = resolvePersistedSpeedsterPreparationCapture(raw);
    requireBridge(source.capture && typeof source.capture === 'object'
        && typeof (source.capture as Record<string, unknown>).preparationEvidenceCanonical === 'string', 'PRESERVED_PREPARATION_REQUIRED');
    const capture = source.capture as Record<string, unknown>;
    const sides: Record<string, unknown> = {}, originals: Record<string, unknown> = {};
    for (const side of ['FRONT', 'BACK'] as const) {
        const body = speedsterPreparationSideAuthority(capture[side.toLowerCase()]);
        requireBridge(body, 'PRESERVED_PREPARATION_REQUIRED');
        const artifact = body!.artifacts.RECTIFIED;
        sides[side] = { sourceRef: artifact.storageKey, sha256: artifact.sha256, byteCount: artifact.byteCount,
            width: artifact.width, height: artifact.height, contentType: 'image/webp' };
        const original = body!.input.source;
        originals[side] = { sourceRef: original.storageKey, sha256: original.sha256, byteCount: original.byteCount,
            width: original.width, height: original.height, contentType: `image/${original.format}`,
            uploadedOriginalSha256: original.originalSha256 };
    }
    requireBridge(new Date(sourceRevision).toISOString() === sourceRevision, 'SOURCE_REVISION_INVALID');
    return { version: 'atlas-speedster-evidence-v1', sourceId: source.id, sourceOwnerId: source.createdByUserId,
        sourceRevision, captureHash: digest(canonical(capture)), identityHash: digest(canonical({ cardProfile: source.cardProfile, identity: source.identity })),
        mapRevisionId: source.mapRevisionId ?? null, mapFilterPolicyVersion: source.mapFilterPolicyVersion ?? null,
        mapRegistrationHash: digest(canonical(source.mapRegistration ?? null)), sides, originals };
}
export function assertAtlasSpeedsterSourceAdmission(source: SpeedsterReviewActionSession) {
    const resolved = resolvePersistedSpeedsterPreparationCapture(source);
    const approved = currentSpeedsterPreparationRelease();
    for (const side of ['front', 'back']) {
        const authority = speedsterPreparationSideAuthority((resolved.capture as Record<string, unknown>)[side]);
        requireBridge(authority, 'PRESERVED_PREPARATION_REQUIRED');
        assertPreparationIdentity(authority!.input.preparationIdentity, approved);
    }
}
export type AtlasGradingPortOptions = Omit<SpeedsterReviewDependencyOptions, 'beforeSessionLock' | 'afterPersist' | 'signal' | 'serviceUrl'> & {
    readEvidence?: (descriptor: { sourceRef: string; byteCount: number }) => Promise<Buffer>;
};

export function createAtlasGradingPorts(client: PrismaClient, config: ReturnType<typeof atlasGradingBridgeConfig>, options: AtlasGradingPortOptions = {}) {
    const scoped = { ...options, env: Object.freeze({ ...(options.env ?? process.env) }),
        serviceHeaders: options.serviceHeaders ? Object.freeze({ ...options.serviceHeaders }) : undefined,
        mapLookup: options.mapLookup ? Object.freeze({ ...options.mapLookup }) : undefined };
    const serviceUrl = config.serviceUrl;
    return {
        async loadSource(tx: Prisma.TransactionClient, card: { sourceId: string; sourceOwnerId: string }) {
            const [row] = await tx.$queryRaw<SpeedsterReviewActionSession[]>`SELECT id,"createdByUserId","cardProfile","workflowState",identity,
                capture,"reviewedDefects","gradeReport","mapRevisionId","mapFilterPolicyVersion","mapRegistration","updatedAt"
                FROM public."AiGraderV2Session" WHERE id=${card.sourceId} AND "createdByUserId"=${card.sourceOwnerId} FOR SHARE`;
            requireBridge(row?.workflowState === 'CAPTURED', 'SOURCE_NOT_CAPTURED');
            return resolvePersistedSpeedsterPreparationCapture(row!);
        },
        sourceEvidence: atlasSpeedsterSourceEvidence,
        assertSourceAdmission: assertAtlasSpeedsterSourceAdmission,
        async assertFreshDetection(tx: Prisma.TransactionClient, source: SpeedsterReviewActionSession) {
            await assertAtlasFreshDetection(tx, source);
        },
        reportSource(source: SpeedsterReviewActionSession) {
            return { cardProfile: source.cardProfile, identity: source.identity, capture: source.capture,
                reviewedDefects: source.reviewedDefects, gradeReport: source.gradeReport,
                mapRevisionId: source.mapRevisionId ?? null, mapFilterPolicyVersion: source.mapFilterPolicyVersion ?? null,
                mapRegistration: source.mapRegistration ?? null };
        },
        readEvidence: scoped.readEvidence ?? ((descriptor: { sourceRef: string; byteCount: number }) =>
            readStorageBufferBounded(descriptor.sourceRef, descriptor.byteCount, { openRead: scoped.openEvidence })),
        async perform(input: { source: SpeedsterReviewActionSession; action: SpeedsterReviewAction;
            policy: { maxWorkerCalls: number }; signal: AbortSignal;
            beforeSessionLock: SpeedsterReviewDependencyOptions['beforeSessionLock']; afterPersist: SpeedsterReviewDependencyOptions['afterPersist'] }) {
            const fetchImpl = boundedWorkerFetch({ serviceUrl, maxCalls: input.policy.maxWorkerCalls, signal: input.signal, fetchImpl: scoped.fetchImpl });
            const original = createSpeedsterReviewDependencies(client, { ...scoped, serviceUrl, fetchImpl, signal: input.signal,
                beforeSessionLock: input.beforeSessionLock, afterPersist: input.afterPersist });
            const deps = input.action.type === 'INITIALIZE' ? withAtlasFreshDetection(input.source, original) : original;
            const load = deps.loadOwnedSession;
            deps.loadOwnedSession = async identity => {
                const source = await load(identity);
                requireBridge(source && source.updatedAt.getTime() === input.source.updatedAt.getTime()
                    && canonical(atlasSpeedsterSourceEvidence(source)) === canonical(atlasSpeedsterSourceEvidence(input.source)), 'SOURCE_REVISION_CHANGED');
                return source;
            };
            return applySpeedsterReviewAction({ sessionId: input.source.id, createdByUserId: input.source.createdByUserId, action: input.action }, deps);
        },
    };
}
export function createAtlasGradingBridge(client: PrismaClient, config: ReturnType<typeof atlasGradingBridgeConfig>, options: AtlasGradingPortOptions = {}) {
    return new ScopedGradingBridge({ client, config, ports: createAtlasGradingPorts(client, config, options) });
}
