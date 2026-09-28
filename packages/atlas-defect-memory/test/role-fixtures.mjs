// Synthetic software fixture only; never an independent optical benchmark.
import { canonical, digest } from '../src/contract.mjs';
import { id, raster } from '../../atlas-defect-analysis/test/fixtures.mjs';
export const seal = value => ({ ...value, sha256: digest(canonical(value, { maxBytes: 16777216 })) });
export const now = Date.parse('2026-09-28T00:00:00Z');
export function roleFixture(domain = 'CLEAN') {
  const image = { ...raster(1350, 1858, 120), sourceSha256: digest('canonical-webp') };
  const cards = [0, 1, 2].map(n => ({ cardId: id(n + 101), specimenId: `specimen-${n}`, familyId: 'synthetic family', designId: 'synthetic design',
    originalSha256: [digest(`front-${n}`), digest(`back-${n}`)] }));
  const registry = seal({ version: 'atlas-learning-identity-registry-v1', auditSha256: digest('synthetic-group-audit'), cards });
  const quality = seal({ version: 'atlas-learning-reviewer-quality-v1', auditSha256: digest('synthetic-quality-audit'),
    reviewers: [{ actorId: id(200), domain, correct: 200, total: 200, measuredAt: '2026-09-27T00:00:00Z', independentAuditSha256: digest('synthetic-independent-audit') }] });
  const policy = seal({ version: 'atlas-validated-learning-policy-v1', id: `synthetic-${domain}`, status: 'VALIDATED', domain,
    registrySha256: registry.sha256, reviewerQualitySha256: quality.sha256, evaluationSha256: digest('synthetic-evaluation'),
    independentTruthAuditSha256: digest('synthetic-truth-audit'), ownerApproval: { approvedBy: 'synthetic-owner', approvedAt: '2026-09-26T00:00:00Z',
      evaluationSha256: digest('synthetic-evaluation'), independentTruthAuditSha256: digest('synthetic-truth-audit') },
    validFrom: '2026-09-26T00:00:00Z', validUntil: '2026-10-26T00:00:00Z',
    bindings: { modelPromptSha256: digest('model'), imagePolicySha256: digest('image'), scoringPolicySha256: digest('score') },
    selection: { maximum: 4, perSpecimenMaximum: 1, minimumReviewerCases: 100, minimumReviewerLowerBound: .9,
      qualityMaximumAgeDays: 30, negativeRequiresExactDesign: true },
    geometry: { maximumReferenceDistance: .05, minimumSeparation: .01 },
    promotion: { enabled: true, maximumNewPublications: 2, maximumActivePublications: 20, minimumIndependentAudits: 2,
      sampleEvery: 1, monitoringMaximumAgeHours: 24, minimumMonitoredCases: 20,
      allowedLabels: domain === 'CLEAN' ? ['INSPECTED_NO_DEFECT'] : ['ACCEPTED'], familyIds: ['synthetic family'] } });
  const frame = { imageVersion: 1, preparationVersion: 1, frameId: 'fixture-frame', originalSha256: cards[1].originalSha256[0],
    inspectionImageSha256: image.sourceSha256, rectifiedImageSha256: digest('rectified') };
  const physical = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }];
  const printed = [{ x: .15, y: .15 }, { x: .85, y: .15 }, { x: .85, y: .85 }, { x: .15, y: .85 }];
  const example = domain === 'GEOMETRY' ? { kind: 'GEOMETRY', label: 'ACCEPTED', side: 'FRONT', frame, confirmation: { actor: 'HUMAN' },
    confirmed: { physical: { quad: physical }, printed: { quad: printed } } }
    : { kind: 'CLEAN_SIDE', label: 'INSPECTED_NO_DEFECT', side: 'FRONT', frame,
      inspection: { inspected: true, imageSha256: frame.inspectionImageSha256 } };
  const candidate = { id: digest('candidate'), feedbackSha256: digest('feedback'),
    source: { cardId: cards[1].cardId, actionId: id(300), actorId: id(200) }, example };
  return { domain, policy, registry, quality, bindings: policy.bindings, now, target: { ...cards[0], side: 'FRONT' }, candidates: [candidate], image, physical, printed };
}
