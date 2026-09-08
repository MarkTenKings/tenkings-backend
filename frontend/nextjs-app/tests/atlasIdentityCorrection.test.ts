import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { previewAtlasReport } from '@atlas/grading-core/report';
import { canonicalizeSpeedsterSessionIdentity } from '../lib/ai-grader-v2/identity';
import { fixtureAnalysis } from '../../atlas-app/lib/server/access/fixture-analysis.mjs';
import { classifyAtlasIdentityCorrection, type AtlasIdentityCorrectionInput, type AtlasIdentityCorrectionPorts,
    type AtlasIdentityCorrectionSource } from '../lib/server/atlasIdentityCorrection';

const admission = { gradingPolicyHash: 'a'.repeat(64), preparationRelease: { mode: 'LOCAL_FIXTURE', release: 'synthetic-only' },
    frontAuthorityHash: 'b'.repeat(64), backAuthorityHash: 'c'.repeat(64) };
function reportSource(source: AtlasIdentityCorrectionSource) {
    return { cardProfile: source.cardProfile, identity: source.identity, capture: source.capture,
        reviewedDefects: source.reviewedDefects, gradeReport: source.gradeReport,
        mapRevisionId: source.mapRevisionId ?? null, mapFilterPolicyVersion: source.mapFilterPolicyVersion ?? null,
        mapRegistration: source.mapRegistration ?? null } as ReturnType<AtlasIdentityCorrectionPorts['reportSource']>;
}
function evidence(source: AtlasIdentityCorrectionSource, sourceRevision: string) {
    return { version: 'atlas-speedster-evidence-v1', sourceId: source.id, sourceOwnerId: source.createdByUserId, sourceRevision,
        captureHash: digest(canonical(source.capture)), identityHash: digest(canonical({ cardProfile: source.cardProfile, identity: source.identity })),
        mapRevisionId: source.mapRevisionId ?? null, mapFilterPolicyVersion: source.mapFilterPolicyVersion ?? null,
        mapRegistrationHash: digest(canonical(source.mapRegistration ?? null)),
        sides: { FRONT: { sha256: '1'.repeat(64), sourceRef: 'SYNTHETIC_NO_IMAGE_FRONT' }, BACK: { sha256: '2'.repeat(64), sourceRef: 'SYNTHETIC_NO_IMAGE_BACK' } },
        originals: { FRONT: { sha256: '3'.repeat(64) }, BACK: { sha256: '4'.repeat(64) } } };
}
const ports: AtlasIdentityCorrectionPorts = { reportSource, sourceEvidence: evidence, previewReport: previewAtlasReport,
    sourceAdmission: () => structuredClone(admission) };
function fixture(pokemon = false, layout: string | null = 'POKEMON') {
    const raw = JSON.parse(fixtureAnalysis({ title: 'Fixture Player', set: 'Synthetic Set' }, 'f'.repeat(64), { traces: true }).sourceCanonical);
    const source: AtlasIdentityCorrectionSource = { ...raw, id: 'synthetic-source', createdByUserId: 'synthetic-owner', workflowState: 'CAPTURED',
        updatedAt: new Date('2026-09-08T09:10:11.123Z'), mapRevisionId: 'synthetic-map', mapFilterPolicyVersion: 'synthetic-filter',
        mapRegistration: { rawRegistrationProof: ['unchanged', 0.10000000000000002] },
        cardProfile: pokemon ? 'POKEMON' : 'SPORTS',
        identity: canonicalizeSpeedsterSessionIdentity(pokemon ? 'POKEMON' : 'SPORTS', pokemon
            ? { cardName: 'Fixture Pokémon', productSet: 'Synthetic Set', year: '2026', ...(layout ? { layoutType: layout } : {}) } : raw.identity) };
    // Private raw data survives even when original report presentation omits it.
    Object.assign((source.reviewedDefects as Record<string, unknown>[])[0], { rawMask: { runs: [0, 3, 4] },
        featureFingerprint: [1, 0.10000000000000002, -0.3], privateDetectorNote: 'retained private raw finding' });
    const input: AtlasIdentityCorrectionInput = { source, expected: { sourceId: source.id, sourceOwnerId: source.createdByUserId,
        sourceRevision: source.updatedAt.toISOString(), evidenceSourceRevision: source.updatedAt.toISOString(), sourceHash: digest(canonical(reportSource(source))),
        evidenceHash: digest(canonical(evidence(source, source.updatedAt.toISOString()))), gradingPolicyHash: admission.gradingPolicyHash },
        next: { cardProfile: pokemon ? 'POKEMON' : 'SPORTS', identity: structuredClone(source.identity) } };
    return input;
}
function withIdentity(input: AtlasIdentityCorrectionInput, patch: Record<string, unknown>) {
    return { ...input, next: { ...input.next, identity: { ...(input.next.identity as object), ...patch } } };
}
function freeze(value: unknown) {
    if (value && typeof value === 'object') { Object.freeze(value); for (const entry of Object.values(value)) freeze(entry); }
    return value;
}

test('normalization-equivalent concrete change preserves exact source, preparation, raw findings, saved grade and original math', () => {
    const input = withIdentity(fixture(), { playerName: 'ＦＩＸＴＵＲＥ  PLAYER', manufacturer: 'SYNTHETIC ILLUSTRATION' });
    const before = canonical(input); freeze(input);
    const result = classifyAtlasIdentityCorrection(input, ports), proof = JSON.parse(result.proofCanonical);
    assert.equal(result.status, 'COMPATIBLE'); assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.changedFields, ['manufacturer', 'playerName']);
    assert.equal(canonical(input), before); assert.equal(result.proofHash, digest(result.proofCanonical));
    assert.equal(proof.sourceCanonical, canonical(reportSource(input.source)));
    assert.equal(proof.evidenceCanonical, canonical(evidence(input.source, input.expected.sourceRevision)));
    assert.equal(proof.admissionCanonical, canonical(admission));
    assert.equal(proof.rawFindingsHash, digest(canonical(input.source.reviewedDefects)));
    assert.equal(proof.captureHash, digest(canonical(input.source.capture)));
    assert.equal(proof.gradeReportHash, digest(canonical(input.source.gradeReport)));
    assert.equal(proof.reportHash, digest(canonical(previewAtlasReport(reportSource(input.source)))));
    assert.deepEqual(JSON.parse(proof.sourceCanonical).reviewedDefects, input.source.reviewedDefects);
    assert.equal(result.requiresCurrentAuthorityRevalidation, true);
    for (const invented of ['nextSourceRevision', 'nextEvidenceHash', 'createdAt', 'mutationAuthorized']) assert.equal(Object.hasOwn(proof, invented), false);
    assert(Object.isFrozen(result)); assert(Object.isFrozen(result.changedFields));
    assert.deepEqual(classifyAtlasIdentityCorrection(input, ports), result);
});
test('NO_CHANGE requires exact canonical identity equality; original parser trims submitted form', () => {
    const input = fixture(); assert.equal(classifyAtlasIdentityCorrection(input, ports).status, 'NO_CHANGE');
    assert.equal(classifyAtlasIdentityCorrection(withIdentity(input, { playerName: '  Fixture Player  ', parallel: '' }), ports).status, 'NO_CHANGE');
    assert.equal(classifyAtlasIdentityCorrection(withIdentity(input, { playerName: 'fixture player' }), ports).status, 'COMPATIBLE');
});
test('actual name/card number corrections change exact authority; set corrections also change family authority', () => {
    for (const patch of [{ playerName: 'Other Player' }, { cardNumber: '20' }, { playerName: 'Fixture-Player' }]) {
        const result = classifyAtlasIdentityCorrection(withIdentity(fixture(), patch), ports);
        assert.equal(result.status, 'REPROCESS_REQUIRED'); assert.deepEqual(result.reasons, ['EXACT_MAP_KEY_CHANGED']);
    }
    for (const patch of [{ productSet: 'Other Set' }, { year: '2025' }, { manufacturer: 'Other Manufacturer' }, { parallel: 'Gold' }, { insert: 'Special' }]) {
        assert.deepEqual(classifyAtlasIdentityCorrection(withIdentity(fixture(), patch), ports).reasons, ['EXACT_MAP_KEY_CHANGED', 'FAMILY_MAP_KEY_CHANGED']);
    }
});
test('Pokémon explicit layout changes require reprocessing even when exact keys are identical', () => {
    const input = fixture(true), result = classifyAtlasIdentityCorrection(withIdentity(input, { layoutType: 'TRAINER' }), ports);
    assert.equal(result.status, 'REPROCESS_REQUIRED'); assert.deepEqual(result.reasons, ['LAYOUT_CHANGED', 'FAMILY_MAP_KEY_CHANGED']);
    assert.deepEqual(JSON.parse(result.proofCanonical).oldKeys.exact, JSON.parse(result.proofCanonical).nextKeys.exact);
    const removed = structuredClone(input); delete (removed.next.identity as Record<string, unknown>).layoutType;
    assert.deepEqual(classifyAtlasIdentityCorrection(removed, ports).reasons, ['LAYOUT_CHANGED', 'FAMILY_MAP_KEY_CHANGED']);
    assert.deepEqual(classifyAtlasIdentityCorrection(withIdentity(fixture(true, null), { layoutType: 'POKEMON' }), ports).reasons,
        ['LAYOUT_CHANGED', 'FAMILY_MAP_KEY_CHANGED']);
});
test('unchanged missing legacy layout is only historical equivalence and never inferred V2 family eligibility', () => {
    const input = withIdentity(fixture(true, null), { cardName: 'FIXTURE POKÉMON' }), result = classifyAtlasIdentityCorrection(input, ports);
    const proof = JSON.parse(result.proofCanonical);
    assert.equal(result.status, 'COMPATIBLE'); assert.equal(proof.oldKeys.familyKeyKind, 'LEGACY_HISTORICAL_ONLY');
    assert.equal(proof.nextKeys.familyKeyKind, 'LEGACY_HISTORICAL_ONLY'); assert.equal(proof.nextKeys.layout, null);
    assert.equal(Object.hasOwn(JSON.parse(result.nextIdentityCanonical), 'layoutType'), false);
});
test('valid category change is an explicit reprocessing proposal, never a compatible JSON edit', () => {
    const input = fixture(), pokemon = fixture(true);
    const result = classifyAtlasIdentityCorrection({ ...input, next: pokemon.next }, ports);
    assert.equal(result.status, 'REPROCESS_REQUIRED');
    assert.deepEqual(result.reasons, ['CATEGORY_CHANGED', 'LAYOUT_CHANGED', 'EXACT_MAP_KEY_CHANGED', 'FAMILY_MAP_KEY_CHANGED']);
    assert(result.changedFields.includes('cardProfile'));
});
test('invalid/cross-category/extra-field identity and noncanonical stored preimage reject', () => {
    for (const patch of [{ playerName: '' }, { year: 2026 }, { layoutType: 'POKEMON' }, { credentials: 'no' }])
        assert.throws(() => classifyAtlasIdentityCorrection(withIdentity(fixture(), patch), ports));
    assert.throws(() => classifyAtlasIdentityCorrection({ ...fixture(), next: { cardProfile: 'OTHER' as never, identity: {} } }, ports), /CATEGORY_INVALID/);
    const input = fixture(); (input.source.identity as Record<string, unknown>).playerName = ' Fixture Player ';
    assert.throws(() => classifyAtlasIdentityCorrection(input, ports), /SOURCE_IDENTITY_NONCANONICAL/);
});
test('exact source, owner, revision, source hash, evidence hash and policy preimage must match', () => {
    const base = fixture();
    for (const patch of [{ sourceId: 'other' }, { sourceOwnerId: 'other' }, { sourceRevision: '2026-09-08T09:10:11.124Z' },
        { sourceHash: '0'.repeat(64) }, { evidenceHash: '0'.repeat(64) }, { gradingPolicyHash: '0'.repeat(64) }])
        assert.throws(() => classifyAtlasIdentityCorrection({ ...base, expected: { ...base.expected, ...patch } }, ports), /MISMATCH/);
    assert.throws(() => classifyAtlasIdentityCorrection({ ...base, source: { ...base.source, workflowState: 'COMPLETED' } }, ports), /SOURCE_NOT_CAPTURED/);
    assert.throws(() => classifyAtlasIdentityCorrection({ ...base, expected: { ...base.expected, sourceHash: 'bad' } }, ports), /HASH_INVALID/);
});
test('already graded source timestamp and preserved capture evidence revision are independent exact preimages', () => {
    const input = withIdentity(fixture(), { playerName: 'FIXTURE PLAYER' });
    const evidenceSourceRevision = '2026-09-07T09:10:11.123Z';
    const expected = { ...input.expected, evidenceSourceRevision,
        evidenceHash: digest(canonical(evidence(input.source, evidenceSourceRevision))) };
    const result = classifyAtlasIdentityCorrection({ ...input, expected }, ports);
    assert.equal(result.status, 'COMPATIBLE');
    assert.equal(JSON.parse(result.proofCanonical).expected.sourceRevision, input.source.updatedAt.toISOString());
    assert.equal(JSON.parse(result.proofCanonical).expected.evidenceSourceRevision, evidenceSourceRevision);
    for (const patch of [{ sourceRevision: evidenceSourceRevision }, { evidenceSourceRevision: input.expected.sourceRevision }])
        assert.throws(() => classifyAtlasIdentityCorrection({ ...input, expected: { ...expected, ...patch } }, ports), /MISMATCH/);
});
test('port projections cannot discard raw findings or substitute source evidence, and all supplied sources are detached', () => {
    const input = withIdentity(fixture(), { playerName: 'FIXTURE PLAYER' }), before = canonical(input);
    assert.throws(() => classifyAtlasIdentityCorrection(input, { ...ports, reportSource(source) {
        (source.reviewedDefects as unknown[]).pop(); return reportSource(source);
    } }), /PROJECTION_MISMATCH/);
    assert.equal(canonical(input), before);
    const wrongEvidence = (source: AtlasIdentityCorrectionSource, revision: string) => ({ ...evidence(source, revision), captureHash: '0'.repeat(64) });
    const expected = { ...input.expected, evidenceHash: digest(canonical(wrongEvidence(input.source, input.expected.sourceRevision))) };
    assert.throws(() => classifyAtlasIdentityCorrection({ ...input, expected }, { ...ports, sourceEvidence: wrongEvidence }), /EVIDENCE_MISMATCH/);
    const detached = { ...ports, sourceEvidence(source: AtlasIdentityCorrectionSource, revision: string) {
        const result = evidence(source, revision); (source.reviewedDefects as unknown[]).pop(); return result;
    } };
    assert.equal(classifyAtlasIdentityCorrection(input, detached).status, 'COMPATIBLE'); assert.equal(canonical(input), before);
});
test('missing/asynchronous ports and missing preparation metadata fail closed', () => {
    const input = fixture();
    for (const name of ['sourceEvidence', 'reportSource', 'previewReport', 'sourceAdmission']) {
        assert.throws(() => classifyAtlasIdentityCorrection(input, { ...ports, [name]: undefined } as never), /PORT_UNAVAILABLE/);
        assert.throws(() => classifyAtlasIdentityCorrection(input, { ...ports, [name]: () => Promise.resolve({}) } as never));
    }
    for (const preparationRelease of [null, {}, 'release'])
        assert.throws(() => classifyAtlasIdentityCorrection(input, { ...ports, sourceAdmission: () => ({ ...admission, preparationRelease }) } as never));
});
test('original report math rejects invalid saved grade and proposed report cannot silently change score/findings', () => {
    const bad = fixture(); (bad.source.gradeReport as Record<string, unknown>).overall = 1;
    const expected = { ...bad.expected, sourceHash: digest(canonical(reportSource(bad.source))) };
    assert.throws(() => classifyAtlasIdentityCorrection({ ...bad, expected }, ports), /ATLAS_REPORT_GRADE_MISMATCH/);
    let calls = 0;
    assert.throws(() => classifyAtlasIdentityCorrection(withIdentity(fixture(), { playerName: 'FIXTURE PLAYER' }), {
        ...ports, previewReport(source) { const result = previewAtlasReport(source); if (++calls === 2) result.findings = []; return result; },
    }), /REPORT_MISMATCH/);
});
