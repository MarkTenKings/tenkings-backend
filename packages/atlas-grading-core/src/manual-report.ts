import { SPEEDSTER_RULE_VERSION, type SpeedsterCardProfile } from './contracts';
import { canonicalizeSpeedsterSessionIdentity } from './identity';
import { parsePersistedSpeedsterReviewFindings } from './review-findings';
import { calculateSpeedsterReview } from './review';
import { measureSpeedsterCenteringBorders } from './scoring';

type SideEvidence = Readonly<{ centeringQuad: unknown; inspectionImageSha256: string }>;
type SideInspection = Readonly<{ inspected: true; imageSha256: string; findingRevision: number }>;
export type AtlasManualReportSource = Readonly<{
  cardProfile: SpeedsterCardProfile;
  identity: unknown;
  draftRevision: number;
  findingRevisions: Readonly<{ front: number; back: number }>;
  capture: Readonly<{ front: SideEvidence; back: SideEvidence }>;
  reviewedDefects: unknown;
  manualInspection: Readonly<{
    method: 'HUMAN';
    front: SideInspection;
    back: SideInspection;
  }>;
}>;

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Pure draft content for a completed human inspection. No detector is implied.
 * The caller authenticates the inspector and owns authoritative revisions.
 * Relevant edits advance the report draft; finding/trace/type/removal/review/undo
 * edits also advance that side's finding revision. Image inspection is bound
 * per side, so identity or printed-border edits preserve still-valid inspection.
 * This check cannot prove that a human actually inspected a card.
 * It grants no approval, certificate, label, learning or publication authority.
 */
export function previewAtlasManualReport(source: AtlasManualReportSource) {
  if (!record(source) || !['SPORTS', 'POKEMON'].includes(source.cardProfile)) {
    throw new Error('ATLAS_REPORT_IDENTITY_INVALID');
  }
  if (!Number.isSafeInteger(source.draftRevision) || source.draftRevision < 1) {
    throw new Error('ATLAS_MANUAL_REPORT_REVISION_INVALID');
  }
  const inspection = source.manualInspection;
  if (!record(inspection) || inspection.method !== 'HUMAN') {
    throw new Error('ATLAS_MANUAL_INSPECTION_REQUIRED');
  }
  for (const side of ['front', 'back'] as const) {
    const observed = inspection[side], current = source.capture?.[side];
    const revision = source.findingRevisions?.[side];
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error('ATLAS_MANUAL_REPORT_REVISION_INVALID');
    }
    if (!record(observed) || observed.inspected !== true) {
      throw new Error('ATLAS_MANUAL_INSPECTION_REQUIRED');
    }
    if (!current || !sha256(current.inspectionImageSha256) || !sha256(observed.imageSha256)) {
      throw new Error('ATLAS_MANUAL_INSPECTION_IMAGE_INVALID');
    }
    if (current.inspectionImageSha256 !== observed.imageSha256 || revision !== observed.findingRevision) {
      throw new Error('ATLAS_MANUAL_INSPECTION_STALE');
    }
  }
  const { front, back } = source.capture;

  const identity = canonicalizeSpeedsterSessionIdentity(source.cardProfile, source.identity);
  const defects = parsePersistedSpeedsterReviewFindings(source.reviewedDefects);
  if (new Set(defects.map(finding => finding.id)).size !== defects.length) {
    throw new Error('ATLAS_REPORT_FINDING_ID_CONFLICT');
  }
  const capture = {
    front: { centeringBorders: measureSpeedsterCenteringBorders(front.centeringQuad) },
    back: { centeringBorders: measureSpeedsterCenteringBorders(back.centeringQuad) },
  };
  const review = calculateSpeedsterReview(capture, defects);
  return {
    version: 'atlas-manual-draft-report-v1' as const,
    ruleVersion: SPEEDSTER_RULE_VERSION,
    cardProfile: source.cardProfile,
    identity,
    draftRevision: source.draftRevision,
    inspection: {
      method: 'HUMAN' as const,
      front: { inspected: true as const, imageSha256: inspection.front.imageSha256, findingRevision: inspection.front.findingRevision },
      back: { inspected: true as const, imageSha256: inspection.back.imageSha256, findingRevision: inspection.back.findingRevision },
    },
    grade: review.grade,
    findings: review.defects,
    findingCounts: {
      total: review.defects.length,
      included: review.defects.filter(finding => finding.reviewResult !== 'REMOVED').length,
      removed: review.defects.filter(finding => finding.reviewResult === 'REMOVED').length,
      unreviewed: review.defects.filter(finding => finding.reviewResult === 'UNREVIEWED').length,
    },
  };
}
