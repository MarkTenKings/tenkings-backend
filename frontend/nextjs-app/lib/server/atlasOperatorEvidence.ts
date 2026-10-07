import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Prisma, type PrismaClient } from '@prisma/client';
import { OperatorEvidenceBridge } from '@atlas/service-bridge/operator-evidence';
import { bridgeOrigin, canonical, digest, keyBytes, requireBridge } from '@atlas/service-bridge/protocol';
import { atlasGradingPolicyHash, atlasSpeedsterSourceEvidence, assertAtlasSpeedsterSourceAdmission } from './atlasGradingBridge';
import { resolvePersistedSpeedsterPreparationCapture } from './speedsterPreparationCaptureEvidence';
import { type SpeedsterReviewActionSession } from './aiGraderV2ReviewAction';
import { readStorageBufferBounded } from './storage';
import { renderAtlasOperatorImage } from './atlasOperatorImages';

export function atlasOperatorEvidenceConfig(env: NodeJS.ProcessEnv = process.env) {
    requireBridge(env.NODE_ENV === 'production' && env.VERCEL_ENV === 'production'
        && env.ATLAS_OPERATOR_EVIDENCE_ENABLED === 'true' && !Object.keys(env).some(k => k.startsWith('ATLAS_LOCAL_'))
        && /^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '') && /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? ''), 'ASTRA_EVIDENCE_NOT_ENABLED');
    const origin = bridgeOrigin(env.ATLAS_OPERATOR_EVIDENCE_ORIGIN), key = keyBytes(env.ATLAS_OPERATOR_EVIDENCE_KEY);
    requireBridge(![env.ATLAS_PUBLIC_MEDIA_KEY, env.ATLAS_GRADING_BRIDGE_KEY].filter(Boolean).some(k => digest(keyBytes(k)) === digest(key)), 'ASTRA_EVIDENCE_KEY_REUSED');
    const endpoint = bridgeOrigin(env.ATLAS_OPERATOR_EVIDENCE_STORAGE_ENDPOINT);
    const bucket = env.ATLAS_OPERATOR_EVIDENCE_STORAGE_BUCKET, region = env.ATLAS_OPERATOR_EVIDENCE_STORAGE_REGION;
    const accessKeyId = env.ATLAS_OPERATOR_EVIDENCE_STORAGE_ACCESS_KEY_ID, secretAccessKey = env.ATLAS_OPERATOR_EVIDENCE_STORAGE_SECRET_ACCESS_KEY;
    requireBridge(typeof bucket === 'string' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
        && typeof region === 'string' && /^[a-z0-9-]{1,64}$/.test(region)
        && typeof accessKeyId === 'string' && accessKeyId.length >= 16 && accessKeyId.length <= 128
        && typeof secretAccessKey === 'string' && secretAccessKey.length >= 32 && secretAccessKey.length <= 256, 'ASTRA_EVIDENCE_CONFIGURATION_REQUIRED');
    const fixed = { mode: 'PRODUCTION', origin, deploymentId: env.VERCEL_URL!, releaseSha: env.VERCEL_GIT_COMMIT_SHA!,
        clientKeyHash: digest(key), endpoint, bucket, region, gradingPolicyHash: atlasGradingPolicyHash() };
    return { ...fixed, key, accessKeyId, secretAccessKey, configHash: digest(canonical({ version: 'atlas-operator-evidence-config-v1',
        ...fixed, accessKeyHash: digest(accessKeyId), secretKeyHash: digest(secretAccessKey) })) };
}
export function createAtlasOperatorEvidence(client: PrismaClient, config: ReturnType<typeof atlasOperatorEvidenceConfig>) {
    return new OperatorEvidenceBridge({ client, config, ports: {
        async loadSource(tx: Prisma.TransactionClient, card: { sourceId: string; sourceOwnerId: string }) {
            const source = await tx.aiGraderV2Session.findFirst({ where: { id: card.sourceId, createdByUserId: card.sourceOwnerId },
                select: { id: true, createdByUserId: true, cardProfile: true, workflowState: true, identity: true, capture: true,
                    reviewedDefects: true, gradeReport: true, mapRevisionId: true, mapFilterPolicyVersion: true, mapRegistration: true, updatedAt: true } });
            requireBridge(source?.workflowState === 'CAPTURED', 'SOURCE_NOT_CAPTURED');
            return resolvePersistedSpeedsterPreparationCapture(source!);
        },
        sourceEvidence: atlasSpeedsterSourceEvidence, assertSourceAdmission: assertAtlasSpeedsterSourceAdmission,
        reportSource(source: SpeedsterReviewActionSession) {
            return { cardProfile: source.cardProfile, identity: source.identity, capture: source.capture, reviewedDefects: source.reviewedDefects,
                gradeReport: source.gradeReport, mapRevisionId: source.mapRevisionId ?? null,
                mapFilterPolicyVersion: source.mapFilterPolicyVersion ?? null, mapRegistration: source.mapRegistration ?? null };
        },
        async readEvidence(descriptor: { sourceRef: string; byteCount: number }, signal: AbortSignal) {
            const storage = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, maxAttempts: 1,
                credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
            let cancel: (() => void) | undefined;
            try { return await readStorageBufferBounded(descriptor.sourceRef, descriptor.byteCount, {
                async openRead(storageKey: string) {
                    const response = await storage.send(new GetObjectCommand({ Bucket: config.bucket, Key: storageKey }), { abortSignal: signal });
                    const body = response.Body as unknown as AsyncIterable<Uint8Array> & { destroy: (error?: Error) => void };
                    requireBridge(body && typeof body[Symbol.asyncIterator] === 'function' && typeof body.destroy === 'function', 'ASTRA_EVIDENCE_BODY_INVALID');
                    cancel = () => body.destroy(new Error('ASTRA_EVIDENCE_READ_ABORTED'));
                    signal.addEventListener('abort', cancel, { once: true });
                    if (signal.aborted) { cancel(); signal.throwIfAborted(); }
                    return { storageKey, byteSize: response.ContentLength, body };
                },
            }); } finally { if (cancel) signal.removeEventListener('abort', cancel); storage.destroy(); }
        }, render: renderAtlasOperatorImage,
    } });
}
