import { canonical, digest, immutable, requireThat, hash, validateFrame, uuid } from './contract.mjs';

const seal = value => immutable({ ...value, sha256: digest(canonical(value, { maxBytes: 16777216 })) });
const checkSeal = value => { const { sha256, ...body } = value ?? {}; hash(sha256);
  requireThat(digest(canonical(body, { maxBytes: 16777216 })) === sha256, 409, 'LEARNING_POLICY_HASH_MISMATCH'); return value; };
const id = value => requireThat(typeof value === 'string' && value.length > 0 && value.length <= 512, 400, 'LEARNING_IDENTITY_REQUIRED');
const bounded = (value, low, high) => requireThat(Number.isFinite(value) && value >= low && value <= high, 400, 'LEARNING_POLICY_INVALID');
export const LEARNING_DOMAINS = Object.freeze(['DEFECT', 'CLEAN', 'GEOMETRY']);
export const roleLearningFallback = ({ domain, reason = 'POLICY_NOT_ACTIVE', policySha256 = null, unavailable = [] }) =>
  seal({ version: 'atlas-role-learning-selection-v1', domain, status: 'BASELINE', reason, policySha256, examples: [], decisions: [], unavailable });
export const normalizeLearningIdentity = value => {
  id(value); return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
};

/** An independently audited, immutable inventory, not a guess from image hashes.
 * Explicit specimen grouping joins retakes; exact design and family are distinct.
 * Every use checks original membership, so stale card aliases cannot gain access. */
export function validateLearningRegistry(registry) {
  checkSeal(registry);
  requireThat(registry.version === 'atlas-learning-identity-registry-v1' && Array.isArray(registry.cards)
    && registry.cards.length <= 10000, 400, 'LEARNING_REGISTRY_INVALID');
  hash(registry.auditSha256);
  const cards = new Set(), originals = new Map(), specimens = new Map();
  for (const card of registry.cards) {
    for (const key of ['cardId', 'specimenId', 'familyId', 'designId']) id(card[key]);
    uuid(card.cardId);
    requireThat(!cards.has(card.cardId) && Array.isArray(card.originalSha256) && card.originalSha256.length === 2
      && card.familyId === normalizeLearningIdentity(card.familyId) && card.designId === normalizeLearningIdentity(card.designId),
    400, 'LEARNING_REGISTRY_INVALID');
    cards.add(card.cardId); card.originalSha256.forEach(hash);
    const identity = canonical({ familyId: card.familyId, designId: card.designId });
    requireThat(!specimens.has(card.specimenId) || specimens.get(card.specimenId) === identity, 409, 'LEARNING_SPECIMEN_IDENTITY_CONFLICT');
    specimens.set(card.specimenId, identity);
    for (const original of card.originalSha256) {
      requireThat(!originals.has(original) || originals.get(original) === card.specimenId, 409, 'LEARNING_ORIGINAL_IDENTITY_CONFLICT');
      originals.set(original, card.specimenId);
    }
  }
  return immutable(structuredClone(registry));
}

export function validateReviewerQuality(quality) {
  checkSeal(quality);
  requireThat(quality.version === 'atlas-learning-reviewer-quality-v1' && Array.isArray(quality.reviewers)
    && quality.reviewers.length <= 10000, 400, 'LEARNING_REVIEWER_QUALITY_INVALID');
  hash(quality.auditSha256); const keys = new Set();
  for (const reviewer of quality.reviewers) {
    id(reviewer.actorId); const key = `${reviewer.actorId}:${reviewer.domain}`;
    requireThat(LEARNING_DOMAINS.includes(reviewer.domain) && !keys.has(key)
      && Number.isSafeInteger(reviewer.correct) && Number.isSafeInteger(reviewer.total)
      && reviewer.total > 0 && reviewer.correct >= 0 && reviewer.correct <= reviewer.total
      && Number.isFinite(Date.parse(reviewer.measuredAt)), 400, 'LEARNING_REVIEWER_QUALITY_INVALID');
    hash(reviewer.independentAuditSha256); keys.add(key);
  }
  return immutable(structuredClone(quality));
}
function lowerBound({ correct, total }) {
  const z = 1.959963984540054, p = correct / total, d = 1 + z * z / total;
  return (p + z * z / (2 * total) - z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / d;
}

/** Owner policy is data in a privileged immutable release/configuration, never
 * accepted from a browser or model. Hashes prove consistency, not human honesty. */
export function validateLearningPolicy(policy, { domain, registry, quality, now = Date.now() } = {}) {
  checkSeal(policy); validateLearningRegistry(registry); validateReviewerQuality(quality);
  requireThat(policy.version === 'atlas-validated-learning-policy-v1' && policy.domain === domain
    && LEARNING_DOMAINS.includes(domain) && policy.status === 'VALIDATED'
    && policy.registrySha256 === registry.sha256 && policy.reviewerQualitySha256 === quality.sha256,
  409, 'LEARNING_VALIDATED_POLICY_REQUIRED');
  id(policy.id); hash(policy.evaluationSha256); hash(policy.independentTruthAuditSha256);
  for (const key of ['modelPromptSha256', 'imagePolicySha256', 'scoringPolicySha256']) hash(policy.bindings?.[key]);
  const approval = policy.ownerApproval;
  requireThat(approval?.evaluationSha256 === policy.evaluationSha256
    && approval.independentTruthAuditSha256 === policy.independentTruthAuditSha256
    && Number.isFinite(Date.parse(approval.approvedAt)) && Date.parse(approval.approvedAt) <= now,
  409, 'LEARNING_OWNER_POLICY_REQUIRED'); id(approval.approvedBy);
  requireThat(Date.parse(policy.validFrom) <= now && now < Date.parse(policy.validUntil), 409, 'LEARNING_POLICY_EXPIRED');
  const s = policy.selection;
  requireThat(s && Number.isInteger(s.maximum) && s.maximum >= 1 && s.maximum <= 12
    && Number.isInteger(s.perSpecimenMaximum) && s.perSpecimenMaximum >= 1 && s.perSpecimenMaximum <= 2
    && Number.isInteger(s.minimumReviewerCases) && s.minimumReviewerCases > 0
    && Number.isInteger(s.qualityMaximumAgeDays) && s.qualityMaximumAgeDays > 0
    && s.negativeRequiresExactDesign === true, 400, 'LEARNING_POLICY_INVALID');
  bounded(s.minimumReviewerLowerBound, 0, 1);
  if (domain === 'GEOMETRY') { bounded(policy.geometry?.maximumReferenceDistance, 0, 10);
    bounded(policy.geometry?.minimumSeparation, 0, 10); }
  return immutable(structuredClone(policy));
}

/** Class-specific, bounded selection. Missing identity or audited quality falls
 * back; a look-alike name never joins physical specimens or activates a lesson. */
export function selectRoleLearning({ domain, policy, registry, quality, target, candidates, bindings, now = Date.now() }) {
  if (!policy) return roleLearningFallback({ domain });
  validateLearningPolicy(policy, { domain, registry, quality, now });
  requireThat(bindings && canonical(bindings) === canonical(policy.bindings), 409, 'LEARNING_RUNTIME_POLICY_CHANGED');
  uuid(target?.cardId);
  requireThat(Array.isArray(target.originalSha256) && target.originalSha256.length === 2
    && (target.side == null || ['FRONT', 'BACK'].includes(target.side)), 400, 'LEARNING_TARGET_INVALID');
  target.originalSha256.forEach(hash);
  requireThat(Array.isArray(candidates) && candidates.length <= 256, 400, 'LEARNING_CANDIDATE_LIMIT');
  const byCard = new Map(registry.cards.map(c => [c.cardId, c]));
  const known = byCard.get(target.cardId), own = known && target.originalSha256.every(h => known.originalSha256.includes(h)) ? known : null;
  const byReviewer = new Map(quality.reviewers.map(r => [`${r.actorId}:${r.domain}`, r]));
  const decisions = [], eligible = [], seen = new Set();
  for (const candidate of candidates) {
    // Invalid individual feedback is evidence of unavailable coverage, not an
    // outage for unrelated lessons or the card being inspected.
    try { hash(candidate.id); hash(candidate.feedbackSha256); uuid(candidate.source?.cardId);
      uuid(candidate.source?.actionId); uuid(candidate.source?.actorId); validateFrame(candidate.example?.frame);
      requireThat(['FRONT', 'BACK'].includes(candidate.example.side), 409, 'LEARNING_EXAMPLE_INVALID');
    } catch (error) { if ([401, 403].includes(error?.status)) throw error;
      decisions.push({ id: /^[a-f0-9]{64}$/.test(candidate?.id) ? candidate.id : digest(`invalid-example-${decisions.length}`),
        selected: false, reason: 'EXAMPLE_INVALID' }); continue; }
    const { source, example } = candidate;
    const match = byCard.get(source.cardId), card = match?.originalSha256.includes(example.frame.originalSha256) ? match : null;
    const reviewer = byReviewer.get(`${source.actorId}:${domain}`);
    const qualityScore = reviewer ? lowerBound(reviewer) : 0;
    const kind = domain === 'CLEAN' ? 'CLEAN_SIDE' : domain;
    let reason = !own ? 'TARGET_IDENTITY_UNKNOWN' : !card ? 'SOURCE_IDENTITY_UNKNOWN'
      : card.specimenId === own.specimenId || target.originalSha256.includes(example.frame.originalSha256) ? 'SAME_SPECIMEN'
      : card.familyId !== own.familyId ? 'FAMILY_MISMATCH'
      : example.kind !== kind ? 'WRONG_DOMAIN' : target.side && example.side !== target.side ? 'SIDE_MISMATCH'
      : (domain === 'CLEAN' || example.label === 'REJECTED') && card.designId !== own.designId ? 'NEGATIVE_DESIGN_MISMATCH'
      : !reviewer || reviewer.total < policy.selection.minimumReviewerCases || qualityScore < policy.selection.minimumReviewerLowerBound ? 'REVIEWER_QUALITY_UNPROVEN'
      : now - Date.parse(reviewer.measuredAt) > policy.selection.qualityMaximumAgeDays * 86400000 || Date.parse(reviewer.measuredAt) > now ? 'REVIEWER_QUALITY_STALE'
      : seen.has(candidate.id) ? 'DUPLICATE' : null;
    seen.add(candidate.id);
    if (reason) decisions.push({ id: candidate.id, selected: false, reason });
    else eligible.push({ candidate, card, qualityScore });
  }
  eligible.sort((a, b) => Number(b.card.designId === own.designId) - Number(a.card.designId === own.designId)
    || b.qualityScore - a.qualityScore || a.candidate.id.localeCompare(b.candidate.id));
  const examples = [], used = new Map();
  for (const entry of eligible) {
    const reason = examples.length >= policy.selection.maximum ? 'BUDGET'
      : (used.get(entry.card.specimenId) ?? 0) >= policy.selection.perSpecimenMaximum ? 'SPECIMEN_QUOTA' : 'MATCHED_AUDITED_REFERENCE';
    decisions.push({ id: entry.candidate.id, selected: reason === 'MATCHED_AUDITED_REFERENCE', reason });
    if (reason === 'MATCHED_AUDITED_REFERENCE') { examples.push(entry.candidate); used.set(entry.card.specimenId, (used.get(entry.card.specimenId) ?? 0) + 1); }
  }
  return seal({ version: 'atlas-role-learning-selection-v1', domain, status: examples.length ? 'READY' : 'BASELINE',
    policySha256: policy.sha256, registrySha256: registry.sha256, reviewerQualitySha256: quality.sha256,
    target: { cardId: target.cardId, originalSha256: target.originalSha256, side: target.side ?? null }, examples, decisions });
}

/** The clean consumer constructs negative visual examples only. The caller
 * must load exact verified inspection bytes; no text-only absence assertion or
 * clean-card measurement is allowed to substitute for current-card inspection. */
export async function consumeCleanLearning({ selection, loadImage, limit = 4, remainingImageBytes = 32 * 1024 * 1024 }) {
  checkSeal(selection); requireThat(selection.domain === 'CLEAN', 400, 'LEARNING_ROLE_MISMATCH');
  requireThat(Number.isInteger(limit) && limit >= 0 && limit <= 4
    && Number.isSafeInteger(remainingImageBytes) && remainingImageBytes >= 0 && remainingImageBytes <= 32 * 1024 * 1024, 400, 'LEARNING_CANDIDATE_LIMIT');
  const examples = [], evidence = [], unavailable = [...(selection.unavailable ?? []),
    ...selection.decisions.filter(e => e.reason === 'EXAMPLE_INVALID')].slice(0, 4).map(e => ({ id: e.id, reason: 'CLEAN_IMAGE_UNAVAILABLE_OR_INVALID' }));
  for (const candidate of selection.examples.slice(0, 4)) {
    if (examples.length >= limit) { unavailable.push({ id: candidate.id, reason: 'CLEAN_EXAMPLE_BUDGET' }); continue; }
    try {
    hash(candidate.id); hash(candidate.feedbackSha256); uuid(candidate.source?.cardId);
    const e = candidate.example; validateFrame(e?.frame);
    requireThat(['FRONT', 'BACK'].includes(e.side), 409, 'LEARNING_EXAMPLE_INVALID');
    requireThat(e.kind === 'CLEAN_SIDE' && e.label === 'INSPECTED_NO_DEFECT'
      && e.inspection?.inspected === true && e.inspection.imageSha256 === e.frame.inspectionImageSha256,
    409, 'LEARNING_CLEAN_INSPECTION_REQUIRED');
    const image = await loadImage(candidate);
    requireThat(image?.bytes instanceof Uint8Array && image.bytes.byteLength > 32 && image.bytes.byteLength <= 10 * 1024 * 1024 && digest(image.bytes) === image.sha256
      && image.sourceSha256 === e.frame.inspectionImageSha256 && image.mime === 'image/png'
      && image.width === 1350 && image.height === 1858,
    409, 'LEARNING_CLEAN_IMAGE_MISMATCH');
    const bytes = Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength);
    requireThat(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR'
      && bytes.readUInt32BE(16) === image.width && bytes.readUInt32BE(20) === image.height,
    409, 'LEARNING_CLEAN_IMAGE_MISMATCH');
    if (image.bytes.byteLength > remainingImageBytes) { unavailable.push({ id: candidate.id, reason: 'CLEAN_EXAMPLE_BUDGET' }); continue; }
    remainingImageBytes -= image.bytes.byteLength;
    const metadata = { id: candidate.id, feedbackSha256: candidate.feedbackSha256, sourceCardId: candidate.source.cardId,
      side: e.side, frame: e.frame, imageSha256: image.sha256 };
    examples.push({ metadata, image }); evidence.push(metadata);
    } catch (error) { if ([401, 403].includes(error?.status)) throw error;
      unavailable.push({ id: candidate.id, reason: 'CLEAN_IMAGE_UNAVAILABLE_OR_INVALID' }); }
  }
  return { examples, evidence: seal({ version: 'atlas-clean-consumer-v1', selectionSha256: selection.sha256,
    policySha256: selection.policySha256 ?? digest('inactive-clean-policy'), fallbackReason: selection.reason ?? null,
    examples: evidence, unavailable: unavailable.slice(0, 4) }) };
}

const point = p => Array.isArray(p) ? p : [p.x, p.y];
function quad(value) { const points = Array.isArray(value) ? value : ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].map(k => value?.[k]);
  requireThat(points.length === 4 && points.every(p => p && point(p).length === 2 && point(p).every(Number.isFinite)), 400, 'LEARNING_GEOMETRY_INVALID');
  return points.map(point); }
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function geometryFeatures(value) {
  const p = quad(value.physical), lengths = p.map((v, i) => distance(v, p[(i + 1) % 4]));
  requireThat(lengths.every(v => v > 0), 400, 'LEARNING_GEOMETRY_INVALID');
  const scale = lengths.reduce((a, b) => a + b, 0), result = lengths.map(v => v / scale);
  if (value.printed) { const printed = quad(value.printed);
    // Printed geometry is normalized in the rectified card frame. Its corner
    // insets cannot be subtracted from physical photo-frame coordinates.
    const rectifiedCorners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    result.push(...printed.map((v, i) => distance(v, rectifiedCorners[i]) / Math.SQRT2)); }

  return result;
}

/** Consume only geometry references. Rank already native-supported proposals;
 * never transplant a source quad, generate coordinates, measure a grade or
 * imply confirmation. Ambiguous separation returns abstention for human review. */
export function consumeGeometryLearning({ selection, policy, targetFrameSha256, candidates }) {
  checkSeal(selection); hash(targetFrameSha256);
  requireThat(selection.domain === 'GEOMETRY' && Array.isArray(candidates) && candidates.length <= 32, 400, 'LEARNING_ROLE_MISMATCH');
  if (selection.status !== 'READY') return seal({ version: 'atlas-geometry-consumer-v1', status: 'BASELINE', reason: selection.reason ?? 'NO_ELIGIBLE_REFERENCES',
    selectionSha256: selection.sha256, candidates: [], requiresHumanConfirmation: true });
  requireThat(policy.sha256 === selection.policySha256, 409, 'LEARNING_POLICY_HASH_MISMATCH');
  const references = [], unavailable = [];
  for (const candidate of selection.examples) { try {
    const { example } = candidate;
    requireThat(example.kind === 'GEOMETRY' && example.confirmation?.actor === 'HUMAN', 409, 'LEARNING_GEOMETRY_CONFIRMATION_REQUIRED');
    references.push({ id: digest(canonical(example)), values: geometryFeatures({ physical: example.confirmed.physical.quad, printed: example.confirmed.printed?.quad ?? null }),
      printed: Boolean(example.confirmed.printed?.quad) });
    } catch (error) { if ([401, 403].includes(error?.status)) throw error;
      unavailable.push({ id: candidate.id, reason: 'GEOMETRY_REFERENCE_INVALID' }); }
  }
  const scored = candidates.map(candidate => {
    id(candidate.id); requireThat(candidate.authority === 'PROPOSER_ONLY' && candidate.frameSha256 === targetFrameSha256
      && candidate.nativeSupported === true && candidate.engineSha256 === policy.bindings.modelPromptSha256,
    409, 'LEARNING_GEOMETRY_SOURCE_MISMATCH');
    const values = geometryFeatures(candidate), matching = references.filter(r => r.printed === Boolean(candidate.printed));
    const scores = matching.map(r => ({ id: r.id, distance: Math.hypot(...values.map((v, i) => v - r.values[i])) }));
    scores.sort((a, b) => a.distance - b.distance);
    return { id: candidate.id, distance: scores[0]?.distance ?? null, referenceId: scores[0]?.id ?? null };
  }).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.id.localeCompare(b.id));
  const best = scored[0], separated = scored.length < 2 || scored[1].distance === null
    || scored[1].distance - best.distance >= policy.geometry.minimumSeparation;
  const usable = best?.distance !== null && best?.distance <= policy.geometry.maximumReferenceDistance && separated;
  return seal({ version: 'atlas-geometry-consumer-v1', status: usable ? 'CANDIDATE' : 'ABSTAIN', selectionSha256: selection.sha256,
    targetFrameSha256, selectedCandidateId: usable ? best.id : null, candidates: scored, unavailable, requiresHumanConfirmation: true });
}

/** Bind the actual feature/ranking implementation, not only the native engine.
 * A code change invalidates the prior policy until independently re-evaluated. */
export function geometryLearningConsumerFacts() {
  return { version: 'atlas-geometry-consumer-v1', role: 'NATIVE_PROPOSAL_ADVISOR', maximumCandidates: 32,
    coordinateAuthority: 'PROPOSER_ONLY', featureSha256: digest(String(geometryFeatures)),
    quadSha256: digest(String(quad)), pointSha256: digest(String(point)), distanceSha256: digest(String(distance)),
    consumerSha256: digest(String(consumeGeometryLearning)) };
}
