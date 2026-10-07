import { canonical, digest } from '@atlas/service-bridge/protocol';
import { canonicalizeSpeedsterSessionIdentity, speedsterPokemonLayoutType,
    type SpeedsterCardProfile, type SpeedsterSessionIdentity } from '../ai-grader-v2/identity';
import { speedsterCardTypeMapKey, speedsterFamilyCardTypeMapKey,
    speedsterLegacyFamilyCardTypeMapKey } from '../ai-grader-v2/card-type-map-contracts';
import type { previewAtlasReport } from '@atlas/grading-core/report';
import type { SpeedsterReviewActionSession } from './aiGraderV2ReviewAction';

export type AtlasIdentityCorrectionSource = Readonly<SpeedsterReviewActionSession>;
type ReportSource = Parameters<typeof previewAtlasReport>[0] & Readonly<{
    mapRevisionId: string | null; mapFilterPolicyVersion: string | null; mapRegistration: unknown;
}>;
/** Preverified metadata, never a substitute for current preparation/map authority. */
export type AtlasIdentityCorrectionAdmission = Readonly<{
    gradingPolicyHash: string; preparationRelease: Readonly<Record<string, unknown>>;
    frontAuthorityHash: string; backAuthorityHash: string;
}>;
export type AtlasIdentityCorrectionPorts = Readonly<{
    sourceEvidence(source: AtlasIdentityCorrectionSource, sourceRevision: string): unknown;
    reportSource(source: AtlasIdentityCorrectionSource): ReportSource;
    previewReport: typeof previewAtlasReport;
    sourceAdmission(source: AtlasIdentityCorrectionSource): AtlasIdentityCorrectionAdmission;
}>;
export type AtlasIdentityCorrectionInput = Readonly<{
    source: AtlasIdentityCorrectionSource;
    expected: Readonly<{ sourceId: string; sourceOwnerId: string; sourceRevision: string; evidenceSourceRevision: string;
        sourceHash: string; evidenceHash: string; gradingPolicyHash: string }>;
    next: Readonly<{ cardProfile: SpeedsterCardProfile; identity: unknown }>;
}>;
export type AtlasIdentityCorrectionReason = 'CATEGORY_CHANGED' | 'LAYOUT_CHANGED' | 'EXACT_MAP_KEY_CHANGED' | 'FAMILY_MAP_KEY_CHANGED';
export type AtlasIdentityCorrectionProposal = Readonly<{
    status: 'NO_CHANGE' | 'COMPATIBLE' | 'REPROCESS_REQUIRED';
    reasons: readonly AtlasIdentityCorrectionReason[]; changedFields: readonly string[];
    nextIdentityCanonical: string; proofCanonical: string; proofHash: string;
    requiresCurrentAuthorityRevalidation: true;
}>;

function requireCorrection(value: unknown, code: string): asserts value {
    if (!value) throw new Error(`ATLAS_IDENTITY_CORRECTION_${code}`);
}
function object(value: unknown): Record<string, unknown> {
    requireCorrection(value && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype, 'INPUT_INVALID');
    return value as Record<string, unknown>;
}
function exact(value: unknown, names: string[]) {
    const record = object(value);
    requireCorrection(canonical(Object.keys(record).sort()) === canonical([...names].sort()), 'INPUT_INVALID');
    return record;
}
function bytes(value: unknown, limit: number): string {
    const result = canonical(value);
    requireCorrection(typeof result === 'string' && Buffer.byteLength(result) <= limit, 'INPUT_INVALID');
    return result;
}
function sha(value: unknown): asserts value is string {
    requireCorrection(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'HASH_INVALID');
}
function profile(value: unknown): asserts value is SpeedsterCardProfile {
    requireCorrection(value === 'SPORTS' || value === 'POKEMON', 'CATEGORY_INVALID');
}
function projection(source: AtlasIdentityCorrectionSource) {
    return { cardProfile: source.cardProfile, identity: source.identity, capture: source.capture,
        reviewedDefects: source.reviewedDefects, gradeReport: source.gradeReport,
        mapRevisionId: source.mapRevisionId ?? null, mapFilterPolicyVersion: source.mapFilterPolicyVersion ?? null,
        mapRegistration: source.mapRegistration ?? null };
}
function mapKeys(category: SpeedsterCardProfile, identity: SpeedsterSessionIdentity) {
    const layout = speedsterPokemonLayoutType(identity);
    // Historical comparison only. This does not perform FAMILY lookup or admit a
    // legacy identity to runtime V2 FAMILY authority.
    const historical = category === 'POKEMON' && layout === null;
    return { exact: speedsterCardTypeMapKey(category, identity),
        family: historical ? speedsterLegacyFamilyCardTypeMapKey(category, identity) : speedsterFamilyCardTypeMapKey(category, identity),
        familyKeyKind: historical ? 'LEGACY_HISTORICAL_ONLY' as const : 'CURRENT' as const, layout };
}
function reportInvariant(report: ReturnType<typeof previewAtlasReport>) {
    const { identity: _identity, cardProfile: _profile, ...invariant } = report;
    return canonical(invariant);
}

/**
 * Pure classification only. No clock, new source revision, evidence issuance,
 * source lookup, map eligibility, review reset or mutation authority is created.
 * All injected ports must be synchronous original-source projections/math.
 * proofCanonical contains private evidence and must never be a browser payload.
 */
export function classifyAtlasIdentityCorrection(input: AtlasIdentityCorrectionInput,
    ports: AtlasIdentityCorrectionPorts): AtlasIdentityCorrectionProposal {
    exact(input, ['source', 'expected', 'next']);
    exact(input.expected, ['sourceId', 'sourceOwnerId', 'sourceRevision', 'evidenceSourceRevision', 'sourceHash', 'evidenceHash', 'gradingPolicyHash']);
    exact(input.next, ['cardProfile', 'identity']);
    for (const name of ['sourceEvidence', 'reportSource', 'previewReport', 'sourceAdmission'] as const)
        requireCorrection(typeof ports?.[name] === 'function', 'PORT_UNAVAILABLE');
    const source = structuredClone(input.source), expected = structuredClone(input.expected), next = structuredClone(input.next);
    requireCorrection(source.workflowState === 'CAPTURED', 'SOURCE_NOT_CAPTURED');
    for (const id of [expected.sourceId, expected.sourceOwnerId])
        requireCorrection(typeof id === 'string' && id.length > 0 && id.length <= 200 && id.trim() === id, 'SOURCE_MISMATCH');
    requireCorrection(source.id === expected.sourceId && source.createdByUserId === expected.sourceOwnerId
        && source.updatedAt instanceof Date && Number.isFinite(source.updatedAt.getTime())
        && source.updatedAt.toISOString() === expected.sourceRevision, 'SOURCE_MISMATCH');
    requireCorrection(typeof expected.evidenceSourceRevision === 'string' && Number.isFinite(Date.parse(expected.evidenceSourceRevision))
        && new Date(expected.evidenceSourceRevision).toISOString() === expected.evidenceSourceRevision, 'EVIDENCE_MISMATCH');
    for (const hash of [expected.sourceHash, expected.evidenceHash, expected.gradingPolicyHash]) sha(hash);
    profile(source.cardProfile); profile(next.cardProfile);
    const oldIdentity = canonicalizeSpeedsterSessionIdentity(source.cardProfile, source.identity);
    const nextIdentity = canonicalizeSpeedsterSessionIdentity(next.cardProfile, next.identity);
    // The stored preimage is authoritative and must already be canonical. The
    // proposed form uses the original parser's trim/optional-null normalization.
    requireCorrection(canonical(oldIdentity) === bytes(source.identity, 8192), 'SOURCE_IDENTITY_NONCANONICAL');
    const sourceCanonical = bytes(projection(source), 2 * 1024 * 1024);
    requireCorrection(digest(sourceCanonical) === expected.sourceHash, 'SOURCE_MISMATCH');
    const reportSource = ports.reportSource(structuredClone(source));
    requireCorrection(bytes(reportSource, 2 * 1024 * 1024) === sourceCanonical, 'PROJECTION_MISMATCH');
    const evidence = object(ports.sourceEvidence(structuredClone(source), expected.evidenceSourceRevision));
    const evidenceCanonical = bytes(evidence, 131072);
    requireCorrection(digest(evidenceCanonical) === expected.evidenceHash, 'EVIDENCE_MISMATCH');
    requireCorrection(evidence.version === 'atlas-speedster-evidence-v1' && evidence.sourceId === source.id
        && evidence.sourceOwnerId === source.createdByUserId && evidence.sourceRevision === expected.evidenceSourceRevision
        && evidence.captureHash === digest(canonical(source.capture))
        && evidence.identityHash === digest(canonical({ cardProfile: source.cardProfile, identity: source.identity }))
        && evidence.mapRevisionId === (source.mapRevisionId ?? null)
        && evidence.mapFilterPolicyVersion === (source.mapFilterPolicyVersion ?? null)
        && evidence.mapRegistrationHash === digest(canonical(source.mapRegistration ?? null)), 'EVIDENCE_MISMATCH');
    const admission = exact(ports.sourceAdmission(structuredClone(source)),
        ['gradingPolicyHash', 'preparationRelease', 'frontAuthorityHash', 'backAuthorityHash']);
    for (const hash of [admission.gradingPolicyHash, admission.frontAuthorityHash, admission.backAuthorityHash]) sha(hash);
    requireCorrection(admission.gradingPolicyHash === expected.gradingPolicyHash, 'POLICY_MISMATCH');
    requireCorrection(Object.keys(object(admission.preparationRelease)).length > 0, 'PREPARATION_METADATA_REQUIRED');
    const admissionCanonical = bytes(admission, 8192);
    const report = object(ports.previewReport(structuredClone(reportSource))) as ReturnType<typeof previewAtlasReport>;
    requireCorrection(report.version === 'atlas-graded-report-v1' && report.cardProfile === source.cardProfile
        && canonical(report.identity) === canonical(oldIdentity), 'REPORT_MISMATCH');
    const oldKeys = mapKeys(source.cardProfile, oldIdentity), nextKeys = mapKeys(next.cardProfile, nextIdentity);
    const reasons: AtlasIdentityCorrectionReason[] = [];
    if (source.cardProfile !== next.cardProfile) reasons.push('CATEGORY_CHANGED');
    if (oldKeys.layout !== nextKeys.layout) reasons.push('LAYOUT_CHANGED');
    if (canonical(oldKeys.exact) !== canonical(nextKeys.exact)) reasons.push('EXACT_MAP_KEY_CHANGED');
    if (canonical(oldKeys.family) !== canonical(nextKeys.family)) reasons.push('FAMILY_MAP_KEY_CHANGED');
    const oldCanonical = canonical(oldIdentity), nextIdentityCanonical = canonical(nextIdentity);
    const status = reasons.length ? 'REPROCESS_REQUIRED' : oldCanonical === nextIdentityCanonical ? 'NO_CHANGE' : 'COMPATIBLE';
    if (status === 'COMPATIBLE') {
        const proposed = { ...structuredClone(reportSource), identity: structuredClone(nextIdentity) };
        const nextReport = object(ports.previewReport(proposed)) as ReturnType<typeof previewAtlasReport>;
        requireCorrection(nextReport.cardProfile === next.cardProfile && canonical(nextReport.identity) === nextIdentityCanonical
            && reportInvariant(nextReport) === reportInvariant(report), 'REPORT_MISMATCH');
    }
    const oldRecord = oldIdentity as unknown as Record<string, unknown>, nextRecord = nextIdentity as unknown as Record<string, unknown>;
    const changedFields = [...new Set([...Object.keys(oldRecord), ...Object.keys(nextRecord)])].sort()
        .filter(key => canonical(oldRecord[key] ?? null) !== canonical(nextRecord[key] ?? null));
    if (source.cardProfile !== next.cardProfile) changedFields.unshift('cardProfile');
    const proofCanonical = canonical({ purpose: 'atlas-identity-correction-proposal-v1', classification: status,
        expected, sourceCanonical, evidenceCanonical, admissionCanonical,
        rawFindingsHash: digest(canonical(source.reviewedDefects)), captureHash: digest(canonical(source.capture)),
        gradeReportHash: digest(canonical(source.gradeReport)), reportHash: digest(canonical(report)),
        oldIdentityCanonical: oldCanonical, nextIdentityCanonical, nextCardProfile: next.cardProfile,
        oldKeys, nextKeys, changedFields, reasons, requiresCurrentAuthorityRevalidation: true });
    return Object.freeze({ status, reasons: Object.freeze(reasons), changedFields: Object.freeze(changedFields),
        nextIdentityCanonical, proofCanonical, proofHash: digest(proofCanonical), requiresCurrentAuthorityRevalidation: true as const });
}
