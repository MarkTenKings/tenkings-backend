import { randomUUID } from 'node:crypto';
import { LocalReviewStore } from '../review.mjs';
import { hash, BROWSER_COOKIE, SESSION_COOKIE, LOCAL_ORIGIN } from '../policy.mjs';
import { canonical } from '../review-contract.mjs';
import { makeAccessConfig } from './config.mjs';
import { fixtureAnalysis, FIXTURE_GRADING_POLICY } from './fixture-analysis.mjs';

export function localAccessConfig({ databaseUrl, sessionKey, phoneKey, phones = ['+12025550141', '+12025550142'] }) {
    return makeAccessConfig({ mode: 'LOCAL_FIXTURE', origin: LOCAL_ORIGIN, deploymentId: 'local-postgres-fixture',
        releaseSha: '0'.repeat(40), accountSid: `AC${'1'.repeat(32)}`, serviceSid: `VA${'2'.repeat(32)}`,
        databaseUrl, cookies: { browser: BROWSER_COOKIE, session: SESSION_COOKIE },
        sessionKey, phoneKey, approvedPhones: new Set(phones), providerLifetimeMs: 600_000 });
}

export function fixtureVerifyProvider(config) {
    const records = new Map();
    return {
        async start(phone) {
            const verificationSid = `VE${randomUUID().replaceAll('-', '')}`;
            const result = { accountSid: config.accountSid, serviceSid: config.serviceSid, verificationSid, phone, channel: 'sms', status: 'pending' };
            records.set(verificationSid, result); return { ...result };
        },
        async check(sid, code) {
            const row = records.get(sid);
            if (!row) throw new Error('FIXTURE_CODE_UNAVAILABLE');
            return { ...row, status: code === '424242' ? 'approved' : 'pending' };
        },
    };
}

// Deterministic artwork can be regenerated after a web-process restart; its
// exact stored digest remains authoritative. No local path comes from a request.
export function fixtureEvidence() {
    const samples = new LocalReviewStore();
    return { async read(binding) {
        if (binding.sourceType !== 'LOCAL_FIXTURE' || binding.sourceId !== binding.descriptor.sourceRef.split(':')[0]
            || binding.descriptor.sourceRef !== `${binding.sourceId}:${binding.side}`) throw new Error('INVALID_FIXTURE_EVIDENCE');
        const bytes = samples.cards.get(binding.sourceId)?.evidence[binding.side];
        if (!bytes) throw new Error('FIXTURE_EVIDENCE_MISSING');
        return bytes;
    } };
}

/** Elevated seeding is only used by the owned disposable fixture, never HTTP. */
export async function seedLocalStaff(admin, config, { identities: seedIdentities = true, analyses = false, trained = false } = {}) {
    if (config.mode !== 'LOCAL_FIXTURE') throw new Error('FIXTURE_ONLY');
    const now = new Date();
    const identities = [];
    await admin.$transaction(async tx => {
        await tx.staffControl.create({ data: { enabled: true, mode: config.mode, origin: config.origin,
            deploymentId: config.deploymentId, releaseSha: config.releaseSha, configHash: config.configHash,
            gradingPolicyHash: analyses ? FIXTURE_GRADING_POLICY : null } });
        for (const [index, phoneHash] of [...config.phoneByHash.keys()].entries()) {
            if (!seedIdentities) continue;
            identities.push(await tx.staffIdentity.create({ data: { id: randomUUID(), phoneHash,
                name: index === 1 ? 'Sample observer' : 'Sample reviewer', role: index === 1 ? 'OBSERVER' : 'REVIEWER',
                ...(trained && index !== 1 ? { certificationUntil: new Date(+now + 60 * 60_000) } : {}) } }));
        }
        for (const sample of new LocalReviewStore().cards.values()) {
            const id = randomUUID();
            const sides = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, sample.evidence[side] ? {
                sha256: hash(sample.evidence[side]), byteCount: sample.evidence[side].length, width: 360, height: 504,
                contentType: 'image/svg+xml', sourceRef: `${sample.id}:${side}` } : null]));
            const evidenceCanonical = canonical({ sides }), evidenceHash = hash(evidenceCanonical);
            const analysisRevision = analyses && sides.FRONT && sides.BACK ? 1 : 0;
            await tx.staffSpecimen.create({ data: { id, sourceType: 'LOCAL_FIXTURE', sourceId: sample.id,
                title: sample.title, subtitle: sample.set, evidenceCanonical, evidenceHash, analysisRevision } });
            if (analysisRevision) await tx.staffAnalysisRevision.create({ data: { specimenId: id, ...fixtureAnalysis(sample, evidenceHash) } });
            const draft = { ...sample.draft, evidenceHash };
            const content = canonical(draft);
            await tx.staffReviewRevision.create({ data: { specimenId: id, revision: 1, evidenceRevision: 1, analysisRevision,
                evidenceHash, contentHash: hash(content), canonical: content } });
            for (const identity of identities) {
                if (identity.role === 'OBSERVER' && sample.id !== 'sample-002') continue;
                await tx.staffAssignment.create({ data: { specimenId: id, identityId: identity.id,
                    canReview: identity.role === 'REVIEWER', expiresAt: new Date(+now + 24 * 60 * 60 * 1000) } });
            }
        }
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    });
    return identities;
}
