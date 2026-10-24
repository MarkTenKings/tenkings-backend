// Browser-only validation/projection of an explicit review. No inference,
// persistence, acquisition or price-policy authority lives here.
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).length === keys.length
  && keys.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, 'value'));
const check = (ok, code = 'COMP_RESPONSE_INVALID') => { if (!ok) throw Object.assign(new Error(code), { code }); };
const valid = (row, designation) => designation === 'STANDARD' || row.grade === 10
  && (row.grader === 'BGS' && ['BLACK_LABEL', 'PRISTINE'].includes(designation)
    || row.grader === 'CGC' && ['PRISTINE', 'PERFECT'].includes(designation));
export function assertDesignationProof(row) {
  const p = row.designationReview;
  check(exact(p, ['version', 'proofHash', 'photoSha256', 'labelText', 'labelTextHash', 'allowedDesignations'])
    && p.version === 'atlas-comp-designation-proof-v1' && hash(p.proofHash) && hash(p.photoSha256) && hash(p.labelTextHash)
    && typeof p.labelText === 'string' && p.labelText.trim().length > 0 && p.labelText.length <= 6000
    && !/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(p.labelText)
    && !row.raw && row.designation === null && row.grader !== null && row.grade !== null && !row.eligible
    && row.reasonCodes.length === 1 && row.reasonCodes[0] === 'GRADE_DESIGNATION_UNCONFIRMED'
    && Array.isArray(p.allowedDesignations) && p.allowedDesignations.length > 0 && p.allowedDesignations.length <= 3
    && new Set(p.allowedDesignations).size === p.allowedDesignations.length && p.allowedDesignations.every(d => valid(row, d)));
  return p;
}
export function parseDesignationReviews(value, input) {
  check(input.outcome === 'SELECTED' && exact(value, ['version', 'rows']) && value.version === 'atlas-comp-designation-reviews-v1'
    && Array.isArray(value.rows) && value.rows.length >= 1 && value.rows.length <= 5
    && new Set(value.rows.map(r => r?.id)).size === value.rows.length, 'COMP_REQUEST_INVALID');
  for (const r of value.rows) check(exact(r, ['id', 'designation', 'photoSha256', 'proofHash'])
    && input.selectedIds.includes(r.id) && ['STANDARD', 'BLACK_LABEL', 'PRISTINE', 'PERFECT'].includes(r.designation)
    && hash(r.photoSha256) && hash(r.proofHash), 'COMP_REQUEST_INVALID');
  return { version: value.version, rows: value.rows.map(r => ({ ...r })).sort((a, b) => a.id.localeCompare(b.id)) };
}
export function assertDesignationEvidence(row, receipt) {
  const e = row.designationEvidence;
  check(exact(e, ['version', 'authority', 'previewId', 'previewHash', 'photoSha256', 'labelTextHash', 'proofHash',
    'sourceDesignation', 'designation', 'actorId', 'reviewedAt']) && e.version === 'atlas-comp-designation-review-v1'
    && e.authority === 'HUMAN_REVIEWED' && e.sourceDesignation === null && e.designation === row.designation
    && valid(row, e.designation) && !row.raw && row.eligible && uuid(e.actorId) && uuid(e.previewId)
    && ['previewHash', 'photoSha256', 'labelTextHash', 'proofHash'].every(k => hash(e[k]))
    && receipt.policy?.version === 'atlas-comp-evidence-selection-policy-v1' && receipt.guidance === null
    && e.previewId === receipt.source?.previewId && e.previewHash === receipt.source?.previewHash
    && e.actorId === receipt.actorId && e.reviewedAt === receipt.asOf);
}
export function applyDesignationReview(row, review, { source, actorId, reviewedAt }) {
  const p = assertDesignationProof(row);
  check(review && review.id === row.id && p.allowedDesignations.includes(review.designation)
    && review.photoSha256 === p.photoSha256 && review.proofHash === p.proofHash, 'COMP_SELECTION_INELIGIBLE');
  const { designationReview: _proof, ...sale } = row;
  return { ...sale, designation: review.designation, group: `${row.grader} / ${row.grade} / ${review.designation}`,
    eligible: true, reasonCodes: [], designationEvidence: { version: 'atlas-comp-designation-review-v1', authority: 'HUMAN_REVIEWED',
      previewId: source.previewId, previewHash: source.previewHash, photoSha256: p.photoSha256, labelTextHash: p.labelTextHash,
      proofHash: p.proofHash, sourceDesignation: null, designation: review.designation, actorId, reviewedAt } };
}
export function designationDecisionRows(state, input, actorId, asOf = state.preview?.policy.asOf) {
  const reviews = input.designationReviews?.rows ?? [];
  check(!reviews.length || state.policy?.version === 'atlas-comp-evidence-selection-policy-v1', 'COMP_SELECTION_INELIGIBLE');
  const rows = (state.preview?.candidates ?? []).filter(r => input.selectedIds.includes(r.id)).map(row => {
    const review = reviews.find(r => r.id === row.id);
    if (review) return applyDesignationReview(row, review, { source: state.source, actorId, reviewedAt: asOf });
    check(row.eligible && !row.designationReview, 'COMP_SELECTION_INELIGIBLE'); return row;
  });
  check(rows.length === input.selectedIds.length && rows.every(r => r.eligible)
    && new Set(rows.map(r => r.group)).size === 1 && new Set(rows.map(r => r.currency)).size === 1, 'COMP_SELECTION_INELIGIBLE');
  return rows.sort((a, b) => b.soldAt.localeCompare(a.soldAt) || a.id.localeCompare(b.id));
}
