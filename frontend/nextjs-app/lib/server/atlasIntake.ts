import type { Prisma, PrismaClient } from '@prisma/client';
import { makeIntakeConfig, ScopedSourceIntake, type IntakeSource } from '@atlas/service-bridge/intake';
import { canonical, digest, keyBytes, requireBridge, SHA } from '@atlas/service-bridge/protocol';
import { canonicalizeSpeedsterSessionIdentity } from '../ai-grader-v2/identity';
import type { SpeedsterReviewActionSession } from './aiGraderV2ReviewAction';
import { atlasGradingPolicyHash, atlasSpeedsterSourceEvidence, assertAtlasSpeedsterSourceAdmission } from './atlasGradingBridge';
import { resolvePersistedSpeedsterPreparationCapture, speedsterPreparationSideAuthority } from './speedsterPreparationCaptureEvidence';
import { currentSpeedsterPreparationRelease } from './speedsterPreparationRelease';

/** Dedicated intake activation; it never enables the grading or image bridges. */
export function atlasIntakeConfig(env: NodeJS.ProcessEnv = process.env) {
    requireBridge(env.NODE_ENV === 'production' && env.VERCEL_ENV === 'production'
        && env.ATLAS_INTAKE_ENABLED === 'true' && !Object.keys(env).some(name => name.startsWith('ATLAS_LOCAL_'))
        && /^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '')
        && /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? ''), 'INTAKE_NOT_ENABLED');
    let hashes: unknown;
    requireBridge(typeof env.ATLAS_INTAKE_ALLOWED_PHONE_HASHES_JSON === 'string'
        && Buffer.byteLength(env.ATLAS_INTAKE_ALLOWED_PHONE_HASHES_JSON!) <= 8192, 'INTAKE_ROSTER_INVALID');
    try { hashes = JSON.parse(env.ATLAS_INTAKE_ALLOWED_PHONE_HASHES_JSON!); }
    catch { requireBridge(false, 'INTAKE_ROSTER_INVALID'); }
    requireBridge(Array.isArray(hashes) && hashes.length > 0 && hashes.length <= 100
        && hashes.every(hash => typeof hash === 'string' && SHA.test(hash))
        && new Set(hashes).size === hashes.length, 'INTAKE_ROSTER_INVALID');
    const allowedPhoneHashes = Object.freeze([...(hashes as string[])].sort());
    const otherKeyHashes = ['ATLAS_GRADING_BRIDGE_KEY', 'ATLAS_OPERATOR_EVIDENCE_KEY', 'ATLAS_PUBLIC_MEDIA_KEY']
        .filter(name => env[name] !== undefined).map(name => digest(keyBytes(env[name])));
    const settings = makeIntakeConfig({ mode: 'PRODUCTION', origin: env.ATLAS_INTAKE_ORIGIN!, deploymentId: env.VERCEL_URL!,
        releaseSha: env.VERCEL_GIT_COMMIT_SHA!, key: keyBytes(env.ATLAS_INTAKE_KEY), otherKeyHashes,
        gradingPolicyHash: atlasGradingPolicyHash(), phoneAllowlistHash: digest(canonical(allowedPhoneHashes)) });
    return Object.freeze({ ...settings, allowedPhoneHashes });
}

/** Card identity already stored on the exact source, never a client descriptor. */
export function atlasIntakeSourceTitle(source: SpeedsterReviewActionSession) {
    requireBridge(source.cardProfile === 'SPORTS' || source.cardProfile === 'POKEMON', 'INTAKE_IDENTITY_INVALID');
    const identity = canonicalizeSpeedsterSessionIdentity(source.cardProfile as 'SPORTS' | 'POKEMON', source.identity);
    const clean = (value: string, limit: number) => value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit).trim();
    const title = clean('playerName' in identity ? identity.playerName : identity.cardName, 200);
    const subtitle = clean([identity.year, 'manufacturer' in identity ? identity.manufacturer : 'Pokémon', identity.productSet,
        'insert' in identity ? identity.insert : null, identity.parallel, identity.cardNumber ? `#${identity.cardNumber}` : null]
        .filter(Boolean).join(' · '), 300);
    requireBridge(title.length > 0 && subtitle.length > 0, 'INTAKE_IDENTITY_INVALID');
    return { title, subtitle };
}

export function createAtlasIntake(client: PrismaClient, config: ReturnType<typeof atlasIntakeConfig>) {
    // Snapshot the roster and verify it belongs to the exact activated config.
    const hashes = [...config.allowedPhoneHashes].sort();
    requireBridge(hashes.length > 0 && hashes.length <= 100 && hashes.every(hash => SHA.test(hash))
        && new Set(hashes).size === hashes.length && digest(canonical(hashes)) === config.phoneAllowlistHash,
    'INTAKE_ROSTER_INVALID');
    const allowed = new Set(hashes);
    return new ScopedSourceIntake({ client, config, ports: {
        async loadSource(tx: Prisma.TransactionClient, exact: IntakeSource): Promise<SpeedsterReviewActionSession> {
            requireBridge(exact.sourceType === 'SPEEDSTER', 'INTAKE_SOURCE_INVALID');
            const rows = await tx.$queryRaw<SpeedsterReviewActionSession[]>`SELECT id,"createdByUserId","cardProfile","workflowState",
                identity,capture,"reviewedDefects","gradeReport","mapRevisionId","mapFilterPolicyVersion","mapRegistration","updatedAt"
                FROM public."AiGraderV2Session" WHERE id=${exact.sourceId} AND "createdByUserId"=${exact.sourceOwnerId} FOR SHARE`;
            requireBridge(rows.length === 1 && rows[0].workflowState === 'CAPTURED', 'SOURCE_NOT_CAPTURED');
            return resolvePersistedSpeedsterPreparationCapture(rows[0]);
        },
        sourceEvidence: atlasSpeedsterSourceEvidence,
        assertSourceAdmission: assertAtlasSpeedsterSourceAdmission,
        sourceAdmission(source: SpeedsterReviewActionSession) {
            const resolved = resolvePersistedSpeedsterPreparationCapture(source), preparationRelease = currentSpeedsterPreparationRelease();
            const capture = resolved.capture as Record<string, unknown>;
            const front = speedsterPreparationSideAuthority(capture.front), back = speedsterPreparationSideAuthority(capture.back);
            requireBridge(preparationRelease && front && back, 'INTAKE_ADMISSION_REQUIRED');
            return { preparationRelease: { ...preparationRelease }, frontAuthorityHash: digest(canonical(front)), backAuthorityHash: digest(canonical(back)) };
        },
        sourceTitle: atlasIntakeSourceTitle,
        isStaffPhoneAllowed: (phoneHash: string) => allowed.has(phoneHash),
    } });
}
