// Server-only mirror of the conservative local preview rules. This pure module
// has no acquisition capability. The service supplies verified saved artifacts;
// caller-provided prices, policy, time or hashes never become evidence.
import { canonical, digest, object, requireThat, uuid as strictUuid } from '@atlas/manual-service/contract';
import { isStaffInventoryResearchImageUrl } from '@tenkings/card-research-core/contract';
export const COMP_CURATION_METHOD = 'selected-sold-price-arithmetic-mean-v1';
export const COMP_EVIDENCE_SELECTION_METHOD = 'private-saved-sold-evidence-v1';
const check = (condition, code = 'COMP_CURATION_INVALID') => requireThat(condition, 400, code);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const DAY = 86400000;
const ebayDomains = new Set(['ebay.com', 'ebay.ca', 'ebay.co.uk', 'ebay.com.au', 'ebay.de', 'ebay.fr', 'ebay.it', 'ebay.es', 'ebay.ie', 'ebay.nl', 'ebay.at', 'ebay.be', 'ebay.ch', 'ebay.pl']);

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19) ? time : null;
}
function listing(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ebayDomains.has(url.hostname.replace(/^www\./, '')) && /^\/itm\/(?:[^/]+\/)?\d+(?:\/|$)/.test(url.pathname)
      ? url.origin + url.pathname : null;
  } catch { return null; }
}
function reportBinding(value) {
  check(/^ar_[A-Za-z0-9_-]{24}$/.test(value?.publicToken ?? '') && Number.isSafeInteger(value?.version)
    && value.version > 0 && hash(value.publicHash), 'COMP_APPROVAL_MISMATCH');
  return { publicToken: value.publicToken, version: value.version, publicHash: value.publicHash };
}

export function parseSavedCompSource(source, expected, { asOf, recencyDays, evidenceOnly = false, designationReviewsEnabled = false } = {}) {
  const now = instant(asOf);
  check(typeof designationReviewsEnabled === 'boolean' && (!designationReviewsEnabled || evidenceOnly), 'COMP_DESIGNATION_REVIEW_DISABLED');
  check(typeof evidenceOnly === 'boolean' && now !== null && (evidenceOnly ? recencyDays === null
    : Number.isSafeInteger(recencyDays) && recencyDays >= 1 && recencyDays <= 3650), 'COMP_POLICY_REQUIRED');
  check(source?.schema === 'atlas-saved-comp-source-v1' && uuid(source.cardId) && uuid(source.approvalActionId)
    && uuid(source.previewId) && hash(source.sourceHash));
  check(source.cardId === expected?.cardId && source.approvalActionId === expected?.approvalActionId, 'COMP_APPROVAL_MISMATCH');
  const expectedReport = reportBinding(expected?.report), preview = source.preview;
  check(['atlas-market-preview-v1', 'atlas-market-preview-v2'].includes(preview?.version)
    && preview.source === 'EBAY_SOLD' && preview.engineVersion === 'ebay-sold-comps-v2.3.0'
    && Array.isArray(preview.candidates) && preview.candidates.length <= 1000);
  check(preview.binding?.publicToken === expectedReport.publicToken && preview.binding.approvalVersion === expectedReport.version
    && preview.binding.publicHash === expectedReport.publicHash, 'COMP_APPROVAL_MISMATCH');
  const observed = instant(preview.retrievedAt);
  check(observed !== null && observed <= now, 'COMP_OBSERVATION_INVALID');
  const seen = new Set();
  const candidates = preview.candidates.map(candidate => {
    const sale = candidate?.sale;
    check(text(sale?.id, 180) && text(sale.title, 500) && !seen.has(sale.id)); seen.add(sale.id);
    const reasons = [], soldTime = instant(sale.soldAt), listingUrl = listing(sale.listingUrl);
    if (candidate.match !== 'MATCH' || sale.identityStatus !== 'MATCH') reasons.push('IDENTITY_NOT_CONFIRMED');
    for (const key of ['identityEvidence', 'variantEvidence', 'sportsAttributeEvidence']) {
      if (candidate[key] && candidate[key].status !== 'MATCH') reasons.push('MATCH_EVIDENCE_UNRESOLVED');
    }
    // A photographed label cannot establish that a multi-card lot's price is
    // the price of that one card. Keep visible references out of guidance.
    if (/\b(?:lots?|bundles?|collections?|reprints?|reproductions?|prox(?:y|ies))\b|\b(?:set|pair)\s+of\s+\d|\b\d+\s*(?:card|piece)s\b/i.test(sale.title)) reasons.push('MULTI_CARD_OR_REPRODUCTION');
    if (!listingUrl) reasons.push('LISTING_SOURCE_UNAVAILABLE');
    const exact = sale.priceBasis === 'sold' && Number.isSafeInteger(sale.priceMinor) && sale.priceMinor > 0 && sale.priceMinor <= 2147483647;
    if (!exact) reasons.push(sale.priceBasis === 'accepted_offer_unknown' ? 'ACCEPTED_OFFER_UNDISCLOSED' : 'SOLD_AMOUNT_UNAVAILABLE');
    const currency = /^[A-Z]{3}$/.test(sale.currency ?? '') ? sale.currency : null;
    if (!currency) reasons.push('CURRENCY_UNAVAILABLE');
    if (soldTime === null) reasons.push('SALE_DATE_UNAVAILABLE');
    else if (soldTime > observed || soldTime > now) reasons.push('SALE_DATE_IN_FUTURE');
    else if (recencyDays !== null && now - soldTime > recencyDays * DAY) reasons.push('SALE_OUTSIDE_RECENCY_WINDOW');
    const raw = sale.raw === true && (!sale.evidenceKind || sale.evidenceKind === 'RAW');
    const grader = !raw && ['PSA', 'BGS', 'SGC', 'CGC', 'ATLAS'].includes(sale.grader) ? sale.grader : null;
    const numericGrade = !raw && typeof sale.grade === 'string' && /^(?:[1-9](?:\.5)?|10)$/.test(sale.grade) ? Number(sale.grade) : null;
    const designation = sale.designation ?? null;
    const designationValid = designation === 'STANDARD' || numericGrade === 10 && (designation === 'BLACK_LABEL' && grader === 'BGS'
      || designation === 'PRISTINE' && ['BGS', 'CGC'].includes(grader) || designation === 'PERFECT' && grader === 'CGC');
    if (raw ? sale.grader !== null || sale.grade !== null || designation !== null
      : !grader || !numericGrade || sale.raw === true || sale.evidenceKind && sale.evidenceKind !== 'SLABBED') reasons.push('GRADE_EVIDENCE_UNRESOLVED');
    if (!raw && !designationValid) reasons.push('GRADE_DESIGNATION_UNCONFIRMED');
    // Raw condition is never equated to an ATLAS award; all groups remain
    // separate, including grading company and exact special designation.
    const group = raw ? 'RAW / condition unverified' : [grader ?? 'Unknown grader', sale.grade ?? 'Unknown grade', designation ?? 'Unknown designation'].join(' / ');
    return { id: sale.id, title: sale.title, listingUrl,
      soldAt: soldTime === null ? null : new Date(soldTime).toISOString(),
      priceMinor: exact ? sale.priceMinor : null, priceBasis: exact ? 'sold' : sale.priceBasis === 'accepted_offer_unknown' ? 'accepted_offer_unknown' : 'unknown',
      currency, raw, grader, grade: numericGrade, designation, group,
      eligible: reasons.length === 0, reasonCodes: [...new Set(reasons)] };
  }).sort((a, b) => (instant(b.soldAt) ?? 0) - (instant(a.soldAt) ?? 0) || a.id.localeCompare(b.id));
  // Duplicate listings under different source ids would overstate the sample.
  const listingCounts = new Map();
  const listingIdentity = row => row.listingUrl?.match(/\/itm\/(?:[^/]+\/)?(\d+)(?:\/|$)/)?.[1] ?? null;
  for (const row of candidates) if (row.listingUrl) { const id = listingIdentity(row); listingCounts.set(id, (listingCounts.get(id) ?? 0) + 1); }
  for (const row of candidates) if (listingCounts.get(listingIdentity(row)) > 1) { row.eligible = false; row.reasonCodes.push('DUPLICATE_LISTING'); }
  if (designationReviewsEnabled && preview.version === 'atlas-market-preview-v2' && preview.responsePolicy === 'ATLAS_SLAB_V1') {
    for (const row of candidates) {
      if (row.reasonCodes.length !== 1 || row.reasonCodes[0] !== 'GRADE_DESIGNATION_UNCONFIRMED') continue;
      const original = preview.candidates.find(value => value.sale.id === row.id), sale = original.sale, reading = original.slabReading;
      const labelText = sale.labelText;
      if (row.raw || sale.designation !== null || sale.evidenceKind !== 'SLABBED' || reading?.evidenceKind !== 'SLABBED'
        || reading.rowId !== row.id || reading.identityMatch !== 'MATCH' || reading.gradingCompany !== row.grader
        || reading.numericGrade !== row.grade || !hash(reading.sha256) || reading.imageUrl !== sale.imageUrl
        || !isStaffInventoryResearchImageUrl(reading.imageUrl) || typeof labelText !== 'string' || !labelText.trim()
        || labelText.length > 6000 || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(labelText)) continue;
      const labelTextHash = digest(labelText), allowedDesignations = ['STANDARD'];
      if (row.grade === 10 && row.grader === 'BGS') allowedDesignations.push('BLACK_LABEL', 'PRISTINE');
      if (row.grade === 10 && row.grader === 'CGC') allowedDesignations.push('PRISTINE', 'PERFECT');
      const proof = { version: 'atlas-comp-designation-proof-v1', cardId: source.cardId, approvalActionId: source.approvalActionId,
        report: expectedReport, previewId: source.previewId, previewHash: source.sourceHash, id: row.id,
        grader: row.grader, grade: row.grade, sourceDesignation: null, photoSha256: reading.sha256,
        imageUrl: reading.imageUrl, labelTextHash };
      row.designationReview = { version: proof.version, proofHash: digest(canonical(proof)), photoSha256: reading.sha256,
        labelText, labelTextHash, allowedDesignations };
    }
  }
  return { schema: 'atlas-curation-preview-v1', binding: { cardId: source.cardId, approvalActionId: source.approvalActionId, report: expectedReport },
    source: { previewId: source.previewId, sourceHash: source.sourceHash, observedAt: new Date(observed).toISOString() },
    policy: { asOf: new Date(now).toISOString(), recencyDays,
      method: evidenceOnly ? COMP_EVIDENCE_SELECTION_METHOD : COMP_CURATION_METHOD, status: 'LOCAL_PROPOSAL' }, candidates };
}

/** No selection changes an approval or its report. Exactly one comparison
 * group/currency is allowed; missing prices never become zero. */
export function curateSoldComps(source, expected, { outcome, selectedIds = [], reviewedIds = [], asOf, recencyDays, evidenceOnly = false,
  designationReviewsEnabled = false, designationReviews, actorId } = {}) {
  const preview = parseSavedCompSource(source, expected, { asOf, recencyDays, evidenceOnly, designationReviewsEnabled });
  check(['SELECTED', 'SKIP', 'NO_SUITABLE_COMPS'].includes(outcome) && Array.isArray(selectedIds)
    && Array.isArray(reviewedIds) && new Set(selectedIds).size === selectedIds.length && new Set(reviewedIds).size === reviewedIds.length);
  check(selectedIds.every(id => text(id, 180)) && reviewedIds.every(id => selectedIds.includes(id)));
  if (designationReviews !== undefined) {
    check(designationReviewsEnabled && evidenceOnly && outcome === 'SELECTED' && uuid(actorId), 'COMP_DESIGNATION_REVIEW_DISABLED');
    const reviews = parseDesignationReviews(designationReviews, selectedIds);
    for (const review of reviews.rows) {
      const row = preview.candidates.find(value => value.id === review.id), proof = row?.designationReview;
      check(proof && proof.proofHash === review.proofHash && proof.photoSha256 === review.photoSha256
        && proof.allowedDesignations.includes(review.designation), 'COMP_DESIGNATION_REVIEW_MISMATCH');
      row.designation = review.designation; row.group = `${row.grader} / ${row.grade} / ${row.designation}`;
      row.eligible = true; row.reasonCodes = [];
      row.designationEvidence = { version: 'atlas-comp-designation-review-v1', authority: 'HUMAN_REVIEWED',
        previewId: source.previewId, previewHash: source.sourceHash, photoSha256: proof.photoSha256,
        labelTextHash: proof.labelTextHash, proofHash: proof.proofHash, sourceDesignation: null,
        designation: review.designation, actorId, reviewedAt: asOf };
    }
  }
  if (outcome !== 'SELECTED') {
    check(selectedIds.length === 0 && reviewedIds.length === 0, 'COMP_SELECTION_OUTCOME_CONFLICT');
    return { schema: 'atlas-curation-decision-v1', binding: preview.binding, source: preview.source, policy: preview.policy,
      outcome, selected: [], guidance: null, persistence: 'PREVIEW_ONLY', approvalUnaffected: true };
  }
  check(selectedIds.length >= 1 && selectedIds.length <= 5, 'COMP_SELECTION_BOUND');
  check(selectedIds.length === reviewedIds.length && selectedIds.every(id => reviewedIds.includes(id)), 'COMP_HUMAN_REVIEW_REQUIRED');
  const selected = selectedIds.map(id => {
    const row = preview.candidates.find(candidate => candidate.id === id);
    check(row?.eligible === true, 'COMP_SELECTION_INELIGIBLE');
    const { designationReview: _proof, ...facts } = row;
    return { ...facts, reasonCodes: [] };
  }).sort((a, b) => (instant(b.soldAt) ?? 0) - (instant(a.soldAt) ?? 0) || a.id.localeCompare(b.id));
  check(new Set(selected.map(row => row.group)).size === 1, 'COMP_GRADE_GROUP_MIXED');
  check(new Set(selected.map(row => row.currency)).size === 1, 'COMP_CURRENCY_MIXED');
  // Evidence selection is not a valuation method. In particular, removing an
  // age cutoff here must never make older saved sales enter price guidance.
  if (evidenceOnly) return { schema: 'atlas-curation-decision-v1', binding: preview.binding, source: preview.source, policy: preview.policy,
    outcome, selected, guidance: null, persistence: 'PREVIEW_ONLY', approvalUnaffected: true };
  const sumMinor = selected.reduce((total, row) => total + row.priceMinor, 0), count = selected.length;
  check(Number.isSafeInteger(sumMinor));
  const quotient = Math.floor(sumMinor / count), remainder = sumMinor % count;
  const meanMinor = quotient + (remainder * 2 >= count ? 1 : 0);
  return { schema: 'atlas-curation-decision-v1', binding: preview.binding, source: preview.source, policy: preview.policy,
    outcome, selected, persistence: 'PREVIEW_ONLY', approvalUnaffected: true,
    guidance: { status: 'LOCAL_PROPOSAL', method: COMP_CURATION_METHOD, meanMinor, sumMinor, sampleCount: count,
      lowMinor: Math.min(...selected.map(row => row.priceMinor)), highMinor: Math.max(...selected.map(row => row.priceMinor)),
      currency: selected[0].currency, group: selected[0].group,
      oldestSaleAt: selected.at(-1).soldAt, newestSaleAt: selected[0].soldAt,
      excludes: ['SHIPPING', 'TAX', 'FEES'], rounding: 'NEAREST_MINOR_UNIT_HALF_UP',
      askingPriceMinor: null, sellerSetsAskingPrice: true } };
}


export function compCurationPolicy(value) {
  if (value === null) return null;
  object(value, ['version', 'status', 'method', 'recencyDays', 'rightsStatus']);
  check(value.version === 'atlas-comp-curation-policy-v1' && value.status === 'LOCAL_PROPOSAL'
    && value.method === COMP_CURATION_METHOD && Number.isInteger(value.recencyDays) && value.recencyDays >= 1 && value.recencyDays <= 3650
    && value.rightsStatus === 'UNRESOLVED', 'COMP_POLICY_REQUIRED');
  const policy = JSON.parse(canonical(value)); return { policy, hash: digest(canonical(policy)) };
}
export function compEvidenceSelectionPolicy(value) {
  if (value === null) return null;
  object(value, ['version', 'status', 'method', 'recencyDays', 'rightsStatus']);
  check(value.version === 'atlas-comp-evidence-selection-policy-v1' && value.status === 'LOCAL_PROPOSAL'
    && value.method === COMP_EVIDENCE_SELECTION_METHOD && value.recencyDays === null
    && value.rightsStatus === 'UNRESOLVED', 'COMP_POLICY_REQUIRED');
  const policy = JSON.parse(canonical(value)); return { policy, hash: digest(canonical(policy)) };
}
function parseDesignationReviews(value, selectedIds) {
  object(value, ['version', 'rows']);
  check(value.version === 'atlas-comp-designation-reviews-v1' && Array.isArray(value.rows) && value.rows.length >= 1 && value.rows.length <= 5,
    'COMP_DESIGNATION_REVIEW_INVALID');
  const seen = new Set();
  const rows = value.rows.map(row => {
    object(row, ['id', 'designation', 'photoSha256', 'proofHash']);
    check(text(row.id, 180) && selectedIds.includes(row.id) && !seen.has(row.id)
      && ['STANDARD', 'BLACK_LABEL', 'PRISTINE', 'PERFECT'].includes(row.designation)
      && hash(row.photoSha256) && hash(row.proofHash), 'COMP_DESIGNATION_REVIEW_INVALID');
    seen.add(row.id); return { ...row };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { version: value.version, rows };
}
export function compCurationInput(input, { designationReviewsEnabled = false } = {}) {
  const hasReviews = input && Object.hasOwn(input, 'designationReviews');
  check(typeof designationReviewsEnabled === 'boolean' && (!hasReviews || designationReviewsEnabled), 'COMP_DESIGNATION_REVIEW_DISABLED');
  object(input, ['requestId', 'approvalActionId', 'expectedSelectionRevision', 'previewId', 'expectedPreviewHash', 'outcome', 'selectedIds', 'reviewedIds', 'expectedPolicyHash',
    ...(hasReviews ? ['designationReviews'] : [])]);
  strictUuid(input.requestId); strictUuid(input.approvalActionId);
  check(Number.isSafeInteger(input.expectedSelectionRevision) && input.expectedSelectionRevision >= 0 && input.expectedSelectionRevision < 2147483646);
  check(['SELECTED', 'SKIP', 'NO_SUITABLE_COMPS'].includes(input.outcome));
  if (input.previewId !== null) strictUuid(input.previewId);
  check(input.previewId === null ? input.expectedPreviewHash === null : hash(input.expectedPreviewHash));
  check(input.expectedPolicyHash === null || hash(input.expectedPolicyHash));
  check(Array.isArray(input.selectedIds) && Array.isArray(input.reviewedIds) && input.selectedIds.length <= 5
    && input.reviewedIds.length <= 5 && input.selectedIds.every(id => text(id, 180)) && input.reviewedIds.every(id => text(id, 180))
    && new Set(input.selectedIds).size === input.selectedIds.length && new Set(input.reviewedIds).size === input.reviewedIds.length);
  check(input.outcome === 'SELECTED' ? input.previewId !== null && input.expectedPolicyHash !== null && input.selectedIds.length >= 1
    && input.selectedIds.length === input.reviewedIds.length && input.selectedIds.every(id => input.reviewedIds.includes(id))
    : input.selectedIds.length === 0 && input.reviewedIds.length === 0, 'COMP_SELECTION_OUTCOME_CONFLICT');
  // ID order is not a second decision. Canonicalize to make exact retries stable.
  if (hasReviews) check(input.outcome === 'SELECTED', 'COMP_DESIGNATION_REVIEW_INVALID');
  return { ...input, selectedIds: [...input.selectedIds].sort(), reviewedIds: [...input.reviewedIds].sort(),
    ...(hasReviews ? { designationReviews: parseDesignationReviews(input.designationReviews, input.selectedIds) } : {}) };
}
export function compCurationReadInput(input) {
  object(input, ['approvalActionId', 'previewId']); strictUuid(input.approvalActionId);
  if (input.previewId !== null) strictUuid(input.previewId); return { ...input };
}
export function evaluateCompCuration(source, binding, configuredPolicy, asOf, input, { designationReviewsEnabled = false, actorId } = {}) {
  requireThat(instant(asOf) !== null, 503, 'COMP_CURATION_CLOCK_INVALID');
  if (input.outcome !== 'SELECTED') return { selected: [], guidance: null };
  requireThat(configuredPolicy && configuredPolicy.hash === input.expectedPolicyHash, 409, 'COMP_POLICY_CHANGED');
  const decision = curateSoldComps(source, { cardId: binding.cardId, approvalActionId: binding.approvalActionId,
    report: { publicToken: binding.publicToken, version: binding.publicVersion, publicHash: binding.publicHash } }, {
    outcome: input.outcome, selectedIds: input.selectedIds, reviewedIds: input.reviewedIds, asOf, recencyDays: configuredPolicy.policy.recencyDays,
    evidenceOnly: configuredPolicy.policy.version === 'atlas-comp-evidence-selection-policy-v1',
    designationReviewsEnabled, designationReviews: input.designationReviews, actorId,
  });
  return { selected: decision.selected, guidance: decision.guidance === null ? null
    : { ...decision.guidance, visibility: 'PRIVATE_INTERNAL', rightsStatus: 'UNRESOLVED', listingPrice: null } };
}
