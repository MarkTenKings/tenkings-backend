import type { Prisma, PrismaClient } from '@prisma/client';
import { makeTrustedLearningConfig, ScopedTrustedLearningCandidates, type LearningSource, type TrustedLearningConfig } from '@atlas/service-bridge/trusted-learning';
import { canonical, digest, keyBytes, requireBridge, SHA } from '@atlas/service-bridge/protocol';
import { harvestSpeedsterLearningCandidatesV2 } from '../ai-grader-v2/learning-harvest-v2';
import { speedsterHistoryFingerprintVersion } from '../ai-grader-v2/learning-articuno-dry-run-v2';
import { SPEEDSTER_LEARNING_FINGERPRINT_VERSION } from '../ai-grader-v2/learning-v2';
import { atlasGradingPolicyHash, atlasSpeedsterSourceEvidence, assertAtlasSpeedsterSourceAdmission } from './atlasGradingBridge';
import { resolvePersistedSpeedsterPreparationCapture } from './speedsterPreparationCaptureEvidence';
import type { SpeedsterReviewActionSession } from './aiGraderV2ReviewAction';

export type AtlasTrustedLearningSettings = TrustedLearningConfig & { readonly allowedPhoneHashes: readonly string[] };
const otherKeyNames = ['ATLAS_GRADING_BRIDGE_KEY', 'ATLAS_INTAKE_KEY', 'ATLAS_OPERATOR_EVIDENCE_KEY', 'ATLAS_PUBLIC_MEDIA_KEY',
    'ATLAS_MACHINE_ADMISSION_KEY', 'ATLAS_MACHINE_EXECUTION_KEY'] as const;

/** Own disabled-by-default admission. Enabling this cannot enable grading,
 * machine execution or bank application. The compiled preparation gate remains. */
export function atlasTrustedLearningConfig(env: NodeJS.ProcessEnv = process.env): AtlasTrustedLearningSettings {
    requireBridge(env.NODE_ENV === 'production' && env.VERCEL_ENV === 'production'
        && env.ATLAS_TRUSTED_LEARNING_ENABLED === 'true' && !Object.keys(env).some(name => name.startsWith('ATLAS_LOCAL_'))
        && /^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '')
        && /^[A-Za-z0-9_-]{1,120}$/.test(env.VERCEL_DEPLOYMENT_ID ?? '')
        && /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '') && env.VERCEL_GIT_COMMIT_SHA !== '0'.repeat(40), 'LEARNING_NOT_ENABLED');
    const encoded = env.ATLAS_TRUSTED_LEARNING_ALLOWED_PHONE_HASHES_JSON;
    requireBridge(typeof encoded === 'string' && Buffer.byteLength(encoded) <= 8192, 'LEARNING_ROSTER_INVALID');
    let parsed: unknown; try { parsed = JSON.parse(encoded!); } catch { requireBridge(false, 'LEARNING_ROSTER_INVALID'); }
    requireBridge(Array.isArray(parsed) && parsed.length > 0 && parsed.length <= 100
        && parsed.every(value => typeof value === 'string' && SHA.test(value)) && new Set(parsed).size === parsed.length, 'LEARNING_ROSTER_INVALID');
    const allowedPhoneHashes = Object.freeze([...(parsed as string[])].sort());
    const key = keyBytes(env.ATLAS_TRUSTED_LEARNING_KEY), otherKeyHashes = otherKeyNames.filter(name => env[name] !== undefined).map(name => digest(keyBytes(env[name])));
    requireBridge(!otherKeyHashes.includes(digest(key)), 'LEARNING_CONFIGURATION_INVALID');
    const settings = makeTrustedLearningConfig({ mode: 'PRODUCTION', origin: env.ATLAS_TRUSTED_LEARNING_ORIGIN!, deploymentId: env.VERCEL_DEPLOYMENT_ID!,
        releaseSha: env.VERCEL_GIT_COMMIT_SHA!, key, gradingPolicyHash: atlasGradingPolicyHash(),
        phoneAllowlistHash: digest(canonical(allowedPhoneHashes)), otherKeyHashes });
    return Object.freeze({ ...settings, allowedPhoneHashes });
}

/** Safe immutable private-deployment pins for staff composition/provisioning.
 * A staff deployment supplies its own distinct identity in the signed scope. */
export function atlasTrustedLearningBinding(settings: AtlasTrustedLearningSettings) {
    const verified = makeTrustedLearningConfig({ ...settings, otherKeyHashes: [] });
    requireBridge(verified.configHash === settings.configHash, 'LEARNING_CONFIGURATION_INVALID');
    const { key: _key, ...binding } = verified;
    return Object.freeze(binding);
}

type ReportSourceInput = Pick<SpeedsterReviewActionSession, 'cardProfile' | 'identity' | 'capture' | 'reviewedDefects' | 'gradeReport'
    | 'mapRevisionId' | 'mapFilterPolicyVersion' | 'mapRegistration'>;
/** Exact same source fields consumed by the existing original grading bridge.
 * A narrow projection prevents unrelated Prisma/source metadata reaching ATLAS. */
export function atlasTrustedLearningSourceProjection(source: ReportSourceInput) {
    requireBridge(source.cardProfile === 'SPORTS' || source.cardProfile === 'POKEMON', 'LEARNING_SOURCE_INVALID');
    return { cardProfile: source.cardProfile, identity: source.identity, capture: source.capture, reviewedDefects: source.reviewedDefects,
        gradeReport: source.gradeReport, mapRevisionId: source.mapRevisionId ?? null, mapFilterPolicyVersion: source.mapFilterPolicyVersion ?? null,
        mapRegistration: source.mapRegistration ?? null };
}
export function atlasTrustedLearningFingerprintVersion(source: Pick<ReportSourceInput, 'capture' | 'gradeReport'>) {
    const version = speedsterHistoryFingerprintVersion(source.capture, source.gradeReport);
    requireBridge(version === SPEEDSTER_LEARNING_FINGERPRINT_VERSION, 'LEARNING_FINGERPRINT_INCOMPATIBLE');
    return version;
}

export function createAtlasTrustedLearningPorts(settings: AtlasTrustedLearningSettings) {
    const hashes = [...settings.allowedPhoneHashes].sort();
    requireBridge(settings.mode === 'PRODUCTION' && hashes.length > 0 && hashes.length <= 100 && hashes.every(value => SHA.test(value))
        && new Set(hashes).size === hashes.length && digest(canonical(hashes)) === settings.phoneAllowlistHash, 'LEARNING_ROSTER_INVALID');
    atlasTrustedLearningBinding(settings);
    const allowed = new Set(hashes);
    return {
        async loadSource(tx: Prisma.TransactionClient, exact: LearningSource): Promise<SpeedsterReviewActionSession> {
            requireBridge(exact.sourceType === 'SPEEDSTER', 'LEARNING_SOURCE_INVALID');
            const rows = await tx.$queryRaw<SpeedsterReviewActionSession[]>`SELECT id,"createdByUserId","cardProfile","workflowState",identity,capture,
                "reviewedDefects","gradeReport","mapRevisionId","mapFilterPolicyVersion","mapRegistration","updatedAt"
                FROM public."AiGraderV2Session" WHERE id=${exact.sourceId} AND "createdByUserId"=${exact.sourceOwnerId} FOR SHARE`;
            requireBridge(rows.length === 1 && rows[0].id === exact.sourceId && rows[0].createdByUserId === exact.sourceOwnerId
                && rows[0].workflowState === 'CAPTURED' && ['SPORTS', 'POKEMON'].includes(rows[0].cardProfile ?? ''), 'LEARNING_SOURCE_NOT_CAPTURED');
            return resolvePersistedSpeedsterPreparationCapture(rows[0]);
        },
        reportSource: atlasTrustedLearningSourceProjection,
        sourceEvidence: atlasSpeedsterSourceEvidence,
        assertSourceAdmission: assertAtlasSpeedsterSourceAdmission,
        fingerprintVersion: atlasTrustedLearningFingerprintVersion,
        generateCandidates: harvestSpeedsterLearningCandidatesV2,
        isStaffPhoneAllowed: (phoneHash: string) => allowed.has(phoneHash),
    };
}

/** Private original Prisma client only; staff receipt queries are raw and scoped
 * inside the shared class. No legacy admin session or bank writer is composed. */
export function createAtlasTrustedLearning(client: PrismaClient, settings: AtlasTrustedLearningSettings) {
    return new ScopedTrustedLearningCandidates<Prisma.TransactionClient, SpeedsterReviewActionSession>({
        client, config: settings, ports: createAtlasTrustedLearningPorts(settings) });
}
